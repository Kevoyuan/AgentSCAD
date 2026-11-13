import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'
import { AssemblyDetails, AssemblyRevisions, fetchAssemblyBundle, fetchAssemblyLayout, fetchAssemblyEvidence, fetchAssemblyPart, parseAssemblyDraft, saveAssemblyDraft } from '../AssemblyDetails'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const spec = {
  schemaVersion: 1, units: 'mm', coordinateSystem: 'right-handed',
  parts: [{ id: 'base', name: 'Base', selector: 'base', source: 'generated', material: null }, { id: 'pin', name: 'Pin', selector: 'pin', source: 'purchased', material: null }],
  instances: [{ id: 'base1', partId: 'base', subassemblyId: null, transform: identity }, { id: 'pin1', partId: 'pin', subassemblyId: null, transform: identity }, { id: 'pin2', partId: 'pin', subassemblyId: null, transform: identity }],
  subassemblies: [], connections: [{ id: 'joint', type: 'revolute', a: 'base1', b: 'pin1', frameA: null, frameB: null, range: null, pitchMm: null, ratio: null, allowedContact: [] }],
  groundedInstanceId: 'base1', motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: ['Material not specified'],
}
const evidence = Object.fromEntries(['identity', 'geometry', 'assembly', 'disassembly', 'motion', 'physical'].map(key => [key, { status: 'NOT_RUN' }]))
const render = (data: { spec: unknown; stale: boolean; evidence?: Record<string, { status: string }>; provenance?: 'generated' | 'user' | null; embeddedStatus?: 'valid' | 'invalid' | 'absent'; sourceSha256?: string; currentSourceSha256?: string; specSha256?: string }, locale: 'en' | 'zh-CN' = 'en', jobId?: string, canExport = true) => renderToStaticMarkup(
  <I18nContext.Provider value={{ locale, setLocale() {}, t: createTranslator(locale) }}><AssemblyDetails data={data} jobId={jobId} canExport={canExport} /></I18nContext.Provider>,
)

test('shows independent instances, connections and unexecuted evidence without implying a successful assembly', () => {
  const html = render({ spec, stale: false, evidence })
  expect(html).toContain('2 part types · 3 instances · 1 connections')
  expect(html).toContain('Pin (pin2)')
  expect(html).toContain('Base (base1)')
  expect(html).toContain('Material not specified')
  expect(html).toContain('Part identity: Not checked')
  expect(html).toContain('Disassembly: Not checked')
  expect(html).toContain('Physical function: Not checked')
  expect(html).toContain('A part decision does not confirm acceptance of this assembly description.')
  expect(html).not.toContain('Download')
})

test('stale evidence cannot appear current; Chinese labels are available', () => {
  const html = render({ spec, stale: true, evidence: { identity: { status: 'PASS' } } }, 'zh-CN')
  expect(html).toContain('此装配描述对应较早的源码版本')
  expect(html).toContain('零件身份: 已过期')
  expect(html).not.toContain('零件身份: 通过')
})

test('old jobs remain unchanged and malformed contracts display an error', () => {
  expect(render({ spec: null, stale: false })).toBe('')
  expect(render({ spec: {}, stale: false })).toContain('Assembly information could not be read.')
  expect(render({ spec: null, stale: false, embeddedStatus: 'invalid' })).toContain('generated assembly description could not be read')
  expect(render({ spec, stale: false, provenance: 'generated' })).toContain('Generated description')
  expect(render({ spec, stale: false, provenance: 'user' })).toContain('User-edited description')
})

test('validates the editable declaration before sending it', async () => {
  expect(parseAssemblyDraft('{').error).toBe('The description is not valid JSON.')
  expect(parseAssemblyDraft('{}').error).toBe('The assembly description is incomplete or invalid.')
  let sent = 0
  const request = async () => { sent++; return new Response('{}') }
  expect((await saveAssemblyDraft('job', '{}', 'a'.repeat(64), null, request)).error).toContain('invalid')
  expect((await saveAssemblyDraft('job', JSON.stringify(spec), '', null, request)).error).toContain('source')
  expect((await saveAssemblyDraft('job', JSON.stringify(spec), 'a'.repeat(64), undefined, request)).error).toContain('unavailable')
  expect(sent).toBe(0)
})

test('saves the exact current source hash and preserves conflicts for the user to review', async () => {
  let payload: Record<string, unknown> = {}
  let url = ''
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input)
    payload = JSON.parse(String(init?.body))
    return Response.json({ spec, stale: false })
  }
  const result = await saveAssemblyDraft('job id', JSON.stringify(spec), 'b'.repeat(64), 'c'.repeat(64), request)
  expect(url).toBe('/api/jobs/job%20id/assembly')
  expect(payload.sourceSha256).toBe('b'.repeat(64))
  expect(payload.expectedSpecSha256).toBe('c'.repeat(64))
  expect(payload.spec).toEqual(spec)
  expect(result.data?.stale).toBe(false)
  const conflict = async () => new Response('', { status: 409 })
  const denied = await saveAssemblyDraft('job', JSON.stringify(spec), 'b'.repeat(64), null, conflict)
  expect(denied.conflict).toBe(true)
  expect(denied.error).toContain('review your draft')
})

