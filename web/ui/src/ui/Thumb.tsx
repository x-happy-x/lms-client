import { useState } from 'react'
import { previewUrl } from '../api'
import { isViewableMedia, kindOfJob } from '../lib/fileKinds'
import type { Job } from '../types'
import { KindIcon } from './Icon'

/**
 * Preview image for finished photos/videos (made by the node); the file-type icon
 * otherwise, or when the node cannot make a preview.
 */
export function Thumb({ job, size = 'sm' }: { job: Job; size?: 'sm' | 'lg' }) {
  const kind = kindOfJob(job)
  const [failed, setFailed] = useState(false)
  const showImage = isViewableMedia(job) && !failed

  return (
    <div className={`thumb thumb-${size} kind-${kind}`}>
      {showImage ? (
        <img src={previewUrl(job.id)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <KindIcon kind={kind} size={size === 'lg' ? 36 : 22} />
      )}
      {showImage && kind === 'video' ? <span className="thumb-play" aria-hidden="true">▶</span> : null}
    </div>
  )
}
