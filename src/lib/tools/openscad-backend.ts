import { isEphemeralRuntime } from "@/lib/runtime-environment";

export function usesOpenScadWasm(): boolean {
  if (process.env.AGENTSCAD_OPENSCAD_BACKEND === "native") return false;
  return (
    process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ||
    isEphemeralRuntime()
  );
}