test('only current generated parts expose an unverified STL download', () => {
  const sha = 'a'.repeat(64)
  const data = { spec, stale: false, sourceSha256: sha, currentSourceSha256: sha, specSha256: 'c'.repeat(64), evidence }
  const html = render(data, 'en', 'job')
  expect(html).toContain('Part exports have not been checked for identity or fit.')
  expect(html).toContain('Download unverified STL for Base')
  expect(html).not.toContain('Download unverified STL for Pin')
  expect(render({ ...data, stale: true }, 'en', 'job')).not.toContain('Download unverified STL')
  expect(render({ ...data, currentSourceSha256: 'b'.repeat(64) }, 'en', 'job')).not.toContain('Download unverified STL')
  expect(render({ ...data, specSha256: undefined }, 'en', 'job')).not.toContain('Download unverified STL')
  expect(render(data, 'en', 'job', false)).not.toContain('Download unverified STL')
})

test('download uses the approved source and records an explicit export, with conflicts reported', async () => {
  let url = ''
  let credentials: RequestCredentials | undefined
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input); credentials = init?.credentials
    return new Response('stl data')
  }
  const result = await fetchAssemblyPart('job id', 'base', 'b'.repeat(64), 'c'.repeat(64), request)
  expect(url).toBe(`/api/jobs/job%20id/assembly/parts/base?sourceSha256=${'b'.repeat(64)}&specSha256=${'c'.repeat(64)}&download=1`)
  expect(credentials).toBe('include')
  expect(result.blob?.size).toBe(8)
  const conflict = await fetchAssemblyPart('job', 'base', 'b'.repeat(64), 'c'.repeat(64), async () => new Response('', { status: 409 }))
  expect(conflict.error).toContain('changed')
  const invalid = await fetchAssemblyPart('job', '../bad', 'b'.repeat(64), 'c'.repeat(64), request)
  expect(invalid.error).toContain('unavailable')
  const invalidSpec = await fetchAssemblyPart('job', 'base', 'b'.repeat(64), '', request)
  expect(invalidSpec.error).toContain('unavailable')
})

test('the archive download appears only for a current source and refuses ignored selectors', async () => {
  const sha = 'a'.repeat(64)
  const data = { spec, stale: false, sourceSha256: sha, currentSourceSha256: sha, specSha256: 'c'.repeat(64), evidence }
  expect(render(data, 'en', 'job')).toContain('Download all parts (ZIP)')
  expect(render({ ...data, stale: true }, 'en', 'job')).not.toContain('Download all parts (ZIP)')
  expect(render(data, 'en', 'job', false)).not.toContain('Download all parts (ZIP)')
  const purchasedOnly = { ...data, spec: { ...spec, parts: spec.parts.filter(part => part.source === 'purchased') } }
  expect(render(purchasedOnly, 'en', 'job')).not.toContain('Download all parts (ZIP)')

  let url = ''
  const request = async (input: RequestInfo | URL) => { url = String(input); return new Response('zip data') }
  const result = await fetchAssemblyBundle('job id', 'b'.repeat(64), 'c'.repeat(64), request)
  expect(url).toBe(`/api/jobs/job%20id/assembly/bundle?sourceSha256=${'b'.repeat(64)}&specSha256=${'c'.repeat(64)}&download=1`)
  expect(result.blob?.size).toBe(8)
  const refused = await fetchAssemblyBundle('job', 'b'.repeat(64), 'c'.repeat(64), async () => new Response('', { status: 422 }))
  expect(refused.error).toContain('independently selectable')
  const conflict = await fetchAssemblyBundle('job', 'b'.repeat(64), 'c'.repeat(64), async () => new Response('', { status: 409 }))
  expect(conflict.error).toContain('changed')
  const invalid = await fetchAssemblyBundle('job', '', 'c'.repeat(64), request)
  expect(invalid.error).toContain('unavailable')
})

test('layout download is shown only for a current fully generated assembly', () => {
  const sha = 'a'.repeat(64)
  const data = { spec: { ...spec, parts: spec.parts.filter(part => part.source === 'generated'), instances: spec.instances.filter(instance => instance.partId === 'base'), connections: [] }, stale: false, sourceSha256: sha, currentSourceSha256: sha, specSha256: 'c'.repeat(64), evidence }
  expect(render(data, 'en', 'job')).toContain('Download assembly layout (STL)')
  expect(render(data, 'en', 'job')).toContain('not a printable union or proof of fit')
  expect(render({ ...data, stale: true }, 'en', 'job')).not.toContain('Download assembly layout (STL)')
  expect(render(data, 'en', 'job', false)).not.toContain('Download assembly layout (STL)')
  expect(render({ ...data, specSha256: undefined }, 'en', 'job')).not.toContain('Download assembly layout (STL)')
  const missingPurchased = render({ ...data, spec }, 'en', 'job')
  expect(missingPurchased).toContain('Layout STL unavailable: purchased instances have no geometry')
  expect(missingPurchased).not.toContain('Download assembly layout (STL)')
  expect(missingPurchased).toContain('Download all parts (ZIP)')
})

