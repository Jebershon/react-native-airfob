# P3b — building it in Studio Pro

Everything below has to be done in Studio Pro. `.mpr` and `.mpk` are binary
artifacts with no public authoring format, and the Mendix Platform SDK only
works against an app on Team Server — it cannot touch a local project. So this
is a build sheet, not a script: follow it top to bottom and there is nothing to
design.

Budget roughly a day.

## Before you start

**Build a custom developer app.** Make It Native is a fixed binary from the app
stores and can never contain custom native code. The package detects the missing
native module and falls back to its JS mock rather than crashing, so pages render
and the diagnostics screen reports `Native SDK linked: warn` — but no real unlock
will happen until you have your own build.

**Verify one thing first**, because it decides where the actions live: create a
throwaway web page that calls nothing, run a web build, and confirm Mendix's web
bundler does not try to resolve `react-native-airfob` for actions no web page
references. If it does, the Airfob actions need their own module excluded from
web. Thirty minutes now, or a confusing bundler error later.

## 1. Install the actions

```bash
npx react-native-airfob install-mendix ./MyMendixApp
```

Refresh Studio Pro (F4). You get seven actions under `Airfob/actions` and the
entity reference files under `airfob-entities/`.

Use `--module <Name>` to install elsewhere. The module name is **baked into the
action source** at install time, because `mx.data.create` needs a fully qualified
entity name — so never move the files by hand afterwards; re-run the installer.

## 2. Domain model — four non-persistable entities

```bash
npx react-native-airfob spec
```

That prints all four entities and their 31 attributes. Create them in the module
exactly as listed.

> There is no import mapping here, and that is deliberate. Nanoflows cannot call
> one — *"these activities can only be used in microflows"* — and cannot parse
> JSON either. So the actions build the objects themselves with `mx.data.create`,
> which means the attribute names must match exactly. A typo fails at runtime
> inside the action, not at build time.

Make every entity **non-persistable**. The device is the source of truth, and
access data carries retention obligations you do not want in your database.

Run `npx react-native-airfob spec --json` if you want to diff it against what you
built.

## 3. Set the return types

Studio Pro cannot infer these. Open each action and set them:

| Action | Parameters | Return type |
|---|---|---|
| `AirfobBoot` | `siteId` String, `logLevel` String | Boolean |
| `AirfobGetStatus` | – | Object → `AirfobStatus` |
| `AirfobGetDiagnostics` | – | List → `AirfobCheck` |
| `AirfobRegister` | `token` String | Object → `AirfobResult` |
| `AirfobUnlock` | `cardId` String | Object → `AirfobResult` |
| `AirfobRemediate` | `actionId` String | Boolean |
| `AirfobExportLog` | `contextJson` String | Object → `AirfobSupportBundle` |

Each action's header comment repeats this, so you can work file by file.

## 4. Boot the SDK

Nanoflow **`ACT_Airfob_Boot`**, called from the home page's **on-load** event.

```
1. AirfobBoot("<your site id>", "info")   ->  $Booted
2. (no error handling needed — it returns false and logs)
```

Not After Startup: that runs a *microflow*, server-side, which cannot reach a
JavaScript action. It does not matter — the SDK already starts in native code at
process launch, which is what makes tap-and-go work with the app closed. This
call is only a safety net, and it is idempotent.

## 5. Page — Activate access

Data source: nanoflow **`ACT_Airfob_GetStatus`**

```
1. AirfobGetStatus()  ->  $AirfobStatus
2. return $AirfobStatus
```

Layout:

```
Container
├── Text  "Ready to tap"          visible: $AirfobStatus/summary = 'pass'
├── Text  "{1} issues"            visible: $AirfobStatus/problemCount > 0
│                                 parameter: $AirfobStatus/problemCount
├── Text  "Hold your phone near a reader. You do not need to open this app."
│                                 visible: $AirfobStatus/registered
└── Button "Activate access"      visible: not $AirfobStatus/registered
                                  on click: ACT_Airfob_Activate
```

Nanoflow **`ACT_Airfob_Activate`**:

```
1. IVK_Airfob_IssueToken            microflow — YOUR backend calls the Airfob
                                    API server-to-server and returns a token
2. AirfobRegister($Token)      ->   $Result
3. Decision  $Result/ok
   true  -> Show message  "Access activated"
   false -> Show message  $Result/message
4. Refresh the page
```

**The Airfob API key stays on the server.** Never issue a token from the app — a
mobile binary is not a secret store.

## 6. Page — Access status

Data source: nanoflow **`ACT_Airfob_GetDiagnostics`**

```
1. AirfobGetDiagnostics()  ->  $Checks   (List of AirfobCheck)
2. return $Checks
```

Layout:

```
List view over $Checks
└── Container
    ├── Text  $AirfobCheck/label
    │         conditional formatting on $AirfobCheck/state
    │           pass -> green   warn -> amber   fail -> red
    ├── Text  $AirfobCheck/detail
    ├── Text  $AirfobCheck/remedy
    │         visible: $AirfobCheck/remedy != ''
    └── Button
          caption: $AirfobCheck/actionLabel
          visible: $AirfobCheck/action != ''
          on click: ACT_Airfob_Remediate
```

Nanoflow **`ACT_Airfob_Remediate`** (parameter: `AirfobCheck`):

```
1. AirfobRemediate($AirfobCheck/action)  ->  $Opened
2. Decision  $Opened
   false -> Show message  $AirfobCheck/remedy
3. Refresh the page
```

