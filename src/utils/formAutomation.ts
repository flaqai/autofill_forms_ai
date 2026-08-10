import type { ProductProfile } from '@/types'
import { getSeoListingFormDiagnosis } from '@/utils/formIntent'

const BROWSER_ERROR_PAGE_MESSAGE = '目标网页当前是浏览器错误页，插件无法读取或填写。通常是网站打不开、网络/DNS 失败，或批量任务留下的错误标签页。请先切到真正的提交表单页面，再点击填充。'

export type ExtractedFormField = {
  id: string
  name: string
  originalId?: string
  originalName?: string
  frameId?: number
  type: string
  tagName: string
  placeholder: string
  label: string
  context?: string
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

export type FillTabResult = {
  success: boolean
  filledCount: number
  attemptedCount?: number
  failedKeys?: string[]
  targetUrl?: string
  formFields?: ExtractedFormField[]
  formDiagnosis?: ReturnType<typeof getSeoListingFormDiagnosis>
  forcedFallbackCount?: number
}

export type ProductProfileFillProgress = {
  stage: 'fields' | 'matching' | 'filling'
  fieldCount?: number
  diagnosis?: ReturnType<typeof getSeoListingFormDiagnosis>
}

export type ProductProfileFillOptions = {
  requestId?: string
  forceFill?: boolean
  shouldContinue?: () => boolean
  onProgress?: (progress: ProductProfileFillProgress) => void
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function isBrowserErrorPageError(error: unknown) {
  const message = String((error as any)?.message || error || '')
  return message.includes('showing error page') || message.includes('Cannot access contents of the page')
}

export function normalizeFormFillError(error: unknown) {
  if (isBrowserErrorPageError(error)) {
    return new Error(BROWSER_ERROR_PAGE_MESSAGE)
  }

  return error instanceof Error ? error : new Error(String(error || '未知错误'))
}

const FRAME_FIELD_PREFIX = '__chat4o_frame_'

function encodeFrameFieldKey(frameId: number, key: string) {
  return `${FRAME_FIELD_PREFIX}${frameId}__${key}`
}

function decodeFrameFieldKey(key: string) {
  const match = key.match(/^__chat4o_frame_(\d+)__(.+)$/)
  if (!match) return null

  return {
    frameId: Number(match[1]),
    key: match[2]
  }
}

const extractFormFieldsDirectly = () => {
  const getFillableElements = () => {
    const nativeElements = Array.from(document.querySelectorAll('input, textarea, select')) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
    const richTextElements = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable]'))
      .filter((element) => element.isContentEditable)
      .filter((element) => {
        const parentEditor = element.parentElement?.closest<HTMLElement>('[contenteditable]')
        return !parentEditor || !parentEditor.isContentEditable
      })
    const elements = Array.from(new Set([...nativeElements, ...richTextElements]))

    const safeElements = elements.filter((el) => {
      if ('disabled' in el && el.disabled) return false

      if (el instanceof HTMLInputElement) {
        if (
          el.type === 'hidden' ||
          el.type === 'submit' ||
          el.type === 'button' ||
          el.type === 'image' ||
          el.type === 'password' ||
          el.type === 'search'
        ) {
          return false
        }

        if (el.tabIndex < 0 && el.autocomplete === 'off') return false
      }

      if ('readOnly' in el && el.readOnly) return false

      const identifier = [
        el.id,
        el.getAttribute('name'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label'),
        el.getAttribute('title')
      ].filter(Boolean).join(' ').toLowerCase()
      const nearbyContainer = el.closest<HTMLElement>('tr, label, [role="group"], .field, .form-group, .control-group')
      const nearbyText = (nearbyContainer?.innerText || nearbyContainer?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
        .toLowerCase()

      if (/(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier)) {
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
    })

    const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const scoreForm = (form: HTMLFormElement) => {
      const fieldIdentity = Array.from(form.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable], [role="combobox"]'))
        .map((field) => [field.id, field.getAttribute('name'), field.getAttribute('placeholder'), field.getAttribute('aria-label')]
          .filter(Boolean).join(' '))
        .join(' ')
      const text = compact([
        form.id,
        form.getAttribute('name'),
        form.getAttribute('action'),
        fieldIdentity,
        compact(form.innerText || form.textContent || '').slice(0, 1800)
      ].filter(Boolean).join(' ')).toLowerCase()
      let score = 0
      if (/\b(title|product name|tool name|startup name|site name|project name|headline)\b/.test(text)) score += 3
      if (/\b(url|website|homepage|home page|domain|product link|tool link|site link)\b/.test(text)) score += 4
      if (/\b(description|overview|introduction|details|about|tagline|pitch)\b/.test(text)) score += 4
      if (/\b(category|categories|industry|tags|keywords)\b/.test(text)) score += 2
      if (/\b(owner email|your email|contact email|company email|submitter email)\b/.test(text)) score += 1
      if (/\b(submit|suggest|add|publish|continue|review)\b/.test(text)) score += 1
      if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(text)) score -= 8
      if (/\b(search|newsletter|subscribe)\b/.test(text)) score -= 6
      return score
    }
    const scoredForms = Array.from(new Set(
      safeElements.map((element) => element.closest('form')).filter((form): form is HTMLFormElement => form instanceof HTMLFormElement)
    )).map((form) => ({ form, score: scoreForm(form) }))
    const bestScore = Math.max(0, ...scoredForms.map(({ score }) => score))
    if (bestScore < 7) return safeElements

    const allowedForms = new Set(
      scoredForms.filter(({ score }) => score >= 5 && score >= bestScore - 3).map(({ form }) => form)
    )
    return safeElements.filter((element) => {
      const form = element.closest('form')
      return !form || allowedForms.has(form)
    })
  }

  const getFieldLabel = (element: HTMLElement) => {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
      if (label) return label.textContent?.trim() || ''
    }

    const parentLabel = element.closest('label')
    if (parentLabel) return parentLabel.textContent?.trim() || ''

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
        .find((cell) => (cell.innerText || cell.textContent || '').trim())
      const label = labelCell ? (labelCell.innerText || labelCell.textContent || '').trim() : ''
      if (label) return label
    }

    return ''
  }

  const getNearbyLabel = (element: HTMLElement) => {
    const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const looksLikeToolbar = (value: string) => {
      const tokens = compact(value)
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
    let node: HTMLElement | null = element
    let depth = 0

    while (node?.parentElement && depth < 5) {
      let sibling = node.previousElementSibling as HTMLElement | null
      while (sibling) {
        const candidate = compact(sibling.innerText || sibling.textContent || '')
        if (
          candidate &&
          candidate.length <= 120 &&
          /[a-zA-Z\u4e00-\u9fff]/.test(candidate) &&
          !looksLikeToolbar(candidate) &&
          !/^(h1|h2|b|i|link|bullet list|ordered list|quote)$/i.test(candidate)
        ) {
          return candidate
        }
        sibling = sibling.previousElementSibling as HTMLElement | null
      }
      node = node.parentElement
      depth++
    }

    return ''
  }

  const getExtractedFieldLabel = (element: HTMLElement) => {
    const explicitLabel = getFieldLabel(element)
    if (explicitLabel) return explicitLabel
    return element.isContentEditable || element instanceof HTMLTextAreaElement ? getNearbyLabel(element) : ''
  }

  const getFieldContext = (element: HTMLElement) => {
    const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const describedBy = element.getAttribute('aria-describedby')
    const describedByText = describedBy
      ? describedBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
      : ''
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledByText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
      : ''

    const pieces = [
      getExtractedFieldLabel(element),
      (element as HTMLInputElement).placeholder || '',
      element.getAttribute('aria-label') || '',
      labelledByText,
      element.getAttribute('title') || '',
      describedByText,
      element.previousElementSibling?.textContent || '',
      element.nextElementSibling?.textContent || ''
    ]

    let parent = element.parentElement
    let depth = 0
    const contextBoundaryTags = new Set(['FORM', 'TABLE', 'TBODY', 'THEAD', 'TFOOT'])
    while (parent && depth < 3) {
      if (contextBoundaryTags.has(parent.tagName)) break
      pieces.push(parent.innerText || parent.textContent || '')
      parent = parent.parentElement
      depth++
    }

    const context = Array.from(new Set(pieces.map(compact).filter(Boolean))).join(' | ')
    return context.length > 900 ? `${context.slice(0, 900)}...` : context
  }

  const inferFieldMaxLength = (element: HTMLElement) => {
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

  return getFillableElements().map((el, index) => ({
    id: el.id || `field_${index}`,
    name: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.name
      : el.getAttribute('name')) || el.id || `field_${index}`,
    type: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.type || 'text'
      : el.isContentEditable
        ? 'richtext'
        : 'text',
    tagName: el.tagName.toLowerCase(),
    placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '',
    label: getExtractedFieldLabel(el),
    context: getFieldContext(el),
    maxLength: inferFieldMaxLength(el),
    value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.value || ''
      : el.textContent?.trim() || '',
    required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true',
    elementIndex: index,
    accept: el instanceof HTMLInputElement && el.type === 'file' ? el.accept : undefined,
    multiple: el instanceof HTMLInputElement && el.type === 'file' ? el.multiple : undefined
  }))
}

const fillFormDirectly = (data: Record<string, unknown>) => {
  const getFillableElements = () => {
    const nativeElements = Array.from(document.querySelectorAll('input, textarea, select')) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
    const richTextElements = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable]'))
      .filter((element) => element.isContentEditable)
      .filter((element) => {
        const parentEditor = element.parentElement?.closest<HTMLElement>('[contenteditable]')
        return !parentEditor || !parentEditor.isContentEditable
      })
    const elements = Array.from(new Set([...nativeElements, ...richTextElements]))

    const safeElements = elements.filter((el) => {
      if ('disabled' in el && el.disabled) return false

      if (el instanceof HTMLInputElement) {
        if (
          el.type === 'hidden' ||
          el.type === 'submit' ||
          el.type === 'button' ||
          el.type === 'image' ||
          el.type === 'password' ||
          el.type === 'search'
        ) {
          return false
        }

        if (el.tabIndex < 0 && el.autocomplete === 'off') return false
      }

      if ('readOnly' in el && el.readOnly) return false

      const identifier = [
        el.id,
        el.getAttribute('name'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label'),
        el.getAttribute('title')
      ].filter(Boolean).join(' ').toLowerCase()
      const nearbyContainer = el.closest<HTMLElement>('tr, label, [role="group"], .field, .form-group, .control-group')
      const nearbyText = (nearbyContainer?.innerText || nearbyContainer?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
        .toLowerCase()

      if (/(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier)) {
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
    })

    const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const scoreForm = (form: HTMLFormElement) => {
      const fieldIdentity = Array.from(form.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable], [role="combobox"]'))
        .map((field) => [field.id, field.getAttribute('name'), field.getAttribute('placeholder'), field.getAttribute('aria-label')]
          .filter(Boolean).join(' '))
        .join(' ')
      const text = compact([
        form.id,
        form.getAttribute('name'),
        form.getAttribute('action'),
        fieldIdentity,
        compact(form.innerText || form.textContent || '').slice(0, 1800)
      ].filter(Boolean).join(' ')).toLowerCase()
      let score = 0
      if (/\b(title|product name|tool name|startup name|site name|project name|headline)\b/.test(text)) score += 3
      if (/\b(url|website|homepage|home page|domain|product link|tool link|site link)\b/.test(text)) score += 4
      if (/\b(description|overview|introduction|details|about|tagline|pitch)\b/.test(text)) score += 4
      if (/\b(category|categories|industry|tags|keywords)\b/.test(text)) score += 2
      if (/\b(owner email|your email|contact email|company email|submitter email)\b/.test(text)) score += 1
      if (/\b(submit|suggest|add|publish|continue|review)\b/.test(text)) score += 1
      if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(text)) score -= 8
      if (/\b(search|newsletter|subscribe)\b/.test(text)) score -= 6
      return score
    }
    const scoredForms = Array.from(new Set(
      safeElements.map((element) => element.closest('form')).filter((form): form is HTMLFormElement => form instanceof HTMLFormElement)
    )).map((form) => ({ form, score: scoreForm(form) }))
    const bestScore = Math.max(0, ...scoredForms.map(({ score }) => score))
    if (bestScore < 7) return safeElements

    const allowedForms = new Set(
      scoredForms.filter(({ score }) => score >= 5 && score >= bestScore - 3).map(({ form }) => form)
    )
    return safeElements.filter((element) => {
      const form = element.closest('form')
      return !form || allowedForms.has(form)
    })
  }

  const setNativeValue = (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: unknown
  ) => {
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
      const desiredValue = String(value ?? '')
      const desiredText = desiredValue.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const matchingOption = element instanceof HTMLSelectElement
        ? Array.from(element.options).find((option) => {
            const label = (option.textContent?.trim() || option.label || option.value)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .trim()
            return option.value === desiredValue || (label && label === desiredText)
          })
        : undefined

      if (element instanceof HTMLSelectElement && matchingOption) {
        element.selectedIndex = Array.from(element.options).indexOf(matchingOption)
      }
      valueSetter?.call(element, matchingOption?.value ?? desiredValue)
    }

    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  const plainTextToRichHtml = (value: unknown) => {
    const escapeHtml = (text: string) => text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
    const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
    if (!text) return ''

    return text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('')
  }

  const setRichTextValue = (element: HTMLTextAreaElement, value: unknown) => {
    if (!element.id) return false

    const frame = document.getElementById(`${element.id}_ifr`)
    if (!(frame instanceof HTMLIFrameElement)) return false

    const editorBody = frame.contentDocument?.body
    if (!editorBody) return false

    const html = plainTextToRichHtml(value)
    editorBody.innerHTML = html
    setNativeValue(element, html)
    editorBody.dispatchEvent(new Event('input', { bubbles: true }))
    editorBody.dispatchEvent(new Event('change', { bubbles: true }))
    editorBody.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }

  const setContentEditableValue = (element: HTMLElement, value: unknown) => {
    if (!element.isContentEditable) return false

    const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
    const expectedText = text.replace(/\s+/g, ' ').trim()

    try {
      element.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(range)
      const inserted = document.execCommand('insertText', false, text)
      if (!inserted || (element.textContent || '').replace(/\s+/g, ' ').trim() !== expectedText) {
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
    return (element.textContent || '').replace(/\s+/g, ' ').trim() === expectedText
  }

  const fillableElements = getFillableElements()
  let filledCount = 0
  const failedKeys: string[] = []

  Object.entries(data).forEach(([key, value]) => {
    let element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null

    if (!element) {
      element = document.querySelector(`[name="${CSS.escape(key)}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | HTMLElement
        | null
    }

    if (!element) {
      const syntheticFieldMatch = key.match(/^field_(\d+)$/)
      if (syntheticFieldMatch) {
        element = fillableElements[Number(syntheticFieldMatch[1])] || null
      }
    }

    if (element) {
      if (element instanceof HTMLInputElement && element.type === 'file') {
        failedKeys.push(key)
        return
      }

      const richTextFilled = element instanceof HTMLTextAreaElement && setRichTextValue(element, value)
      const contentEditableFilled = element.isContentEditable && setContentEditableValue(element, value)
      if (!richTextFilled && !contentEditableFilled) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          setNativeValue(element, value)
        } else {
          failedKeys.push(key)
          return
        }
      }
      filledCount++
    } else {
      failedKeys.push(key)
    }
  })

  return {
    success: filledCount > 0,
    filledCount,
    attemptedCount: Object.keys(data).length,
    failedKeys
  }
}

function getFormHandlerScriptPath() {
  const manifest = chrome.runtime.getManifest()
  const contentScripts = manifest.content_scripts || []

  for (const contentScript of contentScripts) {
    const scriptPath = contentScript.js?.find((path) => path.includes('formHandler'))
    if (scriptPath) return scriptPath
  }

  return null
}

async function pingFormContentScript(tabId: number, frameId = 0) {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { action: 'chat4oPing' },
      { frameId }
    )
    return Boolean(response?.success)
  } catch {
    return false
  }
}

async function ensureFormContentScript(tabId: number, frameId = 0) {
  if (await pingFormContentScript(tabId, frameId)) {
    return true
  }

  const scriptPath = getFormHandlerScriptPath()
  if (!scriptPath) {
    return false
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: [scriptPath]
    })
    await wait(120)
    return pingFormContentScript(tabId, frameId)
  } catch (error) {
    console.warn(`[FormFill] Failed to inject form content script into frame ${frameId}:`, error)
    return false
  }
}

export async function waitForTabComplete(tabId: number, timeoutMs: number = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') {
      await wait(450)
      return tab
    }
    await wait(250)
  }

  return chrome.tabs.get(tabId)
}

function fieldExtractionScore(fields: ExtractedFormField[]) {
  return fields.reduce((score, field) => {
    const label = String(field.label || '').trim()
    const context = String(field.context || '').trim()
    const identifier = `${field.name || ''} ${field.id || ''} ${field.placeholder || ''}`.trim()
    const genericIdentifier = /^(field|input|select|textarea)[ _-]?\d*$/i.test(identifier)

    return score
      + 1
      + (label ? 4 : 0)
      + (context ? 2 : 0)
      + (identifier && !genericIdentifier ? 1 : 0)
      + (field.required ? 1 : 0)
  }, 0)
}

function fieldExtractionSignature(fields: ExtractedFormField[]) {
  return fields
    .map((field) => `${field.frameId ?? 0}:${field.id}:${field.name}:${field.tagName}:${field.type}`)
    .sort()
    .join('|')
}

function preferRicherFieldExtraction(
  current: ExtractedFormField[],
  candidate: ExtractedFormField[]
) {
  const currentScore = fieldExtractionScore(current)
  const candidateScore = fieldExtractionScore(candidate)

  if (candidateScore > currentScore) return candidate
  if (candidateScore === currentScore && candidate.length > current.length) return candidate
  return current
}

export async function extractFormFieldsFromTab(tabId: number): Promise<ExtractedFormField[]> {
  const hasContentScript = await ensureFormContentScript(tabId)
  let bestFields: ExtractedFormField[] = []
  let previousSignature = ''
  let stableRuns = 0

  // Framework forms often mount their real inputs shortly after the tab reports "complete".
  // Wait for two matching scans so batch runs behave like a user clicking the floating button.
  for (let attempt = 0; attempt < 6; attempt++) {
    let scanFields: ExtractedFormField[] = []

    try {
      if (hasContentScript) {
        const formFieldsResponse = await chrome.tabs.sendMessage(tabId, {
          action: 'extractFormFields'
        }, { frameId: 0 })
        if (Array.isArray(formFieldsResponse)) {
          scanFields = preferRicherFieldExtraction(
            scanFields,
            formFieldsResponse as ExtractedFormField[]
          )
        }
      }
    } catch (e) {
      console.warn('[FormFill] Content script extraction failed, using direct scan:', e)
    }

    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: extractFormFieldsDirectly
      }).catch((error) => {
        throw normalizeFormFillError(error)
      })
      const allFrameFields = injectionResults.flatMap((result) => {
        const frameId = result.frameId ?? 0
        return Array.isArray(result.result)
          ? (result.result as ExtractedFormField[]).map((field) => {
              const originalId = field.id
              const originalName = field.name
              return {
                ...field,
                originalId,
                originalName,
                frameId,
                id: encodeFrameFieldKey(frameId, originalId),
                name: encodeFrameFieldKey(frameId, originalName)
              }
            })
          : []
      }).filter((field) => !(
        field.frameId !== 0 &&
        field.type === 'richtext' &&
        field.tagName === 'body' &&
        !String(field.label || '').trim() &&
        !String(field.placeholder || '').trim() &&
        !String(field.context || '').trim()
      ))

      scanFields = preferRicherFieldExtraction(scanFields, allFrameFields)
    } catch (error) {
      console.warn('[FormFill] All-frame direct scan failed:', error)
    }

    bestFields = preferRicherFieldExtraction(bestFields, scanFields)

    const signature = fieldExtractionSignature(scanFields)
    if (signature && signature === previousSignature) {
      stableRuns++
    } else {
      previousSignature = signature
      stableRuns = 0
    }

    const usableFieldCount = scanFields.filter((field) => field.type !== 'hidden').length
    const scanScore = fieldExtractionScore(scanFields)
    if (stableRuns >= 1 && usableFieldCount >= 3 && scanScore >= 12) {
      return scanFields
    }

    if (attempt < 5) await wait(650)
  }

  return bestFields
}

export async function extractPageContextFromTab(tabId: number): Promise<string> {
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
        return compact([
          document.title,
          document.location.href,
          document.body?.innerText || document.body?.textContent || ''
        ].join(' ')).slice(0, 4000)
      }
    })

    return injectionResults.map((result) => String(result.result || '')).join(' ').slice(0, 6000)
  } catch (error) {
    console.warn('[FormFill] Failed to read page context:', error)
    return ''
  }
}

export async function fillFormInTab(
  tabId: number,
  data: Record<string, unknown>,
  mappings: unknown[] = [],
  fallbackData: Record<string, unknown> = {}
) {
  const hasFrameScopedKeys = Object.keys(data).some((key) => decodeFrameFieldKey(key))
  const hasContentScript = await ensureFormContentScript(tabId, 0)

  try {
    if (hasContentScript && !hasFrameScopedKeys) {
      const fillResult = await chrome.tabs.sendMessage(tabId, {
        action: 'fillForm',
        data,
        mappings,
        fallbackData
      }, { frameId: 0 })
      if (fillResult?.success || fillResult?.filledCount > 0) {
        return fillResult
      }
    }
  } catch (e) {
    console.warn('[FormFill] Content script fill failed, using direct fill:', e)
  }

  const groupedData = new Map<number | null, Record<string, unknown>>()
  for (const [key, value] of Object.entries(data)) {
    const decoded = decodeFrameFieldKey(key)
    const frameId = decoded?.frameId ?? null
    const fieldKey = decoded?.key ?? key
    groupedData.set(frameId, {
      ...(groupedData.get(frameId) || {}),
      [fieldKey]: value
    })
  }

  const scopedRecord = (
    source: Record<string, unknown>,
    frameId: number | null
  ) => Object.entries(source).reduce<Record<string, unknown>>((result, [key, value]) => {
    const decoded = decodeFrameFieldKey(key)
    if (frameId === null && !decoded) {
      result[key] = value
    } else if (decoded?.frameId === frameId) {
      result[decoded.key] = value
    }
    return result
  }, {})

  const scopedMappings = (
    source: unknown[],
    frameId: number | null
  ) => source.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const mapping = item as Record<string, unknown>
    const fieldId = String(mapping.fieldId || '')
    const decoded = decodeFrameFieldKey(fieldId)
    if (frameId === null && !decoded) return [mapping]
    if (decoded?.frameId !== frameId) return []
    return [{ ...mapping, fieldId: decoded.key }]
  })

  let filledCount = 0
  let attemptedCount = 0
  const failedKeys: string[] = []

  for (const [frameId, frameData] of groupedData.entries()) {
    const targetFrameId = frameId ?? 0
    const frameMappings = scopedMappings(mappings, frameId)
    const frameFallbackData = scopedRecord(fallbackData, frameId)
    const frameHasContentScript = await ensureFormContentScript(tabId, targetFrameId)

    if (frameHasContentScript) {
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          action: 'fillForm',
          data: frameData,
          mappings: frameMappings,
          fallbackData: frameFallbackData
        }, { frameId: targetFrameId })
        const frameAttemptedCount = result?.attemptedCount || Object.keys(frameData).length
        const frameFilledCount = result?.filledCount || 0
        filledCount += frameFilledCount
        attemptedCount += frameAttemptedCount
        failedKeys.push(
          ...(result?.failedKeys || []).map((key: string) => (
            frameId === null ? key : encodeFrameFieldKey(frameId, key)
          ))
        )

        // The content script is the only path that can resolve saved gallery
        // assets and verify modern upload widgets. Do not downgrade a handled
        // frame to the text-only direct filler.
        continue
      } catch (error) {
        console.warn(`[FormFill] Content script fill failed in frame ${targetFrameId}, using direct fill:`, error)
      }
    }

    const [injectionResult] = await chrome.scripting.executeScript({
      target: frameId === null ? { tabId } : { tabId, frameIds: [frameId] },
      func: fillFormDirectly,
      args: [frameData]
    }).catch((error) => {
      throw normalizeFormFillError(error)
    })
    const result = injectionResult.result || { filledCount: 0, attemptedCount: Object.keys(frameData).length, failedKeys: [] }
    filledCount += result.filledCount || 0
    attemptedCount += result.attemptedCount || Object.keys(frameData).length
    failedKeys.push(
      ...(result.failedKeys || []).map((key: string) => frameId === null ? key : encodeFrameFieldKey(frameId, key))
    )
  }

  return {
    success: filledCount > 0,
    filledCount,
    attemptedCount,
    failedKeys
  }
}

function ensureFillCanContinue(options: ProductProfileFillOptions) {
  if (options.shouldContinue && !options.shouldContinue()) {
    throw new Error('本次填充已停止')
  }
}

export async function runProductProfileFormFill(
  tab: { id: number; title?: string; url?: string },
  productProfile: ProductProfile,
  options: ProductProfileFillOptions = {}
): Promise<FillTabResult> {
  const formFields = await extractFormFieldsFromTab(tab.id)
  ensureFillCanContinue(options)

  if (formFields.length === 0) {
    throw new Error('当前页面没有找到表单字段')
  }

  const pageSummary = await extractPageContextFromTab(tab.id)
  ensureFillCanContinue(options)
  const formDiagnosis = getSeoListingFormDiagnosis(
    formFields,
    `${tab.title || ''} ${tab.url || ''} ${pageSummary}`
  )
  if (!options.forceFill && !formDiagnosis.isListingForm) {
    throw new Error(`当前页面不像 SEO 外链/目录收录/产品提交表单，已停止自动填充。判断原因：${formDiagnosis.reason}。请先打开真正的提交/收录页面。`)
  }

  options.onProgress?.({
    stage: 'fields',
    fieldCount: formFields.length,
    diagnosis: formDiagnosis
  })
  ensureFillCanContinue(options)
  options.onProgress?.({ stage: 'matching' })

  const fillResponse = await chrome.runtime.sendMessage({
    action: 'urlBasedFill',
    data: {
      formFields,
      pageContext: {
        title: tab.title,
        url: tab.url,
        summary: pageSummary
      },
      productProfile,
      requestId: options.requestId,
      forceFill: options.forceFill
    }
  })
  ensureFillCanContinue(options)

  if (!fillResponse.success) {
    throw new Error(fillResponse.error || '生成填充数据失败')
  }

  options.onProgress?.({ stage: 'filling' })
  const fillResult = await fillFormInTab(
    tab.id,
    fillResponse.filledData,
    fillResponse.mappings,
    fillResponse.fallbackData
  )
  ensureFillCanContinue(options)

  if (!fillResult?.success || fillResult.filledCount === 0) {
    throw new Error('没有成功填入任何字段')
  }

  // Some submission pages reveal the next group of fields only after a
  // category or pricing choice changes. Re-scan once so batch mode has the
  // same chance to see those fields as a user clicking the floating button a
  // second time. This is intentionally bounded and never submits the form.
  await wait(650)
  ensureFillCanContinue(options)
  const followUpFields = await extractFormFieldsFromTab(tab.id)
  ensureFillCanContinue(options)
  const initialIdentities = new Set(formFields.map((field) => (
    `${field.frameId ?? 0}|${field.id}|${field.name}|${field.label}|${field.type}`
  )))
  const retryKeys = new Set(fillResult.failedKeys || [])
  const newlyAvailableFields = followUpFields.filter((field) => {
    if (String(field.value || '').trim()) return false
    const identity = `${field.frameId ?? 0}|${field.id}|${field.name}|${field.label}|${field.type}`
    return !initialIdentities.has(identity) || retryKeys.has(field.id)
  })

  let followUpResult: Awaited<ReturnType<typeof fillFormInTab>> | null = null
  if (newlyAvailableFields.length > 0) {
    options.onProgress?.({ stage: 'matching' })
    const followUpResponse = await chrome.runtime.sendMessage({
      action: 'urlBasedFill',
      data: {
        formFields: newlyAvailableFields,
        pageContext: {
          title: tab.title,
          url: tab.url,
          summary: pageSummary
        },
        productProfile,
        requestId: options.requestId,
        forceFill: options.forceFill
      }
    })
    ensureFillCanContinue(options)

    if (followUpResponse.success && Object.keys(followUpResponse.filledData || {}).length > 0) {
      options.onProgress?.({ stage: 'filling' })
      followUpResult = await fillFormInTab(
        tab.id,
        followUpResponse.filledData,
        followUpResponse.mappings,
        followUpResponse.fallbackData
      )
      ensureFillCanContinue(options)
    }
  }

  const combinedFailedKeys = Array.from(new Set([
    ...(fillResult.failedKeys || []),
    ...(followUpResult?.failedKeys || [])
  ]))

  return {
    ...fillResult,
    filledCount: fillResult.filledCount + (followUpResult?.filledCount || 0),
    attemptedCount: (fillResult.attemptedCount || 0) + (followUpResult?.attemptedCount || 0),
    failedKeys: combinedFailedKeys,
    targetUrl: tab.url,
    formFields: followUpFields.length > formFields.length ? followUpFields : formFields,
    formDiagnosis,
    forcedFallbackCount: fillResponse.forcedFallbackCount || 0
  }
}

export async function fillTabWithProductProfile(
  tab: { id: number; title?: string; url?: string },
  productProfile: ProductProfile
): Promise<FillTabResult> {
  return runProductProfileFormFill(tab, productProfile)
}
