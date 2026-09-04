import { chatAPI } from '../services/api'
import { STORAGE_KEYS } from '../config/constants'
import type { ProductProfile } from '../types'
import { parseImageUploadConstraints } from '../utils/imageUploadConstraints'

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
  requestId?: string
  forceFill?: boolean
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

const activeFillRequests = new Map<string, AbortController>()
const cancelledFillRequests = new Set<string>()
const CREDENTIAL_IDENTITY_PATTERN = /(?:password|passcode|passphrase|api[\s_-]*key|access[\s_-]*token|auth(?:entication|orization)?[\s_-]*(?:token|code|secret)|bearer[\s_-]*token|client[\s_-]*secret|login[\s_-]*(?:secret|credential)|private[\s_-]*key|密码|口令|访问令牌|密钥|私钥)/i
const CREDENTIAL_LINE_PATTERN = /^\s*(?:password|passcode|passphrase|api[\s_-]*key|access[\s_-]*token|auth(?:entication|orization)?[\s_-]*(?:token|code|secret)|bearer[\s_-]*token|client[\s_-]*secret|login[\s_-]*(?:secret|credential)|private[\s_-]*key|密码|口令|访问令牌|密钥|私钥)(?:\s*[:：=-]|\s+)/i
const CREDENTIAL_VALUE_PATTERN = /^(?:sk-[a-z0-9_-]{12,}|gh[opusr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{12,}|ya29\.[a-z0-9_-]{12,}|bearer\s+[a-z0-9._~+/=-]{12,})$/i

function isCredentialIdentity(...values: unknown[]) {
  return CREDENTIAL_IDENTITY_PATTERN.test(values.map((value) => String(value || '')).join(' '))
}

function isCredentialField(field: any) {
  return String(field?.type || '').toLowerCase() === 'password' || isCredentialIdentity(
    field?.label,
    field?.name,
    field?.id,
    field?.placeholder,
    field?.autocomplete,
    field?.context
  )
}

function looksLikeCredentialValue(value: unknown) {
  return CREDENTIAL_VALUE_PATTERN.test(String(value || '').trim())
}

function sanitizeExtraInfo(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !CREDENTIAL_LINE_PATTERN.test(line))
    .join('\n')
    .trim()
}

export function cancelUrlBasedFill(requestId: string) {
  const controller = activeFillRequests.get(requestId)
  if (!controller) {
    cancelledFillRequests.add(requestId)
    setTimeout(() => cancelledFillRequests.delete(requestId), 60_000)
    return false
  }

  controller.abort()
  activeFillRequests.delete(requestId)
  return true
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
  const {
    customFields = [],
    fieldDescriptions = {},
    ...standardFields
  } = profile || {}
  const compacted: Record<string, unknown> = Object.fromEntries(
    Object.entries(standardFields).flatMap(([key, value]) => {
      if (isCredentialIdentity(key)) return []
      const sanitizedValue = key === 'extraInfo' ? sanitizeExtraInfo(value) : value
      return String(sanitizedValue || '').trim().length > 0 ? [[key, sanitizedValue]] : []
    })
  )

  const describedCustomFields = customFields
    .filter((field) => (
      field?.label?.trim() &&
      field?.value?.trim() &&
      !isCredentialIdentity(field?.id, field?.label, field?.description) &&
      !looksLikeCredentialValue(field?.value)
    ))
    .map((field) => ({
      label: field.label.trim(),
      value: field.value.trim(),
      ...(field.description?.trim() ? { description: field.description.trim() } : {})
    }))
  if (describedCustomFields.length > 0) {
    compacted.customFields = describedCustomFields
  }

  const applicableGuidance = Object.fromEntries(
    Object.entries(fieldDescriptions)
      .filter(([key, description]) => (
        typeof description === 'string'
        && description.trim()
        && typeof profile?.[key as keyof ProductProfile] === 'string'
        && String(profile[key as keyof ProductProfile]).trim()
      ))
      .map(([key, description]) => [key, description.trim()])
  )
  if (Object.keys(applicableGuidance).length > 0) {
    compacted.fieldGuidance = applicableGuidance
  }

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

  const companyPhone = getCompanyPhone(profile)
  if (companyPhone) {
    compacted.companyPhone = companyPhone
    compacted.defaultCompanyPhone = companyPhone
  }

  return compacted
}

