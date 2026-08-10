import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chatAPI } from '@/services/api'
import { API_CONFIG, STORAGE_KEYS } from '@/config/constants'
import { createJSONStorage } from 'zustand/middleware'
import { chromeStorage } from './chromeStorage'
import type { ProductProfile, ProductProfileEntry } from '@/types'
import { PRODUCT_ASSET_DEFAULTS } from '@/utils/productAssets'
import { DEFAULT_PRODUCT_FIELD_DESCRIPTIONS } from '@/config/productProfileGuidance'

export const DEFAULT_CUSTOM_PROFILE_FIELDS = [
  {
    id: 'default-password',
    label: '密码',
    value: '',
    description: '用于目录站要求创建的条目管理密码，例如后续编辑或删除 listing 的密码；不要用于网站账号登录密码。'
  },
  {
    id: 'default-company-address',
    label: '公司地址',
    value: '',
    description: '公司公开业务地址。用于 Company Address、Business Address、Street Address 等字段，不要填写到网址或联系人字段。'
  },
  {
    id: 'default-company-founded-date',
    label: '公司建立时间',
    value: '',
    description: '公司或产品成立、创立的年份或日期。用于 Founding Year、Founded、Established、Launch Date 等字段，并按网页要求的格式填写。'
  },
  {
    id: 'default-postcode',
    label: 'Postcode/ZIP code',
    value: '',
    description: '公司地址对应的邮政编码。仅用于 Postcode、Postal Code、ZIP 或 ZIP Code 字段。'
  }
]

export const DEFAULT_PRODUCT_FIELD_ORDER = [
  'productName',
  'contactEmail',
  'websiteUrl',
  'shortDescription',
  'custom:default-password',
  'longDescription',
  'category',
  'logoUrl',
  'companyName',
  'companyWebsite',
  'companyPhone',
  'companyEmail',
  'contactFirstName',
  'contactLastName',
  'twitterUrl',
  'keywords',
  'tags',
  'extraInfo',
  'lockedFields',
  'custom:default-company-address',
  'custom:default-company-founded-date',
  'custom:default-postcode'
]

export const DEFAULT_HIDDEN_PRODUCT_FIELD_IDS = [
  'privacyPolicyUrl',
  'termsUrl',
  'linkedinUrl',
  'githubUrl'
]

export const DEFAULT_PRODUCT_PROFILE: ProductProfile = {
  productName: '',
  websiteUrl: '',
  shortDescription: '',
  longDescription: '',
  category: '',
  logoUrl: '',
  ...PRODUCT_ASSET_DEFAULTS,
  galleryImageUrls: [],
  companyName: '',
  companyWebsite: '',
  companyPhone: '',
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
  lockedFields: 'productName, websiteUrl, companyName, companyWebsite, companyPhone, contactEmail, privacyPolicyUrl, termsUrl',
  fieldDescriptions: { ...DEFAULT_PRODUCT_FIELD_DESCRIPTIONS },
  customFields: DEFAULT_CUSTOM_PROFILE_FIELDS
}

export const DEFAULT_PRODUCT_PROFILE_ID = 'default-profile'

function cloneProductProfile(profile?: Partial<ProductProfile>): ProductProfile {
  return {
    ...DEFAULT_PRODUCT_PROFILE,
    ...(profile || {}),
    galleryImageUrls: Array.isArray(profile?.galleryImageUrls) ? [...profile.galleryImageUrls] : [],
    fieldDescriptions: {
      ...DEFAULT_PRODUCT_FIELD_DESCRIPTIONS,
      ...(profile?.fieldDescriptions || {})
    },
    customFields: Array.isArray(profile?.customFields)
      ? profile.customFields.map((field) => ({ ...field }))
      : DEFAULT_CUSTOM_PROFILE_FIELDS.map((field) => ({ ...field }))
  }
}

