import { chatAPI } from '../services/api'
import { STORAGE_KEYS } from '../config/constants'
import type { ProductProfile } from '../types'

interface FillMapping {
  fieldId: string
  value: string | boolean | AssetFillValue
  source: keyof ProductProfile | 'adapted' | 'asset' | 'unknown'
  confidence: number
  reason?: string
}

interface AssetFillValue {
  assetUrls: string[]
}

interface FillData {
  formFields: any[]
  pageContext: any
  productProfile?: ProductProfile
}

interface RegenerateFieldData {
  field: any
  action: 'rewrite' | 'rematch'
  currentValue: string
  productProfile?: ProductProfile
}

interface AddExtraInfoData {
  field: any
  value: string
  pageUrl?: string
}

const DEFAULT_ASSET_URLS = {
  logoImageUrl: 'product-assets/minigpt-logo-square-500x500.jpg',
  screenshotImageUrl: 'product-assets/minigpt-website-screenshot.png',
  promoImageUrl: 'product-assets/minigpt-promo-image.jpg',
  bannerImageUrl: 'product-assets/minigpt-banner-image.png'
}

async function getSettings() {
  const storageData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)

  if (!storageData[STORAGE_KEYS.SETTINGS]) {
    return null
  }

  const parsed = JSON.parse(storageData[STORAGE_KEYS.SETTINGS])
  return parsed.state || parsed
}

function compactProfile(profile: ProductProfile) {
  const compacted = Object.fromEntries(
    Object.entries(profile || {}).filter(([, value]) => String(value || '').trim().length > 0)
  )

  const contactFullName = [profile?.contactFirstName, profile?.contactLastName].filter(Boolean).join(' ').trim()
  if (contactFullName) {
    compacted.contactFullName = contactFullName
  }

  if (profile?.contactEmail) {
    compacted.defaultSubmissionEmail = profile.contactEmail
  }

  if (profile?.companyEmail) {
    compacted.formalCompanyEmail = profile.companyEmail
  }

  return compacted
}

function withDefaultAssetProfile(profile: ProductProfile): ProductProfile {
  return {
    ...profile,
    logoImageUrl: profile?.logoImageUrl || DEFAULT_ASSET_URLS.logoImageUrl,
    screenshotImageUrl: profile?.screenshotImageUrl || DEFAULT_ASSET_URLS.screenshotImageUrl,
    promoImageUrl: profile?.promoImageUrl || DEFAULT_ASSET_URLS.promoImageUrl,
    bannerImageUrl: profile?.bannerImageUrl || DEFAULT_ASSET_URLS.bannerImageUrl
  }
}

function extractJsonObject(rawResponse: string) {
  let jsonString = rawResponse.trim()

  if (jsonString.includes('```')) {
    const match = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (match?.[1]) jsonString = match[1].trim()
  }

  const jsonStart = jsonString.indexOf('{')
  const jsonEnd = jsonString.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    jsonString = jsonString.substring(jsonStart, jsonEnd + 1)
  }

  return JSON.parse(jsonString)
}

function normalizeMappings(parsed: any): FillMapping[] {
  if (Array.isArray(parsed?.fields)) {
    return parsed.fields.filter((item: any) => item?.fieldId && item.value !== undefined)
  }

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return Object.entries(parsed).map(([fieldId, value]) => ({
      fieldId,
      value: value as string | boolean,
      source: 'unknown' as const,
      confidence: 0.6
    }))
  }

  return []
}

function mappingsToFilledData(mappings: FillMapping[]) {
  return mappings.reduce<Record<string, string | boolean | AssetFillValue>>((result, mapping) => {
    if (mapping.value !== '' && mapping.value !== null && mapping.value !== undefined) {
      result[mapping.fieldId] = mapping.value
    }
    return result
  }, {})
}

function fieldContextText(field: any) {
  return [
    field?.label,
    field?.name,
    field?.id,
    field?.type,
    field?.placeholder,
    field?.context,
    field?.accept,
    field?.multiple ? 'multiple files allowed' : ''
  ].filter(Boolean).join(' ')
}

