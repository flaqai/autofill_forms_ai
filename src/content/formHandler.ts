import {
  completeEvaluationSession,
  createEvaluationSession,
  createEvaluationSessionId,
  readEvaluationSession,
  recordEvaluationFieldReview,
  type EvaluationFieldRecord,
  type EvaluationIssue,
  type EvaluationPageStatus
} from '../utils/evaluationLogs'
import { optimizeImageForInput } from './imageUploadOptimizer'

// Content script for form extraction and filling

interface StoredProductAsset {
  dataUrl: string
  fileName: string
  mimeType: string
  updatedAt: number
}

const PRODUCT_ASSET_REFERENCE_PREFIX = 'stored-product-asset://'
const PRODUCT_ASSET_STORAGE_PREFIX = 'chat4o-product-asset:'

function isStoredAssetReference(
  value: unknown
): value is `${typeof PRODUCT_ASSET_REFERENCE_PREFIX}${string}` {
  return typeof value === 'string' && value.startsWith(PRODUCT_ASSET_REFERENCE_PREFIX)
}

function assetIdFromReference(value: unknown) {
  return isStoredAssetReference(value)
    ? value.slice(PRODUCT_ASSET_REFERENCE_PREFIX.length)
    : ''
}

function storedAssetStorageKey(assetId: string) {
  return `${PRODUCT_ASSET_STORAGE_PREFIX}${assetId}`
}

interface ExtractedFormField {
  id: string
  name: string
  type: string
  tagName: string
  placeholder: string
  label: string
  context: string
  maxLength?: number
  value: string
  required: boolean
  invalid?: boolean
  validationMessage?: string
  elementIndex: number
  accept?: string
  multiple?: boolean
  options?: Array<{
    label: string
    value: string
  }>
  isCustomSelect?: boolean
}

interface FillMapping {
  fieldId: string
  value: string | boolean | AssetFillValue
  source?: string
  confidence?: number
  reason?: string
}

interface AssetFillValue {
  assetUrls: string[]
}

interface VirtualPlanChoiceOption {
  element: HTMLButtonElement
  label: string
  value: string
  noCost: boolean
  paid: boolean
}

interface VirtualPlanChoiceGroup {
  container: HTMLElement
  label: string
  options: VirtualPlanChoiceOption[]
  anchor: HTMLButtonElement
}

interface FilledFieldRecord {
  key: string
  originalValue: string
  autoFilledValue: string
  sessionId: string
  field: ExtractedFormField
  mapping?: FillMapping
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
  control: HTMLDivElement
}

interface RichTextEditor {
  setContent?: (content: string) => void
  getContent?: (options?: { format?: string }) => string
  save?: () => void
}

interface RichTextWindow extends Window {
  tinymce?: {
    get?: (id: string) => RichTextEditor | undefined
  }
}

let lastExtractedFields: ExtractedFormField[] = []
const filledFieldRecords = new Map<string, FilledFieldRecord>()
const learnFieldControls = new Map<string, HTMLDivElement>()
const acceptedFileInputNames = new WeakMap<HTMLInputElement, string[]>()
const acceptedVirtualFileNames = new WeakMap<HTMLElement, string[]>()
const acceptedCustomSelectValues = new WeakMap<HTMLElement, string>()
const acceptedVirtualPlanChoices = new WeakMap<HTMLElement, string>()
let activeEvaluationSessionId = ''
let evaluationWidget: HTMLDivElement | null = null

let lastActivityReportAt = 0
let controlRefreshTimer: number | undefined

function reportFillableTabActivity() {
  const now = Date.now()
  if (now - lastActivityReportAt < 1000) return
  lastActivityReportAt = now

  chrome.runtime.sendMessage({ action: 'rememberFillableTab' }).catch(() => {
    // Ignore: the background service worker may be restarting.
  })
}

function isVisibleControl(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.pointerEvents !== 'none' &&
    rect.width > 0 &&
    rect.height > 0
}

function isAriaCheckboxControl(element: HTMLElement) {
  return element.getAttribute('role') === 'checkbox' &&
    element.hasAttribute('aria-checked') &&
    isVisibleControl(element)
}

function isHiddenNativeCheckboxProxy(element: HTMLElement) {
  if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') return false

  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const visuallyHidden = element.getAttribute('aria-hidden') === 'true' ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0 ||
    rect.width <= 1 ||
    rect.height <= 1
  if (!visuallyHidden) return false

  let container: HTMLElement | null = element.parentElement
  for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
    const proxies = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked]'))
      .filter((candidate) => candidate !== element && isAriaCheckboxControl(candidate))
    if (proxies.length === 1) return true
  }

  return false
}

function semanticPickerIdentity(element: HTMLElement) {
  const explicitLabel = element.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${escapeSelectorValue(element.id)}"]`)?.textContent
    : ''
  const labelledBy = element.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ')
  const parentLabel = element.closest('label')?.textContent || ''
  const fieldsetLegend = element.closest('fieldset')?.querySelector('legend')?.textContent || ''
  const nearbyContainer = element.closest<HTMLElement>('[role="group"], .field, .form-group, .control-group, [data-field]')
  let precedingLabel = ''
  let node: HTMLElement | null = element
  for (let depth = 0; node?.parentElement && depth < 4 && !precedingLabel; depth++) {
    let sibling = node.previousElementSibling as HTMLElement | null
    while (sibling) {
      const text = compactWhitespace(sibling.innerText || sibling.textContent || '')
      if (text && text.length <= 120) {
        precedingLabel = text
        break
      }
      sibling = sibling.previousElementSibling as HTMLElement | null
    }
    node = node.parentElement
  }
  return compactWhitespace([
    element.id,
    element.getAttribute('name'),
    (element as HTMLInputElement).placeholder,
    element.getAttribute('aria-label'),
    explicitLabel,
    labelledBy,
    parentLabel,
    fieldsetLegend,
    precedingLabel,
    nearbyContainer?.innerText || nearbyContainer?.textContent || ''
  ].filter(Boolean).join(' ')).slice(0, 500).toLowerCase()
}

function isSemanticSearchSelectControl(element: HTMLElement) {
  if (!(element instanceof HTMLInputElement)) return false
  if (!['text', 'search'].includes(element.type)) return false

  const identity = semanticPickerIdentity(element)
  const hasSubmissionTaxonomy = /\b(category|categories|tags?|topics?|segments?|industr(?:y|ies)|markets?|verticals?|sectors?|use cases?)\b/.test(identity)
  const hasPickerCue = /\b(search|select|choose|pick|add)\b/.test(identity)
  return hasSubmissionTaxonomy && hasPickerCue
}

function isCustomSelectControl(element: HTMLElement) {
  return !(element instanceof HTMLSelectElement) && (
    element.getAttribute('role') === 'combobox' ||
    isSemanticSearchSelectControl(element)
  )
}

function strictBooleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (/^(true|yes|y|1|on|checked|check|agree|agreed|accept|accepted|是|同意|接受|勾选|勾選)$/.test(normalized)) return true
  if (/^(false|no|n|0|off|unchecked|uncheck|disagree|decline|declined|否|不同意|不接受|取消勾选|取消勾選)$/.test(normalized)) return false
  return null
}

function ariaCheckboxState(element: HTMLElement) {
  if (!isAriaCheckboxControl(element)) return null
  const state = element.getAttribute('aria-checked')
  if (state === 'true') return true
  if (state === 'false') return false
  return null
}

function isUnsafeOptionalCheckboxControl(element: HTMLElement) {
  const required = (element instanceof HTMLInputElement && element.required) ||
    element.getAttribute('aria-required') === 'true' ||
    element.closest('[aria-required="true"]') !== null
  if (required) return false

  const text = normalizeText(getFieldContext(element))
  return /\b(newsletter|subscribe|marketing|advertis|promotion|promoted|featured|premium|sponsored|upgrade|paid|payment|billing|credit card|donation|tip jar|contact me|send me|email me|commercial interests?)\b/.test(text)
}

function isAutofillControlElement(element: HTMLElement) {
  if (element instanceof HTMLInputElement) {
    const isSemanticPicker = isSemanticSearchSelectControl(element)
    if (
      element.type === 'hidden' ||
      element.type === 'submit' ||
      element.type === 'button' ||
      element.type === 'image' ||
      element.type === 'password' ||
      (element.type === 'search' && !isSemanticPicker)
    ) {
      return false
    }

    if (isHiddenNativeCheckboxProxy(element)) return false

    const hasAccessibleIdentity = Boolean([
      element.id,
      element.name,
      element.placeholder,
      element.getAttribute('aria-label'),
      element.getAttribute('aria-labelledby'),
      element.title
    ].find(Boolean))
    const isContentEditableHelper = element.classList.contains('editableFix') || Boolean(
      element.tabIndex < 0 &&
      !hasAccessibleIdentity &&
      element.parentElement?.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')
    )
    if (isContentEditableHelper) return false

    if (element.tabIndex < 0 && element.autocomplete === 'off') return false
  }

  if ('readOnly' in element && element.readOnly) return false

  const identifier = [
    element.id,
    element.getAttribute('name'),
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
    element.getAttribute('title')
  ].filter(Boolean).join(' ').toLowerCase()
  const nearbyContainer = element.closest<HTMLElement>('tr, label, [role="group"], .field, .form-group, .control-group')
  const nearbyText = compactWhitespace(nearbyContainer?.innerText || nearbyContainer?.textContent || '').slice(0, 240).toLowerCase()

  if (
    /(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier) &&
    !isSemanticSearchSelectControl(element)
  ) {
    return false
  }

  if (/\b(captcha|validation code|verification code|security code|auth code|enter (?:the )?code shown)\b/.test(nearbyText)) {
    return false
  }

  if (/(^|[_\s-])(limit|counter|char[\s_-]*count|max[\s_-]*length)([_\s-]|$)/.test(identifier)) {
    return false
  }

  if (/\b(honeypot|honey[\s_-]*pot|spam[\s_-]*trap|website[\s_-]*confirm|url[\s_-]*confirm|site[\s_-]*confirm)\b/.test(identifier)) {
    return false
  }

  return true
}

function submissionFormScore(form: HTMLFormElement) {
  const fieldIdentity = Array.from(form.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable], [role="combobox"]'))
    .map((field) => [
      field.id,
      field.getAttribute('name'),
      field.getAttribute('placeholder'),
      field.getAttribute('aria-label')
    ].filter(Boolean).join(' '))
    .join(' ')
  const text = compactWhitespace([
    form.id,
    form.getAttribute('name'),
    form.getAttribute('action'),
    fieldIdentity,
    textSnippet(form.innerText || form.textContent || '', 1800)
  ].filter(Boolean).join(' ')).toLowerCase()

  let score = 0
  if (/\b(title|product name|tool name|startup name|site name|project name|headline)\b/.test(text)) score += 3
  if (/\b(url|website|homepage|home page|domain|product link|tool link|site link)\b/.test(text)) score += 4
  if (/\b(description|overview|introduction|details|about|tagline|pitch)\b/.test(text)) score += 4
  if (/\b(category|categories|industry|tags|keywords)\b/.test(text)) score += 2
  if (/\b(owner email|your email|contact email|company email|submitter email)\b/.test(text)) score += 1
  if (/\b(submit|suggest|add|publish|continue|review)\b/.test(text)) score += 1
  if (/\b(register|registration|sign up|signup|create account|join now)\b/.test(text)) score += 4
  if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(text)) score -= 8
  if (/\b(search|newsletter|subscribe)\b/.test(text)) score -= 6
  return score
}

function isEditableContentControl(element: HTMLElement) {
  const contentEditable = element.getAttribute('contenteditable')?.toLowerCase()
  return element.isContentEditable || contentEditable === 'true' || contentEditable === 'plaintext-only'
}

function isVirtualFileControl(element: HTMLElement) {
  if (element instanceof HTMLInputElement) return false
  if (element.closest('[role="dialog"]')) return false

  const text = compactWhitespace(element.innerText || element.textContent || '')
  if (!text || text.length > 180) return false
  if (!/(?:drop|drag).{0,40}files?.{0,50}(?:browse|choose|select)|(?:browse|choose|select).{0,30}files?/i.test(text)) {
    return false
  }

  const rect = element.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 12) return false

  return !Array.from(element.children).some((child) => {
    if (!(child instanceof HTMLElement)) return false
    const childText = compactWhitespace(child.innerText || child.textContent || '')
    const childRect = child.getBoundingClientRect()
    return childText === text && childRect.width >= 40 && childRect.height >= 12
  })
}

