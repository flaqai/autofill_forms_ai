import {
  hasActionableImageConstraints,
  parseImageUploadConstraints,
  type ImageUploadConstraints
} from '../utils/imageUploadConstraints'

export interface ImageOptimizationResult {
  file: File
  changed: boolean
  summary: string
}

interface RenderedImage {
  blob: Blob
  width: number
  height: number
  mimeType: string
  quality?: number
}

const SUPPORTED_OUTPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEFAULT_MAX_BYTES = 1024 * 1024
const MIN_COMPRESSED_QUALITY = 0.55
const MAX_COMPRESSED_QUALITY = 0.9

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function elementLabelText(element: HTMLInputElement) {
  const labels = Array.from(element.labels || [])
    .map((label) => label.innerText || label.textContent || '')
  const ariaLabelledBy = (element.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '')
  const describedBy = (element.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '')

  return [...labels, ...ariaLabelledBy, ...describedBy]
}

function nearbyUploadText(element: HTMLInputElement) {
  const values = [
    element.id,
    element.name,
    element.accept,
    element.title,
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    ...elementLabelText(element)
  ]
  const seen = new Set<Element>()
  let current: HTMLElement | null = element.parentElement

  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    if (seen.has(current)) continue
    seen.add(current)
    if (current.matches('form')) break

    const text = compact(current.innerText || current.textContent || '')
    if (text && text.length <= 1400) values.push(text)
    if (current.matches('[role="dialog"], main')) break
  }

  return compact(values.filter(Boolean).join(' '))
}

function acceptedOutputType(file: File, constraints: ImageUploadConstraints) {
  const accepted = constraints.acceptMimeTypes.filter((type) => SUPPORTED_OUTPUT_TYPES.includes(type))
  if (accepted.length === 0 || accepted.includes(file.type)) return file.type || 'image/png'

  if (constraints.purpose === 'logo' && accepted.includes('image/png')) return 'image/png'
  if (accepted.includes('image/jpeg')) return 'image/jpeg'
  if (accepted.includes('image/webp')) return 'image/webp'
  return accepted[0]
}

function compressedOutputType(file: File, constraints: ImageUploadConstraints) {
  const accepted = constraints.acceptMimeTypes.filter((type) => SUPPORTED_OUTPUT_TYPES.includes(type))
  const canUse = (mimeType: string) => accepted.length === 0 || accepted.includes(mimeType)

  if (constraints.purpose === 'logo' && canUse('image/png') && file.size <= (constraints.maxBytes || DEFAULT_MAX_BYTES)) {
    return 'image/png'
  }

  if (canUse('image/jpeg')) return 'image/jpeg'
  if (canUse('image/webp')) return 'image/webp'
  return acceptedOutputType(file, constraints)
}

function targetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  constraints: ImageUploadConstraints
) {
  let scale = 1
  const max = constraints.maxDimensions
  const min = constraints.minDimensions
  const recommended = constraints.recommendedDimensions

  if (max) {
    scale = Math.min(scale, max.width / sourceWidth, max.height / sourceHeight)
  }

  if (min) {
    const minimumScale = Math.max(min.width / sourceWidth, min.height / sourceHeight)
    scale = Math.max(scale, minimumScale)
  } else if (!max && recommended) {
    scale = Math.min(scale, recommended.width / sourceWidth, recommended.height / sourceHeight)
  }

  if (max) {
    scale = Math.min(scale, max.width / sourceWidth, max.height / sourceHeight)
  }

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Browser could not encode the optimized image.')),
      mimeType,
      quality
    )
  })
}

