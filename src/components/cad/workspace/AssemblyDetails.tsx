'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import { validateAssemblySpec } from '@/lib/assembly/assembly-spec'
import type { AssemblyEvidenceReport } from '@/lib/assembly/assembly-evidence-report'

type AssemblyResponse = { spec: unknown | null; stale: boolean; sourceSha256?: string | null; currentSourceSha256?: string | null; specSha256?: string | null; provenance?: 'generated' | 'user' | null; embeddedStatus?: 'valid' | 'invalid' | 'absent'; evidence?: Record<string, { status?: string }> }
type AssemblyRevisionView = { id: string; revision: number | null; savedAt: string; specSha256: string; sourceSha256?: string | null; stale: boolean; spec: unknown }

const emptyDraft = {
  schemaVersion: 1, units: 'mm', coordinateSystem: 'right-handed', parts: [], instances: [], subassemblies: [],
  connections: [], groundedInstanceId: null, motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
}

/** Check locally for useful feedback; the server checks again against the current source. */
export function parseAssemblyDraft(text: string) {
  let value: unknown
  try { value = JSON.parse(text) } catch { return { error: 'The description is not valid JSON.' as const } }
  const parsed = validateAssemblySpec(value)
  if (!parsed.success) return { error: 'The assembly description is incomplete or invalid.' as const, details: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`) }
  return { spec: parsed.data }
}

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export async function saveAssemblyDraft(jobId: string, draft: string, sourceSha256: string, expectedSpecSha256: string | null | undefined, request: Request = fetch) {
  const parsed = parseAssemblyDraft(draft)
  if (!parsed.spec) return { error: parsed.error, details: parsed.details }
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) return { error: 'Generate or apply source before saving an assembly description.' as const }
  if (expectedSpecSha256 === undefined || (expectedSpecSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSpecSha256))) return { error: 'The part or source is unavailable. Refresh the assembly information.' as const }
  try {
    const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/assembly`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: parsed.spec, sourceSha256, expectedSpecSha256 }),
    })
    if (response.status === 409) return { error: 'The source or job changed. Refresh the assembly information and review your draft before saving again.' as const, conflict: true }
    if (!response.ok) return { error: 'The assembly description could not be saved.' as const }
    return { data: await response.json() as AssemblyResponse }
  } catch { return { error: 'The assembly description could not be saved.' as const } }
}

/** This obtains an STL; it does not verify that the selector represents the intended part. */
export async function fetchAssemblyPart(jobId: string, partId: string, sourceSha256: string, specSha256: string, request: Request = fetch) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(partId) || !/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(specSha256)) return { error: 'The part or source is unavailable. Refresh the assembly information.' as const }
  try {
    const query = new URLSearchParams({ sourceSha256, specSha256, download: '1' })
    const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/assembly/parts/${encodeURIComponent(partId)}?${query}`, { credentials: 'include' })
    if (response.status === 409) return { error: 'The source or assembly changed. Refresh the assembly information before downloading.' as const }
    if (!response.ok) return { error: 'The part could not be exported.' as const }
    const blob = await response.blob()
    if (!blob.size) return { error: 'The part could not be exported.' as const }
    return { blob }
  } catch { return { error: 'The part could not be exported.' as const } }
}

/** The archive is built only when every part renders and the selectors stay distinct. */
export async function fetchAssemblyBundle(jobId: string, sourceSha256: string, specSha256: string, request: Request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(specSha256)) return { error: 'The source is unavailable. Refresh the assembly information.' as const }
  try {
    const query = new URLSearchParams({ sourceSha256, specSha256, download: '1' })
    const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/assembly/bundle?${query}`, { credentials: 'include' })
    if (response.status === 409) return { error: 'The source or assembly changed. Refresh the assembly information before downloading.' as const }
    if (response.status === 422) return { error: 'The source did not produce independently selectable parts, so no archive was created.' as const }
    if (!response.ok) return { error: 'The parts could not be exported.' as const }
    const blob = await response.blob()
    if (!blob.size) return { error: 'The parts could not be exported.' as const }
    return { blob }
  } catch { return { error: 'The parts could not be exported.' as const } }
}

