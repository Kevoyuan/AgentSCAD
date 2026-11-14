/**
 * Browser-only, read-only collision pair replay.
 *
 * The ZIP is fetched explicitly under the same authenticated source/spec lease
 * as the exporter, WITHOUT download=1 (so it is not an export event). This
 * parser checks actual bytes and the two STL SHA-256 values recorded when the
 * collision was measured. It does not trust filenames or a manifest role alone.
 *
 * A replay illustrates ONE sampled BVH query, not a continuous path, an exact
 * contact point, a user-intended feature, or a physical fit certificate.
 */
import { unzipSync } from 'fflate'
import { validateAssemblySpec, validateRigidTransform } from '@/lib/assembly/assembly-spec'

const SHA = /^[a-f0-9]{64}$/
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024

export type CollisionReplayTarget = {
  movingInstanceId: string
  obstacleInstanceId: string
  collision: 'INTERSECT' | 'CONTAINED' | 'UNKNOWN'
  poseIndex: number
  frame: {
    frame: 'right-handed-mm-row-major-4x4/v1'
    movingWorldFromLocal: number[]
    obstacleWorldFromLocal: number[]
    movingMeshSha256: string
    obstacleMeshSha256: string
  }
  /** BVH's midpoint of triangle centroids, never a mathematically exact contact. */
  witnessCentroidPointMm: number[] | null
}

export type CollisionReplayPair = {
  moving: { instanceId: string; stl: Uint8Array; matrix: number[] }
  obstacle: { instanceId: string; stl: Uint8Array; matrix: number[] }
  collision: CollisionReplayTarget['collision']
  poseIndex: number
  witnessCentroidPointMm: [number, number, number] | null
  sourceSha256: string
  specificationSha256: string
  archiveSha256: string
}

function requireReplay(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  requireReplay(typeof crypto !== 'undefined' && !!crypto.subtle, 'Web Crypto is unavailable; cannot verify STL hashes.')
  // Owned ArrayBuffer-backed copy avoids SharedArrayBuffer/BufferSource incompatibilities.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
}

function object(input: unknown, label: string): Record<string, unknown> {
  requireReplay(input !== null && typeof input === 'object' && !Array.isArray(input), 'Invalid ' + label)
  return input as Record<string, unknown>
}

function jsonEntry(bytes: Uint8Array | undefined, label: string): unknown {
  requireReplay(bytes !== undefined && bytes.length > 0 && bytes.length < 4 * 1024 * 1024, 'Missing or oversized ' + label)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('Invalid ' + label) }
}

