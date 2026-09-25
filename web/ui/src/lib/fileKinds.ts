import type { Job } from '../types'
import { titleFromJob } from './format'

export type FileKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'archive'
  | 'document'
  | 'torrent'
  | 'disk'
  | 'app'
  | 'code'
  | 'other'

export const FILE_KINDS: Array<{ kind: FileKind; label: string }> = [
  { kind: 'video', label: 'Видео' },
  { kind: 'audio', label: 'Аудио' },
  { kind: 'image', label: 'Изображения' },
  { kind: 'archive', label: 'Архивы' },
  { kind: 'document', label: 'Документы' },
  { kind: 'torrent', label: 'Торренты' },
  { kind: 'disk', label: 'Образы дисков' },
  { kind: 'app', label: 'Программы' },
  { kind: 'code', label: 'Данные и код' },
  { kind: 'other', label: 'Другое' }
]

const EXTENSIONS: Record<Exclude<FileKind, 'torrent' | 'other'>, string[]> = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv', 'ts', 'm2ts', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'wma', 'alac'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif', 'svg'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'rtf', 'epub', 'fb2', 'djvu', 'md'],
  disk: ['iso', 'img', 'dmg', 'vhd', 'vhdx', 'vmdk', 'qcow2'],
  app: ['apk', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg'],
  code: ['json', 'csv', 'xml', 'yaml', 'yml', 'sql', 'db', 'safetensors', 'gguf', 'pt', 'bin']
}

const BY_EXTENSION = new Map<string, FileKind>(
  Object.entries(EXTENSIONS).flatMap(([kind, exts]) => exts.map((ext) => [ext, kind as FileKind]))
)

const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'rutube.ru', 'vk.com', 'vkvideo.ru', 'twitch.tv', 'tiktok.com', 'dailymotion.com', 'ok.ru']

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  if (dot <= 0 || dot === clean.length - 1) return ''
  return clean.slice(dot + 1).toLowerCase()
}

export function isMagnet(url: string): boolean {
  return /^magnet:\?/i.test(url.trim())
}

/** File kind of a job: by the output/URL extension, then by job type and source. */
export function kindOfJob(job: Job): FileKind {
  const name = titleFromJob(job)
  const byExt = BY_EXTENSION.get(extensionOf(name))
  // A finished torrent is its content (e.g. a video), an unfinished one is just "torrent".
  if (byExt && !(job.type === 'TORRENT' && !job.outputPath)) return byExt
  if (job.type === 'TORRENT' || isMagnet(job.url) || extensionOf(job.url) === 'torrent') return 'torrent'
  if (job.type === 'YTDLP') return 'video'
  try {
    const host = new URL(job.url).hostname.replace(/^(www|m)\./, '')
    if (VIDEO_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) return 'video'
  } catch {
    // not a URL
  }
  return byExt ?? 'other'
}

export function kindLabel(kind: FileKind): string {
  return FILE_KINDS.find((item) => item.kind === kind)?.label ?? 'Другое'
}

/** Media the browser can show in place (and the node can make a thumbnail for). */
export function isViewableMedia(job: Job): boolean {
  if (job.status !== 'DONE' || !job.outputPath) return false
  const kind = kindOfJob(job)
  return kind === 'video' || kind === 'image'
}

export function isFolderOutput(job: Job): boolean {
  return Boolean(job.outputPath) && extensionOf(titleFromJob(job)) === '' && job.type === 'TORRENT'
}