const PLAN_GROUP_LABEL_PATTERN = /\b(?:choose(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|select(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|listing\s+(?:plan|tier|option|type)|submission\s+(?:plan|tier|option)|(?:plan|tier)\s+(?:choice|option))\b/i
const PLAN_FORBIDDEN_ACTION_PATTERN = /\b(?:pay|payment|checkout|purchase|buy|upgrade|subscribe|continue|next|submit|publish|confirm|finish|proceed|save)\b/i

function currencyAmountFromText(value: string) {
  const symbolMatch = value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*(\d+(?:[.,]\d{1,2})?)/i)
  if (symbolMatch) return Number(symbolMatch[1].replace(',', '.'))
  const codeMatch = value.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)
  return codeMatch ? Number(codeMatch[1].replace(',', '.')) : null
}

function planPriceText(value: string) {
  const noCost = value.match(/\b(?:free|no[\s-]?cost)\b/i)
  if (noCost) return noCost[0]
  const symbolPrice = value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*\d+(?:[.,]\d{1,2})?/i)
  if (symbolPrice) return symbolPrice[0]
  const codePrice = value.match(/\d+(?:[.,]\d{1,2})?\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)
  return codePrice?.[0] || ''
}

function virtualPlanOptionLabel(button: HTMLButtonElement) {
  const fullText = compactWhitespace(button.innerText || button.textContent || '')
  const price = planPriceText(fullText)
  const heading = Array.from(button.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"], strong'))
    .map((element) => compactWhitespace(element.innerText || element.textContent || ''))
    .find((text) => text && text.length <= 90 && !/^\s*(?:free|no[\s-]?cost|(?:US\$|CA\$|AU\$|[$€£¥])?\s*\d)/i.test(text))
  const lines = (button.innerText || button.textContent || '')
    .split(/\r?\n/)
    .map(compactWhitespace)
    .filter(Boolean)
  const fallbackTitle = lines.find((line) => (
    line.length <= 90 &&
    !planPriceText(line) &&
    !PLAN_FORBIDDEN_ACTION_PATTERN.test(line)
  )) || ''
  const title = heading || fallbackTitle || compactWhitespace(fullText.replace(price, '')).slice(0, 90)
  if (!title) return ''
  if (!price || normalizeText(title).includes(normalizeText(price))) return compactWhitespace(title)
  return compactWhitespace(`${title} ${price}`)
}

function isNoCostPlanText(value: string) {
  const text = normalizeText(value)
  const amount = currencyAmountFromText(value)
  if (amount !== null && amount > 0) return false
  return /\b(?:free|no cost)\b/.test(text) || amount === 0 ||
    /^(?:regular|regular listing|standard|standard listing)$/.test(text)
}

function isPaidPlanText(value: string) {
  const amount = currencyAmountFromText(value)
  return (amount !== null && amount > 0) || /\bpaid\b/i.test(value)
}

function planGroupLabel(container: HTMLElement) {
  const labelledBy = container.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ')
  const candidates = [
    container.getAttribute('aria-label') || '',
    labelledBy || '',
    ...Array.from(container.querySelectorAll<HTMLElement>('legend, h1, h2, h3, h4, h5, h6, [role="heading"], label'))
      .filter((element) => !element.closest('button'))
      .map((element) => compactWhitespace(element.innerText || element.textContent || ''))
  ]
  return candidates.find((candidate) => candidate.length <= 140 && PLAN_GROUP_LABEL_PATTERN.test(candidate)) || ''
}

function virtualPlanChoiceGroupFor(element: HTMLElement): VirtualPlanChoiceGroup | null {
  if (!(element instanceof HTMLButtonElement) || element.type !== 'button') return null

  let container: HTMLElement | null = element.parentElement
  for (let depth = 0; container && depth < 7; depth++) {
    if (container === document.body || container.tagName === 'FORM') break

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    if (buttons.length < 2 || buttons.length > 6 ||
      buttons.some((button) => button.type !== 'button' || button.getAttribute('type')?.toLowerCase() !== 'button') ||
      buttons.some((button) => !isVisibleControl(button) || button.disabled)) {
      container = container.parentElement
      continue
    }

    const label = planGroupLabel(container)
    if (!label) {
      container = container.parentElement
      continue
    }

    const options = buttons.map<VirtualPlanChoiceOption>((button) => {
      const buttonText = compactWhitespace(button.innerText || button.textContent || '')
      const optionLabel = virtualPlanOptionLabel(button)
      return {
        element: button,
        label: optionLabel,
        value: optionLabel,
        noCost: isNoCostPlanText(`${optionLabel} ${buttonText}`),
        paid: isPaidPlanText(`${optionLabel} ${buttonText}`)
      }
    })
    if (options.some((option) => !option.label)) {
      container = container.parentElement
      continue
    }

    const noCostOptions = options.filter((option) => option.noCost && !option.paid)
    if (noCostOptions.length === 0 || !options.some((option) => option.paid)) {
      container = container.parentElement
      continue
    }

    return {
      container,
      label: compactWhitespace(label),
      options,
      anchor: noCostOptions[0].element
    }
  }

  return null
}

function isVirtualPlanChoiceControl(element: HTMLElement) {
  const group = virtualPlanChoiceGroupFor(element)
  return Boolean(group && group.anchor === element)
}

function getVirtualPlanChoiceControls() {
  const seenContainers = new Set<HTMLElement>()
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
    .map((button) => virtualPlanChoiceGroupFor(button))
    .filter((group): group is VirtualPlanChoiceGroup => Boolean(group && group.anchor === group.options.find((option) => option.noCost && !option.paid)?.element))
    .filter((group) => {
      if (seenContainers.has(group.container)) return false
      seenContainers.add(group.container)
      return true
    })
    .map((group) => group.anchor)
}

function virtualPlanSelectedState(element: HTMLElement) {
  const state = normalizeText([
    element.getAttribute('aria-pressed'),
    element.getAttribute('aria-selected'),
    element.getAttribute('aria-checked'),
    element.getAttribute('data-selected'),
    element.getAttribute('data-state')
  ].filter(Boolean).join(' '))
  if (/\b(?:true|selected|checked|active|on)\b/.test(state)) return true
  return Array.from(element.classList).some((className) => /^(?:is-)?(?:selected|checked|chosen|current)$|^active$/i.test(className))
}

function virtualPlanStyleSignature(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return [
    element.className,
    element.getAttribute('style') || '',
    style.backgroundColor,
    style.borderColor,
    style.borderWidth,
    style.boxShadow,
    style.outlineColor,
    style.outlineWidth
  ].join('|')
}

function exactNoCostPreference(value: unknown) {
  return /^(?:free|no cost|regular|regular listing|standard|standard listing)$/
    .test(normalizeText(String(value ?? '')))
}

function findSafeVirtualPlanOption(group: VirtualPlanChoiceGroup, value: unknown) {
  const desired = normalizeText(String(value ?? ''))
  if (!desired) return null
  const safeOptions = group.options.filter((option) => (
    option.noCost &&
    !option.paid &&
    !PLAN_FORBIDDEN_ACTION_PATTERN.test(compactWhitespace(option.element.innerText || option.element.textContent || ''))
  ))
  const exact = safeOptions.filter((option) => (
    normalizeText(option.label) === desired || normalizeText(option.value) === desired
  ))
  if (exact.length === 1) return exact[0]
  return exactNoCostPreference(value) && safeOptions.length === 1 ? safeOptions[0] : null
}

async function setVirtualPlanChoiceValue(element: HTMLElement, value: unknown) {
  const group = virtualPlanChoiceGroupFor(element)
  if (!group || group.anchor !== element) return false
  const option = findSafeVirtualPlanOption(group, value)
  if (!option) return false

  if (virtualPlanSelectedState(option.element)) {
    acceptedVirtualPlanChoices.set(element, option.label)
    return true
  }

  const beforeStyle = virtualPlanStyleSignature(option.element)
  option.element.click()
  await wait(160)
  option.element.blur()
  await wait(100)

  const semanticallySelected = virtualPlanSelectedState(option.element)
  const selectionStyleChanged = beforeStyle !== virtualPlanStyleSignature(option.element)
  if (!semanticallySelected && !selectionStyleChanged) return false
  if (group.options.some((candidate) => candidate.paid && virtualPlanSelectedState(candidate.element))) return false

  acceptedVirtualPlanChoices.set(element, option.label)
  return true
}

function currentVirtualPlanChoice(element: HTMLElement) {
  const group = virtualPlanChoiceGroupFor(element)
  if (!group || group.anchor !== element) return ''
  const selected = group.options.find((option) => virtualPlanSelectedState(option.element))
  return selected?.label || acceptedVirtualPlanChoices.get(element) || ''
}

function sortElementsInDocumentOrder(elements: HTMLElement[]) {
  return elements.sort((left, right) => {
    if (left === right) return 0
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
}

function keepPrimarySubmissionForms(elements: HTMLElement[]) {
  const scoredForms = Array.from(new Set(
    elements.map((element) => element.closest('form')).filter((form): form is HTMLFormElement => form instanceof HTMLFormElement)
  )).map((form) => ({ form, score: submissionFormScore(form) }))
  const bestScore = Math.max(0, ...scoredForms.map(({ score }) => score))
  if (scoredForms.length <= 1 || bestScore < 3) return elements

  const allowedForms = new Set(
    scoredForms
      .filter(({ score }) => score >= 3 && score >= bestScore - 2)
      .map(({ form }) => form)
  )

  return elements.filter((element) => {
    const form = element.closest('form')
    return !form || allowedForms.has(form)
  })
}

function getFillableElements() {
  // Query every supported control together so synthetic field_N keys follow
  // the real DOM order. Appending rich-text controls after native controls can
  // shift indexes on Airtable-style forms and fill the preceding field.
  const nativeElements = Array.from(document.querySelectorAll<HTMLElement>(
    'input, textarea, select, [role="combobox"], [role="checkbox"][aria-checked], [contenteditable]'
  )).filter((element) => {
    if (!element.matches('[contenteditable]')) return true
    if (!isEditableContentControl(element)) return false
    const parentEditor = element.parentElement?.closest<HTMLElement>('[contenteditable]')
    return !parentEditor || !isEditableContentControl(parentEditor)
  })
  const virtualFileControls = Array.from(document.querySelectorAll<HTMLElement>(
    'button, [role="button"], label, [tabindex], div, span, p'
  )).filter(isVirtualFileControl)
  const virtualPlanChoiceControls = getVirtualPlanChoiceControls()
  const elements = sortElementsInDocumentOrder(Array.from(new Set([
    ...nativeElements,
    ...virtualFileControls,
    ...virtualPlanChoiceControls
  ])))

  const safeElements = elements.filter((el) => {
    if ('disabled' in el && el.disabled) return false
    // File inputs are frequently visually hidden behind a drop zone. Keep
    // them even when sites assign a negative tab index to the native control.
    if (el instanceof HTMLInputElement && el.type === 'file') return true
    return isAutofillControlElement(el)
  })

  const primaryElements = keepPrimarySubmissionForms(safeElements)
  const seenRadioGroups = new Set<string>()

  return primaryElements.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true

    const formIndex = element.form ? Array.from(document.forms).indexOf(element.form) : -1
    const groupKey = `${formIndex}:${element.name}`
    if (seenRadioGroups.has(groupKey)) return false
    seenRadioGroups.add(groupKey)
    return true
  })
}

function getSelectOptions(element: HTMLElement) {
  const virtualPlanGroup = virtualPlanChoiceGroupFor(element)
  if (virtualPlanGroup?.anchor === element) {
    return virtualPlanGroup.options.map((option) => ({
      label: option.label,
      value: option.value
    }))
  }

  if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((candidate) => candidate.name === element.name && candidate.form === element.form)
      .map((candidate) => ({
        label: getRadioOptionLabel(candidate),
        value: candidate.value
      }))
      .filter((option) => option.label)
  }

  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .map((option) => ({
        label: option.textContent?.trim() || option.label || option.value,
        value: option.value
      }))
      .filter((option) => option.label)
  }

  const controls = element.getAttribute('aria-controls')
  const optionRoots = controls ? [document.getElementById(controls)].filter(Boolean) : []
  const visibleOptions = [
    ...optionRoots.flatMap((root) => Array.from(root?.querySelectorAll('[role="option"]') || [])),
    ...Array.from(document.querySelectorAll('[role="listbox"] [role="option"]'))
  ]

  return visibleOptions
    .map((option) => {
      const label = option.textContent?.trim() || ''
      return { label, value: option.getAttribute('data-value') || label }
    })
    .filter((option, index, list) => option.label && list.findIndex((item) => item.label === option.label) === index)
}

