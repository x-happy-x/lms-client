export function formatAgo(timestamp?: string): string {
  if (!timestamp) return 'never'
  const value = new Date(timestamp).getTime()
  if (Number.isNaN(value)) return 'unknown'
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function formatBytes(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

export function formatSpeed(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '0 B/s'
  return `${formatBytes(value)}/s`
}

export function formatEta(seconds?: number): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return 'ETA -'
  if (seconds < 60) return `ETA ${Math.round(seconds)}s`
  if (seconds < 3600) return `ETA ${Math.round(seconds / 60)}m`
  return `ETA ${Math.round(seconds / 3600)}h`
}

export function formatDuration(seconds?: number): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return '-'
  const rounded = Math.round(seconds)
  if (rounded < 60) return `${rounded}s`
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  return `${secs}s`
}

export function elapsedSeconds(startedAt?: string, finishedAt?: string): number | undefined {
  if (!startedAt) return undefined
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return undefined
  const finished = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (Number.isNaN(finished) || finished < started) return undefined
  return (finished - started) / 1000
}

export function titleFromJob(url: string, fallback: string, outputPath?: string): string {
  if (outputPath) {
    const chunks = outputPath.split('/')
    return chunks[chunks.length - 1] || fallback
  }
  try {
    const parsed = new URL(url)
    const queryFileName = parsed.searchParams.get('filename')
    if (queryFileName) {
      return decodeURIComponent(queryFileName)
    }
    const chunks = parsed.pathname.split('/')
    const fileName = chunks[chunks.length - 1]
    return fileName ? decodeURIComponent(fileName) : fallback
  } catch {
    return fallback
  }
}
