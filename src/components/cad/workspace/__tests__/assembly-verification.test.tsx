import {test,expect} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {AssemblyVerification,currentEvidenceStatus,type VerificationResponse} from '../AssemblyVerification'
import {I18nContext} from '@/components/i18n-provider'
import {createTranslator} from '@/lib/i18n'

test('only a current stored report may display passing evidence',()=>{
 for(const status of ['ABSENT','STALE','UNAVAILABLE','CURRENT'] as const){
  const report:VerificationResponse={verification:{status},evidence:{identity:{status:'PASS'}}}
  expect(currentEvidenceStatus(report,'identity')).toBe(status==='CURRENT'?'PASS':'NOT_RUN')
 }
 expect(currentEvidenceStatus(undefined,'motion')).toBe('NOT_RUN')
 expect(currentEvidenceStatus({verification:{status:'CURRENT',executionStatus:'ERROR'},evidence:{motion:{status:'PASS'}}},'motion')).toBe('NOT_RUN')
})
test('the pending report view includes requirement completeness and permits a review action',()=>{
 const html=renderToStaticMarkup(<I18nContext.Provider value={{locale:'en',setLocale(){},t:createTranslator('en')}}>
  <AssemblyVerification jobId="test" sourceSha256={'a'.repeat(64)} specSha256={'b'.repeat(64)} revision="1" canCheck />
 </I18nContext.Provider>)
 expect(html).toContain('Check assembly')
 expect(html.match(/Not checked/g)?.length).toBe(12)
 expect(html).toContain('Rigid-pose collision samples')
 expect(html).toContain('Source-driven pose samples')
 expect(html).toContain('Combined motion evidence')
 expect(html).toContain('Requirement completeness')
 expect(html).toContain('Assembly path')
 expect(html).toContain('Joint frames')
 expect(html).toContain('Assembly reconstruction')
 expect(html).not.toContain('Download verification report')
})
