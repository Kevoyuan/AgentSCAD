'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'

type AttemptView = {
  attempt:number
  scadSha256:string
  accepted:boolean
  phase?:string
  reason?:string
  findings:Array<{kind:string;measured:string|null;required:string|null;message:string}>
  evidence:{identity:string;assembly:string;motion:string}
  measurementProvenance?:{
    sourceSha256:string;specificationSha256:string
    partArtifactSha256:Record<string,string>;manifestSha256:string
  }
  modelExecution?:{
    model:string;provider:string;latencyMs:number
    promptTokens?:number;completionTokens?:number
  }
}
type RepairResponse = {
  schemaVersion:1
  checkerVersion:string
  runId:string
  sourceSha256:string
  specSha256:string
  stoppedBecause:string
  reason:string
  evidenceComplete:boolean
  attempts:AttemptView[]
  verifiedCandidate:{scadSource:string;scadSha256:string;applied:false;userAccepted:false}|null
  deliveryChanged:false
  physicalFunctionApproval:'NOT_RUN'
}
type HistoryEvent = {
  id:string
  integrity:'PASS'|'ERROR'
  bindingCurrent:boolean
  event:{
    state:string;runId:string;recordedAt:string;
    eventSha256:string;attempt:AttemptView|null;
    terminal:{
      stoppedBecause:string;reason:string;finalScadSha256:string;
      evidenceComplete:boolean;reviewCandidateScad:string|null;
    }|null
  }|null
}
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>

export async function requestMeasuredAssemblyRepair(input:{
  jobId:string;sourceSha256:string;specSha256:string;
  maxAttempts:1|2;
},fetcher:Fetcher=fetch):Promise<{result?:RepairResponse;error?:string}> {
  try{
    const response=await fetcher('/api/jobs/'+encodeURIComponent(input.jobId)+'/assembly/repair',{
      method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sourceSha256:input.sourceSha256,specSha256:input.specSha256,
        maxAttempts:input.maxAttempts,confirmedPaidModelCalls:true,
      }),
    })
    if(!response.ok){
      const issue=await response.json().catch(()=>({})) as {error?:string}
      return {error:issue.error??'Assembly repair could not be completed. Original CAD is unchanged.'}
    }
    const result=await response.json() as RepairResponse
    if(result.schemaVersion!==1||result.checkerVersion!=='assembly-measured-repair/v1'||
      result.sourceSha256!==input.sourceSha256||result.specSha256!==input.specSha256||
      !Array.isArray(result.attempts)||result.attempts.length<1||result.attempts.length>3||
      result.deliveryChanged!==false||result.physicalFunctionApproval!=='NOT_RUN'||
      (result.verifiedCandidate && (result.verifiedCandidate.applied!==false||
        result.verifiedCandidate.userAccepted!==false))) {
      return {error:'The repair result did not match the current version or safety checks.'}
    }
    return {result}
  }catch{return {error:'Assembly repair request failed. Original CAD is unchanged.'}}
}

