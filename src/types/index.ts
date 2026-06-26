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

export interface ProductProfile {
  productName: string
  websiteUrl: string
  shortDescription: string
  longDescription: string
  category: string
  logoUrl: string
  logoImageUrl: string
  screenshotImageUrl: string
  promoImageUrl: string
  bannerImageUrl: string
  companyName: string
  companyWebsite: string
  contactEmail: string
  companyEmail: string
  contactFirstName: string
  contactLastName: string
  privacyPolicyUrl: string
  termsUrl: string
  twitterUrl: string
  linkedinUrl: string
  githubUrl: string
  keywords: string
  tags: string
  extraInfo: string
  lockedFields: string
}