function drawImage(
  image: ImageBitmap,
  width: number,
  height: number,
  mimeType: string
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Browser could not create an image canvas.')

  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

async function encodeCompressed(
  image: ImageBitmap,
  width: number,
  height: number,
  mimeType: string,
  maxBytes?: number
): Promise<RenderedImage> {
  let currentWidth = width
  let currentHeight = height
  const byteTarget = maxBytes ? Math.floor(maxBytes * 0.9) : undefined
  let lastBlobSize: number | undefined

  for (let resizeAttempt = 0; resizeAttempt < 10; resizeAttempt += 1) {
    const canvas = drawImage(image, currentWidth, currentHeight, mimeType)

    if (mimeType === 'image/png') {
      const blob = await canvasToBlob(canvas, mimeType)
      lastBlobSize = blob.size
      if (!byteTarget || blob.size <= byteTarget) {
        return { blob, width: currentWidth, height: currentHeight, mimeType }
      }
    } else {
      let low = MIN_COMPRESSED_QUALITY
      let high = MAX_COMPRESSED_QUALITY
      let best: Blob | undefined
      let bestQuality = low

      for (let qualityAttempt = 0; qualityAttempt < 7; qualityAttempt += 1) {
        const quality = (low + high) / 2
        const blob = await canvasToBlob(canvas, mimeType, quality)
        lastBlobSize = blob.size

        if (!byteTarget || blob.size <= byteTarget) {
          best = blob
          bestQuality = quality
          low = quality
        } else {
          high = quality
        }
      }

      if (best) {
        return {
          blob: best,
          width: currentWidth,
          height: currentHeight,
          mimeType,
          quality: bestQuality
        }
      }
    }

    const sizeBasedScale =
      byteTarget && lastBlobSize
        ? Math.sqrt(byteTarget / lastBlobSize) * 0.96
        : 0.88
    const scale = Math.min(0.88, Math.max(0.35, sizeBasedScale))
    currentWidth = Math.max(32, Math.floor(currentWidth * scale))
    currentHeight = Math.max(32, Math.floor(currentHeight * scale))
  }

  const fallbackCanvas = drawImage(image, currentWidth, currentHeight, mimeType)
  const fallbackQuality = mimeType === 'image/png' ? undefined : MIN_COMPRESSED_QUALITY
  const blob = await canvasToBlob(fallbackCanvas, mimeType, fallbackQuality)
  return {
    blob,
    width: currentWidth,
    height: currentHeight,
    mimeType,
    quality: fallbackQuality
  }
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function optimizedFileName(fileName: string, mimeType: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'product-image'
  return `${baseName}-optimized.${extensionForMimeType(mimeType)}`
}

function shouldOptimize(
  file: File,
  width: number,
  height: number,
  constraints: ImageUploadConstraints,
  outputType: string
) {
  const max = constraints.maxDimensions
  const min = constraints.minDimensions
  const recommended = constraints.recommendedDimensions
  const exceedsMax = Boolean(max && (width > max.width || height > max.height))
  const missesMin = Boolean(min && (width < min.width || height < min.height))
  const exceedsRecommended = Boolean(
    !max && !min && recommended && (width > recommended.width || height > recommended.height)
  )
  const exceedsBytes = Boolean(constraints.maxBytes && file.size > constraints.maxBytes)
  const wrongType = Boolean(outputType && outputType !== file.type)

  return exceedsMax || missesMin || exceedsRecommended || exceedsBytes || wrongType
}

function optimizationSummary(
  original: File,
  sourceWidth: number,
  sourceHeight: number,
  rendered: RenderedImage
) {
  const originalKb = Math.ceil(original.size / 1024)
  const optimizedKb = Math.ceil(rendered.blob.size / 1024)
  const quality = rendered.quality ? `, quality ${Math.round(rendered.quality * 100)}` : ''
  return `${sourceWidth}x${sourceHeight}, ${originalKb}KB -> ${rendered.width}x${rendered.height}, ${optimizedKb}KB, ${rendered.mimeType}${quality}`
}

export async function optimizeImageForInput(
  file: File,
  input: HTMLInputElement
): Promise<ImageOptimizationResult> {
  const contextText = nearbyUploadText(input)
  const constraints = parseImageUploadConstraints(contextText, input.accept)
  if (!hasActionableImageConstraints(constraints)) {
    return { file, changed: false, summary: 'No actionable image requirements detected.' }
  }

  const image = await createImageBitmap(file)
  try {
    let outputType = acceptedOutputType(file, constraints)
    if (constraints.maxBytes && file.size > constraints.maxBytes) {
      outputType = compressedOutputType(file, constraints)
    }

    if (!shouldOptimize(file, image.width, image.height, constraints, outputType)) {
      return {
        file,
        changed: false,
        summary: `${image.width}x${image.height}, ${Math.ceil(file.size / 1024)}KB already satisfies detected requirements.`
      }
    }

    const dimensions = targetDimensions(image.width, image.height, constraints)
    const rendered = await encodeCompressed(
      image,
      dimensions.width,
      dimensions.height,
      outputType,
      constraints.maxBytes
    )
    const optimizedFile = new File(
      [rendered.blob],
      optimizedFileName(file.name, rendered.mimeType),
      { type: rendered.mimeType, lastModified: Date.now() }
    )

    return {
      file: optimizedFile,
      changed: true,
      summary: optimizationSummary(file, image.width, image.height, rendered)
    }
  } finally {
    image.close()
  }
}
