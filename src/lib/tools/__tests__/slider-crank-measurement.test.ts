import { expect, test } from "bun:test";
import { sampleSliderCrankSource } from "../slider-crank-measurement";
import setup from "../../../../scripts/eval/assembly-fixtures/slider-crank-geometry.json";

test("attachments cannot replace or alias measured mechanism roles", async () => {
  const invalid: Array<Record<string, string>> = [{ crank: "key" }, { key: "crank" }, { key: "same", key2: "same" }, { "bad/key": "key" }];
  for (const attachments of invalid) {
    await expect(sampleSliderCrankSource({ ...setup, scadSource: "", attachments })).rejects.toThrow("Attachment");
  }
});
