import type { CustomProfileField, ProductProfile } from '@/types'

export interface PromotionPackageAssetFiles {
  logo?: File
  screenshot?: File
  gallery: File[]
  banner?: File
}

export interface PromotionPackageImportResult {
  name: string
  profile: Partial<ProductProfile>
  assets: PromotionPackageAssetFiles
  manifestFileName: string
  warnings: string[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function joinedValue(value: unknown) {
  return stringList(value).join(', ')
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase()
}

function filePath(file: File) {
  return normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
}

function fileBaseName(file: File) {
  return filePath(file).split('/').pop() || file.name.toLowerCase()
}

function findFile(files: File[], requestedPath: string) {
  const normalized = normalizePath(requestedPath)
  const requestedBase = normalized.split('/').pop()
  return files.find((file) => {
    const path = filePath(file)
    return path === normalized || path.endsWith(`/${normalized}`) || fileBaseName(file) === requestedBase
  })
}

function requestedAssetPaths(value: unknown) {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : []
    if (isRecord(item)) {
      const path = firstString(item.path, item.file, item.fileName, item.src)
      return path ? [path] : []
    }
    return []
  })
}

function assetRecord(root: UnknownRecord, source: UnknownRecord) {
  const candidate = root.assets || source.assets || root.images || source.images
  return isRecord(candidate) ? candidate : {}
}

function customFieldsFromSource(source: UnknownRecord) {
  const imported = Array.isArray(source.customFields)
    ? source.customFields.filter(isRecord).map((field, index): CustomProfileField => ({
        id: firstString(field.id) || `imported-${index + 1}`,
        label: firstString(field.label, field.name),
        value: firstString(field.value, field.text),
        description: firstString(field.description)
      })).filter((field) => field.label)
    : []

  const knownCustomFields: Array<[string, unknown, string]> = [
    ['company-address', source.companyAddress || source.address, '公司地址'],
    ['company-founded-date', source.foundingYear || source.founded || source.launchDate, '公司建立时间'],
    ['postcode', source.postcode || source.zipCode || source.postalCode, 'Postcode/ZIP code']
  ]

  for (const [id, value, label] of knownCustomFields) {
    const normalizedValue = isRecord(value)
      ? firstString(value.full, value.formatted, value.addressLine, value.street)
      : firstString(value)
    if (!normalizedValue || imported.some((field) => field.label.toLowerCase() === label.toLowerCase())) continue
    imported.push({ id: `imported-${id}`, label, value: normalizedValue, description: '' })
  }

  return imported
}

function profileFromManifest(root: UnknownRecord) {
  const sourceCandidate = root.profile || root.productProfile || root.product
  const source = isRecord(sourceCandidate) ? sourceCandidate : root
  const socials = isRecord(source.socials) ? source.socials : {}
  const links = isRecord(source.links) ? source.links : {}
  const profile: Partial<ProductProfile> = {
    productName: firstString(source.productName, source.name, root.name),
    websiteUrl: firstString(source.websiteUrl, source.officialUrl, source.url, links.website),
    shortDescription: firstString(
      source.shortDescription,
      source.oneLineDescription,
      source.tagline,
      source.summary
    ),
    longDescription: firstString(source.longDescription, source.description, source.overview),
    category: firstString(source.category) || joinedValue(source.categories),
    logoUrl: firstString(source.logoUrl, source.logoIconUrl, links.logo),
    logoImageUrl: firstString(source.logoImageUrl),
    screenshotImageUrl: firstString(source.screenshotImageUrl),
    promoImageUrl: firstString(source.promoImageUrl, source.productImageUrl),
    bannerImageUrl: firstString(source.bannerImageUrl, source.coverImageUrl),
    companyName: firstString(source.companyName, source.legalCompanyName),
    companyWebsite: firstString(source.companyWebsite, source.companyDomain),
    companyPhone: firstString(source.companyPhone, source.phone),
    contactEmail: firstString(source.contactEmail, source.submissionEmail),
    companyEmail: firstString(source.companyEmail, source.supportEmail),
    contactFirstName: firstString(source.contactFirstName, source.firstName),
    contactLastName: firstString(source.contactLastName, source.lastName),
    privacyPolicyUrl: firstString(source.privacyPolicyUrl, source.privacyUrl, links.privacy),
    termsUrl: firstString(source.termsUrl, source.termsOfServiceUrl, links.terms),
    twitterUrl: firstString(source.twitterUrl, source.xUrl, socials.twitter, socials.x),
    linkedinUrl: firstString(source.linkedinUrl, socials.linkedin),
    githubUrl: firstString(source.githubUrl, socials.github),
    keywords: firstString(source.keywords) || joinedValue(source.seoKeywords),
    tags: firstString(source.tags) || joinedValue(source.submissionTags),
    extraInfo: firstString(source.extraInfo, source.additionalInformation),
    lockedFields: firstString(source.lockedFields),
    fieldDescriptions: isRecord(source.fieldDescriptions)
      ? Object.fromEntries(Object.entries(source.fieldDescriptions).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      : {},
    customFields: customFieldsFromSource(source),
    galleryImageUrls: stringList(source.galleryImageUrls)
  }

  if (!profile.companyWebsite && profile.websiteUrl) profile.companyWebsite = profile.websiteUrl
  return { profile, source }
}

function classifiedImages(files: File[]) {
  const images = files.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name))
  const byPattern = (pattern: RegExp) => images.filter((file) => pattern.test(fileBaseName(file)))
  return {
    logo: byPattern(/(?:^|[-_.])(logo|icon|avatar)(?:[-_.]|$)/i),
    screenshot: byPattern(/screenshot|screen[-_.]?shot|website[-_.]?(?:shot|screenshot)|homepage/i),
    banner: byPattern(/banner|cover|header|hero/i),
    gallery: byPattern(/gallery|feature|effect|output|result|promo|promotional|product[-_.]?(?:image|promo)|showcase/i)
  }
}

