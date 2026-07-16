import { NextResponse } from "next/server";

import {
  getProviderPreset,
  getRecommendedProviderModel,
  PROVIDER_PRESETS,
  type ProviderModelCategory,
  type RecommendedProviderModel,
} from "@/lib/provider-catalog";
import {
  getEnvProviderConfigs,
  parseProviderModelId,
  readProviderSettings,
  toProviderModelId,
  type ProviderConfig,
  type PublicProviderConfig,
} from "@/lib/provider-settings";

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  provider: string;
  providerName: string;
  multimodal: boolean;
  reasoning: boolean;
  category: ProviderModelCategory;
}

function recommendedModelInfo(args: {
  id: string;
  providerId: string;
  providerName: string;
  model: RecommendedProviderModel;
}): ModelInfo {
  return {
    id: args.id,
    name: args.model.label,
    description: args.model.description,
    provider: args.providerId,
    providerName: args.providerName,
    multimodal: args.model.multimodal,
    reasoning: args.model.reasoning,
    category: args.model.category,
  };
}

function uniqueModels(models: ModelInfo[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export function buildModelCatalog(args: {
  providers: ProviderConfig[];
  envProviders: PublicProviderConfig[];
  includeBuiltIns: boolean;
}): ModelInfo[] {
  const configuredModels: ModelInfo[] = args.providers
    .filter((provider) => provider.enabled)
    .map((provider) => {
      const recommendation = getRecommendedProviderModel(provider.defaultModel);
      return {
        id: toProviderModelId(provider),
        name: recommendation?.model.label || provider.defaultModel,
        description:
          recommendation?.model.description ||
          `Configured in Settings > Providers via ${provider.name}.`,
        provider: provider.id,
        providerName: provider.name,
        multimodal: recommendation?.model.multimodal ?? false,
        reasoning: recommendation?.model.reasoning ?? true,
        category: recommendation?.model.category || (provider.isDefault ? "flagship" : "code"),
      };
    });

  const envModels: ModelInfo[] = args.envProviders
    .filter((provider) => provider.enabled)
    .flatMap((provider) => {
      const providerId = provider.id.replace(/^env-/, "");
      const preset = getProviderPreset(providerId);
      if (!preset) return [];

      return preset.recommendedModels.map((recommended) =>
        recommendedModelInfo({
          id: `provider:${provider.id}:${recommended.id}`,
          providerId,
          providerName: provider.name,
          model: recommended,
        }),
      );
    });

  const builtInModels: ModelInfo[] = PROVIDER_PRESETS.flatMap((preset) =>
    preset.recommendedModels.map((recommended) =>
      recommendedModelInfo({
        id: recommended.id,
        providerId: preset.id,
        providerName: preset.label,
        model: recommended,
      }),
    ),
  );

  return uniqueModels([
    ...configuredModels,
    ...envModels,
    ...(args.includeBuiltIns ? builtInModels : []),
  ]);
}

/**
 * Check whether a built-in or provider-qualified model accepts image input.
 * Unknown configured models remain conservative because silently forwarding
 * images to a text-only endpoint produces provider-specific failures.
 */
export function isModelMultimodal(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const parsed = parseProviderModelId(modelId);
  const recommended = getRecommendedProviderModel(parsed?.model || modelId);
  return recommended?.model.multimodal ?? false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeBuiltIns = searchParams.get("includeBuiltIns") === "true";
  const providers = await readProviderSettings();

  return NextResponse.json({
    models: buildModelCatalog({
      providers,
      envProviders: getEnvProviderConfigs(),
      includeBuiltIns,
    }),
  });
}
