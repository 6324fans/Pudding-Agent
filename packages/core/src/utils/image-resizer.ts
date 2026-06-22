import sharp from 'sharp'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  type ImageMediaType,
} from './image-constants.js'

export interface CompressedImage {
  data: string
  mediaType: ImageMediaType
}

export interface CompressImageOptions {
  maxBase64Size?: number
  maxWidth?: number
  maxHeight?: number
}

export async function compressImageForAPI(
  base64Data: string,
  mediaType: string,
  options: CompressImageOptions = {},
): Promise<CompressedImage> {
  const maxBase64Size = options.maxBase64Size ?? API_IMAGE_MAX_BASE64_SIZE
  const targetRawSize = (maxBase64Size * 3) / 4
  const maxWidth = options.maxWidth ?? IMAGE_MAX_WIDTH
  const maxHeight = options.maxHeight ?? IMAGE_MAX_HEIGHT
  const imageBuffer = Buffer.from(base64Data, 'base64')
  if (imageBuffer.length === 0) throw new Error('Image data is empty')

  const metadata = await sharp(imageBuffer).metadata()
  const format = normalizeFormat(metadata.format ?? mediaType.split('/')[1] ?? 'png')
  const isPng = format === 'png'
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (
    imageBuffer.length <= targetRawSize &&
    width <= maxWidth &&
    height <= maxHeight
  ) {
    return { data: base64Data, mediaType: `image/${format}` as ImageMediaType }
  }

  const needsResize = width > maxWidth || height > maxHeight
  if (!needsResize && imageBuffer.length > targetRawSize) {
    const compressed = await tryCompressionOnly(imageBuffer, isPng, targetRawSize)
    if (compressed) return compressed
  }

  let targetWidth = width || maxWidth
  let targetHeight = height || maxHeight

  if (targetWidth > maxWidth) {
    targetHeight = Math.round((targetHeight * maxWidth) / targetWidth)
    targetWidth = maxWidth
  }
  if (targetHeight > maxHeight) {
    targetWidth = Math.round((targetWidth * maxHeight) / targetHeight)
    targetHeight = maxHeight
  }

  const resizedBuffer = await sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
    .toBuffer()

  if (resizedBuffer.length <= targetRawSize) {
    const resizedMeta = await sharp(resizedBuffer).metadata()
    const outFormat = normalizeFormat(resizedMeta.format ?? format)
    return {
      data: resizedBuffer.toString('base64'),
      mediaType: `image/${outFormat}` as ImageMediaType,
    }
  }

  if (isPng) {
    const pngCompressed = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    if (pngCompressed.length <= targetRawSize) {
      return { data: pngCompressed.toString('base64'), mediaType: 'image/png' }
    }
  }

  for (const quality of [80, 60, 40, 20]) {
    const jpegBuffer = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()
    if (jpegBuffer.length <= targetRawSize) {
      return { data: jpegBuffer.toString('base64'), mediaType: 'image/jpeg' }
    }
  }

  const smallerWidth = Math.min(targetWidth, 1000)
  const smallerHeight = Math.round((targetHeight * smallerWidth) / Math.max(targetWidth, 1))
  const aggressiveBuffer = await sharp(imageBuffer)
    .resize(smallerWidth, smallerHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 20 })
    .toBuffer()

  return { data: aggressiveBuffer.toString('base64'), mediaType: 'image/jpeg' }
}

async function tryCompressionOnly(
  imageBuffer: Buffer,
  isPng: boolean,
  targetRawSize: number,
): Promise<CompressedImage | null> {
  if (isPng) {
    const pngCompressed = await sharp(imageBuffer)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    if (pngCompressed.length <= targetRawSize) {
      return { data: pngCompressed.toString('base64'), mediaType: 'image/png' }
    }
  }

  for (const quality of [80, 60, 40, 20]) {
    const jpegBuffer = await sharp(imageBuffer).jpeg({ quality }).toBuffer()
    if (jpegBuffer.length <= targetRawSize) {
      return { data: jpegBuffer.toString('base64'), mediaType: 'image/jpeg' }
    }
  }

  return null
}

function normalizeFormat(format: string): string {
  if (format === 'jpg') return 'jpeg'
  if (['png', 'jpeg', 'gif', 'webp'].includes(format)) return format
  return 'png'
}