function getFieldMaxLength(field: any) {
  const explicitMaxLength = Number(field?.maxLength)
  if (explicitMaxLength > 0 && explicitMaxLength <= 2000) return explicitMaxLength

  const text = fieldContextText(field)
  const counterMatches = Array.from(text.matchAll(/(?:^|\D)\d{1,4}\s*\/\s*(\d{1,4})(?:\D|$)/g))
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 2000)
  if (counterMatches.length > 0) return Math.min(...counterMatches)

  const limitPatterns = [
    /(?:max|max\.|maximum|limit|under|within|up to|no more than)\D{0,24}(\d{1,4})\D{0,16}(?:characters|character|chars|char)\b/i,
    /(\d{1,4})\D{0,16}(?:characters|character|chars|char)\D{0,24}(?:max|max\.|maximum|limit|allowed)\b/i,
    /(?:must be|should be|has to be|needs to be)\D{0,24}(\d{1,4})\D{0,16}(?:or fewer|or less|max|maximum)\D{0,16}(?:characters|character|chars|char)\b/i,
    /(\d{1,4})\D{0,16}(?:or fewer|or less)\D{0,16}(?:characters|character|chars|char)\b/i,
    /(?:characters|character|chars|char)\D{0,16}(?:must be|should be|has to be|needs to be|limit)\D{0,24}(\d{1,4})\D{0,16}(?:or fewer|or less|max|maximum)\b/i
  ]

  for (const pattern of limitPatterns) {
    const match = text.match(pattern)
    const value = Number(match?.[1])
    if (value > 0 && value <= 2000) return value
  }

  return undefined
}

function shortenToLimit(value: string, maxLength: number) {
  if (value.length <= maxLength) return value

  const separatorCandidate = value.split(/\s[-|:]\s/)[0]?.trim()
  if (separatorCandidate && separatorCandidate.length <= maxLength) return separatorCandidate

  if (maxLength <= 3) return value.slice(0, maxLength)

  const sliced = value.slice(0, maxLength - 3).trim()
  const wordBoundary = sliced.replace(/\s+\S*$/, '').trim()
  const base = wordBoundary.length >= Math.floor(maxLength * 0.55) ? wordBoundary : sliced
  return `${base}...`.slice(0, maxLength)
}

function isExactValue(value: string) {
  return /^https?:\/\//i.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function shortProductName(profile: ProductProfile) {
  const productName = profile?.productName?.trim() || ''
  const websiteName = profile?.websiteUrl
    ?.replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    ?.split('.')[0]
    ?.replace(/[-_]+/g, ' ')
    .trim()

  return [
    productName.split(/\s[-|:]\s/)[0]?.trim(),
    productName.replace(/\b(free|online|generator|tool|app)\b/gi, '').replace(/\s+/g, ' ').trim(),
    websiteName
  ].filter(Boolean)
}

function adaptValueToFieldLimit(value: string, field: any, profile: ProductProfile) {
  const maxLength = getFieldMaxLength(field)
  if (!maxLength || value.length <= maxLength || isExactValue(value)) return value

  const fieldText = normalizeText(fieldContextText(field))
  const candidates: string[] = []

  if (/\b(name|startup name|tool name|product name|app name)\b/.test(fieldText)) {
    candidates.push(...shortProductName(profile))
  }

  if (/\b(tagline|short description|one sentence|summary|brief)\b/.test(fieldText)) {
    candidates.push(
      profile.shortDescription,
      `${shortProductName(profile)[0] || profile.productName} creates AI images online.`,
      'Free AI image generator powered by GPT Image 2.'
    )
  }

  const fittingCandidate = candidates
    .map((candidate) => candidate?.trim())
    .find((candidate) => candidate && candidate.length <= maxLength)

  return fittingCandidate || shortenToLimit(value, maxLength)
}

