import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { STORAGE_KEYS } from '@/config/constants'
import en from './locales/en'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

// Detect browser language
const getBrowserLanguage = (): string => {
  const browserLang = navigator.language.toLowerCase()

  if (browserLang.startsWith('zh')) {
    // Distinguish between Simplified and Traditional Chinese
    if (browserLang.includes('tw') || browserLang.includes('hk') || browserLang.includes('mo')) {
      return 'zh-TW'
    }
    return 'zh-CN'
  }

  return 'en'
}

// Get saved language setting from localStorage
const getSavedLanguage = (): string => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LANGUAGE)
    return saved || getBrowserLanguage()
  } catch {
    return getBrowserLanguage()
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en,
      'zh-CN': zhCN,
      'zh-TW': zhTW
    },
    lng: getSavedLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  })

export default i18n
