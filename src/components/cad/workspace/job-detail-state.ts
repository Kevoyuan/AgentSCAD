import { Job } from '@/components/cad/types'

/*
 * "Not yet" and "not there" are different facts, and a module has to be able to
 * tell them apart before it writes a sentence about them.
 *
 * The job list is loaded with `?summary=true`, which carries the state, the
 * artifact paths and the timestamps — but not the parameter schema, the
 * parameter values or the validation results. Selecting a part therefore paints
 * it for one to two seconds with three of its fields missing, and a module that
 * cannot tell "missing" from "empty" answers with a sentence. The sentence it
 * chose was "No dimensions yet. Generate this part to see them here." — which is
 * false (the part exists, the data is on its way) and false in the most
 * expensive direction, because it tells the user to go and do the thing they
 * already did.
 *
 * `Job.summaryOnly` marks exactly that window, and nothing else: the flag is set
 * by `fetchJobs()` and cleared by the full record that `fetchJob()` returns.
 *
 * DESIGN.md section 17 wants a loading region to say it is loading, in markup as
 * well as in shape. Section 18 wants every sentence to be true. Both are
 * satisfiable at once, but only if the two states are told apart in the data
 * before they are told apart in the pixels.
 */

/** The part's detail record has not arrived yet — draw the shape, not a sentence. */
export function jobDetailsPending(job: Job | null | undefined): boolean {
  return Boolean(job?.summaryOnly) && !job?.detailFailed
}

/** The detail request failed. That is a fact worth saying, not a reason to spin. */
export function jobDetailsFailed(job: Job | null | undefined): boolean {
  return Boolean(job?.detailFailed)
}

/**
 * States that can only be reached once a build produced something.
 *
 * `NEW` is deliberately absent: a part in `NEW` has never been generated, and
 * "generate this part" is true of it.
 */
const BUILT_STATES = new Set([
  'SCAD_GENERATED',
  'RENDERED',
  'VALIDATED',
  'DELIVERED',
  'DEBUGGING',
  'REPAIRING',
  'VALIDATION_FAILED',
  'GEOMETRY_FAILED',
  'RENDER_FAILED',
  'HUMAN_REVIEW',
])

/**
 * Whether this part has ever been built.
 *
 * Used to choose between two honest empty sentences: "there is nothing here
 * because it was never generated" and "there is nothing here because this
 * design has no adjustable dimensions". Telling a part that has already been
 * generated to "generate this part" is the same class of lie as the loading
 * case, and it survives long after the network settles.
 */
export function jobHasBeenBuilt(job: Job | null | undefined): boolean {
  if (!job) return false
  if (job.stlPath || job.scadSource) return true
  return BUILT_STATES.has(job.state)
}
