import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageList } from '@/components/chat/MessageList'
import { ChatInput } from '@/components/chat/ChatInput'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { FormFillDialog } from '@/components/chat/FormFillDialog'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

type ExtractedFormField = {
  id: string
  name: string
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
}

const extractFormFieldsDirectly = () => {
  const getFillableElements = () => {
    const elements = Array.from(document.querySelectorAll('input, textarea, select')) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >

    return elements.filter((el) => {
      if (el.disabled) return false

      if (
        el.type === 'hidden' ||
        el.type === 'submit' ||
        el.type === 'button' ||
        el.type === 'image'
      ) {
        return false
      }

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

    return ''
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

    const pieces = [
      getFieldLabel(element),
      (element as HTMLInputElement).placeholder || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      describedByText,
      element.previousElementSibling?.textContent || '',
      element.nextElementSibling?.textContent || ''
    ]

    let parent = element.parentElement
    let depth = 0
    while (parent && depth < 3) {
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
    name: el.name || el.id || `field_${index}`,
    type: el.type || 'text',
    tagName: el.tagName.toLowerCase(),
    placeholder: (el as HTMLInputElement).placeholder || '',
    label: getFieldLabel(el),
    context: getFieldContext(el),
    maxLength: inferFieldMaxLength(el),
    value: el.value || '',
    required: (el as HTMLInputElement).required || false,
    elementIndex: index,
    accept: el instanceof HTMLInputElement && el.type === 'file' ? el.accept : undefined,
    multiple: el instanceof HTMLInputElement && el.type === 'file' ? el.multiple : undefined
  }))
}

const fillFormDirectly = (data: Record<string, unknown>) => {
  const getFillableElements = () => {
    const elements = Array.from(document.querySelectorAll('input, textarea, select')) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >

    return elements.filter((el) => {
      if (el.disabled) return false

      if (
        el.type === 'hidden' ||
        el.type === 'submit' ||
        el.type === 'button' ||
        el.type === 'image'
      ) {
        return false
      }

      return true
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
      valueSetter?.call(element, String(value ?? ''))
    }

    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  const fillableElements = getFillableElements()
  let filledCount = 0
  const failedKeys: string[] = []

  Object.entries(data).forEach(([key, value]) => {
    let element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null

    if (!element) {
      element = document.querySelector(`[name="${CSS.escape(key)}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
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

      setNativeValue(element, value)
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

async function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function pingFormContentScript(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'chat4oPing' })
    return Boolean(response?.success)
  } catch {
    return false
  }
}

async function ensureFormContentScript(tabId: number) {
  if (await pingFormContentScript(tabId)) {
    return true
  }

  const scriptPath = getFormHandlerScriptPath()
  if (!scriptPath) {
    return false
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptPath]
    })
    await wait(120)
    return pingFormContentScript(tabId)
  } catch (error) {
    console.warn('[FormFill] Failed to inject form content script:', error)
    return false
  }
}

async function extractFormFieldsFromTab(tabId: number): Promise<ExtractedFormField[]> {
  const hasContentScript = await ensureFormContentScript(tabId)

  try {
    if (hasContentScript) {
      const formFieldsResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'extractFormFields'
      })
      if (Array.isArray(formFieldsResponse) && formFieldsResponse.length > 0) {
        return formFieldsResponse
      }
    }
  } catch (e) {
    console.warn('[FormFill] Content script extraction failed, using direct scan:', e)
  }

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractFormFieldsDirectly
  })

  return (injectionResult.result || []) as ExtractedFormField[]
}

async function fillFormInTab(
  tabId: number,
  data: Record<string, unknown>,
  mappings: unknown[] = [],
  fallbackData: Record<string, unknown> = {}
) {
  const hasContentScript = await ensureFormContentScript(tabId)

  try {
    if (hasContentScript) {
      const fillResult = await chrome.tabs.sendMessage(tabId, {
        action: 'fillForm',
        data,
        mappings,
        fallbackData
      })
      if (fillResult?.success || fillResult?.filledCount > 0) {
        return fillResult
      }
    }
  } catch (e) {
    console.warn('[FormFill] Content script fill failed, using direct fill:', e)
  }

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillFormDirectly,
    args: [data]
  })

  return injectionResult.result
}

async function getTargetTab() {
  const response = await chrome.runtime.sendMessage({ action: 'getTargetTab' })
  if (!response?.success || !response.tab?.id) {
    throw new Error(response?.error || '无法获取目标网页标签页')
  }

  return response.tab as { id: number; title?: string; url?: string }
}

export const ChatPage = () => {
  const { t } = useTranslation()
  const { sendMessage, getCurrentMessages, addMessage, updateMessage, currentSessionId, createSession, isLoading } = useChatStore()
  const { model, temperature, productProfile } = useSettingsStore()
  const messages = getCurrentMessages()
  const [showFormFillDialog, setShowFormFillDialog] = useState(false)
  const autoFillRequestedRef = useRef(new URLSearchParams(window.location.search).get('autoFill') === '1')
  const autoFillStartedRef = useRef(false)

  const handleSend = async (content: string) => {
    if (content.trim() === '使用推广资料填充表单') {
      await handleFormFillConfirm()
      return
    }

    await sendMessage({
      content,
      apiOptions: {
        model,
        temperature,
        maxTokens: 2000
      },
      sessionOptions: {
        title: t('chat.newChat'),
        initialMessage: '',
        includeWelcomeMessage: false
      }
    })
  }

  const handleFormFillConfirm = async () => {
    // Create session if needed
    let sessionId = currentSessionId
    if (!sessionId) {
      sessionId = createSession({
        title: t('chat.newChat'),
        initialMessage: '',
        includeWelcomeMessage: false
      })
    }

    // Add user message with form-fill type
    const userMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      role: 'user' as const,
      content: '使用推广资料填充表单',
      timestamp: new Date(),
      metadata: {
        type: 'form-fill' as const
      }
    }
    addMessage(sessionId, userMessage)

    // Add initial AI message with streaming state
    const aiMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const initialAiMessage = {
      id: aiMessageId,
      role: 'assistant' as const,
      content: '正在分析当前页面的表单...',
      timestamp: new Date(),
      thinking: '分析页面结构...',
      isStreaming: true
    }
    addMessage(sessionId, initialAiMessage)

    try {
      if (!productProfile?.productName || !productProfile?.websiteUrl) {
        throw new Error('请先在设置页填写推广资料，至少需要产品名称和官网 URL。')
      }

      // Step 1: Get target web tab and extract form fields
      const tab = await getTargetTab()

      // Extract form fields from current page
      const formFields = await extractFormFieldsFromTab(tab.id)

      if (formFields.length === 0) {
        throw new Error('当前页面没有找到表单字段')
      }

      console.log('[FormFill] Form fields extracted:', formFields.length)

      // Update message
      updateMessage(sessionId, aiMessageId, {
        content: `已找到 ${formFields.length} 个表单字段\n\n正在匹配推广资料...`,
        thinking: '分析页面结构... ✓\n匹配推广资料...',
        isStreaming: true
      })

      // Step 2: Call AI to map the saved product profile to form fields
      const fillResponse = await chrome.runtime.sendMessage({
        action: 'urlBasedFill',
        data: {
          formFields: formFields,
          pageContext: {
            title: tab.title,
            url: tab.url
          },
          productProfile
        }
      })

      if (!fillResponse.success) {
        throw new Error(fillResponse.error || '生成填充数据失败')
      }

      console.log('[FormFill] Fill data generated')

      // Update message
      updateMessage(sessionId, aiMessageId, {
        content: `正在填充表单...`,
        thinking: '分析页面结构... ✓\n匹配推广资料... ✓\n生成填充数据... ✓\n填充表单...',
        isStreaming: true
      })

      // Step 3: Fill the form
      const fillResult = await fillFormInTab(
        tab.id,
        fillResponse.filledData,
        fillResponse.mappings,
        fillResponse.fallbackData
      )

      if (!fillResult?.success || fillResult.filledCount === 0) {
        throw new Error('没有成功填入任何字段。当前页面可能使用了自定义表单组件，或 AI 返回的字段名与页面字段不匹配。')
      }

      // Final success message
      const actualFilledCount = fillResult.filledCount
      const failedCount = fillResult.failedKeys?.length || 0
      const resultDetails = failedCount > 0
        ? `\n\n还有 ${failedCount} 个字段没有成功写入，已在网页字段旁显示 + 学习按钮。`
        : ''
      updateMessage(sessionId, aiMessageId, {
        content: `✅ 表单填充完成!\n\n目标页面：${tab.url}\n已使用推广资料成功填充 ${actualFilledCount} 个表单字段。${resultDetails}`,
        thinking: '分析页面结构... ✓\n匹配推广资料... ✓\n生成填充数据... ✓\n填充表单... ✓',
        isStreaming: false
      })

    } catch (error: any) {
      console.error('[FormFill] Error:', error)

      // Error message
      updateMessage(sessionId, aiMessageId, {
        content: `❌ 表单填充失败\n\n错误信息: ${error.message}`,
        thinking: '❌ 发生错误',
        isStreaming: false
      })
    }
  }

  useEffect(() => {
    const runAutoFill = () => {
      if (!autoFillRequestedRef.current || autoFillStartedRef.current) return
      if (!productProfile?.productName || !productProfile?.websiteUrl) return

      autoFillStartedRef.current = true
      handleFormFillConfirm()
    }

    runAutoFill()

    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return

    const handleRuntimeMessage = (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (message.action !== 'triggerAutoFill') return false

      autoFillRequestedRef.current = true
      autoFillStartedRef.current = false
      window.setTimeout(runAutoFill, 0)
      sendResponse({ success: true })
      return false
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage)
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
  }, [productProfile])

  const fillCurrentPageButton = (
    <button
      onClick={handleFormFillConfirm}
      disabled={isLoading}
      className="w-full px-3 py-2 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
    >
      使用推广资料填充当前页
    </button>
  )

  // If there are messages, show chat interface
  if (messages.length > 0) {
    return (
      <div className="flex flex-col h-full bg-slate-50">
        <MessageList messages={messages} />
        <ChatInput onSend={handleSend} disabled={isLoading} leadingAction={fillCurrentPageButton} />
      </div>
    )
  }

  // Otherwise show welcome view
  return (
    <>
      <div className="flex flex-col h-full bg-slate-50">
        <WelcomeView onFormFillClick={() => setShowFormFillDialog(true)} />
        <ChatInput onSend={handleSend} disabled={isLoading} leadingAction={fillCurrentPageButton} />
      </div>
      {showFormFillDialog && (
        <FormFillDialog
          onConfirm={handleFormFillConfirm}
          onClose={() => setShowFormFillDialog(false)}
        />
      )}
    </>
  )
}
