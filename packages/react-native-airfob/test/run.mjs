#!/usr/bin/env node
/**
 * Zero-dependency test runner.
 *
 * The package source is ESM but the package itself is not type:module (React
 * Native tooling is happier that way), so the sources are copied into a throwaway
 * sandbox that declares type:module, alongside a stub react-native. That keeps
 * the production package.json honest and still lets `npm test` run on a clean
 * checkout with nothing installed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "airfob-test-"));

try {
  fs.writeFileSync(
    path.join(sandbox, "package.json"),
    JSON.stringify({ name: "airfob-test-sandbox", type: "module", private: true })
  );

  fs.cpSync(path.join(pkgRoot, "src"), path.join(sandbox, "src"), { recursive: true });
  fs.cpSync(
    path.join(here, "stubs", "react-native"),
    path.join(sandbox, "node_modules", "react-native"),
    { recursive: true }
  );
  fs.cpSync(path.join(here, "smoke.mjs"), path.join(sandbox, "smoke.mjs"));

  const result = spawnSync(process.execPath, ["smoke.mjs"], {
    cwd: sandbox,
    stdio: "inherit"
  });

  process.exit(result.status ?? 1);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
