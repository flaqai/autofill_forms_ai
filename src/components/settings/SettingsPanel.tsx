import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_PRODUCT_PROFILE, useSettingsStore } from '@/store/settingsStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AVAILABLE_MODELS, SUPPORTED_LANGUAGES, STORAGE_KEYS } from '@/config/constants'
import type { ProductProfile } from '@/types'

const productProfileFields: Array<{
  key: keyof ProductProfile
  label: string
  placeholder: string
  multiline?: boolean
}> = [
  { key: 'productName', label: '产品名称', placeholder: 'SoMuch' },
  { key: 'websiteUrl', label: '官网 URL', placeholder: 'https://somuch.com' },
  { key: 'shortDescription', label: '一句话介绍', placeholder: '一句话说明产品做什么' },
  { key: 'longDescription', label: '长描述', placeholder: '适合提交到目录站的完整产品介绍', multiline: true },
  { key: 'category', label: '分类', placeholder: 'AI Tools, SEO, Productivity' },
  { key: 'logoUrl', label: 'Logo / Icon URL', placeholder: 'https://somuch.com/logo.png' },
  { key: 'logoImageUrl', label: 'Logo 上传图片', placeholder: 'product-assets/minigpt-logo-square-500x500.jpg' },
  { key: 'screenshotImageUrl', label: '网站截图上传图片', placeholder: 'product-assets/minigpt-website-screenshot.png' },
  { key: 'promoImageUrl', label: '产品宣传上传图片', placeholder: 'product-assets/minigpt-promo-image.jpg' },
  { key: 'bannerImageUrl', label: '横版宣传上传图片', placeholder: 'product-assets/minigpt-banner-image.png' },
  { key: 'companyName', label: '公司名称', placeholder: 'SoMuch' },
  { key: 'companyWebsite', label: '公司官网', placeholder: 'https://somuch.com' },
  { key: 'contactEmail', label: '常用提交邮箱', placeholder: 'supertoolsai@gmail.com' },
  { key: 'companyEmail', label: '公司邮箱', placeholder: 'contact@freeimgen.com' },
  { key: 'contactFirstName', label: '联系人名', placeholder: 'First name' },
  { key: 'contactLastName', label: '联系人姓', placeholder: 'Last name' },
  { key: 'privacyPolicyUrl', label: 'Privacy Policy URL', placeholder: 'https://somuch.com/privacy' },
  { key: 'termsUrl', label: 'Terms URL', placeholder: 'https://somuch.com/terms' },
  { key: 'twitterUrl', label: 'Twitter / X', placeholder: 'https://x.com/your_handle' },
  { key: 'linkedinUrl', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/your-company' },
  { key: 'githubUrl', label: 'GitHub', placeholder: 'https://github.com/your-org' },
  { key: 'keywords', label: '关键词', placeholder: 'ai directory, seo tools, product discovery' },
  { key: 'tags', label: '适合提交的标签', placeholder: 'AI, SaaS, SEO' },
  {
    key: 'extraInfo',
    label: '补充资料 / Extra Info',
    placeholder: 'Pricing: Free plan available...\nProduct Hunt: https://...\nLaunch date: 2025-11-01\nTarget audience: SEO operators, SaaS marketers...',
    multiline: true
  },
  { key: 'lockedFields', label: '不允许 AI 改动的字段', placeholder: 'websiteUrl, contactEmail, privacyPolicyUrl', multiline: true }
]

function mergeProductProfile(profile?: Partial<ProductProfile>): ProductProfile {
  return {
    ...DEFAULT_PRODUCT_PROFILE,
    ...(profile || {})
  }
}

function parsePersistedSettings(rawSettings?: string) {
  if (!rawSettings) return null

  try {
    const parsed = JSON.parse(rawSettings)
    return parsed.state || parsed
  } catch {
    return null
  }
}

function mergeExtraInfo(currentExtraInfo: string = '', localExtraInfo: string = '') {
  const lines = new Map<string, string>()

  for (const line of `${currentExtraInfo}\n${localExtraInfo}`.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) {
      lines.set(trimmed, trimmed)
    }
  }

  return Array.from(lines.values()).join('\n')
}