/** Reconstructs only complete generated-part layouts; no CAD function is implied. */
export async function fetchAssemblyLayout(jobId: string, sourceSha256: string, specSha256: string, request: Request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(specSha256)) {
    return { error: 'The source is unavailable. Refresh the assembly information.' as const }
  }
  try {
    const query = new URLSearchParams({ sourceSha256, specSha256, download: '1' })
    const url = '/api/jobs/' + encodeURIComponent(jobId) + '/assembly/layout?' + query
    const response = await request(url, { credentials: 'include' })
    if (response.status === 409) return { error: 'The source or assembly changed. Refresh the assembly information before downloading.' as const }
    if (response.status === 422) return { error: 'The layout is unavailable because parts are missing or geometry cannot be reconstructed.' as const }
    if (!response.ok) return { error: 'The assembly layout could not be exported.' as const }
    const blob = await response.blob()
    if (!blob.size) return { error: 'The assembly layout could not be exported.' as const }
    return { blob }
  } catch { return { error: 'The assembly layout could not be exported.' as const } }
}

/** Runs a fresh, explicit measurement; never loads a stored or inferred PASS. */
export async function fetchAssemblyEvidence(jobId: string, sourceSha256: string, specSha256: string, request: Request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(specSha256)) {
    return { error: 'The source is unavailable. Refresh the assembly information.' as const }
  }
  try {
    const query = new URLSearchParams({ sourceSha256, specSha256 })
    const response = await request('/api/jobs/' + encodeURIComponent(jobId) + '/assembly/evidence?' + query, { credentials: 'include' })
    if (response.status === 409) return { error: 'The source or assembly changed. Refresh the assembly information before checking.' as const }
    if (response.status === 422) return { error: 'Assembly parts are not independently selectable or have no generated meshes.' as const }
    if (!response.ok) return { error: 'Assembly measurement could not be completed.' as const }
    const data = await response.json() as AssemblyEvidenceReport
    if (data?.reportSchemaVersion !== 1 || data.sourceSha256 !== sourceSha256 || data.specificationSha256 !== specSha256) {
      return { error: 'Assembly measurement does not match this source and specification.' as const }
    }
    return { report: data }
  } catch { return { error: 'Assembly measurement could not be completed.' as const } }
}

type EvidenceSnapshotView = {
  id: string
  savedAt: string
  integrity: 'PASS' | 'ERROR'
  bindingCurrent: boolean
  reasons: string[]
  snapshot: { schemaVersion: 1; checkedAt: string; checkerVersion: string; snapshotSha256: string; report: AssemblyEvidenceReport } | null
}

export async function fetchAssemblyEvidenceHistory(jobId: string, request: Request = fetch, cursor?: string) {
  try {
    const base = '/api/jobs/' + encodeURIComponent(jobId) + '/assembly/evidence/snapshots'
    const response = await request(base + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { credentials: 'include' })
    if (!response.ok) return { error: 'Saved assembly evidence could not be loaded.' as const }
    const data = await response.json() as { snapshots?: EvidenceSnapshotView[]; nextCursor?: string | null }
    if (!Array.isArray(data.snapshots)) return { error: 'Saved assembly evidence could not be loaded.' as const }
    return { snapshots: data.snapshots, nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null }
  } catch { return { error: 'Saved assembly evidence could not be loaded.' as const } }
}

export async function recordAssemblyEvidenceSnapshot(jobId: string, sourceSha256: string, specSha256: string, request: Request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(specSha256)) {
    return { error: 'The source is unavailable. Refresh the assembly information.' as const }
  }
  try {
    const query = new URLSearchParams({ sourceSha256, specSha256 })
    const response = await request('/api/jobs/' + encodeURIComponent(jobId) + '/assembly/evidence/snapshots?' + query, {
      method: 'POST', credentials: 'include',
    })
    if (response.status === 409) return { error: 'The source or assembly changed. Refresh the assembly information before checking.' as const }
    if (response.status === 422) return { error: 'Assembly parts are not independently selectable or have no generated meshes.' as const }
    if (response.status !== 201) return { error: 'Assembly evidence snapshot could not be recorded.' as const }
    const data = await response.json() as { id?: string; snapshot?: EvidenceSnapshotView['snapshot'] }
    if (!data.snapshot || data.snapshot.schemaVersion !== 1 ||
      data.snapshot.report.sourceSha256 !== sourceSha256 ||
      data.snapshot.report.specificationSha256 !== specSha256 ||
      !/^[a-f0-9]{64}$/.test(data.snapshot.snapshotSha256) || !data.id) {
      return { error: 'Saved evidence does not match the requested assembly.' as const }
    }
    return { id: data.id }
  } catch { return { error: 'Assembly evidence snapshot could not be recorded.' as const } }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** An intent contract is not evidence that the geometry implements it. */
