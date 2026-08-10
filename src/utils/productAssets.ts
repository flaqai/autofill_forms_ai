import type { ProductProfile } from '@/types'

export type ProductAssetProfileKey = Extract<
  keyof ProductProfile,
  'logoImageUrl' | 'screenshotImageUrl' | 'promoImageUrl' | 'bannerImageUrl'
>

export interface StoredProductAsset {
  dataUrl: string
  fileName: string
  mimeType: string
  updatedAt: number
}

export const PRODUCT_ASSET_REFERENCE_PREFIX = 'stored-product-asset://'
export const PRODUCT_ASSET_STORAGE_PREFIX = 'chat4o-product-asset:'

export const PRODUCT_ASSET_DEFAULTS: Record<ProductAssetProfileKey, string> = {
  logoImageUrl: 'product-assets/minigpt-logo-square-500x500.jpg',
  screenshotImageUrl: 'product-assets/minigpt-website-screenshot.png',
  promoImageUrl: 'product-assets/minigpt-promo-image.jpg',
  bannerImageUrl: 'product-assets/minigpt-banner-image.png'
}

function safeAssetIdPart(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'default'
}

export function assetIdForProfileKey(key: ProductAssetProfileKey, profileId = 'legacy') {
  return `profile-${safeAssetIdPart(profileId)}-${key}`
}

export function assetIdForGalleryImage(profileId: string, index: number) {
  return `profile-${safeAssetIdPart(profileId)}-gallery-${index}`
}

export function storedAssetReference(assetId: string) {
  return `${PRODUCT_ASSET_REFERENCE_PREFIX}${assetId}`
}

export function isStoredAssetReference(
  value: unknown
): value is `${typeof PRODUCT_ASSET_REFERENCE_PREFIX}${string}` {
  return typeof value === 'string' && value.startsWith(PRODUCT_ASSET_REFERENCE_PREFIX)
}

export function assetIdFromReference(value: unknown) {
  return isStoredAssetReference(value)
    ? value.slice(PRODUCT_ASSET_REFERENCE_PREFIX.length)
    : ''
}

export function storedAssetStorageKey(assetId: string) {
  return `${PRODUCT_ASSET_STORAGE_PREFIX}${assetId}`
}