function getRadioOptionLabel(element: HTMLInputElement) {
  const explicitLabel = element.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${escapeSelectorValue(element.id)}"]`)
    : null
  const parentLabel = element.closest('label')
  const optionText = explicitLabel?.textContent || parentLabel?.textContent || element.getAttribute('aria-label') || element.value
  return compactWhitespace(optionText || element.value)
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function textSnippet(value: string | null | undefined, maxLength = 320) {
  const compacted = compactWhitespace(value || '')
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted
}

function isWeakFieldLabel(value: string) {
  const label = compactWhitespace(value).toLowerCase()
  return !label ||
    /^(select|select a value|select value|select an option|choose|choose one|choose an option|please select|-- select --|请选择|选择|选择一个)$/.test(label)
}

function looksLikeRichTextToolbar(value: string) {
  const tokens = compactWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
  if (tokens.length === 0 || tokens.length > 18) return false

  const toolbarTokens = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'b', 'i', 'u', 's', 'bold', 'italic', 'underline', 'strike',
    'link', 'quote', 'code', 'bullet', 'ordered', 'unordered', 'list',
    'align', 'left', 'center', 'right', 'undo', 'redo'
  ])
  return tokens.every((token) => toolbarTokens.has(token) || /^h[1-6]$/.test(token))
}

function isUsableFieldLabel(value: string, element?: HTMLElement) {
  const label = compactWhitespace(value)
  if (isWeakFieldLabel(label)) return false
  if (looksLikeRichTextToolbar(label)) return false
  if (label.length > 90) return false

  const currentValue = element ? getCurrentValue(element).trim() : ''
  if (currentValue && label === currentValue) return false

  return /[a-zA-Z\u4e00-\u9fff]/.test(label)
}

function isScrollable(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(`${style.overflow}${style.overflowY}`)
}

async function collectCustomSelectOptions(element: HTMLElement) {
  element.click()
  await wait(160)

  const collected = new Map<string, { label: string; value: string }>()
  const collectVisible = () => {
    ownedVisibleOptionElements(element).forEach((option) => {
      const label = option.textContent?.trim() || ''
      if (label) {
        collected.set(label, {
          label,
          value: option.getAttribute('data-value') || label
        })
      }
    })
  }

  collectVisible()

  const containers = ownedScrollableOptionContainers(element)
  for (const container of containers.slice(0, 3)) {
    const originalScrollTop = container.scrollTop
    container.scrollTop = 0
    await wait(40)
    collectVisible()

    for (let step = 0; step < 30; step++) {
      const previousScrollTop = container.scrollTop
      container.scrollTop += Math.max(120, container.clientHeight * 0.8)
      await wait(30)
      collectVisible()
      if (container.scrollTop === previousScrollTop) break
    }

    container.scrollTop = originalScrollTop
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return Array.from(collected.values())
}

// Extract all form fields from the current page
async function extractFormFields() {
  const fields: ExtractedFormField[] = []

  // Get all input, textarea, and select elements
  const inputs = getFillableElements()

  for (const [index, element] of inputs.entries()) {
    const el = element

    const isCustomSelect = isCustomSelectControl(el)
    const isAriaCheckbox = isAriaCheckboxControl(el)
    const isVirtualFile = isVirtualFileControl(el)
    const isVirtualPlanChoice = isVirtualPlanChoiceControl(el)
    const fieldName = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.name || el.id || `field_${index}`
      : el.getAttribute('name') || el.id || `field_${index}`
    const fieldType = isVirtualFile
      ? 'file'
      : isVirtualPlanChoice
        ? 'select'
      : isCustomSelect
      ? 'select'
      : isAriaCheckbox
        ? 'checkbox'
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? el.type || 'text'
        : isEditableContentControl(el)
          ? 'richtext'
          : 'text'
    const fieldValue = el instanceof HTMLInputElement && el.type === 'radio'
      ? getSelectedRadio(el)
        ? getFieldLabel(getSelectedRadio(el)!) || getSelectedRadio(el)!.value
        : ''
      : isAriaCheckbox
        ? ariaCheckboxState(el) === true ? 'true' : ''
      : el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked ? getFieldLabel(el) || el.value || 'true' : ''
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
          ? el.value || ''
          : isVirtualPlanChoice ? currentVirtualPlanChoice(el) : getCurrentValue(el)
    const options = isCustomSelect ? await collectCustomSelectOptions(el) : getSelectOptions(el)
    const required = el instanceof HTMLInputElement && el.type === 'radio' && el.name
      ? Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
          .filter((candidate) => candidate.name === el.name && candidate.form === el.form)
          .some((candidate) => candidate.required || candidate.getAttribute('aria-required') === 'true')
      : (el instanceof HTMLInputElement && el.required) ||
        el.getAttribute('aria-required') === 'true' ||
        (isAriaCheckbox && el.closest('[aria-required="true"]') !== null)
    const nativeControl = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el
      : null
    const invalid = el.getAttribute('aria-invalid') === 'true' || Boolean(
      nativeControl && fieldValue && !nativeControl.checkValidity()
    )
    const field = {
      id: el.id || `field_${index}`,
      name: fieldName,
      type: fieldType,
      tagName: el.tagName.toLowerCase(),
      placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '',
      label: isVirtualPlanChoice ? virtualPlanChoiceGroupFor(el)?.label || '' : getExtractedFieldLabel(el),
      context: el instanceof HTMLInputElement && el.type === 'file'
        ? uploadContextFor(el)
        : isVirtualFile
          ? getFieldContext(el)
        : getFieldContext(el),
      maxLength: inferFieldMaxLength(el),
      value: fieldValue,
      required,
      invalid,
      validationMessage: invalid && nativeControl ? nativeControl.validationMessage : '',
      elementIndex: index,
      accept: el instanceof HTMLInputElement && el.type === 'file'
        ? el.accept
        : isVirtualFile ? 'image/*' : undefined,
      multiple: el instanceof HTMLInputElement && el.type === 'file' ? el.multiple : false,
      options,
      isCustomSelect: isCustomSelect || isVirtualPlanChoice
    }

    fields.push(field)
  }

  lastExtractedFields = fields
  console.log('[FormExtractor] Extracted fields:', fields.length)
  return fields
}

// Get label text for a form field
function getFieldLabel(element: HTMLElement): string {
  if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
    const fieldsetLegend = element.closest('fieldset')?.querySelector('legend')?.textContent?.trim()
    if (fieldsetLegend) return fieldsetLegend

    const radioGroup = element.closest<HTMLElement>('[role="radiogroup"]')
    const radioGroupLabel = radioGroup ? getAriaLabelledByText(radioGroup) || radioGroup.getAttribute('aria-label') : ''
    if (radioGroupLabel) return compactWhitespace(radioGroupLabel)
  }

  // Try to find associated label
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`)
    if (label) {
      return label.textContent?.trim() || ''
    }
  }

  // Try to find parent label
  const parentLabel = element.closest('label')
  if (parentLabel) {
    return parentLabel.textContent?.trim() || ''
  }

  // Try to find nearby text
  const prev = element.previousElementSibling
  if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN')) {
    return prev.textContent?.trim() || ''
  }

  const tableCell = element.closest('td, th') as HTMLTableCellElement | null
  const tableRow = element.closest('tr')
  if (tableCell && tableRow) {
    const cells = Array.from(tableRow.children).filter(
      (child): child is HTMLTableCellElement => child instanceof HTMLTableCellElement
    )
    const fieldCellIndex = cells.indexOf(tableCell)
    const labelCell = cells
      .slice(0, Math.max(fieldCellIndex, 0))
      .reverse()
      .find((cell) => compactWhitespace(cell.innerText || cell.textContent || ''))
    const label = labelCell ? compactWhitespace(labelCell.innerText || labelCell.textContent || '') : ''
    if (label) return label
  }

  return ''
}

function getExtractedFieldLabel(element: HTMLElement): string {
  const virtualPlanGroup = virtualPlanChoiceGroupFor(element)
  if (virtualPlanGroup?.anchor === element) return virtualPlanGroup.label

  const explicitLabel = getFieldLabel(element)
  if (explicitLabel) return explicitLabel

  const ariaLabelledBy = getAriaLabelledByText(element)
  if (isUsableFieldLabel(ariaLabelledBy, element)) return compactWhitespace(ariaLabelledBy)

  const ariaLabel = element.getAttribute('aria-label') || ''
  if (isUsableFieldLabel(ariaLabel, element)) return compactWhitespace(ariaLabel)

  return getVisualLabelAboveField(element) || getNearbyFieldLabel(element)
}

function getNearbyFieldLabel(element: HTMLElement) {
  let node: HTMLElement | null = element
  let depth = 0

  while (node?.parentElement && depth < 5) {
    let sibling = node.previousElementSibling as HTMLElement | null

    while (sibling) {
      const candidate = getLastUsableTextLine(sibling.innerText || sibling.textContent || '', element)
      if (candidate) return candidate
      sibling = sibling.previousElementSibling as HTMLElement | null
    }

    const parent: HTMLElement = node.parentElement
    const parentLabel = parent.getAttribute('aria-label') || parent.getAttribute('data-label') || ''
    if (isUsableFieldLabel(parentLabel, element)) return compactWhitespace(parentLabel)

    node = parent
    depth++
  }

  return ''
}

function getLastUsableTextLine(value: string, element: HTMLElement) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean)

  for (const line of lines.reverse()) {
    if (isUsableFieldLabel(line, element)) return line
  }

  const compacted = compactWhitespace(value)
  return isUsableFieldLabel(compacted, element) ? compacted : ''
}

function getVisualLabelAboveField(element: HTMLElement) {
  const fieldRect = element.getBoundingClientRect()
  if (fieldRect.width === 0 || fieldRect.height === 0) return ''

  const candidates = Array.from(document.querySelectorAll('label, legend, [aria-label], [data-label], p, span, strong, b, div'))
    .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && !candidate.contains(element))
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const label = getLastUsableTextLine(candidate.innerText || candidate.textContent || '', element)
      const verticalGap = fieldRect.top - rect.bottom
      const horizontalOverlap = Math.max(0, Math.min(fieldRect.right, rect.right) - Math.max(fieldRect.left, rect.left))
      return { label, rect, verticalGap, horizontalOverlap }
    })
    .filter(({ label, rect, verticalGap, horizontalOverlap }) => (
      Boolean(label) &&
      rect.width > 0 &&
      rect.height > 0 &&
      verticalGap >= -6 &&
      verticalGap <= 76 &&
      horizontalOverlap >= Math.min(28, fieldRect.width * 0.25)
    ))
    .sort((left, right) => (
      left.verticalGap - right.verticalGap || right.horizontalOverlap - left.horizontalOverlap
    ))

  return candidates[0]?.label || ''
}

function getAriaDescribedByText(element: HTMLElement) {
  const describedBy = element.getAttribute('aria-describedby')
  if (!describedBy) return ''

  return describedBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .filter(Boolean)
    .join(' ')
}

function getAriaLabelledByText(element: HTMLElement) {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (!labelledBy) return ''

  return labelledBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .filter(Boolean)
    .join(' ')
}

function getFieldContext(element: HTMLElement): string {
  const virtualPlanGroup = virtualPlanChoiceGroupFor(element)
  if (virtualPlanGroup?.anchor === element) {
    return textSnippet(`${virtualPlanGroup.label} | ${compactWhitespace(virtualPlanGroup.container.innerText || virtualPlanGroup.container.textContent || '')}`, 900)
  }

  const pieces = [
    getExtractedFieldLabel(element),
    (element as HTMLInputElement).placeholder || '',
    element.getAttribute('aria-label') || '',
    getAriaLabelledByText(element),
    element.getAttribute('title') || '',
    getAriaDescribedByText(element),
    element.previousElementSibling?.textContent || '',
    element.nextElementSibling?.textContent || ''
  ]

  let parent: HTMLElement | null = element.parentElement
  let depth = 0
  const contextBoundaryTags = new Set(['FORM', 'TABLE', 'TBODY', 'THEAD', 'TFOOT'])
  while (parent && depth < 3) {
    if (contextBoundaryTags.has(parent.tagName)) break
    const text = textSnippet(parent.innerText || parent.textContent || '', 500)
    if (text) pieces.push(text)
    parent = parent.parentElement
    depth++
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    pieces.push(element.validationMessage || '')
  }

  return textSnippet(Array.from(new Set(pieces.map((piece) => compactWhitespace(piece)).filter(Boolean))).join(' | '), 900)
}

function inferFieldMaxLength(element: HTMLElement) {
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.maxLength > 0 &&
    element.maxLength < 10000
  ) {
    return element.maxLength
  }

  const context = getFieldContext(element)
  const counterMatches = Array.from(
    context.matchAll(/(?:^|\D)\d{1,4}\s*\/\s*(\d{1,4})\s*(words?|characters?|chars?)?/gi)
  )
    .filter((match) => {
      const unit = match[2] || ''
      const limit = Number(match[1])
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
    const match = context.match(pattern)
    const value = Number(match?.[1])
    if (value > 0 && value <= 2000) return value
  }

  return undefined
}

function escapeSelectorValue(value: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"')
}

function findElementByKey(key: string) {
  const fillableElements = getFillableElements()

  let element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null

  if (!element) {
    element = document.querySelector(`[name="${escapeSelectorValue(key)}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null
  }

  if (!element) {
    const matchingField = lastExtractedFields.find((field) => field.id === key || field.name === key)
    if (matchingField) {
      element = fillableElements[matchingField.elementIndex] || null
    }
  }

  if (!element) {
    const syntheticFieldMatch = key.match(/^field_(\d+)$/)
    if (syntheticFieldMatch) {
      element = fillableElements[Number(syntheticFieldMatch[1])] || null
    }
  }

  return element
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function plainTextToRichHtml(value: unknown) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return ''

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function richTextFrameFor(element: HTMLTextAreaElement) {
  if (!element.id) return null
  const frame = document.getElementById(`${element.id}_ifr`)
  return frame instanceof HTMLIFrameElement ? frame : null
}

function richTextEditorFor(element: HTMLTextAreaElement) {
  if (!element.id) return undefined
  return (window as RichTextWindow).tinymce?.get?.(element.id)
}

function isRichTextTextarea(element: HTMLTextAreaElement) {
  return Boolean(richTextEditorFor(element) || richTextFrameFor(element))
}

function richTextPlainValue(element: HTMLTextAreaElement) {
  const editor = richTextEditorFor(element)
  const editorText = editor?.getContent?.({ format: 'text' })?.trim()
  if (editorText) return editorText

  const frameBody = richTextFrameFor(element)?.contentDocument?.body
  const frameText = frameBody?.innerText?.trim() || frameBody?.textContent?.trim()
  if (frameText) return frameText

  const temporary = document.createElement('div')
  temporary.innerHTML = element.value || ''
  return temporary.textContent?.trim() || element.value || ''
}

function dispatchRichTextEvents(element: HTMLTextAreaElement, editorBody?: HTMLElement | null) {
  editorBody?.dispatchEvent(new Event('input', { bubbles: true }))
  editorBody?.dispatchEvent(new Event('change', { bubbles: true }))
  editorBody?.dispatchEvent(new Event('blur', { bubbles: true }))
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
}

function setRichTextValue(element: HTMLTextAreaElement, value: unknown) {
  if (!isRichTextTextarea(element)) return false

  const html = plainTextToRichHtml(value)
  const editor = richTextEditorFor(element)
  let editorUpdated = false

  try {
    if (editor?.setContent) {
      editor.setContent(html)
      editor.save?.()
      editorUpdated = true
    }
  } catch {
    // The iframe fallback below supports editors whose page API is isolated.
  }

  const editorBody = richTextFrameFor(element)?.contentDocument?.body
  if (editorBody) {
    editorBody.innerHTML = html
    editorUpdated = true
  }

  if (!editorUpdated) return false

  setNativeValue(element, html)
  dispatchRichTextEvents(element, editorBody)
  return true
}

function setContentEditableValue(element: HTMLElement, value: unknown) {
  if (!isEditableContentControl(element)) return false

  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
  const expectedText = compactWhitespace(text)

  try {
    element.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const inserted = document.execCommand('insertText', false, text)
    if (!inserted || compactWhitespace(element.textContent || '') !== expectedText) {
      element.innerHTML = plainTextToRichHtml(text)
    }
  } catch {
    element.innerHTML = plainTextToRichHtml(text)
  }

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text
  }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
  return compactWhitespace(element.textContent || '') === expectedText
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: unknown
) {
  if (!isScalarFillValue(value)) return false

  element.focus()
  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    const desired = strictBooleanValue(value)
    if (desired === null) return false
    const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
    checkedSetter?.call(element, desired)
  } else {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    valueSetter?.call(element, String(value ?? ''))
  }

  const inputEvent = element instanceof HTMLSelectElement || (element instanceof HTMLInputElement && element.type === 'checkbox')
    ? new Event('input', { bubbles: true, composed: true })
    : new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: String(value ?? '')
      })
  element.dispatchEvent(inputEvent)
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }))
  return true
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isAssetFillValue(value: unknown): value is AssetFillValue {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as AssetFillValue).assetUrls)
  )
}

function isScalarFillValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function extensionAssetUrl(assetUrl: string) {
  if (/^(https?:|chrome-extension:|data:|blob:)/i.test(assetUrl)) return assetUrl
  return chrome.runtime.getURL(assetUrl.replace(/^\/+/, ''))
}

function fileNameFromUrl(assetUrl: string, index: number) {
  const cleanUrl = assetUrl.split(/[?#]/)[0]
  const fileName = cleanUrl.split('/').pop()
  return fileName || `product-image-${index + 1}.png`
}

async function storedAssetFromReference(assetUrl: string) {
  const assetId = assetIdFromReference(assetUrl)
  const storageKey = storedAssetStorageKey(assetId)
  const result = await chrome.storage.local.get(storageKey)
  return result[storageKey] as StoredProductAsset | undefined
}

function mimeTypeFromFileName(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}

async function fileFromAssetUrl(assetUrl: string, index: number) {
  const storedAsset = isStoredAssetReference(assetUrl)
    ? await storedAssetFromReference(assetUrl)
    : undefined

  if (isStoredAssetReference(assetUrl) && !storedAsset) {
    throw new Error('Saved product image is no longer available. Please choose it again in Settings.')
  }

  let resolvedAsset = storedAsset
  if (!resolvedAsset) {
    const response = await chrome.runtime.sendMessage({
      action: 'resolveUploadAsset',
      assetUrl: extensionAssetUrl(assetUrl),
      index
    })
    if (!response?.success || !response.asset?.dataUrl) {
      throw new Error(response?.error || `Failed to load asset: ${assetUrl}`)
    }
    resolvedAsset = response.asset as StoredProductAsset
  }

  const response = await fetch(resolvedAsset.dataUrl)
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${assetUrl}`)
  }

  const blob = await response.blob()
  const fileName = resolvedAsset.fileName || fileNameFromUrl(assetUrl, index)
  return new File([blob], fileName, {
    type: resolvedAsset.mimeType || blob.type || mimeTypeFromFileName(fileName)
  })
}

function uploadContainerFor(element: HTMLInputElement) {
  const labelledControl = element.id
    ? document.querySelector<HTMLElement>(`label[for="${escapeSelectorValue(element.id)}"]`)
    : null
  const uploadContainer = element.closest<HTMLElement>([
    '[data-testid*="upload" i]',
    '[data-testid*="drop" i]',
    '[class*="upload" i]',
    '[class*="dropzone" i]',
    '[class*="drop-zone" i]',
    '[class*="file-input" i]',
    '[role="button"]'
  ].join(', '))

  return uploadContainer || labelledControl || element.parentElement || element
}

function uploadContextFor(element: HTMLInputElement) {
  const baseContext = getFieldContext(element)
  if (/\b(logo|icon|avatar|image|picture|photo|screenshot|banner|gallery|upload)\b|图标|圖標|图片|圖片|上传|上傳/i.test(baseContext)) {
    return baseContext
  }

  let node: HTMLElement | null = element
  for (let depth = 0; node?.parentElement && depth < 6; depth++) {
    let sibling = node.previousElementSibling as HTMLElement | null
    while (sibling) {
      const text = compactWhitespace(sibling.innerText || sibling.textContent || '')
      if (text && text.length <= 600) {
        return textSnippet(`${text} | ${baseContext}`, 900)
      }
      sibling = sibling.previousElementSibling as HTMLElement | null
    }
    node = node.parentElement
  }

  return baseContext
}

function uploadEventTargets(element: HTMLInputElement) {
  const candidates: HTMLElement[] = [element]
  const labelledControl = element.id
    ? document.querySelector<HTMLElement>(`label[for="${escapeSelectorValue(element.id)}"]`)
    : null
  const uploadContainer = uploadContainerFor(element)
  const clickableAncestor = element.closest<HTMLElement>('[role="button"], label, button')

  if (labelledControl) candidates.push(labelledControl)
  if (clickableAncestor) candidates.push(clickableAncestor)
  if (uploadContainer) candidates.push(uploadContainer)

  let ancestor = uploadContainer.parentElement
  for (let depth = 0; ancestor && depth < 3; depth++) {
    candidates.push(ancestor)
    ancestor = ancestor.parentElement
  }

  return Array.from(new Set(candidates))
}

function uploadSnapshot(element: HTMLInputElement) {
  const containers = uploadEventTargets(element)
  const imageSignature = containers
    .flatMap((container) => Array.from(container.querySelectorAll<HTMLImageElement>('img')))
    .map((image) => image.currentSrc || image.src || image.alt)
    .join('|')
  const text = compactWhitespace(containers
    .map((container) => container.innerText || container.textContent || '')
    .join(' '))
  return {
    childCount: containers.reduce((count, container) => count + container.querySelectorAll('*').length, 0),
    imageSignature,
    text: text.slice(0, 1200)
  }
}

function uploadHasError(text: string) {
  return /\b(error|failed|invalid|too (?:large|small)|not supported|unsupported|try again|upload failed|upload error|rejected)\b|上传失败|上傳失敗|格式错误|格式錯誤|文件过大|檔案過大|不支持|不支援/i.test(text)
}

function uploadAcceptanceEvidence(
  element: HTMLInputElement,
  expectedFileNames: string[],
  before: ReturnType<typeof uploadSnapshot>
) {
  const after = uploadSnapshot(element)
  const visibleFileName = expectedFileNames.some((name) => (
    after.text.includes(name) ||
    after.text.includes(name.replace(/\.[^.]+$/, ''))
  ))
  const previewChanged = Boolean(after.imageSignature) && after.imageSignature !== before.imageSignature

  return {
    accepted: !uploadHasError(after.text) && (visibleFileName || previewChanged),
    error: uploadHasError(after.text)
  }
}

async function waitForUploadAcceptance(
  element: HTMLInputElement,
  expectedFileNames: string[],
  before: ReturnType<typeof uploadSnapshot>,
  timeoutMs = 4000
) {
  const deadline = Date.now() + timeoutMs
  let positiveSince = 0

  while (Date.now() < deadline) {
    const evidence = uploadAcceptanceEvidence(element, expectedFileNames, before)
    if (evidence.error) return false
    if (evidence.accepted) {
      if (positiveSince === 0) positiveSince = Date.now()
      if (Date.now() - positiveSince >= 650) return true
    } else {
      positiveSince = 0
    }
    await wait(180)
  }

  return false
}

function assignFiles(element: HTMLInputElement, files: FileList) {
  const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set
  if (filesSetter) {
    filesSetter.call(element, files)
  } else {
    element.files = files
  }
}

function dispatchFileEvents(element: HTMLInputElement) {
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

function dispatchDropEvents(element: HTMLInputElement, dataTransfer: DataTransfer) {
  const targets = uploadEventTargets(element).filter((candidate) => candidate !== element)
  const target = targets.find((candidate) => {
    const identity = [
      candidate.id,
      candidate.className,
      candidate.getAttribute('data-testid'),
      candidate.getAttribute('role'),
      candidate.innerText || candidate.textContent || ''
    ].filter(Boolean).join(' ')
    return /\b(upload|drop[ -]?zone|drop files?|browse|choose file|attach)\b/i.test(identity)
  }) || targets[0]

  if (!target) return
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer
    }))
  }
}

async function setFileInputValue(element: HTMLInputElement, value: unknown) {
  if (!isAssetFillValue(value)) return false

  const assetUrls = element.multiple ? value.assetUrls : value.assetUrls.slice(0, 1)
  if (assetUrls.length === 0) return false

  const before = uploadSnapshot(element)
  const originalElementIndex = getFillableElements().indexOf(element)
  const dataTransfer = new DataTransfer()
  for (const [index, assetUrl] of assetUrls.entries()) {
    const sourceFile = await fileFromAssetUrl(assetUrl, index)
    try {
      const optimized = await optimizeImageForInput(sourceFile, element)
      dataTransfer.items.add(optimized.file)
      console.info(`[ImageOptimizer] ${optimized.summary}`)
    } catch (error) {
      console.warn('[ImageOptimizer] Could not produce an image that satisfies this field.', error)
      throw error
    }
  }

  const expectedFileNames = Array.from(dataTransfer.files).map((file) => file.name)
  assignFiles(element, dataTransfer.files)
  dispatchFileEvents(element)
  let accepted = await waitForUploadAcceptance(element, expectedFileNames, before)
  if (!accepted) {
    dispatchDropEvents(element, dataTransfer)
    accepted = await waitForUploadAcceptance(element, expectedFileNames, before)
  }

  if (!accepted) {
    // Controlled upload widgets may replace the original input after a
    // synthetic change. Retry on the live control that owns the same field.
    const key = element.id || element.name
    const indexedElement = originalElementIndex >= 0
      ? getFillableElements()[originalElementIndex]
      : null
    const liveElement = key ? findElementByKey(key) : indexedElement
    if (
      liveElement instanceof HTMLInputElement &&
      liveElement.type === 'file' &&
      liveElement !== element
    ) {
      assignFiles(liveElement, dataTransfer.files)
      dispatchFileEvents(liveElement)
      accepted = await waitForUploadAcceptance(liveElement, expectedFileNames, before)
      if (!accepted) {
        dispatchDropEvents(liveElement, dataTransfer)
        accepted = await waitForUploadAcceptance(liveElement, expectedFileNames, before)
      }
      element = liveElement
    }
  }

  if (accepted) {
    acceptedFileInputNames.set(element, expectedFileNames)
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }))
  } else {
    acceptedFileInputNames.delete(element)
    console.warn('[FormFiller] The page did not retain or acknowledge the selected image files.', {
      field: element.name || element.id,
      expectedFileNames
    })
  }

  return accepted
}

async function setVirtualFileInputValue(element: HTMLElement, value: unknown) {
  if (!isAssetFillValue(value) || value.assetUrls.length === 0) return false

  const beforeText = compactWhitespace(element.innerText || element.textContent || '')
  const dataTransfer = new DataTransfer()
  for (const [index, assetUrl] of value.assetUrls.slice(0, 1).entries()) {
    dataTransfer.items.add(await fileFromAssetUrl(assetUrl, index))
  }
  const directFileNames = Array.from(dataTransfer.files).map((file) => file.name)
  const beforeDrop = virtualUploadSnapshot(element)
  dispatchVirtualDropEvents(element, dataTransfer)
  if (await waitForVirtualUploadAcceptance(element, directFileNames, beforeDrop, 1800)) {
    acceptedVirtualFileNames.set(element, directFileNames)
    return true
  }

  element.click()
  await wait(360)

  const pickerContext = compactWhitespace([
    getLearningFieldLabel(element),
    beforeText,
    element.id,
    element.getAttribute('name'),
    element.getAttribute('aria-label')
  ].filter(Boolean).join(' ')).slice(0, 600)

  const response = await chrome.runtime.sendMessage({
    action: 'fillVirtualFileInput',
    assetUrls: value.assetUrls.slice(0, 1),
    multiple: false,
    pickerContext
  })
  if (!response?.success) {
    console.warn('[FormFiller] Virtual upload picker could not be filled.', {
      stage: 'picker_input',
      field: beforeText,
      error: response?.error || 'Unknown upload picker error'
    })
    return false
  }

  const fileNames = Array.isArray(response.fileNames)
    ? response.fileNames.filter((name: unknown): name is string => typeof name === 'string')
    : []
  if (!await waitForVirtualUploadAcceptance(element, fileNames, beforeDrop)) {
    console.warn('[FormFiller] Virtual picker did not update the intended upload control.', {
      field: beforeText,
      fileNames
    })
    return false
  }
  acceptedVirtualFileNames.set(element, fileNames)
  return true
}

function virtualUploadEventTargets(element: HTMLElement) {
  const candidates = [element]
  let ancestor = element.parentElement
  for (let depth = 0; ancestor && depth < 5; depth++) {
    candidates.push(ancestor)
    if (ancestor.matches('form, [role="dialog"]')) break
    ancestor = ancestor.parentElement
  }
  return Array.from(new Set(candidates))
}

function virtualUploadSnapshot(element: HTMLElement) {
  const targets = virtualUploadEventTargets(element)
  const imageSignature = targets
    .flatMap((target) => Array.from(target.querySelectorAll<HTMLImageElement>('img')))
    .map((image) => image.currentSrc || image.src || image.alt)
    .join('|')
  return {
    connected: element.isConnected,
    childCount: targets.reduce((count, target) => count + target.querySelectorAll('*').length, 0),
    imageSignature,
    text: compactWhitespace(targets.map((target) => target.innerText || target.textContent || '').join(' ')).slice(0, 1600)
  }
}

function virtualUploadAcceptanceEvidence(
  element: HTMLElement,
  expectedFileNames: string[],
  before: ReturnType<typeof virtualUploadSnapshot>
) {
  const after = virtualUploadSnapshot(element)
  const visibleFileName = expectedFileNames.some((name) => (
    after.text.includes(name) || after.text.includes(name.replace(/\.[^.]+$/, ''))
  ))
  const previewChanged = Boolean(after.imageSignature) && after.imageSignature !== before.imageSignature
  return {
    accepted: after.connected && !uploadHasError(after.text) && (visibleFileName || previewChanged),
    error: uploadHasError(after.text)
  }
}

async function waitForVirtualUploadAcceptance(
  element: HTMLElement,
  expectedFileNames: string[],
  before: ReturnType<typeof virtualUploadSnapshot>,
  timeoutMs = 4000
) {
  const deadline = Date.now() + timeoutMs
  let positiveSince = 0

  while (Date.now() < deadline) {
    if (!element.isConnected) return false
    const evidence = virtualUploadAcceptanceEvidence(element, expectedFileNames, before)
    if (evidence.error) return false
    if (evidence.accepted) {
      if (positiveSince === 0) positiveSince = Date.now()
      if (Date.now() - positiveSince >= 650) return true
    } else {
      positiveSince = 0
    }
    await wait(180)
  }

  return false
}

function dispatchVirtualDropEvents(element: HTMLElement, dataTransfer: DataTransfer) {
  const targets = virtualUploadEventTargets(element)
  const target = targets.find((candidate) => {
    const identity = [
      candidate.id,
      candidate.className,
      candidate.getAttribute('data-testid'),
      candidate.getAttribute('role'),
      candidate.innerText || candidate.textContent || ''
    ].filter(Boolean).join(' ')
    return /\b(upload|drop[ -]?zone|drop files?|browse|choose file|attach)\b/i.test(identity)
  }) || element

  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer
    }))
  }
}

function fileInputsInOpenRoots(root: Document | ShadowRoot = document): HTMLInputElement[] {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'))
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (element.shadowRoot) inputs.push(...fileInputsInOpenRoots(element.shadowRoot))
  }
  return inputs
}

async function fillAvailableFileInput(
  assets: StoredProductAsset[],
  multiple: boolean,
  pickerContext = ''
) {
  const inputs = fileInputsInOpenRoots().filter((input) => !input.disabled)
  const compatibleInputs = inputs.filter((candidate) => {
    if (!assets[0]) return true
    const accept = candidate.accept.toLowerCase()
    return !accept || accept.includes('image') || accept.includes(assets[0].mimeType.toLowerCase())
  })
  const desiredWords = new Set(
    normalizeText(pickerContext).split(' ').filter((word) => word.length >= 3)
  )
  const rankedInputs = compatibleInputs
    .map((candidate) => {
      const contextWords = normalizeText(uploadContextFor(candidate)).split(' ')
      const overlap = contextWords.filter((word) => desiredWords.has(word)).length
      const newlyMounted = candidate.dataset.chat4oVirtualUploadSeen === 'true' ? 0 : 25
      return { input: candidate, score: newlyMounted + overlap * 12 }
    })
    .sort((left, right) => right.score - left.score)
  inputs.forEach((candidate) => { candidate.dataset.chat4oVirtualUploadSeen = 'true' })
  if (
    rankedInputs.length > 1 &&
    rankedInputs[0].score < 25 &&
    rankedInputs[0].score - rankedInputs[1].score < 12
  ) {
    return { success: false, error: 'Several upload controls match; the intended picker could not be identified safely.' }
  }
  const input = rankedInputs[0]?.input || inputs[0]
  if (!input || assets.length === 0) return { success: false }

  const dataTransfer = new DataTransfer()
  const selectedAssets = input.multiple && multiple ? assets : assets.slice(0, 1)
  for (const asset of selectedAssets) {
    const response = await fetch(asset.dataUrl)
    if (!response.ok) return { success: false }
    const blob = await response.blob()
    const sourceFile = new File([blob], asset.fileName, {
      type: asset.mimeType || blob.type || mimeTypeFromFileName(asset.fileName)
    })
    try {
      const optimized = await optimizeImageForInput(sourceFile, input)
      dataTransfer.items.add(optimized.file)
    } catch (error) {
      console.warn('[ImageOptimizer] Could not produce an image that satisfies the picker field.', error)
      throw error
    }
  }

  const before = uploadSnapshot(input)
  const fileNames = Array.from(dataTransfer.files).map((file) => file.name)
  assignFiles(input, dataTransfer.files)
  dispatchFileEvents(input)
  let accepted = await waitForUploadAcceptance(input, fileNames, before)
  if (!accepted) {
    dispatchDropEvents(input, dataTransfer)
    accepted = await waitForUploadAcceptance(input, fileNames, before)
  }

  return {
    success: accepted,
    fileNames
  }
}

function shortenToLimit(value: string, maxLength?: number) {
  if (!maxLength || value.length <= maxLength) return value

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

function shouldPreserveExactValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  value: unknown
) {
  const stringValue = String(value ?? '')
  return (
    element instanceof HTMLInputElement &&
    (element.type === 'url' || element.type === 'email')
  ) || /^https?:\/\//i.test(stringValue) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)
}

function constrainValueForField(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  value: unknown
) {
  if (typeof value !== 'string' || shouldPreserveExactValue(element, value)) return value
  return shortenToLimit(removeTrailingEllipsis(value), inferFieldMaxLength(element))
}

async function applyPostFillLengthLimit(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  fallbackValue: unknown
) {
  if (shouldPreserveExactValue(element, fallbackValue)) return fallbackValue

  const currentValue = getCurrentValue(element)
  const maxLength = inferFieldMaxLength(element)
  if (!maxLength || currentValue.length <= maxLength) return currentValue || fallbackValue

  const shortenedValue = shortenToLimit(currentValue, maxLength)
  if (shortenedValue !== currentValue) {
    await setFieldValue(element, shortenedValue)
    await wait(120)
    return getCurrentValue(element) || shortenedValue
  }

  return currentValue
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function scoreOption(optionLabel: string, desiredValue: string) {
  const option = normalizeText(optionLabel)
  const desired = normalizeText(desiredValue)
  if (!option || !desired) return 0
  if (option === desired) return 100
  if (
    Math.min(desired.length, option.length) >= 5 &&
    (desired.includes(option) || option.includes(desired))
  ) return 80

  const desiredWords = new Set(desired.split(' ').filter((word) => word.length > 2))
  const optionWords = option.split(' ').filter((word) => word.length > 2)
  const overlap = optionWords.filter((word) => desiredWords.has(word)).length
  const coverage = overlap / Math.max(1, Math.min(optionWords.length, desiredWords.size))
  return overlap >= 1 && coverage >= 0.67 ? 50 + Math.round(coverage * 30) : 0
}

function findBestOption(options: Array<{ label: string; value: string }>, desiredValue: string) {
  const ranked = options
    .map((option) => ({ ...option, score: scoreOption(option.label, desiredValue) }))
    .sort((a, b) => b.score - a.score)[0]

  if (!ranked || ranked.score < 70) return null
  const secondScore = options
    .map((option) => scoreOption(option.label, desiredValue))
    .sort((a, b) => b - a)[1] || 0
  if (ranked.score < 100 && ranked.score - secondScore < 8) return null
  return ranked
}

async function setRadioGroupValue(element: HTMLInputElement, value: unknown) {
  const desiredValue = String(value ?? '')
  const candidates = element.name
    ? Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
        .filter((candidate) => candidate.name === element.name && candidate.form === element.form && !candidate.disabled)
    : [element]
  const ranked = candidates
    .map((candidate) => ({
      element: candidate,
      score: Math.max(
        scoreOption(getRadioOptionLabel(candidate), desiredValue),
        scoreOption(candidate.getAttribute('aria-label') || '', desiredValue),
        scoreOption(candidate.value, desiredValue)
      )
    }))
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  if (!best || best.score < 70 || (best.score < 100 && best.score - (ranked[1]?.score || 0) < 8)) return false

  const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
  candidates.forEach((candidate) => checkedSetter?.call(candidate, candidate === best.element))
  best.element.dispatchEvent(new Event('input', { bubbles: true }))
  best.element.dispatchEvent(new Event('change', { bubbles: true }))
  best.element.dispatchEvent(new Event('blur', { bubbles: true }))
  await wait(80)
  return best.element.checked
}

function getVisibleOptionElements() {
  return (Array.from(document.querySelectorAll('[role="option"], [data-combobox-option], [data-option]')) as HTMLElement[])
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
}

function ownedVisibleOptionElements(element: HTMLElement) {
  const controlledIds = [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')]
    .flatMap((value) => String(value || '').split(/\s+/))
    .filter(Boolean)
  const roots = controlledIds
    .map((id) => document.getElementById(id))
    .filter((root): root is HTMLElement => root instanceof HTMLElement)

  if (roots.length > 0) {
    const options = roots.flatMap((root) => (
      root.matches('[role="option"], [data-combobox-option], [data-option]')
        ? [root]
        : Array.from(root.querySelectorAll<HTMLElement>('[role="option"], [data-combobox-option], [data-option]'))
    ))
    return options.filter((option) => getVisibleOptionElements().includes(option))
  }

  const visibleListboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]'))
    .filter((listbox) => {
      const style = window.getComputedStyle(listbox)
      const rect = listbox.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
  if (visibleListboxes.length !== 1) return []
  return Array.from(visibleListboxes[0].querySelectorAll<HTMLElement>(
    '[role="option"], [data-combobox-option], [data-option]'
  )).filter((option) => getVisibleOptionElements().includes(option))
}

function ownedScrollableOptionContainers(element: HTMLElement) {
  return Array.from(new Set(
    ownedVisibleOptionElements(element).flatMap((option) => {
      const result: HTMLElement[] = []
      let current = option.parentElement
      while (current && current !== document.body) {
        if (isScrollable(current)) result.push(current)
        current = current.parentElement
      }
      return result
    })
  ))
}

function findBestVisibleOption(element: HTMLElement, desiredValue: string) {
  const ranked = ownedVisibleOptionElements(element)
    .map((option) => ({
      element: option,
      label: option.textContent?.trim() || '',
      value: option.getAttribute('data-value') || option.textContent?.trim() || '',
      score: scoreOption(option.textContent?.trim() || '', desiredValue)
    }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score < 70) return null
  if (best.score < 100 && best.score - (ranked[1]?.score || 0) < 8) return null
  return best
}

async function clickBestCustomOption(element: HTMLElement, desiredValue: string) {
  let bestOption = findBestVisibleOption(element, desiredValue)
  if (bestOption) {
    const selectedLabel = bestOption.label
    bestOption.element.click()
    await wait(120)
    acceptedCustomSelectValues.set(element, selectedLabel)
    return true
  }

  const containers = ownedScrollableOptionContainers(element)
  for (const container of containers.slice(0, 3)) {
    const originalScrollTop = container.scrollTop
    container.scrollTop = 0
    await wait(40)

    for (let step = 0; step < 35; step++) {
      bestOption = findBestVisibleOption(element, desiredValue)
      if (bestOption) {
        const selectedLabel = bestOption.label
        bestOption.element.click()
        await wait(120)
        acceptedCustomSelectValues.set(element, selectedLabel)
        return true
      }

      const previousScrollTop = container.scrollTop
      container.scrollTop += Math.max(120, container.clientHeight * 0.8)
      await wait(40)
      if (container.scrollTop === previousScrollTop) break
    }

    container.scrollTop = originalScrollTop
  }

  return false
}

async function setSelectValue(element: HTMLSelectElement | HTMLElement, value: unknown) {
  const desiredValue = String(value ?? '')

  if (element instanceof HTMLSelectElement) {
    const options = getSelectOptions(element)
    const bestOption = findBestOption(options, desiredValue)
    if (bestOption) {
      const optionIndex = options.findIndex((option) => (
        option.value === bestOption.value && option.label === bestOption.label
      ))
      const nativeOptions = Array.from(element.options)
      const nativeOptionIndex = nativeOptions.findIndex((option) => (
        option.value === bestOption.value &&
        (option.textContent?.trim() || option.label || option.value) === bestOption.label
      ))

      // Prefer the actual option index. This also handles the common None
      // option whose HTML value is an empty string.
      element.selectedIndex = nativeOptionIndex >= 0 ? nativeOptionIndex : optionIndex
      element.value = bestOption.value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return false
  }

  element.click()
  await wait(180)

  return clickBestCustomOption(element, desiredValue)
}

async function setAriaCheckboxValue(element: HTMLElement, value: unknown) {
  const desired = strictBooleanValue(value)
  if (desired === null) return false
  if (desired && isUnsafeOptionalCheckboxControl(element)) return false

  const current = ariaCheckboxState(element)
  if (current === null) return false
  if (current !== desired) {
    element.click()
    await wait(100)
  }
  return ariaCheckboxState(element) === desired
}

async function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  value: unknown
) {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    return setFileInputValue(element, value)
  }

  if (isVirtualFileControl(element)) {
    return setVirtualFileInputValue(element, value)
  }

  if (isVirtualPlanChoiceControl(element)) {
    return setVirtualPlanChoiceValue(element, value)
  }

  if (element instanceof HTMLInputElement && element.type === 'radio') {
    return setRadioGroupValue(element, value)
  }

  if (isAriaCheckboxControl(element)) {
    return setAriaCheckboxValue(element, value)
  }

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    const desired = strictBooleanValue(value)
    if (desired === null || (desired && isUnsafeOptionalCheckboxControl(element))) return false
  }

  if (!isScalarFillValue(value)) return false

  const constrainedValue = constrainValueForField(element, value)

  if (element instanceof HTMLSelectElement || isCustomSelectControl(element)) {
    const selected = await setSelectValue(element, constrainedValue)
    if (selected) return true
    if (isCustomSelectControl(element)) return false
  }

  if (element instanceof HTMLTextAreaElement && setRichTextValue(element, constrainedValue)) {
    return true
  }

  if (isEditableContentControl(element) && setContentEditableValue(element, constrainedValue)) {
    return true
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return setNativeValue(element, constrainedValue)
  }

  return false
}

function getCurrentValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    return (acceptedFileInputNames.get(element) || []).join(', ')
  }

  if (isVirtualFileControl(element)) {
    return (acceptedVirtualFileNames.get(element) || []).join(', ')
  }

  if (isVirtualPlanChoiceControl(element)) {
    return currentVirtualPlanChoice(element)
  }

  if (element instanceof HTMLInputElement && element.type === 'radio') {
    const selected = getSelectedRadio(element)
    return selected ? getFieldLabel(selected) || selected.getAttribute('aria-label') || selected.value : ''
  }

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    return String(element.checked)
  }

  if (isAriaCheckboxControl(element)) {
    return String(ariaCheckboxState(element) === true)
  }

  if (isCustomSelectControl(element)) {
    return acceptedCustomSelectValues.get(element) || (
      element instanceof HTMLInputElement ? element.value : compactWhitespace(element.innerText || element.textContent || '')
    )
  }

  if (element instanceof HTMLSelectElement) {
    return element.selectedOptions[0]?.textContent?.trim() || element.value || ''
  }

  if (element instanceof HTMLTextAreaElement && isRichTextTextarea(element)) {
    return richTextPlainValue(element)
  }

  return 'value' in element ? element.value || '' : element.textContent?.trim() || ''
}

function getSelectedRadio(element: HTMLInputElement) {
  if (!element.name) return element.checked ? element : null

  return Array.from(document.querySelectorAll('input[type="radio"]'))
    .find((candidate): candidate is HTMLInputElement => (
      candidate instanceof HTMLInputElement &&
      candidate.name === element.name &&
      candidate.form === element.form &&
      candidate.checked
    )) || null
}

function getLearningValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  if (isVirtualPlanChoiceControl(element)) {
    return currentVirtualPlanChoice(element)
  }

  if (element instanceof HTMLInputElement && element.type === 'radio') {
    const selected = getSelectedRadio(element)
    if (!selected) return ''
    return getFieldLabel(selected) || selected.value || 'Selected'
  }

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    if (!element.checked) return ''
    return getFieldLabel(element) || element.value || 'Yes'
  }

  if (isAriaCheckboxControl(element)) {
    if (ariaCheckboxState(element) !== true) return ''
    return getFieldLabel(element) || element.getAttribute('aria-label') || 'Yes'
  }

  if (element instanceof HTMLSelectElement) {
    return element.selectedOptions[0]?.textContent?.trim() || element.value || ''
  }

  return getCurrentValue(element).trim()
}

function getLearningFieldLabel(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  const fieldset = element.closest('fieldset')
  const legend = fieldset?.querySelector('legend')?.textContent?.trim()
  if (legend && isUsableFieldLabel(legend, element)) return legend

  const radioGroup = element.closest('[role="radiogroup"]')
  const radioGroupLabel = radioGroup?.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() || '')
    .filter(Boolean)
    .join(' ')
  if (radioGroupLabel && isUsableFieldLabel(radioGroupLabel, element)) return radioGroupLabel

  const directLabel = getFieldLabel(element)
  if (isUsableFieldLabel(directLabel, element)) return directLabel

  const visualLabel = getVisualLabelAboveField(element)
  if (visualLabel) return visualLabel

  const nearbyLabel = getNearbyFieldLabel(element)
  if (nearbyLabel) return nearbyLabel

  const context = getFieldContext(element)
  const question = context
    .split('|')
    .map((part) => compactWhitespace(part))
    .find((part) => part.includes('?') && isUsableFieldLabel(part, element))
  const questionEnd = question?.indexOf('?')
  if (question && questionEnd !== undefined && questionEnd >= 0) {
    return question.slice(0, questionEnd + 1)
  }

  const contextLabel = context
    .split('|')
    .map((part) => compactWhitespace(part))
    .find((part) => isUsableFieldLabel(part, element))

  return contextLabel || ''
}

function getLearningField(key: string) {
  const element = findElementByKey(key)
  const field = getFieldForKey(key)

  if (!element) return field
  return {
    ...field,
    label: getLearningFieldLabel(element) || field.label
  }
}

function valueLooksFilled(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  intendedValue: unknown
) {
  const currentValue = getCurrentValue(element).trim()
  const expectedValue = String(intendedValue ?? '').trim()

  if ((element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) || isAriaCheckboxControl(element)) {
    if (isAriaCheckboxControl(element)) {
      const expectedChecked = strictBooleanValue(intendedValue)
      return expectedChecked !== null && ariaCheckboxState(element) === expectedChecked
    }
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      return normalizeText(currentValue) === normalizeText(String(intendedValue ?? ''))
    }
    const expectedChecked = strictBooleanValue(intendedValue)
    return expectedChecked !== null && currentValue === String(expectedChecked)
  }

  if (element instanceof HTMLInputElement && element.type === 'file') {
    return (element.files?.length || 0) > 0 || acceptedFileInputNames.has(element)
  }

  if (isVirtualFileControl(element)) {
    return acceptedVirtualFileNames.has(element)
  }

  if (isVirtualPlanChoiceControl(element)) {
    const group = virtualPlanChoiceGroupFor(element)
    const option = group ? findSafeVirtualPlanOption(group, intendedValue) : null
    return Boolean(option && normalizeText(currentVirtualPlanChoice(element)) === normalizeText(option.label))
  }

  if (!expectedValue) return currentValue.length === 0
  if (!currentValue) return false

  const normalizedCurrent = normalizeText(currentValue)
  const normalizedExpected = normalizeText(expectedValue)
  return normalizedCurrent === normalizedExpected
}

function liveValidationError(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
) {
  if (element.getAttribute('aria-invalid') === 'true') return true
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return !element.checkValidity()
  }
  return false
}

function isEmailValue(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

function isPublicEmailValue(value: unknown) {
  return /@(gmail|yahoo|hotmail|outlook|icloud|aol|protonmail|qq|163|126)\./i.test(String(value ?? ''))
}

function hasFormalEmailRequirement(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  const context = normalizeText(getFieldContext(element))
  return (
    /(company|business|work|official|corporate|professional).{0,32}(email|e mail|mail)/.test(context) ||
    /(email|e mail|mail).{0,32}(company|business|work|official|corporate|professional)/.test(context)
  ) || /\b(no|not|cannot|can t|must not|don t|do not|invalid)\b.*\b(gmail|free|personal|public|generic)\b/.test(context)
}

function hasPublicEmailRejection(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
) {
  const localText = normalizeText([
    getFieldContext(element),
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element.validationMessage
      : ''
  ].join(' '))
  const pageText = normalizeText(textSnippet(document.body?.innerText || document.body?.textContent || '', 8000))
  const combined = `${localText} ${pageText}`

  return (
    /\b(gmail|free email|personal email|public email|generic email)\b.*\b(not allowed|not accepted|invalid|blocked|rejected|cannot|can t|must not)\b/.test(combined) ||
    /\b(not allowed|not accepted|invalid|blocked|rejected|cannot|can t|must not)\b.*\b(gmail|free email|personal email|public email|generic email)\b/.test(combined) ||
    /\b(use|enter|provide|required|requires|must use|need)\b.*\b(company|business|work|official|corporate|professional)\b.*\b(email|e mail|mail)\b/.test(combined)
  )
}

function getFieldForKey(key: string): ExtractedFormField {
  const fillableElements = getFillableElements()
  const syntheticFieldMatch = key.match(/^field_(\d+)$/)
  const fallbackIndex = syntheticFieldMatch ? Number(syntheticFieldMatch[1]) : 0
  const element = findElementByKey(key) || fillableElements[fallbackIndex]
  const elementIndex = fillableElements.indexOf(element)
  const existingField = lastExtractedFields.find((field) => field.id === key || field.name === key)
  const fieldType = element && isVirtualFileControl(element)
    ? 'file'
    : element && isVirtualPlanChoiceControl(element)
      ? 'select'
    : element && isCustomSelectControl(element)
      ? 'select'
      : element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
        ? element.type || 'text'
        : element && isEditableContentControl(element)
          ? 'richtext'
          : 'text'

  return {
    ...(existingField || {}),
    id: existingField?.id || key,
    name: existingField?.name || key,
    type: fieldType,
    tagName: element?.tagName.toLowerCase() || 'input',
    placeholder: (element as HTMLInputElement | undefined)?.placeholder || '',
    label: element ? getExtractedFieldLabel(element) : '',
    context: element ? getFieldContext(element) : '',
    maxLength: element ? inferFieldMaxLength(element) : undefined,
    value: element ? getCurrentValue(element) : '',
    required: element
      ? (element instanceof HTMLInputElement && element.required) ||
        element.getAttribute('aria-required') === 'true' ||
        (isAriaCheckboxControl(element) && element.closest('[aria-required="true"]') !== null)
      : false,
    elementIndex: elementIndex >= 0 ? elementIndex : fallbackIndex,
    options: element ? getSelectOptions(element) : [],
    isCustomSelect: element ? isCustomSelectControl(element) : false
  }
}

function getFieldVisualAnchor(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  if (element instanceof HTMLTextAreaElement) {
    const richTextFrame = richTextFrameFor(element)
    if (richTextFrame) return richTextFrame
  }

  return element
}

function positionControl(record: FilledFieldRecord) {
  const rect = getFieldVisualAnchor(record.element).getBoundingClientRect()
  record.control.style.top = `${Math.max(8, rect.top + window.scrollY + 8)}px`
  record.control.style.left = `${Math.max(8, rect.right + window.scrollX - 40)}px`
}

function positionLearnControl(key: string) {
  const control = learnFieldControls.get(key)
  const field = getFieldForKey(key)
  const element = findElementByKey(key)
  if (!control || !element) return

  const rect = getFieldVisualAnchor(element).getBoundingClientRect()
  control.style.top = `${Math.max(8, rect.top + window.scrollY + 8)}px`
  control.style.left = `${Math.max(8, rect.right + window.scrollX - 40)}px`
  control.title = `保存到补充资料: ${field.label || field.placeholder || field.name || field.id}`
}

function closeAllMenus() {
  document.querySelectorAll('.chat4o-field-menu').forEach((menu) => {
    menu.remove()
  })
}

function toEvaluationFieldRecord(
  key: string,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  overrides: Partial<EvaluationFieldRecord> = {}
): EvaluationFieldRecord {
  const field = getFieldForKey(key)
  return {
    fieldKey: key,
    id: field.id,
    name: field.name,
    label: field.label,
    context: field.context,
    placeholder: field.placeholder,
    tagName: field.tagName,
    type: field.type,
    required: field.required,
    options: field.options || [],
    originalValue: field.value || '',
    autoFilledValue: getCurrentValue(element),
    fillOutcome: 'not_attempted',
    ...overrides
  }
}

async function refreshEvaluationWidget() {
  if (!evaluationWidget || !activeEvaluationSessionId) return
  const session = await readEvaluationSession(activeEvaluationSessionId)
  if (!session) return

  const trigger = evaluationWidget.querySelector<HTMLButtonElement>('[data-evaluation-trigger]')
  if (!trigger) return

  const correctionCount = session.fields.filter((field) => Boolean(field.review)).length
  trigger.textContent = session.status === 'pending'
    ? `验收${correctionCount > 0 ? ` ${correctionCount}` : ''}`
    : `已验收${correctionCount > 0 ? ` · ${correctionCount}处` : ''}`
  trigger.style.background = session.status === 'pending' ? '#ffffff' : '#ecfdf5'
  trigger.style.color = session.status === 'pending' ? '#334155' : '#047857'
  trigger.style.borderColor = session.status === 'pending' ? '#cbd5e1' : '#a7f3d0'
}

function createEvaluationPanelButton(
  label: string,
  onClick: () => Promise<void>,
  tone: 'primary' | 'secondary' = 'secondary'
) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.cssText = `
    width: 100%;
    padding: 8px 10px;
    border: 1px solid ${tone === 'primary' ? '#2563eb' : '#dbe3ef'};
    border-radius: 7px;
    background: ${tone === 'primary' ? '#2563eb' : '#ffffff'};
    color: ${tone === 'primary' ? '#ffffff' : '#475569'};
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  `
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void onClick()
  })
  return button
}

function showEvaluationPanel() {
  if (!evaluationWidget || !activeEvaluationSessionId) return
  evaluationWidget.querySelector('.chat4o-evaluation-panel')?.remove()

  const panel = document.createElement('div')
  panel.className = 'chat4o-evaluation-panel'
  panel.style.cssText = `
    position: absolute;
    left: 0;
    bottom: 42px;
    width: 238px;
    padding: 10px;
    border: 1px solid #dbe3ef;
    border-radius: 10px;
    background: #ffffff;
    box-shadow: 0 14px 35px rgba(15, 23, 42, 0.22);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `

  const heading = document.createElement('div')
  heading.textContent = '本页填写验收'
  heading.style.cssText = 'margin-bottom:4px;color:#0f172a;font-size:13px;font-weight:700;'
  const help = document.createElement('div')
  help.textContent = '错误字段先在输入框中改好，再点旁边 AI → 记录这次改正。'
  help.style.cssText = 'margin-bottom:9px;color:#64748b;font-size:11px;line-height:1.45;'

  const finish = createEvaluationPanelButton('本页检查完成，其余字段正确', async () => {
    await completeEvaluationSession(activeEvaluationSessionId, 'accepted', true)
    panel.remove()
    await refreshEvaluationWidget()
  }, 'primary')

  const divider = document.createElement('div')
  divider.textContent = '页面本身有问题'
  divider.style.cssText = 'margin:10px 0 6px;color:#94a3b8;font-size:10px;'

  const pageStatuses: Array<{ label: string; status: Exclude<EvaluationPageStatus, 'pending'> }> = [
    { label: '这不是提交页面', status: 'not_submission_page' },
    { label: '需要登录或验证码', status: 'authentication_required' },
    { label: '页面打不开或已失效', status: 'page_unavailable' }
  ]

  const statusButtons = document.createElement('div')
  statusButtons.style.cssText = 'display:grid;gap:5px;'
  pageStatuses.forEach(({ label, status }) => {
    statusButtons.appendChild(createEvaluationPanelButton(label, async () => {
      await completeEvaluationSession(activeEvaluationSessionId, status)
      panel.remove()
      await refreshEvaluationWidget()
    }))
  })

  panel.append(heading, help, finish, divider, statusButtons)
  evaluationWidget.appendChild(panel)
}

function ensureEvaluationWidget(sessionId: string) {
  activeEvaluationSessionId = sessionId

  if (!evaluationWidget?.isConnected) {
    evaluationWidget = document.createElement('div')
    evaluationWidget.style.cssText = `
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.dataset.evaluationTrigger = 'true'
    trigger.textContent = '验收'
    trigger.title = '检查并记录本页自动填写结果'
    trigger.style.cssText = `
      min-width: 62px;
      height: 34px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16);
      cursor: pointer;
    `
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const existingPanel = evaluationWidget?.querySelector('.chat4o-evaluation-panel')
      if (existingPanel) {
        existingPanel.remove()
      } else {
        showEvaluationPanel()
      }
    })

    evaluationWidget.appendChild(trigger)
    document.documentElement.appendChild(evaluationWidget)
  }

  void refreshEvaluationWidget()
}

