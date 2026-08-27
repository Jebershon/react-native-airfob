# Build reference

A record of how this package was built: what was decided, what was verified
against primary sources, and what turned out to be wrong along the way.

Kept because the *why* behind several decisions is not visible in the code, and
at least three of them look like mistakes until you know the constraint that
forced them.

---

## 1. What was being solved

Embed Airfob (MOCA System) BLE mobile access into a Mendix Native app, so a
phone in a pocket opens a door.

Three integration modes existed. We chose the third and kept the first as a
fallback:

| Mode | What | Chosen |
|---|---|---|
| Deep link to Airfob Pass app | hand off to their app | fallback only |
| REST API only | backend issues credentials | **yes** — needed by any mode |
| **Mobile SDK embedded** | our app *is* the credential | **yes** — the actual ask |

---

## 2. Verified against primary sources

Things checked rather than assumed. Each changed a decision.

**Airfob is proprietary, and the API reference is not public.**
`developers.airfob.com/sdk` is a download-and-changelog page. Developer-portal
access requires an approval step, and production sites *"can only be created by
authorized dealers or Suprema branch offices."* This is why `RealAirfobSdk` is a
stub rather than an implementation — the method names are not guessable.

**MOCA System owns Airfob; Suprema resells it.** MOCA spun off from Suprema in
2019. Relevant because it determines who to contact for a licence.

**From the public changelog** (Android 2.5.38, Oct 2025):
- scanning runs behind a **foreground service** → a persistent notification is unavoidable
- there is an **RSSI reset API** (2.3.15) → tap range needs per-reader tuning
- the **licence expires at runtime** (2.3.25) → must surface through `status()`
- native iOS and Android only → **no React Native wrapper exists**, we write it

**Mendix declares native dependencies via a sidecar JSON** next to each action:
*"semver is not supported; an exact version must be specified."* Studio Pro
refuses to package when two components disagree — so drift is a build break.

**Nanoflows cannot call import mappings.** *"These activities can only be used in
microflows."* They cannot parse JSON either. This invalidated an entire design —
see §4.

**JavaScript actions can return Object and List types.** *"For all types which
you can use for parameters, you can also use a return type."* This is what made
the corrected design possible.

**The Mendix Platform SDK is online-only.** `createTemporaryWorkingCopy` /
`commitToRepository` against Team Server, requiring a personal access token. It
cannot touch a local `.mpr`, so it does not enable offline `.mpk` authoring.

---

## 3. Decisions that look odd without the reason

**Tap-and-go is headless, so the SDK boots from native launch code.**
`androidx.startup` on Android, `UIApplicationDidFinishLaunching` on iOS — not
from JavaScript. If boot moves into a nanoflow, unlocking silently stops working
whenever the app is closed, which is almost always. `Airfob.boot()` remains
callable as an idempotent safety net.

**A missing native module degrades to the mock instead of throwing.** Mendix's
own guidance throws — which crashes Make It Native, and Make It Native can
*never* contain custom native code. Throwing there breaks the tooling every
Mendix developer uses daily. The package reports `sdkReady: false` and a `native`
diagnostic instead.

**No pluggable widget.** The unlock is headless, so nothing renders on the hot
path. JavaScript actions keep the UI in Atlas where Mendix developers can restyle
it without touching React.

**The package never talks to your backend.** It takes a token you already have.
Token issuance stays a Mendix concern, which is what keeps the package reusable
across projects — and keeps the Airfob API key off the device.

**Entities are non-persistable.** The device is the source of truth, and access
logs carry retention obligations you do not want in a database.

**`noReader` and `denied` are results, not errors.** Throwing for them makes
every failed tap look like a crash.

**Log retention defaults to 7 days.** A privacy decision, not a technical one:
access logs record where a named person was and when. Long enough to investigate
a Monday complaint about a Friday failure; short enough that the handset is not a
standing archive of someone's movements.

**`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is deliberately not declared.** Google
Play restricts it to apps whose core function requires it, and shipping it
without an approved declaration risks the listing. `openBatterySettings` opens
the list instead, which is unrestricted.

**Android and iOS remediation are asymmetric.** Android deep-links to the exact
settings screen; iOS has one public destination and no per-app battery exemption
at all. The `App-Prefs:root=…` URLs that circulate are private API — they work in
development and get the app rejected at review. So iOS `remedy` strings are
deliberately wordier: **iOS diagnostics must say more because they can do less.**

---

## 4. Corrections made during the build

Recorded so nobody reverts to the earlier version.

**The Mendix design was wrong and was rebuilt.** P3a shipped actions returning
JSON strings for a nanoflow to deserialize with an import mapping. Nanoflows can
do neither. P3b replaced it: actions now build Mendix objects with
`mx.data.create` and return `Object`/`List`. Consequences — the domain model
dropped from 7 entities to 4, and the module name is baked into the action source
at install time, because `mx.data.create` needs a fully qualified entity name.

**Two Kotlin bugs, found on first compile.** `AirfobCore.boot` used an expression
body that inferred `Result<Unit>`, so its early `return` had nothing valid to
return. `putDouble(value.toDouble())` was missing its key argument. Both would
have hard-failed the first Gradle run. Neither was visible by reading.

**Unlock failures were double-counted.** A JS unlock produces both a rejected
promise *and* a native `unlockResult` event for the same attempt, so the failure
streak advanced twice and auto-capture fired at half the configured threshold.
Events are now ignored briefly after `unlock()` is called; tap-and-go events,
which have no JS on the stack, always count.

**`boot()` silently discarded config when already booted.** Settings now apply on
every call; only the SDK start is idempotent. `configure()` added.

**`.gitignore` patterns matched nothing.** `android/verify/.verify-cache/` is
anchored to the file's own directory, but the package lives under `packages/`.
Left as written, the first `git add -A` would have committed **651 MB**. Caught
by `git check-ignore -v` before the initial commit.

**Line endings would have broken CI.** Every file was flagged for CRLF
conversion; `compile-check.sh` with CRLF fails on a Linux runner with
`\r: command not found`. `.gitattributes` added.

---

## 5. Verification, and its limits

| Check | Verifies | Does **not** verify |
|---|---|---|
| `npm test` (60) | JS API, error codes, ring buffer, CLI, spec | anything native |
| `verify:android` | Kotlin + **real** react-android classes | Android framework APIs (**stubbed**) |
| `verify:ios` | Swift + **real** iOS SDK | React bridge (**shimmed**) |
| CI `package` | tarball, licensed-binary guard | — |

The two native checks are deliberately inverted — Android stubs the platform and
uses the real bridge; iOS uses the real platform and stubs the bridge. Neither is
sufficient alone.

**Nothing compiles the Objective-C bridge.** An `RCT_EXTERN_METHOD` signature
disagreeing with its Swift `@objc` counterpart fails at runtime, not build time.
All three gaps close with the same work: generating the example app projects.

---

## 6. Still open

| | Blocked on |
|---|---|
| P3b — pages and nanoflows in Studio Pro | nothing, ~1 day |
| Example app projects | nothing, ~½ day |
| P5 — the real SDK calls | **licence, binaries, SDK reference, and a physical reader** |
| Private npm registry choice | a decision |
| Repo → private, branch protection | a decision |

See [HANDOVER.md](HANDOVER.md) for what to ask the client for, and
[P5-INTEGRATION.md](P5-INTEGRATION.md) for the fill-in-the-blanks guide.
