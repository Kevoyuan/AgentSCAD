import { NextRequest, NextResponse } from 'next/server'
import { sanitizeRenderLogForClient, toPublicJob } from '@/lib/public-job'
import { db } from '@/lib/db'
import { trackVersion } from '@/lib/version-tracker'
import { appendLog, parameterDefsToValues } from '@/lib/stores/job-store'
import { sanitizeGeneratedScadSource } from '@/lib/tools/scad-sanitizer'
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
} from '@/lib/tools/scad-parameter-extractor'
import { buildRenderFailureLog, renderScadArtifacts } from '@/lib/tools/scad-renderer'
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from '@/lib/tools/validation-tool'
import { buildJobQuality } from '@/lib/validation/job-quality'
import type { ParameterDef, RenderedArtifacts } from '@/lib/harness/types'

interface RouteParams {
  params: Promise<{ id: string }>
}

function inferParameterState(scadSource: string, existingSchemaStr: string | null, existingValuesStr: string | null) {
  const existingValues = (() => {
    if (!existingValuesStr) return {} as Record<string, number>
    try {
      return JSON.parse(existingValuesStr) as Record<string, number>
    } catch {
      return {} as Record<string, number>
    }
  })()

  const existingSchema = (() => {
    if (!existingSchemaStr) return [] as ParameterDef[]
    try {
      const parsed = JSON.parse(existingSchemaStr) as { parameters?: ParameterDef[] } | ParameterDef[]
      return Array.isArray(parsed) ? parsed : (parsed.parameters || [])
    } catch {
      return []
    }
  })()

  const extractedParameters = extractParameterDefsFromScad(scadSource)
  if (extractedParameters.length === 0) {
    return {
      parameterSchema: existingSchemaStr,
      parameterValues: existingValuesStr,
      wallThickness: existingValues.wall_thickness ?? 2,
    }
  }

  const nextSchema = mergeExtractedParameters(extractedParameters, existingSchema)
  const extractedValues = parameterDefsToValues(nextSchema)

  return {
    parameterSchema: JSON.stringify(nextSchema),
    parameterValues: JSON.stringify(extractedValues),
    wallThickness: extractedValues.wall_thickness ?? existingValues.wall_thickness ?? 2,
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params

  try {
    const job = await db.job.findUnique({ where: { id } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const nextSource = body?.scadSource
    if (typeof nextSource !== 'string') {
      return NextResponse.json({ error: 'scadSource must be a string' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          const scadSource = sanitizeGeneratedScadSource(nextSource)
          const parameterState = inferParameterState(scadSource, job.parameterSchema, job.parameterValues)

          await trackVersion(id, 'scadSource', job.scadSource, scadSource, 'ai_apply')

          const scadUpdatedJob = await db.job.update({
            where: { id },
            data: {
              state: 'SCAD_GENERATED',
              scadSource,
              stlPath: null,
              pngPath: null,
              renderLog: null,
              parameterSchema: parameterState.parameterSchema,
              parameterValues: parameterState.parameterValues,
              generationPath: 'manual_scad_apply',
              executionLogs: appendLog(job.executionLogs, 'SCAD_APPLIED', 'Applied SCAD source and started rebuild'),
              completedAt: null,
            },
          })

          sendEvent({
            state: 'SCAD_GENERATED',
            step: 'scad_applied',
            message: 'SCAD applied. Rebuilding render and refreshing parameters...',
            scadSource,
            parameterSchema: parameterState.parameterSchema,
            parameterValues: parameterState.parameterValues,
            generationPath: 'manual_scad_apply',
          })

          sendEvent({
            state: 'SCAD_GENERATED',
            step: 'rendering',
            message: 'Rendering STL and preview image with current SCAD...',
          })

          let renderedArtifacts: RenderedArtifacts | null = null
          try {
            sendEvent({ state: 'SCAD_GENERATED', step: 'rendering', message: 'Generating STL...' })
            sendEvent({ state: 'SCAD_GENERATED', step: 'rendering', message: 'Generating PNG preview...' })
            renderedArtifacts = await renderScadArtifacts(id, scadSource)
            clearValidationCache()
          } catch (error) {
            const renderError = error instanceof Error ? error.message : 'Unknown OpenSCAD render error'
            const quality = buildJobQuality({
              state: 'GEOMETRY_FAILED',
              scadSource,
              stlPath: null,
              pngPath: null,
              validationResults: [],
            })
            const failedJob = await db.job.update({
              where: { id },
              data: {
                state: 'GEOMETRY_FAILED',
                stlPath: null,
                pngPath: null,
                renderLog: JSON.stringify(buildRenderFailureLog(0, [renderError])),
                qualityScore: quality.qualityScore,
                validationReportJson: quality.validationReportJson,
                executionLogs: appendLog(scadUpdatedJob.executionLogs, 'GEOMETRY_FAILED', `Applied SCAD render failed: ${renderError}`),
              },
            })

            sendEvent({
              state: 'GEOMETRY_FAILED',
              step: 'render_failed',
              message: 'Applied SCAD could not be rendered.',
              error: renderError,
              qualityReport: quality.readiness,
              job: toPublicJob(failedJob),
            })
            controller.close()
            return
          }

          if (!renderedArtifacts) {
            throw new Error('OpenSCAD render did not return artifact paths')
          }

          const renderedJob = await db.job.update({
            where: { id },
            data: {
              state: 'RENDERED',
              stlPath: renderedArtifacts.stlPath,
              pngPath: renderedArtifacts.pngPath,
              renderLog: JSON.stringify(renderedArtifacts.renderLog),
              executionLogs: appendLog(
                (await db.job.findUnique({ where: { id } }))?.executionLogs,
                'RENDERED',
                `Applied SCAD rendered successfully (${renderedArtifacts.renderLog.render_time_ms}ms)`
              ),
            },
          })

          sendEvent({
            state: 'RENDERED',
            step: 'rendered',
            message: 'Applied SCAD rendered successfully',
            stlPath: renderedJob.stlPath,
            pngPath: renderedJob.pngPath,
            renderLog: sanitizeRenderLogForClient(renderedJob.renderLog),
          })

          sendEvent({
            state: 'RENDERED',
            step: 'validating',
            message: 'Running mesh and visual design-intent validation...',
          })
          const validationResults = await validateRenderedArtifacts({
            inputRequest: job.inputRequest ?? 'generic part',
            partFamily: job.partFamily,
            scadSource,
            stlFilePath: renderedArtifacts.stlFilePath,
            previewImagePath: renderedArtifacts.pngFilePath,
            wallThickness: parameterState.wallThickness,
          })
          const criticalFailures = getCriticalValidationFailures(validationResults)
          const quality = buildJobQuality({
            state: criticalFailures.length > 0 ? 'HUMAN_REVIEW' : 'DELIVERED',
            scadSource,
            stlPath: renderedArtifacts.stlPath,
            pngPath: renderedArtifacts.pngPath,
            validationResults,
          })

          if (criticalFailures.length > 0) {
            const reviewJob = await db.job.update({
              where: { id },
              data: {
                state: 'HUMAN_REVIEW',
                validationResults: JSON.stringify(validationResults),
                qualityScore: quality.qualityScore,
                validationReportJson: quality.validationReportJson,
                executionLogs: appendLog(
                  (await db.job.findUnique({ where: { id } }))?.executionLogs,
                  'HUMAN_REVIEW',
                  `Applied SCAD rendered artifacts kept for review; validation blockers: ${criticalFailures.map((rule) => `${rule.rule_id} ${rule.rule_name}`).join(', ')}`
                ),
              },
            })

            sendEvent({
              state: 'HUMAN_REVIEW',
              step: 'validation_failed',
              message: 'Applied SCAD rendered successfully; validation blockers require review or repair before export.',
              validationResults,
              qualityReport: quality.readiness,
              job: toPublicJob(reviewJob),
            })
            controller.close()
            return
          }

          const validatedJob = await db.job.update({
            where: { id },
            data: {
              state: 'VALIDATED',
              validationResults: JSON.stringify(validationResults),
              qualityScore: quality.qualityScore,
              validationReportJson: quality.validationReportJson,
              executionLogs: appendLog(
                (await db.job.findUnique({ where: { id } }))?.executionLogs,
                'VALIDATED',
                (() => {
                  const actionable = validationResults.filter((rule) => !rule.message.toLowerCase().startsWith('skipped'))
                  const skipped = validationResults.length - actionable.length
                  return `Applied SCAD validation passed: ${actionable.filter((rule) => rule.passed).length}/${actionable.length} actionable rules passed` +
                    (skipped > 0 ? `, ${skipped} skipped` : ' [real mesh analysis]')
                })()
              ),
            },
          })

          sendEvent({
            state: 'VALIDATED',
            step: 'validated',
            message: 'Applied SCAD validated successfully',
            validationResults,
            qualityReport: quality.readiness,
          })

          const finalJob = await db.job.update({
            where: { id },
            data: {
              state: 'DELIVERED',
              completedAt: new Date(),
              executionLogs: appendLog(validatedJob.executionLogs, 'DELIVERED', 'Applied SCAD rebuild completed successfully'),
            },
          })

          sendEvent({
            state: 'DELIVERED',
            step: 'delivered',
            message: 'Applied SCAD saved, rendered, and delivered.',
            job: toPublicJob(finalJob),
          })
          controller.close()
        } catch (error) {
          console.error('Apply SCAD error:', error)
          const message = error instanceof Error ? error.message : 'Failed to apply SCAD source'
          sendEvent({ type: 'error', message })
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Apply SCAD route error:', error)
    return NextResponse.json({ error: 'Failed to apply SCAD source' }, { status: 500 })
  }
}
