import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { JobPreflightResponse, StorageTarget } from '../types'

export type NewJobFormState = {
  type: string
  url: string
  storagePath: string
  nodeId: string
  profileId: string
  maxSpeedBytes: number | null
}

type UseNewDownloadFlowParams = {
  refreshJobs: () => Promise<void>
  setError: (message: string) => void
}

const INITIAL_FORM: NewJobFormState = {
  type: 'DIRECT',
  url: '',
  storagePath: '',
  nodeId: '',
  profileId: '',
  maxSpeedBytes: null
}

function withOptional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isSupportedUrl(value: string): boolean {
  return /^(https?:\/\/|magnet:\?).+/i.test(value.trim())
}

/** First http(s)/magnet link in pasted text (e.g. a shared message). */
export function extractLink(text: string): string {
  const match = text.match(/(magnet:\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+)/i)
  return match ? match[1].replace(/[.,;:!?)\]]+$/, '') : text.trim()
}

export function useNewDownloadFlow({ refreshJobs, setError }: UseNewDownloadFlowParams) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<NewJobFormState>(INITIAL_FORM)
  const [preflight, setPreflight] = useState<JobPreflightResponse | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState('')
  const [targets, setTargets] = useState<StorageTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(false)
  const [targetsError, setTargetsError] = useState('')
  const [nodeSelectionTouched, setNodeSelectionTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const selectedNode = useMemo(() => {
    if (!preflight || !value.nodeId) return null
    return preflight.nodes.find((node) => node.nodeId === value.nodeId) ?? null
  }, [preflight, value.nodeId])

  const openModal = async (initialUrl?: string) => {
    setOpen(true)
    if (initialUrl) {
      setValue((current) => ({ ...current, url: initialUrl }))
      return
    }
    setError('')
    if (value.url.trim() !== '' || typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return
    }
    try {
      const text = extractLink(await navigator.clipboard.readText())
      if (isSupportedUrl(text)) {
        setValue((current) => ({ ...current, url: text }))
      }
    } catch {
      // Clipboard access is best effort only.
    }
  }

  const closeModal = () => {
    setOpen(false)
    setValue(INITIAL_FORM)
    setPreflight(null)
    setPreflightLoading(false)
    setPreflightError('')
    setTargets([])
    setTargetsLoading(false)
    setTargetsError('')
    setNodeSelectionTouched(false)
    setSubmitError('')
  }

  const onChange = (next: NewJobFormState) => {
    if (next.url !== value.url) {
      setNodeSelectionTouched(false)
    }
    if (next.nodeId !== value.nodeId) {
      setNodeSelectionTouched(true)
    }
    setValue(next)
  }

  useEffect(() => {
    if (!open) return
    const url = value.url.trim()
    if (!isSupportedUrl(url)) {
      setPreflight(null)
      setPreflightError(url ? 'Нужна ссылка http://, https:// или magnet:?' : '')
      setTargets([])
      setTargetsError('')
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        setPreflightLoading(true)
        setPreflightError('')
        const response = await api.preflightJob(url)
        setPreflight(response)

        const candidateNodeId = nodeSelectionTouched && response.nodes.some((node) => node.nodeId === value.nodeId)
          ? value.nodeId
          : (response.bestNodeId || response.nodes[0]?.nodeId || '')

        const chosenNode = response.nodes.find((node) => node.nodeId === candidateNodeId) ?? response.nodes[0] ?? null
        const nextType = chosenNode?.supportedTypes.includes(value.type)
          ? value.type
          : (chosenNode?.recommendedType || chosenNode?.supportedTypes[0] || value.type)

        setValue((current) => ({
          ...current,
          nodeId: candidateNodeId,
          type: nextType,
          storagePath: current.storagePath || chosenNode?.defaultStoragePath || ''
        }))
      } catch (err) {
        setPreflight(null)
        setPreflightError((err as Error).message)
      } finally {
        setPreflightLoading(false)
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [open, value.url, value.nodeId, value.type, nodeSelectionTouched])

  useEffect(() => {
    if (!open || !selectedNode || !value.nodeId) {
      return
    }

    const requiredBytes = selectedNode.sizeKnown ? selectedNode.sizeBytes : undefined

    const run = async () => {
      try {
        setTargetsLoading(true)
        setTargetsError('')
        const response = await api.getNodeStorageTargets(value.nodeId, requiredBytes)
        setTargets(response.targets ?? [])
        setValue((current) => {
          if (current.storagePath.trim() !== '') {
            return current
          }
          const preferred = response.defaultPath || selectedNode.defaultStoragePath || ''
          return preferred ? { ...current, storagePath: preferred } : current
        })
      } catch (err) {
        setTargets([])
        setTargetsError((err as Error).message)
      } finally {
        setTargetsLoading(false)
      }
    }

    void run()
  }, [open, value.nodeId, selectedNode])

  const submit = async (startImmediately: boolean) => {
    setSubmitting(true)
    setSubmitError('')
    try {
      await api.createJob({
        type: value.type,
        url: value.url.trim(),
        storagePath: withOptional(value.storagePath),
        nodeId: withOptional(value.nodeId),
        profileId: withOptional(value.profileId),
        maxSpeedBytes: value.maxSpeedBytes ?? undefined,
        startImmediately
      })
      closeModal()
      setError('')
      await refreshJobs()
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return {
    open,
    value,
    onChange,
    openModal,
    closeModal,
    submit,
    preflight,
    preflightLoading,
    preflightError,
    selectedNode,
    targets,
    targetsLoading,
    targetsError,
    submitting,
    submitError
  }
}