function createProfileId() {
  return `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createProfileEntry(
  id: string,
  name: string,
  profile?: Partial<ProductProfile>,
  createdAt = Date.now()
): ProductProfileEntry {
  const normalizedProfile = cloneProductProfile(profile)
  return {
    id,
    name: name.trim() || normalizedProfile.productName.trim() || '未命名产品',
    profile: normalizedProfile,
    createdAt,
    updatedAt: Date.now()
  }
}

const DEFAULT_PRODUCT_PROFILE_ENTRY = createProfileEntry(
  DEFAULT_PRODUCT_PROFILE_ID,
  '默认产品',
  DEFAULT_PRODUCT_PROFILE,
  0
)

interface SettingsState {
  apiKey: string
  apiBaseURL: string
  model: string
  temperature: number
  productProfile: ProductProfile
  productProfiles: ProductProfileEntry[]
  activeProductProfileId: string
  productFieldOrder: string[]
  hiddenProductFieldIds: string[]
  autoGoogleLogin: boolean
  preferredGoogleAccountEmail: string

  setApiKey: (key: string) => void
  setApiBaseURL: (url: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
  setProductProfile: (profile: ProductProfile) => void
  createProductProfile: (name?: string, profile?: Partial<ProductProfile>) => string
  switchProductProfile: (id: string) => void
  renameProductProfile: (id: string, name: string) => void
  deleteProductProfile: (id: string) => void
  setProductFieldOrder: (order: string[]) => void
  setHiddenProductFieldIds: (ids: string[]) => void
  setAutoGoogleLogin: (enabled: boolean) => void
  setPreferredGoogleAccountEmail: (email: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      apiBaseURL: API_CONFIG.DEFAULT_BASE_URL,
      model: API_CONFIG.DEFAULT_MODEL,
      temperature: API_CONFIG.DEFAULT_TEMPERATURE,
      productProfile: DEFAULT_PRODUCT_PROFILE,
      productProfiles: [DEFAULT_PRODUCT_PROFILE_ENTRY],
      activeProductProfileId: DEFAULT_PRODUCT_PROFILE_ID,
      productFieldOrder: DEFAULT_PRODUCT_FIELD_ORDER,
      hiddenProductFieldIds: DEFAULT_HIDDEN_PRODUCT_FIELD_IDS,
      autoGoogleLogin: true,
      preferredGoogleAccountEmail: '',

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
        set((state) => {
          const normalizedProfile = cloneProductProfile(productProfile)
          const activeId = state.activeProductProfileId || state.productProfiles[0]?.id || DEFAULT_PRODUCT_PROFILE_ID
          const activeEntry = state.productProfiles.find((entry) => entry.id === activeId)
          const productProfiles = activeEntry
            ? state.productProfiles.map((entry) => {
                if (entry.id !== activeId) return entry
                const previousProductName = entry.profile.productName.trim()
                const profileNameFollowsProduct = !previousProductName ||
                  entry.name === previousProductName ||
                  ['默认产品', '未命名产品', '新产品'].includes(entry.name)
                return {
                  ...entry,
                  name: profileNameFollowsProduct && normalizedProfile.productName.trim()
                    ? normalizedProfile.productName.trim()
                    : entry.name,
                  profile: normalizedProfile,
                  updatedAt: Date.now()
                }
              })
            : [
                ...state.productProfiles,
                createProfileEntry(activeId, normalizedProfile.productName || '默认产品', normalizedProfile)
              ]

          return { productProfile: normalizedProfile, productProfiles, activeProductProfileId: activeId }
        })
      },

      createProductProfile: (name = '', profile = {}) => {
        const id = createProfileId()
        const entry = createProfileEntry(id, name, {
          ...profile,
          logoImageUrl: profile.logoImageUrl || '',
          screenshotImageUrl: profile.screenshotImageUrl || '',
          promoImageUrl: profile.promoImageUrl || '',
          bannerImageUrl: profile.bannerImageUrl || '',
          galleryImageUrls: profile.galleryImageUrls || []
        })
        set((state) => ({
          productProfiles: [...state.productProfiles, entry],
          activeProductProfileId: id,
          productProfile: entry.profile
        }))
        return id
      },

      switchProductProfile: (id) => {
        set((state) => {
          const entry = state.productProfiles.find((candidate) => candidate.id === id)
          return entry
            ? { activeProductProfileId: entry.id, productProfile: cloneProductProfile(entry.profile) }
            : {}
        })
      },

      renameProductProfile: (id, name) => {
        const normalizedName = name.trim()
        if (!normalizedName) return
        set((state) => ({
          productProfiles: state.productProfiles.map((entry) => entry.id === id
            ? { ...entry, name: normalizedName, updatedAt: Date.now() }
            : entry)
        }))
      },

      deleteProductProfile: (id) => {
        set((state) => {
          if (state.productProfiles.length <= 1) return {}
          const productProfiles = state.productProfiles.filter((entry) => entry.id !== id)
          if (state.activeProductProfileId !== id) return { productProfiles }
          const nextEntry = productProfiles[0]
          return {
            productProfiles,
            activeProductProfileId: nextEntry.id,
            productProfile: cloneProductProfile(nextEntry.profile)
          }
        })
      },

      setProductFieldOrder: (productFieldOrder) => {
        set({ productFieldOrder })
      },

      setHiddenProductFieldIds: (hiddenProductFieldIds) => {
        set({ hiddenProductFieldIds })
      },

      setAutoGoogleLogin: (autoGoogleLogin) => {
        set({ autoGoogleLogin })
      },

      setPreferredGoogleAccountEmail: (preferredGoogleAccountEmail) => {
        set({ preferredGoogleAccountEmail })
      }
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => chromeStorage),
      version: 2,
      migrate: (persistedState: unknown) => {
        const state = (persistedState || {}) as Partial<SettingsState>
        const existingProfiles = Array.isArray(state.productProfiles)
          ? state.productProfiles
              .filter((entry) => entry?.id && entry?.profile)
              .map((entry) => ({
                ...entry,
                name: entry.name || entry.profile.productName || '未命名产品',
                profile: cloneProductProfile(entry.profile)
              }))
          : []
        const productProfiles = existingProfiles.length > 0
          ? existingProfiles
          : [createProfileEntry(
              DEFAULT_PRODUCT_PROFILE_ID,
              state.productProfile?.productName || '默认产品',
              state.productProfile || DEFAULT_PRODUCT_PROFILE,
              0
            )]
        const activeProductProfileId = productProfiles.some((entry) => entry.id === state.activeProductProfileId)
          ? String(state.activeProductProfileId)
          : productProfiles[0].id
        const productProfile = cloneProductProfile(
          productProfiles.find((entry) => entry.id === activeProductProfileId)?.profile
        )

        return {
          ...state,
          productProfiles,
          activeProductProfileId,
          productProfile
        }
      }
    }
  )
)
