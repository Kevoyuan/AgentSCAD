import type { NextConfig } from "next";
import openScadPolicy from "./config/openscad-wasm-runtime.json";

const openScadRuntimeFiles = [
  `.openscad-runtime/${openScadPolicy.runtime_filename}`,
  `.openscad-runtime/${openScadPolicy.copying_filename}`,
  ".openscad-runtime/metadata.json",
  "config/openscad-wasm-runtime.json",
  "openscad_lib/agentscad_std.scad",
  "scripts/openscad-wasm-sandbox.cjs",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/jobs/*/process": openScadRuntimeFiles,
    "/api/jobs/*/repair": openScadRuntimeFiles,
    "/api/jobs/*/parameters": openScadRuntimeFiles,
    "/api/jobs/*/scad/apply": openScadRuntimeFiles,
    "/api/jobs/*/visual-repair": openScadRuntimeFiles,
  },
  /* config options here */
  reactStrictMode: false,
  allowedDevOrigins: [
    "preview-chat-7f7c9a19-5f5e-4348-bd7b-cf3b8f994d26.space.z.ai",
    ".space.z.ai",
  ],
};

export default nextConfig;
