'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useI18n } from '@/components/i18n-provider'
import {
  fetchCollisionReplayPair,
  type CollisionReplayPair,
  type CollisionReplayTarget,
} from './collision-replay-data'

const CollisionPairViewer = dynamic(
  () => import('./CollisionPairViewer').then(mod => ({ default: mod.CollisionPairViewer })),
  { ssr: false },
)

/** Never fetch or render on load: only after a user explicitly chooses a witness. */
export function CollisionReplayAction({
  jobId, sourceSha256, specSha256, evidenceArchiveSha256, target,
}: {
  jobId: string
  sourceSha256: string
  specSha256: string
  evidenceArchiveSha256: string
  target: CollisionReplayTarget
}) {
  const { t } = useI18n()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [replay, setReplay] = React.useState<{ key: string; pair: CollisionReplayPair } | null>(null)
  // A later source/spec/measurement makes earlier replay data historical;
  // never display it under the current evidence header.
  const key = [jobId, sourceSha256, specSha256, evidenceArchiveSha256,
    target.movingInstanceId, target.obstacleInstanceId, target.poseIndex].join(':')
  const visible = replay?.key === key ? replay.pair : null

  const open = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    setReplay(null)
    try {
      const pair = await fetchCollisionReplayPair(jobId, sourceSha256, specSha256, target)
      setReplay({ key, pair })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Collision pair replay is unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="mt-2 rounded border border-[color:var(--shell-hairline)] p-2 text-[var(--shell-text-label)]">
    <button type="button" onClick={() => void open()} disabled={loading} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1 font-medium">
      {loading ? t('Loading verified collision meshes…') : t('View collision pair in 3D')}
    </button>
    <p className="mt-1">{t('Loads the authenticated part ZIP on demand and checks both STL hashes against this measured collision. No export or model call.')}</p>
    {error && <p className="mt-1 text-[var(--shell-fail)]" role="alert">{t('Collision pair replay is unavailable')}: {error}</p>}
    {visible && <div>
      <CollisionPairViewer pair={visible} />
      <p className="mt-1 font-mono text-[10px] break-all">{t('Replayed ZIP SHA-256')}: {visible.archiveSha256}</p>
      {visible.archiveSha256 !== evidenceArchiveSha256 && <p className="mt-1">
        {t('The ZIP was independently regenerated. Its overall hash differs from the inspection snapshot, but the two selected STL hashes match the measured witness.')}
      </p>}
    </div>}
  </div>
}
