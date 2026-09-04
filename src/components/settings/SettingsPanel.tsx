import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_CUSTOM_PROFILE_FIELDS,
  DEFAULT_HIDDEN_PRODUCT_FIELD_IDS,
  DEFAULT_PRODUCT_FIELD_ORDER,
  DEFAULT_PRODUCT_PROFILE,
  DEFAULT_PRODUCT_PROFILE_ID,
  useSettingsStore
} from '@/store/settingsStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AVAILABLE_MODELS, SUPPORTED_LANGUAGES, STORAGE_KEYS } from '@/config/constants'
import type { CustomProfileField, ProductProfile } from '@/types'
import {
  DEFAULT_PRODUCT_FIELD_DESCRIPTIONS,
  type ProductProfileTextKey
} from '@/config/productProfileGuidance'
import {
  assetIdForGalleryImage,
  assetIdForProfileKey,
  assetIdFromReference,
  isStoredAssetReference,
  PRODUCT_ASSET_DEFAULTS,
  storedAssetReference,
  storedAssetStorageKey,
  type ProductAssetProfileKey,
  type StoredProductAsset
} from '@/utils/productAssets'
import { parsePromotionPackageFiles } from '@/utils/promotionPackage'

const productProfileFields: Array<{
  key: ProductProfileTextKey
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
  { key: 'companyName', label: '公司名称', placeholder: 'SoMuch' },
  { key: 'companyWebsite', label: '公司官网', placeholder: 'https://somuch.com' },
  { key: 'companyPhone', label: '公司电话', placeholder: '212-555-0199' },
  { key: 'contactEmail', label: '常用提交邮箱', placeholder: 'submitter@example.com' },
  { key: 'companyEmail', label: '公司邮箱', placeholder: 'contact@example.com' },
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

const CUSTOM_FIELD_PREFIX = 'custom:'

type StandardProfileField = typeof productProfileFields[number]
type ProfileFieldItem =
  | { id: string; kind: 'standard'; field: StandardProfileField }
  | { id: string; kind: 'custom'; field: CustomProfileField }

interface ProductFieldLayoutTemplate {
  type: 'chat4o-product-field-layout'
  version: 1
  customFields: Array<Pick<CustomProfileField, 'id' | 'label'> & { description?: string }>
  fieldDescriptions?: Record<string, string>
  order: string[]
  hidden: string[]
}

interface FullStorageBackup {
  type: 'chat4o-full-storage-backup'
  version: 1
  exportedAt: string
  storage: Record<string, unknown>
}

function downloadJsonFile(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function parseFullStorageBackup(raw: string): FullStorageBackup {
  const parsed = JSON.parse(raw) as Partial<FullStorageBackup>
  if (
    parsed.type !== 'chat4o-full-storage-backup' ||
    parsed.version !== 1 ||
    !parsed.storage ||
    typeof parsed.storage !== 'object' ||
    Array.isArray(parsed.storage)
  ) {
    throw new Error('这不是 Chat4o AI 的完整备份文件')
  }

  return parsed as FullStorageBackup
}

function customFieldLayoutId(id: string) {
  return `${CUSTOM_FIELD_PREFIX}${id}`
}

function customFieldLabelInputWidth(label: string) {
  const displayLabel = label || '字段名称'
  const characterWidth = Array.from(displayLabel).reduce((width, character) => (
    width + (character.charCodeAt(0) > 255 ? 2 : 1)
  ), 0)

  return `${Math.min(28, Math.max(4, characterWidth + 1))}ch`
}

function parseProductFieldLayoutTemplate(rawTemplate: string): ProductFieldLayoutTemplate {
  if (rawTemplate.length > 100_000) {
    throw new Error('字段布局内容过长')
  }

  const parsed = JSON.parse(rawTemplate) as Partial<ProductFieldLayoutTemplate>
  if (parsed.type !== 'chat4o-product-field-layout' || parsed.version !== 1) {
    throw new Error('这不是可用的字段布局')
  }

  const customFieldCandidates = Array.isArray(parsed.customFields)
    ? parsed.customFields
      .filter((field) => field && typeof field.id === 'string' && typeof field.label === 'string')
      .map((field) => ({
        id: field.id.trim(),
        label: field.label.trim(),
        description: typeof field.description === 'string'
          ? field.description.trim().slice(0, 1000)
          : ''
      }))
      .filter((field) => field.id && field.label)
      .slice(0, 100)
    : []
  const customFields = Array.from(new Map(
    customFieldCandidates.map((field) => [field.id, field])
  ).values())
  const validIds = new Set([
    ...productProfileFields.map((field) => String(field.key)),
    ...customFields.map((field) => customFieldLayoutId(field.id))
  ])
  const uniqueIds = (values: unknown) => Array.isArray(values)
    ? Array.from(new Set(values.filter((value): value is string => (
      typeof value === 'string' && validIds.has(value)
    ))))
    : []
  const validStandardFieldIds = new Set(productProfileFields.map((field) => String(field.key)))
  const fieldDescriptions = parsed.fieldDescriptions && typeof parsed.fieldDescriptions === 'object'
    ? Object.fromEntries(
      Object.entries(parsed.fieldDescriptions)
        .filter(([key, value]) => validStandardFieldIds.has(key) && typeof value === 'string')
        .map(([key, value]) => [key, String(value).trim().slice(0, 1000)])
    )
    : {}

  return {
    type: 'chat4o-product-field-layout',
    version: 1,
    customFields,
    fieldDescriptions,
    order: uniqueIds(parsed.order),
    hidden: uniqueIds(parsed.hidden)
  }
}

function getOrderedProfileFieldItems(profile: ProductProfile, savedOrder: string[]) {
  const fields: ProfileFieldItem[] = [
    ...productProfileFields.map((field) => ({
      id: String(field.key),
      kind: 'standard' as const,
      field
    })),
    ...(profile.customFields || []).map((field) => ({
      id: customFieldLayoutId(field.id),
      kind: 'custom' as const,
      field
    }))
  ]
  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const orderedItems = savedOrder
    .map((id) => fieldById.get(id))
    .filter((field): field is ProfileFieldItem => Boolean(field))
  const orderedIds = new Set(orderedItems.map((field) => field.id))

  return [...orderedItems, ...fields.filter((field) => !orderedIds.has(field.id))]
}

const productAssetFields: Array<{
  key: ProductAssetProfileKey
  label: string
  description: string
}> = [
  { key: 'logoImageUrl', label: 'Logo', description: '方形图标，适合 Logo、Icon、Avatar' },
  { key: 'screenshotImageUrl', label: '网站首页截图', description: '清楚展示网站首页和产品定位' }
]

const galleryAssetFields = [
  { index: 0, label: '核心功能截图 1', description: '展示一个主要功能的真实界面' },
  { index: 1, label: '核心功能截图 2', description: '展示另一个主要功能或操作流程' },
  { index: 2, label: '产品效果或输出示例', description: '展示产品实际生成或处理后的结果' }
]

interface AssetPreview {
  url: string
  name: string
}

interface AssetFeedback {
  kind: 'error' | 'success'
  message: string
}

function imageMimeType(file: File) {
  if (file.type.startsWith('image/')) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'png') return 'image/png'
  return ''
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const fallbackMimeType = imageMimeType(file)
    const readableFile = file.type.startsWith('image/') || !fallbackMimeType
      ? file
      : new Blob([file], { type: fallbackMimeType })
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.startsWith('data:image/')) {
        reject(new Error('所选文件不是可用的图片'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(new Error('无法读取图片文件'))
    reader.readAsDataURL(readableFile)
  })
}

async function resolveAssetPreview(value: unknown): Promise<AssetPreview> {
  if (typeof value !== 'string' || !value) return { url: '', name: '' }

  if (isStoredAssetReference(value)) {
    const assetId = value.replace('stored-product-asset://', '')
    const storageKey = storedAssetStorageKey(assetId)
    const result = await chrome.storage.local.get(storageKey)
    const asset = result[storageKey] as StoredProductAsset | undefined
    return {
      url: asset?.dataUrl || '',
      name: asset?.fileName || '已保存图片'
    }
  }

  if (/^(https?:|data:|blob:|chrome-extension:)/i.test(value)) {
    return { url: value, name: value.split('/').pop() || '图片链接' }
  }

  return {
    url: chrome.runtime.getURL(value.replace(/^\/+/, '')),
    name: value.split('/').pop() || '预置图片'
  }
}

function mergeProductProfile(profile?: Partial<ProductProfile>): ProductProfile {
  const merged = {
    ...DEFAULT_PRODUCT_PROFILE,
    ...(profile || {})
  }
  const customFields = Array.isArray(merged.customFields) ? merged.customFields : []
  const companyPhoneCustomField = customFields.find((field) => isCompanyPhoneCustomField(field) && field.value.trim())

  return {
    ...merged,
    galleryImageUrls: Array.isArray(profile?.galleryImageUrls) ? [...profile.galleryImageUrls] : [],
    companyPhone: merged.companyPhone || companyPhoneCustomField?.value.trim() || '',
    fieldDescriptions: {
      ...DEFAULT_PRODUCT_FIELD_DESCRIPTIONS,
      ...(profile?.fieldDescriptions || {})
    },
    customFields: customFields
      .filter((field) => !isCompanyPhoneCustomField(field))
      .map((field) => ({
        ...field,
        description: typeof field.description === 'string' ? field.description : ''
      }))
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

function isCompanyPhoneCustomField(field: CustomProfileField) {
  const label = field.label.trim().toLowerCase()
  return ['公司电话', 'company phone', 'business phone', 'phone', 'telephone', 'tel'].includes(label)
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back for extension windows where clipboard permission is unavailable.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()

  if (!copied) {
    throw new Error('Clipboard copy was rejected')
  }
}

export const SettingsPanel = () => {
  const { t, i18n } = useTranslation()
  const {
    apiKey,
    apiBaseURL,
    model,
    productProfile,
    productProfiles,
    activeProductProfileId,
    productFieldOrder,
    hiddenProductFieldIds,
    setApiKey,
    setApiBaseURL,
    setModel,
    setProductProfile,
    createProductProfile,
    switchProductProfile,
    renameProductProfile,
    deleteProductProfile,
    setProductFieldOrder,
    setHiddenProductFieldIds
  } =
    useSettingsStore()
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localBaseURL, setLocalBaseURL] = useState(apiBaseURL)
  const [localModel, setLocalModel] = useState(model)
  const [localProductProfile, setLocalProductProfile] = useState<ProductProfile>(mergeProductProfile(productProfile))
  const [connectionSaved, setConnectionSaved] = useState(false)
  const [assetPreviews, setAssetPreviews] = useState<Partial<Record<ProductAssetProfileKey, AssetPreview>>>({})
  const [galleryPreviews, setGalleryPreviews] = useState<AssetPreview[]>([])
  const [assetError, setAssetError] = useState('')
  const [assetFeedback, setAssetFeedback] = useState<Partial<Record<ProductAssetProfileKey, AssetFeedback>>>({})
  const [galleryFeedback, setGalleryFeedback] = useState<Partial<Record<number, AssetFeedback>>>({})
  const [uploadingAsset, setUploadingAsset] = useState<ProductAssetProfileKey | null>(null)
  const [uploadingGalleryIndex, setUploadingGalleryIndex] = useState<number | null>(null)
  const assetInputRefs = useRef<Partial<Record<ProductAssetProfileKey, HTMLInputElement | null>>>({})
  const galleryInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const packageJsonInputRef = useRef<HTMLInputElement | null>(null)
  const packageFolderInputRef = useRef<HTMLInputElement | null>(null)
  const fullBackupInputRef = useRef<HTMLInputElement | null>(null)
  const [importingPackage, setImportingPackage] = useState(false)
  const [restoringFullBackup, setRestoringFullBackup] = useState(false)
  const [packageImportStatus, setPackageImportStatus] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const [profileEditorMode, setProfileEditorMode] = useState<'create' | 'rename' | null>(null)
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [confirmingProfileDelete, setConfirmingProfileDelete] = useState(false)
  const [newCustomFieldLabel, setNewCustomFieldLabel] = useState('')
  const [newCustomFieldValue, setNewCustomFieldValue] = useState('')
  const [customFieldError, setCustomFieldError] = useState('')
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null)
  const [dropTargetFieldId, setDropTargetFieldId] = useState<string | null>(null)
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null)
  const [expandedDescriptionFieldIds, setExpandedDescriptionFieldIds] = useState<string[]>([])
  const [editingDescriptionFieldId, setEditingDescriptionFieldId] = useState<string | null>(null)
  const [showLayoutImport, setShowLayoutImport] = useState(false)
  const [layoutImportText, setLayoutImportText] = useState('')
  const [layoutStatus, setLayoutStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const copiedFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalApiKey(apiKey)
    setLocalBaseURL(apiBaseURL)
    setLocalModel(model)
    setLocalProductProfile(mergeProductProfile(productProfile))
  }, [apiKey, apiBaseURL, model, productProfile])

  useEffect(() => {
    return () => {
      if (copiedFeedbackTimerRef.current !== null) {
        window.clearTimeout(copiedFeedbackTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let disposed = false

    const loadLatestProductProfile = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return

      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
        const settings = parsePersistedSettings(stored[STORAGE_KEYS.SETTINGS])
        if (disposed || !settings?.productProfile) return

        const latestProfile = mergeProductProfile(settings.productProfile)
        setProductProfile(latestProfile)
        setLocalProductProfile(latestProfile)
      } catch (error) {
        console.error('[SettingsPanel] Failed to refresh product profile', error)
      }
    }

    void loadLatestProductProfile()
    return () => {
      disposed = true
    }
  }, [setProductProfile])

  useEffect(() => {
    let cancelled = false

    const loadPreviews = async () => {
      try {
        const entries = await Promise.all(productAssetFields.map(async ({ key }) => {
          const preview = await resolveAssetPreview(localProductProfile[key])
          return [key, preview] as const
        }))

        if (!cancelled) {
          setAssetPreviews(Object.fromEntries(entries))
        }
      } catch (error) {
        console.error('[ProductAssets] Failed to load previews', error)
        if (!cancelled) {
          setAssetError('图片已保存，但预览加载失败。请关闭并重新打开设置页查看。')
        }
      }
    }

    void loadPreviews()
    return () => {
      cancelled = true
    }
  }, [localProductProfile])

  useEffect(() => {
    let cancelled = false

    const loadGalleryPreviews = async () => {
      try {
        const previews = await Promise.all(
          localProductProfile.galleryImageUrls.slice(0, galleryAssetFields.length).map(resolveAssetPreview)
        )
        if (!cancelled) setGalleryPreviews(previews)
      } catch (error) {
        console.error('[ProductAssets] Failed to load gallery previews', error)
        if (!cancelled) setAssetError('图库图片已保存，但预览加载失败。请关闭并重新打开设置页查看。')
      }
    }

    void loadGalleryPreviews()
    return () => {
      cancelled = true
    }
  }, [localProductProfile.galleryImageUrls])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      const settingsChange = changes[STORAGE_KEYS.SETTINGS]
      if (areaName !== 'local' || !settingsChange?.newValue) return

      const nextSettings = parsePersistedSettings(settingsChange.newValue)
      if (!nextSettings) return

      const previousSettings = parsePersistedSettings(settingsChange.oldValue)
      const productProfileChanged = JSON.stringify(nextSettings.productProfile || {}) !== JSON.stringify(previousSettings?.productProfile || {})

      if (productProfileChanged && nextSettings.productProfile) {
        setProductProfile(mergeProductProfile(nextSettings.productProfile))
        setLocalProductProfile(mergeProductProfile(nextSettings.productProfile))
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [setProductProfile])

  const persistProductProfile = (nextProfile: ProductProfile) => {
    const normalizedProfile = mergeProductProfile(nextProfile)

    setLocalProductProfile(normalizedProfile)
    setProductProfile(normalizedProfile)
  }

  const updateProductProfile = (key: ProductProfileTextKey, value: string) => {
    persistProductProfile({
      ...localProductProfile,
      [key]: value
    })
  }

  const updateCustomField = (
    id: string,
    update: Partial<Pick<CustomProfileField, 'label' | 'value' | 'description'>>
  ) => {
    persistProductProfile({
      ...localProductProfile,
      customFields: localProductProfile.customFields.map((field) => field.id === id ? { ...field, ...update } : field)
    })
  }

  const addCustomField = () => {
    const label = newCustomFieldLabel.trim()
    if (!label) {
      setCustomFieldError('先给这个字段取一个名称，例如 Founder、价格或公司地址。')
      return
    }

    const field: CustomProfileField = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      value: newCustomFieldValue.trim(),
      description: ''
    }
    const nextProfile = mergeProductProfile({
      ...localProductProfile,
      customFields: [...localProductProfile.customFields, field]
    })
    persistProductProfile(nextProfile)
    setProductFieldOrder([
      ...getOrderedProfileFieldItems(nextProfile, productFieldOrder).map((item) => item.id)
    ])
    setNewCustomFieldLabel('')
    setNewCustomFieldValue('')
    setCustomFieldError('')
  }

  const removeCustomField = (id: string) => {
    persistProductProfile({
      ...localProductProfile,
      customFields: localProductProfile.customFields.filter((field) => field.id !== id)
    })
    const layoutId = customFieldLayoutId(id)
    setProductFieldOrder(productFieldOrder.filter((fieldId) => fieldId !== layoutId))
    setHiddenProductFieldIds(hiddenProductFieldIds.filter((fieldId) => fieldId !== layoutId))
  }

  const allProfileFieldItems = getOrderedProfileFieldItems(localProductProfile, productFieldOrder)
  const profileFieldItems = allProfileFieldItems.filter((item) => !hiddenProductFieldIds.includes(item.id))
  const hiddenProfileFieldItems = allProfileFieldItems.filter((item) => hiddenProductFieldIds.includes(item.id))

  const copyProductFieldLayout = async () => {
    const template: ProductFieldLayoutTemplate = {
      type: 'chat4o-product-field-layout',
      version: 1,
      customFields: localProductProfile.customFields.map(({ id, label, description }) => ({
        id,
        label,
        description
      })),
      fieldDescriptions: localProductProfile.fieldDescriptions,
      order: allProfileFieldItems.map((item) => item.id),
      hidden: hiddenProductFieldIds
    }

    try {
      await copyTextToClipboard(JSON.stringify(template))
      setLayoutStatus({
        kind: 'success',
        message: '字段布局已复制。切换到新指纹浏览器后，在这里选择“导入字段布局”。'
      })
    } catch (error) {
      console.error('[SettingsPanel] Failed to copy field layout', error)
      setLayoutStatus({ kind: 'error', message: '复制失败，请重新点击一次。' })
    }
  }

  const applyProductFieldLayoutTemplate = (
    template: ProductFieldLayoutTemplate,
    successMessage: string
  ) => {
    const currentFieldsById = new Map(localProductProfile.customFields.map((field) => [field.id, field]))
    const currentFieldsByLabel = new Map(localProductProfile.customFields.map((field) => [
      field.label.trim().toLowerCase(),
      field
    ]))
    const matchedCurrentFieldIds = new Set<string>()
    const importedCustomFields = template.customFields.map((field) => {
      const existingField = currentFieldsById.get(field.id)
        || currentFieldsByLabel.get(field.label.toLowerCase())

      if (existingField) {
        matchedCurrentFieldIds.add(existingField.id)
      }

      return {
        ...field,
        value: existingField?.value || '',
        description: field.description || existingField?.description || ''
      }
    })
    const importedLabels = new Set(
      template.customFields.map((field) => field.label.trim().toLowerCase())
    )
    const retainedCustomFields = localProductProfile.customFields.filter((field) => (
      !matchedCurrentFieldIds.has(field.id)
      && !template.customFields.some((templateField) => templateField.id === field.id)
      && !importedLabels.has(field.label.trim().toLowerCase())
    ))
    const customFields = [...importedCustomFields, ...retainedCustomFields]
    const standardFieldIds = productProfileFields.map((field) => String(field.key))
    const allFieldIds = [
      ...standardFieldIds,
      ...customFields.map((field) => customFieldLayoutId(field.id))
    ]
    const importedOrder = template.order.filter((id) => allFieldIds.includes(id))
    const orderedIds = new Set(importedOrder)
    const retainedCustomFieldIds = retainedCustomFields.map((field) => customFieldLayoutId(field.id))

    persistProductProfile({
      ...localProductProfile,
      fieldDescriptions: {
        ...localProductProfile.fieldDescriptions,
        ...(template.fieldDescriptions || {})
      },
      customFields
    })
    setProductFieldOrder([
      ...importedOrder,
      ...allFieldIds.filter((id) => !orderedIds.has(id))
    ])
    setHiddenProductFieldIds(Array.from(new Set([
      ...template.hidden.filter((id) => allFieldIds.includes(id)),
      ...retainedCustomFieldIds
    ])))
    setLayoutImportText('')
    setShowLayoutImport(false)
    setLayoutStatus({ kind: 'success', message: successMessage })
  }

  const applyProductFieldLayout = () => {
    try {
      const template = parseProductFieldLayoutTemplate(layoutImportText.trim())
      applyProductFieldLayoutTemplate(
        template,
        '字段名称和顺序已导入；当前浏览器里的内容已保留，原有独立字段已移到“已隐藏字段”。'
      )
    } catch (error) {
      console.error('[SettingsPanel] Failed to import field layout', error)
      setLayoutStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '字段布局无法识别'
      })
    }
  }

  const applyDefaultProductFieldLayout = () => {
    applyProductFieldLayoutTemplate(
      {
        type: 'chat4o-product-field-layout',
        version: 1,
        customFields: DEFAULT_CUSTOM_PROFILE_FIELDS.map(({ id, label, description }) => ({
          id,
          label,
          description
        })),
        fieldDescriptions: { ...DEFAULT_PRODUCT_FIELD_DESCRIPTIONS },
        order: DEFAULT_PRODUCT_FIELD_ORDER,
        hidden: DEFAULT_HIDDEN_PRODUCT_FIELD_IDS
      },
      '已应用新版默认布局。原来填写的内容都已保留，模板之外的自定义字段已移到“已隐藏字段”。'
    )
  }

  const handleSaveConnectionSettings = () => {
    setApiKey(localApiKey)
    setApiBaseURL(localBaseURL)
    setModel(localModel)
    setConnectionSaved(true)
    setTimeout(() => setConnectionSaved(false), 2000)
  }

  const reorderProfileFields = (draggedId: string, targetId: string) => {
    const order = profileFieldItems.map((item) => item.id)
    const draggedIndex = order.indexOf(draggedId)
    const targetIndex = order.indexOf(targetId)
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return

    const [draggedItem] = order.splice(draggedIndex, 1)
    const insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex
    order.splice(insertIndex, 0, draggedItem)
    setProductFieldOrder([...order, ...hiddenProfileFieldItems.map((item) => item.id)])
  }

  const hideProfileField = (id: string) => {
    if (hiddenProductFieldIds.includes(id)) return
    setHiddenProductFieldIds([...hiddenProductFieldIds, id])
  }

  const restoreProfileField = (id: string) => {
    setHiddenProductFieldIds(hiddenProductFieldIds.filter((fieldId) => fieldId !== id))
    setProductFieldOrder([...profileFieldItems.map((item) => item.id), id])
  }

  const copyProfileField = async (fieldId: string, value: string) => {
    if (!value) return

    try {
      await copyTextToClipboard(value)
      setCopiedFieldId(fieldId)
      if (copiedFeedbackTimerRef.current !== null) {
        window.clearTimeout(copiedFeedbackTimerRef.current)
      }
      copiedFeedbackTimerRef.current = window.setTimeout(() => {
        setCopiedFieldId((current) => current === fieldId ? null : current)
        copiedFeedbackTimerRef.current = null
      }, 1600)
    } catch (error) {
      console.error('[SettingsPanel] Failed to copy profile field', error)
    }
  }

  const renderCopyButton = (fieldId: string, label: string, value: string) => {
    const copied = copiedFieldId === fieldId
    const disabled = value.length === 0

    return (
      <button
        type="button"
        onClick={() => void copyProfileField(fieldId, value)}
        disabled={disabled}
        title={disabled ? `${label}暂无内容` : `复制${label}`}
        aria-label={disabled ? `${label}暂无内容` : `复制${label}`}
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${
          copied
            ? 'bg-emerald-50 text-emerald-700'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        } disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-400`}
      >
        <span className="relative block h-3.5 w-3.5" aria-hidden="true">
          <span className="absolute left-0.5 top-0.5 h-2.5 w-2 rounded-[2px] border border-current" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2 rounded-[2px] border border-current bg-white" />
        </span>
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
    )
  }

  const profileFieldDescription = (item: ProfileFieldItem) => {
    if (item.kind === 'custom') return item.field.description || ''
    return localProductProfile.fieldDescriptions?.[item.field.key]
      || DEFAULT_PRODUCT_FIELD_DESCRIPTIONS[item.field.key]
      || ''
  }

  const updateProfileFieldDescription = (item: ProfileFieldItem, description: string) => {
    if (item.kind === 'custom') {
      updateCustomField(item.field.id, { description })
      return
    }

    persistProductProfile({
      ...localProductProfile,
      fieldDescriptions: {
        ...localProductProfile.fieldDescriptions,
        [item.field.key]: description
      }
    })
  }

  const toggleProfileFieldDescription = (fieldId: string) => {
    setExpandedDescriptionFieldIds((current) => (
      current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId]
    ))
    if (editingDescriptionFieldId === fieldId) {
      setEditingDescriptionFieldId(null)
    }
  }

  const renderDescriptionButton = (item: ProfileFieldItem) => {
    const expanded = expandedDescriptionFieldIds.includes(item.id)

    return (
      <button
        type="button"
        onClick={() => toggleProfileFieldDescription(item.id)}
        aria-expanded={expanded}
        title={expanded ? '收起字段说明' : '查看字段说明'}
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${
          expanded
            ? 'bg-blue-50 text-blue-700'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] font-bold"
        >
          i
        </span>
        <span>说明</span>
      </button>
    )
  }

  const renderFieldDescription = (item: ProfileFieldItem) => {
    if (!expandedDescriptionFieldIds.includes(item.id)) return null

    const description = profileFieldDescription(item)
    const editing = editingDescriptionFieldId === item.id

    return (
      <div className="mb-2 rounded-md border border-blue-100 bg-blue-50/70 p-2">
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              autoFocus
              value={description}
              onChange={(event) => updateProfileFieldDescription(item, event.target.value)}
              placeholder="说明这个字段代表什么、什么情况下使用，以及常见的网页字段名称"
              className="min-h-20 w-full resize-y rounded-md border border-blue-200 bg-white px-2.5 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">修改内容会自动保存并用于下一次 AI 匹配</span>
              <button
                type="button"
                onClick={() => setEditingDescriptionFieldId(null)}
                className="rounded px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
              >
                完成
              </button>
            </div>
          </div>
        ) : (
          <div
            onDoubleClick={() => setEditingDescriptionFieldId(item.id)}
            className="group flex cursor-text items-start gap-2"
            title="双击说明文字可以编辑"
          >
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
              {description || '暂无说明。双击这里补充该字段的用途和匹配规则。'}
            </p>
            <button
              type="button"
              onClick={() => setEditingDescriptionFieldId(item.id)}
              className="shrink-0 rounded px-1.5 py-1 text-[11px] text-blue-600 opacity-70 hover:bg-blue-100 group-hover:opacity-100"
            >
              编辑
            </button>
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
          说明只帮助 AI 理解资料，不会被填写到网页中。
        </p>
      </div>
    )
  }

  const setAssetFeedbackMessage = (key: ProductAssetProfileKey, feedback?: AssetFeedback) => {
    setAssetFeedback((current) => {
      const next = { ...current }
      if (feedback) {
        next[key] = feedback
      } else {
        delete next[key]
      }
      return next
    })
  }

  const saveStoredAssetFile = async (assetId: string, file: File) => {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      throw new Error(`${file.name} 不是支持的图片格式`)
    }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      throw new Error('当前浏览器不支持插件图片保存')
    }

    const dataUrl = await readFileAsDataUrl(file)
    const asset: StoredProductAsset = {
      dataUrl,
      fileName: file.name,
      mimeType: imageMimeType(file),
      updatedAt: Date.now()
    }
    await chrome.storage.local.set({ [storedAssetStorageKey(assetId)]: asset })
    return storedAssetReference(assetId)
  }

  const importPromotionPackage = async (files?: FileList | null) => {
    if (!files?.length || importingPackage) return

    const previousActiveProfileId = activeProductProfileId
    let createdProfileId = ''
    const savedAssetStorageKeys: string[] = []
    setImportingPackage(true)
    setPackageImportStatus(null)
    try {
      const imported = await parsePromotionPackageFiles(files)
      const profileId = createProductProfile(imported.name, imported.profile)
      createdProfileId = profileId
      const saveImportedAsset = async (assetId: string, file: File) => {
        const reference = await saveStoredAssetFile(assetId, file)
        savedAssetStorageKeys.push(storedAssetStorageKey(assetId))
        return reference
      }
      const logoImageUrl = imported.assets.logo
        ? await saveImportedAsset(assetIdForProfileKey('logoImageUrl', profileId), imported.assets.logo)
        : imported.profile.logoImageUrl || ''
      const screenshotImageUrl = imported.assets.screenshot
        ? await saveImportedAsset(assetIdForProfileKey('screenshotImageUrl', profileId), imported.assets.screenshot)
        : imported.profile.screenshotImageUrl || ''
      const bannerImageUrl = imported.assets.banner
        ? await saveImportedAsset(assetIdForProfileKey('bannerImageUrl', profileId), imported.assets.banner)
        : imported.profile.bannerImageUrl || ''
      const storedGalleryImageUrls: string[] = []
      for (const [index, file] of imported.assets.gallery.entries()) {
        storedGalleryImageUrls.push(await saveImportedAsset(assetIdForGalleryImage(profileId, index), file))
      }
      const galleryImageUrls = Array.from(new Set([
        ...storedGalleryImageUrls,
        ...(imported.profile.galleryImageUrls || [])
      ]))
      const importedCustomFields = imported.profile.customFields || []
      const importedCustomLabels = new Set(importedCustomFields.map((field) => field.label.trim().toLowerCase()))
      const customFields = [
        ...DEFAULT_CUSTOM_PROFILE_FIELDS.filter((field) => !importedCustomLabels.has(field.label.trim().toLowerCase())),
        ...importedCustomFields
      ].map((field) => ({ ...field }))
      const nextProfile = mergeProductProfile({
        ...imported.profile,
        logoImageUrl,
        screenshotImageUrl,
        promoImageUrl: galleryImageUrls[0] || imported.profile.promoImageUrl || '',
        bannerImageUrl,
        galleryImageUrls,
        customFields
      })

      setProductProfile(nextProfile)
      setLocalProductProfile(nextProfile)
      setPackageImportStatus({
        kind: 'success',
        message: `已导入“${imported.name}”：${[
          logoImageUrl ? 'Logo' : '',
          screenshotImageUrl ? '截图' : '',
          galleryImageUrls.length ? `${galleryImageUrls.length} 张图库图` : '',
          bannerImageUrl ? '横幅' : ''
        ].filter(Boolean).join('、') || '文字资料'}${
          imported.warnings.length ? `。提示：${imported.warnings.join('；')}` : ''
        }`
      })
    } catch (error) {
      console.error('[PromotionPackage] Failed to import package', error)
      if (savedAssetStorageKeys.length > 0 && typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(savedAssetStorageKeys).catch(() => undefined)
      }
      if (createdProfileId) {
        deleteProductProfile(createdProfileId)
        switchProductProfile(previousActiveProfileId)
      }
      setPackageImportStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '推广包导入失败'
      })
    } finally {
      setImportingPackage(false)
      if (packageJsonInputRef.current) packageJsonInputRef.current.value = ''
      if (packageFolderInputRef.current) packageFolderInputRef.current.value = ''
    }
  }

  const exportFullBackup = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setPackageImportStatus({ kind: 'error', message: '当前浏览器不支持完整备份' })
      return
    }

    try {
      const storage = await chrome.storage.local.get(null)
      const backup: FullStorageBackup = {
        type: 'chat4o-full-storage-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        storage
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadJsonFile(`chat4o-backup-${timestamp}.json`, backup)
      setPackageImportStatus({ kind: 'success', message: '完整备份已导出，请妥善保管该私密文件' })
    } catch (error) {
      console.error('[SettingsPanel] Failed to export full backup', error)
      setPackageImportStatus({ kind: 'error', message: '完整备份导出失败，请重试' })
    }
  }

  const importFullBackup = async (files?: FileList | null) => {
    const file = files?.[0]
    if (!file || restoringFullBackup) return
    if (file.size > 50 * 1024 * 1024) {
      setPackageImportStatus({ kind: 'error', message: '备份文件超过 50MB，无法导入' })
      return
    }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setPackageImportStatus({ kind: 'error', message: '当前浏览器不支持完整备份' })
      return
    }

    setRestoringFullBackup(true)
    setPackageImportStatus(null)
    try {
      const backup = parseFullStorageBackup(await file.text())
      await chrome.storage.local.set(backup.storage)
      setPackageImportStatus({ kind: 'success', message: '完整备份已导入，正在刷新资料' })
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      console.error('[SettingsPanel] Failed to import full backup', error)
      setPackageImportStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '完整备份导入失败'
      })
    } finally {
      setRestoringFullBackup(false)
      if (fullBackupInputRef.current) fullBackupInputRef.current.value = ''
    }
  }

  const saveProductProfileName = () => {
    const name = profileNameDraft.trim()
    if (!name) return
    if (profileEditorMode === 'create') {
      createProductProfile(name)
      setPackageImportStatus({ kind: 'success', message: `已创建“${name}”` })
    } else if (profileEditorMode === 'rename') {
      renameProductProfile(activeProductProfileId, name)
      setPackageImportStatus({ kind: 'success', message: `已重命名为“${name}”` })
    }
    setProfileEditorMode(null)
    setProfileNameDraft('')
  }

  const removeActiveProductProfile = async () => {
    if (productProfiles.length <= 1) {
      setPackageImportStatus({ kind: 'error', message: '至少需要保留一个产品档案' })
      return
    }
    const current = productProfiles.find((profile) => profile.id === activeProductProfileId)
    const storedAssetKeys = [
      current?.profile.logoImageUrl,
      current?.profile.screenshotImageUrl,
      current?.profile.promoImageUrl,
      current?.profile.bannerImageUrl,
      ...(current?.profile.galleryImageUrls || [])
    ]
      .filter(isStoredAssetReference)
      .map((reference) => storedAssetStorageKey(assetIdFromReference(reference)))
    if (storedAssetKeys.length > 0 && typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(Array.from(new Set(storedAssetKeys))).catch(() => undefined)
    }
    deleteProductProfile(activeProductProfileId)
    setConfirmingProfileDelete(false)
    setPackageImportStatus({ kind: 'success', message: '产品档案已删除' })
  }

  const openImagePicker = (key: ProductAssetProfileKey) => {
    if (uploadingAsset || uploadingGalleryIndex !== null) return

    const input = assetInputRefs.current[key]
    if (!input) {
      setAssetFeedbackMessage(key, {
        kind: 'error',
        message: '图片选择器没有准备好，请关闭并重新打开设置页后再试。'
      })
      return
    }

    setAssetFeedbackMessage(key)
    input.value = ''
    input.click()
  }

  const handleImageSelected = async (key: ProductAssetProfileKey, file?: File) => {
    if (!file) return

    setAssetError('')
    setAssetFeedbackMessage(key)
    if (!file.type.startsWith('image/')) {
      setAssetFeedbackMessage(key, { kind: 'error', message: '请选择 PNG、JPG、JPEG 或 WebP 图片。' })
      return
    }

    setUploadingAsset(key)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const assetId = assetIdForProfileKey(key, activeProductProfileId)
      const reference = await saveStoredAssetFile(assetId, file)
      const nextProfile = mergeProductProfile({
        ...localProductProfile,
        [key]: reference,
        ...(key === 'promoImageUrl' ? { galleryImageUrls: [reference] } : {})
      })

      // Keep the gallery reference and the profile in sync immediately. The file
      // itself stays in extension storage, so the profile remains lightweight.
      setLocalProductProfile(nextProfile)
      setProductProfile(nextProfile)
      setAssetPreviews((current) => ({
        ...current,
        [key]: { url: dataUrl, name: file.name }
      }))
      setAssetFeedbackMessage(key, { kind: 'success', message: '已保存' })
    } catch (error) {
      console.error('[ProductAssets] Failed to save selected image', error)
      const message = error instanceof Error ? error.message : ''
      setAssetFeedbackMessage(key, {
        kind: 'error',
        message: message.includes('QUOTA') || message.includes('quota')
          ? '图库空间不足，图片没有保存。请换一张更小的图片后重试。'
          : `图片没有保存成功${message ? `：${message}` : '，请换一张更小的图片后重试。'}`
      })
    } finally {
      setUploadingAsset(null)
    }
  }

  const restoreDefaultAsset = async (key: ProductAssetProfileKey) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        throw new Error('当前浏览器不支持插件图片保存')
      }

      const assetId = assetIdForProfileKey(key, activeProductProfileId)
      await chrome.storage.local.remove(storedAssetStorageKey(assetId))
      const restoredValue = activeProductProfileId === DEFAULT_PRODUCT_PROFILE_ID
        ? PRODUCT_ASSET_DEFAULTS[key]
        : ''
      const nextProfile = mergeProductProfile({
        ...localProductProfile,
        [key]: restoredValue,
        ...(key === 'promoImageUrl' ? { galleryImageUrls: [] } : {})
      })
      setLocalProductProfile(nextProfile)
      setProductProfile(nextProfile)
      setAssetError('')
      setAssetFeedbackMessage(key, {
        kind: 'success',
        message: restoredValue ? '已恢复预置图片' : '已清除'
      })
    } catch (error) {
      console.error('[ProductAssets] Failed to restore default asset', error)
      setAssetFeedbackMessage(key, { kind: 'error', message: '没有恢复成功，请关闭并重新打开插件后再试。' })
    }
  }

  const openGalleryImagePicker = (index: number) => {
    if (uploadingAsset || uploadingGalleryIndex !== null) return
    const input = galleryInputRefs.current[index]
    if (!input) {
      setGalleryFeedback((current) => ({
        ...current,
        [index]: { kind: 'error', message: '图片选择器没有准备好，请重新打开设置页后再试。' }
      }))
      return
    }
    setGalleryFeedback((current) => ({ ...current, [index]: undefined }))
    input.value = ''
    input.click()
  }

  const handleGalleryImageSelected = async (index: number, file?: File) => {
    if (!file) return
    setAssetError('')
    setGalleryFeedback((current) => ({ ...current, [index]: undefined }))
    if (!file.type.startsWith('image/')) {
      setGalleryFeedback((current) => ({
        ...current,
        [index]: { kind: 'error', message: '请选择 PNG、JPG、JPEG 或 WebP 图片。' }
      }))
      return
    }

    setUploadingGalleryIndex(index)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const reference = await saveStoredAssetFile(assetIdForGalleryImage(activeProductProfileId, index), file)
      const galleryImageUrls = [...localProductProfile.galleryImageUrls]
      while (galleryImageUrls.length <= index) galleryImageUrls.push('')
      galleryImageUrls[index] = reference
      const nextProfile = mergeProductProfile({
        ...localProductProfile,
        galleryImageUrls: galleryImageUrls.slice(0, 10),
        promoImageUrl: galleryImageUrls.find(Boolean) || ''
      })

      setLocalProductProfile(nextProfile)
      setProductProfile(nextProfile)
      setGalleryPreviews((current) => {
        const next = [...current]
        next[index] = { url: dataUrl, name: file.name }
        return next
      })
      setGalleryFeedback((current) => ({
        ...current,
        [index]: { kind: 'success', message: '已保存' }
      }))
    } catch (error) {
      console.error('[ProductAssets] Failed to save gallery image', error)
      const message = error instanceof Error ? error.message : ''
      setGalleryFeedback((current) => ({
        ...current,
        [index]: {
          kind: 'error',
          message: message.includes('QUOTA') || message.includes('quota')
            ? '图库空间不足，请换一张更小的图片。'
            : `图片没有保存成功${message ? `：${message}` : '，请换一张更小的图片后重试。'}`
        }
      }))
    } finally {
      setUploadingGalleryIndex(null)
    }
  }

  const clearGalleryImage = async (index: number) => {
    try {
      const currentReference = localProductProfile.galleryImageUrls[index]
      if (isStoredAssetReference(currentReference) && typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(storedAssetStorageKey(assetIdFromReference(currentReference)))
      }
      const galleryImageUrls = [...localProductProfile.galleryImageUrls]
      galleryImageUrls[index] = ''
      while (galleryImageUrls[galleryImageUrls.length - 1] === '') galleryImageUrls.pop()
      const nextProfile = mergeProductProfile({
        ...localProductProfile,
        galleryImageUrls,
        promoImageUrl: galleryImageUrls.find(Boolean) || ''
      })
      setLocalProductProfile(nextProfile)
      setProductProfile(nextProfile)
      setGalleryPreviews((current) => {
        const next = [...current]
        next[index] = { url: '', name: '' }
        return next
      })
      setGalleryFeedback((current) => ({
        ...current,
        [index]: { kind: 'success', message: '已清除' }
      }))
    } catch (error) {
      console.error('[ProductAssets] Failed to clear gallery image', error)
      setGalleryFeedback((current) => ({
        ...current,
        [index]: { kind: 'error', message: '没有清除成功，请重新打开插件后再试。' }
      }))
    }
  }

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang)
  }

  return (
    <div className="p-4 space-y-6">
      <section className="sticky top-0 z-30 -mx-2 space-y-2 border-b border-slate-200 bg-white/95 px-2 pb-3 pt-1 backdrop-blur">
        <div className="flex items-center gap-2">
          <select
            value={activeProductProfileId}
            onChange={(event) => {
              switchProductProfile(event.target.value)
              setProfileEditorMode(null)
              setConfirmingProfileDelete(false)
              setPackageImportStatus(null)
            }}
            aria-label="当前产品档案"
            className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          >
            {productProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setProfileEditorMode('create')
              setProfileNameDraft('')
              setConfirmingProfileDelete(false)
            }}
            title="新建产品档案"
            aria-label="新建产品档案"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xl text-slate-600 hover:bg-slate-50"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              const current = productProfiles.find((profile) => profile.id === activeProductProfileId)
              setProfileEditorMode('rename')
              setProfileNameDraft(current?.name || localProductProfile.productName)
              setConfirmingProfileDelete(false)
            }}
            title="重命名当前档案"
            aria-label="重命名当前档案"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-base text-slate-600 hover:bg-slate-50"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => {
              if (productProfiles.length <= 1) {
                setPackageImportStatus({ kind: 'error', message: '至少需要保留一个产品档案' })
                return
              }
              setProfileEditorMode(null)
              setConfirmingProfileDelete(true)
            }}
            title="删除当前档案"
            aria-label="删除当前档案"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white text-xl text-red-500 hover:bg-red-50"
          >
            ×
          </button>
        </div>

        {profileEditorMode && (
          <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <input
              autoFocus
              value={profileNameDraft}
              onChange={(event) => setProfileNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveProductProfileName()
                if (event.key === 'Escape') setProfileEditorMode(null)
              }}
              placeholder={profileEditorMode === 'create' ? '输入新产品名称' : '输入档案名称'}
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="button"
              disabled={!profileNameDraft.trim()}
              onClick={saveProductProfileName}
              className="h-9 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setProfileEditorMode(null)}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        )}

        {confirmingProfileDelete && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2">
            <p className="min-w-0 flex-1 text-xs leading-4 text-red-700">
              删除“{productProfiles.find((profile) => profile.id === activeProductProfileId)?.name || '当前产品'}”？
            </p>
            <button
              type="button"
              onClick={() => void removeActiveProductProfile()}
              className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
            >
              删除
            </button>
            <button
              type="button"
              onClick={() => setConfirmingProfileDelete(false)}
              className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              取消
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={packageJsonInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void importPromotionPackage(event.target.files)}
          />
          <input
            ref={packageFolderInputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={(event) => void importPromotionPackage(event.target.files)}
          />
          <button
            type="button"
            disabled={importingPackage}
            onClick={() => packageJsonInputRef.current?.click()}
            className="h-9 flex-1 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {importingPackage ? '导入中...' : '导入 JSON'}
          </button>
          <button
            type="button"
            disabled={importingPackage}
            onClick={() => packageFolderInputRef.current?.click()}
            className="h-9 flex-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            导入推广包文件夹
          </button>
        </div>

        <div className="flex gap-2">
          <input
            ref={fullBackupInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void importFullBackup(event.target.files)}
          />
          <button
            type="button"
            disabled={restoringFullBackup}
            onClick={() => void exportFullBackup()}
            className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            导出完整备份
          </button>
          <button
            type="button"
            disabled={restoringFullBackup}
            onClick={() => fullBackupInputRef.current?.click()}
            className="h-9 flex-1 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {restoringFullBackup ? '导入中...' : '导入完整备份'}
          </button>
        </div>

        {packageImportStatus && (
          <p className={`rounded-md px-2.5 py-2 text-[11px] leading-4 ${
            packageImportStatus.kind === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}>
            {packageImportStatus.message}
          </p>
        )}
      </section>

      <div>
        <h2 className="text-lg font-semibold text-slate-800">推广资料</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          这里的内容既可直接复制提交，也会作为自动填表的资料来源。
        </p>
      </div>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-slate-700">
          调整字段顺序
          <span className="ml-2 text-[11px] font-normal text-slate-400">拖住左侧手柄排序</span>
        </summary>
        <div className="space-y-2 border-t border-slate-200 p-3">
          <p className="text-[11px] leading-4 text-slate-500">
            删除只会把字段从当前资料页隐藏，不会清掉已经保存的内容；下方可以恢复。
          </p>
          <div className="space-y-2 border-b border-slate-200 pb-3">
            <div>
              <div className="text-xs font-medium text-slate-700">跨指纹浏览器复用</div>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                只复制字段名称、说明、顺序和隐藏状态，不会复制邮箱、密码或其他字段内容。
              </p>
            </div>
            <button
              type="button"
              onClick={applyDefaultProductFieldLayout}
              className="w-full rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              应用新版默认布局
            </button>
            <p className="text-[11px] leading-4 text-slate-500">
              适用于已经保存过旧布局的浏览器。现有内容不会删除，多出来的自定义字段会保留在“已隐藏字段”中。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copyProductFieldLayout()}
                className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                复制字段布局
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLayoutImport((current) => !current)
                  setLayoutStatus(null)
                }}
                className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {showLayoutImport ? '收起导入' : '导入字段布局'}
              </button>
            </div>
            {showLayoutImport && (
              <div className="space-y-2">
                <textarea
                  value={layoutImportText}
                  onChange={(event) => setLayoutImportText(event.target.value)}
                  placeholder="在新指纹浏览器中，将复制的字段布局粘贴到这里"
                  className="min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={applyProductFieldLayout}
                  disabled={!layoutImportText.trim()}
                  className="w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  应用字段布局
                </button>
              </div>
            )}
            {layoutStatus && (
              <p className={`text-[11px] leading-4 ${
                layoutStatus.kind === 'success' ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {layoutStatus.message}
              </p>
            )}
          </div>
          {profileFieldItems.map((item) => (
            <div
              key={item.id}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTargetFieldId(item.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain') || draggedFieldId
                if (sourceId) reorderProfileFields(sourceId, item.id)
                setDraggedFieldId(null)
                setDropTargetFieldId(null)
              }}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                draggedFieldId === item.id
                  ? 'border-blue-300 bg-blue-50 opacity-60'
                  : dropTargetFieldId === item.id
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <span
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                  setDraggedFieldId(item.id)
                }}
                onDragEnd={() => {
                  setDraggedFieldId(null)
                  setDropTargetFieldId(null)
                }}
                title="拖住这里移动字段"
                className="cursor-grab select-none rounded px-1 text-sm font-bold tracking-widest text-slate-400 active:cursor-grabbing"
              >
                :::
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                {item.kind === 'standard' ? item.field.label : item.field.label || '未命名字段'}
              </span>
              <button
                type="button"
                onClick={() => hideProfileField(item.id)}
                className="h-7 rounded-md border border-red-200 bg-white px-2 text-[11px] text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          ))}

          {hiddenProfileFieldItems.length > 0 && (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-xs font-medium text-slate-600">已隐藏字段</p>
              {hiddenProfileFieldItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {item.kind === 'standard' ? item.field.label : item.field.label || '未命名字段'}
                  </span>
                  <button
                    type="button"
                    onClick={() => restoreProfileField(item.id)}
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      <section className="space-y-3">
        {profileFieldItems.map((item) => {
          if (item.kind === 'custom') {
            return (
              <div key={item.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={item.field.label}
                    onChange={(event) => updateCustomField(item.field.id, { label: event.target.value })}
                    placeholder="字段名称，例如 Founder"
                    aria-label="自定义字段名称"
                    style={{ width: customFieldLabelInputWidth(item.field.label) }}
                    className="min-w-0 max-w-[65%] shrink-0 border-0 bg-transparent p-0 text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400 focus:text-blue-700"
                  />
                  {renderCopyButton(item.id, item.field.label || '自定义字段', item.field.value)}
                  {renderDescriptionButton(item)}
                  <span className="min-w-0 flex-1" />
                  <button
                    type="button"
                    onClick={() => removeCustomField(item.field.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sm leading-none text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="删除自定义字段"
                    aria-label="删除自定义字段"
                  >
                    ×
                  </button>
                </div>
                {renderFieldDescription(item)}
                <Input
                  type="text"
                  value={item.field.value}
                  onChange={(event) => updateCustomField(item.field.id, { value: event.target.value })}
                  placeholder="填写要复制和自动匹配的内容"
                  className="w-full text-sm"
                />
              </div>
            )
          }

          const field = item.field
          return (
            <div key={item.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <label className="min-w-0 text-xs font-medium text-slate-700">
                  {field.label}
                </label>
                {renderCopyButton(item.id, field.label, localProductProfile[field.key])}
                {renderDescriptionButton(item)}
              </div>
              {renderFieldDescription(item)}
              {field.multiline ? (
                <textarea
                  value={localProductProfile[field.key]}
                  onChange={(event) => updateProductProfile(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="w-full min-h-20 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                />
              ) : (
                <Input
                  type="text"
                  value={localProductProfile[field.key]}
                  onChange={(event) => updateProductProfile(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="w-full text-sm"
                />
              )}
            </div>
          )
        })}
      </section>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-slate-700">
          添加自定义字段
          <span className="ml-2 text-[11px] font-normal text-slate-400">例如 Founder、价格、公司地址</span>
        </summary>
        <div className="space-y-3 border-t border-slate-200 p-3">
          <Input
            type="text"
            value={newCustomFieldLabel}
            onChange={(event) => setNewCustomFieldLabel(event.target.value)}
            placeholder="字段名称"
            className="w-full text-sm"
          />
          <Input
            type="text"
            value={newCustomFieldValue}
            onChange={(event) => setNewCustomFieldValue(event.target.value)}
            placeholder="字段内容"
            className="w-full text-sm"
          />
          {customFieldError && (
            <p className="text-xs text-red-600">{customFieldError}</p>
          )}
          <Button onClick={addCustomField} className="w-full">添加到资料页</Button>
        </div>
      </details>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">图库</h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            图片会在遇到上传框时自动使用。
          </p>
        </div>

        {assetError && (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{assetError}</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {productAssetFields.map((assetField) => {
            const preview = assetPreviews[assetField.key]
            const hasAsset = Boolean(localProductProfile[assetField.key])
            const isUploading = uploadingAsset === assetField.key
            const feedback = assetFeedback[assetField.key]

            return (
              <div key={assetField.key} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <div className="aspect-[4/3] bg-slate-100">
                  {preview?.url ? (
                    <img
                      src={preview.url}
                      alt={assetField.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-slate-400">
                      暂无预览
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-2">
                  <p className="text-xs font-semibold text-slate-800">{assetField.label}</p>
                  <p className="min-h-8 text-[10px] leading-4 text-slate-500">{assetField.description}</p>
                  <p className="truncate text-[10px] text-slate-400" title={preview?.name || ''}>
                    {preview?.name || '加载中...'}
                  </p>
                  {feedback && (
                    <p className={`min-h-4 text-[10px] leading-4 ${
                      feedback.kind === 'error' ? 'text-red-600' : 'text-emerald-600'
                    }`}>
                      {feedback.message}
                    </p>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      ref={(element) => {
                        assetInputRefs.current[assetField.key] = element
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        void handleImageSelected(assetField.key, file)
                        event.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      disabled={Boolean(uploadingAsset) || uploadingGalleryIndex !== null}
                      onClick={() => openImagePicker(assetField.key)}
                      className="flex h-7 flex-1 items-center justify-center rounded-md bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isUploading ? '保存中...' : '选择图片'}
                    </button>
                    {hasAsset && (
                      <button
                        type="button"
                        onClick={() => void restoreDefaultAsset(assetField.key)}
                        className="h-7 rounded-md border border-slate-200 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                        title={activeProductProfileId === DEFAULT_PRODUCT_PROFILE_ID
                          ? '恢复为项目内预置图片'
                          : '清除当前产品的这张图片'}
                      >
                        {activeProductProfileId === DEFAULT_PRODUCT_PROFILE_ID ? '还原' : '清除'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {galleryAssetFields.map((assetField) => {
            const preview = galleryPreviews[assetField.index]
            const hasAsset = Boolean(localProductProfile.galleryImageUrls[assetField.index])
            const isUploading = uploadingGalleryIndex === assetField.index
            const feedback = galleryFeedback[assetField.index]

            return (
              <div key={assetField.label} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <div className="aspect-[4/3] bg-slate-100">
                  {preview?.url ? (
                    <img
                      src={preview.url}
                      alt={assetField.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-slate-400">
                      暂无预览
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-2">
                  <p className="text-xs font-semibold text-slate-800">{assetField.label}</p>
                  <p className="min-h-8 text-[10px] leading-4 text-slate-500">{assetField.description}</p>
                  <p className="truncate text-[10px] text-slate-400" title={preview?.name || ''}>
                    {preview?.name || '未选择'}
                  </p>
                  {feedback && (
                    <p className={`min-h-4 text-[10px] leading-4 ${
                      feedback.kind === 'error' ? 'text-red-600' : 'text-emerald-600'
                    }`}>
                      {feedback.message}
                    </p>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      ref={(element) => {
                        galleryInputRefs.current[assetField.index] = element
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        void handleGalleryImageSelected(assetField.index, file)
                        event.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      disabled={Boolean(uploadingAsset) || uploadingGalleryIndex !== null}
                      onClick={() => openGalleryImagePicker(assetField.index)}
                      className="flex h-7 flex-1 items-center justify-center rounded-md bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isUploading ? '保存中...' : '选择图片'}
                    </button>
                    {hasAsset && (
                      <button
                        type="button"
                        onClick={() => void clearGalleryImage(assetField.index)}
                        className="h-7 rounded-md border border-slate-200 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-slate-700">
          API 与界面设置
          <span className="ml-2 text-[11px] font-normal text-slate-400">不常修改</span>
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">{t('settings.apiKey')}</label>
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
            <label className="block text-xs font-medium text-slate-700 mb-1.5">{t('settings.apiBaseURL')}</label>
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
            <label className="block text-xs font-medium text-slate-700 mb-1.5">{t('settings.model')}</label>
            <Input
              list="available-models"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              placeholder="Type or select a model"
              className="w-full text-sm"
            />
            <datalist id="available-models">
              {AVAILABLE_MODELS.map((modelOption) => (
                <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">{t('settings.language')}</label>
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

          <Button onClick={handleSaveConnectionSettings} className="w-full">
            {connectionSaved ? t('common.saved') : '保存连接设置'}
          </Button>
          <p className="text-[11px] text-slate-500">{t('settings.version')} · {t('settings.poweredBy')}</p>
        </div>
      </details>
    </div>
  )
}
