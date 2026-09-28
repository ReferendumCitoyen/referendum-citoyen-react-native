# Versioning & the "please update" notice

This app has **two independent version numbers** that must be moved at
**different times**:

1. **The app version** — baked into each build (App Store / Play Store).
2. **`min_supported_app_versions`** — the minimum version the *published
   proposal index* requires. Below it the home screen shows a red banner that
   cannot be dismissed and **voting is disabled**. It is published per
   flavour, because the store app and the beta run on two version lines: see
   section 2.

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
- **No over-the-air updates.** Since 2.0.1 the app ships without
  `expo-updates` (see the `updates` note in `app.config.ts`): the JavaScript
  on a phone is always the one built into that binary, so every change —
  a one-line copy fix included — is a new version, a store build and a store
  release. The version shown in-app is exactly `app.config.ts` `version`.

Then build and submit to the stores as usual (see the release workflows in
`.github/workflows/`).

## 2. Bumping the minimum supported version

`min_supported_app_versions` lives in **`public-data/proposals.json`**.

> ## ⚠️ The second rule, since 23/09/2026
>
> **The same code ships as two apps on two version lines: the store app in
> `2.0.x` and the beta in `1.6.x`.** One minimum cannot serve both. Writing
> `"2.0.2"` so store users update takes the vote away from every beta tester
> the same minute, because `1.6.0` is below `2.0.2`.
>
> **So name the flavour. Always name both.**

```jsonc
{
  "version": 1,
  "min_supported_app_versions": {
    "beta":       { "android": "1.6.0", "ios": "1.6.0" },
    "production": { "android": "2.0.2", "ios": "2.0.2" }
  },
  "recommended_app_versions": {
    "beta":       { "android": "1.6.1", "ios": "1.6.1" },
    "production": { "android": "2.0.3", "ios": "2.0.3" }
  },
  ...
}
```

The legacy shape, one value per platform for everybody, is still read and
still behaves exactly as it did:

```jsonc
"min_supported_app_versions": { "android": "1.6.0", "ios": "1.6.0" }
```

Three things to know about how the two shapes combine:

- **As soon as a block names a flavour, the legacy keys of that same block are
  ignored.** Leaving `"android": "2.0.2"` next to a `"beta"` entry cannot leak
  the store threshold onto the beta.
- **A flavour you do not name has no threshold**, so it is never blocked. A
  half-filled table fails towards "nobody is blocked", never towards "the
  wrong people are blocked". That is a safety net, not a way to write the
  file: name both.
- **The schema stays `version: 1`.** An app that predates flavours reads the
  legacy keys, finds nothing in a flavour-only table, and shows no banner.
  Bumping the version would make already-shipped apps reject the whole index,
  which is exactly the population the notice has to reach.

The flavour a binary claims is its bundle id, not a setting: an id ending in
`.beta` is the beta line (`constants/app-flavour.ts`). A tester cannot move
their build from one line to the other.

#### The builds already in the field, which flavours cannot reach

A build that predates this change reads the legacy keys and nothing else. It
cannot tell you which line it is on, so the legacy keys reach **old store
builds and old beta builds at once** and cannot separate them. Which gives one
rule for as long as such builds matter:

> **Keep the legacy keys at a value no build in the field is below**, and
> steer the two lines with the `beta` / `production` entries. Raise the legacy
> keys only once no beta build older than the fix is left in the field, and
> accept that doing so blocks any old beta that is.

In practice: leave `"android"` / `"ios"` where they are (`1.6.0` today, which
blocks nobody), publish the `production` entry at the store version you want
to enforce, and the `beta` entry at the beta version you want to enforce. Store
users on a build that understands flavours are blocked as intended. Store users
on an older build are not, and the only way to reach them is a legacy key that
would also hit the testers. That is the price of the single value this file
used to carry, and it is paid once.

How it ships and how the app reacts:

- Editing `public-data/proposals.json` and pushing to **`master`** triggers
  `.github/workflows/publish-proposal-index.yml`, which **signs** the JSON
  with the `PROPOSAL_INDEX_SIGNING_KEY` (Ed25519) secret and deploys both
  `proposals.json` and `proposals.json.sig` to GitHub Pages. Live in ~30 s.
- On startup the app fetches both, verifies the signature against the pinned
  public key (`constants/proposal-index-signing.ts`), and compares the
  installed native version against the minimum published for **its own
  platform and its own flavour** (`publishedVersionsFor` in
  `utils/update-notice.ts`, `app/(tabs)/index.tsx`).
- The block is **optional and lenient**: omit it, or leave a malformed value,
  and you simply get *no* banner — it never blocks the proposal list.
- **Below `min_supported_app_versions` the banner is red, cannot be dismissed,
  and voting is disabled**: the Vote buttons disappear and results stay
  readable (team decision of 21/09/2026, R10/item 9). This is a hard gate.
  Below `recommended_app_versions`, and above the minimum, the banner is green
  and dismissible per recommended version, and voting is untouched.
- The **unsupported-phone** banner wins over both: telling a phone that can
  never produce a proof to update would prompt it forever.

### Correct sequence

```
Day 0   bump version → 2.0.3, build, submit to Play + App Store
          (min_supported_app_versions stays at its old value, e.g. 2.0.2)
Day 1-3  Play Store build goes live   → production.android = "2.0.3", push
         App Store build goes live    → production.ios     = "2.0.3", push
```

Set each minimum **only once that build is actually downloadable on that
platform**. The keys are independent precisely so Android and iOS, and the
beta and the store app, can be raised on their own schedules.

The beta line moves on its own: `beta.android` / `beta.ios` follow the
TestFlight and internal-track builds, never the store release. Raising
`production` never touches a tester, and raising `beta` never touches a
voter.

Pick the minimum you want to *enforce*, which is not necessarily the latest
release — it's the oldest version you still consider acceptable in the field.

### Don't forget the offline fallback

`utils/proposal-index.ts` carries a `BUNDLED_FALLBACK` used only on a
first-install with no network and no cache. It is **`public-data/proposals.json`
itself**, read at build time, so it carries whatever version block that file
carries at the moment the build is cut. Two consequences worth holding on to:

- a build ships with a threshold it must satisfy itself, or a brand-new
  offline install shows its own red banner and cannot vote. Check that before
  cutting a build: the `production` entry must never be above the version you
  are about to build, and the `beta` entry never above the beta you are about
  to build;
- raising a minimum for the field is a change to the *published* file, and
  the bundled copy of already-shipped builds does not move. That is the point.
