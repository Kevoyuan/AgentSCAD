import { expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nContext } from "@/components/i18n-provider";
import { createTranslator } from "@/lib/i18n";
import { AssemblyRepairPanel, requestMeasuredAssemblyRepair } from "./AssemblyRepairPanel";
const hash="a".repeat(64);
const specHash="b".repeat(64);
const base={jobId:"job-test",sourceSha256:hash,specSha256:specHash,maxAttempts:2 as const};

test("A07 form requires explicit paid model consent and does not make any POST during render",()=>{
  const html=renderToStaticMarkup(
    <I18nContext.Provider value={{locale:"en",setLocale(){},t:createTranslator("en")}}>
      <AssemblyRepairPanel jobId="job-test" sourceSha256={hash} specSha256={specHash}/>
    </I18nContext.Provider>,
  );
  expect(html).toContain("Measured assembly repair");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('disabled=""');
  expect(html).toContain("usage charges");
  expect(html).not.toContain("Verified repair candidate — not applied");
});

test("A07 POST only sends explicit hashes and 1 or 2 authorized proposals",async()=>{
  const result=await requestMeasuredAssemblyRepair(base,async(url,options)=>{
    expect(String(url)).toBe("/api/jobs/job-test/assembly/repair");
    expect(options?.method).toBe("POST");
    expect(options?.credentials).toBe("include");
    const sent=JSON.parse(String(options?.body));
    expect(sent).toEqual({
      sourceSha256:hash,specSha256:specHash,
      confirmedPaidModelCalls:true,maxAttempts:2,
    });
    return Response.json({
      schemaVersion:1,checkerVersion:"assembly-measured-repair/v1",
      runId:"run-1",sourceSha256:hash,specSha256:specHash,
      stoppedBecause:"no-findings",reason:"repaired",evidenceComplete:true,
      attempts:[{attempt:0},{attempt:1}],
      verifiedCandidate:{
        scadSource:"cube(2);",scadSha256:"c".repeat(64),
        applied:false,userAccepted:false,
      },
      deliveryChanged:false,physicalFunctionApproval:"NOT_RUN",
    });
  });
  expect(result.error).toBeUndefined();
  expect(result.result?.verifiedCandidate?.scadSource).toBe("cube(2);");
});

test("A07 client rejects forged applied/physical PASS and stale version",async()=>{
  const reply={
    schemaVersion:1,checkerVersion:"assembly-measured-repair/v1",
    runId:"run-1",sourceSha256:hash,specSha256:specHash,
    stoppedBecause:"no-findings",reason:"fixed",evidenceComplete:true,
    attempts:[{attempt:0}],
    verifiedCandidate:null,deliveryChanged:false,physicalFunctionApproval:"NOT_RUN",
  };
  for(const bad of [
    {...reply,deliveryChanged:true},
    {...reply,physicalFunctionApproval:"PASS"},
    {...reply,specSha256:"f".repeat(64)},
    {...reply,verifiedCandidate:{scadSource:"cube(1);",scadSha256:"e".repeat(64),
      applied:true,userAccepted:false}},
  ]){
    const result=await requestMeasuredAssemblyRepair(base,async()=>Response.json(bad));
    expect(result.error).toContain("did not match");
  }
});
