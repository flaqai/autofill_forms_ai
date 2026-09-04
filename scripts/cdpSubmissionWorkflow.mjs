/**
 * Reusable helpers for direct BitBrowser CDP + Playwright submissions.
 *
 * This file is intentionally outside the extension runtime. It does not
 * modify or load the Chat4o extension. Run it with the bundled Node runtime
 * and a Playwright installation exposed through NODE_PATH.
 */

import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

const require = createRequire(import.meta.url)
const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:59725'
const DEFAULT_LOCAL_API = 'http://127.0.0.1:54345'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Human-verification waiting is enabled by default for directory work.
 * The helpers only observe official verification state; they never solve,
 * inject, or fabricate CAPTCHA/anti-bot responses.
 */
export const DEFAULT_HUMAN_VERIFICATION_POLICY = Object.freeze({
  mode: 'wait-and-resume',
  pollMs: 2_000,
  timeoutMs: 15 * 60 * 1_000
})

export const HUMAN_VERIFICATION_STAGES = Object.freeze({
  ENTRY: 'entry',
  FORM: 'form',
  PRE_SUBMIT: 'pre-submit',
  POST_SUBMIT: 'post-submit'
})

/**
 * Missing-field policy for direct CDP submissions. The profile remains the
 * source of record for factual fields. Inferred values are limited to neutral
 * presentation fields and are always labelled as generated in the result.
 */
export const DEFAULT_MISSING_FIELD_POLICY = Object.freeze({
  mode: 'infer-safe-fields',
  maxTags: 3,
  autoSubmit: true,
  generatedFields: Object.freeze([
    'description', 'summary', 'introduction', 'about', 'features',
    'category', 'categories', 'tag', 'tags', 'keywords', 'target users',
    'audience', 'platform', 'product type', 'business model'
  ]),
  protectedFields: Object.freeze([
    'password', 'email', 'phone', 'contact', 'first name', 'last name',
    'full name', 'founder', 'address', 'country', 'city', 'postcode',
    'zip', 'founded', 'date', 'price', 'revenue', 'traffic', 'employees',
    'user count', 'monthly active', 'legal', 'license', 'certification', 'social', 'payment',
    'card', 'bank', 'tax', 'vat', 'reciprocal link', 'backlink'
  ])
})

function normalizeMissingFieldPolicy(policy = {}) {
  const maxTags = Number(policy.maxTags ?? DEFAULT_MISSING_FIELD_POLICY.maxTags)
  return {
    ...DEFAULT_MISSING_FIELD_POLICY,
    ...policy,
    maxTags: Number.isInteger(maxTags) && maxTags > 0 ? maxTags : DEFAULT_MISSING_FIELD_POLICY.maxTags,
    generatedFields: policy.generatedFields ?? DEFAULT_MISSING_FIELD_POLICY.generatedFields,
    protectedFields: policy.protectedFields ?? DEFAULT_MISSING_FIELD_POLICY.protectedFields
  }
}

function normalizedFieldName(value = '') {
  return normalizeVisibleText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function splitCsv(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function firstSentence(value = '') {
  const normalized = normalizeVisibleText(value)
  const sentence = normalized.match(/^.+?[.!?](?:\s|$)/)
  return sentence ? sentence[0].trim() : normalized
}

function parseExtraInfo(profile) {
  const extra = String(profile.extraInfo || '')
  const users = extra.match(/Target users:\s*([^\n]+)/i)?.[1]?.trim() || ''
  const platform = extra.match(/Supported Platforms:\s*([^\n.]+)/i)?.[1]?.trim() || ''
  return {users, platform}
}

/** Parse the behavioural rules that the CDP runner can safely enforce. */
export function parseSubmissionPreferences(markdown = '') {
  const text = String(markdown)
  return {
    profileName: text.match(/BitBrowser profile\s+`([^`]+)`/)?.[1] || '',
    defaultEmail: text.match(/默认使用：`([^`]+)`/)?.[1] || '',
    corporateEmail: text.match(/(?:公司邮箱|商务邮箱|企业邮箱|工作邮箱).*?`([^`]+)`/)?.[1] || '',
    forbiddenEmails: [...text.matchAll(/不要使用\s*`([^`]+)`/g)].map((match) => match[1]),
    preferFreePlan: /优先选择免费方案/.test(text),
    neverSelectPaidPlan: /绝不选择付费提交|Never select a paid submission/i.test(text),
    budgetFallback: /倒数第二便宜|second-cheapest/i.test(text) ? 'second-cheapest' : null,
    inferMissingFields: /自行生成并填入|自动生成.*填入|infer-safe-fields/i.test(text),
    autoSubmit: /自动提交/.test(text),
    requestedHumanVerificationAutomation: /尽可能自动完成/.test(text)
  }
}

function customFieldMap(profile) {
  return new Map((profile.customFields || []).flatMap((field) => {
    const value = String(field.value || '').trim()
    if (!value) return []
    return [[normalizedFieldName(field.label), value], [normalizedFieldName(field.id), value]]
  }))
}

/**
 * Load one profile JSON plus its companion Markdown preferences file. Paths
 * are explicit so credentials and product profiles stay outside the repo.
 */
export async function loadSubmissionContext({profilePath, preferencesPath} = {}) {
  if (!profilePath || !preferencesPath) {
    throw new Error('profilePath and preferencesPath are required')
  }

  const [profileText, preferencesMarkdown] = await Promise.all([
    readFile(profilePath, 'utf8'),
    readFile(preferencesPath, 'utf8')
  ])
  const packageData = JSON.parse(profileText)
  const profile = packageData.profile || {}
  const preferences = parseSubmissionPreferences(preferencesMarkdown)
  const lockedFields = new Set(splitCsv(profile.lockedFields).map(normalizedFieldName))
  const packageDirectory = dirname(resolve(profilePath))

  return {
    packageName: packageData.name || profile.productName || '',
    profile,
    preferences,
    lockedFields,
    customFields: customFieldMap(profile),
    assets: Object.fromEntries(Object.entries(packageData.assets || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((item) => resolve(packageDirectory, item)) : resolve(packageDirectory, value)
    ])),
    source: {profilePath, preferencesPath}
  }
}

