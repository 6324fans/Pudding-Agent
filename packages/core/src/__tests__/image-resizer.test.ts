import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { compressImageForAPI } from '../utils/image-resizer.js'
import { IMAGE_MAX_WIDTH, IMAGE_TARGET_RAW_SIZE } from '../utils/image-constants.js'

describe('compressImageForAPI', () => {
  it('passes through small images unchanged', async () => {
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer()

    const result = await compressImageForAPI(image.toString('base64'), 'image/png')

    expect(result.data.length).toBeGreaterThan(0)
    expect(result.mediaType).toBe('image/png')
  })

  it('compresses large images below the API target size', async () => {
    const image = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer()

    const result = await compressImageForAPI(image.toString('base64'), 'image/png')
    const resultBuffer = Buffer.from(result.data, 'base64')

    expect(resultBuffer.length).toBeLessThanOrEqual(IMAGE_TARGET_RAW_SIZE)
  })

  it('resizes images that exceed max dimensions', async () => {
    const image = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: { r: 0, g: 255, b: 0 } },
    }).png().toBuffer()

    const result = await compressImageForAPI(image.toString('base64'), 'image/png')
    const metadata = await sharp(Buffer.from(result.data, 'base64')).metadata()

    expect(metadata.width).toBeLessThanOrEqual(IMAGE_MAX_WIDTH)
  })

  it('rejects empty image data', async () => {
    await expect(compressImageForAPI('', 'image/png')).rejects.toThrow('Image data is empty')
  })
})