function withDefaultAssetProfile(profile: ProductProfile): ProductProfile {
  return {
    ...profile,
    galleryImageUrls: Array.isArray(profile?.galleryImageUrls)
      ? profile.galleryImageUrls
      : []
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

const AI_SOURCE_ALIASES: Record<string, keyof ProductProfile> = {
  defaultsubmissionemail: 'contactEmail',
  formalcompanyemail: 'companyEmail',
  defaultcompanyphone: 'companyPhone'
}

function isProfileStringKey(
  profile: ProductProfile,
  key: unknown
): key is keyof ProductProfile {
  return typeof key === 'string'
    && key !== 'lockedFields'
    && Object.prototype.hasOwnProperty.call(profile, key)
    && typeof profile[key as keyof ProductProfile] === 'string'
}

function resolveProfileStringKey(
  profile: ProductProfile,
  rawKey: unknown,
  allowAliases = false
): keyof ProductProfile | null {
  const source = String(rawKey || '').trim()
  if (!source) return null

  const normalizedSource = source.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const aliasedKey = allowAliases ? AI_SOURCE_ALIASES[normalizedSource] : undefined
  if (aliasedKey && isProfileStringKey(profile, aliasedKey)) return aliasedKey

  const directKey = Object.keys(profile).find((key) => (
    key.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalizedSource
  ))
  if (isProfileStringKey(profile, directKey)) return directKey
  if (normalizedSource === 'customfields' && Array.isArray(profile.customFields)) return 'customFields'
  return null
}

function normalizeAiMappingSource(source: unknown, profile: ProductProfile): FillMapping['source'] {
  return resolveProfileStringKey(profile, source, true) || 'unknown'
}

function isTraceableProfileSource(
  profile: ProductProfile,
  source: FillMapping['source']
): source is keyof ProductProfile {
  return source === 'customFields' || isProfileStringKey(profile, source)
}

const EXACT_PROFILE_KEYS = new Set<keyof ProductProfile>([
  'productName',
  'websiteUrl',
  'logoUrl',
  'companyName',
  'companyWebsite',
  'companyPhone',
  'contactEmail',
  'companyEmail',
  'contactFirstName',
  'contactLastName',
  'privacyPolicyUrl',
  'termsUrl',
  'twitterUrl',
  'linkedinUrl',
  'githubUrl'
])
const DESCRIPTIVE_PROFILE_KEYS = new Set<keyof ProductProfile>([
  'shortDescription',
  'longDescription'
])

function normalizedComparableValue(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function isScalarMappingValue(value: unknown): value is string | boolean {
  return typeof value === 'string' || typeof value === 'boolean'
}

function isHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false
  try {
    const url = new URL(value.trim())
    return Boolean(url.hostname && url.hostname.includes('.'))
  } catch {
    return false
  }
}

function urlHostnameMatches(value: unknown, pattern: RegExp) {
  if (!isHttpUrl(value)) return false
  try {
    return pattern.test(new URL(String(value).trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

function customEvidenceLabelMatchesField(
  value: unknown,
  fieldText: string,
  profile: ProductProfile
) {
  const candidate = normalizedComparableValue(value)
  if (!candidate) return false

  return (profile.customFields || []).some((field) => {
    if (normalizedComparableValue(field?.value) !== candidate) return false
    const label = normalizeText(field?.label || '')
    const words = label.split(' ').filter((word) => word.length >= 3)
    return Boolean(label && (
      fieldText.includes(label) ||
      (words.length >= 1 && words.every((word) => fieldText.includes(word)))
    ))
  }) || sanitizeExtraInfo(profile.extraInfo).split(/\r?\n/).some((line) => {
    const match = line.match(/^\s*([^:：]{2,80})\s*[:：]\s*(.+?)\s*$/)
    if (!match || normalizedComparableValue(match[2]) !== candidate) return false
    const label = normalizeText(match[1])
    const words = label.split(' ').filter((word) => word.length >= 3)
    return Boolean(label && (
      fieldText.includes(label) ||
      (words.length >= 1 && words.every((word) => fieldText.includes(word)))
    ))
  })
}

function mappingSourceMatchesField(
  value: unknown,
  source: keyof ProductProfile,
  field: any,
  profile: ProductProfile
) {
  if (!isScalarMappingValue(value)) return false
  const text = directFieldIdentityText(field)
  const type = String(field?.type || '').toLowerCase()

  if (/\bgithub\b/.test(text)) {
    return source === 'githubUrl' && urlHostnameMatches(value, /(^|\.)github\.com$/)
  }
  if (/\b(twitter|x handle|x url|twitter url)\b/.test(text)) {
    return source === 'twitterUrl' && urlHostnameMatches(value, /(^|\.)(?:x|twitter)\.com$/)
  }
  if (/\blinkedin\b/.test(text)) {
    return source === 'linkedinUrl' && urlHostnameMatches(value, /(^|\.)linkedin\.com$/)
  }
  if (/\bprivacy(?: policy)?\b/.test(text)) return source === 'privacyPolicyUrl' && isHttpUrl(value)
  if (/\bterms?(?: of (?:use|service))?\b/.test(text)) return source === 'termsUrl' && isHttpUrl(value)

  if (/\b(discount|coupon|promo(?:tional)? code|voucher|affiliate code)\b/.test(text)) {
    return (source === 'customFields' || source === 'extraInfo') &&
      customEvidenceLabelMatchesField(value, text, profile)
  }

  // Usernames are derived locally by forcedValueForField. Reject AI-created
  // account identifiers so a person's display name is not written verbatim.
  if (/\b(user[\s_-]*name|login[\s_-]*name|account[\s_-]*(?:name|id))\b/.test(text)) return false

  if (type === 'url') {
    return isHttpUrl(value) && !/^\s*(?:0+|\[object object\])\s*$/i.test(String(value))
  }

  return true
}

function exactProfileValueForSource(profile: ProductProfile, source: keyof ProductProfile) {
  if (source === 'companyPhone') return getCompanyPhone(profile)
  const value = profile[source]
  return typeof value === 'string' ? value.trim() : ''
}

function splitEvidenceItems(value: string) {
  return value
    .split(/[,;|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function nonCredentialCustomFieldValues(profile: ProductProfile) {
  return (profile.customFields || []).flatMap((field) => {
    const value = field?.value?.trim() || ''
    return value &&
      !isCredentialIdentity(field?.id, field?.label, field?.description) &&
      !looksLikeCredentialValue(value)
      ? [value]
      : []
  })
}

function nonCredentialExtraInfoValues(profile: ProductProfile) {
  return sanitizeExtraInfo(profile.extraInfo).split(/\r?\n/).flatMap((line) => {
    const compacted = line.trim()
    if (!compacted || CREDENTIAL_LINE_PATTERN.test(compacted)) return []
    const match = compacted.match(/^\s*[^:：]{2,80}\s*[:：]\s*(.+?)\s*$/)
    return [match?.[1]?.trim() || compacted].filter(Boolean)
  })
}

function evidenceValuesForSource(profile: ProductProfile, source: keyof ProductProfile) {
  if (source === 'customFields') return nonCredentialCustomFieldValues(profile)
  if (source === 'extraInfo') return nonCredentialExtraInfoValues(profile)
  const value = exactProfileValueForSource(profile, source)
  return value ? [value] : []
}

function exactEvidenceValue(candidate: unknown, evidenceValues: string[]) {
  const normalizedCandidate = normalizedComparableValue(candidate)
  if (!normalizedCandidate) return ''
  return evidenceValues.find((evidence) => (
    normalizedComparableValue(evidence) === normalizedCandidate
  )) || ''
}

function checkboxOptionText(field: any) {
  return String(
    field?.optionLabel ||
    field?.label ||
    field?.value ||
    field?.name ||
    field?.id ||
    ''
  ).trim()
}

function checkboxTrueHasEvidence(field: any, source: keyof ProductProfile, profile: ProductProfile) {
  const option = normalizeText(checkboxOptionText(field))
  if (!option) return false

  const optionWords = option.split(' ').filter((word) => word.length >= 2)
  return evidenceValuesForSource(profile, source).some((evidence) => (
    splitEvidenceItems(evidence).some((item) => {
      const normalizedItem = normalizeText(item)
      if (!normalizedItem) return false
      if (normalizedItem === option) return true
      // Checkbox labels sometimes include a group prefix such as
      // "Supported Platforms Web". Require the saved enum item to appear as
      // a complete phrase, never as an arbitrary substring/token guess.
      const escapedItem = normalizedItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(?:^| )${escapedItem}(?: |$)`).test(option)) return true
      const itemWords = normalizedItem.split(' ').filter((word) => word.length >= 2)
      return itemWords.length > 0 && itemWords.length === optionWords.length &&
        itemWords.every((word, index) => word === optionWords[index])
    })
  ))
}

function isTruthfulDescriptionAdaptation(value: string, sourceValue: string, profile: ProductProfile) {
  const candidate = normalizeText(value)
  const source = normalizeText(sourceValue)
  if (!candidate || !source) return false
  if (candidate === source || source.includes(candidate)) return true

  const candidateWords = candidate.split(' ').filter((word) => word.length >= 3)
  if (candidateWords.length < 3) return false
  const evidence = new Set(normalizeText([
    profile.productName,
    profile.shortDescription,
    profile.longDescription,
    profile.category,
    profile.keywords,
    profile.tags,
    sanitizeExtraInfo(profile.extraInfo)
  ].filter(Boolean).join(' ')).split(' ').filter((word) => word.length >= 3))
  const supportedWords = candidateWords.filter((word) => evidence.has(word)).length
  return supportedWords / candidateWords.length >= 0.7
}

function validateAiMappingValue(
  value: unknown,
  source: keyof ProductProfile,
  field: any,
  profile: ProductProfile
) {
  if (isCredentialField(field) || looksLikeCredentialValue(value)) return null
  if (!isScalarMappingValue(value) || typeof value !== 'string') return null
  if (!mappingSourceMatchesField(value, source, field, profile)) return null
  const evidenceValues = evidenceValuesForSource(profile, source)
  if (evidenceValues.length === 0) return null
  const sourceValue = evidenceValues[0]

  const candidate = value.trim()
  if (!candidate) return null

  if (EXACT_PROFILE_KEYS.has(source)) {
    return normalizedComparableValue(candidate) === normalizedComparableValue(sourceValue)
      ? sourceValue
      : null
  }

  if (DESCRIPTIVE_PROFILE_KEYS.has(source)) {
    return isTruthfulDescriptionAdaptation(candidate, sourceValue, profile) ? candidate : null
  }


  if (source === 'customFields' || source === 'extraInfo') {
    return exactEvidenceValue(candidate, evidenceValues) || null
  }

  // Categories, tags, keywords, extraInfo and other saved strings must remain
  // verbatim at this trust boundary. Option matching may convert them to a
  // site's provided label after this check.
  return normalizedComparableValue(candidate) === normalizedComparableValue(sourceValue)
    ? sourceValue
    : null
}

function validatedMappingFromAi(
  rawMapping: any,
  field: any,
  productProfile: ProductProfile
): FillMapping | null {
  if (!field?.id || isCredentialField(field)) return null
  const source = normalizeAiMappingSource(rawMapping?.source, productProfile)
  if (!isTraceableProfileSource(productProfile, source)) return null

  let value: string | boolean = rawMapping?.value
  const type = String(field?.type || '').toLowerCase()
  if (type === 'checkbox') {
    if (typeof value === 'string') {
      const normalizedValue = normalizeText(value)
      if (/^(true|yes|1|on|agree|accepted)$/.test(normalizedValue)) value = true
      else if (/^(false|no|0|off|decline|declined)$/.test(normalizedValue)) value = false
      else return null
    }
    if (
      typeof value !== 'boolean' ||
      (value && (
        isUnsafeClaimOrOptInCheckbox(field) ||
        !checkboxTrueHasEvidence(field, source, productProfile)
      ))
    ) return null
  } else {
    const validatedValue = validateAiMappingValue(value, source, field, productProfile)
    if (validatedValue === null) return null
    value = validatedValue
  }

  if (Array.isArray(field?.options) && field.options.length > 0 && typeof value === 'string') {
    const best = findBestProfileOption(field.options, value)
    if (!best) return null
    value = best.label
  }

  const mapping: FillMapping = {
    fieldId: String(field.id),
    value,
    source,
    confidence: Number.isFinite(Number(rawMapping?.confidence)) ? Number(rawMapping.confidence) : 0.6,
    ...(typeof rawMapping?.reason === 'string' ? { reason: rawMapping.reason } : {})
  }
  return enforceFieldLengthLimits([mapping], [field], productProfile)[0] || null
}

function normalizeMappings(
  parsed: any,
  formFields: any[] = [],
  productProfile?: ProductProfile
): FillMapping[] {
  const allowedFieldIds = new Set(formFields.map((field) => String(field?.id || '')).filter(Boolean))
  const fieldById = new Map(formFields.map((field) => [String(field?.id || ''), field]))
  const seen = new Set<string>()
  const normalize = (items: any[]): FillMapping[] => items.flatMap((item: any) => {
    const fieldId = String(item?.fieldId || '')
    if (!fieldId || seen.has(fieldId) || (allowedFieldIds.size > 0 && !allowedFieldIds.has(fieldId))) return []

    const field = fieldById.get(fieldId)
    if (String(field?.value || '').trim() || isCredentialField(field)) return []

    let value = item.value
    let validatedSource: FillMapping['source'] = 'unknown'
    const type = String(field?.type || '').toLowerCase()
    if (type === 'checkbox') {
      if (typeof value === 'string') {
        const normalizedValue = normalizeText(value)
        if (/^(true|yes|1|on|agree|accepted)$/.test(normalizedValue)) value = true
        else if (/^(false|no|0|off|decline|declined)$/.test(normalizedValue)) value = false
        else return []
      } else if (typeof value !== 'boolean') {
        return []
      }

      // Optional marketing, paid-upgrade and ownership claims are never safe
      // to opt into from an AI guess. Required submission agreements are added
      // separately by buildSubmissionAgreementMappings after a strict semantic
      // check, so dropping these mappings cannot block a legitimate consent.
      if (value) {
        if (!productProfile) return []
        const source = normalizeAiMappingSource(item?.source, productProfile)
        if (
          !isTraceableProfileSource(productProfile, source) ||
          isUnsafeClaimOrOptInCheckbox(field) ||
          !checkboxTrueHasEvidence(field, source, productProfile)
        ) return []
        validatedSource = source
      } else {
        // False is a safe local opt-out. It is intentionally not attributed to
        // a product-profile fact when the model omitted a traceable source.
        const source = productProfile
          ? normalizeAiMappingSource(item?.source, productProfile)
          : 'unknown'
        validatedSource = productProfile && isTraceableProfileSource(productProfile, source)
          ? source
          : 'adapted'
      }
    } else {
      if (!productProfile) return []
      const source = normalizeAiMappingSource(item?.source, productProfile)
      if (!isTraceableProfileSource(productProfile, source)) return []
      const validatedValue = validateAiMappingValue(value, source, field, productProfile)
      if (validatedValue === null) return []
      value = validatedValue
      validatedSource = source
    }

    if (Array.isArray(field?.options) && field.options.length > 0 && typeof value === 'string') {
      const best = findBestProfileOption(field.options, value)
      if (!best) return []
      value = best.label
    }

    seen.add(fieldId)
    return [{
      ...item,
      fieldId,
      value,
      source: validatedSource,
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.6
    } as FillMapping]
  })

  if (Array.isArray(parsed?.fields)) {
    return normalize(parsed.fields.filter((item: any) => item?.fieldId && item.value !== undefined))
  }

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return normalize(Object.entries(parsed).map(([fieldId, value]) => ({
      fieldId,
      value: value as string | boolean,
      source: 'unknown' as const,
      confidence: 0.6
    })))
  }

  return []
}

function findBestProfileOption(options: Array<{ label: string; value: string }>, desiredValue: string) {
  const desired = normalizeText(desiredValue)
  if (!desired) return null

  const ranked = options
    .map((option) => {
      const label = normalizeText(option.label || option.value || '')
      const value = normalizeText(option.value || '')
      if (!label && !value) return { option, score: 0 }
      if (desired === label || desired === value) return { option, score: 100 }

      const desiredWords = new Set(desired.split(' ').filter((word) => word.length >= 3))
      const optionWords = new Set(`${label} ${value}`.split(' ').filter((word) => word.length >= 3))
      const overlap = [...optionWords].filter((word) => desiredWords.has(word)).length
      const denominator = Math.max(1, Math.min(desiredWords.size, optionWords.size))
      const coverage = overlap / denominator
      return { option, score: coverage >= 0.67 ? 50 + coverage * 30 : 0 }
    })
    .sort((left, right) => right.score - left.score)

  if (!ranked[0] || ranked[0].score < 70) return null
  if (ranked[1] && ranked[0].score < 100 && ranked[0].score - ranked[1].score < 8) return null
  return ranked[0].option
}

function mappingsToFilledData(mappings: FillMapping[]) {
  return mappings.reduce<Record<string, string | boolean | AssetFillValue>>((result, mapping) => {
    const isAssetValue = Boolean(
      mapping.source === 'asset' &&
      mapping.value &&
      typeof mapping.value === 'object' &&
      Array.isArray((mapping.value as AssetFillValue).assetUrls)
    )
    if (
      (isScalarMappingValue(mapping.value) || isAssetValue) &&
      mapping.value !== ''
    ) {
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
  const counterMatches = Array.from(
    text.matchAll(/(?:^|\D)\d{1,4}\s*\/\s*(\d{1,4})\s*(words?|characters?|chars?)?/gi)
  )
    .filter((match) => {
      const unit = match[2] || ''
      const limit = Number(match[1])
      // Bare counters such as "0/5 technologies" or "0/3 categories"
      // describe item counts, not character limits. Only trust an explicit
      // character unit, or a sufficiently large bare counter.
      return !/^words?$/i.test(unit) && (/^(?:characters?|chars?)$/i.test(unit) || limit >= 20)
    })
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

  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  const separatorCandidate = normalizedValue.split(/\s[-|:]\s/)[0]?.trim()
  if (separatorCandidate && separatorCandidate.length <= maxLength) return separatorCandidate

  const withinLimit = normalizedValue.slice(0, maxLength).trim()
  const sentenceEnd = Math.max(
    withinLimit.lastIndexOf('. '),
    withinLimit.lastIndexOf('! '),
    withinLimit.lastIndexOf('? '),
    /[.!?]$/.test(withinLimit) ? withinLimit.length - 1 : -1
  )
  if (sentenceEnd >= Math.min(24, Math.floor(maxLength * 0.45))) {
    return withinLimit.slice(0, sentenceEnd + 1).trim()
  }

  const wordBoundary = withinLimit.replace(/\s+\S*$/, '').trim()
  return wordBoundary.length >= Math.floor(maxLength * 0.55) ? wordBoundary : withinLimit
}

function removeTrailingEllipsis(value: string) {
  return value.replace(/(?:\.\.\.|…)\s*$/, '').trim()
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
  if (isExactValue(value)) return value

  const normalizedValue = removeTrailingEllipsis(value)
  if (!maxLength || normalizedValue.length <= maxLength) return normalizedValue

  const fieldText = normalizeText(fieldContextText(field))
  const candidates: string[] = []

  if (/\b(name|startup name|tool name|product name|app name)\b/.test(fieldText)) {
    candidates.push(...shortProductName(profile))
  }

  if (/\b(tagline|short description|one sentence|summary|brief)\b/.test(fieldText)) {
    candidates.push(
      profile.shortDescription
    )
  }

  const fittingCandidate = candidates
    .map((candidate) => candidate?.trim())
    .find((candidate) => candidate && candidate.length <= maxLength)

  return fittingCandidate || shortenToLimit(normalizedValue, maxLength)
}

function getLockedProfileKeys(profile: ProductProfile) {
  const lockedFields = typeof profile?.lockedFields === 'string' ? profile.lockedFields : ''
  return new Set<keyof ProductProfile>(
    lockedFields
      .split(/[,;\r\n]+/)
      .map((key) => resolveProfileStringKey(profile, key))
      .filter((key): key is keyof ProductProfile => Boolean(key))
  )
}

function explicitTextFieldMaxLength(field: any) {
  const maxLength = Number(field?.maxLength)
  if (!(maxLength > 0 && maxLength <= 2000)) return undefined

  const type = String(field?.type || '').toLowerCase()
  const tagName = String(field?.tagName || '').toLowerCase()
  const isTextField = tagName === 'textarea' || [
    'text',
    'textarea',
    'richtext'
  ].includes(type)

  return isTextField ? maxLength : undefined
}

function enforceFieldLengthLimits(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
) {
  const fieldById = new Map(formFields.map((field) => [field.id, field]))
  const lockedProfileKeys = getLockedProfileKeys(productProfile)

  return mappings.map((mapping) => {
    if (typeof mapping.value !== 'string') return mapping

    const field = fieldById.get(mapping.fieldId)
    if (!field) return mapping

    const lockedSource = isProfileStringKey(productProfile, mapping.source)
      && lockedProfileKeys.has(mapping.source)
      ? mapping.source
      : null
    if (lockedSource) {
      const exactValue = getProfileValue(productProfile, lockedSource)
      const explicitMaxLength = explicitTextFieldMaxLength(field)
      const lockedValue = explicitMaxLength && exactValue.length > explicitMaxLength
        ? adaptValueToFieldLimit(exactValue, field, productProfile)
        : exactValue

      return {
        ...mapping,
        value: lockedValue,
        source: lockedSource,
        confidence: Math.max(mapping.confidence || 0, 0.99),
        reason: `${mapping.reason || ''} Enforced the saved value for a locked product-profile field${
          lockedValue !== exactValue ? ' and shortened it for the explicit character limit' : ''
        }.`.trim()
      }
    }

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

function fieldIdentityText(field: any) {
  return [
    field?.label,
    field?.name,
    field?.id,
    field?.type,
    field?.placeholder
  ].filter(Boolean).join(' ')
}

function isEmailField(field: any) {
  const type = String(field?.type || '').toLowerCase()
  return type === 'email' || /\b(email|e-mail|mail)\b/i.test(fieldIdentityText(field))
}

function isCompanyPhoneField(field: any) {
  const type = String(field?.type || '').toLowerCase()
  if (type === 'tel') return true

  // Use direct identifiers only. Nearby page text can mention a phone number
  // even when the input itself is unrelated.
  return /\b(phone|telephone|tel|mobile|cell|contact number|business phone|company phone)\b/i
    .test(fieldIdentityText(field))
}

function isFormalEmailField(field: any) {
  if (!isEmailField(field)) return false

  const text = [fieldIdentityText(field), field?.context]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
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

function enforceEmailPriorityMappings(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
) {
  const fieldById = new Map(formFields.map((field) => [field.id, field]))
  const contactEmail = productProfile?.contactEmail?.trim()
  const companyEmail = productProfile?.companyEmail?.trim()

  return mappings.map<FillMapping>((mapping) => {
    const field = fieldById.get(mapping.fieldId)
    if (!field || !isEmailField(field)) return mapping

    const requiresFormalEmail = isFormalEmailField(field)
    const preferred = requiresFormalEmail
      ? companyEmail
        ? { value: companyEmail, source: 'companyEmail' as const }
        : contactEmail
          ? { value: contactEmail, source: 'contactEmail' as const }
          : null
      : contactEmail
        ? { value: contactEmail, source: 'contactEmail' as const }
        : companyEmail
          ? { value: companyEmail, source: 'companyEmail' as const }
          : null

    if (!preferred || mapping.value === preferred.value) {
      return preferred && mapping.value === preferred.value && mapping.source !== preferred.source
        ? { ...mapping, source: preferred.source }
        : mapping
    }

    return {
      ...mapping,
      value: preferred.value,
      source: preferred.source,
      confidence: Math.max(mapping.confidence || 0, 0.95),
      reason: requiresFormalEmail
        ? 'Used company email because the page explicitly requires a formal email address.'
        : 'Used the default submission email for a standard email field.'
    }
  })
}

function enforceCompanyPhoneMappings(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
) {
  const companyPhone = getCompanyPhone(productProfile)
  if (!companyPhone) return mappings

  const fieldById = new Map(formFields.map((field) => [field.id, field]))

  return mappings.map<FillMapping>((mapping) => {
    const field = fieldById.get(mapping.fieldId)
    if (!field || !isCompanyPhoneField(field)) return mapping

    if (mapping.value === companyPhone) return mapping

    return {
      ...mapping,
      value: companyPhone,
      source: 'companyPhone',
      confidence: Math.max(mapping.confidence || 0, 0.98),
      reason: 'Used the saved company phone number for this explicit phone field.'
    }
  })
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
  return Array.from(new Set(
    urls.map((url) => url?.trim()).filter((url): url is string => Boolean(url))
  ))
}

function chooseAssetUrlsForFileField(field: any, productProfile: ProductProfile) {
  if (field?.type !== 'file') return []

  const contextText = fieldContextText(field)
  const constraints = parseImageUploadConstraints(contextText, field?.accept || '')
  const purpose = constraints.purpose
  const logoUrl = productProfile.logoImageUrl || productProfile.logoUrl
  const screenshotUrl = productProfile.screenshotImageUrl
  const promoUrl = productProfile.promoImageUrl
  const bannerUrl = productProfile.bannerImageUrl
  const galleryUrls = cleanAssetUrls(productProfile.galleryImageUrls || [])

  if (purpose === 'logo') {
    return cleanAssetUrls([logoUrl])
  }

  if (purpose === 'screenshot') {
    return field.multiple
      ? cleanAssetUrls([screenshotUrl, ...galleryUrls])
      : cleanAssetUrls([screenshotUrl, ...galleryUrls, promoUrl]).slice(0, 1)
  }

  if (purpose === 'banner') {
    return cleanAssetUrls([bannerUrl, promoUrl, ...galleryUrls, screenshotUrl]).slice(0, 1)
  }

  if (purpose === 'gallery') {
    return field.multiple
      ? cleanAssetUrls([...galleryUrls, promoUrl, screenshotUrl, bannerUrl])
      : cleanAssetUrls([...galleryUrls, promoUrl, screenshotUrl, bannerUrl]).slice(0, 1)
  }

  const looksLikeImageInput = constraints.acceptMimeTypes.length > 0 ||
    /\b(image|picture|photo|thumbnail|jpg|jpeg|png|webp)\b|图片|圖片|照片/.test(normalizeText(contextText))
  if (!looksLikeImageInput) return []

  return cleanAssetUrls([promoUrl, ...galleryUrls, screenshotUrl, bannerUrl, logoUrl]).slice(0, 1)
}

function buildAssetMappings(formFields: any[], productProfile: ProductProfile, usedFieldIds: Set<string>) {
  return formFields.reduce<FillMapping[]>((result, field) => {
    if (usedFieldIds.has(field.id) || String(field?.value || '').trim()) return result

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

function excludeFileInputMappings(mappings: FillMapping[], formFields: any[]) {
  const fileFieldIds = new Set(
    formFields.filter((field) => field?.type === 'file').map((field) => field.id)
  )
  return mappings.filter((mapping) => !fileFieldIds.has(mapping.fieldId))
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function getProfileValue(profile: ProductProfile, key: keyof ProductProfile) {
  if (key === 'companyPhone') return getCompanyPhone(profile)

  const value = profile?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isCompanyPhoneLabel(value: string) {
  const label = value.trim().toLowerCase()
  return ['公司电话', 'company phone', 'business phone', 'phone', 'telephone', 'tel'].includes(label)
}

function getCompanyPhone(profile: ProductProfile) {
  const standardValue = typeof profile?.companyPhone === 'string' ? profile.companyPhone.trim() : ''
  if (standardValue) return standardValue

  return (profile?.customFields || [])
    .find((field) => isCompanyPhoneLabel(field?.label || '') && field?.value?.trim())
    ?.value.trim() || ''
}

function buildCompanyPhoneFallbackMappings(
  formFields: any[],
  productProfile: ProductProfile,
  usedFieldIds: Set<string>
) {
  const companyPhone = getCompanyPhone(productProfile)
  if (!companyPhone) return []

  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (
      !field?.id ||
      usedFieldIds.has(field.id) ||
      String(field?.value || '').trim() ||
      !isCompanyPhoneField(field)
    ) {
      return mappings
    }

    mappings.push({
      fieldId: field.id,
      value: companyPhone,
      source: 'companyPhone',
      confidence: 0.98,
      reason: 'Matched this explicit phone field to the saved company phone number.'
    })
    return mappings
  }, [])
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function directFieldIdentityText(field: any) {
  return normalizeText([
    field?.label,
    field?.name,
    field?.id,
    field?.placeholder
  ].filter(Boolean).join(' '))
}

function customFieldValueForContext(fieldText: string, profile: ProductProfile) {
  const customField = (profile.customFields || []).find((field) => {
    const label = normalizeText(field?.label || '')
    if (!label || !field?.value?.trim()) return false

    if (fieldText.includes(label) || label.includes(fieldText)) return true

    const labelWords = label.split(' ').filter((word) => word.length >= 3)
    if (labelWords.length < 2) return false
    const matchedWords = labelWords.filter((word) => fieldText.includes(word)).length
    return matchedWords >= 2 && matchedWords / labelWords.length >= 0.75
  })

  return customField
    ? { value: customField.value.trim(), source: 'customFields' as keyof ProductProfile }
    : null
}

function extraInfoValueForContext(fieldText: string, profile: ProductProfile) {
  const lines = getProfileValue(profile, 'extraInfo').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*([^:：]{2,80})\s*[:：]\s*(.+?)\s*$/)
    if (!match) continue

    const label = normalizeText(match[1])
    const labelWords = label.split(' ').filter((word) => word.length >= 3)
    const matchedWords = labelWords.filter((word) => fieldText.includes(word)).length
    if (label && (
      fieldText.includes(label) ||
      (labelWords.length >= 2 && matchedWords >= 2 && matchedWords / labelWords.length >= 0.75)
    )) {
      return { value: match[2].trim(), source: 'extraInfo' as keyof ProductProfile }
    }
  }

  return null
}

function isForceBlockedField(field: any, fieldText: string) {
  const type = String(field?.type || '').toLowerCase()
  if (['hidden', 'password', 'submit', 'button', 'image', 'reset'].includes(type)) return true

  return containsAny(fieldText, [
    /\b(search|query|filter|keyword search)\b/,
    /\b(password|passcode|captcha|verification|verification code|one time code|otp|security code)\b/,
    /\b(payment|billing|credit card|card number|cvv|bank account)\b/,
    /\b(comment|reply|review|rating|newsletter|subscribe|subscription)\b/
  ])
}

function isUsernameField(field: any) {
  const type = String(field?.type || '').toLowerCase()
  if (!['', 'text'].includes(type)) return false
  const text = directFieldIdentityText(field)
  if (/\b(twitter|linkedin|github|social|x handle)\b/.test(text)) return false
  return /\b(user[\s_-]*name|login[\s_-]*name|account[\s_-]*(?:name|id))\b/.test(text)
}

function safeUsernameFromProfile(profile: ProductProfile) {
  const productSlug = (profile.productName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32)
  if (productSlug.length >= 3) return productSlug

  const emailLocalPart = (profile.contactEmail || profile.companyEmail || '').split('@')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32)
  return emailLocalPart && emailLocalPart.length >= 3 ? emailLocalPart : ''
}

function forcedValueForField(field: any, productProfile: ProductProfile) {
  const fieldText = normalizeText(fieldContextText(field))
  const directFieldText = directFieldIdentityText(field)
  const type = String(field?.type || '').toLowerCase()
  if (isForceBlockedField(field, fieldText) || String(field?.value || '').trim()) return null

  const pick = (key: keyof ProductProfile) => {
    const value = getProfileValue(productProfile, key)
    return value ? { value, source: key } : null
  }

  if (isUsernameField(field)) {
    const username = safeUsernameFromProfile(productProfile)
    return username ? { value: username, source: 'adapted' as const } : null
  }

  if (type === 'email' || isEmailField(field)) {
    return isFormalEmailField(field)
      ? pick('companyEmail') || pick('contactEmail')
      : pick('contactEmail') || pick('companyEmail')
  }

  if (type === 'tel' || /\b(phone|telephone|tel|mobile|cell|contact number|business phone|company phone)\b/.test(directFieldText)) {
    return pick('companyPhone')
  }

  // Saved custom values are useful for uncommon questions, but only match
  // against the field's own identity. Nearby container text often includes
  // labels from adjacent inputs and previously caused cross-field values.
  const customValue = customFieldValueForContext(directFieldText, productProfile)
  if (customValue) return customValue

  const extraInfoValue = extraInfoValueForContext(directFieldText, productProfile)
  if (extraInfoValue) return extraInfoValue

  if (containsAny(directFieldText, [/\bprivacy\b/, /\bprivacy policy\b/])) return pick('privacyPolicyUrl')
  if (containsAny(directFieldText, [/\bterms\b/, /\bterms of use\b/])) return pick('termsUrl')
  if (containsAny(directFieldText, [/\btwitter\b/, /\bx handle\b/])) return pick('twitterUrl')
  if (/\blinkedin\b/.test(directFieldText)) return pick('linkedinUrl')
  if (/\bgithub\b/.test(directFieldText)) return pick('githubUrl')

  if (/\b(first name|given name|forename)\b/.test(directFieldText)) return pick('contactFirstName')
  if (/\b(last name|family name|surname)\b/.test(directFieldText)) return pick('contactLastName')
  if (/\b(company|business|organization|organisation)\b/.test(directFieldText) && /\b(name|title)\b/.test(directFieldText)) {
    return pick('companyName') || pick('productName')
  }
  if (/\b(company|business|organization|organisation)\b/.test(directFieldText) && /\b(website|url|link|homepage|home page)\b/.test(directFieldText)) {
    return pick('companyWebsite') || pick('websiteUrl')
  }
  if (/\b(contact|founder|submitter|author|your name|full name|name)\b/.test(directFieldText) &&
      !/\b(product|tool|app|startup|company|business|site)\b/.test(directFieldText)) {
    const fullName = [
      getProfileValue(productProfile, 'contactFirstName'),
      getProfileValue(productProfile, 'contactLastName')
    ].filter(Boolean).join(' ')
    return fullName ? { value: fullName, source: 'contactFirstName' as keyof ProductProfile } : null
  }

  if (/\b(product|tool|app|startup|service|software|site|website)\b/.test(directFieldText) && /\b(name|title|headline)\b/.test(directFieldText)) {
    return pick('productName')
  }
  if (/^(name|title|headline)$/.test(directFieldText)) return pick('productName')

  if (containsAny(directFieldText, [/\b(website|web site|homepage|home page|domain)\b/, /\b(product|tool|app|site|service)\s+(url|link)\b/])) {
    return pick('websiteUrl')
  }
  if (type === 'url' && /^(url|link|website url|site url|homepage|home page|domain)$/.test(directFieldText)) {
    return pick('websiteUrl')
  }
  if (/\b(category|categories|industry|vertical|type)\b/.test(directFieldText)) return pick('category')
  if (/\b(tag|tags|keyword|keywords)\b/.test(directFieldText)) return pick(/\bkeyword/.test(directFieldText) ? 'keywords' : 'tags') || pick('category')
  if (/\b(tagline|one sentence|short description|summary|brief|elevator pitch)\b/.test(directFieldText)) {
    return pick('shortDescription') || pick('longDescription')
  }
  if (containsAny(directFieldText, [/\b(description|overview|introduction|details|about|message|tip|pitch)\b/])) {
    return pick('longDescription') || pick('shortDescription')
  }

  return null
}

function buildForcedFallbackMappings(
  formFields: any[],
  productProfile: ProductProfile,
  usedFieldIds: Set<string>
) {
  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (!field?.id || usedFieldIds.has(field.id)) return mappings

    const candidate = forcedValueForField(field, productProfile)
    if (!candidate?.value) return mappings

    mappings.push({
      fieldId: field.id,
      value: candidate.value,
      source: candidate.source,
      confidence: 0.58,
      reason: 'Force mode matched this field from saved product profile data.'
    })
    return mappings
  }, [])
}

function isSafeDeterministicField(field: any) {
  const fieldText = normalizeText(fieldIdentityText(field))
  if (!fieldText || isForceBlockedField(field, fieldText)) return false

  if (isEmailField(field) || isCompanyPhoneField(field) || isUsernameField(field)) return true

  return containsAny(fieldText, [
    /\b(product|tool|app|startup|service|software|site|website)\b.*\b(name|title|headline)\b/,
    /\b(name|title|headline)\b.*\b(product|tool|app|startup|service|software|site|website)\b/,
    /^(name|title|headline)$/,
    /\b(product|tool|app|startup|service|software|site|website|official|home page|homepage)\b.*\b(url|link|website|domain)\b/,
    /\b(url|link|website|domain)\b.*\b(product|tool|app|startup|service|software|site|official|home page|homepage)\b/,
    /^(url|website|website url|site url|homepage|home page)$/,
    /\b(tagline|one sentence|short description|summary|brief|elevator pitch)\b/,
    /^(description|long description|overview|introduction|details|about|message|pitch)$/,
    /\b(product|tool|app|startup|service|software|site|website)\b.*\b(description|overview|introduction|details|about)\b/,
    /\b(description|overview|introduction|details|about)\b.*\b(product|tool|app|startup|service|software|site|website)\b/,
    /^(category|categories|industry|vertical|tags|tag|keywords|keyword)$/,
    /\b(company|business|organization|organisation)\b.*\b(name|website|url|link|homepage|home page)\b/,
    /\b(first name|given name|forename|last name|family name|surname|contact name|founder name|submitter name|your name|full name)\b/,
    /\b(privacy policy|terms of use|terms url|twitter|linkedin|github)\b/
  ])
}

function buildSafeFallbackMappings(
  formFields: any[],
  productProfile: ProductProfile,
  usedFieldIds: Set<string>
) {
  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (
      !field?.id ||
      usedFieldIds.has(field.id) ||
      String(field?.value || '').trim() ||
      !isSafeDeterministicField(field)
    ) {
      return mappings
    }

    const candidate = forcedValueForField(field, productProfile)
    if (!candidate?.value) return mappings

    mappings.push({
      fieldId: field.id,
      value: candidate.value,
      source: candidate.source,
      confidence: 0.9,
      reason: 'Matched an explicit field label to saved product profile data.'
    })
    return mappings
  }, [])
}

function primaryFieldText(field: any) {
  return normalizeText([
    field?.label,
    field?.name,
    field?.id,
    field?.placeholder,
    field?.context
  ].filter(Boolean).join(' '))
}

function isPromotionOptionField(field: any) {
  const type = String(field?.type || '').toLowerCase()
  const isSelect = ['select', 'select-one', 'select-multiple', 'radio'].includes(type) || field?.tagName === 'select'
  if (!isSelect) return false

  const directText = normalizeText([
    field?.label,
    field?.name,
    field?.id,
    field?.placeholder
  ].filter(Boolean).join(' '))
  const promotionPattern = /\b(featured ad|extended ad|promote.*ad|ad promotion|premium placement|sponsored placement|listing type|listing plan|choose your listing|submission plan)\b/
  if (promotionPattern.test(directText)) return true

  // Some legacy directory forms do not connect visible text to the select with
  // a label. Use nearby context only when the option list itself looks paid.
  const optionText = Array.isArray(field?.options)
    ? field.options.map((option: any) => `${option?.label || ''} ${option?.value || ''}`).join(' ')
    : ''
  const looksLikePaidPromotion = /\$|\b\d+\s*(day|days|month|months|year|years)\b/i.test(optionText)
    && Boolean(getNoCostOption(field))

  return looksLikePaidPromotion && (
    promotionPattern.test(primaryFieldText(field)) ||
    /\b(featured|premium|sponsored|fast track|bundle)\b/i.test(optionText)
  )
}

function getNoCostOption(field: any) {
  if (!Array.isArray(field?.options)) return null

  return field.options.find((option: any) => {
    const label = normalizeText(option?.label || '')
    return (
      /^(none|no|not now|no thanks|free|regular|regular listing|standard|standard listing)$/.test(label) ||
      (/\b(regular|standard)\b/.test(label) && /\bfree\b/.test(label))
    )
  }) || null
}

function isNoCostPreference(value: string) {
  return /^(none|no|not now|no thanks|free|regular|regular listing|standard|standard listing)$/i.test(value.trim())
}

function enforcePromotionOptOutMappings(
  mappings: FillMapping[],
  formFields: any[],
  productProfile: ProductProfile
): FillMapping[] {
  const fieldById = new Map(formFields.map((field) => [field.id, field]))

  return mappings.map((mapping) => {
    const field = fieldById.get(mapping.fieldId)
    if (!field || !isPromotionOptionField(field)) return mapping

    const savedPreference = extraInfoValueForContext(primaryFieldText(field), productProfile)
    if (savedPreference && !isNoCostPreference(savedPreference.value)) return mapping

    const noCostOption = getNoCostOption(field)
    if (!noCostOption) return mapping
    const source: FillMapping['source'] = savedPreference?.source || 'adapted'

    return {
      ...mapping,
      value: noCostOption.label,
      source,
      confidence: 0.98,
      reason: 'Selected the no-cost promotion option to avoid an unintended paid upgrade.'
    }
  })
}

function buildPromotionOptOutMappings(
  formFields: any[],
  productProfile: ProductProfile,
  usedFieldIds: Set<string>
) {
  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (!field?.id || usedFieldIds.has(field.id) || !isPromotionOptionField(field)) return mappings

    const savedPreference = extraInfoValueForContext(primaryFieldText(field), productProfile)
    if (savedPreference && !isNoCostPreference(savedPreference.value)) return mappings

    const noCostOption = getNoCostOption(field)
    if (!noCostOption) return mappings

    mappings.push({
      fieldId: field.id,
      value: noCostOption.label,
      source: savedPreference?.source || 'adapted',
      confidence: 0.98,
      reason: 'Selected the no-cost promotion option to avoid an unintended paid upgrade.'
    })
    return mappings
  }, [])
}

function isSubmissionAgreementField(field: any) {
  const type = String(field?.type || '').toLowerCase()
  if (type !== 'checkbox') return false

  const text = primaryFieldText(field)
  if (!text) return false

  const optInPattern = /\b(newsletter|subscribe|marketing|advertis|promotion|updates?|commercial interests?|contact me|send me|email me)\b/
  if (optInPattern.test(text)) return false

  return (
    /\b(i agree|i accept|agree(?:ment)?|accept)\b.*\b(terms?|rules?|policy|policies|guidelines?)\b/.test(text)
    || /\b(terms?|rules?|policy|policies|guidelines?)\b.*\b(i agree|i accept|agree(?:ment)?|accept)\b/.test(text)
    || /\b(submission|listing|posting)\s*(?:rules?|terms?|agreement)\b/.test(text)
    || /\bagree(?:rules?|terms?)\b/.test(text.replace(/\s+/g, ''))
  )
}

function isUnsafeClaimOrOptInCheckbox(field: any) {
  const type = String(field?.type || '').toLowerCase()
  if (type !== 'checkbox') return false

  const text = primaryFieldText(field)
  const unsafePattern = /\b(newsletter|subscribe|marketing|advertis|promotion|promoted|featured|homepage feature|premium|sponsored|upgrade|paid|payment|billing|credit card|donation|tip jar|contact me|send me|email me|commercial interests?)\b/
  const ownershipPattern = /\b(i am|i'm|im)\s+(?:the\s+)?(owner|maker|founder|creator|author)\b/
  const unverifiedClaimPattern = /\b(open[\s_-]*source|self[\s_-]*hosted|vc[\s_-]*backed|venture[\s_-]*backed|bootstrapped|publicly traded|certified|verified partner)\b/

  return unsafePattern.test(text) || ownershipPattern.test(text) || unverifiedClaimPattern.test(text)
}

function unsafeCheckboxOptOutMappings(formFields: any[]) {
  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (!field?.id || field?.required || !isUnsafeClaimOrOptInCheckbox(field)) return mappings

    mappings.push({
      fieldId: field.id,
      value: false,
      source: 'adapted',
      confidence: 0.99,
      reason: 'Kept an optional marketing, paid-upgrade, or unverified ownership checkbox unselected.'
    })
    return mappings
  }, [])
}

function removeUnsafeCheckboxMappings(mappings: FillMapping[], formFields: any[]) {
  const fieldById = new Map(formFields.map((field) => [field.id, field]))
  return mappings.filter((mapping) => {
    const field = fieldById.get(mapping.fieldId)
    return !(mapping.value === true && field && isUnsafeClaimOrOptInCheckbox(field))
  })
}

function buildSubmissionAgreementMappings(
  formFields: any[],
  usedFieldIds: Set<string>
) {
  return formFields.reduce<FillMapping[]>((mappings, field) => {
    if (
      !field?.id ||
      usedFieldIds.has(field.id) ||
      isUnsafeClaimOrOptInCheckbox(field) ||
      !isSubmissionAgreementField(field)
    ) {
      return mappings
    }

    mappings.push({
      fieldId: field.id,
      value: true,
      source: 'adapted',
      confidence: 0.99,
      reason: 'Accepted the submission rules or terms required to prepare the listing for review.'
    })
    return mappings
  }, [])
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
  const profileText = [
    ...Object.entries(productProfile || {})
      .filter(([key, value]) => (
        key !== 'fieldDescriptions'
        && key !== 'customFields'
        && typeof value === 'string'
      ))
      .map(([, value]) => value),
    ...(productProfile?.customFields || []).flatMap((field) => [field.label, field.value])
  ].filter(Boolean).join('\n')

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
  const forceFill = Boolean(data.forceFill)

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

  if (data.requestId && cancelledFillRequests.delete(data.requestId)) {
    return { success: false, cancelled: true, error: '本次填充已停止' }
  }

  const abortController = data.requestId ? new AbortController() : undefined
  if (data.requestId && abortController) {
    activeFillRequests.set(data.requestId, abortController)
  }

  const systemPrompt = `You map web form fields to a user's saved product profile.

CRITICAL RULES:
1. Use ONLY the provided Product Profile. Do not invent a product, URL, email, company, person, policy link, or social link.
2. If the needed value is missing from Product Profile, return an empty string for that field.
3. Understand semantic variants: Website, Product URL, Your product link, Tool link, Homepage, App website, and Official URL can all mean websiteUrl.
4. Use extraInfo and customFields for uncommon fields such as pricing, founding year, launch date, founder, product hunt URL, chrome extension URL, demo video, target audience, use cases, address, coupon, affiliate program, and alternatives. A custom field's label describes the kind of value it contains.
4a. Product Profile may include fieldGuidance and custom-field descriptions. These descriptions explain when and how to use the corresponding saved value. Never copy guidance text itself into a webpage field.
4b. Discount, coupon, voucher, promotion-code, and affiliate-code fields require a saved custom field with the same meaning. General pricing text, free credits, or a product description are not discount information.
5. Email priority: for generic Email, Your Email, Contact Email, Submitter Email, or Account Email fields, use defaultSubmissionEmail/contactEmail. Use formalCompanyEmail/companyEmail ONLY when the field label, placeholder, context, helper text, validation hint, or nearby copy asks for company email, business email, work email, official email, corporate email, professional email, or says Gmail/free/personal/public email is not allowed.
6. Phone, Telephone, Tel, Contact Number, Business Phone, and Company Phone fields should use companyPhone/defaultCompanyPhone when provided. Leave phone fields empty when it is missing.
7. Your Name, Submitter Name, Contact Name, First Name, and Last Name should use contactFullName, contactFirstName, or contactLastName when provided.
7a. Leave Username, Login Name, and Account ID fields empty. A safe account identifier is derived locally and must never be a person's display name with spaces.
8. If a field includes an options array, choose the closest option label/value from that array. Do not create a new category outside the provided options.
9. Respect field character limits. If a field has maxLength, a visible counter such as 0/30 or 0/60, or an error such as "Name must be 32 or fewer characters long", the returned value MUST be at or below that limit. For shortened descriptions, prefer a self-contained sentence or phrase and never use an ellipsis to show truncation.
10. Locked fields must be copied exactly and never rewritten, except when a text field has a hard character limit; then return the shortest truthful version, such as the brand/product short name.
11. Text fields such as startup name, tool name, tagline, short description, and long description may be lightly adapted to fit the field label and character limit, but must remain truthful to Product Profile.
12. For editorial tip, pitch, story idea, or "send us a tip" forms, fill contact fields from Product Profile and use Message/Tip/Pitch fields for a concise submission pitch based on productName, websiteUrl, shortDescription, description, and longDescription.
13. For classified ad or free-ad posting forms, use productName for Ad Title/Headline/Subject, use websiteUrl for website/link fields, companyPhone for phone fields, and use description/longDescription for Ad Description/Details/Message. Do not invent price, phone, physical address, city, or region; use companyPhone or extraInfo only if it contains those values.
14. For Featured Ad, Extended Ad, sponsored placement, or other paid promotion selectors, choose the None/no-cost option unless Product Profile explicitly records a paid choice for that exact field.
15. Do not map file upload fields. Logo, screenshot, gallery, and banner uploads are handled separately from the saved image library.
16. Every value must be a JSON string or boolean. Never return an object or array as a field value.
17. Output ONLY valid JSON, with no markdown.
${forceFill ? `
FORCE MODE:
- The user explicitly requested a best-effort fill. Do not return an empty fields list merely because page intent is unclear or a field has a low confidence score.
- Return mappings for every semantically plausible product, URL, description, category, contact, email, phone, company, policy, social, and image field that has a value in Product Profile.
- Still do not invent missing data and do not fill passwords, verification codes, payments, search boxes, newsletter subscriptions, comments, or submit controls.` : ''}

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
${pageContext.summary ? `- Page text summary: ${String(pageContext.summary).slice(0, 3000)}` : ''}

Form Fields:
${JSON.stringify(formFieldsForAi, null, 2)}

Return mappings for fields that can be ${forceFill ? 'truthfully matched from Product Profile, including lower-confidence but semantically plausible matches' : 'confidently filled'}. Use field.id as fieldId. For category/select fields, choose one of the provided options and return its label or value. Leave unknown fields empty.`

  try {
    console.log('[ProfileFill] Calling LLM to map product profile to fields...')
    const rawResponse = await chatAPI.sendMessage([
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: new Date() },
      { id: 'usr', role: 'user', content: userPrompt, timestamp: new Date() }
    ], {
      model: settings.model || 'gpt-3.5-turbo',
      temperature: 0.1,
      enableWebSearch: false,
      signal: abortController?.signal
    })

    const parsed = extractJsonObject(rawResponse)
    const aiMappings = removeUnsafeCheckboxMappings(enforceCompanyPhoneMappings(
      enforceEmailPriorityMappings(
        enforcePromotionOptOutMappings(
          normalizeMappings(parsed, formFieldsForAi, productProfile),
          formFieldsForAi,
          productProfile
        ),
        formFieldsForAi,
        productProfile
      ),
      formFieldsForAi,
      productProfile
    ), formFieldsForAi)
    const checkboxOptOutMappings = unsafeCheckboxOptOutMappings(formFieldsForAi)
    const promotionMappings = buildPromotionOptOutMappings(
      formFieldsForAi,
      productProfile,
      new Set([...aiMappings, ...checkboxOptOutMappings].map((mapping) => mapping.fieldId))
    )
    const agreementMappings = buildSubmissionAgreementMappings(
      formFieldsForAi,
      new Set([...aiMappings, ...checkboxOptOutMappings, ...promotionMappings].map((mapping) => mapping.fieldId))
    )
    const companyPhoneMappings = buildCompanyPhoneFallbackMappings(
      formFieldsForAi,
      productProfile,
      new Set([...aiMappings, ...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings].map((mapping) => mapping.fieldId))
    )
    const safeMappings = buildSafeFallbackMappings(
      formFieldsForAi,
      productProfile,
      new Set([...aiMappings, ...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings].map((mapping) => mapping.fieldId))
    )
    const forcedMappings = forceFill
      ? buildForcedFallbackMappings(
        formFieldsForAi,
        productProfile,
        new Set([...aiMappings, ...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings, ...safeMappings].map((mapping) => mapping.fieldId))
      )
      : []
    const textMappings = excludeFileInputMappings(
      enforceFieldLengthLimits(
        [...aiMappings, ...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings, ...safeMappings, ...forcedMappings],
        formFieldsForAi,
        productProfile
      ),
      formFieldsForAi
    )
    const assetMappings = buildAssetMappings(
      formFieldsForAi,
      productProfile,
      new Set(textMappings.map((mapping) => mapping.fieldId))
    )
    const mappings = [...textMappings, ...assetMappings]
    const filledData = mappingsToFilledData(mappings)
    const fallbackData = buildEmailFallbackData(mappings, formFieldsForAi, productProfile)

    if (Object.keys(filledData).length === 0) {
      return {
        success: false,
        error: forceFill
          ? '强制模式已尝试匹配，但当前表单没有与已保存推广资料对应的字段。请补充对应资料后再试。'
          : 'AI 没有找到可以安全填入的字段。请检查推广资料是否完整。'
      }
    }

    return {
      success: true,
      filledData,
      fallbackData,
      mappings,
      forcedFallbackCount: forcedMappings.length,
      usedLocalFallback: safeMappings.length > 0
    }
  } catch (error: any) {
    console.error('[ProfileFill] Error:', error)
    if (abortController?.signal.aborted) {
      return { success: false, cancelled: true, error: '本次填充已停止' }
    }
    const checkboxOptOutMappings = unsafeCheckboxOptOutMappings(formFieldsForAi)
    const promotionMappings = buildPromotionOptOutMappings(
      formFieldsForAi,
      productProfile,
      new Set(checkboxOptOutMappings.map((mapping) => mapping.fieldId))
    )
    const agreementMappings = buildSubmissionAgreementMappings(
      formFieldsForAi,
      new Set([...checkboxOptOutMappings, ...promotionMappings].map((mapping) => mapping.fieldId))
    )
    const companyPhoneMappings = buildCompanyPhoneFallbackMappings(
      formFieldsForAi,
      productProfile,
      new Set([...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings].map((mapping) => mapping.fieldId))
    )
    const safeMappings = buildSafeFallbackMappings(
      formFieldsForAi,
      productProfile,
      new Set([...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings].map((mapping) => mapping.fieldId))
    )
    const forcedMappings = forceFill
      ? buildForcedFallbackMappings(
        formFieldsForAi,
        productProfile,
        new Set([...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings, ...safeMappings].map((mapping) => mapping.fieldId))
      )
      : []
    const textMappings = excludeFileInputMappings(
      enforceFieldLengthLimits(
        [...checkboxOptOutMappings, ...promotionMappings, ...agreementMappings, ...companyPhoneMappings, ...safeMappings, ...forcedMappings],
        formFieldsForAi,
        productProfile
      ),
      formFieldsForAi
    )
    const assetMappings = buildAssetMappings(
      formFieldsForAi,
      productProfile,
      new Set(textMappings.map((mapping) => mapping.fieldId))
    )
    const mappings = [...textMappings, ...assetMappings]
    const filledData = mappingsToFilledData(mappings)

    if (Object.keys(filledData).length > 0) {
      return {
        success: true,
        filledData,
        fallbackData: buildEmailFallbackData(mappings, formFieldsForAi, productProfile),
        mappings,
        forcedFallbackCount: forcedMappings.length,
        usedLocalFallback: true
      }
    }

    return {
      success: false,
      error: error.message?.includes('JSON') ? 'Failed to parse AI response' : 'Failed to generate form data',
      details: error.message
    }
  } finally {
    if (data.requestId && activeFillRequests.get(data.requestId) === abortController) {
      activeFillRequests.delete(data.requestId)
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

  const productProfile = withDefaultAssetProfile(data.productProfile || settings.productProfile)
  const compactProductProfile = compactProfile(productProfile)

  if (isCredentialField(data.field)) {
    return { success: false, error: '密码、令牌或密钥类字段不会交给 AI 改写。' }
  }

  chatAPI.setApiKey(settings.apiKey)
  if (settings.apiBaseURL) chatAPI.setBaseURL(settings.apiBaseURL)

  const systemPrompt = `You revise one filled form field using ONLY the Product Profile.

Rules:
1. Never invent products, URLs, emails, people, policy links, or company names.
2. For URL, email, phone, product name, company name, privacy policy, and terms fields, copy the best profile value exactly.
3. Use extraInfo for uncommon fields such as pricing, founding year, launch date, founder, product hunt URL, chrome extension URL, demo video, target audience, use cases, coupon, affiliate program, and alternatives.
4. If the target field includes an options array, choose the closest option label/value from that array.
5. If the target field has maxLength, a visible counter such as 0/30 or 0/60, or an error such as "Name must be 32 or fewer characters long", the returned value MUST be at or below that character limit.
6. For descriptive text fields, you may rewrite or shorten while staying truthful. When shortening, produce a complete sentence or phrase and never end the value with an ellipsis.
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
    const validatedMapping = validatedMappingFromAi({
      ...parsed,
      fieldId: data.field?.id || 'regenerate-field'
    }, {
      ...data.field,
      id: data.field?.id || 'regenerate-field'
    }, productProfile)
    if (!validatedMapping || typeof validatedMapping.value !== 'string') {
      return { success: false, error: 'AI 返回的值无法追溯到已保存的推广资料，已拒绝写入。' }
    }
    return {
      success: true,
      value: validatedMapping.value,
      source: validatedMapping.source,
      confidence: validatedMapping.confidence
    }
  } catch (error: any) {
    console.error('[FieldRegenerate] Error:', error)
    return { success: false, error: error.message || 'Failed to regenerate field' }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compactLabelText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function cleanLearnedLabelCandidate(candidate: unknown, learnedValue: string) {
  let label = compactLabelText(candidate)
  if (!label) return ''

  const value = compactLabelText(learnedValue)
  if (value) {
    const escapedValue = escapeRegExp(value)
    label = label
      .replace(new RegExp(`\\s*[:：\\-–—]?\\s*${escapedValue}\\s*$`), '')
      .replace(new RegExp(`^\\s*${escapedValue}\\s*[:：\\-–—]?\\s*`), '')
      .trim()
  }

  const normalized = label.toLowerCase()
  if (
    !label ||
    label.length > 90 ||
    label === value ||
    /^(select|select a value|select value|select an option|choose|choose one|choose an option|please select|-- select --|请选择|选择|选择一个)$/.test(normalized) ||
    /^field_\d+$/.test(normalized) ||
    !/[a-zA-Z\u4e00-\u9fff]/.test(label)
  ) {
    return ''
  }

  return label
}

function getBestLearnedFieldLabel(field: any, value: string) {
  const contextParts = String(field?.context || '')
    .split('|')
    .map((part) => part.trim())

  const candidates = [
    field?.label,
    ...contextParts,
    field?.placeholder,
    field?.name,
    field?.id
  ]

  for (const candidate of candidates) {
    const label = cleanLearnedLabelCandidate(candidate, value)
    if (label) return label
  }

  return 'Unknown field'
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

  const value = String(data.value || '').trim()

  if (!value) {
    return { success: false, error: '请先在这个字段里填写内容，再点 + 保存。' }
  }

  const label = getBestLearnedFieldLabel(data.field, value)
  if (
    isCredentialField(data.field) ||
    isCredentialIdentity(label) ||
    CREDENTIAL_LINE_PATTERN.test(`${label}: ${value}`) ||
    looksLikeCredentialValue(value)
  ) {
    return { success: false, error: '密码、令牌或密钥类资料不会保存到推广资料。' }
  }
  const learnedLine = `${label}: ${value}`
  const currentExtraInfo = sanitizeExtraInfo(productProfile.extraInfo || '')
  const normalizedLearnedLabel = normalizeText(label)
  let replacedExistingLabel = false
  const retainedLines = currentExtraInfo.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []

    const match = line.match(/^\s*([^:：]+)\s*[:：]\s*(.+?)\s*$/)
    if (!match || normalizeText(match[1]) !== normalizedLearnedLabel) return [line]

    if (replacedExistingLabel) return []
    replacedExistingLabel = true
    return [learnedLine]
  })

  if (!replacedExistingLabel) {
    retainedLines.push(learnedLine)
  }
  productProfile.extraInfo = retainedLines.join('\n')

  const activeProductProfileId = typeof state.activeProductProfileId === 'string' && state.activeProductProfileId
    ? state.activeProductProfileId
    : Array.isArray(state.productProfiles) && typeof state.productProfiles[0]?.id === 'string'
      ? state.productProfiles[0].id
      : ''
  const productProfiles = Array.isArray(state.productProfiles)
    ? state.productProfiles.map((entry: any) => (
        activeProductProfileId && entry?.id === activeProductProfileId
          ? {
              ...entry,
              profile: {
                ...(entry.profile || {}),
                ...productProfile
              },
              updatedAt: Date.now()
            }
          : entry
      ))
    : state.productProfiles

  const nextState = {
    ...state,
    productProfile,
    ...(Array.isArray(productProfiles) ? { productProfiles } : {})
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
