import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { countLlmCall, llmCallsThisRun, withLlmCallMeter } from '@/lib/model-runtime'

/*
 * Run metrics are a measurement contract, not telemetry decoration.
 *
 * Before 2026-10-26 both fields under-reported by construction, and the numbers
 * were already sitting in the database looking trustworthy:
 *   - `latencyMs` was written inside the SCAD_GENERATED transition, so the clock
 *     stopped before render / validate / repair. One job that took 296 s of wall
 *     clock recorded 26.6 s (9%). Another that took 959 s recorded 365.7 s (38%).
 *     Nothing about the field said so.
 *   - `llmCallCount` was assigned from a single skill run's own counter, so the
 *     intake, research, compile-repair and visual-repair calls never reached it,
 *     and a second run overwrote the first run's total instead of adding to it.
 *
 * These tests lock the shape of the fix: one write point at the end of a run,
 * and one counting point that every model call passes through. They are the
 * difference between "we have a number" and "we know what the number means".
 */

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8')

const pipeline = read('src/lib/pipeline/execute-cad-job.ts')
const router = read('src/lib/tools/model-router.ts')
const visualRepairRoute = read('src/app/api/jobs/[id]/visual-repair/route.ts')

describe('the LLM call meter', () => {
  test('counts every call made inside a run scope', async () => {
    const calls = await withLlmCallMeter(async () => {
      expect(llmCallsThisRun()).toBe(0)
      countLlmCall()
      countLlmCall()
      return llmCallsThisRun()
    })
    expect(calls).toBe(2)
  })

  test('concurrent run scopes stay separate', async () => {
    // A Node process serves many jobs at once. A module-level counter would
    // charge one job's retries to whatever else happened to be running.
    const noisy = withLlmCallMeter(async () => {
      for (let i = 0; i < 5; i++) {
        countLlmCall()
        await new Promise((r) => setTimeout(r, 1))
      }
      return llmCallsThisRun()
    })
    const quiet = withLlmCallMeter(async () => {
      await new Promise((r) => setTimeout(r, 4))
      countLlmCall()
      return llmCallsThisRun()
    })
    expect(await noisy).toBe(5)
    expect(await quiet).toBe(1)
  })

  test('a scope does not leak into the caller after it returns', async () => {
    // The reason the meter uses `run()` and not `enterWith()`: `enterWith`
    // mutates the current async resource's store, so the counter would survive
    // the return and contaminate any sibling job the caller starts next.
    await withLlmCallMeter(async () => {
      countLlmCall()
    })
    expect(llmCallsThisRun()).toBe(0)
  })

  test('calls made outside a run scope are uncounted and never throw', () => {
    // Losing a count must never take a generation run down with it.
    expect(() => countLlmCall()).not.toThrow()
    expect(llmCallsThisRun()).toBe(0)
  })
})

describe('every model call passes the counting point', () => {
  test('the router choke point counts each request', () => {
    const detailed = router.slice(router.indexOf('export async function createChatCompletionDetailed'))
    const body = detailed.slice(0, detailed.indexOf('\nexport '))
    expect(body).toContain('countLlmCall()')
  })

  test('the count happens before the request can fail', () => {
    // A retry costs the same budget as the call that finally worked, so the
    // counter is incremented when the request starts, not when it succeeds.
    // Counting on success would make the metric a count of successes, which is
    // a different number that also cannot be used for cost attribution.
    const body =
      router.slice(router.indexOf('export async function createChatCompletionDetailed'))
    const countedAt = body.indexOf('countLlmCall()')
    const firstAwait = body.indexOf('await ')
    expect(countedAt).toBeGreaterThan(-1)
    expect(firstAwait).toBeGreaterThan(-1)
    expect(countedAt).toBeLessThan(firstAwait)
  })

  test('the fallback entry point delegates to the counted function', () => {
    // Intake, request research and visual repair all enter through
    // `createChatCompletionWithFallback`. If it ever talks to a provider
    // directly, those calls silently stop being counted.
    const fallback = router.slice(router.indexOf('export async function createChatCompletionWithFallback'))
    expect(fallback).toContain('createChatCompletionDetailed')
  })
})

describe('latencyMs is written once, when the run ends', () => {
  test('there is exactly one write site', () => {
    // The old write sat inside the SCAD_GENERATED transition, which is the whole
    // reason the field measured a third of the wait. Two write sites means the
    // question "which one won" has to be answered again.
    expect(pipeline.match(/latencyMs:/g)?.length).toBe(1)
  })

  test('the write site is the finally block, not a mid-run transition', () => {
    const writeIndex = pipeline.indexOf('latencyMs:')
    const finallyIndex = pipeline.lastIndexOf('} finally {')
    expect(writeIndex).toBeGreaterThan(finallyIndex)
  })
})

describe('llmCallCount accumulates instead of overwriting', () => {
  test('every write is an increment', () => {
    // A second run overwriting the first run's total is how the counter ended up
    // reporting 1 call for jobs that had clearly made more.
    const writes = [...pipeline.matchAll(/llmCallCount:\s*([^\n]+)/g)].map((m) => m[1] ?? '')
    expect(writes.length).toBeGreaterThan(0)
    for (const write of writes) {
      expect(write).toContain('increment')
    }
  })

  test('the pipeline opens a counting scope around the run', () => {
    expect(pipeline).toContain('withLlmCallMeter(() => runCadJob(')
  })

  test('the visual repair route opens its own counting scope', () => {
    // Visual repair happens in a later, separate HTTP request, so it is outside
    // the pipeline's scope — and it makes two model calls of its own.
    expect(visualRepairRoute).toContain('withLlmCallMeter(() => handleVisualRepair(')
    expect(visualRepairRoute).toContain('llmCallCount: { increment: llmCallsThisRun() }')
  })
})
