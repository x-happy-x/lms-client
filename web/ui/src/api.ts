import type {
  JobPreflightResponse,
  Job,
  NodeItem,
  Profile,
  StorageEstimateResponse,
  StorageTargetsResponse
} from './types'

const BASE = '/api/ui'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload?.error) {
        message = payload.error
      }
    } catch {
      // no-op
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string }>('/system/health'),
  version: () => request<{ version: string }>('/system/version'),
  getJobs: (active = false) => request<Job[]>(`/jobs?active=${active}`),
  preflightJob: (payload: Record<string, unknown>) =>
    request<JobPreflightResponse>('/jobs/preflight', { method: 'POST', body: JSON.stringify(payload) }),
  createJob: (payload: Record<string, unknown>) =>
    request<Job>('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  cancelJob: (id: string) =>
    request<Job>(`/jobs/${id}/cancel`, { method: 'POST', body: '{}' }),
  pauseJob: (id: string) =>
    request<Job>(`/jobs/${id}/pause`, { method: 'POST', body: '{}' }),
  resumeJob: (id: string) =>
    request<Job>(`/jobs/${id}/resume`, { method: 'POST', body: '{}' }),
  retryJob: (id: string) =>
    request<Job>(`/jobs/${id}/retry`, { method: 'POST', body: '{}' }),
  updateJobUrl: (id: string, payload: Record<string, unknown>) =>
    request<Job>(`/jobs/${id}/url`, { method: 'POST', body: JSON.stringify(payload) }),
  moveJob: (id: string, payload: Record<string, unknown>) =>
    request<Job>(`/jobs/${id}/move`, { method: 'POST', body: JSON.stringify(payload) }),
  getNodes: (enabled = false) => request<NodeItem[]>(`/nodes?enabled=${enabled}`),
  createNode: (payload: Record<string, unknown>) =>
    request<NodeItem>('/nodes', { method: 'POST', body: JSON.stringify(payload) }),
  updateNode: (id: string, payload: Record<string, unknown>) =>
    request<NodeItem>(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  getProfiles: (enabled = false) => request<Profile[]>(`/profiles?enabled=${enabled}`),
  createProfile: (payload: Record<string, unknown>) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(payload) }),
  getNodeStorageTargets: (nodeId: string, requiredBytes?: number) => {
    const suffix = typeof requiredBytes === 'number' && requiredBytes > 0
      ? `?requiredBytes=${Math.floor(requiredBytes)}`
      : ''
    return request<StorageTargetsResponse>(`/nodes/${nodeId}/storage/targets${suffix}`)
  },
  estimateNodeStorage: (nodeId: string, payload: Record<string, unknown>) =>
    request<StorageEstimateResponse>(`/nodes/${nodeId}/storage/estimate`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
}
