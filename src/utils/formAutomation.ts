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

export type FillTabResult = {
  success: boolean
  filledCount: number
  attemptedCount?: number
  failedKeys?: string[]
  targetUrl?: string
  formFields?: ExtractedFormField[]
  formDiagnosis?: ReturnType<typeof getSeoListingFormDiagnosis>
  forcedFallbackCount?: number
  remainingRequiredKeys?: string[]
  remainingInvalidKeys?: string[]
  emptyEligibleKeys?: string[]
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

const extractFormFieldsDirectly = async () => {
  const isEditableContentControl = (element: HTMLElement) => {
    const contentEditable = element.getAttribute('contenteditable')?.toLowerCase()
    return element.isContentEditable || contentEditable === 'true' || contentEditable === 'plaintext-only'
  }

  const compactControlText = (element: HTMLElement) => (element.innerText || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()

  const isVisibleControl = (element: HTMLElement) => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0
  }

  const isAriaCheckboxControl = (element: HTMLElement) => (
    element.getAttribute('role') === 'checkbox' &&
    element.hasAttribute('aria-checked') &&
    isVisibleControl(element)
  )

  const isHiddenNativeCheckboxProxy = (element: HTMLElement) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const hidden = element.getAttribute('aria-hidden') === 'true' || style.display === 'none' ||
      style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 1 || rect.height <= 1
    if (!hidden) return false
    let container: HTMLElement | null = element.parentElement
    for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
      const proxies = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked]'))
        .filter((candidate) => candidate !== element && isAriaCheckboxControl(candidate))
      if (proxies.length === 1) return true
    }
    return false
  }

  const semanticPickerIdentity = (element: HTMLElement) => {
    const explicitLabel = element.id
      ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent
      : ''
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ')
    const container = element.closest<HTMLElement>('[role="group"], .field, .form-group, .control-group, [data-field]')
    let precedingLabel = ''
    let node: HTMLElement | null = element
    for (let depth = 0; node?.parentElement && depth < 4 && !precedingLabel; depth++) {
      let sibling = node.previousElementSibling as HTMLElement | null
      while (sibling) {
        const text = (sibling.innerText || sibling.textContent || '').replace(/\s+/g, ' ').trim()
        if (text && text.length <= 120) {
          precedingLabel = text
          break
        }
        sibling = sibling.previousElementSibling as HTMLElement | null
      }
      node = node.parentElement
    }
    return [element.id, element.getAttribute('name'), (element as HTMLInputElement).placeholder,
      element.getAttribute('aria-label'), explicitLabel, labelledBy, element.closest('label')?.textContent,
      element.closest('fieldset')?.querySelector('legend')?.textContent,
      precedingLabel,
      container?.innerText || container?.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500).toLowerCase()
  }

  const isSemanticSearchSelectControl = (element: HTMLElement) => {
    if (!(element instanceof HTMLInputElement) || !['text', 'search'].includes(element.type)) return false
    const identity = semanticPickerIdentity(element)
    return /\b(category|categories|tags?|topics?|segments?|industr(?:y|ies)|markets?|verticals?|sectors?|use cases?)\b/.test(identity) &&
      /\b(search|select|choose|pick|add)\b/.test(identity)
  }

  const isCustomSelectControl = (element: HTMLElement) => (
    !(element instanceof HTMLSelectElement) &&
    (element.getAttribute('role') === 'combobox' || isSemanticSearchSelectControl(element))
  )

  const isVirtualFileControl = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element.closest('[role="dialog"]')) return false
    const text = compactControlText(element)
    if (!text || text.length > 180) return false
    if (!/(?:drop|drag).{0,40}files?.{0,50}(?:browse|choose|select)|(?:browse|choose|select).{0,30}files?/i.test(text)) {
      return false
    }
    const rect = element.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 12) return false
    return !Array.from(element.children).some((child) => (
      child instanceof HTMLElement &&
      compactControlText(child) === text &&
      child.getBoundingClientRect().width >= 40 &&
      child.getBoundingClientRect().height >= 12
    ))
  }

  type VirtualPlanOption = {
    element: HTMLButtonElement
    label: string
    noCost: boolean
    paid: boolean
  }
  type VirtualPlanGroup = {
    container: HTMLElement
    label: string
    options: VirtualPlanOption[]
    anchor: HTMLButtonElement
  }
  const planGroupLabelPattern = /\b(?:choose(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|select(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|listing\s+(?:plan|tier|option|type)|submission\s+(?:plan|tier|option)|(?:plan|tier)\s+(?:choice|option))\b/i
  const forbiddenPlanActionPattern = /\b(?:pay|payment|checkout|purchase|buy|upgrade|subscribe|continue|next|submit|publish|confirm|finish|proceed|save)\b/i
  const normalizePlanText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const currencyAmount = (value: string) => {
    const symbolMatch = value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*(\d+(?:[.,]\d{1,2})?)/i)
    if (symbolMatch) return Number(symbolMatch[1].replace(',', '.'))
    const codeMatch = value.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)
    return codeMatch ? Number(codeMatch[1].replace(',', '.')) : null
  }
  const planPriceText = (value: string) => (
    value.match(/\b(?:free|no[\s-]?cost)\b/i)?.[0] ||
    value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*\d+(?:[.,]\d{1,2})?/i)?.[0] ||
    value.match(/\d+(?:[.,]\d{1,2})?\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)?.[0] || ''
  )
  const planOptionLabel = (button: HTMLButtonElement) => {
    const fullText = compactControlText(button)
    const price = planPriceText(fullText)
    const heading = Array.from(button.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"], strong'))
      .map(compactControlText)
      .find((text) => text && text.length <= 90 && !/^\s*(?:free|no[\s-]?cost|(?:US\$|CA\$|AU\$|[$€£¥])?\s*\d)/i.test(text))
    const fallback = (button.innerText || button.textContent || '').split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find((line) => line && line.length <= 90 && !planPriceText(line) && !forbiddenPlanActionPattern.test(line)) || ''
    const title = heading || fallback || fullText.replace(price, '').trim().slice(0, 90)
    return !price || normalizePlanText(title).includes(normalizePlanText(price))
      ? title
      : `${title} ${price}`.replace(/\s+/g, ' ').trim()
  }
  const noCostPlanText = (value: string) => {
    const text = normalizePlanText(value)
    const amount = currencyAmount(value)
    if (amount !== null && amount > 0) return false
    return /\b(?:free|no cost)\b/.test(text) || amount === 0 ||
      /^(?:regular|regular listing|standard|standard listing)$/.test(text)
  }
  const paidPlanText = (value: string) => {
    const amount = currencyAmount(value)
    return (amount !== null && amount > 0) || /\bpaid\b/i.test(value)
  }
  const explicitPlanGroupLabel = (container: HTMLElement) => {
    const labelledBy = container.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ')
    return [
      container.getAttribute('aria-label') || '',
      labelledBy || '',
      ...Array.from(container.querySelectorAll<HTMLElement>('legend, h1, h2, h3, h4, h5, h6, [role="heading"], label'))
        .filter((candidate) => !candidate.closest('button'))
        .map(compactControlText)
    ].find((candidate) => candidate.length <= 140 && planGroupLabelPattern.test(candidate)) || ''
  }
  const getVirtualPlanGroup = (element: HTMLElement): VirtualPlanGroup | null => {
    if (!(element instanceof HTMLButtonElement) || element.type !== 'button') return null
    let container: HTMLElement | null = element.parentElement
    for (let depth = 0; container && depth < 7; depth++) {
      if (container === document.body || container.tagName === 'FORM') break
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      if (buttons.length < 2 || buttons.length > 6 ||
        buttons.some((button) => button.type !== 'button' || button.getAttribute('type')?.toLowerCase() !== 'button') ||
        buttons.some((button) => button.disabled || !isVisibleControl(button))) {
        container = container.parentElement
        continue
      }
      const label = explicitPlanGroupLabel(container)
      if (!label) {
        container = container.parentElement
        continue
      }
      const options = buttons.map<VirtualPlanOption>((button) => {
        const optionLabel = planOptionLabel(button)
        const text = `${optionLabel} ${compactControlText(button)}`
        return { element: button, label: optionLabel, noCost: noCostPlanText(text), paid: paidPlanText(text) }
      })
      if (options.some((option) => !option.label)) {
        container = container.parentElement
        continue
      }
      const safeOptions = options.filter((option) => option.noCost && !option.paid)
      if (safeOptions.length === 0 || !options.some((option) => option.paid)) {
        container = container.parentElement
        continue
      }
      return { container, label: label.replace(/\s+/g, ' ').trim(), options, anchor: safeOptions[0].element }
    }
    return null
  }
  const isVirtualPlanControl = (element: HTMLElement) => {
    const group = getVirtualPlanGroup(element)
    return Boolean(group && group.anchor === element)
  }
  const virtualPlanControls = () => {
    const seen = new Set<HTMLElement>()
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
      .map(getVirtualPlanGroup)
      .filter((group): group is VirtualPlanGroup => Boolean(group))
      .filter((group) => {
        if (seen.has(group.container)) return false
        seen.add(group.container)
        return true
      })
      .map((group) => group.anchor)
  }
  const virtualPlanSelected = (element: HTMLElement) => {
    const state = normalizePlanText([
      element.getAttribute('aria-pressed'), element.getAttribute('aria-selected'),
      element.getAttribute('aria-checked'), element.getAttribute('data-selected'),
      element.getAttribute('data-state')
    ].filter(Boolean).join(' '))
    return /\b(?:true|selected|checked|active|on)\b/.test(state) ||
      Array.from(element.classList).some((className) => /^(?:is-)?(?:selected|checked|chosen|current)$|^active$/i.test(className))
  }
  const currentVirtualPlanChoice = (element: HTMLElement) => {
    const group = getVirtualPlanGroup(element)
    return group?.options.find((option) => virtualPlanSelected(option.element))?.label || ''
  }

  const getFillableElements = () => {
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
    const elements = Array.from(new Set([...nativeElements, ...virtualFileControls, ...virtualPlanControls()])).sort((left, right) => {
      if (left === right) return 0
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })

    const safeElements = elements.filter((el) => {
      if ('disabled' in el && el.disabled) return false

      // Upload widgets normally hide the native file input and expose a
      // separate drop zone. A negative tab index must not exclude the input.
      if (el instanceof HTMLInputElement && el.type === 'file') return true

      if (el instanceof HTMLInputElement) {
        const semanticPicker = isSemanticSearchSelectControl(el)
        if (
          el.type === 'hidden' ||
          el.type === 'submit' ||
          el.type === 'button' ||
          el.type === 'image' ||
          el.type === 'password' ||
          (el.type === 'search' && !semanticPicker)
        ) {
          return false
        }

        if (isHiddenNativeCheckboxProxy(el)) return false

        const hasAccessibleIdentity = Boolean([
          el.id,
          el.name,
          el.placeholder,
          el.getAttribute('aria-label'),
          el.getAttribute('aria-labelledby'),
          el.title
        ].find(Boolean))
        const isContentEditableHelper = el.classList.contains('editableFix') || Boolean(
          el.tabIndex < 0 &&
          !hasAccessibleIdentity &&
          el.parentElement?.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')
        )
        if (isContentEditableHelper) return false

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

      if (/(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier) && !isSemanticSearchSelectControl(el)) {
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
      if (/\b(register|registration|sign up|signup|create account|join now)\b/.test(text)) score += 4
      if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(text)) score -= 8
      if (/\b(search|newsletter|subscribe)\b/.test(text)) score -= 6
      return score
    }
    const scoredForms = Array.from(new Set(
      safeElements.map((element) => element.closest('form')).filter((form): form is HTMLFormElement => form instanceof HTMLFormElement)
    )).map((form) => ({ form, score: scoreForm(form) }))
    const bestScore = Math.max(0, ...scoredForms.map(({ score }) => score))
    const allowedForms = new Set(
      scoredForms.filter(({ score }) => score >= 3 && score >= bestScore - 2).map(({ form }) => form)
    )
    const primaryElements = scoredForms.length <= 1 || bestScore < 3
      ? safeElements
      : safeElements.filter((element) => {
          const form = element.closest('form')
          return !form || allowedForms.has(form)
        })

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

    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledByText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      : ''
    if (labelledByText) return labelledByText

    const ariaLabel = element.getAttribute('aria-label')?.trim()
    if (ariaLabel) return ariaLabel

    return isEditableContentControl(element) || element instanceof HTMLTextAreaElement ? getNearbyLabel(element) : ''
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

  const getUploadContext = (element: HTMLInputElement) => {
    const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const baseContext = getFieldContext(element)
    if (/\b(logo|icon|avatar|image|picture|photo|screenshot|banner|gallery|upload)\b|图标|圖標|图片|圖片|上传|上傳/i.test(baseContext)) {
      return baseContext
    }

    let node: HTMLElement | null = element
    for (let depth = 0; node?.parentElement && depth < 6; depth++) {
      let sibling = node.previousElementSibling as HTMLElement | null
      while (sibling) {
        const text = compact(sibling.innerText || sibling.textContent || '')
        if (text && text.length <= 600) {
          const context = `${text} | ${baseContext}`
          return context.length > 900 ? `${context.slice(0, 900)}...` : context
        }
        sibling = sibling.previousElementSibling as HTMLElement | null
      }
      node = node.parentElement
    }

    return baseContext
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
    const counterMatches = Array.from(
      context.matchAll(/(?:^|\D)\d{1,4}\s*\/\s*(\d{1,4})\s*(words?|characters?|chars?)?(?:\D|$)/gi)
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

  const collectOptions = async (element: HTMLElement) => {
    const virtualPlanGroup = getVirtualPlanGroup(element)
    if (virtualPlanGroup?.anchor === element) {
      return virtualPlanGroup.options.map((option) => ({ label: option.label, value: option.label }))
    }

    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
        .filter((candidate) => candidate.name === element.name && candidate.form === element.form)
        .map((candidate) => ({
          label: getFieldLabel(candidate) || candidate.getAttribute('aria-label') || candidate.value,
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

    if (!isCustomSelectControl(element)) return []

    element.click()
    await new Promise((resolve) => window.setTimeout(resolve, 180))

    const controlledIds = [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')]
      .flatMap((value) => String(value || '').split(/\s+/)).filter(Boolean)
    const controlledRoots = controlledIds.map((id) => document.getElementById(id))
      .filter((root): root is HTMLElement => root instanceof HTMLElement)
    const visibleListboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(isVisibleControl)
    const roots = controlledRoots.length > 0 ? controlledRoots : visibleListboxes.length === 1 ? visibleListboxes : []
    const options = roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(
      '[role="option"], [data-combobox-option], [data-option]'
    )))
      .filter((option) => {
        const rect = option.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((option) => {
        const label = (option.innerText || option.textContent || '').trim()
        return {
          label,
          value: option.getAttribute('data-value') || label
        }
      })
      .filter((option, index, list) => (
        option.label && list.findIndex((candidate) => candidate.label === option.label) === index
      ))

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    element.dispatchEvent(escapeEvent)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    element.blur()
    return options
  }

  const fields = []
  for (const [index, el] of getFillableElements().entries()) {
    const isCustomSelect = isCustomSelectControl(el)
    const isAriaCheckbox = isAriaCheckboxControl(el)
    const isVirtualFile = isVirtualFileControl(el)
    const isVirtualPlan = isVirtualPlanControl(el)
    const radioGroup = el instanceof HTMLInputElement && el.type === 'radio' && el.name
      ? Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
          .filter((candidate) => candidate.name === el.name && candidate.form === el.form)
      : []
    const fieldValue = el instanceof HTMLInputElement && el.type === 'radio'
      ? radioGroup.find((candidate) => candidate.checked)?.value || ''
      : isAriaCheckbox
        ? el.getAttribute('aria-checked') === 'true' ? 'true' : ''
      : el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked ? el.value || 'true' : ''
        : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
          ? el.value || ''
          : isVirtualPlan ? currentVirtualPlanChoice(el) : el.textContent?.trim() || ''
    const required = radioGroup.length > 0
      ? radioGroup.some((candidate) => candidate.required || candidate.getAttribute('aria-required') === 'true')
      : (el instanceof HTMLInputElement && el.required) || el.getAttribute('aria-required') === 'true' ||
        (isAriaCheckbox && el.closest('[aria-required="true"]') !== null)
    const shouldCheckValidity = required || Boolean(String(fieldValue).trim())
    const formControl = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el
      : null
    const invalid = el.getAttribute('aria-invalid') === 'true' ||
      Boolean(shouldCheckValidity && formControl && !formControl.checkValidity())
    fields.push({
      id: el.id || `field_${index}`,
      name: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? el.name
        : el.getAttribute('name')) || el.id || `field_${index}`,
      type: isVirtualFile
        ? 'file'
        : isVirtualPlan
          ? 'select'
        : isCustomSelect
        ? 'select'
        : isAriaCheckbox
          ? 'checkbox'
        : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
          ? el.type || 'text'
          : isEditableContentControl(el)
            ? 'richtext'
            : 'text',
      tagName: el.tagName.toLowerCase(),
      placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '',
      label: isVirtualPlan ? getVirtualPlanGroup(el)?.label || '' : getExtractedFieldLabel(el),
      context: el instanceof HTMLInputElement && el.type === 'file'
        ? getUploadContext(el)
        : isVirtualPlan
          ? `${getVirtualPlanGroup(el)?.label || ''} | ${getVirtualPlanGroup(el)?.container.innerText || ''}`.slice(0, 900)
          : getFieldContext(el),
      maxLength: inferFieldMaxLength(el),
      value: fieldValue,
      required,
      invalid,
      validationMessage: invalid ? formControl?.validationMessage || '' : '',
      elementIndex: index,
      accept: el instanceof HTMLInputElement && el.type === 'file'
        ? el.accept
        : isVirtualFile ? 'image/*' : undefined,
      multiple: el instanceof HTMLInputElement && el.type === 'file' ? el.multiple : false,
      options: await collectOptions(el),
      isCustomSelect: isCustomSelect || isVirtualPlan
    })
  }

  return fields
}

const fillFormDirectly = (data: Record<string, unknown>) => {
  const isEditableContentControl = (element: HTMLElement) => {
    const contentEditable = element.getAttribute('contenteditable')?.toLowerCase()
    return element.isContentEditable || contentEditable === 'true' || contentEditable === 'plaintext-only'
  }

  const compactControlText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
  const acceptedCustomSelectValues = new WeakMap<HTMLElement, string>()
  const acceptedVirtualPlanChoices = new WeakMap<HTMLElement, string>()
  const isVisibleControl = (element: HTMLElement) => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0
  }
  const isAriaCheckboxControl = (element: HTMLElement) => (
    element.getAttribute('role') === 'checkbox' && element.hasAttribute('aria-checked') && isVisibleControl(element)
  )
  const isHiddenNativeCheckboxProxy = (element: HTMLElement) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const hidden = element.getAttribute('aria-hidden') === 'true' || style.display === 'none' ||
      style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 1 || rect.height <= 1
    if (!hidden) return false
    let container: HTMLElement | null = element.parentElement
    for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
      const proxies = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked]'))
        .filter((candidate) => candidate !== element && isAriaCheckboxControl(candidate))
      if (proxies.length === 1) return true
    }
    return false
  }
  const semanticPickerIdentity = (element: HTMLElement) => {
    const explicitLabel = element.id
      ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent
      : ''
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ')
    const container = element.closest<HTMLElement>('[role="group"], .field, .form-group, .control-group, [data-field]')
    let precedingLabel = ''
    let node: HTMLElement | null = element
    for (let depth = 0; node?.parentElement && depth < 4 && !precedingLabel; depth++) {
      let sibling = node.previousElementSibling as HTMLElement | null
      while (sibling) {
        const text = (sibling.innerText || sibling.textContent || '').replace(/\s+/g, ' ').trim()
        if (text && text.length <= 120) {
          precedingLabel = text
          break
        }
        sibling = sibling.previousElementSibling as HTMLElement | null
      }
      node = node.parentElement
    }
    return [element.id, element.getAttribute('name'), (element as HTMLInputElement).placeholder,
      element.getAttribute('aria-label'), explicitLabel, labelledBy, element.closest('label')?.textContent,
      element.closest('fieldset')?.querySelector('legend')?.textContent,
      precedingLabel,
      container?.innerText || container?.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500).toLowerCase()
  }
  const isSemanticSearchSelectControl = (element: HTMLElement) => {
    if (!(element instanceof HTMLInputElement) || !['text', 'search'].includes(element.type)) return false
    const identity = semanticPickerIdentity(element)
    return /\b(category|categories|tags?|topics?|segments?|industr(?:y|ies)|markets?|verticals?|sectors?|use cases?)\b/.test(identity) &&
      /\b(search|select|choose|pick|add)\b/.test(identity)
  }
  const isCustomSelectControl = (element: HTMLElement) => (
    !(element instanceof HTMLSelectElement) &&
    (element.getAttribute('role') === 'combobox' || isSemanticSearchSelectControl(element))
  )
  const isVirtualFileControl = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element.closest('[role="dialog"]')) return false
    const text = compactControlText(element.innerText || element.textContent || '')
    if (!text || text.length > 180) return false
    if (!/(?:drop|drag).{0,40}files?.{0,50}(?:browse|choose|select)|(?:browse|choose|select).{0,30}files?/i.test(text)) return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 12) return false
    return !Array.from(element.children).some((child) => (
      child instanceof HTMLElement &&
      compactControlText(child.innerText || child.textContent || '') === text &&
      child.getBoundingClientRect().width >= 40 &&
      child.getBoundingClientRect().height >= 12
    ))
  }
  type VirtualPlanOption = {
    element: HTMLButtonElement
    label: string
    noCost: boolean
    paid: boolean
  }
  type VirtualPlanGroup = {
    container: HTMLElement
    label: string
    options: VirtualPlanOption[]
    anchor: HTMLButtonElement
  }
  const planGroupLabelPattern = /\b(?:choose(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|select(?:\s+(?:a|your))?\s+(?:listing|plan|tier|option)|listing\s+(?:plan|tier|option|type)|submission\s+(?:plan|tier|option)|(?:plan|tier)\s+(?:choice|option))\b/i
  const forbiddenPlanActionPattern = /\b(?:pay|payment|checkout|purchase|buy|upgrade|subscribe|continue|next|submit|publish|confirm|finish|proceed|save)\b/i
  const normalizePlanText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const currencyAmount = (value: string) => {
    const symbolMatch = value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*(\d+(?:[.,]\d{1,2})?)/i)
    if (symbolMatch) return Number(symbolMatch[1].replace(',', '.'))
    const codeMatch = value.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)
    return codeMatch ? Number(codeMatch[1].replace(',', '.')) : null
  }
  const planPriceText = (value: string) => (
    value.match(/\b(?:free|no[\s-]?cost)\b/i)?.[0] ||
    value.match(/(?:US\$|CA\$|AU\$|[$€£¥])\s*\d+(?:[.,]\d{1,2})?/i)?.[0] ||
    value.match(/\d+(?:[.,]\d{1,2})?\s*(?:USD|EUR|GBP|CNY|RMB|JPY|CAD|AUD)\b/i)?.[0] || ''
  )
  const planOptionLabel = (button: HTMLButtonElement) => {
    const fullText = compactControlText(button.innerText || button.textContent || '')
    const price = planPriceText(fullText)
    const heading = Array.from(button.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"], strong'))
      .map((candidate) => compactControlText(candidate.innerText || candidate.textContent || ''))
      .find((text) => text && text.length <= 90 && !/^\s*(?:free|no[\s-]?cost|(?:US\$|CA\$|AU\$|[$€£¥])?\s*\d)/i.test(text))
    const fallback = (button.innerText || button.textContent || '').split(/\r?\n/)
      .map(compactControlText)
      .find((line) => line && line.length <= 90 && !planPriceText(line) && !forbiddenPlanActionPattern.test(line)) || ''
    const title = heading || fallback || fullText.replace(price, '').trim().slice(0, 90)
    return !price || normalizePlanText(title).includes(normalizePlanText(price))
      ? title
      : `${title} ${price}`.replace(/\s+/g, ' ').trim()
  }
  const noCostPlanText = (value: string) => {
    const text = normalizePlanText(value)
    const amount = currencyAmount(value)
    if (amount !== null && amount > 0) return false
    return /\b(?:free|no cost)\b/.test(text) || amount === 0 ||
      /^(?:regular|regular listing|standard|standard listing)$/.test(text)
  }
  const paidPlanText = (value: string) => {
    const amount = currencyAmount(value)
    return (amount !== null && amount > 0) || /\bpaid\b/i.test(value)
  }
  const explicitPlanGroupLabel = (container: HTMLElement) => {
    const labelledBy = container.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ')
    return [
      container.getAttribute('aria-label') || '', labelledBy || '',
      ...Array.from(container.querySelectorAll<HTMLElement>('legend, h1, h2, h3, h4, h5, h6, [role="heading"], label'))
        .filter((candidate) => !candidate.closest('button'))
        .map((candidate) => compactControlText(candidate.innerText || candidate.textContent || ''))
    ].find((candidate) => candidate.length <= 140 && planGroupLabelPattern.test(candidate)) || ''
  }
  const getVirtualPlanGroup = (element: HTMLElement): VirtualPlanGroup | null => {
    if (!(element instanceof HTMLButtonElement) || element.type !== 'button') return null
    let container: HTMLElement | null = element.parentElement
    for (let depth = 0; container && depth < 7; depth++) {
      if (container === document.body || container.tagName === 'FORM') break
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      if (buttons.length < 2 || buttons.length > 6 ||
        buttons.some((button) => button.type !== 'button' || button.getAttribute('type')?.toLowerCase() !== 'button') ||
        buttons.some((button) => button.disabled || !isVisibleControl(button))) {
        container = container.parentElement
        continue
      }
      const label = explicitPlanGroupLabel(container)
      if (!label) {
        container = container.parentElement
        continue
      }
      const options = buttons.map<VirtualPlanOption>((button) => {
        const optionLabel = planOptionLabel(button)
        const text = `${optionLabel} ${compactControlText(button.innerText || button.textContent || '')}`
        return { element: button, label: optionLabel, noCost: noCostPlanText(text), paid: paidPlanText(text) }
      })
      if (options.some((option) => !option.label)) {
        container = container.parentElement
        continue
      }
      const safeOptions = options.filter((option) => option.noCost && !option.paid)
      if (safeOptions.length === 0 || !options.some((option) => option.paid)) {
        container = container.parentElement
        continue
      }
      return { container, label: label.replace(/\s+/g, ' ').trim(), options, anchor: safeOptions[0].element }
    }
    return null
  }
  const isVirtualPlanControl = (element: HTMLElement) => {
    const group = getVirtualPlanGroup(element)
    return Boolean(group && group.anchor === element)
  }
  const virtualPlanControls = () => {
    const seen = new Set<HTMLElement>()
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
      .map(getVirtualPlanGroup)
      .filter((group): group is VirtualPlanGroup => Boolean(group))
      .filter((group) => {
        if (seen.has(group.container)) return false
        seen.add(group.container)
        return true
      })
      .map((group) => group.anchor)
  }
  const virtualPlanSelected = (element: HTMLElement) => {
    const state = normalizePlanText([
      element.getAttribute('aria-pressed'), element.getAttribute('aria-selected'),
      element.getAttribute('aria-checked'), element.getAttribute('data-selected'),
      element.getAttribute('data-state')
    ].filter(Boolean).join(' '))
    return /\b(?:true|selected|checked|active|on)\b/.test(state) ||
      Array.from(element.classList).some((className) => /^(?:is-)?(?:selected|checked|chosen|current)$|^active$/i.test(className))
  }
  const planStyleSignature = (element: HTMLElement) => {
    const style = window.getComputedStyle(element)
    return [element.className, element.getAttribute('style') || '', style.backgroundColor, style.borderColor,
      style.borderWidth, style.boxShadow, style.outlineColor, style.outlineWidth].join('|')
  }
  const exactNoCostPreference = (value: unknown) => (
    /^(?:free|no cost|regular|regular listing|standard|standard listing)$/.test(normalizePlanText(String(value ?? '')))
  )
  const safePlanOption = (group: VirtualPlanGroup, value: unknown) => {
    const desired = normalizePlanText(String(value ?? ''))
    if (!desired) return null
    const safeOptions = group.options.filter((option) => (
      option.noCost && !option.paid &&
      !forbiddenPlanActionPattern.test(compactControlText(option.element.innerText || option.element.textContent || ''))
    ))
    const exact = safeOptions.filter((option) => normalizePlanText(option.label) === desired)
    if (exact.length === 1) return exact[0]
    return exactNoCostPreference(value) && safeOptions.length === 1 ? safeOptions[0] : null
  }
  const currentVirtualPlanChoice = (element: HTMLElement) => {
    const group = getVirtualPlanGroup(element)
    return group?.options.find((option) => virtualPlanSelected(option.element))?.label ||
      acceptedVirtualPlanChoices.get(element) || ''
  }
  const setVirtualPlanValue = async (element: HTMLElement, value: unknown) => {
    const group = getVirtualPlanGroup(element)
    if (!group || group.anchor !== element) return null
    const option = safePlanOption(group, value)
    if (!option) return null
    if (virtualPlanSelected(option.element)) {
      acceptedVirtualPlanChoices.set(element, option.label)
      return option
    }
    const beforeStyle = planStyleSignature(option.element)
    option.element.click()
    await new Promise((resolve) => window.setTimeout(resolve, 160))
    option.element.blur()
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    if (!virtualPlanSelected(option.element) && beforeStyle === planStyleSignature(option.element)) return null
    if (group.options.some((candidate) => candidate.paid && virtualPlanSelected(candidate.element))) return null
    acceptedVirtualPlanChoices.set(element, option.label)
    return option
  }

  const getFillableElements = () => {
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
    const elements = Array.from(new Set([...nativeElements, ...virtualFileControls, ...virtualPlanControls()])).sort((left, right) => {
      if (left === right) return 0
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })

    const safeElements = elements.filter((el) => {
      if ('disabled' in el && el.disabled) return false

      // Upload widgets normally hide the native file input and expose a
      // separate drop zone. A negative tab index must not exclude the input.
      if (el instanceof HTMLInputElement && el.type === 'file') return true

      if (el instanceof HTMLInputElement) {
        const semanticPicker = isSemanticSearchSelectControl(el)
        if (
          el.type === 'hidden' ||
          el.type === 'submit' ||
          el.type === 'button' ||
          el.type === 'image' ||
          el.type === 'password' ||
          (el.type === 'search' && !semanticPicker)
        ) {
          return false
        }

        if (isHiddenNativeCheckboxProxy(el)) return false

        const hasAccessibleIdentity = Boolean([
          el.id,
          el.name,
          el.placeholder,
          el.getAttribute('aria-label'),
          el.getAttribute('aria-labelledby'),
          el.title
        ].find(Boolean))
        const isContentEditableHelper = el.classList.contains('editableFix') || Boolean(
          el.tabIndex < 0 &&
          !hasAccessibleIdentity &&
          el.parentElement?.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')
        )
        if (isContentEditableHelper) return false

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

      if (/(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier) && !isSemanticSearchSelectControl(el)) {
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
      if (/\b(register|registration|sign up|signup|create account|join now)\b/.test(text)) score += 4
      if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(text)) score -= 8
      if (/\b(search|newsletter|subscribe)\b/.test(text)) score -= 6
      return score
    }
    const scoredForms = Array.from(new Set(
      safeElements.map((element) => element.closest('form')).filter((form): form is HTMLFormElement => form instanceof HTMLFormElement)
    )).map((form) => ({ form, score: scoreForm(form) }))
    const bestScore = Math.max(0, ...scoredForms.map(({ score }) => score))
    const allowedForms = new Set(
      scoredForms.filter(({ score }) => score >= 3 && score >= bestScore - 2).map(({ form }) => form)
    )
    const primaryElements = scoredForms.length <= 1 || bestScore < 3
      ? safeElements
      : safeElements.filter((element) => {
          const form = element.closest('form')
          return !form || allowedForms.has(form)
        })

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

  const setNativeValue = (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: unknown
  ) => {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return false
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      return false
    }

    element.focus()
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    const desiredValue = String(value ?? '')
    const desiredText = desiredValue.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const matchingOption = element instanceof HTMLSelectElement
      ? Array.from(element.options).find((option) => {
          const label = (option.textContent?.trim() || option.label || option.value)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
          const normalizedOptionValue = option.value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
          return option.value === desiredValue || label === desiredText || normalizedOptionValue === desiredText
        })
      : undefined

    if (element instanceof HTMLSelectElement) {
      if (!matchingOption) return false
      element.selectedIndex = Array.from(element.options).indexOf(matchingOption)
    }
    valueSetter?.call(element, matchingOption?.value ?? desiredValue)

    const inputEvent = element instanceof HTMLSelectElement
      ? new Event('input', { bubbles: true, composed: true })
      : new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: String(matchingOption?.value ?? desiredValue)
        })
    element.dispatchEvent(inputEvent)
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }))
    return true
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
    if (!isEditableContentControl(element)) return false

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

  const normalizeOptionText = (value: string) => value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

  const scoreOption = (label: string, desiredValue: string) => {
    const option = normalizeOptionText(label)
    const desired = normalizeOptionText(desiredValue)
    if (!option || !desired) return 0
    if (option === desired) return 100
    if (desired.includes(option) || option.includes(desired)) return 80

    const desiredWords = new Set(desired.split(' ').filter((word) => word.length > 2))
    return option
      .split(' ')
      .filter((word) => word.length > 2)
      .reduce((score, word) => score + (desiredWords.has(word) ? 12 : 0), 0)
  }

  const strictBooleanValue = (value: unknown) => {
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

  const ariaCheckboxState = (element: HTMLElement) => {
    if (!isAriaCheckboxControl(element)) return null
    if (element.getAttribute('aria-checked') === 'true') return true
    if (element.getAttribute('aria-checked') === 'false') return false
    return null
  }

  const checkboxContext = (element: HTMLElement) => {
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ')
    return compactControlText([
      element.getAttribute('aria-label'), labelledBy, element.closest('label')?.textContent,
      element.closest('fieldset')?.querySelector('legend')?.textContent,
      element.closest<HTMLElement>('[role="group"], .field, .form-group, .control-group')?.innerText
    ].filter(Boolean).join(' ')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  }

  const isUnsafeOptionalCheckboxControl = (element: HTMLElement) => {
    const required = (element instanceof HTMLInputElement && element.required) ||
      element.getAttribute('aria-required') === 'true' || element.closest('[aria-required="true"]') !== null
    if (required) return false
    return /\b(newsletter|subscribe|marketing|advertis|promotion|promoted|featured|premium|sponsored|upgrade|paid|payment|billing|credit card|donation|tip jar|contact me|send me|email me|commercial interests?)\b/.test(checkboxContext(element))
  }

  const dispatchControlEvents = (element: HTMLInputElement) => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  const radioGroupFor = (element: HTMLInputElement) => {
    if (!element.name) return [element]
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((candidate) => candidate.name === element.name && candidate.form === element.form && !candidate.disabled)
  }

  const radioOptionLabel = (element: HTMLInputElement) => {
    if (element.id) {
      const associated = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)
      const text = compactControlText(associated?.innerText || associated?.textContent || '')
      if (text) return text
    }

    const parentLabel = element.closest('label')
    const parentText = compactControlText(parentLabel?.innerText || parentLabel?.textContent || '')
    if (parentText) return parentText

    const ariaLabel = compactControlText(element.getAttribute('aria-label') || '')
    if (ariaLabel) return ariaLabel

    const nextText = compactControlText(element.nextElementSibling?.textContent || '')
    if (nextText) return nextText

    return element.value
  }

  const optionMatchesDesired = (label: string, optionValue: string, desiredValue: unknown) => {
    const desired = String(desiredValue ?? '').trim()
    const normalizedDesired = normalizeOptionText(desired)
    if (!desired || !normalizedDesired) return false
    const desiredBoolean = strictBooleanValue(desiredValue)
    const optionBoolean = strictBooleanValue(optionValue) ?? strictBooleanValue(label)
    return optionValue === desired ||
      normalizeOptionText(optionValue) === normalizedDesired ||
      normalizeOptionText(label) === normalizedDesired ||
      (desiredBoolean !== null && optionBoolean === desiredBoolean)
  }

  const findRadioOption = (element: HTMLInputElement, desiredValue: unknown) => {
    const desired = String(desiredValue ?? '')
    const ranked = radioGroupFor(element)
      .map((candidate) => {
        const label = radioOptionLabel(candidate)
        const exact = optionMatchesDesired(label, candidate.value, desiredValue)
        return {
          element: candidate,
          label,
          score: exact ? 200 : scoreOption(`${label} ${candidate.value}`, desired)
        }
      })
      .sort((left, right) => right.score - left.score)
    const best = ranked[0]
    const second = ranked[1]
    if (!best || best.score < 80 || (second && best.score < 200 && best.score === second.score)) return null
    return best
  }

  const setRadioValue = (element: HTMLInputElement, value: unknown) => {
    const option = findRadioOption(element, value)
    if (!option) return null

    if (!option.element.checked) option.element.click()
    if (!option.element.checked) {
      const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
      checkedSetter?.call(option.element, true)
      dispatchControlEvents(option.element)
    }
    return option
  }

  const setCheckboxValue = (element: HTMLInputElement, value: unknown) => {
    const desired = strictBooleanValue(value)
    if (desired === null || (desired && isUnsafeOptionalCheckboxControl(element))) return null

    if (element.checked !== desired) element.click()
    if (element.checked !== desired) {
      const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
      checkedSetter?.call(element, desired)
      dispatchControlEvents(element)
    }
    return desired
  }

  const setAriaCheckboxValue = async (element: HTMLElement, value: unknown) => {
    const desired = strictBooleanValue(value)
    if (desired === null || (desired && isUnsafeOptionalCheckboxControl(element))) return null
    const current = ariaCheckboxState(element)
    if (current === null) return null
    if (current !== desired) {
      element.click()
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    }
    return ariaCheckboxState(element) === desired ? desired : null
  }

  const setCustomSelectValue = async (element: HTMLElement, value: unknown) => {
    const desiredValue = String(value ?? '')
    element.click()
    await new Promise((resolve) => window.setTimeout(resolve, 180))

    const controlledIds = [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')]
      .flatMap((item) => String(item || '').split(/\s+/)).filter(Boolean)
    const controlledRoots = controlledIds.map((id) => document.getElementById(id))
      .filter((root): root is HTMLElement => root instanceof HTMLElement)
    const visibleListboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(isVisibleControl)
    const optionRoots = controlledRoots.length > 0 ? controlledRoots : visibleListboxes.length === 1 ? visibleListboxes : []
    const rankedOptions = optionRoots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(
      '[role="option"], [data-combobox-option], [data-option]'
    )))
      .filter((option) => {
        const rect = option.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((option) => ({
        element: option,
        label: compactControlText(option.innerText || option.textContent || ''),
        value: option.getAttribute('data-value') || compactControlText(option.innerText || option.textContent || ''),
        score: optionMatchesDesired(
          compactControlText(option.innerText || option.textContent || ''),
          option.getAttribute('data-value') || '',
          desiredValue
        ) ? 200 : scoreOption(option.innerText || option.textContent || '', desiredValue)
      }))
      .sort((left, right) => right.score - left.score)

    const bestOption = rankedOptions[0]

    if (!bestOption || bestOption.score < 80 ||
      (bestOption.score < 200 && bestOption.score - (rankedOptions[1]?.score || 0) < 8)) return null
    bestOption.element.click()
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    acceptedCustomSelectValues.set(element, bestOption.label)
    return bestOption
  }

  const findElementForKey = (key: string) => {
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
      if (syntheticFieldMatch) element = getFillableElements()[Number(syntheticFieldMatch[1])] || null
    }
    return element
  }

  const richTextPlainValue = (element: HTMLTextAreaElement) => {
    if (!element.id) return element.value
    const frame = document.getElementById(`${element.id}_ifr`)
    const editorBody = frame instanceof HTMLIFrameElement ? frame.contentDocument?.body : null
    return editorBody?.innerText || editorBody?.textContent || element.value
  }

  const customSelectWasApplied = (
    element: HTMLElement,
    desiredValue: unknown,
    selectedOption: { element: HTMLElement; label: string; value: string }
  ) => {
    if (!optionMatchesDesired(selectedOption.label, selectedOption.value, desiredValue)) return false

    const selectedState = selectedOption.element.getAttribute('aria-selected') === 'true' ||
      selectedOption.element.getAttribute('data-state') === 'checked' ||
      selectedOption.element.getAttribute('data-selected') === 'true'
    const controlValue = acceptedCustomSelectValues.get(element) || (element instanceof HTMLInputElement
      ? element.value
      : compactControlText(element.innerText || element.textContent || ''))
    const controlMatches = optionMatchesDesired(selectedOption.label, selectedOption.value, controlValue)
    return selectedState || controlMatches
  }

  const valueWasApplied = (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
    intendedValue: unknown,
    selectedCustomOption: { element: HTMLElement; label: string; value: string } | null
  ) => {
    if (element.getAttribute('aria-invalid') === 'true') return false
    if (
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) &&
      !element.checkValidity()
    ) {
      return false
    }

    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const selected = radioGroupFor(element).find((candidate) => candidate.checked)
      return Boolean(selected && optionMatchesDesired(radioOptionLabel(selected), selected.value, intendedValue))
    }

    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      const desired = strictBooleanValue(intendedValue)
      return desired !== null && element.checked === desired
    }

    if (isAriaCheckboxControl(element)) {
      const desired = strictBooleanValue(intendedValue)
      return desired !== null && ariaCheckboxState(element) === desired
    }

    if (isVirtualPlanControl(element)) {
      const group = getVirtualPlanGroup(element)
      const option = group ? safePlanOption(group, intendedValue) : null
      return Boolean(option && normalizePlanText(currentVirtualPlanChoice(element)) === normalizePlanText(option.label))
    }

    if (isCustomSelectControl(element)) {
      return selectedCustomOption !== null && customSelectWasApplied(element, intendedValue, selectedCustomOption)
    }

    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions[0]
      if (!selected) return false
      const label = selected.textContent?.trim() || selected.label || selected.value
      return optionMatchesDesired(label, selected.value, intendedValue)
    }

    const expected = compactControlText(String(intendedValue ?? ''))
    if (element instanceof HTMLTextAreaElement) {
      return compactControlText(richTextPlainValue(element)) === expected
    }
    if (isEditableContentControl(element)) {
      return compactControlText(element.textContent || '') === expected
    }
    if (element instanceof HTMLInputElement) {
      return compactControlText(element.value) === expected
    }
    return false
  }

  let filledCount = 0
  const failedKeys: string[] = []

  const fillEntries = async () => {
    for (const [key, value] of Object.entries(data)) {
      const element = findElementForKey(key)
      if (element) {
        if (element instanceof HTMLInputElement && element.type === 'file') {
          failedKeys.push(key)
          continue
        }
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
          failedKeys.push(key)
          continue
        }

        let writeSucceeded = false
        let selectedCustomOption: { element: HTMLElement; label: string; value: string } | null = null

        if (element instanceof HTMLInputElement && element.type === 'radio') {
          writeSucceeded = Boolean(setRadioValue(element, value))
        } else if (element instanceof HTMLInputElement && element.type === 'checkbox') {
          writeSucceeded = setCheckboxValue(element, value) !== null
        } else if (isAriaCheckboxControl(element)) {
          writeSucceeded = await setAriaCheckboxValue(element, value) !== null
        } else if (isVirtualPlanControl(element)) {
          writeSucceeded = await setVirtualPlanValue(element, value) !== null
        } else if (isCustomSelectControl(element)) {
          selectedCustomOption = await setCustomSelectValue(element, value)
          writeSucceeded = Boolean(selectedCustomOption)
        } else {
          const richTextFilled = element instanceof HTMLTextAreaElement && setRichTextValue(element, value)
          const contentEditableFilled = isEditableContentControl(element) && setContentEditableValue(element, value)
          if (richTextFilled || contentEditableFilled) {
            writeSucceeded = true
          } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            writeSucceeded = setNativeValue(element, value)
          }
        }

        if (!writeSucceeded) {
          failedKeys.push(key)
          continue
        }

        await new Promise((resolve) => window.setTimeout(resolve, 260))
        const liveElement = findElementForKey(key)
        if (liveElement && valueWasApplied(liveElement, value, selectedCustomOption)) {
          filledCount++
        } else {
          failedKeys.push(key)
        }
      } else {
        failedKeys.push(key)
      }
    }
  }

  return fillEntries().then(() => ({
    success: filledCount > 0,
    filledCount,
    attemptedCount: Object.keys(data).length,
    failedKeys
  }))
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