**Render `remedy` as well as the button, not only when the button is absent.**
On Android the button lands on the exact settings screen. On iOS it can only
reach this app's settings page — and for battery it does nothing at all, because
iOS has no per-app exemption. The words carry the instruction there.

## 7. Manual unlock (optional)

Nanoflow **`ACT_Airfob_Unlock`**:

```
1. AirfobUnlock('')  ->  $Result
2. Decision  $Result/ok
   true  -> Show message  "Door opened"
   false -> Show message  $Result/message
```

This is a fallback for lifts, gates, and taps that did not land. Tap-and-go never
goes through it — the SDK opens the door on proximity with the app closed.

## 8. Dev panel

Mendix native has no long-press, so the gesture the example app uses is not
available. Use a tap counter instead:

```
Page variable  $TapCount  (Integer, 0)

Text  "v{1}"  parameter: $AirfobStatus/version
      on click: ACT_Airfob_CountTap

ACT_Airfob_CountTap
  1. Change variable  $TapCount = $TapCount + 1
  2. Decision  $TapCount >= 7  ->  Change variable $ShowDevPanel = true

Container  visible: $ShowDevPanel
  └── Button "Send support bundle"  ->  ACT_Airfob_ExportLog
```

Nanoflow **`ACT_Airfob_ExportLog`**:

```
1. AirfobExportLog('{"user":"' + $currentUser/Name + '"}')  ->  $Bundle
2. Decision  $Bundle/ok
   true  -> store $Bundle/bundle on your support entity, or attach to a
            FileDocument
   false -> Show message  $Bundle/message
```

Ships in production, invisible until someone who knows about it needs it on a
customer site.

## 9. Support bundles (P4)

Two ways a bundle reaches you. Both hand back an `AirfobSupportBundle`.

**Manual** — `AirfobExportLog`, wired to the dev panel in step 8.

**Automatic** — the package captures a bundle after a run of failed unlocks, so
the evidence exists *before* the user gives up and calls the helpdesk. Off by
default; turn it on with `AirfobBoot`'s `autoBundleAfterFailures` parameter.

```
ACT_Airfob_Boot
  1. AirfobBoot("<site id>", "info", $currentUser/AirfobCorrelationId, 7, 3)
```

The five parameters are `siteId`, `logLevel`, `correlationId`, `retentionDays`,
`autoBundleAfterFailures`.

Poll for a captured bundle on page show:

```
ACT_Airfob_CollectBundle
  1. AirfobTakePendingBundle()  ->  $Bundle
  2. Decision  $Bundle/pending
     false -> end          (the normal case — nothing was waiting)
     true  -> create AirfobTicket, copy $Bundle/bundle into it, commit
```

`pending` exists because Mendix cannot return a null object. Always check it
first.

### Correlation IDs — do this now, not later

Token issuance happens in your Mendix backend. The unlock happens on the device.
**Without a shared id there is no way to join the two halves**, and it cannot be
retrofitted — old logs simply do not have it.

Generate one when `IVK_Airfob_IssueToken` runs, store it on the user, and pass it
to `AirfobBoot`. Every subsequent log entry carries it as `cid`, and it appears
on the bundle.

### Retention is a decision, not a default

Access logs record where a named person was and when. That is personal data under
GDPR, and it now has a number attached in two places:

| | Where | Default |
|---|---|---|
| On device | `AirfobBoot`'s `retentionDays` | **7 days** |
| On your backend | your `AirfobTicket` entity | **you must choose** |

Seven days is long enough to investigate a Monday complaint about a Friday
failure, and short enough that the handset is not a standing archive of somebody's
movements. Passing `0` keeps everything — only do that where you have a lawful
basis.

Add a scheduled event that deletes `AirfobTicket` records past your backend
window. A bundle that is never deleted is a retention breach with extra steps.

### Admin view

A simple data grid over `AirfobTicket` is enough:

| Column | From |
|---|---|
| When | `generatedAt` |
| User | your association |
| Correlation | `correlationId` |
| Trigger | `manual` or `repeatedUnlockFailure` |
| Failures | `failureStreak` |
| Entries | `entryCount` — and `droppedOlderEntries` if non-zero |

`droppedOlderEntries` matters: a non-zero value means the bundle was truncated
and the earliest evidence is not in it.

## 10. Export

Right-click the module → **Export module package** → `Airfob.mpk`.

Exclude `airfob-entities/` — it is reference material, not part of the module.

## Verification checklist

- [ ] `npx react-native-airfob check-mendix ./MyMendixApp` exits 0
- [ ] All four entities non-persistable, 31 attributes total
- [ ] Every action's return type set per the table in step 3
- [ ] Diagnostics page renders on a custom developer app and shows
      `Native SDK linked: warn` (expected until P5)
- [ ] Turning Bluetooth off makes that check go red **and** offers a button
- [ ] Tapping the button opens Bluetooth settings on Android
- [ ] On iOS the button opens app settings and `remedy` text is visible
- [ ] Activate access completes and `registered` flips to true
- [ ] Support bundle export returns `ok` with a non-zero `entryCount`

## What is still mocked

`RealAirfobSdk` is a stub until P5. Everything above works against
`MockAirfobSdk`, which means enrolment, diagnostics, remediation, and support
bundles are all genuinely testable now — but no physical door will open until the
MOCA licence, the binaries, and a reader on a desk are in place.
