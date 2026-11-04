import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext } from '@/components/i18n-provider'
import { createTranslator } from '@/lib/i18n'
import { deriveRequirementContract } from '@/lib/requirements/extract-requirements'
import { normalizeConfirmedContract } from '@/lib/requirements/requirement-contract'
import {
  describeAssertions,
  describeStanding,
  formatExpected,
  parseContractDraft,
  RequirementContractSummary,
  saveRequirementContract,
  toggleWaiver,
  withTargetLevel,
  type ContractView,
} from '../RequirementContract'

const REQUEST = '做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印'
const contract = () => deriveRequirementContract({ request: REQUEST })

const view = (overrides: Partial<ContractView> = {}): ContractView => {
  const derived = contract()
  return {
    contract: derived,
    contractSha256: 'a'.repeat(64),
    confirmedContractSha256: null,
    confirmed: false,
    stale: false,
    edited: false,
    revision: null,
    confirmedAt: null,
    derived,
    evidenceCurrent: false,
    reason: 'The contract has not been confirmed, so no evidence can count as current yet.',
    ...overrides,
  }
}

const render = (record: ContractView, locale: 'en' | 'zh-CN' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={{ locale, setLocale() {}, t: createTranslator(locale) }}>
    <RequirementContractSummary record={record} />
  </I18nContext.Provider>,
)

test('an unconfirmed contract is shown as unconfirmed, with the pipeline default marked as such', () => {
  const html = render(view())
  expect(html).toContain('Requirement contract')
  expect(html).toContain('nobody has confirmed them')
  expect(html).toContain('intent-preserved')
  // The pipeline default must not read like something the user asked for.
  expect(html).toContain('Pipeline default')
  expect(html).toContain('From your request')
  expect(html).toContain('0.35–0.45 mm')
  expect(html).toContain('直径间隙 0.35 到 0.45 mm')
  expect(html).toContain('Questions this request does not answer')
  expect(html).toContain('It is not evidence that anything works')
})

test('a stale contract says the request changed and does not claim results are current', () => {
  const html = render(view({ stale: true, revision: 1, confirmedAt: '2026-01-01T00:00:00.000Z', confirmedContractSha256: 'b'.repeat(64) }))
  expect(html).toContain('The request changed after this contract was confirmed')
  expect(html).toContain('2026-01-01T00:00:00.000Z')
})

test('an edited confirmation says results follow the user version', () => {
  const edited = normalizeConfirmedContract(contract(), contract())
  expect(describeStanding(view({ contract: edited, confirmed: true, edited: true, evidenceCurrent: true }))).toContain('with changes you made')
  expect(describeStanding(view({ confirmed: true, evidenceCurrent: true }))).toContain('Confirmed. Results may be judged')
})

test('a waived assertion stays visible and is labelled, not hidden', () => {
  const waived = toggleWaiver(contract(), 'disassembly-path')
  const rows = describeAssertions({ contract: waived, derived: contract() })
  const row = rows.find((item) => item.id === 'disassembly-path')!
  expect(row.required).toBe(false)
  expect(row.changed).toBe(true)
  const html = render(view({ contract: waived }))
  expect(html).toContain('disassembly-path')
  expect(html).toContain('waived')
})

test('assertions the request never stated are not attributed to the user', () => {
  const derived = contract()
  const added = { ...derived, requirements: [...derived.requirements, {
    id: 'wall-thickness', layer: 'parts' as const, required: true, applicable: true,
    expected: { kind: 'range' as const, min: 1.2, max: 2, unit: 'mm' }, provenance: 'confirmed' as const, statement: null,
  }] }
  const row = describeAssertions({ contract: added, derived }).find((item) => item.id === 'wall-thickness')!
  expect(row.provenance).toBe('confirmed')
  expect(row.changed).toBe(true)
})

test('expected values are formatted without inventing precision', () => {
  expect(formatExpected({ kind: 'range', min: 0.35, max: 0.45, unit: 'mm' })).toBe('0.35–0.45 mm')
  expect(formatExpected({ kind: 'equals', value: 2 })).toBe('2')
  expect(formatExpected({ kind: 'equals', value: true })).toBe('yes')
  expect(formatExpected({ kind: 'equals', value: false })).toBe('no')
  expect(formatExpected({ kind: 'equals', value: 'two-part' })).toBe('two-part')
})

test('Chinese labels are available for the standing and the assertion list', () => {
  const html = render(view(), 'zh-CN')
  expect(html).toContain('需求合同')
  expect(html).toContain('还没有人确认')
  expect(html).toContain('流程默认')
})

test('a malformed draft is refused before it is sent', () => {
  expect(parseContractDraft('{')).toEqual({ error: 'The contract is not valid JSON.' })
  const invalid = parseContractDraft(JSON.stringify({ schemaVersion: 1 }))
  expect(invalid.error).toBeDefined()
  expect(parseContractDraft(JSON.stringify(contract())).contract!.intent.kind).toBe('revolute-hinge')
})

test('switching the target level keeps every assertion', () => {
  const physical = withTargetLevel(contract(), 'physical')
  expect(physical.targetLevel).toBe('physical')
  expect(physical.requirements).toHaveLength(contract().requirements.length)
})

test('confirmation sends the stored hash so a concurrent confirmation conflicts instead of being overwritten', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  const request = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ confirmed: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

  const saved = await saveRequirementContract('job-1', contract(), 'c'.repeat(64), request)
  expect(saved.error).toBeUndefined()
  expect(calls[0].url).toBe('/api/jobs/job-1/requirements')
  expect((calls[0].body as { expectedContractSha256: string }).expectedContractSha256).toBe('c'.repeat(64))

  // Nothing confirmed yet: null is the correct value, not the derived hash.
  await saveRequirementContract('job-1', contract(), null, request)
  expect((calls[1].body as { expectedContractSha256: string | null }).expectedContractSha256).toBeNull()

  const malformed = await saveRequirementContract('job-1', contract(), 'not-a-hash', request)
  expect(malformed.error).toContain('Refresh before confirming')
  expect(calls).toHaveLength(2)
})

test('a conflict surfaces the server reason instead of reporting success', async () => {
  const request = (async () => new Response(JSON.stringify({ error: 'The confirmed contract changed; refresh before confirming.' }), { status: 409 })) as unknown as typeof fetch
  const result = await saveRequirementContract('job-1', contract(), 'd'.repeat(64), request)
  expect(result.error).toContain('changed')
  expect('conflict' in result && result.conflict).toBe(true)
  expect('data' in result).toBe(false)
})
