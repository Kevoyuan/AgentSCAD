'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import {
  validateRequirementContract,
  type ContractRequirement,
  type RequirementContract,
  type RequirementLayer,
} from '@/lib/requirements/requirement-contract'
import type { RequirementContractRecord } from '@/lib/requirements/requirement-contract-record'

/** Read-only shape shared with the API; the record itself is server-only. */
export type ContractView = Pick<
  RequirementContractRecord,
  'contract' | 'contractSha256' | 'confirmedContractSha256' | 'confirmed' | 'stale' | 'edited' | 'revision' | 'confirmedAt' | 'derived' | 'evidenceCurrent' | 'reason'
>

export type AssertionView = {
  id: string
  layer: RequirementLayer
  label: string
  value: string
  statement: string | null
  provenance: ContractRequirement['provenance']
  required: boolean
  applicable: boolean
  /** Differs from what the current request would produce on its own. */
  changed: boolean
}

const LAYER_LABEL: Record<RequirementLayer, string> = {
  intent: 'Intent', parts: 'Parts', assembly: 'Assembly', motion: 'Motion', physical: 'Physical', performance: 'Performance',
}

export function formatExpected(expected: ContractRequirement['expected']): string {
  if (expected.kind === 'range') return `${expected.min}–${expected.max} ${expected.unit}`
  if (expected.kind === 'atLeast') return `≥ ${expected.min} ${expected.unit}`
  return typeof expected.value === 'boolean' ? (expected.value ? 'yes' : 'no') : String(expected.value)
}

/**
 * Lists what the contract asserts, and whether the user is the source of each
 * line. `default` provenance is surfaced deliberately: a pipeline default must
 * never look like something the user asked for.
 */
export function describeAssertions(record: Pick<ContractView, 'contract' | 'derived'>): AssertionView[] {
  const derivedById = new Map(record.derived.requirements.map((requirement) => [requirement.id, requirement]))
  return record.contract.requirements.map((requirement) => {
    const original = derivedById.get(requirement.id)
    return {
      id: requirement.id,
      layer: requirement.layer,
      label: LAYER_LABEL[requirement.layer],
      value: formatExpected(requirement.expected),
      statement: requirement.statement,
      provenance: requirement.provenance,
      required: requirement.required,
      applicable: requirement.applicable,
      changed: original === undefined
        || original.layer !== requirement.layer
        || original.required !== requirement.required
        || original.applicable !== requirement.applicable
        || JSON.stringify(original.expected) !== JSON.stringify(requirement.expected),
    }
  })
}

/**
 * One sentence describing whether evidence may count, and why not. The wording
 * is fixed so it can be translated; the server's own reason is shown alongside
 * it as detail rather than replacing it.
 */
export function describeStanding(record: Pick<ContractView, 'confirmed' | 'stale' | 'edited'>): string {
  if (record.stale) return 'The request changed after this contract was confirmed. Confirm the updated contract before trusting any result.'
  if (!record.confirmed) return 'These requirements are derived from your request but nobody has confirmed them.'
  if (record.edited) return 'Confirmed, with changes you made. Results are judged against your version.'
  return 'Confirmed. Results may be judged against this contract.'
}

/** Waiving keeps the assertion visible instead of deleting it. */
export function toggleWaiver(contract: RequirementContract, id: string): RequirementContract {
  return {
    ...contract,
    requirements: contract.requirements.map((requirement) =>
      requirement.id === id ? { ...requirement, required: !requirement.required, provenance: 'confirmed' } : requirement),
  }
}

export function withTargetLevel(contract: RequirementContract, targetLevel: RequirementContract['targetLevel']): RequirementContract {
  return { ...contract, targetLevel }
}

export function parseContractDraft(text: string) {
  let value: unknown
  try { value = JSON.parse(text) } catch { return { error: 'The contract is not valid JSON.' as const } }
  const parsed = validateRequirementContract(value)
  if (!parsed.success) {
    return {
      error: 'The contract is incomplete or invalid.' as const,
      details: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    }
  }
  return { contract: parsed.data }
}

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * `expectedContractSha256` is the hash of the stored confirmation, not of the
 * operative contract: when the request changed, those two differ and sending
 * the wrong one would silently overwrite a confirmation made elsewhere.
 */
