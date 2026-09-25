import type {
  Job,
  JobPreflightResponse,
  NodeItem,
  Profile,
  StorageEstimateResponse,
  StorageTargetsResponse
} from './types'

const BASE = '/api/ui'

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
      const payload = (await response.json()) as { error?: string }
      if (payload?.error) message = payload.error
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
  type: string
  url: string
  storagePath?: string
  nodeId?: string
  profileId?: string
  startImmediately: boolean
}

export const api = {
  health: () => request<{ status: string }>('/system/health'),
  version: () => request<{ version: string }>('/system/version'),
  getJobs: (active = false) => request<Job[]>(`/jobs?active=${active}`),
  preflightJob: (url: string) => post<JobPreflightResponse>('/jobs/preflight', { url }),
  createJob: (payload: CreateJobPayload) => post<Job>('/jobs', payload),
  cancelJob: (id: string) => post<Job>(`/jobs/${id}/cancel`),
  pauseJob: (id: string) => post<Job>(`/jobs/${id}/pause`),
  resumeJob: (id: string) => post<Job>(`/jobs/${id}/resume`),
  retryJob: (id: string) => post<Job>(`/jobs/${id}/retry`),
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
    post<StorageEstimateResponse>(`/nodes/${nodeId}/storage/estimate`, payload)
}

/** Download URL of a job's output (streamed from the node through the router). */
export function fileUrl(jobId: string, inline = false): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/file${inline ? '?inline=1' : ''}`
}

export function previewUrl(jobId: string): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/preview`
}
