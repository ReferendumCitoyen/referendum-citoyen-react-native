# Diagnostic logging & error reporting — Design

**Status:** approved
**Date:** 2026-05-23
**Author:** brainstorming session (Claude + alexis)

## Goal

When the app hits an *unexpected* error (i.e. not one of the predictable cases like passport expired, already voted, proposal closed, NFC chip not detected, user cancellation, network offline), surface a "Envoyer un rapport d'erreur" button. Tapping it opens the user's mail client with a prefilled message to an email and an attached `.txt` file containing the last 5 minutes of redacted in-memory logs plus the error context.

The user must not have to enable anything. No PII may leak into the report. Nothing is written to disk during normal operation.

## Non-goals

- No always-on file logging.
- No Settings toggle, no Share/Clear UI surface.
- No persisted logs across launches.
- No automatic / silent submission.
- No crash reporter integration (Sentry etc).
- No remote upload endpoint.
- No retroactive reports for errors that happened before this launch (in-memory buffer only).

## Architecture overview

Two modules + one context. No new screen.

- **`utils/logger.ts`** — always-on, in-memory only. Console (`log/info/warn/error/debug`) intercepted at app boot. Each entry redacted at insert time and stamped with `Date.now()`. Entries older than 5 minutes are dropped on each insert (cheap head-check), plus a 30 s safety sweep. No file I/O during normal operation. Hard cap of 2000 entries as a memory backstop even within the window.
- **`utils/error-reporter.ts`** — `prepareErrorReport(error, context)` snapshots the current buffer + error metadata, writes to `${FileSystem.cacheDirectory}error-report-<ISO>.txt`, returns the URI. `sendErrorReport(uri)` opens a prefilled email with attachment.
- **`contexts/ErrorReportContext.tsx`** — exposes `{ reportError(err, context), pendingReport, clearReport, send }`. UI components call `reportError` from catch blocks. `reportError` runs `console.error(err)` internally first (so the error itself is captured in the redacted buffer even if the caller did not log it), then snapshots the buffer + error metadata into `pendingReport`. The snapshot is taken at error time so the buffer captured is the one at the moment of failure, not at the moment the user taps the button (which may be seconds or minutes later).

A React `ErrorBoundary` at the root of `app/_layout.tsx` catches uncaught render-tree errors and routes them through `ErrorReportContext`.

## Error classification

`utils/error-reporter.ts` exports `isExpectedError(err): boolean`. The voting-flow Step 9 error UI and `useErrorReporter()` callers use it to decide whether to render the report button. Predictable errors render the existing French message and **no** button; unknown errors render message + button.

Initial denylist (extensible):

| Source | Matches considered "expected" |
|---|---|
| NFC / e-document | The strings already present in the French translation table at `modules/e-document/index.ts` (passport expired, wrong CAN/MRZ, BAC failure, chip not detected, user cancelled) |
| Vote contract revert | `already voted`, `proposal closed`, `proposal not active`, `nullifier already used` |
| Network | `Network request failed`, `offline`, `navigator.onLine === false` at throw time |
| User cancellation | Strings containing `cancelled` / `aborted` / RN `AbortError` |

The classification is intentionally conservative: better to show the button on a known error (extra noise to devs) than to hide it on an unknown one (silent failure).

## Time-windowed buffer

In `utils/logger.ts`:

```
RETENTION_MS = 5 * 60 * 1000   // 5 minutes
MAX_ENTRIES  = 2000            // memory backstop
SWEEP_MS     = 30 * 1000       // periodic GC
```

Entry shape: `{ t: number, level: 'log' | 'info' | 'warn' | 'error' | 'debug', msg: string }`.

Eviction on push: drop head while `now - head.t > RETENTION_MS` OR `length > MAX_ENTRIES`. A `setInterval(SWEEP_MS)` runs the same eviction so an idle app does not retain stale entries.

When `prepareErrorReport()` is called, the buffer is **frozen-copied** (`Array.from(buffer)`) before the file is written so subsequent logs do not mutate the snapshot.