function profileValueForField(context, fieldName, {requiresCorporateEmail = false} = {}) {
  const field = normalizedFieldName(fieldName)
  const {profile, preferences, customFields} = context
  const aliases = [
    [/^(product|tool|app|website) name$|^name$|company product/, 'productName'],
    [/website|homepage|product url|tool url|app url|^url$|^link$/, 'websiteUrl'],
    [/company name|organisation|organization|business name/, 'companyName'],
    [/company website|company url/, 'companyWebsite'],
    [/logo|icon/, 'logoUrl'],
    [/first name|given name/, 'contactFirstName'],
    [/last name|family name|surname/, 'contactLastName'],
    [/phone|telephone|mobile/, 'companyPhone'],
    [/twitter|x profile/, 'twitterUrl'],
    [/short description|tagline|excerpt|brief description/, 'shortDescription'],
    [/long description|detailed description|introduction|about/, 'longDescription'],
    [/keyword/, 'keywords'],
    [/^category|categories$/, 'category'],
    [/^tag|tags$/, 'tags']
  ]

  if (/email/.test(field)) {
    if (requiresCorporateEmail || /company|business|corporate|work/.test(field)) {
      return {value: profile.companyEmail || preferences.corporateEmail, source: 'profile'}
    }
    return {value: profile.contactEmail || preferences.defaultEmail, source: 'profile'}
  }

  if (/full name|contact name/.test(field) && (profile.contactFirstName || profile.contactLastName)) {
    return {value: [profile.contactFirstName, profile.contactLastName].filter(Boolean).join(' '), source: 'profile'}
  }

  for (const [pattern, key] of aliases) {
    if (pattern.test(field) && profile[key]) return {value: profile[key], source: 'profile'}
  }

  if (customFields.has(field)) return {value: customFields.get(field), source: 'profile'}

  const customAliases = [
    [/address line 1|address 1/, 'address line 1'],
    [/address line 2|address 2/, 'address line 2'],
    [/company address|^address$/, 'company address'],
    [/postcode|zip code|postal code/, 'postcode zip code'],
    [/founded date|established date/, 'founded date'],
    [/founded year|established year/, 'founded year'],
    [/supported platform|platforms/, 'supported platforms']
  ]
  for (const [pattern, key] of customAliases) {
    if (pattern.test(field) && customFields.has(key)) {
      return {value: customFields.get(key), source: 'profile'}
    }
  }
  return null
}

function canGenerateField(fieldName, policy) {
  const field = normalizedFieldName(fieldName)
  const protectedField = policy.protectedFields.some((term) => field.includes(term))
  return !protectedField && policy.generatedFields.some((term) => field.includes(term))
}

function generatedValueForField(context, fieldName, policy) {
  const field = normalizedFieldName(fieldName)
  const {profile} = context
  const extra = parseExtraInfo(profile)
  const categories = splitCsv(profile.category)
  const tags = splitCsv(profile.tags).slice(0, policy.maxTags)

  if (/long description|detailed description|introduction|about|feature/.test(field)) {
    return profile.longDescription || `${profile.productName} is a browser-based creative platform for AI video, image, music, and visual-effect workflows.`
  }
  if (/description|summary|excerpt|tagline|brief/.test(field)) {
    return profile.shortDescription || firstSentence(profile.longDescription)
  }
  if (/category/.test(field)) return categories[0] || 'AI Creative Tools'
  if (/tag|keyword/.test(field)) return tags.join(', ')
  if (/target users|audience/.test(field)) return extra.users || 'content creators, marketers, designers, and creative teams'
  if (/platform/.test(field)) return extra.platform || 'Web'
  if (/product type|business model/.test(field)) return 'Browser-based AI creative tools platform'
  return ''
}

/**
 * Resolve a form field from factual profile data first, then a permitted,
 * neutral inference. Callers should put this result in their audit record.
 */
export function resolveSubmissionField(context, {
  field,
  required = false,
  requiresCorporateEmail = false,
  policy = DEFAULT_MISSING_FIELD_POLICY
} = {}) {
  if (!context?.profile) throw new Error('A loaded submission context is required')
  if (!field) throw new Error('A form field name is required')

  const activePolicy = normalizeMissingFieldPolicy(policy)
  const normalized = normalizedFieldName(field)
  const direct = profileValueForField(context, normalized, {requiresCorporateEmail})
  if (direct?.value) return {field, value: direct.value, source: direct.source, generated: false}

  const locked = context.lockedFields?.has(normalized)
  const inferEnabled = context.preferences?.inferMissingFields || activePolicy.mode === 'infer-safe-fields'
  if (!locked && inferEnabled && canGenerateField(normalized, activePolicy)) {
    const value = generatedValueForField(context, normalized, activePolicy)
    if (value) return {field, value, source: 'generated', generated: true}
  }

  return {
    field,
    value: '',
    source: 'missing',
    generated: false,
    required,
    reason: locked ? 'locked field has no profile value' : 'no permitted profile or generated value'
  }
}

