export type DownloadFilter = 'active' | 'completed' | 'failed' | 'all'

export type MoveFormState = {
  jobId: string
  targetNodeId: string
  storagePath: string
}

export type UrlEditFormState = {
  jobId: string
  url: string
}
