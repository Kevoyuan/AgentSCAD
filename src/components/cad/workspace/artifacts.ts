'use client'

/*
 * Artifact helpers for the 检验 module (DESIGN.md section 6, "Output and revisions").
 *
 * The output rows show the real size of the file the user is about to download.
 * The size comes from the artifact response's Content-Length; the body is aborted
 * immediately after the headers arrive, so this never downloads the mesh.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Job } from '@/components/cad/types'

const sizeCache = new Map<string, number>()

export function useArtifactSize(jobId: string | null, type: 'stl' | 'scad', enabled: boolean) {
  const key = jobId ? `${jobId}:${type}` : null
  const [size, setSize] = useState<number | null>(() => (key ? sizeCache.get(key) ?? null : null))
  // The cache is module-level, so a key change must be reflected during render
  // rather than through an effect that would schedule a second render pass.
  const [cachedKey, setCachedKey] = useState(key)

  if (cachedKey !== key) {
    setCachedKey(key)
    setSize(key ? sizeCache.get(key) ?? null : null)
  }

  useEffect(() => {
    if (!key || !enabled) return
    if (sizeCache.has(key)) return

    const controller = new AbortController()
    let cancelled = false

    fetch(`/api/jobs/${jobId}/artifacts/${type}`, { signal: controller.signal })
      .then(res => {
        const length = res.headers.get('content-length')
        if (!cancelled && length) {
          const bytes = Number(length)
          if (Number.isFinite(bytes) && bytes > 0) {
            sizeCache.set(key, bytes)
            setSize(bytes)
          }
        }
        controller.abort()
      })
      .catch(() => {
        /* size is decorative telemetry; a missing one must not surface as an error */
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key, jobId, type, enabled])

  return size
}

export async function downloadArtifact(job: Job, type: 'stl' | 'scad') {
  const toastId = `${type}-download-${job.id}`
  toast.loading(type === 'stl' ? 'Fetching STL…' : 'Fetching OpenSCAD…', { id: toastId })
  try {
    // `download=1` marks this as a real user export rather than a viewer or size fetch,
    // so the outcome ledger only sees deliberate downloads.
    const res = await fetch(`/api/jobs/${job.id}/artifacts/${type}?download=1`, {
      credentials: 'include',
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `Artifact unavailable`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safePart = (job.partFamily || 'part').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const filename = `${job.id.slice(0, 8)}-${safePart}.${type}`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(type === 'stl' ? 'STL downloaded' : 'OpenSCAD downloaded', {
      id: toastId,
      description: filename,
    })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Download failed', { id: toastId })
  }
}
