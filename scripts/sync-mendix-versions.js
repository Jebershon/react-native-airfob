#!/usr/bin/env node
/**
 * Keeps the packaged Mendix sidecars pinned to the package version.
 *
 * Mendix rejects semver ranges — "semver is not supported; an exact version must
 * be specified" — and Studio Pro refuses to package an app when two components
 * declare different versions of the same native dependency. With one sidecar per
 * JavaScript action that is a build break waiting to happen, so the version is
 * written from a single source of truth rather than by hand.
 *
 *   npm run sync:sidecars          # rewrite the packaged action sidecars
 *   npm run sync:sidecars:check    # fail if any drifted (CI)
 *
 * This covers the sidecars *inside the package*. To check the copies installed
 * into a Mendix project, use the CLI instead:
 *
 *   npx react-native-airfob check-mendix ./MyMendixApp
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "packages", "react-native-airfob");
const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");
const ACTIONS_DIR = path.join(PACKAGE_DIR, "mendix", "actions");

const checkOnly = process.argv.includes("--check");

function main() {
  const { name, version } = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  console.log(`${name}@${version}`);

  if (!fs.existsSync(ACTIONS_DIR)) {
    console.error(`No actions directory at ${path.relative(ROOT, ACTIONS_DIR)}`);
    process.exit(1);
  }

  const actions = fs
    .readdirSync(ACTIONS_DIR)
    .filter(f => f.endsWith(".js"))
    .sort();

  if (actions.length === 0) {
    console.error("No JavaScript actions found — nothing to pin.");
    process.exit(1);
  }

  const expected = JSON.stringify({ nativeDependencies: { [name]: version } }, null, 4) + "\n";
  const drifted = [];

  for (const action of actions) {
    const file = path.join(ACTIONS_DIR, action.replace(/\.js$/, ".json"));
    const relative = path.relative(ROOT, file);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

    if (current === expected) {
      console.log(`  ok      ${relative}`);
      continue;
    }

    const found = current
      ? JSON.parse(current).nativeDependencies?.[name] ?? "malformed"
      : "missing";
    drifted.push({ relative, found });

    if (checkOnly) {
      console.log(`  DRIFT   ${relative}  ${found} != ${version}`);
      continue;
    }

    fs.writeFileSync(file, expected);
    console.log(`  updated ${relative}  ${found} -> ${version}`);
  }

  if (checkOnly && drifted.length > 0) {
    console.error(`\n${drifted.length} sidecar(s) out of sync. Run: npm run sync:sidecars`);
    process.exit(1);
  }
}

main();
