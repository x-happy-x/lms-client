import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Job, NodeItem, Profile } from '../types'

type UseRouterDataParams = {
  setError: (message: string) => void
}

export function useRouterData({ setError }: UseRouterDataParams) {
  const [health, setHealth] = useState('unknown')
  const [version, setVersion] = useState('dev')
  const [jobs, setJobs] = useState<Job[]>([])
  const [nodes, setNodes] = useState<NodeItem[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.getJobs(false)
      setJobs(data)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [setError])

  const refreshNodes = useCallback(async () => {
    try {
      const data = await api.getNodes(false)
      setNodes(data)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [setError])

  const refreshProfiles = useCallback(async () => {
    try {
      const data = await api.getProfiles(false)
      setProfiles(data)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [setError])

  const refreshSystem = useCallback(async () => {
    try {
      const [healthResp, versionResp] = await Promise.all([api.health(), api.version()])
      setHealth(healthResp.status || 'unknown')
      setVersion(versionResp.version || 'dev')
    } catch {
      setHealth('offline')
    }
  }, [])

  const refreshAll = useCallback(async (includeProfiles = false) => {
    await Promise.all([
      refreshSystem(),
      refreshJobs(),
      refreshNodes(),
      includeProfiles ? refreshProfiles() : Promise.resolve()
    ])
  }, [refreshJobs, refreshNodes, refreshProfiles, refreshSystem])

  useEffect(() => {
    void refreshAll(true)
  }, [refreshAll])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAll(false)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [refreshAll])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshAll(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refreshAll])

  return {
    health,
    version,
    jobs,
    nodes,
    profiles,
    refreshJobs,
    refreshNodes,
    refreshProfiles
  }
}
