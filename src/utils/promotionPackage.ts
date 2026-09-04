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

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) || {}
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : []
      if (typeof item === 'number' && Number.isFinite(item)) return [String(item)]
      if (isRecord(item)) {
        const text = firstString(item.name, item.label, item.value, item.slug)
        return text ? [text] : []
      }
      return []
    })
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function joinedValue(value: unknown) {
  return stringList(value).join(', ')
}

function splitFullName(value: unknown) {
  const parts = firstString(value).split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.at(-1) || ''
  }
}

const CREDENTIAL_FIELD_PATTERN = /(?:password|passcode|passphrase|api[\s_-]*key|access[\s_-]*token|auth(?:entication|orization)?[\s_-]*(?:token|code|secret)|bearer[\s_-]*token|client[\s_-]*secret|login[\s_-]*(?:secret|credential)|private[\s_-]*key|密码|口令|访问令牌|密钥|私钥)/i
const CREDENTIAL_LINE_PATTERN = /^\s*(?:password|passcode|passphrase|api[\s_-]*key|access[\s_-]*token|auth(?:entication|orization)?[\s_-]*(?:token|code|secret)|bearer[\s_-]*token|client[\s_-]*secret|login[\s_-]*(?:secret|credential)|private[\s_-]*key|密码|口令|访问令牌|密钥|私钥)(?:\s*[:：=-]|\s+)/i

function isCredentialField(...values: unknown[]) {
  return CREDENTIAL_FIELD_PATTERN.test(values.map((value) => firstString(value)).join(' '))
}

function sanitizedExtraInfo(value: unknown) {
  return firstString(value)
    .split(/\r?\n/)
    .filter((line) => !CREDENTIAL_LINE_PATTERN.test(line))
    .join('\n')
    .trim()
}

function addressComponent(value: unknown) {
  if (!isRecord(value)) return firstString(value)
  return firstString(
    value.name,
    value.fullName,
    value.shortName,
    value.label,
    value.value,
    value.code,
    value.iso2,
    value.iso3,
    value.alpha2,
    value.alpha3
  )
}

function firstAddressComponent(...values: unknown[]) {
  for (const value of values) {
    const component = addressComponent(value)
    if (component) return component
  }
  return ''
}

function phoneComponent(...values: unknown[]) {
  for (const value of values) {
    if (!isRecord(value)) {
      const phone = firstString(value)
      if (phone) return phone
      continue
    }
    const phone = firstString(
      value.e164,
      value.international,
      value.internationalNumber,
      value.full,
      value.number,
      value.phoneNumber,
      value.national,
      value.value
    )
    if (phone) return phone
  }
  return ''
}