function markEvaluationControlRecorded(record: FilledFieldRecord) {
  record.control.textContent = '✓'
  record.control.style.background = '#16a34a'
  record.control.title = '这处人工纠正已记录'
}

function inferCorrectionIssue(record: FilledFieldRecord): EvaluationIssue {
  const field = getFieldForKey(record.key)
  if (
    record.element instanceof HTMLSelectElement ||
    record.element.getAttribute('role') === 'combobox' ||
    field.type === 'select'
  ) {
    return 'wrong_option'
  }

  if (field.maxLength && record.autoFilledValue.length > field.maxLength) {
    return 'length_limit'
  }

  return 'wrong_value'
}

async function recordFilledFieldReview(
  record: FilledFieldRecord,
  issue: EvaluationIssue,
  correctedValue?: string,
  note?: string
) {
  const saved = await recordEvaluationFieldReview(
    record.sessionId,
    toEvaluationFieldRecord(record.key, record.element, {
      originalValue: record.originalValue,
      autoFilledValue: record.autoFilledValue,
      source: record.mapping?.source,
      confidence: record.mapping?.confidence,
      reason: record.mapping?.reason,
      fillOutcome: 'filled'
    }),
    {
      issue,
      correctedValue,
      note,
      reviewedAt: new Date().toISOString()
    }
  )

  if (saved) {
    markEvaluationControlRecorded(record)
    await refreshEvaluationWidget()
  } else {
    showFieldControlResult(record.control, false)
  }
}

