import ky from 'ky'
import { API_CONFIG } from '@/config/constants'
import type { Message } from '@/types'

export interface ChatCompletionRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
  }>
  model?: string
  temperature?: number
  stream?: boolean
}

export interface ChatCompletionResponse {
  id: string
  choices: Array<{
    message: {
      role: 'assistant'
      content: string
    }
    finish_reason: string
  }>
  created: number
  model: string
}

// Gemini API types
interface GeminiRequest {
  contents: Array<{
    role: 'user' | 'model'
    parts: Array<{ text: string }>
  }>
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    thinkingConfig?: {
      includeThoughts?: boolean
      thinkingLevel?: string
    }
  }
  tools?: Array<{
    google_search?: Record<string, never>
  }>
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      role: string
      parts: Array<{
        text: string
        thought?: boolean
      }>
    }
    finishReason: string
  }>
}

interface SendMessageOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  enableWebSearch?: boolean
}

class ChatAPI {
  private apiKey: string = ''
  private baseURL: string = API_CONFIG.DEFAULT_BASE_URL
  private defaultModel: string = API_CONFIG.DEFAULT_MODEL
  private defaultTemperature: number = API_CONFIG.DEFAULT_TEMPERATURE
  private client: typeof ky

  constructor() {
    this.client = ky.create({
      prefixUrl: this.baseURL,
      timeout: API_CONFIG.TIMEOUT,
      retry: {
        limit: API_CONFIG.RETRY_LIMIT,
        methods: ['post']
      }
    })
  }

  setApiKey(key: string) {
    this.apiKey = key
    this.updateClient()
  }

  setBaseURL(url: string) {
    this.baseURL = url
    this.updateClient()
  }

  setDefaultModel(model: string) {
    this.defaultModel = model
  }

  setDefaultTemperature(temperature: number) {
    this.defaultTemperature = temperature
  }

  private updateClient() {
    this.client = ky.create({
      prefixUrl: this.baseURL,
      timeout: API_CONFIG.TIMEOUT,
      retry: {
        limit: API_CONFIG.RETRY_LIMIT,
        methods: ['post']
      },
      headers: this.apiKey
        ? {
            Authorization: this.apiKey.startsWith('Bearer ') ? this.apiKey : `Bearer ${this.apiKey}`
          }
        : {}
    })
  }

  private isGeminiModel(model: string): boolean {
    return model.toLowerCase().includes('gemini')
  }

  async sendMessage(messages: Message[], options: SendMessageOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API key not configured')
    }

    const {
      model = this.defaultModel,
      temperature = this.defaultTemperature,
      maxTokens,
      enableWebSearch = false
    } = options

    // Check if using Gemini model
    if (this.isGeminiModel(model)) {
      return this.sendGeminiMessage(messages, model, temperature, maxTokens, enableWebSearch)
    } else {
      return this.sendOpenAIMessage(messages, model, temperature)
    }
  }

  private async sendOpenAIMessage(
    messages: Message[],
    model: string,
    temperature: number
  ): Promise<string> {
    const data = await this.client
      .post('chat/completions', {
        json: {
          model,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content
          })),
          temperature
        } as ChatCompletionRequest
      })
      .json<ChatCompletionResponse>()

    return data.choices[0]?.message?.content || 'No response'
  }

  private async sendGeminiMessage(
    messages: Message[],
    model: string,
    temperature: number,
    maxTokens?: number,
    enableWebSearch?: boolean
  ): Promise<string> {
    // Convert OpenAI format to Gemini format
    const contents: GeminiRequest['contents'] = []

    for (const msg of messages) {
      // Skip system messages or merge them into user messages
      if (msg.role === 'system') {
        // Prepend system message to the first user message
        const nextUserMsg = messages.find(m => m.role === 'user')
        if (nextUserMsg && contents.length === 0) {
          contents.push({
            role: 'user',
            parts: [{ text: `${msg.content}\n\n${nextUserMsg.content}` }]
          })
          // Skip the next user message since we merged it
          continue
        }
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })
      }
    }

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature,
        ...(maxTokens && { maxOutputTokens: maxTokens }),
        ...(enableWebSearch && {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: 'HIGH'
          }
        })
      }
    }

    // Add Google Search tool if web search is enabled
    if (enableWebSearch) {
      requestBody.tools = [
        {
          google_search: {}
        }
      ]
    }

    // Use Gemini API endpoint format
    const endpoint = `v1beta/models/${model}:generateContent`

    const data = await this.client
      .post(endpoint, {
        json: requestBody
      })
      .json<GeminiResponse>()

    // Filter out thought parts and combine actual response parts
    const allParts = data.candidates[0]?.content?.parts || []
    const responseParts = allParts.filter(part => !part.thought)
    const combinedText = responseParts.map(part => part.text).join('\n\n')

    return combinedText || 'No response'
  }
}

export const chatAPI = new ChatAPI()