/**
 * Fill one text-like control and return its provenance for the submission
 * record. Selects and custom widgets should use selectExactOption after
 * resolving their value with resolveSubmissionField.
 */
export async function fillResolvedSubmissionField(page, context, {
  field,
  locator,
  required = false,
  requiresCorporateEmail = false,
  policy
} = {}) {
  const resolution = resolveSubmissionField(context, {
    field,
    required,
    requiresCorporateEmail,
    policy
  })
  if (!resolution.value) return {...resolution, filled: false}

  const target = typeof locator === 'string' ? page.locator(locator) : locator
  if (!target) throw new Error(`A locator is required to fill ${field}`)
  await target.fill(resolution.value)
  return {...resolution, filled: true}
}

function normalizeHumanVerificationPolicy(policy = {}) {
  const pollMs = Number(policy.pollMs ?? DEFAULT_HUMAN_VERIFICATION_POLICY.pollMs)
  const timeoutMs = Number(policy.timeoutMs ?? DEFAULT_HUMAN_VERIFICATION_POLICY.timeoutMs)
  return {
    mode: policy.mode ?? DEFAULT_HUMAN_VERIFICATION_POLICY.mode,
    pollMs: Number.isFinite(pollMs) && pollMs >= 250 ? pollMs : DEFAULT_HUMAN_VERIFICATION_POLICY.pollMs,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= pollMs ? timeoutMs : DEFAULT_HUMAN_VERIFICATION_POLICY.timeoutMs
  }
}

function stableVerificationFingerprint(inspection) {
  return JSON.stringify({
    state: inspection.state,
    providers: inspection.providers.map((provider) => ({
      name: provider.name,
      detected: provider.detected,
      responsePresent: provider.responsePresent,
      widgetVisible: provider.widgetVisible,
      interstitialActive: provider.interstitialActive
    }))
  })
}

async function sleepWithSignal(ms, signal) {
  if (!signal) return sleep(ms)
  if (signal.aborted) throw new Error('Human-verification wait aborted')
  await new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new Error('Human-verification wait aborted'))
    }
    signal.addEventListener('abort', abort, {once: true})
  })
}

export function normalizeVisibleText(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

export function wordCount(value = '') {
  return normalizeVisibleText(value)
    .split(/\s+/)
    .filter(Boolean)
    .length
}

export function assertWordLimit(value, maxWords, fieldName = 'field') {
  const count = wordCount(value)
  if (count > maxWords) {
    throw new Error(`${fieldName} exceeds ${maxWords} words (${count})`)
  }
  return count
}

export function parseFreeSlotCount(value = '') {
  const text = normalizeVisibleText(value)
  const match = text.match(/(\d+)\s*(?:free\s*)?(?:slot|slots|vaga|vagas)/i)
  return match ? Number(match[1]) : null
}

export function parseIsoDate(value = '') {
  const match = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

function visible(element) {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

/** Reacquire a visible control using exact normalized text, never substring matching. */
export async function exactTextLocator(page, text, selector = 'button, label, [role="option"], [role="button"]') {
  const expected = normalizeVisibleText(text)
  const matches = await page.locator(selector).evaluateAll((elements, wanted) => elements
    .map((element, index) => ({
      index,
      text: (element.innerText || element.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
      visible: (() => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      })()
    }))
    .filter((item) => item.visible && item.text === wanted), expected)

  if (!matches.length) return null
  return page.locator(selector).nth(matches[0].index)
}

/** Wait for DOM state changes instead of relying on arbitrary sleeps. */
export async function waitForStable(page, { timeout = 10000, stableMs = 350 } = {}) {
  const deadline = Date.now() + timeout
  let previous = ''
  let stableSince = Date.now()

  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      ready: document.readyState,
      url: window.location.href,
      text: (document.body?.innerText || '').slice(0, 5000)
    })).catch(() => null)

    if (state) {
      const fingerprint = `${state.ready}|${state.url}|${state.text}`
      if (fingerprint !== previous) {
        previous = fingerprint
        stableSince = Date.now()
      } else if (state.ready === 'complete' && Date.now() - stableSince >= stableMs) {
        return state
      }
    }

    await sleep(80)
  }

  throw new Error(`Page did not stabilize within ${timeout}ms`)
}

export async function waitForAnyText(page, texts, { timeout = 10000 } = {}) {
  const expected = texts.map(normalizeVisibleText)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const body = normalizeVisibleText(await page.locator('body').innerText().catch(() => ''))
    const match = expected.find((text) => body.includes(text))
    if (match) return match
    await sleep(100)
  }
  return null
}

/**
 * Select a visible Radix/custom option by exact text. This avoids the common
 * `SaaS` -> `Micro-SaaS` substring error seen in the previous batch.
 */
export async function selectExactOption(page, {trigger, optionText, timeout = 5000}) {
  if (trigger) await trigger.click({timeout})
  const option = await exactTextLocator(page, optionText, '[role="option"], button, label')
  if (!option) throw new Error(`Exact option not found: ${optionText}`)
  await option.click({timeout})
  return normalizeVisibleText(optionText)
}

