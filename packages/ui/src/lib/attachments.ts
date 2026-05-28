export interface AttachedImage {
  data: string
  mediaType: string
}

export interface TextAttachment {
  id: string
  name: string
  type: string
  size: number
  text: string
  error?: string
}

const TEXT_FILE_LIMIT = 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'css',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'csv', 'tsv', 'log', 'ini', 'conf', 'env',
])

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase()
  return !!ext && TEXT_EXTENSIONS.has(ext)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export async function readLocalFiles(files: File[]): Promise<{ images: AttachedImage[]; attachments: TextAttachment[] }> {
  const images: AttachedImage[] = []
  const attachments: TextAttachment[] = []

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      if (!IMAGE_TYPES.has(file.type)) {
        attachments.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
          text: '',
          error: '暂不支持这种图片格式',
        })
        continue
      }
      const dataUrl = await readAsDataUrl(file)
      const data = dataUrl.split(',')[1]
      if (data) images.push({ data, mediaType: file.type })
      continue
    }

    if (!isTextFile(file)) {
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        text: '',
        error: '非文本文件不会读取内容',
      })
      continue
    }

    if (file.size > TEXT_FILE_LIMIT) {
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        text: '',
        error: `文件超过 ${formatBytes(TEXT_FILE_LIMIT)} 限制`,
      })
      continue
    }

    attachments.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || 'text/plain',
      size: file.size,
      text: await readAsText(file),
    })
  }

  return { images, attachments }
}

export function getFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  const seen = new Set<string>()
  const addFile = (file: File | null) => {
    if (!file) return
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  for (const file of Array.from(data.files || [])) {
    addFile(file)
  }
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file') {
      addFile(item.getAsFile())
    }
  }

  return files
}

export function buildPromptWithAttachments(prompt: string, files: TextAttachment[]): string {
  const readableFiles = files.filter((file) => !file.error)
  const skippedFiles = files.filter((file) => file.error)
  if (readableFiles.length === 0 && skippedFiles.length === 0) return prompt

  const parts = [prompt || '请根据我上传的附件继续处理。']
  if (readableFiles.length > 0) {
    parts.push(
      `<attached-files>\n${readableFiles.map((file) =>
        `<file name="${file.name}" type="${file.type || 'text/plain'}" size="${file.size}">\n${file.text}\n</file>`
      ).join('\n\n')}\n</attached-files>`
    )
  }
  if (skippedFiles.length > 0) {
    parts.push(
      `<unreadable-attachments>\n${skippedFiles.map((file) =>
        `- ${file.name} (${file.type || 'unknown'}, ${formatBytes(file.size)}): ${file.error || '无法作为文本读取'}`
      ).join('\n')}\n</unreadable-attachments>`
    )
  }
  return parts.join('\n\n')
}
