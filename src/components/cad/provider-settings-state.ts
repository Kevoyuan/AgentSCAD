import type { ProviderSettingsPersistence } from "@/components/cad/api";

export const DEFAULT_PROVIDER_PERSISTENCE: ProviderSettingsPersistence = {
  mode: "environment",
  writable: false,
};

export function getProviderSettingsUiState(
  persistence: ProviderSettingsPersistence,
  isLoading: boolean,
) {
  return {
    showEnvironmentNotice: !persistence.writable,
    canSave: !isLoading && persistence.writable,
  };
}