export async function chooseFirstFreeDate(page, {
  trigger,
  maxDays = 180,
  minimumSlots = 1,
  timeout = 7000
} = {}) {
  const options = await page.locator('select option').evaluateAll((elements) => elements.map((element) => ({
    value: element.value,
    text: (element.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
    disabled: element.disabled
  })))

  const today = new Date()
  const maxDate = new Date(today.getTime() + maxDays * 24 * 60 * 60 * 1000)
  const candidate = options.find((option) => {
    if (option.disabled || (parseFreeSlotCount(option.text) ?? 0) < minimumSlots) return false
    const date = parseIsoDate(option.value)
    return !date || date <= maxDate
  })

  if (!candidate) {
    throw new Error(`No free launch date with at least ${minimumSlots} slot(s) within ${maxDays} days`)
  }

  if (trigger) {
    await trigger.click({timeout})
    const visibleOption = await exactTextLocator(page, candidate.text, '[role="option"], button, label')
    if (!visibleOption) throw new Error(`Free date option is not visible: ${candidate.text}`)
    await visibleOption.click({timeout})
  } else {
    await page.locator('select').first().selectOption(candidate.value)
  }

  return candidate
}

export async function assertFreePlan(page) {
  const selected = await page.locator('input:checked, [role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]')
    .evaluateAll((elements) => elements.map((element) => `${element.getAttribute('value') || ''} ${(element.innerText || '')}`))
    .catch(() => [])
  const body = normalizeVisibleText(await page.locator('body').innerText().catch(() => ''))
  const paidAction = /checkout|payment|purchase|upgrade|buy now|premium\s+launch/i.test(body)
  const paidSelected = selected.some((value) => /premium|paid|upgrade|purchase|checkout/i.test(value))
  if (paidSelected || (paidAction && !/free launch|gratuito|freemium|\$\s*0|r\$\s*0/i.test(body))) {
    throw new Error('Paid plan or paid action detected; submission stopped')
  }
  return {selected, paidAction, paidSelected}
}

/**
 * Classify a redacted DOM snapshot. Kept pure so batch runners can unit-test
 * their pause/resume behaviour without a live anti-bot provider.
 */
export function classifyHumanVerification(snapshot) {
  const providers = snapshot.providers ?? []
  const detected = providers.filter((provider) => provider.detected)
  const pending = detected.filter((provider) => !provider.responsePresent)
  const hasInterstitial = detected.some((provider) => provider.interstitialActive)
  const hasVisibleWidget = pending.some((provider) => provider.widgetVisible)

  if (!detected.length) {
    return {
      state: 'not-detected',
      canContinue: true,
      requiresHumanAction: false,
      providerNames: []
    }
  }

  if (!pending.length && !hasInterstitial) {
    return {
      state: 'verified',
      canContinue: true,
      requiresHumanAction: false,
      providerNames: detected.map((provider) => provider.name)
    }
  }

  return {
    state: 'waiting-human-verification',
    canContinue: false,
    requiresHumanAction: hasVisibleWidget || hasInterstitial,
    providerNames: detected.map((provider) => provider.name)
  }
}

/**
 * Detect common official challenge widgets without reading or returning any
 * response token. An empty hidden field is intentionally treated as pending:
 * it may pass automatically, or it may need a user-visible confirmation.
 */
export async function inspectHumanVerification(page, {
  stage = HUMAN_VERIFICATION_STAGES.FORM
} = {}) {
  const snapshot = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const hasResponse = (selector) => [...document.querySelectorAll(selector)]
      .some((element) => Boolean(element.value?.trim()))
    const hasElement = (selector) => Boolean(document.querySelector(selector))
    const hasVisibleElement = (selector) => [...document.querySelectorAll(selector)].some(isVisible)
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()

    return {
      url: window.location.href,
      providers: [
        {
          name: 'Cloudflare Turnstile',
          detected: hasElement('[name="cf-turnstile-response"], .cf-turnstile, iframe[src*="challenges.cloudflare.com" i]') || /checking your browser|verify you are human|just a moment/i.test(text),
          responsePresent: hasResponse('[name="cf-turnstile-response"]'),
          widgetVisible: hasVisibleElement('.cf-turnstile, iframe[src*="challenges.cloudflare.com" i]'),
          interstitialActive: /checking your browser|verify you are human|just a moment/i.test(text)
        },
        {
          name: 'Google reCAPTCHA',
          detected: hasElement('[name="g-recaptcha-response"], .g-recaptcha, iframe[src*="recaptcha" i]') || /complete the captcha|recaptcha required/i.test(text),
          responsePresent: hasResponse('[name="g-recaptcha-response"]'),
          widgetVisible: hasVisibleElement('.g-recaptcha, iframe[src*="recaptcha" i]'),
          interstitialActive: /complete the captcha|recaptcha required/i.test(text)
        },
        {
          name: 'hCaptcha',
          detected: hasElement('[name="h-captcha-response"], .h-captcha, iframe[src*="hcaptcha" i]') || /hcaptcha/i.test(text),
          responsePresent: hasResponse('[name="h-captcha-response"]'),
          widgetVisible: hasVisibleElement('.h-captcha, iframe[src*="hcaptcha" i]'),
          interstitialActive: false
        }
      ]
    }
  }).catch(() => ({url: page.url(), providers: []}))

  const classification = classifyHumanVerification(snapshot)
  return {
    ...snapshot,
    ...classification,
    stage,
    inspectedAt: new Date().toISOString()
  }
}

export function humanVerificationPrompt(inspection, {siteId} = {}) {
  if (inspection.canContinue) return null
  const prefix = siteId ? `网站 ${siteId}` : '当前网站'
  const providers = inspection.providerNames.join('、') || '人机验证'
  return `${prefix} 在「${inspection.stage}」阶段等待 ${providers}。请在保留的浏览器页面完成官方验证；检测到验证通过后将自动继续。`
}

