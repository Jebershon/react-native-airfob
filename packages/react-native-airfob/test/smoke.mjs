import assert from "node:assert/strict";

import Airfob from "./src/index.js";

let pass = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
};

console.log("react-native-airfob smoke test (mock path)\n");

await check("falls back to the mock when no native module", () => {
  assert.equal(Airfob.isMock, true);
});

await check("register before boot is rejected with E_NOT_READY", async () => {
  await assert.rejects(() => Airfob.register("tok"), e => e.code === "E_NOT_READY");
});

await check("boot resolves and is idempotent", async () => {
  const a = await Airfob.boot({ siteId: "smoke", logLevel: "debug" });
  const b = await Airfob.boot({ siteId: "ignored" });
  assert.equal(a.sdkReady, true);
  assert.equal(a.mock, true);
  assert.equal(b.sdkReady, true);
});

await check("status reports unregistered before enrolment", async () => {
  const s = await Airfob.getStatus();
  assert.equal(s.registered, false);
  assert.equal(s.cardCount, 0);
});

await check("unlock without a credential fails E_NO_CARD", async () => {
  await assert.rejects(() => Airfob.unlock(), e => e.code === "E_NO_CARD");
});

await check("register produces a card", async () => {
  const { cards } = await Airfob.register("demo-token-123456");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status, "active");
});

await check("unlock opens and emits unlockResult", async () => {
  const events = [];
  const off = Airfob.on(e => events.push(e));
  const { result } = await Airfob.unlock();
  assert.equal(result, "opened");
  await new Promise(r => setTimeout(r, 400));
  off();
  assert.ok(events.some(e => e.name === "unlockResult" && e.result === "opened"),
    `expected unlockResult, got ${JSON.stringify(events)}`);
});

await check("diagnostics returns checks with known states", async () => {
  const d = await Airfob.getDiagnostics();
  assert.ok(d.checks.length >= 5);
  const states = new Set(d.checks.map(c => c.state));
  states.forEach(s => assert.ok(["pass", "fail", "warn", "unknown"].includes(s), `bad state ${s}`));
  assert.ok(d.checks.some(c => c.id === "native" && c.state === "warn"));
});

await check("scenario btOff makes unlock fail E_BT_OFF", async () => {
  await Airfob.setScenario("btOff");
  await assert.rejects(() => Airfob.unlock(), e => e.code === "E_BT_OFF");
  const d = await Airfob.getDiagnostics();
  assert.equal(d.checks.find(c => c.id === "bluetooth").state, "fail");
  assert.equal(d.summary, "fail");
});

await check("scenario licenceExpired fails E_LICENCE", async () => {
  await Airfob.setScenario("licenceExpired");
  await assert.rejects(() => Airfob.unlock(), e => e.code === "E_LICENCE");
});

await check("unknown scenario is rejected", async () => {
  await assert.rejects(() => Airfob.setScenario("nope"), e => e.code === "E_SDK");
});

await check("log captured entries and filters by level", async () => {
  await Airfob.setScenario("happy");
  const all = await Airfob.log.get();
  assert.ok(all.length > 0, "log is empty");
  const errorsOnly = await Airfob.log.get({ level: "error" });
  assert.ok(errorsOnly.every(e => e.lvl === "error"));
  assert.ok(errorsOnly.length < all.length);
});

await check("log ring is bounded at 500", async () => {
  for (let i = 0; i < 600; i += 1) {
    Airfob.log.write("info", "sdk", "FILL", `entry ${i}`);
  }
  const entries = await Airfob.log.get();
  assert.equal(entries.length, 500);
  assert.equal(entries[entries.length - 1].msg, "entry 599");
});

await check("export produces a bundle with context", async () => {
  const bundle = await Airfob.log.export({ user: "smoke-user" });
  assert.equal(bundle.path, null);              // no native module to write a file
  assert.equal(bundle.content.user, "smoke-user");
  assert.equal(bundle.content.mock, true);
  assert.equal(bundle.content.package, "react-native-airfob");
  assert.ok(bundle.content.entryCount > 0);
});

await check("setLevel rejects an unknown level", () => {
  assert.throws(() => Airfob.log.setLevel("loud"), /Unknown log level/);
});

