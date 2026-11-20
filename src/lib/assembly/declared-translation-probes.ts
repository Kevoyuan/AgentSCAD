import type { AssemblySpec } from "./assembly-spec";
import { checkTranslationProbe } from "./translation-probe";

/** All other instances are obstacles: the declaration cannot omit an inconvenient part.
 * Each experiment moves only one body; coupled/co-moving groups are not inferred. */
export function checkDeclaredTranslationProbes(input: { spec: AssemblySpec; meshes: Record<string, Buffer>; signal?: AbortSignal }) {
  const started = performance.now();
  const budgetMs = 5000;
  const probes = input.spec.translationProbes ?? [];
  const results: Array<{ id: string; instanceId: string; status: string; reason: string; probe?: ReturnType<typeof checkTranslationProbe> }> = [];
  const base = { method: "declared-translation-probes/v1", budgetMs,
    coverage: "Only declared single-body rigid translations at listed start poses against all other declared instances. No coverage of the user's full service range, source-driven motion, accidental unlocking, holding force, strength, compliance or physical function." };
  if (!probes.length) return { ...base, status: "NOT_RUN" as const, reason: "No geometric translation probes were declared.", results };
  if (input.spec.instances.length < 2 || input.spec.instances.length > 8 || probes.reduce((n,p)=>n+p.samples*(input.spec.instances.length-1),0)>4096)
    return { ...base, status: "NOT_RUN" as const, reason: "Declared probe instance/sample budget exceeded.", results };
  for (const declaration of probes) {
    input.signal?.throwIfAborted();
    if (performance.now()-started >= budgetMs) {
      results.push({id:declaration.id,instanceId:declaration.instanceId,status:"NOT_RUN",reason:"Declared probes exceeded the total evaluation budget."});
      continue;
    }
    const moving = input.spec.instances.find(i=>i.id===declaration.instanceId)!;
    const others = input.spec.instances.filter(i=>i.id!==moving.id);
    if ([moving,...others].some(i=>!input.meshes[i.partId])) {
      results.push({id:declaration.id,instanceId:moving.id,status:"NOT_RUN",reason:"A required moving or obstacle mesh is unavailable; purchased bodies cannot be ignored."});
      continue;
    }
    try {
      const probe = checkTranslationProbe({moving:input.meshes[moving.partId],movingTransform:declaration.startTransform,
        obstacles:Object.fromEntries(others.map(i=>[i.id,input.meshes[i.partId]])),
        obstacleTransforms:Object.fromEntries(others.map(i=>[i.id,i.transform])),
        translationMm:declaration.translationMm,samples:declaration.samples,expected:declaration.expected,
        budgetMs:Math.max(Number.MIN_VALUE,budgetMs-(performance.now()-started))});
      results.push({id:declaration.id,instanceId:moving.id,status:probe.status,reason:probe.reason,probe});
    } catch (error) {
      input.signal?.throwIfAborted();
      results.push({id:declaration.id,instanceId:moving.id,status:"ERROR",reason:error instanceof Error?error.message:String(error)});
    }
  }
  const status = results.some(r=>r.status==="FAIL") ? "FAIL" as const : results.some(r=>r.status==="ERROR") ? "ERROR" as const
    : results.some(r=>r.status!=="PASS") ? "NOT_RUN" as const : "PASS" as const;
  return {...base,status,reason:results.map(r=>`${r.id} ${r.status}: ${r.reason}`).join(" "),results};
}
