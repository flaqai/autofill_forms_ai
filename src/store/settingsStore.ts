import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chatAPI } from '@/services/api'
import { API_CONFIG, STORAGE_KEYS } from '@/config/constants'
import { createJSONStorage } from 'zustand/middleware'
import { chromeStorage } from './chromeStorage'
import type { ProductProfile } from '@/types'

export const DEFAULT_PRODUCT_PROFILE: ProductProfile = {
  productName: '',
  websiteUrl: '',
  shortDescription: '',
  longDescription: '',
  category: '',
  logoUrl: '',
  logoImageUrl: 'product-assets/minigpt-logo-square-500x500.jpg',
  screenshotImageUrl: 'product-assets/minigpt-website-screenshot.png',
  promoImageUrl: 'product-assets/minigpt-promo-image.jpg',
  bannerImageUrl: 'product-assets/minigpt-banner-image.png',
  companyName: '',
  companyWebsite: '',
  contactEmail: '',
  companyEmail: '',
  contactFirstName: '',
  contactLastName: '',
  privacyPolicyUrl: '',
  termsUrl: '',
  twitterUrl: '',
  linkedinUrl: '',
  githubUrl: '',
  keywords: '',
  tags: '',
  extraInfo: '',
  lockedFields: 'productName, websiteUrl, companyName, companyWebsite, contactEmail, privacyPolicyUrl, termsUrl'
}

interface SettingsState {
  apiKey: string
  apiBaseURL: string
  model: string
  temperature: number
  productProfile: ProductProfile

  setApiKey: (key: string) => void
  setApiBaseURL: (url: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
  setProductProfile: (profile: ProductProfile) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      apiBaseURL: API_CONFIG.DEFAULT_BASE_URL,
      model: API_CONFIG.DEFAULT_MODEL,
      temperature: API_CONFIG.DEFAULT_TEMPERATURE,
      productProfile: DEFAULT_PRODUCT_PROFILE,

      setApiKey: (key) => {
        set({ apiKey: key })
        chatAPI.setApiKey(key)
      },

      setApiBaseURL: (url) => {
        set({ apiBaseURL: url })
        chatAPI.setBaseURL(url)
      },

      setModel: (model) => {
        set({ model })
        chatAPI.setDefaultModel(model)
      },

      setTemperature: (temperature) => {
        set({ temperature })
        chatAPI.setDefaultTemperature(temperature)
      },

      setProductProfile: (productProfile) => {
        set({ productProfile })
      }
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => chromeStorage),
    }
  )
)