await check("log level off suppresses writes", async () => {
  await Airfob.log.clear();
  Airfob.log.setLevel("off");
  Airfob.log.write("error", "sdk", "X", "should not appear");
  assert.equal((await Airfob.log.get()).length, 0);
  Airfob.log.setLevel("info");
});

await check("unregister clears credentials", async () => {
  await Airfob.register("tok-again");
  const { cards } = await Airfob.unregister();
  assert.equal(cards.length, 0);
  assert.equal((await Airfob.getStatus()).registered, false);
});

/* ------------------------------------------------------------------- P2 --- */

await check("every check carries the remediation fields", async () => {
  const d = await Airfob.getDiagnostics();
  for (const c of d.checks) {
    assert.ok("action" in c, `${c.id} is missing action`);
    assert.ok("actionLabel" in c, `${c.id} is missing actionLabel`);
    assert.ok("remedy" in c, `${c.id} is missing remedy`);
    // A failing check must offer either a button or words. Never a dead end.
    if (c.state === "fail") {
      assert.ok(c.action || c.remedy, `${c.id} fails with no action and no remedy`);
    }
    // A button without a label is unrenderable.
    if (c.action) assert.ok(c.actionLabel, `${c.id} has an action but no actionLabel`);
  }
});

await check("a failing bluetooth check offers the bluetooth action", async () => {
  await Airfob.setScenario("btOff");
  const d = await Airfob.getDiagnostics();
  const bt = d.checks.find(c => c.id === "bluetooth");
  assert.equal(bt.state, "fail");
  assert.equal(bt.action, Airfob.REMEDIATION.BLUETOOTH);
  assert.ok(bt.actionLabel);
  await Airfob.setScenario("happy");
});

await check("a licence failure gives a remedy but no user action", async () => {
  await Airfob.setScenario("licenceExpired");
  const d = await Airfob.getDiagnostics();
  const licence = d.checks.find(c => c.id === "licence");
  assert.equal(licence.state, "fail");
  assert.equal(licence.action, null, "the user cannot fix an expired licence from settings");
  assert.ok(/administrator/i.test(licence.remedy));
  await Airfob.setScenario("happy");
});

await check("remediate accepts a known action and reports mock", async () => {
  const result = await Airfob.remediate(Airfob.REMEDIATION.BLUETOOTH);
  assert.equal(result.opened, false);
  assert.equal(result.mock, true);
});

await check("remediate rejects an unknown action", async () => {
  await assert.rejects(() => Airfob.remediate("openTheFridge"), e => e.code === "E_SDK");
});

await check("getRawState reports the fields a support bundle needs", async () => {
  const raw = await Airfob.getRawState();
  for (const key of ["platform", "mock", "sdkReady", "bluetooth", "permissions", "logLevel"]) {
    assert.ok(key in raw, `rawState is missing ${key}`);
  }
  assert.equal(raw.mock, true);
});

await check("resetRssi succeeds and is logged", async () => {
  await Airfob.log.clear();
  const result = await Airfob.resetRssi();
  assert.equal(result.reset, true);
  const entries = await Airfob.log.get();
  assert.ok(entries.some(e => e.code === "RSSI_RESET"));
});

await check("REMEDIATION ids are exported and unique", () => {
  const ids = Object.values(Airfob.REMEDIATION);
  assert.ok(ids.length >= 6);
  assert.equal(new Set(ids).size, ids.length);
});

await check("version reports 0.5.0", () => {
  assert.equal(Airfob.version, "0.5.0");
});

/* ------------------------------------------------------------------- P4 --- */

await check("correlation id is stamped onto entries", async () => {
  await Airfob.log.clear();
  Airfob.setCorrelationId("enrol-7f3a");
  Airfob.log.write("info", "sdk", "X", "with cid");
  const entries = await Airfob.log.get();
  assert.equal(entries.at(-1).cid, "enrol-7f3a");
});

await check("clearing the correlation id stops stamping", async () => {
  Airfob.setCorrelationId(null);
  Airfob.log.write("info", "sdk", "X", "no cid");
  const entries = await Airfob.log.get();
  assert.ok(!("cid" in entries.at(-1)));
});

