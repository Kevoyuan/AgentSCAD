import type { ProviderType } from "@/lib/provider-settings";

export type ProviderCategory = "official" | "aggregator" | "china" | "local" | "custom";

export type ProviderModelCategory = "flagship" | "balanced" | "fast" | "reasoning" | "vision" | "code";

export interface RecommendedProviderModel {
  id: string;
  label: string;
  description: string;
  category: ProviderModelCategory;
  multimodal: boolean;
  reasoning: boolean;
}

export interface ProviderPreset {
  id: string;
  label: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv?: string;
  requiresApiKey: boolean;
  category: ProviderCategory;
  description: string;
  docsUrl?: string;
  recommendedModels: RecommendedProviderModel[];
}

const model = (
  id: string,
  label: string,
  description: string,
  category: ProviderModelCategory,
  multimodal = false,
  reasoning = true,
): RecommendedProviderModel => ({
  id,
  label,
  description,
  category,
  multimodal,
  reasoning,
});

// Verified against provider documentation on 2026-07-16. Keep model IDs exact:
// aliases and punctuation differ between otherwise OpenAI-compatible providers.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6",
    apiKeyEnv: "OPENAI_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Official OpenAI API. GPT-5.6 Sol is recommended for CAD reasoning and code generation.",
    docsUrl: "https://developers.openai.com/api/docs/models",
    recommendedModels: [
      model("gpt-5.6", "GPT-5.6 Sol", "Best quality for complex CAD reasoning and OpenSCAD generation.", "flagship", true),
      model("gpt-5.6-terra", "GPT-5.6 Terra", "Balanced intelligence and cost for normal CAD jobs.", "balanced", true),
      model("gpt-5.6-luna", "GPT-5.6 Luna", "Cost-efficient choice for high-volume drafts and edits.", "fast", true),
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    type: "openai-compatible",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-fable-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Claude OpenAI compatibility endpoint. Native Claude API is recommended for advanced features.",
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    recommendedModels: [
      model("claude-fable-5", "Claude Fable 5", "Highest-capability Claude model for autonomous knowledge work and coding.", "flagship", true),
      model("claude-opus-4-8", "Claude Opus 4.8", "Highest-quality Claude option for long-horizon CAD and coding work.", "flagship", true),
      model("claude-sonnet-5", "Claude Sonnet 5", "Best speed/intelligence balance for iterative design.", "balanced", true),
      model("claude-haiku-4-5", "Claude Haiku 4.5", "Fast Claude option for short edits and classification.", "fast", true, false),
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    type: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Gemini API through Google's OpenAI-compatible endpoint.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    recommendedModels: [
      model("gemini-3.5-flash", "Gemini 3.5 Flash", "Stable production default for agentic, coding, and multimodal tasks.", "flagship", true),
      model("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "Preview model for the hardest multimodal reasoning jobs.", "reasoning", true),
      model("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "Stable low-cost model for high-volume lightweight work.", "fast", true),
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5.6-sol",
    apiKeyEnv: "OPENROUTER_API_KEY",
    requiresApiKey: true,
    category: "aggregator",
    description: "Access multiple model families through OpenRouter.",
    docsUrl: "https://openrouter.ai/docs",
    recommendedModels: [
      model("openai/gpt-5.6-sol", "GPT-5.6 Sol", "Latest OpenAI flagship through OpenRouter.", "flagship", true),
      model("anthropic/claude-fable-5", "Claude Fable 5", "Anthropic's highest-capability broadly available model.", "flagship", true),
      model("anthropic/claude-opus-4.8", "Claude Opus 4.8", "High-quality long-horizon reasoning and agentic coding.", "reasoning", true),
      model("anthropic/claude-sonnet-5", "Claude Sonnet 5", "Balanced multimodal coding and design iteration.", "balanced", true),
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    type: "deepseek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "DeepSeek OpenAI-compatible chat API.",
    docsUrl: "https://api-docs.deepseek.com",
    recommendedModels: [
      model("deepseek-v4-pro", "DeepSeek V4 Pro", "Recommended for complex CAD reasoning and high-quality code.", "flagship"),
      model("deepseek-v4-flash", "DeepSeek V4 Flash", "Faster and cheaper model for drafts and repair loops.", "fast"),
    ],
  },
  {
    id: "mimo",
    label: "Xiaomi MiMo",
    type: "mimo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    apiKeyEnv: "MIMO_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "Xiaomi MiMo token-plan OpenAI-compatible endpoint.",
    docsUrl: "https://mimo.mi.com/docs/en-US/quick-start/model",
    recommendedModels: [
      model("mimo-v2.5-pro", "MiMo-V2.5-Pro", "Recommended for complex agentic CAD and coding tasks.", "flagship"),
      model("mimo-v2.5", "MiMo-V2.5", "Multimodal model for CAD screenshots and general design work.", "vision", true),
      model("mimo-v2-flash", "MiMo-V2-Flash", "Fast model for drafts and lightweight edits.", "fast"),
    ],
  },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    type: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.2",
    apiKeyEnv: "ZHIPU_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "Zhipu BigModel OpenAI-compatible API.",
    docsUrl: "https://docs.bigmodel.cn",
    recommendedModels: [
      model("glm-5.2", "GLM-5.2", "Latest flagship with a 1M context window for coding and agent tasks.", "flagship"),
      model("glm-5.1", "GLM-5.1", "Previous flagship for long-horizon coding and agent tasks.", "reasoning"),
      model("glm-5-turbo", "GLM-5 Turbo", "Faster long-chain tool-use model.", "fast"),
    ],
  },
  {
    id: "z-ai",
    label: "Z.ai GLM",
    type: "openai-compatible",
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-5.1",
    apiKeyEnv: "ZAI_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "Z.ai global GLM OpenAI-compatible API.",
    docsUrl: "https://docs.z.ai",
    recommendedModels: [
      model("glm-5.1", "GLM-5.1", "Latest global flagship for coding and autonomous engineering.", "flagship"),
      model("glm-5-turbo", "GLM-5 Turbo", "Lower-latency option for tool-heavy workflows.", "fast"),
      model("glm-5v-turbo", "GLM-5V Turbo", "Vision model for screenshots and visual programming.", "vision", true),
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    type: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    apiKeyEnv: "MOONSHOT_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "Moonshot/Kimi OpenAI-compatible API.",
    docsUrl: "https://platform.moonshot.cn/docs",
    recommendedModels: [
      model("kimi-k2.5", "Kimi K2.5", "Latest officially documented multimodal reasoning model.", "flagship", true),
    ],
  },
  {
    id: "minimax-cn",
    label: "MiniMax CN",
    type: "openai-compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M3",
    apiKeyEnv: "MINIMAX_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "MiniMax China OpenAI-compatible endpoint.",
    docsUrl: "https://platform.minimaxi.com/docs",
    recommendedModels: [
      model("MiniMax-M3", "MiniMax M3", "Latest flagship with 1M context and native image/video understanding.", "flagship", true),
      model("MiniMax-M2.7", "MiniMax M2.7", "Efficient model for complex coding and agent workflows.", "balanced"),
      model("MiniMax-M2.7-highspeed", "MiniMax M2.7 Highspeed", "Same capability tier with higher output speed.", "fast"),
    ],
  },
  {
    id: "minimax-global",
    label: "MiniMax Global",
    type: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M3",
    apiKeyEnv: "MINIMAX_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "MiniMax global OpenAI-compatible endpoint.",
    docsUrl: "https://platform.minimax.io/docs",
    recommendedModels: [
      model("MiniMax-M3", "MiniMax M3", "Latest flagship with 1M context and native image/video understanding.", "flagship", true),
      model("MiniMax-M2.7", "MiniMax M2.7", "Efficient model for complex coding and agent workflows.", "balanced"),
      model("MiniMax-M2.7-highspeed", "MiniMax M2.7 Highspeed", "Same capability tier with higher output speed.", "fast"),
    ],
  },
  {
    id: "volcengine",
    label: "Volcengine Ark",
    type: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-lite-260428",
    apiKeyEnv: "ARK_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "ByteDance Volcengine Ark OpenAI-compatible endpoint.",
    docsUrl: "https://www.volcengine.com/docs/82379",
    recommendedModels: [
      model("doubao-seed-2-0-lite-260428", "Doubao Seed 2.0 Lite", "Current documented low-latency multimodal Agent model.", "fast", true),
      model("doubao-seed-2-0-mini-260428", "Doubao Seed 2.0 Mini", "More capable multimodal option for complex tasks.", "balanced", true),
    ],
  },
  {
    id: "bailian",
    label: "Aliyun Bailian",
    type: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-max-2026-06-08",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    requiresApiKey: true,
    category: "china",
    description: "Alibaba Cloud DashScope OpenAI-compatible mode.",
    docsUrl: "https://help.aliyun.com/zh/model-studio",
    recommendedModels: [
      model("qwen3.7-max-2026-06-08", "Qwen3.7 Max", "Pinned latest multimodal flagship for complex CAD and agent tasks.", "flagship", true),
      model("qwen3.7-plus", "Qwen3.7 Plus", "Balanced production model with a 1M context window.", "balanced", true),
      model("qwen3.6-flash", "Qwen3.6 Flash", "Fast multimodal model for high-volume drafts.", "fast", true),
    ],
  },
  {
    id: "mistral",
    label: "Mistral AI",
    type: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-medium-3-5",
    apiKeyEnv: "MISTRAL_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Mistral OpenAI-compatible chat API.",
    docsUrl: "https://docs.mistral.ai",
    recommendedModels: [
      model("mistral-medium-3-5", "Mistral Medium 3.5", "Recommended agentic and coding model with vision.", "flagship", true),
      model("mistral-small-2603", "Mistral Small 4", "Efficient hybrid reasoning and coding model.", "fast", true),
      model("mistral-large-2512", "Mistral Large 3", "Open-weight general-purpose multimodal model.", "balanced", true),
    ],
  },
  {
    id: "groq",
    label: "Groq",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    apiKeyEnv: "GROQ_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Groq OpenAI-compatible inference API.",
    docsUrl: "https://console.groq.com/docs",
    recommendedModels: [
      model("openai/gpt-oss-120b", "GPT-OSS 120B", "Production reasoning model and recommended Llama 3.3 replacement.", "flagship"),
      model("qwen/qwen3.6-27b", "Qwen3.6 27B", "Fast multimodal production model for coding and general workloads.", "balanced", true),
      model("openai/gpt-oss-20b", "GPT-OSS 20B", "Lowest-latency production reasoning option.", "fast"),
    ],
  },
  {
    id: "together",
    label: "Together AI",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "zai-org/GLM-5.1",
    apiKeyEnv: "TOGETHER_API_KEY",
    requiresApiKey: true,
    category: "official",
    description: "Together AI OpenAI-compatible API.",
    docsUrl: "https://docs.together.ai",
    recommendedModels: [
      model("zai-org/GLM-5.1", "GLM-5.1", "Together's coding-agent and function-calling recommendation.", "flagship"),
      model("moonshotai/Kimi-K2.6", "Kimi K2.6", "Current serverless general-purpose reasoning model.", "reasoning"),
      model("Qwen/Qwen3.5-397B-A17B", "Qwen3.5 397B", "Recommended multimodal vision model.", "vision", true),
    ],
  },
  {
    id: "ollama",
    label: "Ollama",
    type: "ollama",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen3.5:9b",
    requiresApiKey: false,
    category: "local",
    description: "Local Ollama OpenAI-compatible endpoint.",
    docsUrl: "https://docs.ollama.com",
    recommendedModels: [
      model("qwen3.5:9b", "Qwen3.5 9B", "Practical local multimodal default for modern laptops.", "balanced", true),
      model("gemma4:12b", "Gemma 4 12B", "Strong local multimodal reasoning and agent model.", "reasoning", true),
      model("qwen3.5:4b", "Qwen3.5 4B", "Smaller option for constrained local hardware.", "fast", true),
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "lm-studio-default",
    requiresApiKey: false,
    category: "local",
    description: "LM Studio local server. Enter the identifier of the model currently loaded in LM Studio.",
    docsUrl: "https://lmstudio.ai/docs",
    recommendedModels: [],
  },
  {
    id: "litellm",
    label: "LiteLLM",
    type: "openai-compatible",
    baseUrl: "http://localhost:4000/v1",
    defaultModel: "gpt-5.6",
    apiKeyEnv: "LITELLM_API_KEY",
    requiresApiKey: false,
    category: "local",
    description: "LiteLLM local or remote proxy.",
    docsUrl: "https://docs.litellm.ai",
    recommendedModels: [
      model("gpt-5.6", "GPT-5.6", "Use when your LiteLLM proxy exposes the current OpenAI alias.", "flagship", true),
    ],
  },
  {
    id: "vllm",
    label: "vLLM",
    type: "openai-compatible",
    baseUrl: "http://localhost:8000/v1",
    defaultModel: "vllm-default",
    requiresApiKey: false,
    category: "local",
    description: "Self-hosted vLLM server. Enter the configured --served-model-name value.",
    docsUrl: "https://docs.vllm.ai",
    recommendedModels: [],
  },
  {
    id: "custom",
    label: "Custom API",
    type: "openai-compatible",
    baseUrl: "https://example.com/v1",
    defaultModel: "model-name",
    requiresApiKey: false,
    category: "custom",
    description: "Any OpenAI-compatible provider or proxy.",
    recommendedModels: [],
  },
];

export function getProviderPreset(id?: string) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function getProviderPresetByModel(model?: string) {
  if (!model) return undefined;
  return PROVIDER_PRESETS.find(
    (preset) =>
      preset.defaultModel === model ||
      preset.recommendedModels.some((recommended) => recommended.id === model),
  );
}

export function getRecommendedProviderModel(modelId?: string) {
  if (!modelId) return undefined;
  for (const preset of PROVIDER_PRESETS) {
    const recommended = preset.recommendedModels.find((candidate) => candidate.id === modelId);
    if (recommended) return { preset, model: recommended };
  }
  return undefined;
}
