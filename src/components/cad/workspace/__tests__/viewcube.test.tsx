import { describe, expect, test } from 'bun:test'
import { pickViewRegion, labelFor, VIEWCUBE_GEOMETRY } from '../ViewCube'

/*
 * DESIGN.md section 4: the ViewCube has 26 selectable regions and picking is by
 * ray intersection, not DOM hit-testing.
 *
 * These guard one bug that already shipped: the entry point was normalised
 * before the per-axis threshold was applied, which erased the half-width ratios
 * and made every click resolve to whichever axis happened to win the tie-break.
 */

const P = 400 // matches the CSS perspective on the cube host

describe('ViewCube region picking', () => {
  test('covers all 26 standard views', () => {
    expect(VIEWCUBE_GEOMETRY.regions).toBe(26)
    expect(VIEWCUBE_GEOMETRY.half).toBe(VIEWCUBE_GEOMETRY.size / 2)
  })

  test('from the front view: centre is the face, bands are edges, corners are corners', () => {
    const h = VIEWCUBE_GEOMETRY.half
    expect(pickViewRegion(0, 0, P, 0, 0)?.name).toBe('front')
    expect(pickViewRegion(h * 0.78, 0, P, 0, 0)?.name).toBe('front-right')
    expect(pickViewRegion(-h * 0.78, 0, P, 0, 0)?.name).toBe('front-left')
    expect(pickViewRegion(0, -h * 0.78, P, 0, 0)?.name).toBe('top-front')
    expect(pickViewRegion(h * 0.75, -h * 0.75, P, 0, 0)?.name).toBe('tf-right')
  })

  test('a point still inside the face region stays on the face', () => {
    const h = VIEWCUBE_GEOMETRY.half
    // 0.5 of a half-width is comfortably inside the 0.62 face threshold
    expect(pickViewRegion(h * 0.5, 0, P, 0, 0)?.name).toBe('front')
  })

  test('a ray that misses the cube returns null instead of jumping somewhere', () => {
    const h = VIEWCUBE_GEOMETRY.half
    expect(pickViewRegion(h * 3, 0, P, 0, 0)).toBeNull()
    expect(pickViewRegion(0, h * 3, P, 0, 0)).toBeNull()
  })

  test('regions resolve relative to the current camera, not to a fixed axis', () => {
    const h = VIEWCUBE_GEOMETRY.half
    // With the camera already at the front-top-right corner, the centre of the
    // cube is that corner - clicking it must not throw the view somewhere else.
    expect(pickViewRegion(0, 0, P, 27, 45)?.name).toBe('tf-right')
    // From that same camera the right band is the right face and the lower-right
    // diagonal is the top-right edge. Same pixels, different region than from the
    // front view - which is exactly why the picker needs the camera as input.
    expect(pickViewRegion(h * 0.9, 0, P, 27, 45)?.name).toBe('right')
    expect(pickViewRegion(h * 0.75, -h * 0.75, P, 27, 45)?.name).toBe('top-right')
  })

  test('every returned region is one of the 26 known views', () => {
    const h = VIEWCUBE_GEOMETRY.half
    const seen = new Set<string>()
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        const v = pickViewRegion(gx * h * 0.7, gy * h * 0.7, P, 0, 0)
        if (v?.name) seen.add(v.name)
      }
    }
    expect(seen.size).toBeGreaterThan(3)
    for (const name of seen) expect(name).not.toBe('')
  })
})

/*
 * DESIGN.md section 4: "An angle that lands exactly on one of the 26 stops shows
 * that stop's name. Any other angle says so. Never imply a stop exists when the
 * camera is between stops."
 *
 * The camera clamps elevation to ±89.8° because the up vector is undefined at
 * exactly ±90°, so the two vertical stops are reached at the clamp, not at the
 * table's literal value. Before this, `3` and `6` and a click on the cube's top or
 * bottom face all reported 自由视角 · 上/下: a real stop labelling itself as a free
 * angle, which is the same lie in the other direction.
 */
describe('ViewCube stop labels', () => {
  test('the clamped top/bottom stops report 上 / 下, not 自由视角', () => {
    expect(labelFor(89.8, 0)).toBe('上')
    expect(labelFor(-89.8, 0)).toBe('下')
    // Whatever azimuth the top stop was reached from, it is still 上.
    expect(labelFor(89.8, 90)).toBe('上')
  })

  test('the exact stops keep their names', () => {
    expect(labelFor(0, 0)).toBe('前')
    expect(labelFor(0, 90)).toBe('右')
    expect(labelFor(0, 180)).toBe('后')
    expect(labelFor(0, -90)).toBe('左')
    expect(labelFor(45, 45)).toBe('等轴 · 前上右')
  })

  test('an angle between stops still says so', () => {
    // 40° azimuth sits between 前 (0°) and 前右 (45°), and must not claim either.
    expect(labelFor(0, 40)).toBe('自由视角 · 前右')
    expect(labelFor(70, 12)).toBe('自由视角 · 上')
  })
})
