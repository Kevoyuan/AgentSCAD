import { describe, expect, test } from "bun:test";
import type { TriangleMesh } from "../src/lib/geometry/stl-mesh";
import { applyMatrixPoint, crossSectionCenter, nearestTriangleHit, toolCylinderMesh, type Vec3 } from "./geometry";

function meshFromVertices(vertices: Vec3[]): TriangleMesh {
  if (vertices.length % 3 !== 0) throw new Error("vertex count must be a multiple of 3");
  const coordinates: number[] = [];
  for (const vertex of vertices) coordinates.push(vertex[0], vertex[1], vertex[2]);
  return { triangleCount: vertices.length / 3, coordinates: Float64Array.from(coordinates) };
}

/** One triangle in the XY plane at z = 0, spanning (0,0)-(10,0)-(0,10). */
const planeTriangle = meshFromVertices([[0, 0, 0], [10, 0, 0], [0, 10, 0]]);

function ringMesh(centerX: number, centerY: number, radius: number, triangles: number): TriangleMesh {
  const vertices: Vec3[] = [];
  for (let index = 0; index < triangles * 3; index += 1) {
    const angle = (index / (triangles * 3)) * Math.PI * 2;
    vertices.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, 0]);
  }
  return meshFromVertices(vertices);
}

describe("bench geometry primitives", () => {
  test("nearestTriangleHit measures a two-sided ray distance", () => {
    expect(nearestTriangleHit(planeTriangle, [1, 1, 5], [0, 0, -1], 10)).toBeCloseTo(5, 9);
    expect(nearestTriangleHit(planeTriangle, [1, 1, -5], [0, 0, 1], 10)).toBeCloseTo(5, 9);
    expect(nearestTriangleHit(planeTriangle, [1, 1, 5], [0, 0, 1], 10)).toBeNull();
  });

  test("nearestTriangleHit misses outside the tri, parallel rays, and beyond the budget", () => {
    expect(nearestTriangleHit(planeTriangle, [20, 20, 5], [0, 0, -1], 10)).toBeNull();
    expect(nearestTriangleHit(planeTriangle, [1, 1, 5], [1, 0, 0], 10)).toBeNull();
    expect(nearestTriangleHit(planeTriangle, [1, 1, 5], [0, 0, -1], 4)).toBeNull();
  });

  test("applyMatrixPoint follows the row-major 4x4 convention", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(applyMatrixPoint(identity, [1, 2, 3])).toEqual([1, 2, 3]);
    const translated = [1, 0, 0, 7, 0, 1, 0, -2, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(applyMatrixPoint(translated, [1, 2, 3])).toEqual([8, 0, 3]);
    const rotatedZ90 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(applyMatrixPoint(rotatedZ90, [1, 0, 0])).toEqual([0, 1, 0]);
  });

  test("toolCylinderMesh is a closed cylinder from the tip backwards", () => {
    const segments = 8;
    const tool = toolCylinderMesh([0, 0, 0], [0, 0, 2], 1, 2, segments);
    // Four triangles per side segment (two side, one tip cap, one back cap).
    expect(tool.triangleCount).toBe(4 * segments);
    let minZ = Infinity, maxZ = -Infinity, maxRadius = 0, tipVertices = 0, backVertices = 0;
    for (let vertex = 0; vertex < tool.triangleCount * 3; vertex += 1) {
      const base = vertex * 3;
      const x = tool.coordinates[base], y = tool.coordinates[base + 1], z = tool.coordinates[base + 2];
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      maxRadius = Math.max(maxRadius, Math.hypot(x, y));
      if (Math.abs(z) < 1e-9) tipVertices += 1;
      if (Math.abs(z + 2) < 1e-9) backVertices += 1;
    }
    expect(minZ).toBeCloseTo(-2, 9);
    expect(maxZ).toBeCloseTo(0, 9);
    expect(maxRadius).toBeCloseTo(1, 9);
    expect(tipVertices).toBeGreaterThanOrEqual(segments);
    expect(backVertices).toBeGreaterThanOrEqual(segments);
  });

  test("crossSectionCenter returns the bounding-box centre of accepted vertices", () => {
    const center = crossSectionCenter(ringMesh(2, -3, 5, 8), () => true);
    expect(center).not.toBeNull();
    expect(center!.x).toBeCloseTo(2, 2);
    expect(center!.y).toBeCloseTo(-3, 2);
    expect(center!.n).toBe(24);
    const lowerHalf = crossSectionCenter(ringMesh(2, -3, 5, 8), (_x, y) => y < -3);
    expect(lowerHalf).toBeNull();
  });
});
