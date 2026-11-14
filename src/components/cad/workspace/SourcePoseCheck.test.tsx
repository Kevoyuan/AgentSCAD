import { expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { I18nContext } from "@/components/i18n-provider";
import { createTranslator } from "@/lib/i18n";
import { validateAssemblySpec } from "@/lib/assembly/assembly-spec";
import { fetchSourcePoseCheck, SourcePoseCheck } from "./SourcePoseCheck";

const sha = "a".repeat(64);
const specSha = "b".repeat(64);
const query = { jobId: "test-job", sourceSha256: sha, specSha256: specSha,
  connectionId: "hinge", sourceParameter: "hinge_angle", rotationDeg: 15 };

test("source-pose inspection controls are explicit and never render/request on page load", async () => {
  const parsed = validateAssemblySpec(JSON.parse(await readFile("scripts/eval/assembly-fixtures/axial-hinge.spec.json", "utf8")));
  if (!parsed.success) throw new Error("Hinge fixture invalid");
  const html = renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: "en", setLocale() {}, t: createTranslator("en") }}>
      <SourcePoseCheck jobId={query.jobId} sourceSha256={query.sourceSha256} specSha256={query.specSha256} spec={parsed.data} />
    </I18nContext.Provider>,
  );
  expect(html).toContain("Independent source-pose inspection");
  expect(html).toContain("hinge: fixed-instance / moving-instance");
  expect(html).toContain("type=\"checkbox\"");
  expect(html).toContain("disabled=\"\"");
  expect(html).toContain("Run three source-pose comparisons");
  expect(html).not.toContain("Raw sampled surface comparison");
});

test("the explicit POST sends only source binding, never client-computed world matrices", async () => {
  let requests = 0;
  const result = await fetchSourcePoseCheck(query, async (url, init) => {
    requests++;
    expect(String(url)).toBe("/api/jobs/test-job/assembly/source-poses");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    const payload = JSON.parse(String(init?.body));
    expect(Object.keys(payload).sort()).toEqual([
      "confirmedBinding", "connectionId", "rotationDeg", "sourceParameter", "sourceSha256", "specSha256",
    ]);
    expect(payload.confirmedBinding).toBe(true);
    expect(payload.rotationDeg).toBe(15);
    return Response.json({
      schemaVersion: 1, sourceSha256: sha, specSha256: specSha,
      binding: { connectionId: "hinge", sourceParameter: "hinge_angle",
        rotationDeg: 15, independentParameterSemanticsVerified: false },
      report: { status: "PASS", sourceSha256: sha, samples: [{ id: "negative" }, { id: "zero" }, { id: "positive" }] },
      productMotionApproval: "NOT_RUN", physicalFunctionApproval: "NOT_RUN",
    });
  });
  expect(requests).toBe(1);
  expect(result.error).toBeUndefined();
  expect(result.data?.report.samples).toHaveLength(3);
});

test("stale, forged and unapproved source-pose responses cannot masquerade as current data", async () => {
  const invalid = {
    schemaVersion: 1, sourceSha256: sha, specSha256: specSha,
    report: { status: "PASS", sourceSha256: sha, samples: [{},{},{}] },
    binding: { connectionId: "hinge", sourceParameter: "hinge_angle",
      rotationDeg: 15, independentParameterSemanticsVerified: false },
    productMotionApproval: "PASS", physicalFunctionApproval: "NOT_RUN",
  };
  const fake = async () => Response.json(invalid);
  const result = await fetchSourcePoseCheck(query, fake);
  expect(result.error).toContain("not bound");
  const stale = await fetchSourcePoseCheck(query, async () => new Response("", { status: 409 }));
  expect(stale.error).toContain("Refresh");
  const falseHash = await fetchSourcePoseCheck(query, async () => Response.json({
    ...invalid, productMotionApproval: "NOT_RUN", sourceSha256: "f".repeat(64),
  }));
  expect(falseHash.error).toContain("not bound");
});
