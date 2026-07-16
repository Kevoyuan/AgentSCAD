import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("provider model refresh contract", () => {
  test("reloads engines when the composer opens or provider settings change", () => {
    const composer = readSource(
      "src/components/cad/workspace/JobComposer.tsx",
    );
    const workspace = readSource(
      "src/components/cad/workspace/MainWorkspace.tsx",
    );
    const settings = readSource(
      "src/components/cad/provider-settings-panel.tsx",
    );

    expect(composer).toContain("if (!showComposer) return");
    expect(composer).toContain(
      "[showComposer, providerRevision, newJobModelId, onNewJobModelIdChange]",
    );
    expect(workspace).toContain("providerRevision={providerRevision}");
    expect(workspace).toContain(
      "onProvidersChanged={() => setProviderRevision(revision => revision + 1)}",
    );
    expect(settings.match(/onProvidersChanged\?\.\(\)/g)).toHaveLength(4);
  });
});
