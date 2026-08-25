# airfob-mobile

Airfob (MOCA System) mobile access credentials for Mendix Native, packaged so
more than one project can use them.

**Status: P2 complete** (`react-native-airfob@0.2.0`). The whole chain runs on a
mock SDK — no Airfob licence, no binaries, no dealer relationship. When the real
SDK arrives, one class is swapped and nothing above it changes.

```
example app / Mendix JS action
        ↓
react-native-airfob  (src/index.js)        ← the only API consumers see
        ↓
NativeModules.Airfob
        ↓
AirfobModule.kt / AirfobModule.swift       ← RN plumbing, no SDK calls
        ↓
AirfobCore → AirfobSdk                     ← the seam
        ├── MockAirfobSdk    ships today
        └── RealAirfobSdk    P5, the only file that imports MOCA symbols
```

## What is here

| Path | What it is |
|---|---|
| `packages/react-native-airfob/` | the npm package — native modules, JS API, mock, log |
| `example/` | bare React Native app for fast debugging |
| `scripts/sync-mendix-versions.js` | keeps Mendix sidecar versions pinned |
| `mendix-module/` | *(P3)* JS actions, entities, import mappings |

## Getting the example app running

`example/` holds the app source. The native shells are generated rather than
committed, so pick one:

```bash
npx react-native@0.73.0 init AirfobExample --directory example --skip-install
```

Then restore `App.js`, `index.js`, `app.json` and `package.json` from this repo
(the generator overwrites them), install, and run:

```bash
npm install
npm --workspace airfob-example run android
```

The app boots against the mock immediately: register a credential, unlock, force
broken states from the scenario buttons, and watch the log fill up.

> **Why the example app matters.** The Studio Pro → Native Builder → device loop
> is 15–20 minutes. This one is a Metro reload. Reproduce every native bug here
> before opening Mendix.

## Tests

```bash
npm test
```

Zero dependencies — it copies the sources into a throwaway sandbox with a stub
`react-native` and runs against the mock path. 26 checks covering the fallback
behaviour, the error codes, event emission, the bounded ring buffer, scenario
forcing, bundle export, and the remediation contract — including the rule that a
failing check must offer either an action or a remedy, never a dead end. Runs on
a clean checkout with nothing installed.

## Using it

```js
import Airfob from "react-native-airfob";

await Airfob.boot({ siteId: "…", logLevel: "info" });

const { cards } = await Airfob.register(tokenFromYourBackend);
const { result } = await Airfob.unlock();          // "opened" | "noReader" | "denied"

const { checks, summary } = await Airfob.getDiagnostics();
await Airfob.remediate(checks[0].action);        // opens the OS settings screen
const bundle = await Airfob.log.export({ user: userId });

const off = Airfob.on(event => { /* status, readerDetected, unlockResult */ });
```

The package **never talks to your backend**. Hand it a token you already have, so
token issuance stays a Mendix concern and the package stays reusable.

## Debugging

| Surface | How |
|---|---|
| Android logcat | `adb logcat -s AIRFOB` |
| iOS Console.app | filter subsystem `com.airfob` |
| On-device log | `Airfob.log.get()` — ring buffer, 500 entries, survives restart |
| Support bundle | `Airfob.log.export()` — log + device + versions, JSON |
| Forced failures | `Airfob.setScenario("btOff")` — mock only |
| Live tail | `Airfob.log.subscribe(entry => …)` |
| Raw internal state | `Airfob.getRawState()` |
| Stale reader baseline | `Airfob.resetRssi()` |
| Dev panel | long-press the version line in the example app |

Scenarios: `happy` · `btOff` · `noPermission` · `noCard` · `expiredCard` ·
`noReader` · `denied` · `licenceExpired`

The log is JSONL, capped at 1 MB with one rotation, written to app storage. It
survives process death on purpose — the tap that failed happened hours before
the user opened the app to complain.

## Remediation

Every diagnostic that fails carries a way out — either an `action` you pass to
`Airfob.remediate()`, or a `remedy` string to show the user. A failing check with
neither is treated as a bug and the test suite enforces it.

