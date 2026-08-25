#!/usr/bin/env node
/**
 * Keeps every Mendix native-dependency sidecar pinned to the package version.
 *
 * Mendix rejects semver ranges — "Note that semver is not supported; an exact
 * version must be specified" — and Studio Pro refuses to package the app when two
 * components declare different versions of the same dependency. With one sidecar
 * per JavaScript action that is a build break waiting to happen, so the version
 * gets written from a single source of truth instead of by hand.
 *
 *   node scripts/sync-mendix-versions.js           # rewrite sidecars
 *   node scripts/sync-mendix-versions.js --check   # fail if any drifted (CI)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON = path.join(ROOT, "packages", "react-native-airfob", "package.json");
const SIDECAR_ROOTS = [path.join(ROOT, "mendix-module")];

const checkOnly = process.argv.includes("--check");

/** @returns {string[]} every .json next to a .js action file */
function findSidecars(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findSidecars(full);
    if (!entry.name.endsWith(".json")) return [];

    // Only touch files that actually declare native dependencies. A stray
    // package.json or import mapping must be left alone.
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      return parsed && parsed.nativeDependencies ? [full] : [];
    } catch (e) {
      console.warn(`  skipped (not valid JSON): ${path.relative(ROOT, full)}`);
      return [];
    }
  });
}

function main() {
  const { name, version } = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  console.log(`${name}@${version}`);

  const sidecars = SIDECAR_ROOTS.flatMap(findSidecars);

  if (sidecars.length === 0) {
    console.log("No native-dependency sidecars found yet — nothing to sync.");
    console.log("(Expected: they arrive with the Mendix module in P3.)");
    return;
  }

  const drifted = [];

  for (const file of sidecars) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const current = parsed.nativeDependencies[name];
    const relative = path.relative(ROOT, file);

    if (current === version) {
      console.log(`  ok      ${relative}`);
      continue;
    }

    drifted.push({ relative, current });

    if (checkOnly) {
      console.log(`  DRIFT   ${relative}  ${current} != ${version}`);
      continue;
    }

    parsed.nativeDependencies[name] = version;
    fs.writeFileSync(file, JSON.stringify(parsed, null, 4) + "\n");
    console.log(`  updated ${relative}  ${current} -> ${version}`);
  }

  if (checkOnly && drifted.length > 0) {
    console.error(
      `\n${drifted.length} sidecar(s) out of sync. Run: npm run sync-versions`
    );
    process.exit(1);
  }
}

main();
