export type TabKey = 'jobs' | 'nodes' | 'profiles' | 'settings'
export type ThemeMode = 'claude-dark' | 'claude'

export type JobStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'ERROR' | 'CANCELED'

export type Job = {
  id: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  type: string
  url: string
  status: JobStatus
  storagePath?: string
  profileId?: string
  nodeId?: string
  remoteJobId?: string
  percent?: number
  totalBytes?: number
  speedBytes?: number
  etaSeconds?: number
  message?: string
  outputPath?: string
  outputSizeBytes?: number
  errorText?: string
}

export type NodeStatus = 'online' | 'offline' | 'never_seen' | 'disabled' | 'unknown'

export type NodeItem = {
  id: string
  name: string
  baseUrl: string
  clientId: string
  enabled: boolean
  status: NodeStatus
  statusText: string
  pingMs?: number
  availableTypes?: string[]
  lastSeenAt?: string
}

export type Profile = {
  id: string
  name: string
  type: string
  extraArgsJson?: string
  outputTemplate?: string
  enabled: boolean
}

export type StorageTarget = {
  path: string
  freeBytes: number
  totalBytes: number
  writable: boolean
  canFit?: boolean
}

export type StorageTargetsResponse = {
  nodeId: string
  nodeName: string
  defaultPath: string
  targets: StorageTarget[]
}

export type StorageEstimateResponse = {
  nodeId: string
  nodeName: string
  sizeBytes?: number
  known: boolean
  message: string
}

export type DownloadOption = {
  type: string
  supported: boolean
  resumeSupported: boolean
  segmentedPossible: boolean
  message: string
}

export type JobPreflightNode = {
  nodeId: string
  nodeName: string
  status: NodeStatus
  statusText: string
  pingMs?: number
  url: string
  sizeBytes?: number
  sizeKnown: boolean
  recommendedType?: string
  supportedTypes: string[]
  options: DownloadOption[]
  defaultStoragePath?: string
  error?: string
}

export type JobPreflightResponse = {
  url: string
  bestNodeId?: string
  nodes: JobPreflightNode[]
}

export type IconRule = {
  id: string
  label: string
  icon: string
  pattern: string
  enabled: boolean
}
