import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { canonicalJson } from '@/lib/canonical-json'
import { boxStl } from '@/lib/geometry/__tests__/solids'
import {
  prepareCollisionReplayPair,
  fetchCollisionReplayPair,
  type CollisionReplayTarget,
} from './collision-replay-data'

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const sourceSha = 'a'.repeat(64)
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const moved = [0, -1, 0, 12, 1, 0, 0, -3, 0, 0, 1, 8, 0, 0, 0, 1]
const spec = {
  schemaVersion: 1, units: 'mm', coordinateSystem: 'right-handed',
  parts: [
    { id: 'base', name: 'Base', selector: 'base', source: 'generated', material: null },
    { id: 'pin', name: 'Pin', selector: 'pin', source: 'generated', material: null },
  ],
  instances: [
    { id: 'base1', partId: 'base', subassemblyId: null, transform: identity },
    { id: 'pin1', partId: 'pin', subassemblyId: null, transform: moved },
    { id: 'pin2', partId: 'pin', subassemblyId: null, transform: identity },
  ],
  subassemblies: [], connections: [], groundedInstanceId: 'base1',
  motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
}
const specString = canonicalJson(spec)
const specSha = sha(specString)
const baseStl = boxStl([0, 0, 0], [3, 2, 1])
const pinStl = boxStl([0, 0, 0], [1, 1, 2])
const recorded: CollisionReplayTarget = {
  movingInstanceId: 'pin1', obstacleInstanceId: 'base1',
  collision: 'INTERSECT', poseIndex: 6,
  frame: {
    frame: 'right-handed-mm-row-major-4x4/v1',
    movingWorldFromLocal: moved,
    obstacleWorldFromLocal: identity,
    movingMeshSha256: sha(pinStl),
    obstacleMeshSha256: sha(baseStl),
  },
  witnessCentroidPointMm: [4.5, -1, 2],
}

function fixture(options: { modifiedPin?: Uint8Array; purchasedPin?: boolean } = {}) {
  const parts = [
    { id: 'base', fileName: 'base.stl', artifactSha256: sha(baseStl), triangleCount: baseStl.readUInt32LE(80) },
    { id: 'pin', fileName: options.purchasedPin ? null : 'pin.stl', artifactSha256: options.purchasedPin ? null : sha(pinStl), triangleCount: options.purchasedPin ? null : pinStl.readUInt32LE(80) },
  ]
  const sourceSpec = options.purchasedPin
    ? { ...spec, parts: spec.parts.map(p => p.id === 'pin' ? { ...p, source: 'purchased' } : p) }
    : spec
  const sourceBytes = canonicalJson(sourceSpec)
  const manifest = { sourceSha256: sourceSha, specificationSha256: sha(sourceBytes), parts }
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'specification.json': strToU8(sourceBytes),
    'README.txt': strToU8('Partial fixture for verified replay only'),
    'base.stl': baseStl,
    ...(options.purchasedPin ? {} : { 'pin.stl': options.modifiedPin ?? pinStl }),
  })
  return { archive: zip, specSha256: sha(sourceBytes) }
}

