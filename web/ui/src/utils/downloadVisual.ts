import type { IconRule, Job } from '../types'
import { formatBytes, titleFromJob } from './format'

type TransferInfo = {
  doneBytes?: number
  totalBytes?: number
}

const UNIT_TO_BYTES: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024
}

function parseWithUnit(value: string, unit: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed)) return undefined
  const factor = UNIT_TO_BYTES[unit.toLowerCase()]
  if (!factor) return undefined
  return Math.round(parsed * factor)
}

export function parseTransferInfo(job: Job): TransferInfo {
  if (typeof job.outputSizeBytes === 'number' && job.outputSizeBytes > 0) {
    return { doneBytes: job.outputSizeBytes, totalBytes: job.outputSizeBytes }
  }

  if (typeof job.totalBytes === 'number' && job.totalBytes > 0) {
    if (typeof job.percent === 'number' && job.percent >= 0 && job.percent <= 100) {
      return {
        doneBytes: Math.round(job.totalBytes * (job.percent / 100)),
        totalBytes: job.totalBytes
      }
    }
    return { totalBytes: job.totalBytes }
  }

  if (job.message) {
    const directMatch = job.message.match(
      /(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB)\s*(?:\/|of)\s*(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB)/i
    )
    if (directMatch) {
      const done = parseWithUnit(directMatch[1], directMatch[2])
      const total = parseWithUnit(directMatch[3], directMatch[4])
      if (typeof done === 'number' || typeof total === 'number') {
        return { doneBytes: done, totalBytes: total }
      }
    }
  }

  if (typeof job.percent === 'number' && job.percent > 0 && job.percent <= 100 && typeof job.etaSeconds === 'number' && job.etaSeconds > 0 && typeof job.speedBytes === 'number' && job.speedBytes > 0) {
    const remaining = job.speedBytes * job.etaSeconds
    const total = Math.round(remaining / (1 - job.percent / 100))
    const done = Math.round(total * (job.percent / 100))
    return { doneBytes: done, totalBytes: total }
  }

  return {}
}

export function transferLabel(job: Job): string {
  const transfer = parseTransferInfo(job)
  if (typeof transfer.doneBytes === 'number' && typeof transfer.totalBytes === 'number') {
    return `${formatBytes(transfer.doneBytes)} / ${formatBytes(transfer.totalBytes)}`
  }
  if (typeof transfer.totalBytes === 'number') {
    return formatBytes(transfer.totalBytes)
  }
  if (typeof transfer.doneBytes === 'number') {
    return `${formatBytes(transfer.doneBytes)} / -`
  }
  return '- / -'
}

export function remainingLabel(job: Job): string {
  const transfer = parseTransferInfo(job)
  if (typeof transfer.doneBytes === 'number' && typeof transfer.totalBytes === 'number') {
    return formatBytes(Math.max(0, transfer.totalBytes - transfer.doneBytes))
  }
  return '-'
}

export function iconForJob(job: Job, rules: IconRule[]): { icon: string; label: string } {
  const fileName = titleFromJob(job.url, job.type, job.outputPath)
  const source = `${fileName} ${job.url}`.toLowerCase()
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern.trim()) continue
    try {
      const regExp = new RegExp(rule.pattern, 'i')
      if (regExp.test(source)) {
        return { icon: rule.icon || '📄', label: rule.label || 'File' }
      }
    } catch {
      // Ignore invalid regex from settings.
    }
  }
  return { icon: '📄', label: 'File' }
}
