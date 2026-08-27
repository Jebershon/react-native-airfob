# react-native-airfob

Airfob (MOCA System) mobile access credentials for React Native and Mendix Native.

Wraps the proprietary Airfob mobile SDK behind one JS API, with a working mock so
the whole chain runs before a licence exists.

```js
import Airfob from "react-native-airfob";

await Airfob.boot({ siteId: "…", logLevel: "info" });
await Airfob.register(tokenFromYourBackend);
const { result } = await Airfob.unlock();   // "opened" | "noReader" | "denied"
```

## Install

```bash
npm install react-native-airfob
cd ios && pod install
```

Autolinking picks up both native modules. No change is needed in
`MainApplication`, `AppDelegate`, or a Mendix Native Template — the SDK is started
at process launch from inside this package (`androidx.startup` on Android,
`UIApplicationDidFinishLaunching` on iOS).

## Tap-and-go is headless

The unlock happens with the app closed and the phone in a pocket. No JS runs, no
page is open. That is why boot lives in native launch code rather than in
`boot()`, which is only an idempotent safety net.

`unlock()` is the *manual* fallback — for lifts, gates, and taps that did not
land. It is not the main path.

## API

| | |
|---|---|
| `boot(config)` | idempotent; `{siteId, apiKey, logLevel, rssiThreshold}` |
| `getStatus()` | `{sdkReady, mock, registered, bluetooth, permissions, licence, cardCount}` |
| `register(token)` | token comes from **your** backend — this package never calls it |
| `getCards()` / `unregister(cardId?)` | credential management |
| `unlock(cardId?)` | manual unlock |
| `getDiagnostics()` | every precondition for a tap, each with a fix |
| `remediate(actionId)` | opens the OS settings screen for a failing check |
| `requestPermissions()` | Android runtime permissions |
| `getRawState()` / `resetRssi()` | support tools |
| `log.*` | `get` `setLevel` `setRetentionDays` `clear` `subscribe` `write` `export` |
| `on(handler)` | `status` · `readerDetected` · `unlockResult` · `error` |
| `setScenario(name)` / `listScenarios()` | **mock only** — force a broken state |

## Mendix

The Mendix integration ships inside this package under `mendix/` — eight
JavaScript actions, their native-dependency sidecars, and the entity definitions.

```bash
npx react-native-airfob install-mendix ./MyMendixApp
npx react-native-airfob spec                       # the domain model to build
```

Design notes and the Studio Pro build sheet live in the repository at
`docs/MENDIX.md` and `docs/STUDIO-PRO.md`.

## It degrades instead of throwing

`NativeModules.Airfob` is absent in Mendix's Make It Native app, in Jest, and in
any build made before the SDK was linked. Rather than throwing, the package falls
back to a JS mock and reports `sdkReady: false` with a `native` diagnostic saying
why.

That is deliberate. Make It Native can never contain custom native code, so this
is the normal state for a Mendix developer building pages — throwing there would
just crash their tooling.

Check `Airfob.isMock` to tell the two apart.

## Debugging

| Surface | How |
|---|---|
| Android | `adb logcat -s AIRFOB` |
| iOS | Console.app, subsystem `com.airfob` |
| On device | `log.get()` — 500-entry ring, JSONL, survives process death |
| Support bundle | `log.export()` — log + device + versions |
| Forced failures | `setScenario("btOff")` |

Scenarios: `happy` `btOff` `noPermission` `noCard` `expiredCard` `noReader`
`denied` `licenceExpired`

## Remediation is asymmetric across platforms

Android deep-links to the exact settings screen. iOS has one public destination —
this app's settings page — and no per-app battery exemption at all, so
`openBatterySettings` is rejected there.

Always render a check's `remedy` text alongside its button, not only when the
button is absent: on iOS the button gets the user to the right app, but the words
are what tell them what to change.

`requestBatteryExemption` needs `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, which
this package deliberately does not declare — Google Play restricts it to apps
whose core function requires it. Add it to your app manifest once your
declaration is approved.

## Tests

```bash
npm test
```

Zero dependencies. 60 checks — the mock path sandboxed with a stub
`react-native`, plus the install CLI driven against throwaway Mendix projects.
Runs on a clean checkout with nothing installed.

## Publishing

`private: true` is set on purpose. The Airfob SDK binaries are licensed and must
never reach public npm. Remove it only once `publishConfig.registry` points at
your private registry (Azure Artifacts, GitHub Packages, or Verdaccio).

## Status

The SDK adapter is currently `MockAirfobSdk`. `RealAirfobSdk` is stubbed and
throws `E_NOT_READY` — it is the only file that will import MOCA symbols, and it
lands in P5 once the licence and binaries arrive.
