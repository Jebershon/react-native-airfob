# Airfob in Mendix

Everything here is generated from the npm package. Install it, then do four
things in Studio Pro.

```bash
npx react-native-airfob install-mendix ./MyMendixApp
```

That writes seven JavaScript actions plus their native-dependency sidecars into
`javascriptsource/Airfob/actions/`, and drops the import-mapping samples into
`airfob-mappings/`.

```bash
npx react-native-airfob check-mendix ./MyMendixApp     # CI gate
```

Fails the build if a sidecar drifted or an action was edited by hand. Worth
wiring into CI: Mendix rejects semver ranges and refuses to package an app when
two components pin different versions, so drift is a build break, not a warning.

## No widget

There is deliberately no pluggable widget. Tap-and-go is headless — the door
opens with the app closed and no JavaScript running — so there is nothing to
render on the hot path. JavaScript actions keep the UI in Atlas where your
Mendix developers can restyle it without touching React.

## The seven actions

| Action | Parameters | Returns |
|---|---|---|
| `AirfobBoot` | `siteId` String, `logLevel` String | Boolean |
| `AirfobGetStatus` | – | String (JSON) |
| `AirfobGetDiagnostics` | – | String (JSON) |
| `AirfobRegister` | `token` String | String (JSON) |
| `AirfobUnlock` | `cardId` String | String (JSON) |
| `AirfobRemediate` | `actionId` String | Boolean |
| `AirfobExportLog` | `contextJson` String | String (JSON) |

Every JSON return carries `ok`, plus `code` and `message` when `ok` is false.
Branch on `ok` in the nanoflow rather than relying on error handling.

## 1. Generate the entities — do not build them by hand

Studio Pro's Import Mapping wizard builds the domain model from a sample
message. For each file in `airfob-mappings/`:

> right-click the module → **Add other → Import Mapping** → *Use a JSON
> structure* → paste the file contents

| Sample | Produces |
|---|---|
| `status.json` | `AirfobStatus` |
| `diagnostics.json` | `AirfobDiagnostics` + `AirfobCheck` (1-*) |
| `cards.json` | `AirfobCard` |
| `unlock.json` | `AirfobUnlockResult` |
| `export.json` | `AirfobSupportBundle` |

Make them **non-persistable**. None of this belongs in the database — the device
is the source of truth, and access data has retention obligations.

Each sample carries both the success fields and the `{ok, code, message}`
envelope, so one entity covers both outcomes. Every field is populated on
purpose: Studio Pro cannot infer a type from `null`, and a null in the sample
silently drops the attribute.

## 2. Boot the SDK

Call `AirfobBoot` from the **home page on-load nanoflow**.

Not from After Startup — that runs a *microflow*, server-side, which cannot reach
a JavaScript action. It does not matter anyway: the SDK already starts in native
code at process launch, which is what makes tap-and-go work with the app closed.
This call is a safety net, and it is idempotent.

## 3. Activate access

One page, one button, visible only when `AirfobStatus/registered` is false.

```
nanoflow ACT_Airfob_Activate
  1. IVK_Airfob_IssueToken          microflow — your backend calls the Airfob
                                    API server-to-server and returns a token
  2. AirfobRegister($token)         JavaScript action
  3. Import Mapping -> AirfobCard
  4. if $Result/ok  ->  show success
     else           ->  show $Result/message
```

The Airfob API key stays on the server. Never issue a token from the app.

## 4. Access status

A list view over `AirfobCheck` from `AirfobGetDiagnostics`.

- **Conditional formatting** on `state`: `pass` green, `warn` amber, `fail` red
- **Button** captioned from `actionLabel`, visible when `action` is not empty,
  calling `AirfobRemediate($AirfobCheck/action)`
- **Text** bound to `remedy`, visible when not empty

Render `remedy` **as well as** the button, not only when the button is absent.
On Android the button lands on the exact settings screen; on iOS it can only
reach this app's settings page, so the words carry the instruction.

Refresh on show, and after any `AirfobRemediate` returns.

## Two things that will otherwise surprise you

**Make It Native cannot run this.** It is a fixed binary from the app stores and
can never contain custom native code. The package detects the missing native
module and falls back to a JS mock rather than throwing, so your pages still
render and the diagnostics screen reports `Native SDK linked: warn`. Build a
custom developer app before testing real unlocks.

**Mendix native has no long-press**, so the dev panel cannot use the gesture the
example app uses. Use a tap counter on the version label — a page variable
incremented by an on-click nanoflow, revealing the panel at seven.

## Updating

```bash
npm install react-native-airfob@latest
npx react-native-airfob install-mendix ./MyMendixApp
```

Sidecars are rewritten from the package version, so they cannot drift. Actions
carrying the `@airfob-generated` marker are overwritten; anything you wrote by
hand is skipped unless you pass `--force`.