export function AssemblyDetails({ data, jobId, canExport = false }: { data: AssemblyResponse; jobId?: string; canExport?: boolean }) {
  const { t } = useI18n()
  const [downloading, setDownloading] = React.useState<string | null>(null)
  const [bundling, setBundling] = React.useState(false)
  const [layingOut, setLayingOut] = React.useState(false)
  const [inspecting, setInspecting] = React.useState(false)
  const [inspection, setInspection] = React.useState<{ jobId: string; report: AssemblyEvidenceReport } | null>(null)
  const [inspectionError, setInspectionError] = React.useState('')
  const [savingEvidence, setSavingEvidence] = React.useState(false)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState('')
  const [historyMessage, setHistoryMessage] = React.useState('')
  const [savedHistory, setSavedHistory] = React.useState<{ jobId: string; sourceSha256: string; specSha256: string; snapshots: EvidenceSnapshotView[]; nextCursor: string | null } | null>(null)
  const [downloadError, setDownloadError] = React.useState('')
  if (data.spec === null) return data.embeddedStatus === 'invalid' ? <p role="alert" className="py-2 text-xs text-[var(--shell-fail)]">{t('The generated assembly description could not be read. It is not verified.')}</p> : null
  const parsed = validateAssemblySpec(data.spec)
  if (!parsed.success) {
    return <p role="status" className="py-2 text-xs text-[var(--shell-fail)]">{t('Assembly information could not be read.')}</p>
  }
  const spec = parsed.data
  const instances = new Map(spec.instances.map(instance => [instance.id, instance]))
  const parts = new Map(spec.parts.map(part => [part.id, part]))
  const instanceLabel = (id: string) => {
    const instance = instances.get(id)
    const part = instance ? parts.get(instance.partId) : undefined
    return part ? `${part.name} (${id})` : id
  }
  const canDownload = Boolean(canExport && jobId && !data.stale && data.sourceSha256 && data.sourceSha256 === data.currentSourceSha256 && /^[a-f0-9]{64}$/.test(data.sourceSha256) && data.specSha256 && /^[a-f0-9]{64}$/.test(data.specSha256))
  const download = async (partId: string) => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setDownloading(partId); setDownloadError('')
    const result = await fetchAssemblyPart(jobId, partId, data.sourceSha256, data.specSha256)
    if (result.error) { setDownloadError(result.error); setDownloading(null); return }
    if (result.blob) {
      try { saveBlob(result.blob, `agentscad-${partId.replace(/[^A-Za-z0-9_-]/g, '_')}.stl`) }
      catch { setDownloadError('The part could not be exported.') }
    }
    setDownloading(null)
  }
  const downloadBundle = async () => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setBundling(true); setDownloadError('')
    const result = await fetchAssemblyBundle(jobId, data.sourceSha256, data.specSha256)
    if (result.error) { setDownloadError(result.error); setBundling(false); return }
    if (result.blob) {
      try { saveBlob(result.blob, `agentscad-assembly-${jobId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`) }
      catch { setDownloadError('The parts could not be exported.') }
    }
    setBundling(false)
  }
  const downloadLayout = async () => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setLayingOut(true); setDownloadError('')
    const result = await fetchAssemblyLayout(jobId, data.sourceSha256, data.specSha256)
    if (result.error) { setDownloadError(result.error); setLayingOut(false); return }
    if (result.blob) {
      try { saveBlob(result.blob, 'agentscad-layout-' + jobId.replace(/[^A-Za-z0-9_-]/g, '_') + '.stl') }
      catch { setDownloadError('The assembly layout could not be exported.') }
    }
    setLayingOut(false)
  }
  const inspect = async () => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setInspecting(true)
    setInspection(null)
    setInspectionError('')
    const result = await fetchAssemblyEvidence(jobId, data.sourceSha256, data.specSha256)
    if (result.error) setInspectionError(result.error)
    else if (result.report) setInspection({ jobId, report: result.report })
    setInspecting(false)
  }
  const report = inspection !== null && inspection.jobId === jobId && !data.stale &&
    inspection.report.sourceSha256 === data.sourceSha256 &&
    inspection.report.specificationSha256 === data.specSha256
      ? inspection.report : null
  const loadHistory = async () => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setHistoryLoading(true)
    setHistoryError('')
    const result = await fetchAssemblyEvidenceHistory(jobId)
    if (result.error) setHistoryError(result.error)
    else if (result.snapshots) setSavedHistory({ jobId, sourceSha256: data.sourceSha256, specSha256: data.specSha256, snapshots: result.snapshots, nextCursor: result.nextCursor ?? null })
    setHistoryLoading(false)
  }
  const saveEvidence = async () => {
    if (!jobId || !canDownload || !data.sourceSha256 || !data.specSha256) return
    setSavingEvidence(true)
    setHistoryError('')
    setHistoryMessage('')
    const result = await recordAssemblyEvidenceSnapshot(jobId, data.sourceSha256, data.specSha256)
    if (result.error) setHistoryError(result.error)
    else {
      setHistoryMessage('Evidence was re-measured and recorded in immutable history.')
      const saved = await fetchAssemblyEvidenceHistory(jobId)
      if (saved.snapshots) setSavedHistory({ jobId, sourceSha256: data.sourceSha256, specSha256: data.specSha256, snapshots: saved.snapshots, nextCursor: saved.nextCursor ?? null })
      else if (saved.error) setHistoryError(saved.error)
    }
    setSavingEvidence(false)
  }
  const loadOlderHistory = async () => {
    if (!jobId || !savedHistory?.nextCursor || historyLoading || !canDownload) return
    setHistoryLoading(true)
    setHistoryError('')
    const result = await fetchAssemblyEvidenceHistory(jobId, fetch, savedHistory.nextCursor)
    if (result.error) setHistoryError(result.error)
    else if (result.snapshots) {
      setSavedHistory(previous => previous && previous.jobId === jobId && previous.sourceSha256 === data.sourceSha256 &&
        previous.specSha256 === data.specSha256
          ? { ...previous, snapshots: [...previous.snapshots, ...result.snapshots!], nextCursor: result.nextCursor ?? null }
          : previous)
    }
    setHistoryLoading(false)
  }
  const history = savedHistory !== null && savedHistory.jobId === jobId &&
    savedHistory.sourceSha256 === data.sourceSha256 &&
    savedHistory.specSha256 === data.specSha256 && !data.stale
      ? savedHistory.snapshots : null
  const generatedParts = spec.parts.filter(part => part.source === 'generated')
  const hasPurchasedInstances = spec.instances.some(instance => spec.parts.some(part => part.id === instance.partId && part.source === 'purchased'))
  return (
    <section className="border-t border-[color:var(--shell-hairline)] py-[10px] text-xs" aria-label={t('Assembly')}>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-text-label)]">{t('Assembly')}</h3>
      {data.provenance && <p className="mt-2 text-[var(--shell-text-label)]">{data.provenance === 'generated' ? t('Generated description') : t('User-edited description')}</p>}
      {data.stale && <p role="status" className="mt-2 text-[var(--shell-fail)]">{t('This assembly description belongs to an earlier source version.')}</p>}
      <p className="mt-2 text-[var(--shell-text-label)]">{t('Assembly requirements are recorded. Part identity, fit, motion and physical function are not verified by this description.')}</p>
      <p className="mt-2 text-[var(--shell-text-label)]">{t('A part decision does not confirm acceptance of this assembly description.')}</p>
      {canDownload && <p className="mt-2 text-[var(--shell-text-label)]">{t('Part exports have not been checked for identity or fit.')}</p>}
      {downloadError && <p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(downloadError)}</p>}
      <ul className="mt-2 space-y-1 text-[var(--shell-text-label)]" aria-label={t('Assembly evidence')}>
        {(['identity', 'geometry', 'assembly', 'disassembly', 'motion', 'physical'] as const).map(key => {
          const status = data.evidence?.[key]?.status
          const labels = { identity: 'Part identity', geometry: 'Part geometry', assembly: 'Assembly fit', disassembly: 'Disassembly', motion: 'Motion', physical: 'Physical function' }
          const word = status === 'NOT_RUN' ? t('Not checked') : status === 'FAIL' ? t('Fail') : status === 'ERROR' ? t('Unavailable') : status === 'SKIP' ? t('Not applicable') : status === 'PASS' ? t('Pass') : t('Unknown')
          return <li key={key}>{t(labels[key])}: {data.stale ? t('Out of date') : word}</li>
        })}
      </ul>
      {canDownload && generatedParts.length > 0 && <div className="mt-2">
        <button type="button" disabled={bundling || layingOut || downloading !== null} onClick={() => void downloadBundle()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{bundling ? t('Preparing…') : t('Download all parts (ZIP)')}</button>
        <p className="mt-1 text-[var(--shell-text-label)]">{t('The archive holds one STL per generated part and a manifest with hashes. Identity, fit and motion are not verified.')}</p>
      </div>}
      {canDownload && generatedParts.length > 0 && <div className="mt-2">
        {!hasPurchasedInstances
          ? <button type="button" disabled={layingOut || bundling || downloading !== null} onClick={() => void downloadLayout()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{layingOut ? t('Preparing…') : t('Download assembly layout (STL)')}</button>
          : <p className="text-[var(--shell-text-label)]">{t('Layout STL unavailable: purchased instances have no geometry. Download the ZIP instead.')}</p>}
        <p className="mt-1 text-[var(--shell-text-label)]">{t('Layout STL positions part instances for viewing only. It is not a printable union or proof of fit, motion or physical function.')}</p>
      </div>}
      {canDownload && generatedParts.length > 0 && <div className="mt-3 border-t border-[color:var(--shell-hairline)] pt-2">
        <button type="button" disabled={inspecting || downloading !== null || bundling || layingOut} onClick={() => void inspect()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{inspecting ? t('Measuring assembly…') : t('Run assembly geometry checks')}</button>
        <p className="mt-1 text-[var(--shell-text-label)]">{t('This renders the current parts on demand. Results are a one-time snapshot, not saved validation or proof of physical function.')}</p>
        {inspectionError && <p role="alert" className="mt-1 text-[var(--shell-fail)]">{t(inspectionError)}</p>}
        {report && <section className="mt-2" aria-label={t('Measured assembly evidence')}>
          <p className="font-medium">{t('Measurement snapshot')} · {report.archiveSha256.slice(0, 12)}</p>
          <p className="mt-1 text-[var(--shell-text-label)]">{t('Requirement contract')}: {report.contract.evidenceCurrent === true ? t('Confirmed') : t('Unconfirmed or stale')}</p>
          <p className="mt-1 text-[var(--shell-text-label)]">{t('Measured PASS does not count as approved PASS when the requirement contract is unconfirmed or stale.')}</p>
          <ul className="mt-2 space-y-1" aria-label={t('Measured evidence layers')}>
            {Object.entries(report.evidence).map(([key, item]) =>
              <li key={key}><span className="font-medium">{t(key)}: {item.status}</span><span className="block text-[var(--shell-text-label)]">{item.reason}</span></li>)}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer">{t('Disassembly measurements')} · {report.disassembly.status} ({t('Raw measurement')}: {report.disassembly.measuredStatus})</summary>
            <p className="mt-1 text-[var(--shell-text-label)]">{report.disassembly.method}: {report.disassembly.coverage}</p>
            <p className="mt-1">{t('Operations evaluated')}: {report.disassembly.totalOperations}</p>
            {report.disassembly.omittedOperations > 0 && <p>{t('Additional operations omitted from this summary')}: {report.disassembly.omittedOperations}</p>}
            <ol className="mt-1 space-y-2">
              {report.disassembly.operations.map(op => <li key={op.operationId}>
                <strong>{op.operationId} ({op.instanceId}): {op.measuredStatus}</strong>
                <p>{op.reason}</p>
                {op.path && <p className="text-[var(--shell-text-label)]">{t('Sampled poses')}: {op.path.posesEvaluated}/{op.path.declaredPoseCount}; {t('Maximum translation step')}: {op.path.translationStepMm.toFixed(3)} mm; {t('Maximum rotation step')}: {op.path.rotationStepDeg.toFixed(2)}°</p>}
                {op.path && <p className="text-[var(--shell-text-label)]">{t('Triangle pairs evaluated')}: {op.path.testedTrianglePairs}</p>}
                {op.path?.blockedAt && <div className="text-[var(--shell-fail)]">
                  <p>{t('First blocked pose')}: {op.path.blockedAt.poseIndex}; {t('Blocking instance')}: {op.path.blockedAt.obstacleId} ({op.path.blockedAt.collision})</p>
                  <p>{t('Triangle pairs evaluated at blocking pose')}: {op.path.blockedAt.testedPairs}</p>
                  <p>{op.path.blockedAt.collisionReason}</p>
                  {op.path.blockedAt.trianglePair && <p>{t('Intersecting triangle IDs')}: {op.path.blockedAt.trianglePair.movingTriangleIndex} / {op.path.blockedAt.trianglePair.obstacleTriangleIndex}</p>}
                  {op.path.blockedAt.witnessCentroidPointMm && <p>{t('Approximate triangle-centroid witness (mm)')}: {op.path.blockedAt.witnessCentroidPointMm.map(x => x.toFixed(3)).join(', ')}</p>}
                  <p>{t('The witness is not an exact contact point or penetration measurement.')}</p>
                </div>}
                {op.path?.undecidedAt && <div className="text-[var(--shell-fail)]">
                  <p>{t('Undecided pose')}: {op.path.undecidedAt.poseIndex}; {t('Blocking instance')}: {op.path.undecidedAt.obstacleId} ({op.path.undecidedAt.collision})</p>
                  <p>{t('Triangle pairs evaluated')}: {op.path.undecidedAt.testedPairs}; {t('Collision budget exhausted')}: {op.path.undecidedAt.budgetExhausted ? t('Yes') : t('No')}</p>
                  <p>{op.path.undecidedAt.reason}</p>
                </div>}
              </li>)}
            </ol>
          </details>
          {report.fitBinding && <section className="mt-2" aria-label={t('Contract fit binding')}>
            <p className="font-medium">{t('Contract fit binding')}: {report.fitBinding.status} · {t('Feature identity')}: {report.fitBinding.featureIdentityStatus}</p>
            <p className="text-[var(--shell-text-label)]">{report.fitBinding.reason}</p>
            <p className="text-[var(--shell-text-label)]">{t('A declared bore/shaft role is not independently verified. Candidate dimensions are diagnostic only, never final fit approval.')}</p>
          </section>}
          {report.fits.length > 0 && <details className="mt-2">
            <summary>{t('Fit measurements')}</summary>
            <ul className="space-y-2">{report.fits.map(fit => <li key={fit.connectionId}>
              <strong>{fit.connectionId}: {fit.status} ({t('Raw measurement')}: {fit.measuredStatus})</strong>
              <p>{fit.reason}</p>
              {fit.diametralClearanceMm && <p className="text-[var(--shell-text-label)]">{t('Candidate diametral clearance')}: {fit.diametralClearanceMm.min.toFixed(3)}–{fit.diametralClearanceMm.max.toFixed(3)} mm</p>}
              {fit.axisOffsetMm !== null && <p className="text-[var(--shell-text-label)]">{t('Candidate axis offset')}: {fit.axisOffsetMm.toFixed(3)} mm</p>}
              {fit.boreRoleCheck && <p className={fit.boreRoleCheck.status === 'OBSERVED' && fit.boreRoleCheck.observedRole !== 'bore' ? 'text-[var(--shell-fail)]' : 'text-[var(--shell-text-label)]'}>
                {t('Declared bore, observed section')}: {fit.boreRoleCheck.status === 'OBSERVED' ? t(fit.boreRoleCheck.observedRole ?? 'Unknown') : t('Not checked')} · {fit.boreRoleCheck.stationsChecked}/{fit.boreRoleCheck.stationsRequested} {t('stations')} · {fit.boreRoleCheck.reason}
              </p>}
              {fit.shaftRoleCheck && <p className={fit.shaftRoleCheck.status === 'OBSERVED' && fit.shaftRoleCheck.observedRole !== 'shaft' ? 'text-[var(--shell-fail)]' : 'text-[var(--shell-text-label)]'}>
                {t('Declared shaft, observed section')}: {fit.shaftRoleCheck.status === 'OBSERVED' ? t(fit.shaftRoleCheck.observedRole ?? 'Unknown') : t('Not checked')} · {fit.shaftRoleCheck.stationsChecked}/{fit.shaftRoleCheck.stationsRequested} {t('stations')} · {fit.shaftRoleCheck.reason}
              </p>}
              <p className="text-[var(--shell-text-label)]">{t('Observed solid or void at sampled sections is not proof of the intended feature or calibrated uncertainty.')}</p>
            </li>)}</ul>
          </details>}
          <p className="mt-2 text-[var(--shell-text-label)]">{t('Sampled poses do not prove continuous clearance, tool access, manufacturability or physical function.')}</p>
        </section>}
      </div>}
      {canDownload && generatedParts.length > 0 && <div className="mt-3 border-t border-[color:var(--shell-hairline)] pt-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={savingEvidence || inspecting || historyLoading || bundling || layingOut || downloading !== null} onClick={() => void saveEvidence()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{savingEvidence ? t('Recording measurement…') : t('Save new evidence snapshot')}</button>
          <button type="button" disabled={savingEvidence || historyLoading} onClick={() => void loadHistory()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{historyLoading ? t('Loading history…') : t('View saved evidence')}</button>
        </div>
        <p className="mt-1 text-[var(--shell-text-label)]">{t('Saving re-runs the measurements on the server. A snapshot is historical when source, specification, requirement confirmation or checker version changes.')}</p>
        {historyMessage && <p role="status" className="mt-1 text-[var(--shell-text-label)]">{t(historyMessage)}</p>}
        {historyError && <p role="alert" className="mt-1 text-[var(--shell-fail)]">{t(historyError)}</p>}
        {history && <section className="mt-2" aria-label={t('Saved evidence history')}>
          {history.length === 0 ? <p>{t('No evidence snapshots recorded yet.')}</p>
          : <ol className="space-y-2">{history.map(item => <li key={item.id} className="rounded border border-[color:var(--shell-hairline)] p-2">
              <p>{new Date(item.savedAt).toLocaleString()} · {item.integrity !== 'PASS' ? t('Corrupt evidence record') : item.bindingCurrent ? t('Matches current versions') : t('Historical only — NOT current')}</p>
              {item.reasons.length > 0 && <p className="text-[var(--shell-fail)]">{item.reasons.join('; ')}</p>}
              {item.snapshot && <>
                <p className="font-mono text-[var(--shell-text-label)]">{item.snapshot.snapshotSha256.slice(0, 16)}</p>
                <p>{t('Disassembly standing')}: {item.bindingCurrent ? item.snapshot.report.evidence.disassembly.status : 'NOT_RUN'} {item.bindingCurrent ? '' : '(' + t('Historical result; not current') + ')'}</p>
                <p>{t('Raw measurement')}: {item.snapshot.report.disassembly.measuredStatus} · {t('Requirement contract')}: {item.snapshot.report.contract.evidenceCurrent ? t('Confirmed') : t('Unconfirmed or stale')}</p>
                <button type="button" className="mt-1 rounded border border-[color:var(--shell-hairline)] px-2 py-1" onClick={() => saveBlob(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }), 'agentscad-evidence-' + item.snapshot!.snapshotSha256.slice(0, 12) + '.json')}>{t('Download evidence JSON')}</button>
              </>}
            </li>)}</ol>}
          {savedHistory?.nextCursor && <button type="button" disabled={historyLoading} onClick={() => void loadOlderHistory()} className="mt-2 rounded border border-[color:var(--shell-hairline)] px-2 py-1">{t('Load older evidence')}</button>}
          <p className="mt-2 text-[var(--shell-text-label)]">{t('Saved hashes detect changes but do not authenticate source or prove physical function. Refresh this history after edits.')}</p>
        </section>}
      </div>}
      <details className="mt-2">
        <summary className="cursor-pointer">{t('{0} part types · {1} instances · {2} connections', { 0: spec.parts.length, 1: spec.instances.length, 2: spec.connections.length })}</summary>
        <ul className="mt-2 space-y-1">
          {spec.parts.map(part => <li key={part.id} className="flex flex-wrap items-center gap-2"><span>{part.name} <span className="text-[var(--shell-text-label)]">({part.id}) · {t('{0} instances', { 0: spec.instances.filter(instance => instance.partId === part.id).length })}{part.source === 'purchased' ? ` · ${t('Purchased')}` : ''}</span></span>{canDownload && part.source === 'generated' && <button type="button" disabled={downloading !== null} onClick={() => void download(part.id)} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" aria-label={t('Download unverified STL for {0}', { 0: part.name })}>{downloading === part.id ? t('Preparing…') : t('Download unverified STL')}</button>}</li>)}
        </ul>
        <h4 className="mt-3 font-medium">{t('Instances')}</h4><ul className="mt-1 space-y-1">{spec.instances.map(instance => <li key={instance.id}>{instanceLabel(instance.id)}</li>)}</ul>
        {spec.connections.length > 0 && <><h4 className="mt-3 font-medium">{t('Connections')}</h4><ul className="mt-1 space-y-1">{spec.connections.map(connection => <li key={connection.id}>{instanceLabel(connection.a)} ↔ {instanceLabel(connection.b)} <span className="text-[var(--shell-text-label)]">({t(connection.type)})</span></li>)}</ul></>}
        {spec.unknowns.length > 0 && <><h4 className="mt-3 font-medium">{t('Unknown conditions')}</h4><ul className="mt-1 space-y-1">{spec.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></>}
      </details>
    </section>
  )
}

/** History is read-only. Loading a version fills the editor; nothing is applied until it is saved. */
export function AssemblyRevisions({ revisions, currentSpecSha256, onLoad }: { revisions: AssemblyRevisionView[]; currentSpecSha256?: string | null; onLoad: (spec: unknown) => void }) {
  const { t } = useI18n()
  if (revisions.length === 0) return null
  return (
    <section className="mt-3 text-xs" aria-label={t('Saved versions')}>
      <h4 className="font-medium">{t('Saved versions')}</h4>
      <p className="mt-1 text-[var(--shell-text-label)]">{t('Saving adds a version. Loading one fills the editor; it is not applied until you save.')}</p>
      <ul className="mt-1 space-y-1">
        {revisions.map(revision => <li key={revision.id} className="flex flex-wrap items-center gap-2">
          <span>{revision.revision === null ? t('Saved version') : t('Version {0}', { 0: revision.revision })} · {new Date(revision.savedAt).toLocaleString()}</span>
          <span className="font-mono text-[var(--shell-text-label)]">{revision.specSha256.slice(0, 8)}</span>
          {revision.stale && <span className="text-[var(--shell-fail)]">{t('Earlier source')}</span>}
          {currentSpecSha256 === revision.specSha256 && <span className="text-[var(--shell-text-label)]">{t('Current')}</span>}
          <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" onClick={() => onLoad(revision.spec)}>{t('Load into editor')}</button>
        </li>)}
      </ul>
    </section>
  )
}

export function JobAssemblyDetails({ jobId, revision, canExport }: { jobId: string; revision: string; canExport: boolean }) {
  const { t } = useI18n()
  const [state, setState] = React.useState<{ data?: AssemblyResponse; error?: boolean }>({})
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [details, setDetails] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [revisions, setRevisions] = React.useState<AssemblyRevisionView[]>([])
  React.useEffect(() => {
    if (editing) return
    const controller = new AbortController()
    setState({})
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/assembly`, { credentials: 'include', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Assembly request failed'); return response.json() })
      .then(data => { if (!controller.signal.aborted) setState({ data }) })
      .catch(() => { if (!controller.signal.aborted) setState({ error: true }) })
    return () => controller.abort()
  }, [jobId, revision, editing])
  if (state.error) return <p role="status" className="py-2 text-xs text-[var(--shell-text-label)]">{t('Assembly information is unavailable.')}</p>
  if (!state.data) return null
  const data = state.data
  const openEditor = async () => {
    setDraft(JSON.stringify(data.spec ?? emptyDraft, null, 2))
    setMessage(''); setDetails([]); setEditing(true)
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/assembly/revisions`, { credentials: 'include' })
      if (!response.ok) return
      const next = await response.json() as { revisions?: AssemblyRevisionView[] }
      setRevisions(Array.isArray(next.revisions) ? next.revisions : [])
    } catch { /* History is optional; the editor still works without it. */ }
  }
  const refresh = async () => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/assembly`, { credentials: 'include' })
      if (!response.ok) throw new Error('Refresh failed')
      const next = await response.json() as AssemblyResponse
      setState({ data: next })
      setMessage('Assembly information refreshed. Review your draft against the current source before saving.')
      setDetails([])
    } catch { setMessage('Assembly information is unavailable.') }
  }
  const save = async () => {
    setSaving(true)
    const result = await saveAssemblyDraft(jobId, draft, data.currentSourceSha256 ?? '', data.specSha256)
    setSaving(false)
    if (result.error) { setMessage(result.error); setDetails(result.details ?? []); return }
    if (result.data) { setState({ data: result.data }); setEditing(false); setMessage('') }
  }
  return <>
    <AssemblyDetails data={data} jobId={jobId} canExport={canExport && !editing} />
    {editing ? <section className="border-t border-[color:var(--shell-hairline)] py-3 text-xs" aria-label={t('Edit assembly description')}>
      <h3 className="font-medium">{t('Edit assembly description')}</h3>
      <p className="mt-2 text-[var(--shell-text-label)]">{t('Describe the parts and connections as JSON. Saving records your declaration; it does not verify the model.')}</p>
      {!data.spec && <p className="mt-2 text-[var(--shell-text-label)]">{t('Add at least one part and one instance to the empty template.')}</p>}
      {data.stale && <p className="mt-2 text-[var(--shell-fail)]">{t('Review this earlier description against the current source before saving.')}</p>}
      <label htmlFor="assembly-description" className="mt-2 block">{t('Assembly description (JSON)')}</label>
      <textarea id="assembly-description" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} rows={12} className="mt-1 w-full rounded border border-[color:var(--shell-hairline)] bg-transparent p-2 font-mono text-xs" />
      <AssemblyRevisions revisions={revisions} currentSpecSha256={data.specSha256} onLoad={spec => setDraft(JSON.stringify(spec, null, 2))} />
      {message && <p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(message)}</p>}
      {details.length > 0 && <ul className="mt-1 text-[var(--shell-text-label)]">{details.map((detail, i) => <li key={i}>{detail}</li>)}</ul>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" disabled={saving} onClick={() => void save()}>{saving ? t('Saving…') : t('Save assembly description')}</button>
        <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" disabled={saving} onClick={() => void refresh()}>{t('Refresh source')}</button>
        <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" disabled={saving} onClick={() => setEditing(false)}>{t('Cancel')}</button>
      </div>
    </section> : <button type="button" className="mb-3 rounded border border-[color:var(--shell-hairline)] px-2 py-1 text-xs" onClick={() => void openEditor()}>{data.spec ? t('Edit assembly description') : t('Create assembly description')}</button>}
  </>
}
