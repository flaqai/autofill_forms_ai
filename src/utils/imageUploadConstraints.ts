export type ImagePurpose = 'logo' | 'screenshot' | 'banner' | 'gallery' | 'image'

export interface ImageDimensions {
  width: number
  height: number
}

export interface ImageUploadConstraints {
  purpose: ImagePurpose
  acceptMimeTypes: string[]
  maxBytes?: number
  maxDimensions?: ImageDimensions
  minDimensions?: ImageDimensions
  recommendedDimensions?: ImageDimensions
  sourceText: string
}

const MIME_BY_TOKEN: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function inferPurpose(text: string): ImagePurpose {
  if (/\b(logo|icon|avatar|brand mark|app icon)\b|图标|圖標|徽标|標誌/.test(text)) return 'logo'
  if (/\b(banner|cover|hero|header|wide image)\b|横幅|橫幅|封面/.test(text)) return 'banner'
  if (/\b(screenshot|screen shot|website shot|screen capture)\b|截图|截圖/.test(text)) return 'screenshot'
  if (/\b(gallery|product image|promo|promotional|media)\b|图库|圖庫|宣传图|宣傳圖/.test(text)) return 'gallery'
  return 'image'
}

function parseAcceptMimeTypes(accept: string, text: string) {
  const mimeTypes = new Set<string>()
  const acceptTokens = accept.toLowerCase().split(',').map((token) => token.trim())

  acceptTokens.forEach((token) => {
    if (token === 'image/*') {
      Object.values(MIME_BY_TOKEN).forEach((mimeType) => mimeTypes.add(mimeType))
      return
    }

    if (token.startsWith('image/')) {
      if (token === 'image/jpg') mimeTypes.add('image/jpeg')
      else if (['image/jpeg', 'image/png', 'image/webp'].includes(token)) mimeTypes.add(token)
      return
    }

    const extension = token.replace(/^\./, '')
    if (MIME_BY_TOKEN[extension]) mimeTypes.add(MIME_BY_TOKEN[extension])
  })

  if (mimeTypes.size === 0) {
    Object.entries(MIME_BY_TOKEN).forEach(([token, mimeType]) => {
      if (new RegExp(`\\b${token}\\b`, 'i').test(text)) mimeTypes.add(mimeType)
    })
  }

  return Array.from(mimeTypes)
}

function dimensionContext(
  text: string,
  start: number,
  end: number,
  beforeLength = 55,
  afterLength = 30
) {
  return text.slice(
    Math.max(0, start - beforeLength),
    Math.min(text.length, end + afterLength)
  )
}

function classifyDimensionContext(context: string) {
  if (/\b(max|maximum|at most|no more than|up to)\b|最大|不超过|不得超过/.test(context)) return 'max'
  if (/\b(min|minimum|at least|no less than|required)\b|最小|至少|不得低于/.test(context)) return 'min'
  if (/\b(recommend|recommended|preferred|ideal|suggested)\b|推荐|建議|建议/.test(context)) return 'recommended'
  return undefined
}

function classifyDimensions(text: string, start: number, end: number) {
  const before = text.slice(Math.max(0, start - 55), start)
  const after = text.slice(end, Math.min(text.length, end + 30))
  return classifyDimensionContext(before) || classifyDimensionContext(after)
}

function setMostRestrictiveDimension(
  current: ImageDimensions | undefined,
  candidate: ImageDimensions,
  kind: 'max' | 'min' | 'recommended'
) {
  if (!current) return candidate

  if (kind === 'max') {
    return {
      width: Math.min(current.width, candidate.width),
      height: Math.min(current.height, candidate.height)
    }
  }

  if (kind === 'min') {
    return {
      width: Math.max(current.width, candidate.width),
      height: Math.max(current.height, candidate.height)
    }
  }

  return current
}

function parseFileSize(text: string) {
  const sizePattern = /(\d+(?:\.\d+)?)\s*(kib|kb|mib|mb)\b/gi
  let maxBytes: number | undefined

  for (const match of text.matchAll(sizePattern)) {
    const index = match.index ?? 0
    const context = dimensionContext(text, index, index + match[0].length, 45, 25)
    if (/\b(min|minimum|at least|no less than)\b|最小|至少/.test(context)) continue
    if (!/\b(max|maximum|less than|under|up to|file size|size limit|each)\b|最大|小于|小於|不超过|文件大小|檔案大小|每张|每張/.test(context)) {
      continue
    }

    const amount = Number(match[1])
    const unit = match[2].toLowerCase()
    const multiplier = unit.startsWith('m') ? 1024 * 1024 : 1024
    const bytes = Math.floor(amount * multiplier)
    maxBytes = maxBytes === undefined ? bytes : Math.min(maxBytes, bytes)
  }

  return maxBytes
}

export function parseImageUploadConstraints(
  sourceText: string,
  accept = ''
): ImageUploadConstraints {
  const normalizedText = compact(sourceText.toLowerCase().replace(/[×✕]/g, 'x'))
  const constraints: ImageUploadConstraints = {
    purpose: inferPurpose(normalizedText),
    acceptMimeTypes: parseAcceptMimeTypes(accept, normalizedText),
    maxBytes: parseFileSize(normalizedText),
    sourceText: compact(sourceText)
  }

  const dimensionPattern = /(\d{2,5})\s*(?:px)?\s*x\s*(\d{2,5})\s*(?:px)?/gi
  for (const match of normalizedText.matchAll(dimensionPattern)) {
    const width = Number(match[1])
    const height = Number(match[2])
    if (width < 32 || height < 32) continue

    const index = match.index ?? 0
    const kind = classifyDimensions(normalizedText, index, index + match[0].length)
    if (!kind) continue

    const dimensions = { width, height }
    if (kind === 'max') {
      constraints.maxDimensions = setMostRestrictiveDimension(constraints.maxDimensions, dimensions, kind)
    } else if (kind === 'min') {
      constraints.minDimensions = setMostRestrictiveDimension(constraints.minDimensions, dimensions, kind)
    } else {
      constraints.recommendedDimensions = setMostRestrictiveDimension(
        constraints.recommendedDimensions,
        dimensions,
        kind
      )
    }
  }

  return constraints
}

export function hasActionableImageConstraints(constraints: ImageUploadConstraints) {
  return Boolean(
    constraints.acceptMimeTypes.length ||
    constraints.maxBytes ||
    constraints.maxDimensions ||
    constraints.minDimensions ||
    constraints.recommendedDimensions
  )
}
