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
  /* A running `next dev` and a production build share one `.next` directory, so
     the build's clean step deletes the dev server's output and the two processes
     fight over the same files. Pointing the build at its own directory lets both
     run at once. It must stay git-ignored: Tailwind's source scan reads anything
     in the project root that .gitignore misses, and a build artifact full of
     minified bytes makes it emit invalid CSS and fail the build. */
  distDir: process.env.AGENTSCAD_BUILD_DIR || ".next",
  /* The Next dev badge sits bottom-left and covers the readout plate (measured at
     1440x900: it paints over the "Triangles" row). It is a dev-only chrome overlay,
     not product UI, so it is disabled rather than worked around in layout. */
  devIndicators: false,
  allowedDevOrigins: [
    "preview-chat-7f7c9a19-5f5e-4348-bd7b-cf3b8f994d26.space.z.ai",
    ".space.z.ai",
  ],
};

export default nextConfig;
