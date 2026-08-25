/**
 * End-to-end test for bin/airfob-mendix.js against a throwaway Mendix project.
 *
 * The CLI writes into someone's real Mendix project, so the behaviour that
 * matters most is what it refuses to do: never clobber a hand-authored action,
 * never accept a directory that is not a Mendix project, never silently leave a
 * sidecar pinned to the wrong version.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const CLI = path.join(pkgRoot, "bin", "airfob-mendix.js");
const PKG = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));

let pass = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
};

const run = (...args) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

/** A Mendix project is recognised by its .mpr file. */
function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airfob-mx-"));
  fs.writeFileSync(path.join(dir, "MyApp.mpr"), "");
  return dir;
}

const actionsIn = project =>
  path.join(project, "javascriptsource", "Airfob", "actions");

console.log("airfob-mendix CLI\n");

const sourceActions = fs
  .readdirSync(path.join(pkgRoot, "mendix", "actions"))
  .filter(f => f.endsWith(".js"));

/* ------------------------------------------------------------------ guards */

check("rejects a directory that is not a Mendix project", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "airfob-plain-"));
  const r = run("install-mendix", plain);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not look like a Mendix project/);
  fs.rmSync(plain, { recursive: true, force: true });
});

check("rejects a missing path", () => {
  const r = run("install-mendix", path.join(os.tmpdir(), "definitely-not-here-9f2a"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such directory/);
});

check("requires a path", () => {
  const r = run("install-mendix");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /path is required/);
});

check("unknown command exits non-zero", () => {
  const r = run("frobnicate");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
});

/* ----------------------------------------------------------------- install */

const project = makeProject();

check("installs every action with a sidecar", () => {
  const r = run("install-mendix", project);
  assert.equal(r.status, 0, r.stderr);

  const dir = actionsIn(project);
  for (const file of sourceActions) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} missing`);
    const sidecar = path.join(dir, file.replace(/\.js$/, ".json"));
    assert.ok(fs.existsSync(sidecar), `sidecar for ${file} missing`);
  }
});

check("every sidecar pins the exact package version", () => {
  const dir = actionsIn(project);
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    assert.equal(parsed.nativeDependencies[PKG.name], PKG.version, `${file} drifted`);
    // Mendix rejects ranges outright — a stray caret is a build break.
    assert.ok(!/[\^~><*]/.test(parsed.nativeDependencies[PKG.name]), `${file} is not an exact version`);
  }
});

check("copies the import-mapping samples", () => {
  const dir = path.join(project, "airfob-mappings");
  assert.ok(fs.existsSync(dir));
  assert.ok(fs.readdirSync(dir).length >= 5);
});

check("mapping samples contain no nulls", () => {
  // Studio Pro infers attribute types from the sample; null infers nothing and
  // the generated entity silently loses the attribute.
  const dir = path.join(project, "airfob-mappings");
  for (const file of fs.readdirSync(dir)) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(!/:\s*null/.test(raw), `${file} contains a null`);
  }
});

check("check-mendix passes on a fresh install", () => {
  const r = run("check-mendix", project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok/);
});

check("install is idempotent — second run changes nothing", () => {
  const r = run("install-mendix", project);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 written/);
});

/* ------------------------------------------------------------------- drift */

check("check-mendix fails on a drifted sidecar", () => {
  const sidecar = path.join(actionsIn(project), "AirfobBoot.json");
  fs.writeFileSync(sidecar, JSON.stringify({ nativeDependencies: { [PKG.name]: "0.0.1" } }, null, 4) + "\n");

  const r = run("check-mendix", project);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pins 0\.0\.1/);
});

check("install repairs the drift", () => {
  assert.equal(run("install-mendix", project).status, 0);
  assert.equal(run("check-mendix", project).status, 0);
});

check("check-mendix fails when an action was edited", () => {
  const file = path.join(actionsIn(project), "AirfobUnlock.js");
  fs.appendFileSync(file, "\n// local tweak\n");
  const r = run("check-mendix", project);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /differs from the packaged source/);
  assert.equal(run("install-mendix", project).status, 0);
});

/* ------------------------------------------------------- hand-authored file */

check("never clobbers an action it did not generate", () => {
  const file = path.join(actionsIn(project), "AirfobBoot.js");
  const handWritten = "// written by a person, no marker\nexport async function AirfobBoot() {}\n";
  fs.writeFileSync(file, handWritten);

  const r = run("install-mendix", project);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skip/);
  assert.equal(fs.readFileSync(file, "utf8"), handWritten, "the hand-written file was overwritten");
});

check("--force overwrites a hand-authored action", () => {
  const file = path.join(actionsIn(project), "AirfobBoot.js");
  const r = run("install-mendix", project, "--force");
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(file, "utf8"), /@airfob-generated/);
});

/* ------------------------------------------------------------ custom module */

check("--module installs into a different Mendix module", () => {
  const other = makeProject();
  assert.equal(run("install-mendix", other, "--module", "AccessControl").status, 0);
  assert.ok(fs.existsSync(path.join(other, "javascriptsource", "AccessControl", "actions", "AirfobBoot.js")));
  assert.equal(run("check-mendix", other, "--module", "AccessControl").status, 0);
  fs.rmSync(other, { recursive: true, force: true });
});

check("check-mendix fails when nothing is installed", () => {
  const empty = makeProject();
  const r = run("check-mendix", empty);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not installed/);
  fs.rmSync(empty, { recursive: true, force: true });
});

/* -------------------------------------------------------------- action body */

check("every packaged action imports the package and is marked generated", () => {
  for (const file of sourceActions) {
    const body = fs.readFileSync(path.join(pkgRoot, "mendix", "actions", file), "utf8");
    assert.match(body, /import Airfob from "react-native-airfob";/, `${file} does not import the package`);
    assert.match(body, /@airfob-generated/, `${file} has no generated marker`);
    // Studio Pro only preserves what sits between these markers.
    assert.match(body, /BEGIN USER CODE[\s\S]*END USER CODE/, `${file} lacks USER CODE markers`);
    assert.ok(!body.includes("NativeModules"), `${file} reaches past the package API`);
  }
});

fs.rmSync(project, { recursive: true, force: true });

console.log(`\n${pass} checks passed`);
