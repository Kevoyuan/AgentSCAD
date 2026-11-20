import { expect, test } from "bun:test";
import { constrainNumericInput } from "../numeric-parameter-input";

test("unconstrained numeric input preserves signed values and precision", () => {
  for (const value of [-0.9, -720, 500, 0.000012345678901234]) {
    expect(constrainNumericInput(value, {})).toBe(value);
  }
});

test("explicit bounds and steps remain active, including fractional boundary values", () => {
  expect(constrainNumericInput(-0.9, { min: 0 })).toBe(0);
  expect(constrainNumericInput(12, { max: 10 })).toBe(10);
  expect(constrainNumericInput(10.25, { min: 10, max: 12, step: 0.5 })).toBe(10.5);
  expect(constrainNumericInput(0.3, { min: 0, max: 0.3, step: 0.1 })).toBe(0.3);
  expect(constrainNumericInput(-0.1, { max: -0.1, step: 0.1 })).toBe(-0.1);
});