await check("retention drops entries past the window", async () => {
  await Airfob.log.clear();
  Airfob.log.setRetentionDays(50 / 86400000); // 50ms
  Airfob.log.write("info", "sdk", "OLD", "should age out");
  assert.equal((await Airfob.log.get()).length, 1);

  await new Promise(r => setTimeout(r, 120));
  assert.equal((await Airfob.log.get()).length, 0, "entry outlived its retention window");
  Airfob.log.setRetentionDays(7);
});

await check("retention of 0 keeps everything", async () => {
  await Airfob.log.clear();
  Airfob.log.setRetentionDays(0);
  Airfob.log.write("info", "sdk", "KEEP", "forever");
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await Airfob.log.get()).length, 1);
  Airfob.log.setRetentionDays(7);
});

await check("retention rejects a negative window", () => {
  assert.throws(() => Airfob.log.setRetentionDays(-1), /non-negative/);
  assert.equal(Airfob.log.getRetentionDays(), 7);
});

await check("bundle carries the privacy and truncation metadata", async () => {
  Airfob.setCorrelationId("enrol-7f3a");
  const bundle = await Airfob.log.export();
  assert.equal(bundle.content.correlationId, "enrol-7f3a");
  assert.equal(bundle.content.retentionDays, 7);
  // Silent truncation would read as "this is everything".
  assert.equal(typeof bundle.content.droppedOlderEntries, "number");
  Airfob.setCorrelationId(null);
});

/**
 * The streak is process-wide and earlier tests leave failures on it, so each of
 * these starts by unlocking successfully to establish a zero baseline. That is
 * also the only reset the API offers, by design — a working door is what proves
 * the problem is over.
 */
async function resetStreak() {
  await Airfob.setScenario("happy");
  await Airfob.register("tok-baseline");
  await Airfob.unlock();
  assert.equal(Airfob.getFailureStreak(), 0, "baseline was not clean");
}

await check("failure streak counts up and resets on success", async () => {
  await resetStreak();

  await Airfob.setScenario("noReader");
  await assert.rejects(() => Airfob.unlock());
  await assert.rejects(() => Airfob.unlock());
  // Exactly 2, not 4: a JS unlock emits an event AND rejects for the same
  // attempt, and only one of those may count.
  assert.equal(Airfob.getFailureStreak(), 2);

  await Airfob.setScenario("happy");
  await Airfob.unlock();
  assert.equal(Airfob.getFailureStreak(), 0);
});

await check("auto-capture is off by default", async () => {
  Airfob.configure({ autoBundleAfterFailures: 0 });
  Airfob.takePendingBundle();
  await resetStreak();

  await Airfob.setScenario("noReader");
  for (let i = 0; i < 3; i += 1) await assert.rejects(() => Airfob.unlock());
  assert.equal(Airfob.hasPendingBundle(), false);
});

await check("configure applies settings without re-booting", () => {
  const applied = Airfob.configure({ autoBundleAfterFailures: 2, retentionDays: 3 });
  assert.equal(applied.autoBundleAfterFailures, 2);
  assert.equal(applied.retentionDays, 3);
  Airfob.log.setRetentionDays(7);
});

await check("auto-capture fires after the configured run of failures", async () => {
  const events = [];
  const off = Airfob.on(e => events.push(e));

  Airfob.takePendingBundle();       // clear anything left over
  await resetStreak();
  Airfob.configure({ autoBundleAfterFailures: 2 });

  await Airfob.setScenario("noReader");
  await assert.rejects(() => Airfob.unlock());
  assert.equal(Airfob.hasPendingBundle(), false, "captured too early");

  await assert.rejects(() => Airfob.unlock());
  await new Promise(r => setTimeout(r, 50));

  assert.equal(Airfob.hasPendingBundle(), true, "no bundle after the threshold");
  assert.ok(events.some(e => e.name === Airfob.EVENTS.SUPPORT_BUNDLE), "no supportBundleReady event");

  off();
  await Airfob.setScenario("happy");
});

await check("takePendingBundle returns it once, then null", async () => {
  const first = Airfob.takePendingBundle();
  assert.ok(first, "expected a pending bundle");
  assert.equal(first.content.trigger, "repeatedUnlockFailure");
  assert.ok(first.content.failureStreak >= 2);
  assert.equal(Airfob.takePendingBundle(), null);
  assert.equal(Airfob.hasPendingBundle(), false);
});

console.log(`\n${pass} checks passed`);
