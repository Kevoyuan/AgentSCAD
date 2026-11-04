'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import { validateAssemblySpec } from '@/lib/assembly/assembly-spec'

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
  const generatedParts = spec.parts.filter(part => part.source === 'generated')
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
        <button type="button" disabled={bundling || downloading !== null} onClick={() => void downloadBundle()} className="rounded border border-[color:var(--shell-hairline)] px-2 py-1">{bundling ? t('Preparing…') : t('Download all parts (ZIP)')}</button>
        <p className="mt-1 text-[var(--shell-text-label)]">{t('The archive holds one STL per generated part and a manifest with hashes. Identity, fit and motion are not verified.')}</p>
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
