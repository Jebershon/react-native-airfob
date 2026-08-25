# Airfob in Mendix

Everything here is generated from the npm package.

```bash
npx react-native-airfob install-mendix ./MyMendixApp
npx react-native-airfob spec                          # the domain model to build
npx react-native-airfob check-mendix ./MyMendixApp    # CI gate
```

Then follow [STUDIO-PRO.md](STUDIO-PRO.md) — a build sheet with the pages,
nanoflows, and verification checklist.

## The constraint that shapes all of this

**Nanoflows cannot call an import mapping** — *"these activities can only be used
in microflows"* — and they cannot parse JSON either.

So the JavaScript actions do not return JSON for a nanoflow to deserialize.
They build Mendix objects directly with `mx.data.create` and return them, which
means:

- the four entities must exist with **exactly** the attribute names in `spec`
- the module name is **baked into the action source** at install time, because
  `mx.data.create` needs a fully qualified entity name
- never move the installed files by hand — re-run the installer with `--module`

A wrong attribute name fails at runtime inside the action, not at build time.
That is why `spec` exists and why a test asserts every attribute the actions set
appears in it.

## No widget

Tap-and-go is headless — the door opens with the app closed and no JavaScript
running — so there is nothing to render on the hot path. JavaScript actions keep
the UI in Atlas where your Mendix developers can restyle it without touching
React.

## The seven actions

| Action | Parameters | Return type |
|---|---|---|
| `AirfobBoot` | `siteId` String, `logLevel` String | Boolean |
| `AirfobGetStatus` | – | Object → `AirfobStatus` |
| `AirfobGetDiagnostics` | – | List → `AirfobCheck` |
| `AirfobRegister` | `token` String | Object → `AirfobResult` |
| `AirfobUnlock` | `cardId` String | Object → `AirfobResult` |
| `AirfobRemediate` | `actionId` String | Boolean |
| `AirfobExportLog` | `contextJson` String | Object → `AirfobSupportBundle` |

Studio Pro cannot infer return types — set them by hand. Each action's header
comment states which.

`AirfobStatus` and `AirfobResult` carry `ok`, `code`, and `message`. Branch on
`ok` in the nanoflow rather than relying on error handling.

## Domain model

Four non-persistable entities, 31 attributes. `npx react-native-airfob spec`
prints them; `--json` gives a machine-readable form to diff against what you
built.

Non-persistable on purpose: the device is the source of truth, and access data
carries retention obligations you do not want in the database.

`entities/` is the single source of truth — the spec output and the actions are
both derived from it, so they cannot drift apart.

## Two things that will otherwise surprise you

**Make It Native cannot run this.** It is a fixed store binary and can never
contain custom native code. The package falls back to a JS mock rather than
throwing, so pages still render and diagnostics reports `Native SDK linked:
warn`. Build a custom developer app before testing real unlocks.

**Mendix native has no long-press**, so the dev panel cannot use the gesture the
example app uses. Use a tap counter on the version label — see STUDIO-PRO.md
step 8.

## Updating

```bash
npm install react-native-airfob@latest
npx react-native-airfob install-mendix ./MyMendixApp
```

Sidecars are rewritten from the package version, so they cannot drift — Mendix
rejects semver ranges and refuses to package when two components disagree.
Actions carrying the `@airfob-generated` marker are overwritten; anything you
wrote by hand is skipped unless you pass `--force`.

If `spec` changes between versions, the domain model needs the same change.
`check-mendix` catches action and sidecar drift, but it cannot see your entities.