## Redaction (at insert)

Applied at insert, not at send — the in-memory buffer itself never holds PII. Implemented as `redact(line: string): string` in `utils/logger.ts`.

| Pattern | Replacement | Catches |
|---|---|---|
| `\b[a-fA-F0-9]{64}\b` | `<hex64>` | BJJ private key, SHA-256, tx hash |
| `\b0x[a-fA-F0-9]{40}\b` | `<addr>` | Wallet / contract address |
| `\b0x[a-fA-F0-9]{64}\b` | `<hex64>` | Tx hash, signature half |
| `^[A-Z0-9<]{30,44}$` whole-line | `<mrz>` | Standalone MRZ row |
| `(?:passport(?:Number)?\|document(?:Number)?\|surname\|givenNames\|firstName\|lastName\|dateOfBirth\|dateOfExpiry\|nationality\|personalNumber)["']?\s*[:=]\s*["']?[^,}"'\s]+` | `<key>:<redacted>` | Labelled PII in JSON-ish dumps |
| `\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b` | `<email>` | Email addresses |
| `\b\d{8,}\b` | `<digits>` | 8+ consecutive digits — phone numbers, raw IDs, timestamps |

The 8+ digit rule is broad. It will redact some innocent numbers (e.g. epoch-millis timestamps when logged bare). Acceptable trade-off — we are deliberately conservative. Stack traces are kept as-is (Hermes frames reference the JS bundle, not user paths).

This is a best-effort filter, not a security guarantee. Documented as such in the module comment.

## Console interception

`utils/logger.ts` runs an `install()` at module-init. Imported as the **first line** of `app/_layout.tsx` so existing `[FreedomTool]`, `[preload]`, `[withRetry]` prefixes are captured. `install()` is idempotent (guarded by a module-level flag) to survive Fast Refresh.

Per-entry formatting:
- `Date(t).toISOString() + ' ' + level.toUpperCase().padEnd(5) + ' ' + msg`
- Multi-arg `console.log(a, b, c)` → arguments joined with spaces.
- Object args → `JSON.stringify` with a circular-safe replacer, capped at 3 levels deep.
- The original `console.*` runs as well, so Metro/Flipper output is unchanged in dev.

## Report file

Path: `${FileSystem.cacheDirectory}error-report-<ISO8601>.txt`. Cache directory (not document directory) — the file's only purpose is the in-flight share, and the OS is free to clean it up afterwards. `prepareErrorReport()` deletes any previous `error-report-*.txt` files in cache dir before writing, so cache does not accumulate.

Format:

```
=== Rapport d'erreur ===
App     : 1.4.2 (build 87)
Platform: android 15
Device  : Fairphone 6 (FP6)
ABI     : arm64-v8a
Locale  : fr-FR
Network : testnet
Time    : 2026-05-23T14:23:11.402Z

--- Error ---
<error.name>: <error.message>
<error.stack — first 30 frames>

--- Context ---
step: 11
proposalId: <id>
documentType: TD3
<...caller-supplied context, redacted...>

--- Logs (last 5 minutes, 247 entries) ---
2026-05-23T14:18:12.103Z LOG   [preload] starting fetch
2026-05-23T14:18:13.880Z WARN  [withRetry] attempt 1 failed: ...
...
```

Device / platform fields are read via `expo-application` (version, build, applicationId — already a dep) and `Platform.OS` / `Platform.Version` / `Platform.constants`. We do not add a new device-info dep; if more detail is needed later, the existing `expo-device` ecosystem can be evaluated. The `Network` field reads from existing `NetworkContext`.

## Email delivery

New deps:

- `expo-mail-composer` — primary path
- `expo-sharing` — fallback when no mail client
- `expo-file-system` — write the .txt

Flow:

```ts
const available = await MailComposer.isAvailableAsync();
if (available) {
  await MailComposer.composeAsync({
    recipients: [ERROR_REPORT_EMAIL],
    subject: "Rapport d'erreur",
    body: t('errorReport.body', { version, build }),
    attachments: [uri],
  });
} else {
  await Sharing.shareAsync(uri, {
    mimeType: 'text/plain',
    dialogTitle: t('errorReport.shareDialogTitle'),
  });
}
```

`ERROR_REPORT_EMAIL = 'alexis+referendum@roussel-zeter.eu'` lives in `constants/urls.ts` next to the other contact addresses so it is grep-friendly.

French body template (i18n'd via `errorReport.body`, localised when locale ≠ fr):

```
Bonjour,

L'application a rencontré une erreur inattendue. Le fichier joint contient
des informations de diagnostic anonymisées qui aideront à corriger le
problème.

Aucune donnée personnelle (numéro de passeport, nom, clé privée, etc.)
n'est incluse dans ce rapport.

Merci pour votre aide.

— Application Référendum Citoyen, v{{version}} (build {{build}})
```

## Where the button appears

Three integration points:

1. **`components/voting-modal/Step9Error.tsx`** — already the generic error step. If `!isExpectedError(verificationError)`, render the "Envoyer un rapport d'erreur" button below the existing message + "Réessayer".
2. **Root `<ErrorBoundary>` in `app/_layout.tsx`** — wraps the providers. On render-tree crash, shows a minimal fallback screen with the report button.
3. **`useErrorReporter()` hook** — for catch blocks in screens that are not Step9Error (e.g. home tab proposal load failures, voting-flow handlers that surface via `Alert.alert`). Returns `{ reportError(err, context) }`. Callers replace `Alert.alert(title, message)` with a helper that adds a third button when the error is unknown:
   ```
   [Annuler] [Réessayer] [Envoyer un rapport d'erreur]
   ```

## i18n keys

Added to all seven locale files (`fr` source; others machine-translated and flagged for review — matches existing pattern):

- `errorReport.button` — "Envoyer un rapport d'erreur"
- `errorReport.subject` — "Rapport d'erreur"
- `errorReport.body` — see template above
- `errorReport.shareDialogTitle` — "Envoyer le rapport"
- `errorReport.alertOption` — "Envoyer un rapport d'erreur"

## Testing

- `utils/__tests__/logger.test.ts` — redaction patterns (each row of the table + non-matching control), ring-buffer eviction by time, ring-buffer eviction by count, sweep timer fires.
- `utils/__tests__/error-reporter.test.ts` — `isExpectedError` classification with sample messages from each row of the predictable-error table + a known-unknown control; snapshot freezing (mutating the buffer after `prepareErrorReport` does not affect the written file); cleanup of previous `error-report-*.txt` files.
- Manual end-to-end: force a throw in voting flow Step 11 (e.g. inject `throw new Error('synthetic test')` in `castMainnetVote`) → tap "Envoyer un rapport d'erreur" → mail composer opens with attachment → open the .txt → grep for known PII patterns (MRZ, hex64, wallet, email) — must return zero matches.

## Files touched

New:
- `utils/logger.ts`
- `utils/error-reporter.ts`
- `contexts/ErrorReportContext.tsx`
- `components/ErrorBoundary.tsx`
- `components/ErrorReportButton.tsx`
- `utils/__tests__/logger.test.ts`
- `utils/__tests__/error-reporter.test.ts`

Modified:
- `app/_layout.tsx` — import logger first; wrap providers in `ErrorBoundary` + `ErrorReportProvider`.
- `components/voting-modal/Step9Error.tsx` — conditional report button.
- `constants/urls.ts` — add `ERROR_REPORT_EMAIL`.
- `locales/{de,en,es,fr,it,nl,pl}.json` — new `errorReport.*` keys.
- `package.json` — add `expo-mail-composer`, `expo-sharing`, `expo-file-system`.

## Open extensions (out of scope for v1)

- Wider error classification — add patterns as we discover them in real reports.
- Localised body template per locale (machine-translated initially, polished later).
- Optional Sentry / Bugsnag integration in addition to user-triggered reports.
