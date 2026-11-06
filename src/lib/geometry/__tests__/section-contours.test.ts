import { expect, test } from "bun:test";
import { readBinaryStl, sectionMesh } from "../stl-mesh";
import { selectEnclosingContour } from "../section-contours";
import { tubeStl } from "./solids";

const section = () => sectionMesh(readBinaryStl(tubeStl({ outerRadius: 6, innerRadius: 4, height: 10, segments: 32 })), [0,0,5], [0,0,1]);

test("the same inner contour is selected across seeds while the exterior loop is excluded", () => {
  const input = section();
  const a = selectEnclosingContour(input, [0,0]);
  const b = selectEnclosingContour(input, [1,0]);
  expect(a.status).toBe("SELECTED");
  expect(b.points).toEqual(a.points);
  expect(a.points.every(p => Math.hypot(...p) < 4.001)).toBe(true);
  expect(a.joinToleranceMm).toBe(1e-7);
});

test("open, duplicate and branching sections cannot establish a contour", () => {
  const input = section();
  expect(selectEnclosingContour({...input, segments: input.segments.slice(1)}, [0,0]).status).toBe("NOT_RUN");
  expect(selectEnclosingContour({...input, segments: [...input.segments,input.segments[0]]}, [0,0]).status).toBe("NOT_RUN");
  expect(selectEnclosingContour({...input, segments: [...input.segments,{ax:4,ay:0,bx:0,by:0}]}, [0,0]).status).toBe("NOT_RUN");
});

test("boundary seeds, external seeds and incomplete sections withhold a selection", () => {
  const input = section();
  expect(selectEnclosingContour(input,[4,0]).status).toBe("NOT_RUN");
  expect(selectEnclosingContour(input,[7,0]).status).toBe("NOT_RUN");
  expect(selectEnclosingContour({...input,dropped:1},[0,0]).status).toBe("NOT_RUN");
});