/**
 * Wait for the page's official widget to provide a response. This function is
 * deliberately observational: it does not click the widget or mutate fields.
 */
export async function waitForHumanVerification(page, {
  stage = HUMAN_VERIFICATION_STAGES.FORM,
  policy,
  signal,
  onStateChange
} = {}) {
  const settings = normalizeHumanVerificationPolicy(policy)
  const startedAt = Date.now()
  let previousFingerprint = ''

  while (Date.now() - startedAt <= settings.timeoutMs) {
    const inspection = await inspectHumanVerification(page, {stage})
    const fingerprint = stableVerificationFingerprint(inspection)
    if (fingerprint !== previousFingerprint) {
      previousFingerprint = fingerprint
      await onStateChange?.(inspection)
    }

    if (inspection.canContinue) {
      return {
        status: inspection.state === 'verified' ? 'verified' : 'not-required',
        inspection,
        waitedMs: Date.now() - startedAt
      }
    }

    await sleepWithSignal(settings.pollMs, signal)
  }

  const inspection = await inspectHumanVerification(page, {stage})
  return {
    status: 'timed-out',
    inspection,
    waitedMs: Date.now() - startedAt
  }
}

/**
 * Check one workflow stage without blocking the rest of a batch. When a
 * challenge is pending, the caller supplies the already-authorized next step
 * as onVerified; HumanVerificationQueue invokes it once the page reports a
 * valid official verification state.
 */
export async function checkpointHumanVerification(queue, {
  siteId,
  page,
  stage = HUMAN_VERIFICATION_STAGES.FORM,
  onVerified
} = {}) {
  if (!(queue instanceof HumanVerificationQueue)) {
    throw new Error('A HumanVerificationQueue is required for a checkpoint')
  }

  const inspection = await inspectHumanVerification(page, {stage})
  if (inspection.canContinue) {
    return {
      status: inspection.state === 'verified' ? 'verified' : 'not-required',
      inspection,
      prompt: null
    }
  }

  queue.add({siteId, page, stage, onVerified})
  const update = {
    siteId,
    stage,
    status: 'waiting-human-verification',
    inspection,
    prompt: humanVerificationPrompt(inspection, {siteId})
  }
  await queue.onUpdate?.(update)
  return update
}

/**
 * Non-blocking batch coordinator. Add a page at any verification stage, keep
 * working on other pages, and call poll() from the batch loop. A continuation
 * is invoked once only after the official verification state becomes usable.
 */
export class HumanVerificationQueue {
  constructor({policy, onUpdate} = {}) {
    this.policy = normalizeHumanVerificationPolicy(policy)
    this.onUpdate = onUpdate
    this.entries = new Map()
    this.polling = null
    this.monitor = null
  }

  add({siteId, page, stage = HUMAN_VERIFICATION_STAGES.FORM, onVerified} = {}) {
    if (!siteId) throw new Error('Human-verification queue siteId is required')
    if (!page) throw new Error('Human-verification queue page is required')
    const entry = {
      siteId,
      page,
      stage,
      onVerified,
      createdAt: Date.now(),
      status: 'waiting-human-verification',
      resumeAttempted: false,
      lastInspection: null,
      lastFingerprint: ''
    }
    this.entries.set(siteId, entry)
    return entry
  }

  remove(siteId) {
    return this.entries.delete(siteId)
  }

  snapshot() {
    return [...this.entries.values()].map((entry) => ({
      siteId: entry.siteId,
      stage: entry.stage,
      status: entry.status,
      url: entry.lastInspection?.url ?? entry.page.url(),
      prompt: entry.lastInspection ? humanVerificationPrompt(entry.lastInspection, {siteId: entry.siteId}) : null,
      waitedMs: Date.now() - entry.createdAt
    }))
  }

