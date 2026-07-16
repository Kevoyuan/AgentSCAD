import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PROVIDER_PERSISTENCE,
  getProviderSettingsUiState,
} from "@/components/cad/provider-settings-state";

describe("provider settings UI state", () => {
  test("starts safe while persistence capabilities are loading", () => {
    expect(getProviderSettingsUiState(DEFAULT_PROVIDER_PERSISTENCE, true)).toEqual({
      showEnvironmentNotice: true,
      canSave: false,
    });
  });

  test("keeps save disabled for environment-managed providers", () => {
    expect(
      getProviderSettingsUiState(
        { mode: "environment", writable: false },
        false,
      )
    ).toEqual({
      showEnvironmentNotice: true,
      canSave: false,
    });
  });

  test("enables save only after writable file persistence is confirmed", () => {
    expect(
      getProviderSettingsUiState({ mode: "file", writable: true }, false)
    ).toEqual({
      showEnvironmentNotice: false,
      canSave: true,
    });
  });
});
