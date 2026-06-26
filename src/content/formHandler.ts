// Content script for form extraction and filling

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

interface FilledFieldRecord {
  key: string
  originalValue: string
  field: ExtractedFormField
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
  control: HTMLDivElement
}

let lastExtractedFields: ExtractedFormField[] = []
const filledFieldRecords = new Map<string, FilledFieldRecord>()
const learnFieldControls = new Map<string, HTMLDivElement>()

let lastActivityReportAt = 0

function reportFillableTabActivity() {
  const now = Date.now()
  if (now - lastActivityReportAt < 1000) return
  lastActivityReportAt = now

  chrome.runtime.sendMessage({ action: 'rememberFillableTab' }).catch(() => {
    // Ignore: the background service worker may be restarting.
  })
}

function getFillableElements() {
  const elements = Array.from(document.querySelectorAll('input, textarea, select, [role="combobox"]')) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
  >

  return elements.filter((el) => {
    if ('disabled' in el && el.disabled) return false

    if (el instanceof HTMLInputElement) {
      if (
        el.type === 'hidden' ||
        el.type === 'submit' ||
        el.type === 'button' ||
        el.type === 'image'
      ) {
        return false
      }
    }

    return true
  })
}

function getSelectOptions(element: HTMLElement) {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .map((option) => ({
        label: option.textContent?.trim() || option.label || option.value,
        value: option.value
      }))
      .filter((option) => option.label && option.value)
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

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function textSnippet(value: string | null | undefined, maxLength = 320) {
  const compacted = compactWhitespace(value || '')
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted
}

function isScrollable(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(`${style.overflow}${style.overflowY}`)
}

function getScrollableOptionContainers() {
  return Array.from(document.querySelectorAll('body *'))
    .filter((element): element is HTMLElement => element instanceof HTMLElement && isScrollable(element))
    .filter((element) => element.querySelector('[role="option"], [data-combobox-option], [data-option], option'))
}

async function collectCustomSelectOptions(element: HTMLElement) {
  element.click()
  await wait(160)

  const collected = new Map<string, { label: string; value: string }>()
  const collectVisible = () => {
    getVisibleOptionElements().forEach((option) => {
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

  const containers = getScrollableOptionContainers()
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

    const isCustomSelect = el.getAttribute('role') === 'combobox' && !(el instanceof HTMLSelectElement)
    const fieldName = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.name || el.id || `field_${index}`
      : el.id || `field_${index}`
    const fieldType = isCustomSelect
      ? 'select'
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? el.type || 'text'
        : 'text'
    const fieldValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.value || ''
      : el.textContent?.trim() || ''
    const options = isCustomSelect ? await collectCustomSelectOptions(el) : getSelectOptions(el)
    const field = {
      id: el.id || `field_${index}`,
      name: fieldName,
      type: fieldType,
      tagName: el.tagName.toLowerCase(),
      placeholder: (el as HTMLInputElement).placeholder || '',
      label: getFieldLabel(el),
      context: getFieldContext(el),
      maxLength: inferFieldMaxLength(el),
      value: fieldValue,
      required: (el as HTMLInputElement).required || false,
      elementIndex: index,
      accept: el instanceof HTMLInputElement && el.type === 'file' ? el.accept : undefined,
      multiple: el instanceof HTMLInputElement && el.type === 'file' ? el.multiple : undefined,
      options,
      isCustomSelect
    }

    fields.push(field)
  }

  lastExtractedFields = fields
  console.log('[FormExtractor] Extracted fields:', fields.length)
  return fields
}

// Get label text for a form field
function getFieldLabel(element: HTMLElement): string {
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

  return ''
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

function getFieldContext(element: HTMLElement): string {
  const pieces = [
    getFieldLabel(element),
    (element as HTMLInputElement).placeholder || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    getAriaDescribedByText(element),
    element.previousElementSibling?.textContent || '',
    element.nextElementSibling?.textContent || ''
  ]

  let parent: HTMLElement | null = element.parentElement
  let depth = 0
  while (parent && depth < 3) {
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
  const counterMatches = Array.from(context.matchAll(/(?:^|\D)\d{1,4}\s*\/\s*(\d{1,4})(?:\D|$)/g))
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

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: unknown
) {
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
    checkedSetter?.call(element, Boolean(value))
  } else {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    valueSetter?.call(element, String(value ?? ''))
  }

  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
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

function extensionAssetUrl(assetUrl: string) {
  if (/^(https?:|chrome-extension:|data:|blob:)/i.test(assetUrl)) return assetUrl
  return chrome.runtime.getURL(assetUrl.replace(/^\/+/, ''))
}

function fileNameFromUrl(assetUrl: string, index: number) {
  const cleanUrl = assetUrl.split(/[?#]/)[0]
  const fileName = cleanUrl.split('/').pop()
  return fileName || `product-image-${index + 1}.png`
}

function mimeTypeFromFileName(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}

async function fileFromAssetUrl(assetUrl: string, index: number) {
  const resolvedUrl = extensionAssetUrl(assetUrl)
  const response = await fetch(resolvedUrl)
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${assetUrl}`)
  }

  const blob = await response.blob()
  const fileName = fileNameFromUrl(assetUrl, index)
  return new File([blob], fileName, {
    type: blob.type || mimeTypeFromFileName(fileName)
  })
}

async function setFileInputValue(element: HTMLInputElement, value: unknown) {
  if (!isAssetFillValue(value)) return false

  const assetUrls = element.multiple ? value.assetUrls : value.assetUrls.slice(0, 1)
  if (assetUrls.length === 0) return false

  const dataTransfer = new DataTransfer()
  const files = await Promise.all(assetUrls.map((assetUrl, index) => fileFromAssetUrl(assetUrl, index)))
  files.forEach((file) => dataTransfer.items.add(file))

  element.files = dataTransfer.files
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
  return element.files.length > 0
}

function shortenToLimit(value: string, maxLength?: number) {
  if (!maxLength || value.length <= maxLength) return value

  const separatorCandidate = value.split(/\s[-|:]\s/)[0]?.trim()
  if (separatorCandidate && separatorCandidate.length <= maxLength) return separatorCandidate

  if (maxLength <= 3) return value.slice(0, maxLength)

  const sliced = value.slice(0, maxLength - 3).trim()
  const wordBoundary = sliced.replace(/\s+\S*$/, '').trim()
  const base = wordBoundary.length >= Math.floor(maxLength * 0.55) ? wordBoundary : sliced
  return `${base}...`.slice(0, maxLength)
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
  return shortenToLimit(value, inferFieldMaxLength(element))
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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function scoreOption(optionLabel: string, desiredValue: string) {
  const option = normalizeText(optionLabel)
  const desired = normalizeText(desiredValue)
  if (!option || !desired) return 0
  if (option === desired) return 100
  if (desired.includes(option) || option.includes(desired)) return 80

  const desiredWords = new Set(desired.split(' ').filter((word) => word.length > 2))
  const optionWords = option.split(' ').filter((word) => word.length > 2)
  return optionWords.reduce((score, word) => score + (desiredWords.has(word) ? 12 : 0), 0)
}

function findBestOption(options: Array<{ label: string; value: string }>, desiredValue: string) {
  return options
    .map((option) => ({ ...option, score: scoreOption(option.label, desiredValue) }))
    .sort((a, b) => b.score - a.score)[0]
}

function getVisibleOptionElements() {
  return Array.from(document.querySelectorAll('[role="option"], [data-combobox-option], [data-option]')) as HTMLElement[]
}

function findBestVisibleOption(desiredValue: string) {
  return getVisibleOptionElements()
    .map((option) => ({
      element: option,
      label: option.textContent?.trim() || '',
      score: scoreOption(option.textContent?.trim() || '', desiredValue)
    }))
    .sort((a, b) => b.score - a.score)[0]
}

async function clickBestCustomOption(desiredValue: string) {
  let bestOption = findBestVisibleOption(desiredValue)
  if (bestOption?.score > 0) {
    bestOption.element.click()
    await wait(120)
    return true
  }

  const containers = getScrollableOptionContainers()
  for (const container of containers.slice(0, 3)) {
    const originalScrollTop = container.scrollTop
    container.scrollTop = 0
    await wait(40)

    for (let step = 0; step < 35; step++) {
      bestOption = findBestVisibleOption(desiredValue)
      if (bestOption?.score > 0) {
        bestOption.element.click()
        await wait(120)
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
    const bestOption = findBestOption(getSelectOptions(element), desiredValue)
    if (bestOption?.score > 0) {
      element.value = bestOption.value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return false
  }

  element.click()
  await wait(180)

  return clickBestCustomOption(desiredValue)
}

async function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  value: unknown
) {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    return setFileInputValue(element, value)
  }

  const constrainedValue = constrainValueForField(element, value)

  if (element instanceof HTMLSelectElement || element.getAttribute('role') === 'combobox') {
    const selected = await setSelectValue(element, constrainedValue)
    if (selected) return true
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    setNativeValue(element, constrainedValue)
    return true
  }

  return false
}

function getCurrentValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement) {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    return Array.from(element.files || []).map((file) => file.name).join(', ')
  }

  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return String(element.checked)
  }

  return 'value' in element ? element.value || '' : element.textContent?.trim() || ''
}

function valueLooksFilled(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  intendedValue: unknown
) {
  const currentValue = getCurrentValue(element).trim()
  const expectedValue = String(intendedValue ?? '').trim()

  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return currentValue === String(Boolean(intendedValue))
  }

  if (element instanceof HTMLInputElement && element.type === 'file') {
    return (element.files?.length || 0) > 0
  }

  if (!expectedValue) return currentValue.length === 0
  if (!currentValue) return false

  const normalizedCurrent = normalizeText(currentValue)
  const normalizedExpected = normalizeText(expectedValue)
  return (
    normalizedCurrent === normalizedExpected ||
    normalizedCurrent.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedCurrent)
  )
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
    /\b(company|business|work|official|corporate|professional)\b/.test(context) &&
    /\b(email|e mail|mail)\b/.test(context)
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
  const fieldType = element && element.getAttribute('role') === 'combobox'
    ? 'select'
    : element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
      ? element.type || 'text'
      : 'text'

  return {
    ...(existingField || {}),
    id: existingField?.id || key,
    name: existingField?.name || key,
    type: fieldType,
    tagName: element?.tagName.toLowerCase() || 'input',
    placeholder: (element as HTMLInputElement | undefined)?.placeholder || '',
    label: element ? getFieldLabel(element) : '',
    context: element ? getFieldContext(element) : '',
    maxLength: element ? inferFieldMaxLength(element) : undefined,
    value: element ? getCurrentValue(element) : '',
    required: element ? (element as HTMLInputElement).required || false : false,
    elementIndex: elementIndex >= 0 ? elementIndex : fallbackIndex,
    options: element ? getSelectOptions(element) : [],
    isCustomSelect: element?.getAttribute('role') === 'combobox'
  }
}

function positionControl(record: FilledFieldRecord) {
  const rect = record.element.getBoundingClientRect()
  record.control.style.top = `${Math.max(8, rect.top + window.scrollY + 8)}px`
  record.control.style.left = `${Math.max(8, rect.right + window.scrollX - 40)}px`
}

function positionLearnControl(key: string) {
  const control = learnFieldControls.get(key)
  const field = getFieldForKey(key)
  const element = findElementByKey(key)
  if (!control || !element) return

  const rect = element.getBoundingClientRect()
  control.style.top = `${Math.max(8, rect.top + window.scrollY + 8)}px`
  control.style.left = `${Math.max(8, rect.right + window.scrollX - 40)}px`
  control.title = `保存到补充资料: ${field.label || field.placeholder || field.name || field.id}`
}

function closeAllMenus() {
  document.querySelectorAll('.chat4o-field-menu').forEach((menu) => {
    menu.remove()
  })
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

  const clearButton = createMenuButton('清空', async () => {
    await setFieldValue(record.element, '')
  })

  menu.appendChild(regenerateButton)
  menu.appendChild(restoreButton)
  menu.appendChild(clearButton)

  const rect = record.control.getBoundingClientRect()
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`
  menu.style.left = `${rect.left + window.scrollX - 70}px`
  document.documentElement.appendChild(menu)
}

function attachFieldControl(
  key: string,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
  mapping?: FillMapping
) {
  const existingRecord = filledFieldRecords.get(key)
  if (existingRecord) {
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
    originalValue: getFieldForKey(key).value,
    field: getFieldForKey(key),
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
    const value = currentElement ? getCurrentValue(currentElement).trim() : ''
    if (!value) {
      showTemporaryButtonState(control, '!', '#dc2626')
      return
    }

    control.textContent = '...'
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'addExtraInfo',
        data: {
          field: getFieldForKey(key),
          value,
          pageUrl: window.location.href
        }
      })

      if (response?.success) {
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
reportFillableTabActivity()

// Fill form fields with provided data
async function fillForm(
  data: Record<string, any>,
  mappings: FillMapping[] = [],
  fallbackData: Record<string, any> = {}
) {
  console.log('[FormFiller] Filling form with data:', data)

  let filledCount = 0
  const failedKeys: string[] = []
  const filledKeys = new Set<string>()
  const mappingByFieldId = new Map(mappings.map((mapping) => [mapping.fieldId, mapping]))

  for (const [key, value] of Object.entries(data)) {
    const element = findElementByKey(key)

    if (element) {
      const filled = await setFieldValue(element, value)
      await wait(180)
      const lengthLimitedValue = await applyPostFillLengthLimit(element, value)
      let finalValue = value
      let verified = filled && valueLooksFilled(element, lengthLimitedValue)
      const fallbackValue = fallbackData[key]

      if (
        fallbackValue &&
        String(fallbackValue) !== String(value) &&
        isEmailValue(fallbackValue) &&
        (
          !verified ||
          (isPublicEmailValue(value) && (hasFormalEmailRequirement(element) || hasPublicEmailRejection(element)))
        )
      ) {
        const fallbackFilled = await setFieldValue(element, fallbackValue)
        await wait(120)
        if (fallbackFilled && valueLooksFilled(element, fallbackValue)) {
          finalValue = fallbackValue
          verified = true
        }
      }

      if (verified) {
        finalValue = getCurrentValue(element) || finalValue
        if (finalValue !== value) {
          data[key] = finalValue
        }
        attachFieldControl(key, element, mappingByFieldId.get(key))
        filledKeys.add(key)
        filledCount++
        console.log(`[FormFiller] Filled field: ${key} = ${finalValue}`)
      } else {
        failedKeys.push(key)
      }
    } else {
      failedKeys.push(key)
    }
  }

  attachLearnControlsForUnfilledFields(filledKeys)

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

  return false
})

console.log('[FormContent] Form content script loaded')
