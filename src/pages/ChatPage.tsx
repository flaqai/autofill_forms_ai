import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { MessageList } from '@/components/chat/MessageList'
import { ChatInput } from '@/components/chat/ChatInput'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { FormFillDialog } from '@/components/chat/FormFillDialog'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import {
  isBrowserErrorPageError,
  normalizeFormFillError,
  runProductProfileFormFill
} from '@/utils/formAutomation'

type ActiveFormFillRun = {
  requestId: string
  sessionId: string
  aiMessageId: string
}

type AutoFillNavigationState = {
  autoFillRequestId?: string
  autoFillTargetTabId?: number
}

function getHashAutoFillRequest(search: string): AutoFillNavigationState | null {
  const params = new URLSearchParams(search)
  if (params.get('autoFill') !== '1') return null

  const targetTabId = Number(params.get('targetTabId'))
  const requestId = params.get('autoFillRequestId')
  if (!Number.isInteger(targetTabId) || targetTabId <= 0 || !requestId) return null

  return {
    autoFillRequestId: requestId,
    autoFillTargetTabId: targetTabId
  }
}

function createFormFillRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `fill_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function getInitialAutoFillParams() {
  const searchParams = new URLSearchParams(window.location.search)
  const hashQuery = window.location.hash.split('?')[1]
  const hashParams = hashQuery ? new URLSearchParams(hashQuery) : null
  const hasNavigationRequest = Boolean(
    searchParams.get('autoFillRequestId') || hashParams?.get('autoFillRequestId')
  )

  return {
    requested: searchParams.get('autoFill') === '1' && !hasNavigationRequest,
    targetTabId: Number(searchParams.get('targetTabId')) || undefined
  }
}

async function getTargetTab() {
  const response = await chrome.runtime.sendMessage({ action: 'getTargetTab' })
  if (!response?.success || !response.tab?.id) {
    throw new Error(response?.error || '无法获取目标网页标签页')
  }

  return response.tab as { id: number; title?: string; url?: string }
}

async function getTargetTabById(tabId: number) {
  const response = await chrome.runtime.sendMessage({ action: 'getTargetTabById', tabId })
  if (!response?.success || !response.tab?.id) {
    throw new Error(response?.error || '无法获取当前网页标签页')
  }

  return response.tab as { id: number; title?: string; url?: string }
}

export const ChatPage = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { sendMessage, getCurrentMessages, addMessage, updateMessage, currentSessionId, createSession, isLoading, hasHydrated } = useChatStore()
  const { model, temperature, productProfile } = useSettingsStore()
  const messages = getCurrentMessages()
  const [showFormFillDialog, setShowFormFillDialog] = useState(false)
  const [activeFillCount, setActiveFillCount] = useState(0)
  const initialAutoFillParamsRef = useRef(getInitialAutoFillParams())
  const autoFillRequestedRef = useRef(initialAutoFillParamsRef.current.requested)
  const initialAutoFillTargetTabIdRef = useRef(initialAutoFillParamsRef.current.targetTabId)
  const autoFillStartedRef = useRef(false)
  const handledNavigationAutoFillRef = useRef<string | null>(null)
  const activeFillRunsRef = useRef(new Map<string, ActiveFormFillRun>())

  const isFormFillActive = (requestId: string) => activeFillRunsRef.current.has(requestId)

  const finishFormFill = (requestId: string) => {
    if (!activeFillRunsRef.current.delete(requestId)) return
    setActiveFillCount(activeFillRunsRef.current.size)
  }

  const stopActiveFormFills = () => {
    const activeRuns = Array.from(activeFillRunsRef.current.values())
    if (activeRuns.length === 0) return

    activeFillRunsRef.current.clear()
    setActiveFillCount(0)

    activeRuns.forEach((run) => {
      updateMessage(run.sessionId, run.aiMessageId, {
        content: '已停止本次填充。已经写入网页的内容会保留，未完成的步骤不会继续执行。',
        thinking: '已手动停止',
        isStreaming: false
      })
      chrome.runtime.sendMessage({ action: 'cancelUrlBasedFill', requestId: run.requestId }).catch(() => undefined)
    })
  }

  const handleSend = async (content: string) => {
    if (content.trim() === '使用推广资料填充表单') {
      await handleFormFillConfirm()
      return
    }

    if (content.trim() === '强制填充当前页面') {
      await handleFormFillConfirm(true)
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

  const handleFormFillConfirm = async (forceFill = false, targetTabId?: number) => {
    // Never run two autofill pipelines against the same page at once. Multiple
    // concurrent writers make controlled inputs appear to type and erase text.
    if (activeFillRunsRef.current.size > 0) return

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
      content: forceFill ? '强制填充当前页面' : '使用推广资料填充表单',
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
      content: forceFill ? '正在强制分析当前页面的表单...' : '正在分析当前页面的表单...',
      timestamp: new Date(),
      thinking: forceFill ? '强制模式：跳过页面类型拦截...' : '分析页面结构...',
      isStreaming: true
    }
    addMessage(sessionId, initialAiMessage)

    const requestId = createFormFillRequestId()
    activeFillRunsRef.current.set(requestId, { requestId, sessionId, aiMessageId })
    setActiveFillCount(activeFillRunsRef.current.size)

    let tab: { id: number; title?: string; url?: string } | null = null

    try {
      if (!productProfile?.productName || !productProfile?.websiteUrl) {
        throw new Error('请先在设置页填写推广资料，至少需要产品名称和官网 URL。')
      }

      // Step 1: Get target web tab and extract form fields
      tab = targetTabId === undefined
        ? await getTargetTab()
        : await getTargetTabById(targetTabId)
      if (!isFormFillActive(requestId)) return

      const fillResult = await runProductProfileFormFill(tab, productProfile, {
        requestId,
        forceFill,
        shouldContinue: () => isFormFillActive(requestId),
        onProgress: (progress) => {
          if (!isFormFillActive(requestId)) return

          if (progress.stage === 'fields') {
            const forceNotice = forceFill && !progress.diagnosis?.isListingForm
              ? '\n已按你的要求跳过页面类型检查。'
              : ''
            updateMessage(sessionId, aiMessageId, {
              content: `已找到 ${progress.fieldCount || 0} 个表单字段${forceNotice}\n\n正在匹配推广资料...`,
              thinking: `${forceFill ? '强制模式：页面类型检查已跳过' : '分析页面结构... ✓'}\n匹配推广资料...`,
              isStreaming: true
            })
          }

          if (progress.stage === 'filling') {
            updateMessage(sessionId, aiMessageId, {
              content: '正在填充表单...',
              thinking: `${forceFill ? '强制模式：页面类型检查已跳过' : '分析页面结构... ✓'}\n匹配推广资料... ✓\n生成填充数据... ✓\n填充表单...`,
              isStreaming: true
            })
          }
        }
      })

      if (!isFormFillActive(requestId)) return

      if (!fillResult?.success || fillResult.filledCount === 0) {
        throw new Error('没有成功填入任何字段。当前页面可能使用了自定义表单组件，或 AI 返回的字段名与页面字段不匹配。')
      }

      // Final success message
      const actualFilledCount = fillResult.filledCount
      const failedCount = fillResult.failedKeys?.length || 0
      const requiredCount = fillResult.remainingRequiredKeys?.length || 0
      const invalidCount = fillResult.remainingInvalidKeys?.length || 0
      const emptyEligibleCount = fillResult.emptyEligibleKeys?.length || 0
      const resultDetails = failedCount > 0 || requiredCount > 0 || invalidCount > 0
        ? `\n\n已填完可确认的字段，但仍需人工复核：${requiredCount} 个必填项为空，${invalidCount} 个字段未通过网页校验，${failedCount} 个写入尝试失败。网页字段旁已显示 + 学习按钮。`
        : emptyEligibleCount > 0
          ? `\n\n必填项已通过校验；另有 ${emptyEligibleCount} 个非必填/无安全资料字段保持未填，等待你复核。`
          : ''
      const forceFallbackDetails = forceFill && (fillResult.forcedFallbackCount || 0) > 0
        ? `\n已使用已保存资料补充匹配 ${fillResult.forcedFallbackCount} 个字段。`
        : ''
      updateMessage(sessionId, aiMessageId, {
        content: `✅ 表单已填充，等待复核（未提交）\n\n目标页面：${tab.url}\n${forceFill ? '本次使用强制填充模式。\n' : ''}已使用推广资料成功填充 ${actualFilledCount} 个表单字段。${forceFallbackDetails}${resultDetails}`,
        thinking: `${forceFill ? '强制模式：页面类型检查已跳过' : '分析页面结构... ✓'}\n匹配推广资料... ✓\n生成填充数据... ✓\n填充表单... ✓`,
        isStreaming: false
      })

    } catch (error: any) {
      if (!isFormFillActive(requestId)) return

      const normalizedError = normalizeFormFillError(error)
      console.error('[FormFill] Error:', normalizedError)
      if (tab?.id && isBrowserErrorPageError(error)) {
        chrome.runtime.sendMessage({ action: 'forgetTargetTab', tabId: tab.id }).catch(() => undefined)
      }

      // Error message
      updateMessage(sessionId, aiMessageId, {
        content: `❌ 表单填充失败\n\n错误信息: ${normalizedError.message}`,
        thinking: '❌ 发生错误',
        isStreaming: false
      })
    } finally {
      finishFormFill(requestId)
    }
  }

  const handleFormFillConfirmRef = useRef(handleFormFillConfirm)
  handleFormFillConfirmRef.current = handleFormFillConfirm

  useEffect(() => {
    if (!hasHydrated || !productProfile?.productName || !productProfile?.websiteUrl) return

    const navigationState = getHashAutoFillRequest(location.search)
      || location.state as AutoFillNavigationState | null
    const requestId = navigationState?.autoFillRequestId

    // A reused popup can contain both the legacy top-level autoFill query and
    // a newer hash navigation request. Prefer the request id and start exactly
    // one pipeline for the navigation.
    if (requestId) {
      if (handledNavigationAutoFillRef.current !== requestId) {
        handledNavigationAutoFillRef.current = requestId
        if (!autoFillStartedRef.current) {
          autoFillStartedRef.current = true
          void handleFormFillConfirmRef.current(false, navigationState.autoFillTargetTabId)
        }
        navigate('/chat', { replace: true, state: null })
      }
      return
    }

    if (autoFillRequestedRef.current && !autoFillStartedRef.current) {
      autoFillStartedRef.current = true
      void handleFormFillConfirmRef.current(false, initialAutoFillTargetTabIdRef.current)
    }
  }, [hasHydrated, location.key, location.search, location.state, navigate, productProfile])

  const fillCurrentPageButton = (
    <div className="flex gap-2">
      <button
        onClick={() => void handleFormFillConfirm()}
        disabled={isLoading}
        className="min-w-0 flex-1 px-3 py-2 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
      >
        使用推广资料填充当前页
      </button>
      <button
        onClick={() => void handleFormFillConfirm(true)}
        disabled={isLoading}
        title="跳过页面类型检查，只在你确认当前页面确实需要填写时使用"
        className="shrink-0 px-3 py-2 text-sm font-medium rounded-xl border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed transition-colors"
      >
        强制填充
      </button>
      {activeFillCount > 0 && (
        <button
          onClick={stopActiveFormFills}
          title="停止所有进行中的填充"
          className="shrink-0 px-3 py-2 text-sm font-medium rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
        >
          停止 ({activeFillCount})
        </button>
      )}
    </div>
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