function enforceFieldLengthLimits(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
) {
  const fieldById = new Map(formFields.map((field) => [field.id, field]))

  return mappings.map((mapping) => {
    if (typeof mapping.value !== 'string') return mapping

    const field = fieldById.get(mapping.fieldId)
    if (!field) return mapping

    const adaptedValue = adaptValueToFieldLimit(mapping.value, field, productProfile)
    if (adaptedValue === mapping.value) return mapping

    return {
      ...mapping,
      value: adaptedValue,
      source: 'adapted' as const,
      reason: `${mapping.reason || ''} Shortened to fit the field character limit.`.trim()
    }
  })
}

function isEmailField(field: any) {
  return /\b(email|e-mail|mail)\b/i.test(fieldContextText(field))
}

function isFormalEmailField(field: any) {
  const text = fieldContextText(field).toLowerCase()
  return (
    /(company|business|work|official|corporate|professional).{0,32}(email|e-mail|mail)/i.test(text) ||
    /(email|e-mail|mail).{0,32}(company|business|work|official|corporate|professional)/i.test(text) ||
    /(gmail|free email|personal email|public email|generic email).{0,60}(not allowed|not accepted|invalid|blocked|rejected|cannot|can't|must not|do not)/i.test(text) ||
    /(not allowed|not accepted|invalid|blocked|rejected|cannot|can't|must not|do not).{0,60}(gmail|free email|personal email|public email|generic email)/i.test(text)
  )
}

function isPublicEmail(value: unknown) {
  return /@(gmail|yahoo|hotmail|outlook|icloud|aol|protonmail|qq|163|126)\./i.test(String(value ?? ''))
}

function buildEmailFallbackData(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
) {
  const companyEmail = productProfile?.companyEmail?.trim()
  const contactEmail = productProfile?.contactEmail?.trim()
  if (!companyEmail || !contactEmail || companyEmail === contactEmail) return {}

  const fieldById = new Map(formFields.map((field) => [field.id, field]))

  return mappings.reduce<Record<string, string>>((result, mapping) => {
    const field = fieldById.get(mapping.fieldId)
    const value = String(mapping.value ?? '').trim()

    if (
      field &&
      isEmailField(field) &&
      value &&
      value !== companyEmail &&
      (value === contactEmail || isPublicEmail(value) || isFormalEmailField(field))
    ) {
      result[mapping.fieldId] = companyEmail
    }

    return result
  }, {})
}

function cleanAssetUrls(urls: Array<string | undefined>) {
  return urls.map((url) => url?.trim()).filter((url): url is string => Boolean(url))
}

function chooseAssetUrlsForFileField(field: any, productProfile: ProductProfile) {
  if (field?.type !== 'file') return []

  const text = normalizeText(fieldContextText(field))
  const logoUrl = productProfile.logoImageUrl || productProfile.logoUrl
  const screenshotUrl = productProfile.screenshotImageUrl
  const promoUrl = productProfile.promoImageUrl
  const bannerUrl = productProfile.bannerImageUrl

  if (/\b(logo|icon|avatar|app icon|brand mark)\b/.test(text)) {
    return cleanAssetUrls([logoUrl])
  }

  if (/\b(screenshot|screen shot|website shot|site image|website image|screen capture)\b/.test(text)) {
    return field.multiple
      ? cleanAssetUrls([screenshotUrl, promoUrl, bannerUrl])
      : cleanAssetUrls([screenshotUrl, promoUrl, bannerUrl]).slice(0, 1)
  }

  if (/\b(banner|cover|hero|header|landscape|wide image|wide)\b/.test(text)) {
    return cleanAssetUrls([bannerUrl, promoUrl, screenshotUrl]).slice(0, 1)
  }

  if (/\b(product image|promo|promotional|gallery|media|thumbnail|image|picture|photo)\b/.test(text)) {
    return field.multiple
      ? cleanAssetUrls([screenshotUrl, promoUrl, bannerUrl])
      : cleanAssetUrls([promoUrl, screenshotUrl, bannerUrl]).slice(0, 1)
  }

  if (/\b(image|jpg|jpeg|png|webp)\b/.test(text)) {
    return cleanAssetUrls([promoUrl, screenshotUrl, bannerUrl, logoUrl]).slice(0, 1)
  }

  return []
}

function buildAssetMappings(formFields: any[], productProfile: ProductProfile, usedFieldIds: Set<string>) {
  return formFields.reduce<FillMapping[]>((result, field) => {
    if (usedFieldIds.has(field.id)) return result

    const assetUrls = chooseAssetUrlsForFileField(field, productProfile)
    if (assetUrls.length === 0) return result

    result.push({
      fieldId: field.id,
      value: { assetUrls },
      source: 'asset',
      confidence: 0.9,
      reason: 'Matched file upload field to saved product images.'
    })

    return result
  }, [])
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function optionScore(optionLabel: string, profileText: string) {
  const option = normalizeText(optionLabel)
  const profile = normalizeText(profileText)
  if (!option || !profile) return 0

  const optionWords = option.split(' ').filter((word) => word.length > 2)
  const profileWords = new Set(profile.split(' ').filter((word) => word.length > 2))
  let score = 0

  for (const word of optionWords) {
    if (profileWords.has(word)) score += 12
  }

  if (profile.includes('image') || profile.includes('art') || profile.includes('visual') || profile.includes('design')) {
    if (option.includes('visual') || option.includes('art') || option.includes('design') || option.includes('graphic')) {
      score += 45
    }
  }

  if (profile.includes('ai') || profile.includes('gpt') || profile.includes('generator')) {
    if (option.includes('technology') || option.includes('internet') || option.includes('software') || option.includes('computer')) {
      score += 25
    }
  }

  if (profile.includes('marketing') || profile.includes('social media')) {
    if (option.includes('marketing') || option.includes('business') || option.includes('media')) {
      score += 20
    }
  }

  return score
}

function trimOptionsForAi(formFields: any[], productProfile: ProductProfile) {
  const profileText = Object.values(productProfile || {}).join('\n')

  return formFields.map((field) => {
    if (!Array.isArray(field.options) || field.options.length <= 80) {
      return field
    }

    const scoredOptions = field.options
      .map((option: any) => ({
        ...option,
        score: optionScore(`${option.label} ${option.value}`, profileText)
      }))
      .sort((a: any, b: any) => b.score - a.score)

    const topOptions = scoredOptions.slice(0, 60)
    const firstOptions = field.options.slice(0, 20)
    const optionMap = new Map<string, any>()

    for (const option of [...topOptions, ...firstOptions]) {
      const key = `${option.label}::${option.value}`
      optionMap.set(key, {
        label: option.label,
        value: option.value
      })
    }

    return {
      ...field,
      options: Array.from(optionMap.values()),
      optionCount: field.options.length,
      optionsTrimmedForAi: true
    }
  })
}

/**
 * Handle form filling based on the user's saved product profile.
 */
export async function handleUrlBasedFill(data: FillData) {
  const { formFields, pageContext } = data

  console.log('[ProfileFill] Starting product-profile fill', { formFields })

  let settings: any = null
  try {
    settings = await getSettings()
  } catch (e) {
    console.error('[ProfileFill] Failed to parse settings', e)
    return { success: false, error: 'Failed to load settings' }
  }

  if (!settings?.apiKey) {
    return { success: false, error: 'API Key not configured. Please configure it in Settings.' }
  }

  const productProfile = withDefaultAssetProfile(data.productProfile || settings.productProfile)
  const compactProductProfile = compactProfile(productProfile)
  const formFieldsForAi = trimOptionsForAi(formFields, productProfile)

  if (!compactProductProfile.productName && !compactProductProfile.websiteUrl) {
    return { success: false, error: '请先在设置页填写推广资料，至少需要产品名称和官网 URL。' }
  }

  chatAPI.setApiKey(settings.apiKey)
  if (settings.apiBaseURL) chatAPI.setBaseURL(settings.apiBaseURL)

  const systemPrompt = `You map web form fields to a user's saved product profile.

CRITICAL RULES:
1. Use ONLY the provided Product Profile. Do not invent a product, URL, email, company, person, policy link, or social link.
2. If the needed value is missing from Product Profile, return an empty string for that field.
3. Understand semantic variants: Website, Product URL, Your product link, Tool link, Homepage, App website, and Official URL can all mean websiteUrl.
4. Use extraInfo for uncommon fields such as pricing, launch date, founder, product hunt URL, chrome extension URL, demo video, target audience, use cases, address, coupon, affiliate program, and alternatives.
5. Email priority: for generic Email, Your Email, Contact Email, Submitter Email, or Account Email fields, use defaultSubmissionEmail/contactEmail. Use formalCompanyEmail/companyEmail ONLY when the field label, placeholder, context, helper text, validation hint, or nearby copy asks for company email, business email, work email, official email, corporate email, professional email, or says Gmail/free/personal/public email is not allowed.
6. Your Name, Submitter Name, Contact Name, First Name, and Last Name should use contactFullName, contactFirstName, or contactLastName when provided.
7. If a field includes an options array, choose the closest option label/value from that array. Do not create a new category outside the provided options.
8. Respect field character limits. If a field has maxLength, a visible counter such as 0/30 or 0/60, or an error such as "Name must be 32 or fewer characters long", the returned value MUST be at or below that limit.
9. Locked fields must be copied exactly and never rewritten, except when a text field has a hard character limit; then return the shortest truthful version, such as the brand/product short name.
10. Text fields such as startup name, tool name, tagline, short description, and long description may be lightly adapted to fit the field label and character limit, but must remain truthful to Product Profile.
11. Output ONLY valid JSON, with no markdown.

Expected JSON:
{
  "fields": [
    {
      "fieldId": "field_0",
      "value": "value to fill",
      "source": "websiteUrl",
      "confidence": 0.95,
      "reason": "brief reason"
    }
  ]
}`

  const userPrompt = `Product Profile:
${JSON.stringify(compactProductProfile, null, 2)}

Current Page:
- Title: ${pageContext.title}
- URL: ${pageContext.url}

Form Fields:
${JSON.stringify(formFieldsForAi, null, 2)}

Return mappings for fields that can be confidently filled. Use field.id as fieldId. For category/select fields, choose one of the provided options and return its label or value. Leave unknown fields empty.`

  try {
    console.log('[ProfileFill] Calling LLM to map product profile to fields...')
    const rawResponse = await chatAPI.sendMessage([
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: new Date() },
      { id: 'usr', role: 'user', content: userPrompt, timestamp: new Date() }
    ], {
      model: settings.model || 'gpt-3.5-turbo',
      temperature: 0.1,
      enableWebSearch: false
    })

    const parsed = extractJsonObject(rawResponse)
    const textMappings = enforceFieldLengthLimits(normalizeMappings(parsed), formFieldsForAi, productProfile)
    const assetMappings = buildAssetMappings(
      formFieldsForAi,
      productProfile,
      new Set(textMappings.map((mapping) => mapping.fieldId))
    )
    const mappings = [...textMappings, ...assetMappings]
    const filledData = mappingsToFilledData(mappings)
    const fallbackData = buildEmailFallbackData(mappings, formFieldsForAi, productProfile)

    if (Object.keys(filledData).length === 0) {
      return { success: false, error: 'AI 没有找到可以安全填入的字段。请检查推广资料是否完整。' }
    }

    return {
      success: true,
      filledData,
      fallbackData,
      mappings
    }
  } catch (error: any) {
    console.error('[ProfileFill] Error:', error)
    return {
      success: false,
      error: error.message?.includes('JSON') ? 'Failed to parse AI response' : 'Failed to generate form data',
      details: error.message
    }
  }
}

export async function handleRegenerateField(data: RegenerateFieldData) {
  let settings: any = null
  try {
    settings = await getSettings()
  } catch (e) {
    console.error('[FieldRegenerate] Failed to parse settings', e)
    return { success: false, error: 'Failed to load settings' }
  }

  if (!settings?.apiKey) {
    return { success: false, error: 'API Key not configured. Please configure it in Settings.' }
  }

  const productProfile = data.productProfile || settings.productProfile
  const compactProductProfile = compactProfile(productProfile)

  chatAPI.setApiKey(settings.apiKey)
  if (settings.apiBaseURL) chatAPI.setBaseURL(settings.apiBaseURL)

  const systemPrompt = `You revise one filled form field using ONLY the Product Profile.

Rules:
1. Never invent products, URLs, emails, people, policy links, or company names.
2. For URL, email, product name, company name, privacy policy, and terms fields, copy the best profile value exactly.
3. Use extraInfo for uncommon fields such as pricing, launch date, founder, product hunt URL, chrome extension URL, demo video, target audience, use cases, coupon, affiliate program, and alternatives.
4. If the target field includes an options array, choose the closest option label/value from that array.
5. If the target field has maxLength, a visible counter such as 0/30 or 0/60, or an error such as "Name must be 32 or fewer characters long", the returned value MUST be at or below that character limit.
6. For descriptive text fields, you may rewrite or shorten while staying truthful.
7. If no safe value exists, return an empty string.
8. Output ONLY valid JSON: {"value":"...", "source":"profileField", "confidence":0.9}`

  const userPrompt = `Action: ${data.action}

Product Profile:
${JSON.stringify(compactProductProfile, null, 2)}

Target Field:
${JSON.stringify(data.field, null, 2)}

Current Value:
${data.currentValue}

Return the best replacement for this one field.`

  try {
    const rawResponse = await chatAPI.sendMessage([
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: new Date() },
      { id: 'usr', role: 'user', content: userPrompt, timestamp: new Date() }
    ], {
      model: settings.model || 'gpt-3.5-turbo',
      temperature: data.action === 'rewrite' ? 0.4 : 0.1,
      enableWebSearch: false
    })

    const parsed = extractJsonObject(rawResponse)
    return {
      success: true,
      value: parsed.value ?? '',
      source: parsed.source,
      confidence: parsed.confidence
    }
  } catch (error: any) {
    console.error('[FieldRegenerate] Error:', error)
    return { success: false, error: error.message || 'Failed to regenerate field' }
  }
}

export async function handleAddExtraInfo(data: AddExtraInfoData) {
  const storageData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
  const rawSettings = storageData[STORAGE_KEYS.SETTINGS]

  if (!rawSettings) {
    return { success: false, error: 'Settings not found' }
  }

  const parsed = JSON.parse(rawSettings)
  const state = parsed.state || parsed
  const productProfile: ProductProfile = {
    ...(state.productProfile || {}),
    extraInfo: state.productProfile?.extraInfo || ''
  }

  const label = data.field?.label || data.field?.placeholder || data.field?.name || data.field?.id || 'Unknown field'
  const value = String(data.value || '').trim()

  if (!value) {
    return { success: false, error: '请先在这个字段里填写内容，再点 + 保存。' }
  }

  const learnedLine = `${label}: ${value}`
  const currentExtraInfo = productProfile.extraInfo || ''

  if (!currentExtraInfo.includes(learnedLine)) {
    productProfile.extraInfo = [currentExtraInfo.trim(), learnedLine].filter(Boolean).join('\n')
  }

  const nextState = {
    ...state,
    productProfile
  }

  const nextSettings = parsed.state
    ? {
        ...parsed,
        state: nextState
      }
    : nextState

  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: JSON.stringify(nextSettings)
  })

  return {
    success: true,
    added: learnedLine
  }
}