function fieldIsStillEmpty(field: ExtractedFormField) {
  const value = String(field.value || '').trim()
  if (field.type === 'checkbox' || field.type === 'radio') {
    return !value || /^(false|off|0)$/i.test(value)
  }
  if (field.type === 'select' || field.type === 'select-one') {
    const normalized = value.toLowerCase()
    return !value || /^(select|choose|please select|none|--)$/.test(normalized)
  }
  return !value
}

function requiredEmptyFieldKeys(fields: ExtractedFormField[]) {
  return fields
    .filter((field) => field.invalid || (field.required && fieldIsStillEmpty(field)))
    .map((field) => field.id)
}

function invalidFieldKeys(fields: ExtractedFormField[]) {
  return fields.filter((field) => field.invalid).map((field) => field.id)
}

function emptyEligibleFieldKeys(fields: ExtractedFormField[]) {
  return fields.filter(fieldIsStillEmpty).map((field) => field.id)
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
  const newlyAvailableFields = followUpFields.filter(fieldIsStillEmpty)

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

  const finalFields = await extractFormFieldsFromTab(tab.id)
  const remainingRequiredKeys = finalFields
    .filter((field) => field.required && fieldIsStillEmpty(field))
    .map((field) => field.id)
  const remainingInvalidKeys = invalidFieldKeys(finalFields)
  const emptyEligibleKeys = emptyEligibleFieldKeys(finalFields)
  const combinedFailedKeys = Array.from(new Set([
    ...(fillResult.failedKeys || []),
    ...(followUpResult?.failedKeys || []),
    ...requiredEmptyFieldKeys(finalFields)
  ]))

  return {
    ...fillResult,
    filledCount: fillResult.filledCount + (followUpResult?.filledCount || 0),
    attemptedCount: (fillResult.attemptedCount || 0) + (followUpResult?.attemptedCount || 0),
    failedKeys: combinedFailedKeys,
    targetUrl: tab.url,
    formFields: followUpFields.length > formFields.length ? followUpFields : formFields,
    formDiagnosis,
    forcedFallbackCount: fillResponse.forcedFallbackCount || 0,
    remainingRequiredKeys,
    remainingInvalidKeys,
    emptyEligibleKeys
  }
}

export async function fillTabWithProductProfile(
  tab: { id: number; title?: string; url?: string },
  productProfile: ProductProfile
): Promise<FillTabResult> {
  return runProductProfileFormFill(tab, productProfile)
}
