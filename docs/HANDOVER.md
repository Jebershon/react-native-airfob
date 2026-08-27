# Handover

Read this first. [README.md](../README.md) has the detail.

## What this is

Airfob (MOCA System) is BLE mobile access control — you walk up to a door with
your phone in your pocket and it opens. This repo wraps their proprietary SDK in
an npm package so a **Mendix Native** app can use it, without the Mendix
developers touching React or Kotlin.

```
Mendix page → JS action → react-native-airfob → native module → Airfob SDK
                                                                     ↑
                                              MockAirfobSdk ships today
```

The whole thing runs on a mock right now. **No Airfob licence is needed to
develop against it** — that was the point.

## Try it in a minute

```bash
npm ci && npm test
```

60 checks, zero dependencies, no device. Then:

```bash
npx react-native-airfob spec
```

## Done ✅

| | What |
|---|---|
| **npm package** | `react-native-airfob@0.5.0` — Kotlin + Swift native modules, one JS API |
| **Mock SDK** | full behaviour incl. failure modes; 8 forceable scenarios (`btOff`, `expiredCard`, …) |
| **Diagnostics** | every precondition for a tap, each with a fix button or guidance text |
| **Logging** | 500-entry ring, JSONL, survives process death, 7-day retention |
| **Support bundles** | manual export + automatic capture after N failed unlocks |
| **Mendix integration** | 8 JS actions + install CLI + domain-model generator |
| **CI** | 6 jobs — JS on 3 OSes, Kotlin compile, Swift type-check, package guard |

## Left to do

| | Effort | Blocked? |
|---|---|---|
| **P3b** — build the pages/nanoflows in Studio Pro | ~1 day | no — follow [STUDIO-PRO.md](STUDIO-PRO.md) |
| **Example app projects** (`example/ios`, `example/android`) | ~½ day | no |
| **P5** — the real SDK calls | ~1–2 weeks | **yes — needs the licence** |
| Repo → private, branch protection | minutes | no |

The example app work is the highest-value unblocked item: it closes all three
verification gaps at once (see below) and gives you the fast debug loop P5 will
need anyway.

## Needed from the client

P5 cannot start without all five. Ask for them together — asking for "the SDK"
alone guarantees a second round trip.

1. Android **AAR** (2.5.38+) and iOS **`.xcframework`**
2. **The SDK reference / integration guide** — method names aren't public, so the
   binaries are useless without it. Most commonly forgotten.
3. **Site ID + API key** for a dev tenant
4. **A loaner reader.** BLE unlock cannot be tested any other way — not a
   simulator, not a second phone. Usually the longest lead time.
5. Reader models + unlock mode (tap vs auto) — decides RSSI tuning

**The trap:** a client who already runs Airfob does *not* automatically have a
mobile SDK licence. Embedding credentials in *your* app is a separate commercial
agreement. Ask specifically:

> Do you have — or can you obtain from your Airfob dealer — a **mobile SDK
> licence** permitting Airfob credentials to be embedded in a third-party app?

Production Airfob sites can only be created by authorised dealers or Suprema
branch offices, so the route is *through your client's dealer*, not direct.

## When the SDK arrives

Drop the AAR in `android/libs/` or the `.xcframework` in `ios/Frameworks/`. The
build detects it and switches adapters — no source edit, no flag. Then fill in
the `TODO(P5)` methods in `RealAirfobSdk.kt` / `.swift`; they're the only files
allowed to import MOCA symbols. Contract is in
[P5-INTEGRATION.md](P5-INTEGRATION.md).

## Five things that will bite you

1. **Make It Native can't run this.** It's a fixed store binary and can never
   contain custom native code. The package degrades to the mock instead of
   crashing, and diagnostics says so. You need a custom developer app build.
2. **Nanoflows can't call import mappings or parse JSON.** That's why the JS
   actions build Mendix objects with `mx.data.create` — and why the entity
   attribute names must match `spec` exactly. A typo fails at runtime.
3. **Tap-and-go is headless.** The SDK boots from native app-launch code, not
   from JS. If you "fix" that by moving boot into a nanoflow, unlocking silently
   stops working whenever the app is closed — which is most of the time.
4. **Android deep-links to exact settings screens; iOS can't.** iOS has one
   public destination and no per-app battery exemption at all. Always render a
   check's `remedy` text, not just its button.
5. **`noReader` and `denied` are results, not errors.** Throwing for them makes
   every failed tap look like a crash.

## What is *not* verified

Be honest about this when estimating:

| Gap | Closed by |
|---|---|
| Android framework APIs (stubbed in `android/verify/stubs/`) | a real Gradle build |
| React bridge on iOS (shimmed in `ios/verify/shims/`) | a real Xcode build |
| **The Objective-C bridge — compiled by nothing** | example app + `pod install` |

An `RCT_EXTERN_METHOD` signature disagreeing with its Swift `@objc` counterpart
fails at runtime, not build time. All three gaps close with the example app work.

## Repo

- CI runs on every push: `npm test`, Kotlin compile, Swift type-check, pack
- `npm run verify:android` — 30s, no Android SDK needed
- `npm run verify:ios` — macOS only
- Licensed binaries are gitignored **and** CI fails if one is ever tracked
- ⚠️ **The repo is currently public.** Make it private before the binaries land.
