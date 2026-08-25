# P5 — wiring in the real Airfob SDK

Everything in this repository works today against `MockAirfobSdk`. P5 replaces
that with MOCA System's real SDK. **It is the only phase blocked on something
outside the codebase.**

## What has to arrive first

None of this can be downloaded. Airfob is proprietary: `developers.airfob.com/sdk`
is a download-and-changelog page, and the API reference ships inside the gated
archive. Developer-portal access requires an approval step, and production sites
*"can only be created by authorized dealers or Suprema branch offices."*

| | Why it blocks |
|---|---|
| Licensed Android AAR (2.5.38+) | nothing to compile against |
| Licensed iOS `.xcframework` | same |
| **The SDK reference** | method names are not public — they are not guessable, and guessing produces code that looks right and does not compile |
| Site id + API key | the SDK will not initialise |
| **A physical reader on a desk** | BLE unlock cannot be tested any other way. Not a simulator, not a mock, not a second phone |

Contact an authorised Airfob dealer or a Suprema branch office. Ask for
commercial terms *and* lead time on a dev site plus a loaner reader — the second
one is usually the longer pole and gets forgotten.

## The switch is automatic

There is no source edit and no build flag to remember.

**Android** — drop the AAR in `packages/react-native-airfob/android/libs/`.
`build.gradle` detects it, adds the `src/withSdk` source set (which holds
`RealAirfobSdk` and is the only code allowed to import MOCA classes), and puts
the AAR on the compile path. `AirfobCore` resolves `RealAirfobSdkFactory` by
name and falls back to the mock when it is absent.

**iOS** — drop the `.xcframework` in `packages/react-native-airfob/ios/Frameworks/`.
The podspec detects it, vendors it, and sets `SWIFT_ACTIVE_COMPILATION_CONDITIONS
= AIRFOB_SDK`, which compiles in `RealAirfobSdk.swift`.

Both log which adapter is live, and `getRawState()` reports `mock: true|false`.
The diagnostics screen shows it as **Native SDK linked**, so a build that
silently fell back to the mock is visible rather than mysterious.

```bash
npm run verify:android   # includes withSdk once the AAR is present
npm run verify:ios       # macOS only
```

## Do not commit the binaries

`.gitignore` blocks `**/libs/*.aar`, `**/Frameworks/*.framework` and
`**/*.xcframework`, and the CI `package` job **fails the build** if one is ever
tracked. That guard exists because the repository is currently public and a
`git add -f` would otherwise distribute a licensed binary.

Make the repository private before the binaries arrive. The guard is a backstop,
not a substitute.

## The contract

Everything above the adapter already depends on these behaviours, and the JS
suite asserts them against the mock. The two `RealAirfobSdk` files repeat this
in place — implement to it exactly, or the Mendix pages will misreport.

| method | must |
|---|---|
| `boot` | be cheap, and **not throw** on an unenrolled device |
| `status` | report licence `expired` rather than letting unlock fail opaquely |
| `register` | throw `E_NOT_READY` if boot has not run |
| `unlock` | throw `E_NO_CARD` when no credential is present |
| `unlock` | return `opened` / `noReader` / `denied` — those are results, not errors |
| `resetRssi` | clear cached per-reader baselines |

Emit events as they happen rather than batching, and log through `AirfobLog` so
entries land in the same support bundle as everything else.

## What the public changelog already tells you

Verified from `developers.airfob.com/sdk` — useful before the reference arrives:

- **Scanning runs behind a foreground service** on Android. A persistent
  notification is unavoidable; design the copy for it rather than fighting it.
- **There is an RSSI reset API** (2.3.15). Tap range needs per-reader tuning and
  this is the first thing support will reach for when one door goes bad.
- **The licence expires at runtime** (2.3.25). Surface it through `status()`.
- Android is at **2.5.38** (Oct 2025), target SDK 35+.
- Hardware in scope: Airfob Patch, Airfob Edge Reader, Suprema BioStation 3,
  MOCA Key Tag.

## Order of work

1. **Android first.** The compile loop is faster and the platform is more
   forgiving. Use `example/` — the Studio Pro → Native Builder → device loop is
   15–20 minutes; a Metro reload is seconds.
2. **Tune RSSI against the real reader.** Expect this to take longer than the
   integration itself.
3. **iOS second**, once the Android behaviour is settled and you know what
   correct looks like.
4. **Test revocation explicitly.** Offboarding is the path that gets skipped and
   matters most — a credential that survives revocation is a security incident,
   not a bug.
5. **Then a real Gradle build and a real Xcode build.** The verify scripts stub
   the Android framework and the React bridge respectively; neither compiles the
   Objective-C bridge at all. An `RCT_EXTERN_METHOD` signature disagreeing with
   its Swift `@objc` counterpart fails at runtime, not build.

## Definition of done

- [ ] A physical door opens with the app closed and the phone in a pocket
- [ ] It still opens after a device reboot, with no app launch in between
- [ ] Revoking the credential server-side stops it opening, on the next attempt
- [ ] An expired licence shows as a failed check, not an opaque unlock failure
- [ ] Diagnostics reports **Native SDK linked: pass** on both platforms
- [ ] A support bundle from a real failure contains the reader id and RSSI
