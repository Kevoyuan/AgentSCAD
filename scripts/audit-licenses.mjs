#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const SCAD_MANIFEST = path.join(ROOT, "skills/scad-library-policy/manifest.json");
const OPENSCAD_INSTALLER = path.join(ROOT, "scripts", "install-openscad-wasm.mjs");
const THIRD_PARTY_NOTICES = path.join(ROOT, "THIRD_PARTY_NOTICES.md");
const OPENSCAD_POLICY = readJson(
  path.join(ROOT, "config", "openscad-wasm-runtime.json")
);
const OPENSCAD_RUNTIME = path.join(
  ROOT,
  ".openscad-runtime",
  OPENSCAD_POLICY.runtime_filename
);
const OPENSCAD_COPYING = path.join(
  ROOT,
  ".openscad-runtime",
  OPENSCAD_POLICY.copying_filename
);

const BLOCKED_LICENSE_RE = /\b(?:AGPL|GPL)(?:[-\s]?\d(?:\.\d)?)?\b|Affero General Public License|GNU General Public License/i;
const WEAK_COPYLEFT_RE = /\bLGPL(?:[-\s]?\d(?:\.\d)?)?\b|Lesser General Public License/i;

const allowedWeakCopyleftPackages = new Set([
  "@img/sharp-libvips-darwin-arm64",
  "@img/sharp-libvips-darwin-x64",
  "@img/sharp-libvips-linux-arm",
  "@img/sharp-libvips-linux-arm64",
  "@img/sharp-libvips-linux-ppc64",
  "@img/sharp-libvips-linux-s390x",
  "@img/sharp-libvips-linux-x64",
  "@img/sharp-libvips-linuxmusl-arm64",
  "@img/sharp-libvips-linuxmusl-x64",
  "@img/sharp-libvips-wasm32",
  "@img/sharp-libvips-win32-arm64",
  "@img/sharp-libvips-win32-ia32",
  "@img/sharp-libvips-win32-x64",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packageLicense(pkg) {
  if (typeof pkg.license === "string") {
    return pkg.license;
  }
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((license) => license.type || license).join(" OR ");
  }
  return "NOASSERTION";
}

function scanNodeModules() {
  if (!fs.existsSync(NODE_MODULES)) {
    return { skipped: true, blocked: [], weakCopyleft: [] };
  }

  const blocked = [];
  const weakCopyleft = [];

  for (const scopeOrPackage of fs.readdirSync(NODE_MODULES, { withFileTypes: true })) {
    if (!scopeOrPackage.isDirectory() || scopeOrPackage.name.startsWith(".")) {
      continue;
    }

    const packageDirs = scopeOrPackage.name.startsWith("@")
      ? fs
          .readdirSync(path.join(NODE_MODULES, scopeOrPackage.name), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(NODE_MODULES, scopeOrPackage.name, entry.name))
      : [path.join(NODE_MODULES, scopeOrPackage.name)];

    for (const packageDir of packageDirs) {
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const pkg = readJson(packageJsonPath);
      const license = packageLicense(pkg);
      const name = pkg.name || path.basename(packageDir);
      const record = {
        name,
        version: pkg.version || "unknown",
        license,
        path: path.relative(ROOT, packageJsonPath),
      };

      if (BLOCKED_LICENSE_RE.test(license) && !WEAK_COPYLEFT_RE.test(license)) {
        blocked.push(record);
      } else if (WEAK_COPYLEFT_RE.test(license)) {
        weakCopyleft.push({
          ...record,
          allowed: allowedWeakCopyleftPackages.has(name),
        });
      }
    }
  }

  return { skipped: false, blocked, weakCopyleft };
}

function scanScadManifest() {
  if (!fs.existsSync(SCAD_MANIFEST)) {
    return { blockedDefaultInstalls: [], weakCopyleftDefaultInstalls: [] };
  }

  const manifest = readJson(SCAD_MANIFEST);
  const libraries = Array.isArray(manifest.libraries) ? manifest.libraries : [];
  const defaultLibraries = libraries.filter((library) => library.default_install === true);

  return {
    blockedDefaultInstalls: defaultLibraries.filter(
      (library) => library.license_gate === "gpl" || BLOCKED_LICENSE_RE.test(library.license || ""),
    ),
    weakCopyleftDefaultInstalls: defaultLibraries.filter(
      (library) => library.license_gate === "weak-copyleft" || WEAK_COPYLEFT_RE.test(library.license || ""),
    ),
  };
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function scanOpenScadRuntimePolicy() {
  const issues = [];
  const packageJson = readJson(path.join(ROOT, "package.json"));
  if (packageJson.dependencies?.["openscad-wasm"]) {
    issues.push(
      "openscad-wasm must not be linked as an npm dependency; use the reviewed child-process runtime"
    );
  }

  const installer = fs.existsSync(OPENSCAD_INSTALLER)
    ? fs.readFileSync(OPENSCAD_INSTALLER, "utf8")
    : "";
  const notices = fs.existsSync(THIRD_PARTY_NOTICES)
    ? fs.readFileSync(THIRD_PARTY_NOTICES, "utf8")
    : "";
  for (const required of [
    OPENSCAD_POLICY.archive_name,
    OPENSCAD_POLICY.runtime_sha256,
    OPENSCAD_POLICY.source_commit,
    OPENSCAD_POLICY.build_system_commit,
  ]) {
    if (!notices.includes(required)) {
      issues.push(`OpenSCAD runtime policy is missing reviewed value: ${required}`);
    }
  }
  if (!installer.includes("config\", \"openscad-wasm-runtime.json")) {
    issues.push("OpenSCAD installer is not reading the reviewed runtime manifest");
  }

  if (fs.existsSync(OPENSCAD_RUNTIME)) {
    if (sha256(OPENSCAD_RUNTIME) !== OPENSCAD_POLICY.runtime_sha256) {
      issues.push("installed OpenSCAD WASM runtime checksum does not match policy");
    }
    if (!fs.existsSync(OPENSCAD_COPYING)) {
      issues.push("installed OpenSCAD WASM runtime is missing its COPYING file");
    } else if (sha256(OPENSCAD_COPYING) !== OPENSCAD_POLICY.copying_sha256) {
      issues.push("installed OpenSCAD WASM COPYING file checksum does not match policy");
    }
  }

  return issues;
}

function printRecords(title, records) {
  if (!records.length) {
    return;
  }
  console.log(`\n${title}`);
  for (const record of records) {
    const status = Object.prototype.hasOwnProperty.call(record, "allowed")
      ? ` (${record.allowed ? "allowed" : "not allowlisted"})`
      : "";
    console.log(`- ${record.name}@${record.version}: ${record.license}${status} [${record.path}]`);
  }
}

function printScadRecords(title, libraries) {
  if (!libraries.length) {
    return;
  }
  console.log(`\n${title}`);
  for (const library of libraries) {
    console.log(`- ${library.name}: ${library.license} (${library.license_gate})`);
  }
}

function main() {
  const npmScan = scanNodeModules();
  const scadScan = scanScadManifest();
  const openScadRuntimeIssues = scanOpenScadRuntimePolicy();
  const unapprovedWeakCopyleft = npmScan.weakCopyleft.filter((record) => !record.allowed);

  if (npmScan.skipped) {
    console.log("node_modules not found; skipped installed npm package license scan.");
  }

  printRecords("Blocked npm package licenses", npmScan.blocked);
  printRecords("Weak copyleft npm package licenses", npmScan.weakCopyleft);
  printScadRecords("Blocked default OpenSCAD libraries", scadScan.blockedDefaultInstalls);
  printScadRecords("Weak copyleft default OpenSCAD libraries", scadScan.weakCopyleftDefaultInstalls);
  if (openScadRuntimeIssues.length) {
    console.log("\nOpenSCAD WASM runtime policy issues");
    for (const issue of openScadRuntimeIssues) console.log(`- ${issue}`);
  } else {
    console.log("\nOpenSCAD WASM runtime boundary reviewed and verified.");
  }

  if (
    npmScan.blocked.length ||
    unapprovedWeakCopyleft.length ||
    scadScan.blockedDefaultInstalls.length ||
    openScadRuntimeIssues.length
  ) {
    console.error("\nLicense audit failed.");
    console.error("GPL/AGPL dependencies must not be part of the default dependency tree or default OpenSCAD install.");
    console.error("New LGPL dependencies require review and allowlisting before distribution.");
    process.exit(1);
  }

  console.log("\nLicense audit passed.");
  if (npmScan.weakCopyleft.length || scadScan.weakCopyleftDefaultInstalls.length) {
    console.log("Weak copyleft items are allowed but require preserved notices and distribution compliance.");
  }
}

main();
