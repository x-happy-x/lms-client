import type { Job, JobStatus } from '../types'

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']

export function formatBytes(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  let size = value
  let unit = 0
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = unit === 0 || size >= 100 ? 0 : 1
  return `${size.toFixed(digits)} ${UNITS[unit]}`
}

export function formatSpeed(value?: number | null): string {
  if (typeof value !== 'number' || value <= 0) return ''
  return `${formatBytes(value)}/с`
}

export function formatDuration(seconds?: number | null): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин ${s} с`
  return `${s} с`
}

export function formatPercent(value?: number | null): string {
  if (typeof value !== 'number') return ''
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`
}

export function formatAgo(timestamp?: string | null): string {
  if (!timestamp) return 'никогда'
  const value = new Date(timestamp).getTime()
  if (Number.isNaN(value)) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

export function formatDate(timestamp?: string | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'В очереди',
  RUNNING: 'Загружается',
  PAUSED: 'Пауза',
  DONE: 'Готово',
  ERROR: 'Ошибка',
  CANCELED: 'Отменено'
}

export const TYPE_LABELS: Record<string, string> = {
  DIRECT: 'HTTP',
  YTDLP: 'Видео (yt-dlp)',
  ARIA2C: 'aria2c',
  TORRENT: 'Торрент'
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/** Display name: output file, magnet dn, URL file name, or the URL host. */
export function titleFromJob(job: Pick<Job, 'url' | 'type' | 'outputPath'>): string {
  if (job.outputPath) {
    const parts = job.outputPath.split('/').filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  const url = job.url.trim()
  if (/^magnet:\?/i.test(url)) {
    const dn = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn')
    return dn || 'Magnet-ссылка'
  }
  try {
    const parsed = new URL(url)
    const fromQuery = parsed.searchParams.get('filename')
    if (fromQuery) return fromQuery
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : parsed.hostname
  } catch {
    return url || job.type
  }
}

/** Bytes done/total from the fields the node reports. */
export function transfer(job: Job): { done?: number; total?: number } {
  if (job.status === 'DONE' && typeof job.outputSizeBytes === 'number') {
    return { done: job.outputSizeBytes, total: job.outputSizeBytes }
  }
  if (typeof job.totalBytes === 'number' && job.totalBytes > 0) {
    const done = typeof job.percent === 'number' ? Math.round((job.totalBytes * job.percent) / 100) : undefined
    return { done, total: job.totalBytes }
  }
  return {}
}

export function sizeOf(job: Job): number | undefined {
  return job.outputSizeBytes ?? job.totalBytes ?? undefined
}
