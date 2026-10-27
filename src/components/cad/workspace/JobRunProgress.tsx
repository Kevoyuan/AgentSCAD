'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/components/i18n-provider'
import type { Job } from '@/components/cad/types'

const labels: Record<string, string> = {
  starting: 'Starting job', queued: 'Starting job',
  generating_llm: 'Waiting for model output', compiling_scad: 'Compiling OpenSCAD geometry',
  rendering: 'Preparing STL geometry', previewing: 'Generating PNG preview',
  validating: 'Checking geometry', repairing: 'Repairing geometry',
  planning_geometry: 'Planning geometry', researching: 'Researching the request',
}
export function formatRunDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function JobRunProgress({ job, onCancel, onViewCode, onViewLog }: {
  job: Job; onCancel: () => void; onViewCode: () => void; onViewLog: () => void;
}) {
  const { t } = useI18n()
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const progress = job.executionProgress
  const stale = !progress || now - Date.parse(progress.updatedAt) > 15000
  const compiling = progress?.step === 'compiling_scad'
  return (
    <section data-testid="job-run-progress" className="w-full max-w-[460px] rounded-[9px] border border-[var(--shell-border-strong)] bg-[var(--shell-module-solid)] p-4 text-left shadow-lg pointer-events-auto">
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${stale ? 'bg-[var(--shell-warn)]' : 'bg-[var(--shell-signal)]'}`} />
        <h2 className="text-[13px] font-medium text-[var(--shell-text)]">{t(labels[progress?.step ?? ''] ?? 'Processing CAD')}</h2>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--shell-text-muted)]">
        {t(compiling ? 'Source is saved. OpenSCAD is computing the geometry. It does not report a reliable completion percentage.'
          : progress?.step === 'generating_llm' ? 'Waiting for the model response. Source will appear here as soon as the response is complete.'
          : 'Stage details update while the job runs. You can inspect the source and execution log below.')}
      </p>
      {progress && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[12px] text-[var(--shell-text-muted)]">
        <div><dt>{t('Current stage elapsed')}</dt><dd className="mt-1 font-mono text-[var(--shell-text)]">{formatRunDuration(now - Date.parse(progress.stageStartedAt))}</dd></div>
        <div><dt>{t('Total elapsed')}</dt><dd className="mt-1 font-mono text-[var(--shell-text)]">{formatRunDuration(now - Date.parse(progress.startedAt))}</dd></div>
        {progress.timeoutMs && <div><dt>{t('Stage time limit')}</dt><dd className="mt-1 font-mono text-[var(--shell-text)]">{formatRunDuration(progress.timeoutMs)} · {progress.backend === 'wasm' ? 'WASM' : t('Native')}</dd></div>}
        {progress.sourceBytes !== undefined && <div><dt>{t('Saved source')}</dt><dd className="mt-1 font-mono text-[var(--shell-text)]">{(progress.sourceBytes / 1024).toFixed(1)} KB</dd></div>}
      </dl>}
      <p className={`mt-4 text-[12px] ${stale ? 'text-[var(--shell-warn)]' : 'text-[var(--shell-text-muted)]'}`}>
        {stale ? t('Waiting for a fresh heartbeat. The connection may be interrupted.') : t('Worker heartbeat received {0}s ago', { 0: Math.max(0, Math.floor((now - Date.parse(progress!.updatedAt)) / 1000)) })}
      </p>
      {progress?.diagnostic && <details className="mt-3 text-[12px] text-[var(--shell-text-muted)]"><summary className="cursor-pointer">{t('Latest compiler output')}</summary><pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px]">{progress.diagnostic}</pre></details>}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--shell-border)] pt-3">
        {job.scadSource && <button type="button" onClick={onViewCode} className="rounded-[4px] border border-[var(--shell-border-strong)] px-3 py-2 text-[12px] text-[var(--shell-text)] focus-visible:outline-2">{t('View saved code')}</button>}
        <button type="button" onClick={onViewLog} className="rounded-[4px] border border-[var(--shell-border-strong)] px-3 py-2 text-[12px] text-[var(--shell-text)] focus-visible:outline-2">{t('View execution log')}</button>
        <button type="button" onClick={onCancel} className="ml-auto rounded-[4px] border border-[var(--shell-border-strong)] px-3 py-2 text-[12px] text-[var(--shell-fail)] focus-visible:outline-2">{t('Stop job')}</button>
      </div>
    </section>
  )
}