export function AssemblyRepairPanel({jobId,sourceSha256,specSha256}:{
  jobId:string;sourceSha256:string;specSha256:string
}){
  const {t}=useI18n()
  const [confirmed,setConfirmed]=React.useState(false)
  const [maxAttempts,setMaxAttempts]=React.useState<1|2>(1)
  const [loading,setLoading]=React.useState(false)
  const [error,setError]=React.useState('')
  const [result,setResult]=React.useState<RepairResponse|null>(null)
  const [history,setHistory]=React.useState<HistoryEvent[]>([])
  const [copyFeedback,setCopyFeedback]=React.useState('')
  React.useEffect(()=>{
    const abort=new AbortController()
    fetch('/api/jobs/'+encodeURIComponent(jobId)+'/assembly/repair',{
      method:'GET',credentials:'include',cache:'no-store',signal:abort.signal,
    }).then(response=>response.ok?response.json():Promise.reject())
      .then(data=>{if(!abort.signal.aborted&&Array.isArray(data.events))setHistory(data.events)})
      .catch(()=>{/* history unavailable; never trigger a repair as a fallback */})
    return()=>abort.abort()
  },[jobId,sourceSha256,specSha256,result?.runId])
  const run=async()=>{
    if(!confirmed||loading)return
    setLoading(true);setError('');setResult(null);setCopyFeedback('')
    const checked=await requestMeasuredAssemblyRepair({jobId,sourceSha256,specSha256,maxAttempts})
    if(checked.result)setResult(checked.result)
    else setError(checked.error??'Assembly repair failed')
    setLoading(false);setConfirmed(false)
  }
  return <section className="mt-3 border-t border-[color:var(--shell-hairline)] pt-2 text-[var(--shell-text-label)]"
    aria-label={t('Measured assembly repair')}>
    <h4 className="font-medium text-[var(--shell-text-primary)]">{t('Measured assembly repair')}</h4>
    <p>{t('Only measured failures can trigger repair. The frozen part count, joint ranges and confirmed requirements cannot be weakened. Existing delivered CAD stays unchanged.')}</p>
    <label className="mt-2 flex flex-col gap-1">
      {t('Maximum paid repair proposals')}
      <select value={maxAttempts} onChange={event=>{setMaxAttempts(Number(event.target.value) as 1|2);setConfirmed(false)}}
        className="rounded border border-[color:var(--shell-hairline)] bg-transparent p-1">
        <option value={1}>1</option><option value={2}>2</option>
      </select>
    </label>
    <label className="mt-2 flex items-start gap-2">
      <input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
      <span>{t('I authorize up to the selected number of model repair calls, which may incur usage charges. The result must be measured and manually reviewed before I apply it.')}</span>
    </label>
    <button type="button" disabled={!confirmed||loading} onClick={()=>void run()}
      className="mt-2 rounded border border-[color:var(--shell-hairline)] px-2 py-1">
      {loading?t('Measuring and repairing assembly…'):t('Run measured repair')}
    </button>
    {error&&<p role="alert" className="mt-2 text-[var(--shell-fail)]">{t(error)}</p>}
    {result&&<div className="mt-3 space-y-2">
      <p className="font-medium">{t('Repair finished')}: {result.stoppedBecause}; {t('Complete measured evidence')}: {result.evidenceComplete?'PASS':'NOT_RUN'}</p>
      <p>{result.reason}</p>
      <ol className="space-y-2">{result.attempts.map(item=><li key={item.attempt} className="border-l border-[color:var(--shell-hairline)] pl-2">
        <p><strong>{t('Attempt')} {item.attempt}</strong> · {item.phase??'measured'} · {item.accepted?'accepted':'rejected'}</p>
        <p>{t('Source SHA-256')}: <code className="break-all">{item.scadSha256}</code></p>
        <p>{t('Measured result')}: identity {item.evidence.identity}; assembly {item.evidence.assembly}; motion {item.evidence.motion}</p>
        {item.findings.map((finding,i)=><p key={i}>{finding.kind}: {finding.message} ({finding.measured??'—'} / {finding.required??'—'})</p>)}
        {item.modelExecution&&<p>{t('Model usage')}: {item.modelExecution.provider}/{item.modelExecution.model}; {item.modelExecution.promptTokens??'?'}/{item.modelExecution.completionTokens??'?'} tokens</p>}
        {item.measurementProvenance&&<details>
          <summary>{t('Measured artifact hashes')}</summary>
          <p className="break-all">{item.measurementProvenance.manifestSha256}</p>
          {Object.entries(item.measurementProvenance.partArtifactSha256).map(([id,hash])=>
            <p key={id} className="break-all">{id}: {hash}</p>)}
        </details>}
      </li>)}</ol>
      {result.verifiedCandidate&&<details>
        <summary>{t('Verified repair candidate — not applied')}</summary>
        <p>{t('Review and copy this complete SCAD source into the CAD editor. Applying it later is a separate explicit operation that rebuilds all artifacts.')}</p>
        <textarea readOnly value={result.verifiedCandidate.scadSource} rows={7}
          className="mt-1 w-full rounded border border-[color:var(--shell-hairline)] bg-transparent p-1 font-mono text-xs"/>
        <button type="button" className="rounded border border-[color:var(--shell-hairline)] px-2 py-1"
          onClick={()=>void navigator.clipboard.writeText(result.verifiedCandidate!.scadSource).then(()=>
            setCopyFeedback(t('Copied candidate source'))).catch(()=>setCopyFeedback(t('Copy failed; select the source manually')))}>
          {t('Copy candidate source')}
        </button>
        {copyFeedback&&<p role="status">{copyFeedback}</p>}
      </details>}
      <p>{t('Measured repair is not independent physical functionality, manufacturing acceptance or approval to overwrite the original.')}</p>
    </div>}
    {history.length>0&&<details className="mt-3">
      <summary>{t('Recorded repair history')} ({history.length})</summary>
      <ul className="mt-2 space-y-1">{history.map(item=><li key={item.id}>
        <span>{item.event?.state??'CORRUPT'} · {item.integrity} · {item.bindingCurrent?t('Current'):t('Earlier source')}</span>
        {item.event?.attempt&&<span> · {t('Attempt')} {item.event.attempt.attempt}: {item.event.attempt.phase??'measured'}</span>}
        {item.event?.terminal&&<span> · {item.event.terminal.stoppedBecause}</span>}
      </li>)}</ul>
    </details>}
  </section>
}