export async function prepareCollisionReplayPair(
  archive: Uint8Array,
  sourceSha256: string,
  specificationSha256: string,
  target: CollisionReplayTarget,
): Promise<CollisionReplayPair> {
  requireReplay(SHA.test(sourceSha256) && SHA.test(specificationSha256), 'Missing current source/specification hashes.')
  requireReplay(archive.length > 0 && archive.length <= MAX_ARCHIVE_BYTES, 'Assembly ZIP exceeds the 64 MiB replay limit.')
  requireReplay(target.frame.frame === 'right-handed-mm-row-major-4x4/v1', 'Unsupported collision coordinate convention.')
  requireReplay(SHA.test(target.frame.movingMeshSha256) && SHA.test(target.frame.obstacleMeshSha256), 'Collision witness lacks mesh hashes.')
  requireReplay(Number.isSafeInteger(target.poseIndex) && target.poseIndex >= 0, 'Invalid collision pose index.')
  requireReplay(['INTERSECT', 'CONTAINED', 'UNKNOWN'].includes(target.collision), 'Invalid collision classification.')
  const movingTransform = validateRigidTransform(target.frame.movingWorldFromLocal)
  const obstacleTransform = validateRigidTransform(target.frame.obstacleWorldFromLocal)
  requireReplay(movingTransform.success && obstacleTransform.success, 'Collision witness has invalid or non-rigid transforms.')
  requireReplay(target.witnessCentroidPointMm === null || (
    target.collision === 'INTERSECT' && target.witnessCentroidPointMm.length === 3 &&
    target.witnessCentroidPointMm.every(Number.isFinite)
  ), 'A reported witness is invalid or not from an actual triangle intersection.')

  // Conservative bounds are enforced before inflation. First scan ZIP names
  // while inflating only the two metadata files, then extract only the exact
  // moving/obstacle STL files after resolving instance IDs from the spec.
  let entryCount = 0, totalInflated = 0
  const present = new Set<string>()
  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(archive, {
      filter(entry) {
        requireReplay(!present.has(entry.name), 'Duplicate ZIP entry.')
        present.add(entry.name)
        entryCount++
        requireReplay(entryCount <= 203, 'Too many ZIP entries.')
        requireReplay(/^(?:manifest\.json|specification\.json|README\.txt|[A-Za-z][A-Za-z0-9_-]{0,63}\.stl)$/.test(entry.name), 'Unexpected ZIP entry.')
        requireReplay(Number.isSafeInteger(entry.originalSize) && entry.originalSize <= MAX_ENTRY_BYTES, 'Oversized ZIP entry.')
        totalInflated += entry.originalSize
        requireReplay(totalInflated <= MAX_TOTAL_BYTES, 'Uncompressed ZIP exceeds replay budget.')
        return entry.name === 'manifest.json' || entry.name === 'specification.json'
      },
    })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid assembly ZIP.')
  }

  const manifest = object(jsonEntry(extracted['manifest.json'], 'manifest'), 'manifest')
  const specBytes = extracted['specification.json']
  const parsed = validateAssemblySpec(jsonEntry(specBytes, 'specification'))
  requireReplay(parsed.success, 'Invalid assembly specification in ZIP.')
  requireReplay((await sha256(specBytes)) === specificationSha256, 'Specification bytes do not match the requested version.')
  requireReplay(manifest.sourceSha256 === sourceSha256 &&
    manifest.specificationSha256 === specificationSha256, 'Assembly ZIP belongs to another source/specification.')

  const instances = new Map(parsed.data.instances.map(item => [item.id, item]))
  const declarations = new Map(parsed.data.parts.map(item => [item.id, item]))
  const inventory = Array.isArray(manifest.parts) ? manifest.parts : []
  requireReplay(inventory.length === parsed.data.parts.length, 'ZIP part inventory differs from the specification.')
  const movingPartId = instances.get(target.movingInstanceId)?.partId
  const obstaclePartId = instances.get(target.obstacleInstanceId)?.partId
  requireReplay(movingPartId && obstaclePartId, 'Collision witness uses an unknown assembly instance.')
  const requiredStls = new Set([movingPartId + '.stl', obstaclePartId + '.stl'])
  // No unbounded decompression: the pass above checked every declared ZIP entry
  // size and total. This second pass inflates at most the two witness STL files.
  const stlEntries = unzipSync(archive, { filter: entry => requiredStls.has(entry.name) })
  extracted = { ...extracted, ...stlEntries }

  const getPart = async (instanceId: string, expectedHash: string) => {
    const instance = instances.get(instanceId)
    requireReplay(instance, 'Collision instance is absent from the current specification.')
    const declared = declarations.get(instance.partId)
    requireReplay(declared?.source === 'generated', 'Purchased or missing collision geometry cannot be replayed.')
    const item = inventory.find(value => value && typeof value === 'object' && (value as { id?: unknown }).id === instance.partId)
    requireReplay(item, 'Collision part is absent from the ZIP inventory.')
    const part = object(item, 'part record')
    requireReplay(part.id === declared.id && part.fileName === declared.id + '.stl' &&
      part.artifactSha256 === expectedHash, 'Collision part SHA-256 differs from the measured witness.')
    const bytes = extracted[declared.id + '.stl']
    requireReplay(bytes !== undefined && bytes.length >= 84 && bytes.length <= MAX_ENTRY_BYTES, 'Collision part STL is missing or oversized.')
    requireReplay((await sha256(bytes)) === expectedHash, 'Collision part STL bytes differ from the measured witness.')
    const triangleCount = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    requireReplay(triangleCount > 0 && 84 + triangleCount * 50 === bytes.length &&
      triangleCount === part.triangleCount, 'Invalid or inconsistent collision part STL.')
    return bytes
  }

  const moving = await getPart(target.movingInstanceId, target.frame.movingMeshSha256)
  const obstacle = await getPart(target.obstacleInstanceId, target.frame.obstacleMeshSha256)
  requireReplay(target.movingInstanceId !== target.obstacleInstanceId, 'Collision pair repeats one instance.')
  const witness = target.witnessCentroidPointMm
  return {
    moving: { instanceId: target.movingInstanceId, stl: moving, matrix: Array.from(movingTransform.data) },
    obstacle: { instanceId: target.obstacleInstanceId, stl: obstacle, matrix: Array.from(obstacleTransform.data) },
    collision: target.collision, poseIndex: target.poseIndex,
    witnessCentroidPointMm: witness ? [witness[0], witness[1], witness[2]] : null,
    sourceSha256, specificationSha256,
    archiveSha256: await sha256(archive),
  }
}

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Explicit user action, never triggered by polling or opening the page. */
export async function fetchCollisionReplayPair(
  jobId: string,
  sourceSha256: string,
  specificationSha256: string,
  target: CollisionReplayTarget,
  request: Request = fetch,
): Promise<CollisionReplayPair> {
  requireReplay(SHA.test(sourceSha256) && SHA.test(specificationSha256), 'Current source/specification hashes required.')
  const query = new URLSearchParams({ sourceSha256, specSha256: specificationSha256 })
  const response = await request('/api/jobs/' + encodeURIComponent(jobId) + '/assembly/bundle?' + query, {
    credentials: 'include', cache: 'no-store',
  })
  if (response.status === 409) throw new Error('Assembly changed or is processing; inspect the current assembly again.')
  if (response.status === 422) throw new Error('Assembly geometry cannot be rendered into a complete part ZIP.')
  requireReplay(response.ok, 'Could not obtain collision replay meshes.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actualArchive = await sha256(bytes)
  const headerHash = response.headers.get('X-AgentSCAD-Bundle-SHA256')
  requireReplay(headerHash === actualArchive, 'Archive bytes do not match the authenticated bundle response.')
  return prepareCollisionReplayPair(bytes, sourceSha256, specificationSha256, target)
}