```js
const { checks } = await Airfob.getDiagnostics();

for (const check of checks) {
  if (check.state === "pass") continue;
  if (check.action) {
    // render a button labelled check.actionLabel
    await Airfob.remediate(check.action);
  }
  // always render check.remedy if present — see below
}
```

**The platforms are not symmetrical, and it matters.**

| | Android | iOS |
|---|---|---|
| Bluetooth settings | exact screen | no deep link — Control Centre guidance |
| App permissions | exact screen | app settings page |
| Location services | exact screen | app settings page |
| Notifications | exact screen | app settings page |
| Battery optimisation | exact screen | **no equivalent exists** — rejected |

iOS offers exactly one public destination, `UIApplication.openSettingsURLString`.
The `App-Prefs:root=Bluetooth` URLs that circulate are private API: they work in
development and get the app rejected at review, so they are not used here.

The practical rule: **iOS diagnostics must say more because they can do less.**
Always render `remedy` alongside the button, not only when the button is absent.

One Android caveat. `requestBatteryExemption` opens the one-tap exemption prompt,
which needs `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the manifest. This package
deliberately does **not** declare it — Google Play restricts that permission to
apps whose core function requires it, and shipping it without an approved
declaration risks the listing. Access control plausibly qualifies; if your
declaration is approved, add the permission to your app manifest and the action
starts working. Until then `openBatterySettings` opens the list, which is safe.

## Tap-and-go and why boot lives in native code

The unlock is **headless**. The user walks up with the phone in a pocket and the
door opens; no page is open, and often no JS is running at all.

So the SDK is started from native app-launch code, not from JS:

- **Android** — `AirfobInitializer` via `androidx.startup`, registered in this
  package's own manifest
- **iOS** — `AirfobBootstrap` observing `UIApplicationDidFinishLaunching`

Neither needs a change in the host app or the Mendix Native Template. Both are
guarded: an unenrolled device starts nothing, so there is no battery cost and no
notification until a credential exists.

`Airfob.boot()` remains callable from JS as a safety net, and is idempotent.

## Behaviour without the native module

`NativeModules.Airfob` is absent in the Make It Native app, in Jest, and in any
build made before the SDK was linked. The package **degrades instead of
throwing**: it switches to the JS mock and reports `sdkReady: false` with a
`native` diagnostic explaining why.

This is deliberate. Mendix's own native-module guidance throws in that case,
which crashes Make It Native — and Make It Native can never contain custom
native code, so that is the normal state for a Mendix developer building pages.

## Roadmap

| Phase | Adds | Blocked on |
|---|---|---|
| **P1** ✅ | package, example app, mock, ring buffer, diagnostics | — |
| **P2** ✅ | remediation actions, diagnostics screen, dev panel, raw state | — |
| P3 | Mendix module: 5 JS actions, sidecars, entities, mappings | — |
| P4 | support-bundle upload, backend entity, admin view | — |
| P5 | `RealAirfobSdk` (Android, then iOS) | **SDK licence** |
| P6 | telemetry: success rate, time-to-unlock, per-device model | P5 |

P1–P4 need nothing from MOCA.

## Before P5

The Airfob SDK is proprietary. `developers.airfob.com/sdk` is a download and
changelog page; the API reference ships inside the gated archive. Access needs
developer-portal approval, and production sites are created only by authorised
dealers or Suprema branch offices.

To unblock P5 you need: the licence and binaries, the SDK reference, a tenant
with a site ID and API key, and **a physical reader on a desk** — BLE unlock
cannot be tested any other way.

What the public changelog already tells us to expect:

- Android is at **2.5.38** (Oct 2025), target SDK 35+
- scanning runs behind a **foreground service** — a persistent notification is
  unavailable to avoid
- there is an **RSSI reset API**, so tap range needs per-reader tuning
- the **licence expires at runtime**; surface it through `status()` rather than
  letting unlock fail opaquely

## Two decisions still open

1. **Private registry** — Azure Artifacts, GitHub Packages, or Verdaccio? The
   licensed binaries cannot go on public npm. `publishConfig.registry` in the
   package is a placeholder until this is settled.
2. **Log retention** — how long on device, how long server-side? Access logs are
   personal data; GDPR applies. Pick a number before P4 ships.