export async function saveRequirementContract(
  jobId: string,
  contract: RequirementContract,
  expectedContractSha256: string | null,
  request: Request = fetch,
) {
  if (expectedContractSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedContractSha256)) {
    return { error: 'The confirmed contract is unavailable. Refresh before confirming.' as const }
  }
  try {
    const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/requirements`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, expectedContractSha256 }),
    })
    if (response.status === 409) {
      const body = await response.json().catch(() => null) as { error?: string } | null
      return { error: body?.error ?? 'The contract changed. Refresh before confirming.', conflict: true as const }
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null) as { error?: string } | null
      return { error: body?.error ?? 'The contract is invalid.' }
    }
    if (!response.ok) return { error: 'The contract could not be confirmed.' as const }
    return { data: await response.json() as ContractView }
  } catch {
    return { error: 'The contract could not be confirmed.' as const }
  }
}

const PROVENANCE_LABEL: Record<ContractRequirement['provenance'], string> = {
  request: 'From your request',
  confirmed: 'You changed this',
  default: 'Pipeline default',
}

export function RequirementContractSummary({ record }: { record: ContractView }) {
  const { t } = useI18n()
  const assertions = describeAssertions(record)
  return <section aria-label={t('Requirement contract')} className="border-t border-[color:var(--shell-hairline)] py-3 text-xs">
    <h3 className="font-medium">{t('Requirement contract')}</h3>
    <p className={record.evidenceCurrent ? 'mt-1 text-[var(--shell-text-label)]' : 'mt-1 text-[var(--shell-fail)]'} role="status">
      {t(describeStanding(record))}
    </p>
    {record.reason && <p className="mt-1 text-[var(--shell-text-label)]">{t(record.reason)}</p>}
    {record.confirmedAt && <p className="mt-1 text-[var(--shell-text-label)]">{t('Confirmed at {0}', { 0: record.confirmedAt })}</p>}
    <ul className="mt-2 space-y-1">
      {assertions.map((assertion) => <li key={assertion.id} className="flex flex-wrap items-baseline gap-2">
        <span className="text-[var(--shell-text-label)]">{t(assertion.label)}</span>
        <span className="font-mono">{assertion.id}</span>
        <span>{assertion.value}</span>
        <span className="text-[var(--shell-text-label)]">{t(PROVENANCE_LABEL[assertion.provenance])}</span>
        {assertion.changed && <span className="text-[var(--shell-text-label)]">{t('differs from your request')}</span>}
        {!assertion.required && <span className="text-[var(--shell-fail)]">{t('waived')}</span>}
        {assertion.statement && <q className="text-[var(--shell-text-label)]">{assertion.statement}</q>}
      </li>)}
    </ul>
    {record.contract.unknowns.length > 0 && <>
      <h4 className="mt-3 font-medium">{t('Questions this request does not answer')}</h4>
      <ul className="mt-1 space-y-1 text-[var(--shell-text-label)]">
        {record.contract.unknowns.map((unknown) => <li key={unknown.id}>{unknown.question}</li>)}
      </ul>
    </>}
    <p className="mt-2 text-[var(--shell-text-label)]">
      {t('A confirmed contract states what will be judged. It is not evidence that anything works.')}
    </p>
  </section>
}

export function JobRequirementContract({ jobId, revision }: { jobId: string; revision: string }) {
  const { t } = useI18n()
  const [state, setState] = React.useState<{ data?: ContractView; error?: boolean }>({})
  const [draft, setDraft] = React.useState<RequirementContract | null>(null)
  const [message, setMessage] = React.useState('')
  const [details, setDetails] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    setState({})
    setDraft(null)
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/requirements`, { credentials: 'include', signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Requirement contract request failed'); return response.json() })
      .then((data) => { if (!controller.signal.aborted) setState({ data: data as ContractView }) })
      .catch(() => { if (!controller.signal.aborted) setState({ error: true }) })
    return () => controller.abort()
  }, [jobId, revision])

  if (state.error) return <p role="status" className="py-2 text-xs text-[var(--shell-text-label)]">{t('Requirement information is unavailable.')}</p>
  if (!state.data) return null
  const data = state.data
  const working = draft ?? data.contract
  const editable = !data.confirmed || data.stale || draft !== null
  const view: ContractView = { ...data, contract: working }

  const confirm = async () => {
    setSaving(true)
    setMessage(''); setDetails([])
    const result = await saveRequirementContract(jobId, working, data.confirmedContractSha256)
    setSaving(false)
    if (result.error) { setMessage(result.error); setDetails('details' in result ? (result.details ?? []) as string[] : []); return }
    if (result.data) { setState({ data: result.data }); setDraft(null) }
  }

  return <>
    <RequirementContractSummary record={view} />
    {editable ? <section aria-label={t('Edit requirement contract')} className="pb-3 text-xs">
      <label htmlFor="contract-target-level" className="block">{t('Acceptance level')}</label>
      <select
        id="contract-target-level"
        className="mt-1 rounded border border-[color:var(--shell-hairline)] bg-transparent px-2 py-1"
        value={working.targetLevel}
        onChange={(event) => setDraft(withTargetLevel(working, event.target.value as RequirementContract['targetLevel']))}
      >
        <option value="digital">{t('Digital evidence only')}</option>
        <option value="physical">{t('Includes physical testing')}</option>
      </select>
      <ul className="mt-2 space-y-1">
        {working.requirements.map((requirement) => <li key={requirement.id}>
          <label className="flex items-baseline gap-2">
            <input
              type="checkbox"
              checked={requirement.required}
              onChange={() => setDraft(toggleWaiver(working, requirement.id))}
            />
            <span>{t('Require {0}', { 0: requirement.id })}</span>
            <span className="text-[var(--shell-text-label)]">{t('unchecking records a waiver instead of deleting it')}</span>
          </label>
        </li>)}
      </ul>
      {message && <p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(message)}</p>}
      {details.length > 0 && <ul className="mt-1 text-[var(--shell-text-label)]">{details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" disabled={saving} onClick={() => void confirm()}>
          {saving ? t('Saving…') : t('Confirm requirements')}
        </button>
        {draft !== null && <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1" disabled={saving} onClick={() => { setDraft(null); setMessage(''); setDetails([]) }}>
          {t('Discard changes')}
        </button>}
      </div>
    </section> : null}
  </>
}