describe('hash-bound 3D collision pair replay data', () => {
  test('loads exact moving and obstacle STL bytes with non-origin, rotated world transforms', async () => {
    const { archive } = fixture()
    const pair = await prepareCollisionReplayPair(archive, sourceSha, specSha, recorded)
    expect(pair.moving.instanceId).toBe('pin1')
    expect(pair.obstacle.instanceId).toBe('base1')
    expect(Array.from(pair.moving.matrix)).toEqual(moved)
    expect(Array.from(pair.obstacle.matrix)).toEqual(identity)
    expect(sha(pair.moving.stl)).toBe(recorded.frame.movingMeshSha256)
    expect(sha(pair.obstacle.stl)).toBe(recorded.frame.obstacleMeshSha256)
    expect(pair.witnessCentroidPointMm).toEqual(recorded.witnessCentroidPointMm)
    expect(pair.archiveSha256).toBe(sha(archive))
  })

  test('repeated instances of one part are differentiated by actual witness instance identity and pose', async () => {
    const { archive } = fixture()
    const swapped = { ...recorded, movingInstanceId: 'pin2', obstacleInstanceId: 'pin1',
      frame: { ...recorded.frame, movingMeshSha256: sha(pinStl), obstacleMeshSha256: sha(pinStl), obstacleWorldFromLocal: moved, movingWorldFromLocal: identity } }
    const pair = await prepareCollisionReplayPair(archive, sourceSha, specSha, swapped)
    expect(sha(pair.moving.stl)).toBe(sha(pair.obstacle.stl))
    expect(pair.moving.instanceId).toBe('pin2')
    expect(pair.obstacle.instanceId).toBe('pin1')
    expect(pair.moving.matrix).toEqual(identity)
    expect(pair.obstacle.matrix).toEqual(moved)
  })

  test('tampered bytes, changed witness hash and stale specification all fail closed', async () => {
    const { archive } = fixture()
    const modified = Buffer.from(pinStl)
    modified[140] ^= 0x01 // valid STL table, invalid measured byte identity
    const damaged = fixture({ modifiedPin: modified }).archive
    await expect(prepareCollisionReplayPair(damaged, sourceSha, specSha, recorded)).rejects.toThrow('STL bytes differ')
    const wrongWitness = { ...recorded, frame: { ...recorded.frame, movingMeshSha256: 'f'.repeat(64) } }
    await expect(prepareCollisionReplayPair(archive, sourceSha, specSha, wrongWitness)).rejects.toThrow('differs from the measured witness')
    await expect(prepareCollisionReplayPair(archive, 'b'.repeat(64), specSha, recorded)).rejects.toThrow('another source/specification')
    await expect(prepareCollisionReplayPair(archive, sourceSha, 'b'.repeat(64), recorded)).rejects.toThrow('Specification bytes do not match')
  })

  test('missing purchased mesh, wrong instance, nonrigid matrix and fake UNKNOWN contact are never drawn', async () => {
    const { archive, specSha256 } = fixture({ purchasedPin: true })
    await expect(prepareCollisionReplayPair(archive, sourceSha, specSha256, recorded)).rejects.toThrow('Purchased or missing')
    const normal = fixture().archive
    await expect(prepareCollisionReplayPair(normal, sourceSha, specSha,
      { ...recorded, obstacleInstanceId: 'other' })).rejects.toThrow('unknown assembly instance')
    const nonrigid = [...moved]; nonrigid[0] = 2
    await expect(prepareCollisionReplayPair(normal, sourceSha, specSha,
      { ...recorded, frame: { ...recorded.frame, movingWorldFromLocal: nonrigid } })).rejects.toThrow('non-rigid')
    await expect(prepareCollisionReplayPair(normal, sourceSha, specSha,
      { ...recorded, collision: 'UNKNOWN' })).rejects.toThrow('not from an actual triangle intersection')
    const unknown = await prepareCollisionReplayPair(normal, sourceSha, specSha,
      { ...recorded, collision: 'UNKNOWN', witnessCentroidPointMm: null })
    expect(unknown.witnessCentroidPointMm).toBeNull()
  })

  test('the user-triggered request is credentialed, version-bound, does not record export, and rejects changed jobs', async () => {
    const { archive } = fixture()
    const headers = { 'X-AgentSCAD-Bundle-SHA256': sha(archive) }
    const observed: Array<{url: string; credentials?: RequestCredentials}> = []
    const request = async (url: RequestInfo | URL, init?: RequestInit) => {
      observed.push({ url: String(url), credentials: init?.credentials })
      return new Response(archive, { headers })
    }
    const pair = await fetchCollisionReplayPair('job id', sourceSha, specSha, recorded, request)
    expect(pair.poseIndex).toBe(6)
    expect(observed).toEqual([{
      url: '/api/jobs/job%20id/assembly/bundle?sourceSha256=' + sourceSha + '&specSha256=' + specSha,
      credentials: 'include',
    }])
    expect(observed[0].url).not.toContain('download=1')
    await expect(fetchCollisionReplayPair('job', sourceSha, specSha, recorded,
      async () => new Response('', { status: 409 }))).rejects.toThrow('changed')
    await expect(fetchCollisionReplayPair('job', sourceSha, specSha, recorded,
      async () => new Response(archive, { headers: { 'X-AgentSCAD-Bundle-SHA256': 'f'.repeat(64) } }))).rejects.toThrow('Archive bytes')
    await expect(fetchCollisionReplayPair('job', '', specSha, recorded, request)).rejects.toThrow('hashes required')
  })
})
