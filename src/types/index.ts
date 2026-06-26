export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  category?: string
}

export interface Agent {
  id: string
  name: string
  description: string
  icon: string
  badge?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  thinking?: string // AI thinking process
  metadata?: {
    url?: string // Reference URL for form filling
    type?: 'form-fill' | 'normal' // Message type
    [key: string]: any
  }
  isStreaming?: boolean // Whether message is being streamed
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}