export const SettingsPanel = () => {
  const { t, i18n } = useTranslation()
  const {
    apiKey,
    apiBaseURL,
    model,
    temperature,
    productProfile,
    setApiKey,
    setApiBaseURL,
    setModel,
    setTemperature,
    setProductProfile
  } =
    useSettingsStore()
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localBaseURL, setLocalBaseURL] = useState(apiBaseURL)
  const [localModel, setLocalModel] = useState(model)
  const [localTemperature, setLocalTemperature] = useState(temperature)
  const [localProductProfile, setLocalProductProfile] = useState<ProductProfile>(mergeProductProfile(productProfile))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setLocalApiKey(apiKey)
    setLocalBaseURL(apiBaseURL)
    setLocalModel(model)
    setLocalTemperature(temperature)
    setLocalProductProfile(mergeProductProfile(productProfile))
  }, [apiKey, apiBaseURL, model, temperature, productProfile])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[STORAGE_KEYS.SETTINGS]?.newValue) return

      const nextSettings = parsePersistedSettings(changes[STORAGE_KEYS.SETTINGS].newValue)
      if (!nextSettings) return

      if (nextSettings.productProfile) {
        setProductProfile(mergeProductProfile(nextSettings.productProfile))
        setLocalProductProfile(mergeProductProfile(nextSettings.productProfile))
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [setProductProfile])

  const handleSave = () => {
    const nextProductProfile = mergeProductProfile({
      ...productProfile,
      ...localProductProfile,
      extraInfo: mergeExtraInfo(productProfile.extraInfo, localProductProfile.extraInfo)
    })

    setApiKey(localApiKey)
    setApiBaseURL(localBaseURL)
    setModel(localModel)
    setTemperature(localTemperature)
    setProductProfile(nextProductProfile)
    setLocalProductProfile(nextProductProfile)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateProductProfile = (key: keyof ProductProfile, value: string) => {
    setLocalProductProfile((current) => ({
      ...current,
      [key]: value
    }))
  }

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang)
  }

  return (
    <div className="p-4 space-y-5">
      <h2 className="text-lg font-semibold text-slate-800">{t('settings.title')}</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.apiKey')}
          </label>
          <Input
            type="password"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="w-full text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.apiKeyDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.apiBaseURL')}
          </label>
          <Input
            type="text"
            value={localBaseURL}
            onChange={(e) => setLocalBaseURL(e.target.value)}
            placeholder={t('settings.apiBaseURLPlaceholder')}
            className="w-full text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.apiBaseURLDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.model')}
          </label>
          <Input
            list="available-models"
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            placeholder="Type or select a model"
            className="w-full text-sm"
          />
          <datalist id="available-models">
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.modelDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.temperature')}: {localTemperature.toFixed(1)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localTemperature}
            onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('settings.temperatureDescription')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            {t('settings.language')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`px-3 py-2 text-xs rounded-lg border transition-all ${i18n.language === lang.code
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">推广资料</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              填表时 AI 只能基于这里的信息匹配和改写，缺失信息会留空。
            </p>
          </div>

          {productProfileFields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {field.label}
              </label>
              {field.multiline ? (
                <textarea
                  value={localProductProfile[field.key]}
                  onChange={(e) => updateProductProfile(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full min-h-20 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                />
              ) : (
                <Input
                  type="text"
                  value={localProductProfile[field.key]}
                  onChange={(e) => updateProductProfile(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full text-sm"
                />
              )}
            </div>
          ))}
        </div>

        <Button onClick={handleSave} className="w-full">
          {saved ? t('common.saved') : t('common.save')}
        </Button>
      </div>

      <div className="pt-4 border-t border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">{t('settings.about')}</h3>
        <div className="space-y-1 text-xs text-slate-600">
          <p>{t('settings.version')}</p>
          <p>{t('settings.poweredBy')}</p>
        </div>
      </div>
    </div>
  )
}
