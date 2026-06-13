# Versioning & the "please update" notice

This app has **two independent version numbers** that must be moved at
**different times**:

1. **The app version** — baked into each build (App Store / Play Store).
2. **`min_supported_app_versions`** — the minimum version the *published
   proposal index* asks users to be on. Drives the dismissible
   "Mise à jour recommandée" banner on the home screen.

> ## ⚠️ The one rule
>
> **Only raise `min_supported_app_versions` *after* the new build is live and
> downloadable on the stores — never in the same step as the version bump.**
>
> The banner tells users *"Installez la version X ou plus récente depuis le
> store"*. If X isn't on the store yet, you've sent everyone to a dead end:
> they can't get the version you're telling them to install. Store review +
> rollout takes hours to days, so the min bump always comes **later** — often
> a separate day, and per-platform (Android can go live before iOS).

---

## 1. Bumping the app version

A version bump is a small, self-contained commit. The `bump 1.2.1`-style
commits touch exactly:

- `app.config.ts` → `version: 'X.Y.Z'`
- `package.json` → `"version": "X.Y.Z"`
- `package-lock.json` → mirrors the `package.json` version (run `npm install`
  to update it, don't hand-edit)

Notes:

- **Android `versionCode` / `versionName`** are *generated* from
  `app.config.ts` at `npx expo prebuild` time (`android/` is gitignored), so
  there's nothing to hand-edit there. `versionName` = `app.config` `version`.
- **`runtimeVersion: { policy: 'appVersion' }`** ties the OTA runtime to the
  app version, so a native bump starts a fresh OTA channel.
- **`constants/otaVersion.ts` → `OTA_PATCH`**: reset to `0` on every native
  version bump; increment by 1 for each OTA-only patch published on top of
  that build (the Settings screen shows `vX.Y.Z.<OTA_PATCH>`).

Then build and submit to the stores as usual (see the release workflows in
`.github/workflows/`).

## 2. Bumping the minimum supported version

`min_supported_app_versions` lives in **`public-data/proposals.json`**:

```jsonc
{
  "version": 1,
  "min_supported_app_versions": {
    "android": "1.2.4",
    "ios": "1.2.4"
  },
  ...
}
```

How it ships and how the app reacts:

- Editing `public-data/proposals.json` and pushing to **`master`** triggers
  `.github/workflows/publish-proposal-index.yml`, which **signs** the JSON
  with the `PROPOSAL_INDEX_SIGNING_KEY` (Ed25519) secret and deploys both
  `proposals.json` and `proposals.json.sig` to GitHub Pages. Live in ~30 s.
- On startup the app fetches both, verifies the signature against the pinned
  public key (`constants/proposal-index-signing.ts`), and compares the
  installed native version against the platform's minimum
  (`utils/update-notice.ts`, `app/(tabs)/index.tsx`). If
  `installed < min`, it shows the dismissible banner.
- The block is **optional and lenient**: omit it, or leave a malformed value,
  and you simply get *no* banner — it never blocks the proposal list.
- The banner is **advisory** ("recommandée") and **dismissible per minimum**:
  dismissing `1.2.4` hides it until the published minimum moves past `1.2.4`.
  It is *not* a hard gate — it never prevents voting.

### Correct sequence

```
Day 0   bump version → 1.2.6, build, submit to Play + App Store
          (min_supported_app_versions stays at its old value, e.g. 1.2.4)
Day 1-3  Play Store build goes live   → set "android": "1.2.6", push
         App Store build goes live    → set "ios": "1.2.6", push
```

Set each platform's minimum **only once that platform's build is actually
downloadable**. The two keys are independent precisely so Android and iOS can
be raised on their own schedules.

Pick the minimum you want to *enforce*, which is not necessarily the latest
release — it's the oldest version you still consider acceptable in the field.

### Don't forget the offline fallback

`utils/proposal-index.ts` carries a `BUNDLED_FALLBACK` used only on a
first-install with no network and no cache. It does **not** carry a
`min_supported_app_versions` block (so a brand-new offline install shows no
banner, which is correct). Keep its `mainnet`/`testnet` lists roughly in sync
with `public-data/proposals.json` when you edit the index, but there's no min
value to maintain there.
