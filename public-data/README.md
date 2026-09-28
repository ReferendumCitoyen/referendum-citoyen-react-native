# proposals.json — the list the app shows

Fetched by the app from GitHub Pages and verified against the Ed25519 public
key pinned in `constants/proposal-index-signing.ts`. Unsigned or badly signed
copies are refused; the app then keeps its last good copy, or this file as
bundled. The workflow `.github/workflows/publish-proposal-index.yml` signs it
on push with the `PROPOSAL_INDEX_SIGNING_KEY` repository secret.

Per network:

- `active` — shown to everyone, with a vote button while the chain says open.
  For a question that lives twice on chain (one id per voting contract), list
  the PASSPORT id here and pair it in `twins`.
- `twins` — passport id → ID-card id. The app shows the pair as one entry and
  sends each document to the id its contract can verify.
- `closed` — shown as finished whatever the chain says: final counts, no vote
  button, "Signer la pétition" to `referendums/<id>?src=app`.
- `pages` — proposal id → page slug on the site, for a question whose page
  is not `referendums/<id>`: "En savoir plus" and "Signer la pétition" open
  `referendums/<slug>?src=app` instead. Letters, digits and hyphens only.
- `devOnly` — visible in dev mode only (test scrutins).

`min_supported_app_versions` shows an update banner on older installs.

`updatedAt` must move forward on every edit: the app ships with a copy of
this file and ignores any published or cached list dated before it (so a
new build never regresses to last season's list while Pages catches up).

## Launch, 15 September 2026 — ID card only

1. The main question exists twice on chain (#72 passport contract, #73
   ID-card contract), rules FRA + 18+ + expiry, no max age. The vote is by
   ID card alone: only #73 is listed, nowhere paired, so no passport proof
   is ever sent.
2. `active` = `["73"]`, no `twins`, its site page in `pages`
   (`"73": "plan-marianne"`). The five June scrutins stay in `closed`
   (finished, "Signer la pétition"); every test scrutin sits in `devOnly`.
   Any later change: edit, bump `updatedAt`, push — no release.
3. Commit, push: the workflow signs and publishes. Check the app's log says
   `[proposal-index] signature OK`.