function addressDetails(source: UnknownRecord, company: UnknownRecord) {
  const candidate = [
    source.companyAddress,
    source.businessAddress,
    source.registeredAddress,
    source.registeredOfficeAddress,
    source.officeAddress,
    source.physicalAddress,
    source.mailingAddress,
    source.headquarters,
    source.address,
    company.address,
    company.registeredAddress,
    company.registeredOfficeAddress,
    company.officeAddress,
    company.headquarters
  ].find((value) => (
    (typeof value === 'string' && Boolean(value.trim()))
    || (isRecord(value) && Object.keys(value).length > 0)
  ))
  const address = isRecord(candidate) ? candidate : {}
  const line1 = firstString(
    address.addressLine1,
    address.address_line_1,
    address.address1,
    address.line1,
    address.streetAddress,
    address.street,
    source.addressLine1,
    source.address_line_1,
    source.address1,
    source.streetAddress,
    company.addressLine1,
    company.streetAddress
  )
  const line2 = firstString(
    address.addressLine2,
    address.address_line_2,
    address.address2,
    address.line2,
    address.unit,
    address.suite,
    source.addressLine2,
    source.address_line_2,
    source.address2,
    company.addressLine2
  )
  const city = firstAddressComponent(
    address.city,
    address.locality,
    address.town,
    address.municipality,
    source.companyCity,
    source.businessCity,
    source.city,
    source.locality,
    source.town,
    company.city,
    company.locality
  )
  const state = firstAddressComponent(
    address.state,
    address.stateProvince,
    address.province,
    address.region,
    address.county,
    source.companyState,
    source.businessState,
    source.state,
    source.stateProvince,
    source.province,
    source.region,
    company.state,
    company.province,
    company.region
  )
  const postcode = firstAddressComponent(
    address.postcode,
    address.postalCode,
    address.postal_code,
    address.postal,
    address.zipCode,
    address.zip_code,
    address.zipcode,
    address.zip,
    source.companyPostcode,
    source.businessPostcode,
    source.postcode,
    source.postalCode,
    source.postal_code,
    source.postal,
    source.zipCode,
    source.zip_code,
    source.zipcode,
    source.zip,
    company.postcode,
    company.postalCode,
    company.zipCode
  )
  const country = firstAddressComponent(
    address.country,
    address.countryName,
    address.countryCode,
    address.country_code,
    address.countryOrRegion,
    address.country_region,
    address.isoCountryCode,
    address.isoCountry,
    address.nation,
    source.companyCountry,
    source.businessCountry,
    source.country,
    source.countryName,
    source.countryCode,
    source.country_code,
    source.countryOrRegion,
    source.country_region,
    source.isoCountryCode,
    source.isoCountry,
    source.nation,
    company.country,
    company.countryName,
    company.countryCode,
    company.country_code,
    company.countryOrRegion,
    company.country_region,
    company.isoCountryCode
  )
  const explicitFullAddress = isRecord(candidate)
    ? firstString(address.full, address.formatted, address.formattedAddress, address.displayAddress, address.text)
    : firstString(candidate)
  const composedFullAddress = Array.from(new Set([line1, line2, city, state, postcode, country].filter(Boolean))).join(', ')

  return {
    fullAddress: explicitFullAddress || composedFullAddress,
    line1,
    line2,
    city,
    state,
    postcode,
    country
  }
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

function customFieldsFromSource(source: UnknownRecord, company: UnknownRecord) {
  const imported = Array.isArray(source.customFields)
    ? source.customFields.filter(isRecord).map((field, index): CustomProfileField => {
        const id = firstString(field.id) || `imported-${index + 1}`
        const isDefaultListingPassword = id === 'default-password'
        const isCredential = isCredentialField(field.id, field.label, field.name)

        return {
          id,
          label: firstString(field.label, field.name),
          value: isCredential && !isDefaultListingPassword ? '' : firstString(field.value, field.text),
          description: isCredential && !isDefaultListingPassword ? '' : firstString(field.description)
        }
      }).filter((field) => field.label)
    : []

  const address = addressDetails(source, company)
  const knownCustomFields: Array<[string, unknown, string, string]> = [
    [
      'default-password',
      source.password,
      '密码',
      '用于目录站要求创建的条目管理密码，例如后续编辑或删除 listing 的密码；不要用于网站账号登录密码。'
    ],
    ['default-company-address', address.fullAddress, '公司地址', '公司公开业务地址。'],
    ['company-address-line-1', address.line1, 'Address line 1', 'Street address or first address line.'],
    ['company-address-line-2', address.line2, 'Address line 2', 'Suite, unit, building, or second address line.'],
    ['company-city', address.city, 'City', 'City, town, or locality for the company address.'],
    ['company-state-region', address.state, 'State/Province/Region', 'State, province, region, or county for the company address.'],
    ['default-postcode', address.postcode, 'Postcode/ZIP code', 'Postal code or ZIP code for the company address.'],
    ['company-country', address.country, 'Country', 'Country or territory for the company address.'],
    [
      'default-company-founded-date',
      source.foundingYear || source.foundedYear || source.yearFounded || source.establishedYear || source.founded || source.launchDate || company.foundingYear || company.foundedYear,
      '公司建立时间',
      '公司或产品成立、创立的年份或日期。'
    ]
  ]

  for (const [id, value, label, description] of knownCustomFields) {
    const normalizedValue = firstString(value)
    if (!normalizedValue) continue
    const existing = imported.find((field) => (
      field.id.trim().toLowerCase() === id.toLowerCase()
      || field.label.trim().toLowerCase() === label.toLowerCase()
    ))
    if (existing) {
      existing.value ||= normalizedValue
      existing.description ||= description
      continue
    }
    imported.push({ id, label, value: normalizedValue, description })
  }

  return imported
}

function profileFromManifest(root: UnknownRecord) {
  const sourceCandidate = root.profile || root.productProfile || root.product
  const source = isRecord(sourceCandidate) ? sourceCandidate : root
  const socials = isRecord(source.socials) ? source.socials : {}
  const links = isRecord(source.links) ? source.links : {}
  const company = firstRecord(source.company, source.organization, root.company, root.organization)
  const contact = firstRecord(source.contact, source.contactPerson, source.primaryContact, root.contact)
  const fullName = splitFullName(
    source.contactFullName
      || source.contactName
      || source.fullName
      || source.ownerName
      || source.founderName
      || contact.fullName
      || contact.name
  )
  const contactName = isCredentialField(source.contactFirstName, source.firstName, contact.firstName, contact.givenName)
    ? { firstName: '', lastName: '' }
    : fullName
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
    companyName: firstString(source.companyName, source.legalCompanyName, company.name, company.legalName),
    companyWebsite: firstString(source.companyWebsite, source.companyDomain, company.website, company.websiteUrl, company.domain),
    companyPhone: phoneComponent(
      source.companyPhone,
      source.businessPhone,
      source.workPhone,
      source.phone,
      source.phoneNumber,
      source.telephone,
      source.telephoneNumber,
      source.businessTelephone,
      source.tel,
      source.mobile,
      source.mobilePhone,
      source.contactNumber,
      source.whatsapp,
      company.phone,
      company.phoneNumber,
      company.telephone,
      company.businessPhone,
      contact.phone,
      contact.phoneNumber,
      contact.telephone,
      contact.mobile,
      contact.mobilePhone,
      contact.contactNumber,
      contact.whatsapp
    ),
    contactEmail: firstString(source.contactEmail, source.submissionEmail, source.emailAddress, contact.email, contact.emailAddress),
    companyEmail: firstString(source.companyEmail, source.businessEmail, source.supportEmail, company.email, company.emailAddress),
    contactFirstName: firstString(source.contactFirstName, source.firstName, contact.firstName, contact.givenName, contactName.firstName),
    contactLastName: firstString(source.contactLastName, source.lastName, contact.lastName, contact.familyName, contact.surname, contactName.lastName),
    privacyPolicyUrl: firstString(source.privacyPolicyUrl, source.privacyUrl, links.privacy),
    termsUrl: firstString(source.termsUrl, source.termsOfServiceUrl, links.terms),
    twitterUrl: firstString(source.twitterUrl, source.xUrl, socials.twitter, socials.x),
    linkedinUrl: firstString(source.linkedinUrl, socials.linkedin),
    githubUrl: firstString(source.githubUrl, socials.github),
    keywords: joinedValue(source.keywords) || joinedValue(source.seoKeywords),
    tags: joinedValue(source.tags) || joinedValue(source.submissionTags),
    extraInfo: sanitizedExtraInfo(source.extraInfo || source.additionalInformation),
    lockedFields: firstString(source.lockedFields),
    fieldDescriptions: isRecord(source.fieldDescriptions)
      ? Object.fromEntries(Object.entries(source.fieldDescriptions).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      : {},
    customFields: customFieldsFromSource(source, company),
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