function createMenuButton(label: string, onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.cssText = `
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    background: transparent;
    color: #1e293b;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  `
  button.addEventListener('mouseenter', () => {
    button.style.background = '#f1f5f9'
  })
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent'
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    closeAllMenus()
    onClick()
  })
  return button
}

function showFieldControlResult(control: HTMLDivElement, success: boolean) {
  control.textContent = success ? '✓' : '!'
  control.style.background = success ? '#16a34a' : '#dc2626'
  window.setTimeout(() => {
    control.textContent = 'AI'
    control.style.background = '#2563eb'
  }, 1200)
}

function showFieldMenu(record: FilledFieldRecord) {
  closeAllMenus()

  const menu = document.createElement('div')
  menu.className = 'chat4o-field-menu'
  menu.style.cssText = `
    position: absolute;
    z-index: 2147483647;
    min-width: 104px;
    padding: 4px;
    border: 1px solid #dbe3ef;
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `

  const regenerateButton = createMenuButton('重写', async () => {
    record.control.textContent = '...'
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'regenerateField',
        data: {
          field: getFieldForKey(record.key),
          action: 'rewrite',
          currentValue: getCurrentValue(record.element)
        }
      })

      if (response?.success) {
        await setFieldValue(record.element, response.value)
        await wait(180)
        await applyPostFillLengthLimit(record.element, response.value)
        record.field = getFieldForKey(record.key)
      }
    } finally {
      record.control.textContent = 'AI'
    }
  })

  const restoreButton = createMenuButton('恢复原值', async () => {
    await setFieldValue(record.element, record.originalValue)
  })

  const recordCorrectionButton = createMenuButton('记录这次改正', async () => {
    const correctedValue = getLearningValue(record.element)
    if (correctedValue === record.autoFilledValue) {
      record.control.title = '请先在输入框中改正内容，再记录'
      showFieldControlResult(record.control, false)
      return
    }

    record.control.textContent = '...'
    await recordFilledFieldReview(record, inferCorrectionIssue(record), correctedValue)
  })

  const shouldBeEmptyButton = createMenuButton('本应留空', async () => {
    record.control.textContent = '...'
    await setFieldValue(record.element, '')
    await recordFilledFieldReview(record, 'should_be_empty', '')
  })

  const unresolvedButton = createMenuButton('标记仍未解决', async () => {
    record.control.textContent = '...'
    await recordFilledFieldReview(
      record,
      'unresolved',
      undefined,
      'The reviewer marked this field as incorrect but did not provide a corrected value.'
    )
  })

  const learnButton = createMenuButton('学习到资料', async () => {
    const value = getLearningValue(record.element)
    if (!value) {
      showFieldControlResult(record.control, false)
      return
    }

    record.control.textContent = '...'
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'addExtraInfo',
        data: {
          field: getLearningField(record.key),
          value,
          pageUrl: window.location.href
        }
      })
      if (response?.success && value !== record.autoFilledValue) {
        await recordFilledFieldReview(
          record,
          inferCorrectionIssue(record),
          value,
          'Saved to the product profile.'
        )
      } else {
        showFieldControlResult(record.control, Boolean(response?.success))
      }
    } catch {
      showFieldControlResult(record.control, false)
    }
  })

  menu.appendChild(regenerateButton)
  menu.appendChild(restoreButton)
  menu.appendChild(recordCorrectionButton)
  menu.appendChild(shouldBeEmptyButton)
  menu.appendChild(unresolvedButton)
  menu.appendChild(learnButton)

  const rect = record.control.getBoundingClientRect()
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`
  menu.style.left = `${rect.left + window.scrollX - 70}px`
  document.documentElement.appendChild(menu)
}

function attachFieldControl(
  key: string,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  mapping: FillMapping | undefined,
  sessionId: string,
  originalValue: string,
  autoFilledValue: string
) {
  const existingRecord = filledFieldRecords.get(key)
  if (existingRecord) {
    // Framework-driven forms may replace an input after its value changes.
    // Keep the existing button but re-anchor it to the current DOM node.
    existingRecord.element = element
    existingRecord.field = getFieldForKey(key)
    existingRecord.mapping = mapping
    existingRecord.sessionId = sessionId
    existingRecord.originalValue = originalValue
    existingRecord.autoFilledValue = autoFilledValue
    existingRecord.control.textContent = 'AI'
    existingRecord.control.style.background = '#2563eb'
    if (!existingRecord.control.isConnected) {
      document.documentElement.appendChild(existingRecord.control)
    }
    positionControl(existingRecord)
    return
  }

  const control = document.createElement('div')
  control.textContent = 'AI'
  control.title = mapping?.reason || 'AI field tools'
  control.style.cssText = `
    position: absolute;
    z-index: 2147483646;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: #2563eb;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    line-height: 28px;
    text-align: center;
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
    cursor: pointer;
    user-select: none;
  `

  const record: FilledFieldRecord = {
    key,
    originalValue,
    autoFilledValue,
    sessionId,
    field: getFieldForKey(key),
    mapping,
    element,
    control
  }

  control.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    showFieldMenu(record)
  })

  document.documentElement.appendChild(control)
  filledFieldRecords.set(key, record)
  positionControl(record)
}

function updateAllControlPositions() {
  filledFieldRecords.forEach((record) => positionControl(record))
  learnFieldControls.forEach((_control, key) => positionLearnControl(key))
}

function refreshFieldControlsAfterPageUpdate() {
  filledFieldRecords.forEach((record, key) => {
    const currentElement = findElementByKey(key)
    if (!currentElement) {
      if (!record.element.isConnected) {
        record.control.remove()
        filledFieldRecords.delete(key)
      }
      return
    }

    record.element = currentElement
    record.field = getFieldForKey(key)
    if (!record.control.isConnected) {
      document.documentElement.appendChild(record.control)
    }
    positionControl(record)
  })

  learnFieldControls.forEach((control, key) => {
    const currentElement = findElementByKey(key)
    if (!currentElement) {
      control.remove()
      learnFieldControls.delete(key)
      return
    }

    if (!control.isConnected) {
      document.documentElement.appendChild(control)
    }
    positionLearnControl(key)
  })
}

function scheduleFieldControlRefresh() {
  window.clearTimeout(controlRefreshTimer)
  controlRefreshTimer = window.setTimeout(() => {
    refreshFieldControlsAfterPageUpdate()
  }, 120)
}

function showTemporaryButtonState(control: HTMLDivElement, text: string, color: string) {
  control.textContent = text
  control.style.background = color
  window.setTimeout(() => {
    control.textContent = '+'
    control.style.background = '#0f766e'
  }, 1200)
}

function attachLearnControl(key: string) {
  if (filledFieldRecords.has(key) || learnFieldControls.has(key)) return

  const element = findElementByKey(key)
  if (!element) return

  const control = document.createElement('div')
  control.textContent = '+'
  control.style.cssText = `
    position: absolute;
    z-index: 2147483646;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #0f766e;
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
    line-height: 24px;
    text-align: center;
    box-shadow: 0 6px 16px rgba(15, 118, 110, 0.35);
    cursor: pointer;
    user-select: none;
  `

  control.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()

    const currentElement = findElementByKey(key)
    const value = currentElement ? getLearningValue(currentElement) : ''
    if (!value) {
      showTemporaryButtonState(control, '!', '#dc2626')
      return
    }

    control.textContent = '...'
    try {
      const learningField = getLearningField(key)
      const response = await chrome.runtime.sendMessage({
        action: 'addExtraInfo',
        data: {
          field: learningField,
          value,
          pageUrl: window.location.href
        }
      })

      if (response?.success) {
        if (activeEvaluationSessionId && currentElement) {
          await recordEvaluationFieldReview(
            activeEvaluationSessionId,
            toEvaluationFieldRecord(key, currentElement, {
              label: learningField.label,
              context: learningField.context,
              originalValue: '',
              autoFilledValue: '',
              fillOutcome: 'not_attempted'
            }),
            {
              issue: 'missed_field',
              correctedValue: value,
              note: 'The reviewer manually completed an omitted field and saved it to the product profile.',
              reviewedAt: new Date().toISOString()
            }
          )
          await refreshEvaluationWidget()
        }
        showTemporaryButtonState(control, '✓', '#16a34a')
      } else {
        showTemporaryButtonState(control, '!', '#dc2626')
      }
    } catch {
      showTemporaryButtonState(control, '!', '#dc2626')
    }
  })

  document.documentElement.appendChild(control)
  learnFieldControls.set(key, control)
  positionLearnControl(key)
}

function attachLearnControlsForUnfilledFields(filledKeys: Set<string>) {
  lastExtractedFields.forEach((field) => {
    if (filledKeys.has(field.id) || filledKeys.has(field.name)) return
    attachLearnControl(field.id)
  })
}

window.addEventListener('scroll', updateAllControlPositions, true)
window.addEventListener('resize', updateAllControlPositions)
document.addEventListener('click', closeAllMenus)
window.addEventListener('focus', reportFillableTabActivity)
document.addEventListener('pointerdown', reportFillableTabActivity, true)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reportFillableTabActivity()
})

const controlObserver = new MutationObserver(() => {
  if (filledFieldRecords.size > 0 || learnFieldControls.size > 0) {
    scheduleFieldControlRefresh()
  }
})
controlObserver.observe(document.documentElement, { childList: true, subtree: true })
reportFillableTabActivity()

// Fill form fields with provided data
async function fillForm(
  data: Record<string, any>,
  mappings: FillMapping[] = [],
  fallbackData: Record<string, any> = {}
) {
  console.log('[FormFiller] Filling form with data:', data)

  const evaluationSessionId = createEvaluationSessionId()
  activeEvaluationSessionId = evaluationSessionId
  const evaluationFields: EvaluationFieldRecord[] = []
  let filledCount = 0
  const failedKeys: string[] = []
  const filledKeys = new Set<string>()
  const mappingByFieldId = new Map(mappings.map((mapping) => [mapping.fieldId, mapping]))

  for (const [key, value] of Object.entries(data)) {
    const element = findElementByKey(key)

    if (element) {
      const originalValue = getCurrentValue(element)
      const filled = await setFieldValue(element, value)
      await wait(180)
      const lengthLimitedValue = await applyPostFillLengthLimit(element, value)
      let finalValue = value
      let verified = filled && valueLooksFilled(element, lengthLimitedValue) && !liveValidationError(element)
      const fallbackValue = fallbackData[key]

      if (
        fallbackValue &&
        String(fallbackValue) !== String(value) &&
        isEmailValue(fallbackValue) &&
        isPublicEmailValue(value) &&
        (hasFormalEmailRequirement(element) || hasPublicEmailRejection(element))
      ) {
        const fallbackFilled = await setFieldValue(element, fallbackValue)
        await wait(120)
        if (fallbackFilled && valueLooksFilled(element, fallbackValue) && !liveValidationError(element)) {
          finalValue = fallbackValue
          verified = true
        }
      }

      if (verified) {
        finalValue = getCurrentValue(element) || finalValue
        if (finalValue !== value) {
          data[key] = finalValue
        }
        const mapping = mappingByFieldId.get(key)
        attachFieldControl(
          key,
          element,
          mapping,
          evaluationSessionId,
          originalValue,
          String(finalValue)
        )
        evaluationFields.push(toEvaluationFieldRecord(key, element, {
          originalValue,
          autoFilledValue: String(finalValue),
          source: mapping?.source,
          confidence: mapping?.confidence,
          reason: mapping?.reason,
          fillOutcome: 'filled'
        }))
        filledKeys.add(key)
        filledCount++
        console.log(`[FormFiller] Filled field: ${key} = ${finalValue}`)
      } else {
        const mapping = mappingByFieldId.get(key)
        evaluationFields.push(toEvaluationFieldRecord(key, element, {
          originalValue,
          autoFilledValue: getCurrentValue(element),
          source: mapping?.source,
          confidence: mapping?.confidence,
          reason: mapping?.reason,
          fillOutcome: 'failed'
        }))
        failedKeys.push(key)
      }
    } else {
      failedKeys.push(key)
    }
  }

  attachLearnControlsForUnfilledFields(filledKeys)
  scheduleFieldControlRefresh()
  window.setTimeout(refreshFieldControlsAfterPageUpdate, 650)
  window.setTimeout(refreshFieldControlsAfterPageUpdate, 1600)

  try {
    await createEvaluationSession({
      id: evaluationSessionId,
      url: window.location.href,
      title: document.title,
      filledCount,
      attemptedCount: Object.keys(data).length,
      failedKeys,
      fields: evaluationFields
    })
    ensureEvaluationWidget(evaluationSessionId)
  } catch (error) {
    console.warn('[FormFiller] Could not save evaluation session:', error)
  }

  console.log(`[FormFiller] Filled ${filledCount} fields`)
  return {
    success: filledCount > 0,
    filledCount,
    attemptedCount: Object.keys(data).length,
    failedKeys
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[FormContent] Received message:', message.action)

  if (message.action === 'chat4oPing') {
    sendResponse({ success: true })
    return false
  }

  if (message.action === 'extractFormFields') {
    extractFormFields().then(sendResponse).catch((error) => {
      console.error('[FormContent] Extract error:', error)
      sendResponse([])
    })
    return true
  }

  if (message.action === 'fillForm') {
    fillForm(message.data, message.mappings, message.fallbackData).then(sendResponse).catch((error) => {
      console.error('[FormContent] Fill error:', error)
      sendResponse({ success: false, error: (error as Error).message })
    })
    return true
  }

  if (message.action === 'fillAvailableFileInput') {
    fillAvailableFileInput(
      message.assets || [],
      Boolean(message.multiple),
      String(message.pickerContext || '')
    )
      .then(sendResponse)
      .catch((error) => {
        console.warn('[FormFiller] Available file input fill failed.', error)
        sendResponse({ success: false, error: (error as Error).message })
      })
    return true
  }

  return false
})

console.log('[FormContent] Form content script loaded')
