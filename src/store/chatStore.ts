import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { chatAPI } from '@/services/api'
import i18n from '@/i18n'
import type { Message, ChatSession } from '@/types'

interface CreateSessionOptions {
  title: string
  initialMessage: string
  includeWelcomeMessage: boolean
}

interface SendMessageOptions {
  model: string
  temperature: number
  maxTokens: number
}

interface SendMessageParams {
  content: string
  apiOptions: SendMessageOptions
  sessionOptions?: CreateSessionOptions
}

interface ChatState {
  // Current session
  currentSessionId: string | null
  sessions: ChatSession[]

  // UI state
  isLoading: boolean

  // Actions
  sendMessage: (params: SendMessageParams) => Promise<void>
  addMessage: (sessionId: string, message: Message) => void
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
  createSession: (options: CreateSessionOptions) => string
  setCurrentSession: (sessionId: string) => void
  getCurrentMessages: () => Message[]
  deleteSession: (sessionId: string) => void
  updateSessionTitle: (sessionId: string, title: string) => void
}

const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    currentSessionId: null,
    sessions: [],
    isLoading: false,

    createSession: (options) => {
      const {
        title,
        initialMessage,
        includeWelcomeMessage
      } = options

      const sessionId = generateSessionId()
      const now = new Date()

      const messages: Message[] = includeWelcomeMessage
        ? [
          {
            id: generateMessageId(),
            role: 'assistant',
            content: initialMessage,
            timestamp: now
          }
        ]
        : []

      const newSession: ChatSession = {
        id: sessionId,
        title,
        messages,
        createdAt: now,
        updatedAt: now
      }

      set((state) => {
        state.sessions.push(newSession)
        state.currentSessionId = sessionId
      })

      return sessionId
    },

    setCurrentSession: (sessionId) => {
      set((state) => {
        state.currentSessionId = sessionId
      })
    },

    deleteSession: (sessionId) => {
      set((state) => {
        state.sessions = state.sessions.filter((s) => s.id !== sessionId)
        if (state.currentSessionId === sessionId) {
          state.currentSessionId = state.sessions[0]?.id || null
        }
      })
    },

    updateSessionTitle: (sessionId, title) => {
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId)
        if (session) {
          session.title = title
          session.updatedAt = new Date()
        }
      })
    },

    addMessage: (sessionId, message) => {
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId)
        if (session) {
          session.messages.push(message)
          session.updatedAt = new Date()
        }
      })
    },

    updateMessage: (sessionId, messageId, updates) => {
      set((state) => {
        const session = state.sessions.find((s) => s.id === sessionId)
        if (session) {
          const message = session.messages.find((m) => m.id === messageId)
          if (message) {
            Object.assign(message, updates)
            session.updatedAt = new Date()
          }
        }
      })
    },

    getCurrentMessages: () => {
      const state = get()
      const session = state.sessions.find((s) => s.id === state.currentSessionId)
      return session?.messages || []
    },

    sendMessage: async (params) => {
      const { content, apiOptions, sessionOptions } = params
      const state = get()

      // Create session if none exists
      let targetSessionId = state.currentSessionId
      if (!targetSessionId) {
        if (!sessionOptions) {
          throw new Error('sessionOptions is required when no current session exists')
        }
        targetSessionId = get().createSession(sessionOptions)
      }

      // Add user message
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content,
        timestamp: new Date()
      }
      get().addMessage(targetSessionId, userMessage)

      // Set loading state
      set((state) => {
        state.isLoading = true
      })

      try {
        // Get all messages for context
        const messages = get().getCurrentMessages()

        // Call API with explicit options
        const responseContent = await chatAPI.sendMessage(messages, apiOptions)

        const aiMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: responseContent,
          timestamp: new Date()
        }
        get().addMessage(targetSessionId, aiMessage)
      } catch (error) {
        console.error('Failed to send message:', error)
        const errorMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: i18n.t('chat.errorMessage'),
          timestamp: new Date()
        }
        get().addMessage(targetSessionId, errorMessage)
      } finally {
        set((state) => {
          state.isLoading = false
        })
      }
    }
  }))
)
