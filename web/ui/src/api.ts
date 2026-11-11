import type {
  Job,
  YtdlpOptions, PlaylistMetadata, MediaExtractResult, MediaInfo,
  JobPreflightResponse,
  NodeItem,
  Profile,
  StorageEstimateResponse,
  StorageTargetsResponse,
  StorageFileListing
} from './types'

const BASE = '/api/ui'
let redirectingToAccount = false

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = (await response.json()) as { error?: string; authRequired?: boolean }
      if (payload?.error) message = payload.error
      if (response.status === 401 && payload?.authRequired && !redirectingToAccount) {
        redirectingToAccount = true
        window.location.assign(`/auth/login?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`)
      }
    } catch {
      // no-op
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export type NodePayload = {
  name: string
  baseUrl: string
  clientId: string
  secret: string
  enabled: boolean
}

export type ProfilePayload = {
  name: string
  type: string
  enabled: boolean
  extraArgsJson?: string
  outputTemplate?: string
}

export type CreateJobPayload = {
  ytdlpOptions?: YtdlpOptions
  playlist?: PlaylistMetadata
  type: string
  url: string
  storagePath?: string
  nodeId?: string
  profileId?: string
  startImmediately: boolean
  maxSpeedBytes?: number
}

export const api = {
  extractMedia: (payload: {url: string; nodeId?: string; impersonate?: string}) => post<MediaExtractResult>('/media/extract', payload),
  mediaInfo: (payload: {url: string; nodeId?: string; maxHeight?: number; maxFps?: number; impersonate?: string}) => post<MediaInfo>('/media/info', payload),
  prepareMedia: (payload: {url: string; nodeId?: string; maxHeight?: number}) => post<{streamUrl: string}>('/media/preview', payload),
  health: () => request<{ status: string }>('/system/health'),
  version: () => request<{ version: string }>('/system/version'),
  getJobs: (active = false) => request<Job[]>(`/jobs?active=${active}`),
  preflightJob: (url: string) => post<JobPreflightResponse>('/jobs/preflight', { url }),
  createJob: (payload: CreateJobPayload) => post<Job>('/jobs', payload),
  cancelJob: (id: string) => post<Job>(`/jobs/${id}/cancel`),
  pauseJob: (id: string) => post<Job>(`/jobs/${id}/pause`),
  resumeJob: (id: string) => post<Job>(`/jobs/${id}/resume`),
  retryJob: (id: string) => post<Job>(`/jobs/${id}/retry`),
  setJobSpeed: (id: string, maxSpeedBytes: number | null) =>
    post<Job>(`/jobs/${id}/speed`, { maxSpeedBytes }),
  updateJobUrl: (id: string, url: string) => post<Job>(`/jobs/${id}/url`, { url }),
  moveJob: (id: string, payload: { targetNodeId?: string; storagePath?: string }) =>
    post<Job>(`/jobs/${id}/move`, payload),
  getNodes: (enabled = false) => request<NodeItem[]>(`/nodes?enabled=${enabled}`),
  createNode: (payload: NodePayload) => post<NodeItem>('/nodes', payload),
  updateNode: (id: string, payload: NodePayload) =>
    request<NodeItem>(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  getProfiles: (enabled = false) => request<Profile[]>(`/profiles?enabled=${enabled}`),
  createProfile: (payload: ProfilePayload) => post<Profile>('/profiles', payload),
  getNodeStorageTargets: (nodeId: string, requiredBytes?: number) => {
    const suffix = typeof requiredBytes === 'number' && requiredBytes > 0 ? `?requiredBytes=${Math.floor(requiredBytes)}` : ''
    return request<StorageTargetsResponse>(`/nodes/${nodeId}/storage/targets${suffix}`)
  },
  estimateNodeStorage: (nodeId: string, payload: { type: string; url: string }) =>
    post<StorageEstimateResponse>(`/nodes/${nodeId}/storage/estimate`, payload),
  browseFiles: (nodeId: string, root: string, path: string) => request<StorageFileListing>(`/nodes/${encodeURIComponent(nodeId)}/files?${new URLSearchParams({ root, path })}`),
  mutateFile: (nodeId: string, operation: 'mkdir' | 'rename' | 'delete', payload: { root: string; path: string; name?: string }) =>
    post<{ path: string }>(`/nodes/${encodeURIComponent(nodeId)}/files/${operation}`, payload),
  fileAccess: async () => {
    const config = await request<{ enabled: boolean }>('/auth/config')
    if (!config.enabled) return true
    const session = await request<{ user?: { role?: string } }>('/auth/session')
    return ['admin', 'editor'].includes(session.user?.role || '')
  }
}

export function storageFileUrl(nodeId: string, root: string, path: string, inline = false): string {
  return `${BASE}/nodes/${encodeURIComponent(nodeId)}/files/content?${new URLSearchParams({ root, path, ...(inline ? { inline: '1' } : {}) })}`
}

/** Download URL of a job's output (streamed from the node through the router). */
export function fileUrl(jobId: string, inline = false): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/file${inline ? '?inline=1' : ''}`
}

export function previewUrl(jobId: string): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/preview`
}