  /** Start non-blocking polling while the batch runner continues other sites. */
  start() {
    if (this.monitor) return this.stop.bind(this)
    const run = () => {
      void this.poll().catch(async (error) => {
        await this.onUpdate?.({
          status: 'monitor-error',
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }
    this.monitor = setInterval(run, this.policy.pollMs)
    run()
    return this.stop.bind(this)
  }

  stop() {
    if (!this.monitor) return false
    clearInterval(this.monitor)
    this.monitor = null
    return true
  }

  async poll() {
    if (this.polling) return this.polling
    this.polling = this.#pollEntries()
    try {
      return await this.polling
    } finally {
      this.polling = null
    }
  }

  async #pollEntries() {
    const updates = []
    for (const entry of this.entries.values()) {
      if (entry.status !== 'waiting-human-verification') continue

      const inspection = await inspectHumanVerification(entry.page, {stage: entry.stage})
      const fingerprint = stableVerificationFingerprint(inspection)
      entry.lastInspection = inspection

      if (fingerprint !== entry.lastFingerprint) {
        entry.lastFingerprint = fingerprint
        const update = {
          siteId: entry.siteId,
          stage: entry.stage,
          status: entry.status,
          inspection,
          prompt: humanVerificationPrompt(inspection, {siteId: entry.siteId})
        }
        updates.push(update)
        await this.onUpdate?.(update)
      }

      if (inspection.canContinue) {
        entry.status = inspection.state === 'verified' ? 'verified' : 'not-required'
        const update = {
          siteId: entry.siteId,
          stage: entry.stage,
          status: entry.status,
          inspection,
          prompt: null
        }
        updates.push(update)
        await this.onUpdate?.(update)

        if (!entry.resumeAttempted && entry.onVerified) {
          entry.resumeAttempted = true
          try {
            await entry.onVerified({siteId: entry.siteId, page: entry.page, stage: entry.stage, inspection})
            entry.status = 'resumed'
          } catch (error) {
            entry.status = 'resume-error'
            entry.resumeError = error instanceof Error ? error.message : String(error)
          }
          const resumed = {
            siteId: entry.siteId,
            stage: entry.stage,
            status: entry.status,
            inspection,
            error: entry.resumeError
          }
          updates.push(resumed)
          await this.onUpdate?.(resumed)
        }
      } else if (Date.now() - entry.createdAt > this.policy.timeoutMs) {
        entry.status = 'timed-out'
        const update = {
          siteId: entry.siteId,
          stage: entry.stage,
          status: entry.status,
          inspection,
          prompt: humanVerificationPrompt(inspection, {siteId: entry.siteId})
        }
        updates.push(update)
        await this.onUpdate?.(update)
      }
    }
    return updates
  }

  async watch({signal} = {}) {
    while (!signal?.aborted && [...this.entries.values()].some((entry) => entry.status === 'waiting-human-verification')) {
      await this.poll()
      if ([...this.entries.values()].some((entry) => entry.status === 'waiting-human-verification')) {
        await sleepWithSignal(this.policy.pollMs, signal)
      }
    }
    return this.snapshot()
  }
}

export async function preflightSubmissionPage(page) {
  const body = normalizeVisibleText(await page.locator('body').innerText().catch(() => ''))
  const humanVerification = await inspectHumanVerification(page, {stage: HUMAN_VERIFICATION_STAGES.ENTRY})
  const requiresAuth = /sign in|log in|login|entrar|create an account|cadastre-se/i.test(body)
  const paidOnly = /paid only|payment required|premium only|somente premium/i.test(body)
  const dates = await page.locator('select option').evaluateAll((elements) => elements.map((element) => ({
    text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
    disabled: element.disabled
  }))).catch(() => [])
  const freeDates = dates.filter((option) => !option.disabled && (parseFreeSlotCount(option.text) ?? 0) > 0)
  return {
    url: page.url(),
    hasCaptcha: humanVerification.state === 'waiting-human-verification',
    humanVerification,
    requiresAuth,
    paidOnly,
    freeDateCount: freeDates.length,
    freeDates
  }
}

/**
 * Collect one redacted, stable snapshot for an LLM planner. The planner gets
 * semantic metadata and visible text, while execution keeps using live
 * Playwright locators. Values for password/token fields are never returned.
 */
export async function extractSubmissionSnapshot(page, {maxBodyChars = 9000, maxControls = 160} = {}) {
  return page.evaluate(({maxBodyChars, maxControls}) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    const controls = [...document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="button"]')]
      .filter(visible)
      .slice(0, maxControls)
      .map((element, index) => {
        const type = String(element.getAttribute('type') || element.tagName || '').toLowerCase()
        const name = clean(element.getAttribute('name'))
        const id = clean(element.id)
        const label = element.labels?.[0]?.innerText || element.getAttribute('aria-label') || ''
        const sensitive = /password|token|secret|captcha|verification|card|cvv|bank/i.test(`${name} ${id} ${label} ${type}`)
        const options = element.tagName === 'SELECT'
          ? [...element.options].slice(0, 80).map((option) => ({text: clean(option.textContent), value: option.value, disabled: option.disabled}))
          : undefined
        return {
          ref: `control-${index}`,
          tag: element.tagName.toLowerCase(),
          type,
          name,
          id,
          label: clean(label),
          placeholder: clean(element.getAttribute('placeholder')),
          text: clean(element.innerText || element.textContent).slice(0, 180),
          required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
          checked: Boolean(element.checked || element.getAttribute('aria-checked') === 'true'),
          value: sensitive ? '[redacted]' : clean(element.value).slice(0, 240),
          options
        }
      })
    const body = clean(document.body?.innerText || '').slice(0, maxBodyChars)
    const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 80).map((element) => ({
      text: clean(element.innerText).slice(0, 120), href: element.href
    }))
    return {version: 1, url: window.location.href, origin: window.location.origin, title: document.title, body, controls, links}
  }, {maxBodyChars, maxControls})
}

function plannerProfileSummary(context) {
  const profile = context?.profile || {}
  return {
    productName: profile.productName || '',
    websiteUrl: profile.websiteUrl || '',
    shortDescription: profile.shortDescription || '',
    longDescription: profile.longDescription || '',
    category: profile.category || '',
    keywords: profile.keywords || '',
    tags: profile.tags || '',
    allowedGeneratedFields: DEFAULT_MISSING_FIELD_POLICY.generatedFields,
    protectedFields: DEFAULT_MISSING_FIELD_POLICY.protectedFields
  }
}

/** Build the single prompt sent to the model for a site inspection. */
export function buildSubmissionPlannerPrompt({snapshot, context} = {}) {
  if (!snapshot) throw new Error('A page snapshot is required')
  return [
    'You are planning a truthful product-directory submission.',
    'Return JSON only. Do not invent contact, identity, address, date, price, metric, legal, payment, backlink, or credential data.',
    'Use controlRef values exactly as provided. Prefer free plans. Set submitAllowed=false for paid-only, authentication, or human-verification blockers.',
    'Allowed action types: fill, select, check, upload, submit. A submit action must use type="submit" and the final plan must pass the free-plan check.',
    'For profile fields, use valueKey (for example websiteUrl, productName, shortDescription, longDescription, contactEmail).',
    'For safe descriptive fields only, value may be generated and must be listed in generatedFields.',
    '',
    'Expected JSON shape:',
    JSON.stringify({
      pageType: 'public_form', plan: 'free', submitAllowed: true, humanGate: null,
      generatedFields: [], omissions: [], actions: [
        {type: 'fill', controlRef: 'control-0', field: 'Website URL', valueKey: 'websiteUrl'},
        {type: 'select', controlRef: 'control-1', field: 'Category', optionText: 'AI Tools'}
      ]
    }),
    '',
    `PROFILE:\n${JSON.stringify(plannerProfileSummary(context))}`,
    `PAGE SNAPSHOT:\n${JSON.stringify(snapshot)}`
  ].join('\n')
}

const PLAN_ACTION_TYPES = new Set(['fill', 'select', 'check', 'upload', 'submit'])

/** Validate and normalize untrusted model output before any browser action. */
export function normalizeSubmissionPlan(plan = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('Submission planner returned a non-object plan')
  const actions = Array.isArray(plan.actions) ? plan.actions : []
  const normalizedActions = actions.map((action, index) => {
    if (!action || typeof action !== 'object') throw new Error(`Submission plan action ${index} is invalid`)
    const type = String(action.type || '').toLowerCase()
    if (!PLAN_ACTION_TYPES.has(type)) throw new Error(`Unsupported submission plan action: ${type}`)
    if (!/^control-\d+$/.test(String(action.controlRef || ''))) {
      throw new Error(`Submission plan action ${index} has an invalid controlRef`)
    }
    if (type === 'submit' && action.valueKey) throw new Error('Submit actions cannot contain valueKey')
    if (type === 'select' && !String(action.optionText || '').trim()) throw new Error('Select actions require optionText')
    if (type === 'upload' && !String(action.assetKey || '').trim()) throw new Error('Upload actions require assetKey')
    return {
      type,
      controlRef: String(action.controlRef),
      field: String(action.field || ''),
      valueKey: action.valueKey ? String(action.valueKey) : '',
      value: action.value == null ? '' : String(action.value),
      optionText: action.optionText ? String(action.optionText) : '',
      assetKey: action.assetKey ? String(action.assetKey) : '',
      required: Boolean(action.required),
      requiresCorporateEmail: Boolean(action.requiresCorporateEmail)
    }
  })
  return {
    version: 1,
    pageType: String(plan.pageType || 'unknown'),
    plan: String(plan.plan || 'unknown'),
    submitAllowed: plan.submitAllowed === true,
    humanGate: plan.humanGate ? String(plan.humanGate) : null,
    generatedFields: Array.isArray(plan.generatedFields) ? plan.generatedFields.map(String) : [],
    omissions: Array.isArray(plan.omissions) ? plan.omissions.map(String) : [],
    actions: normalizedActions
  }
}

function planCacheKey(snapshot) {
  const controls = (snapshot.controls || []).map((control) => [control.tag, control.type, control.name, control.id, control.label, control.placeholder].join('|')).join('||')
  return `${snapshot.origin}${new URL(snapshot.url).pathname}|${controls}`
}

/** In-memory domain/route plan cache; invalidate it when the control signature changes. */
export class SubmissionPlanCache {
  constructor() { this.entries = new Map() }
  get(snapshot) { return this.entries.get(planCacheKey(snapshot)) || null }
  set(snapshot, plan) { this.entries.set(planCacheKey(snapshot), normalizeSubmissionPlan(plan)); return plan }
  clear() { this.entries.clear() }
}

/** Run one planner call per stable page, falling back to a cached plan. */
export async function planSubmissionPage({page, context, planner, cache} = {}) {
  if (!page || typeof planner !== 'function') throw new Error('page and planner are required')
  const snapshot = await extractSubmissionSnapshot(page)
  const cached = cache?.get(snapshot)
  if (cached) return {snapshot, plan: cached, source: 'cache', prompt: null}
  const prompt = buildSubmissionPlannerPrompt({snapshot, context})
  const raw = await planner({prompt, snapshot, profile: plannerProfileSummary(context)})
  const parsed = typeof raw === 'string' ? parsePlannerJson(raw) : raw
  const plan = normalizeSubmissionPlan(parsed)
  cache?.set(snapshot, plan)
  return {snapshot, plan, source: 'model', prompt}
}

/**
 * Optional OpenAI-compatible adapter for the standalone CDP runner. Secrets
 * are supplied at runtime and are never logged or persisted by this module.
 */
export function createOpenAICompatiblePlanner({baseUrl, apiKey, model, temperature = 0} = {}) {
  if (!baseUrl || !apiKey || !model) throw new Error('baseUrl, apiKey and model are required')
  return async ({prompt}) => {
    const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({model, temperature, response_format: {type: 'json_object'}, messages: [
        {role: 'system', content: 'Return only valid JSON matching the requested submission plan shape.'},
        {role: 'user', content: prompt}
      ]})
    })
    if (!response.ok) throw new Error(`Planner API HTTP ${response.status}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (!content) throw new Error('Planner API returned no message content')
    return content
  }
}

function parsePlannerJson(value) {
  const text = String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Submission planner did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function controlLocator(page, snapshot, controlRef) {
  const index = Number(String(controlRef).replace('control-', ''))
  const descriptor = snapshot?.controls?.[index]
  if (!descriptor) throw new Error(`Unknown controlRef: ${controlRef}`)
  if (descriptor.id) return page.locator(`[id="${descriptor.id.replaceAll('"', '\\"')}"]`).first()
  if (descriptor.name) return page.locator(`[name="${descriptor.name.replaceAll('"', '\\"')}"]`).first()
  if (descriptor.placeholder) return page.getByPlaceholder(descriptor.placeholder, {exact: true}).first()
  return page.locator(':is(input, textarea, select, button, [role="combobox"], [role="button"]):visible').nth(index)
}

function plannerValue(context, action) {
  if (action.valueKey) {
    return resolveSubmissionField(context, {
      field: action.field || action.valueKey,
      required: action.required,
      requiresCorporateEmail: action.requiresCorporateEmail
    })
  }
  if (action.value && canGenerateField(action.field, DEFAULT_MISSING_FIELD_POLICY)) {
    return {field: action.field, value: action.value, source: 'generated', generated: true}
  }
  return {field: action.field, value: '', source: 'missing', generated: false, reason: 'planner supplied no value'}
}

/** Execute a validated plan with one continuous Playwright pass. */
export async function executeSubmissionPlan(page, context, snapshot, plan, {onAction} = {}) {
  const normalized = normalizeSubmissionPlan(plan)
  if (!normalized.submitAllowed && normalized.actions.some((action) => action.type === 'submit')) {
    throw new Error('Submission plan disallows submit but contains a submit action')
  }
  const records = []
  for (const action of normalized.actions) {
    const target = controlLocator(page, snapshot, action.controlRef)
    if (action.type === 'fill') {
      const resolution = plannerValue(context, action)
      if (!resolution.value) {
        if (action.required) throw new Error(`Required field unavailable: ${action.field}`)
        records.push({...action, status: 'omitted', resolution})
        continue
      }
      await target.fill(resolution.value)
      records.push({...action, status: 'filled', resolution})
    } else if (action.type === 'select') {
      await target.click()
      const selected = await exactTextLocator(page, action.optionText, '[role="option"], button, label')
      if (!selected) throw new Error(`Exact option not found: ${action.optionText}`)
      await selected.click()
      records.push({...action, status: 'selected', resolution: {value: action.optionText, source: 'planner', generated: false}})
    } else if (action.type === 'check') {
      if (!(await target.isChecked().catch(() => false))) await target.check()
      records.push({...action, status: 'checked'})
    } else if (action.type === 'upload') {
      const asset = context?.assets?.[action.assetKey]
      if (!asset || Array.isArray(asset)) throw new Error(`Upload asset unavailable: ${action.assetKey}`)
      await target.setInputFiles(asset)
      records.push({...action, status: 'uploaded', asset})
    } else if (action.type === 'submit') {
      await assertFreePlan(page)
      const verification = await inspectHumanVerification(page, {stage: HUMAN_VERIFICATION_STAGES.PRE_SUBMIT})
      if (!verification.canContinue) throw new Error(`Human verification required: ${verification.providerNames.join(', ')}`)
      await target.click()
      records.push({...action, status: 'submitted'})
    }
    await onAction?.({action, records: records.at(-1)})
  }
  return {plan: normalized, records, generatedFields: records.filter((record) => record.resolution?.generated).map((record) => record.field)}
}

export async function captureSubmissionEvidence(page) {
  const body = await page.locator('body').innerText().catch(() => '')
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const statusLines = lines.filter((line) => /success|submitted|scheduled|launch|approved|published|captcha|verify|error|failed|no free slot|disabled/i.test(line)).slice(0, 40)
  const apiResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\/api\//i.test(name))
    .slice(-30)).catch(() => [])
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    statusLines,
    apiResources,
    humanVerification: await inspectHumanVerification(page),
    capturedAt: new Date().toISOString()
  }
}

export async function connectToBitBrowser({endpoint = DEFAULT_CDP_ENDPOINT} = {}) {
  // createRequire keeps compatibility with the bundled Node runtime's NODE_PATH.
  const {chromium} = require('playwright')
  return chromium.connectOverCDP(endpoint, {timeout: 8000})
}

export async function openBitBrowserProfile({
  profileId,
  apiBase = DEFAULT_LOCAL_API,
  queue = true
} = {}) {
  if (!profileId) throw new Error('BitBrowser profileId is required')
  const response = await fetch(`${apiBase}/browser/open`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id: profileId, queue})
  })
  if (!response.ok) throw new Error(`BitBrowser Local API HTTP ${response.status}`)
  const result = await response.json()
  if (!result.success) throw new Error(`BitBrowser Local API: ${result.msg || 'open failed'}`)
  const data = result.data || {}
  if (!data.ws && !data.http) throw new Error('BitBrowser Local API returned no CDP endpoint')
  return data
}

export async function connectBitBrowserProfile(options = {}) {
  const opened = await openBitBrowserProfile(options)
  const browser = await connectToBitBrowser({endpoint: opened.ws || opened.http})
  return {browser, profile: opened}
}

/** Disconnect the Playwright client without sending Browser.close to BitBrowser. */
export function disconnectFromBitBrowser(browser) {
  browser?.disconnect?.()
}

export async function newSubmissionPage(browserContext, url) {
  const page = await browserContext.newPage()
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000})
  await waitForStable(page, {timeout: 12000})
  return page
}

export async function listContextPages(browserContext) {
  return Promise.all(browserContext.pages().map(async (page, index) => ({
    index,
    url: page.url(),
    title: await page.title().catch(() => '')
  })))
}
