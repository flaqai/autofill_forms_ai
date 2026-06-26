import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageList } from '@/components/chat/MessageList'
import { ChatInput } from '@/components/chat/ChatInput'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { FormFillDialog } from '@/components/chat/FormFillDialog'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

export const ChatPage = () => {
  const { t } = useTranslation()
  const { sendMessage, getCurrentMessages, addMessage, updateMessage, currentSessionId, createSession, isLoading } = useChatStore()
  const { model, temperature } = useSettingsStore()
  const messages = getCurrentMessages()
  const [showFormFillDialog, setShowFormFillDialog] = useState(false)

  const handleSend = async (content: string) => {
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

  const handleFormFillConfirm = async (url: string) => {
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
      content: '填充表单',
      timestamp: new Date(),
      metadata: {
        url,
        type: 'form-fill' as const
      }
    }
    addMessage(sessionId, userMessage)

    // Add initial AI message with streaming state
    const aiMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const initialAiMessage = {
      id: aiMessageId,
      role: 'assistant' as const,
      content: `正在访问 ${url}...`,
      timestamp: new Date(),
      thinking: '正在访问网页...',
      isStreaming: true
    }
    addMessage(sessionId, initialAiMessage)

    try {
      // Step 1: Get summary from URL
      console.log('[FormFill] Getting summary from URL:', url)

      const summaryResponse = await chrome.runtime.sendMessage({
        action: 'getSummaryFromUrl',
        url
      })

      if (!summaryResponse.success) {
        throw new Error(summaryResponse.error || '获取网页内容失败')
      }

      console.log('[FormFill] Summary received')

      // Update message with summary
      updateMessage(sessionId, aiMessageId, {
        content: `已成功访问网页并提取内容\n\n正在分析当前页面的表单字段...`,
        thinking: '正在访问网页... ✓\n分析页面结构...\n提取关键信息...',
        isStreaming: true
      })

      // Step 2: Get current tab and extract form fields
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) {
        throw new Error('无法获取当前标签页')
      }

      // Extract form fields from current page
      let formFields: any[] = []
      try {
        const formFieldsResponse = await chrome.tabs.sendMessage(tab.id, {
          action: 'extractFormFields'
        })
        formFields = formFieldsResponse || []
      } catch (e) {
        console.warn('[FormFill] Failed to extract form fields:', e)
        formFields = []
      }

      if (formFields.length === 0) {
        throw new Error('当前页面没有找到表单字段')
      }

      console.log('[FormFill] Form fields extracted:', formFields.length)

      // Update message
      updateMessage(sessionId, aiMessageId, {
        content: `已找到 ${formFields.length} 个表单字段\n\n正在生成填充数据...`,
        thinking: '正在访问网页... ✓\n分析页面结构... ✓\n提取关键信息...\n匹配表单字段...',
        isStreaming: true
      })

      // Step 3: Call urlBasedFill to generate fill data
      const fillResponse = await chrome.runtime.sendMessage({
        action: 'urlBasedFill',
        data: {
          sourceUrl: url,
          sourceSummary: summaryResponse.summary,
          formFields: formFields,
          pageContext: {
            title: tab.title,
            url: tab.url
          }
        }
      })

      if (!fillResponse.success) {
        throw new Error(fillResponse.error || '生成填充数据失败')
      }

      console.log('[FormFill] Fill data generated')

      // Update message
      updateMessage(sessionId, aiMessageId, {
        content: `正在填充表单...`,
        thinking: '正在访问网页... ✓\n分析页面结构... ✓\n提取关键信息... ✓\n匹配表单字段... ✓\n生成填充数据... ✓\n填充表单...',
        isStreaming: true
      })

      // Step 4: Fill the form
      const fillResult = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        data: fillResponse.filledData
      })

      // Final success message
      const actualFilledCount = fillResult?.filledCount || formFields.length
      updateMessage(sessionId, aiMessageId, {
        content: `✅ 表单填充完成!\n\n已使用 ${url} 的内容成功填充 ${actualFilledCount} 个表单字段。`,
        thinking: '正在访问网页... ✓\n分析页面结构... ✓\n提取关键信息... ✓\n匹配表单字段... ✓\n生成填充数据... ✓\n填充表单... ✓',
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

  // If there are messages, show chat interface
  if (messages.length > 0) {
    return (
      <div className="flex flex-col h-full bg-slate-50">
        <MessageList messages={messages} />
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    )
  }

  // Otherwise show welcome view
  return (
    <>
      <div className="flex flex-col h-full bg-slate-50">
        <WelcomeView onFormFillClick={() => setShowFormFillDialog(true)} />
        <ChatInput onSend={handleSend} disabled={isLoading} />
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
