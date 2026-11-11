import type { Job } from '../types'

export type JobStack = { key: string; anchorId: string; playlist: boolean; jobs: Job[] }

export function groupPlaylists(jobs: Job[]): JobStack[] {
  const groups: JobStack[] = [], playlists = new Map<string, JobStack>()
  for (const job of jobs) {
    const key = job.playlist?.id || (job.ytdlpOptions?.playlist ? `job-${job.id}` : '')
    if (!key) { groups.push({ key: job.id, anchorId: job.id, playlist: false, jobs: [job] }); continue }
    const existing = playlists.get(key)
    if (existing) existing.jobs.push(job)
    else { const stack = { key, anchorId: job.id, playlist: true, jobs: [job] }; playlists.set(key, stack); groups.push(stack) }
  }
  for (const group of playlists.values()) group.jobs.sort((a, b) => (a.playlist?.index ?? 0) - (b.playlist?.index ?? 0))
  return groups
}

export function playlistProgress(jobs: Job[]): number | undefined {
  if (!jobs.length || jobs.some(job => job.status !== 'DONE' && (typeof job.percent !== 'number' || !Number.isFinite(job.percent)))) return undefined
  return jobs.reduce((sum, job) => sum + (job.status === 'DONE' ? 100 : Math.max(0, Math.min(100, job.percent || 0))), 0) / jobs.length
}
