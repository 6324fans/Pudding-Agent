export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024

// Base64 inflates by roughly 4/3, so keep the raw buffer below this target.
export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4

export const IMAGE_MAX_WIDTH = 2000
export const IMAGE_MAX_HEIGHT = 2000

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
