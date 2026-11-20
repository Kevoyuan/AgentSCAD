import type { NumericParameterConstraints } from "../harness/types";

/** Apply explicit input constraints. Editor hints never restrict typed values. */
export function constrainNumericInput(value: number, constraints: NumericParameterConstraints): number {
  const min = constraints.min ?? -Infinity;
  const max = constraints.max ?? Infinity;
  const clamped = Math.max(min, Math.min(max, value));
  const step = constraints.step;
  if (step === undefined || step <= 0) return clamped;
  const origin = constraints.min ?? 0;
  const lower = (min - origin) / step;
  const upper = (max - origin) / step;
  const minimumStep = Math.ceil(lower - Number.EPSILON * 8 * Math.abs(lower));
  const maximumStep = Math.floor(upper + Number.EPSILON * 8 * Math.abs(upper));
  const index = Math.max(minimumStep, Math.min(maximumStep, Math.round((clamped - origin) / step)));
  return Number((origin + index * step).toPrecision(15));
}