test('layout request preserves hashes and reports conflicts and incomplete geometry', async () => {
  let url = ''
  let credentials: RequestCredentials | undefined
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input); credentials = init?.credentials
    return new Response('stl data')
  }
  const result = await fetchAssemblyLayout('job id', 'b'.repeat(64), 'c'.repeat(64), request)
  const expected = '/api/jobs/job%20id/assembly/layout?sourceSha256=' + 'b'.repeat(64) + '&specSha256=' + 'c'.repeat(64) + '&download=1'
  expect(url).toBe(expected)
  expect(credentials).toBe('include')
  expect(result.blob?.size).toBe(8)
  const missing = await fetchAssemblyLayout('job', 'b'.repeat(64), 'c'.repeat(64), async () => new Response('', { status: 422 }))
  expect(missing.error).toContain('missing')
  const stale = await fetchAssemblyLayout('job', 'b'.repeat(64), 'c'.repeat(64), async () => new Response('', { status: 409 }))
  expect(stale.error).toContain('changed')
  const invalid = await fetchAssemblyLayout('job', '', 'c'.repeat(64), request)
  expect(invalid.error).toContain('unavailable')
})

test('user-triggered evidence check appears only when source and spec are current', () => {
  const h = 'a'.repeat(64)
  const data = { spec, stale: false, sourceSha256: h, currentSourceSha256: h, specSha256: 'c'.repeat(64), evidence }
  const html = render(data, 'en', 'job')
  expect(html).toContain('Run assembly geometry checks')
  expect(html).toContain('one-time snapshot')
  expect(html).not.toContain('Measurement snapshot')
  expect(render({ ...data, stale: true }, 'en', 'job')).not.toContain('Run assembly geometry checks')
  expect(render(data, 'en', 'job', false)).not.toContain('Run assembly geometry checks')
})

test('evidence request is version-bound and refuses a mismatched report', async () => {
  const sourceSha256 = 'b'.repeat(64)
  const specSha256 = 'c'.repeat(64)
  const report = { reportSchemaVersion: 1, sourceSha256, specificationSha256: specSha256 }
  let requestedUrl = ''
  let requestedCredentials: RequestCredentials | undefined
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input)
    requestedCredentials = init?.credentials
    return Response.json(report)
  }
  const success = await fetchAssemblyEvidence('job id', sourceSha256, specSha256, request)
  expect(success.report?.sourceSha256).toBe(sourceSha256)
  expect(requestedCredentials).toBe('include')
  expect(requestedUrl).toBe('/api/jobs/job%20id/assembly/evidence?sourceSha256=' + sourceSha256 + '&specSha256=' + specSha256)
  const bad = await fetchAssemblyEvidence('job', sourceSha256, specSha256, async () => Response.json({ ...report, sourceSha256: 'd'.repeat(64) }))
  expect(bad.error).toContain('does not match')
  const conflict = await fetchAssemblyEvidence('job', sourceSha256, specSha256, async () => new Response('', { status: 409 }))
  expect(conflict.error).toContain('changed')
  const invalid = await fetchAssemblyEvidence('job', '', specSha256, request)
  expect(invalid.error).toContain('unavailable')
})

test('saved versions distinguish the current declaration from an earlier source', () => {
  const revisions = [
    { id: 'r2', revision: 2, savedAt: '2026-10-29T00:00:00.000Z', specSha256: 'd'.repeat(64), sourceSha256: 'a'.repeat(64), stale: false, spec },
    { id: 'r1', revision: 1, savedAt: '2026-10-28T00:00:00.000Z', specSha256: 'e'.repeat(64), sourceSha256: 'b'.repeat(64), stale: true, spec },
  ]
  const html = renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale() {}, t: createTranslator('en') }}><AssemblyRevisions revisions={revisions} currentSpecSha256={'d'.repeat(64)} onLoad={() => {}} /></I18nContext.Provider>,
  )
  expect(html).toContain('Saved versions')
  expect(html).toContain('Version 2')
  expect(html).toContain('Current')
  expect(html).toContain('Earlier source')
  expect(html).toContain('Load into editor')
  expect(html).toContain('not applied until you save')
  expect(renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: 'en', setLocale() {}, t: createTranslator('en') }}><AssemblyRevisions revisions={[]} onLoad={() => {}} /></I18nContext.Provider>,
  )).toBe('')
})
