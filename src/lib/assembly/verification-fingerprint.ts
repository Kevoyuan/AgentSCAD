import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ASSEMBLY_VERIFIER_SOURCES } from "./verification-types";
import { usesOpenScadWasm } from "../tools/openscad-backend";
import policy from "../../../config/openscad-wasm-runtime.json";

const execute=promisify(execFile);
/** Listed application sources and observed engine version, not a hermetic toolchain certificate. */
export async function assemblyVerifierIdentity() {
  const backend=usesOpenScadWasm()?"wasm":"native";
  const scope="Fingerprint covers listed checker sources, backend policy, observed engine version and library-path configuration; external library contents and the full transitive runtime are not frozen.";
  try {
    const inputs=await Promise.all(ASSEMBLY_VERIFIER_SOURCES.map(async file=>[file,createHash("sha256").update(await fs.readFile(path.join(process.cwd(),file))).digest("hex")]));
    const version=backend==="wasm"?`pinned-wasm:${policy.runtime_sha256}`:await execute(process.env.OPENSCAD_BIN||"openscad",["--version"],{timeout:5000}).then(result=>(result.stdout+result.stderr).trim().slice(0,500));
    if(!version)throw new Error("Engine version unavailable");
    const fingerprint=createHash("sha256").update(JSON.stringify({inputs,backend,version,libraryPaths:[process.env.AGENTSCAD_OPENSCAD_LIBRARY_DIR,process.env.CADCAD_OPENSCAD_LIBRARY_DIR,process.env.OPENSCAD_LIBRARY_PATHS,process.env.OPENSCADPATH]})).digest("hex");
    return {fingerprint,backend,engineVersion:version,scope};
  } catch {
    return {fingerprint:null,backend,engineVersion:null,scope};
  }
}
