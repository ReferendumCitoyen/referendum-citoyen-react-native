// Patch component of the user-visible app version (e.g. "1.0.5" → 5).
//
// Bumped by `scripts/publish-ota.mjs` before each `eas update`. The JS bundle
// published as OTA #N carries OTA_PATCH = N. Reset to 0 manually whenever the
// native `version` in app.config.ts is bumped (e.g. 1.0 → 1.1).
export const OTA_PATCH = 0;