function resolveRequestedFiles(files: File[], value: unknown) {
  return requestedAssetPaths(value).map((path) => findFile(files, path)).filter((file): file is File => Boolean(file))
}

export async function parsePromotionPackageFiles(filesInput: FileList | File[]) {
  const files = Array.from(filesInput)
  if (files.length === 0) throw new Error('没有选择文件')

  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name))
  const manifest = jsonFiles.find((file) => /promotion[-_.]?(?:profile|package)|product[-_.]?profile/i.test(file.name))
    || jsonFiles[0]
  if (!manifest) {
    throw new Error('推广包中缺少 JSON 文件。请加入 promotion-profile.json 后重新导入。')
  }
  if (manifest.size > 2 * 1024 * 1024) throw new Error('推广包 JSON 文件过大')

  let root: UnknownRecord
  try {
    const parsed = JSON.parse(await manifest.text())
    if (!isRecord(parsed)) throw new Error('JSON root must be an object')
    root = parsed
  } catch {
    throw new Error('推广包 JSON 格式无法识别')
  }

  const { profile, source } = profileFromManifest(root)
  const assets = assetRecord(root, source)
  const remoteAsset = (value: unknown) => requestedAssetPaths(value)
    .find((path) => /^(https?:|data:|stored-product-asset:)/i.test(path)) || ''
  profile.logoImageUrl ||= remoteAsset(assets.logo || assets.icon)
  profile.screenshotImageUrl ||= remoteAsset(assets.screenshot || assets.websiteScreenshot)
  profile.bannerImageUrl ||= remoteAsset(assets.banner || assets.cover)
  profile.galleryImageUrls = Array.from(new Set([
    ...(profile.galleryImageUrls || []),
    ...requestedAssetPaths(assets.gallery || assets.promo || assets.productImages)
      .filter((path) => /^(https?:|data:|stored-product-asset:)/i.test(path))
  ]))
  profile.promoImageUrl ||= profile.galleryImageUrls[0] || remoteAsset(assets.promo)
  const inferred = classifiedImages(files)
  const explicitLogo = resolveRequestedFiles(files, assets.logo || assets.icon)
  const explicitScreenshot = resolveRequestedFiles(files, assets.screenshot || assets.websiteScreenshot)
  const explicitGallery = resolveRequestedFiles(files, assets.gallery || assets.promo || assets.productImages)
  const explicitBanner = resolveRequestedFiles(files, assets.banner || assets.cover)
  const logo = explicitLogo[0] || inferred.logo[0]
  const screenshot = explicitScreenshot[0] || inferred.screenshot[0]
  const banner = explicitBanner[0] || inferred.banner[0]
  const excluded = new Set([logo, screenshot, banner].filter(Boolean))
  const gallery = Array.from(new Set([...explicitGallery, ...inferred.gallery]))
    .filter((file) => !excluded.has(file))
    .slice(0, 10)
  const warnings: string[] = []
  if (!profile.productName) warnings.push('JSON 中没有产品名称')
  if (!profile.websiteUrl) warnings.push('JSON 中没有官网 URL')
  if (!logo && !profile.logoImageUrl) warnings.push('没有识别到 Logo 图片')
  if (!screenshot && !profile.screenshotImageUrl) warnings.push('没有识别到网站截图')
  if (gallery.length === 0 && !(profile.galleryImageUrls?.length || profile.promoImageUrl)) {
    warnings.push('没有识别到核心功能或产品效果图')
  }

  return {
    name: firstString(root.name, profile.productName) || manifest.name.replace(/\.json$/i, ''),
    profile,
    assets: { logo, screenshot, gallery, banner },
    manifestFileName: manifest.name,
    warnings
  } satisfies PromotionPackageImportResult
}
