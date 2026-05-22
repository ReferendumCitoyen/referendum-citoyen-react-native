#!/usr/bin/env node
// Bump constants/otaVersion.ts and publish an OTA via `eas update`.
//
// Usage: node scripts/publish-ota.mjs <channel> [message]
//   channel: e.g. "preview" or "production"
//   message: optional human-readable note shown on the EAS dashboard
//
// On failure, the OTA_PATCH file is restored so the counter doesn't drift.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'constants/otaVersion.ts');

const [, , channel, ...messageParts] = process.argv;
if (!channel) {
  console.error('Usage: node scripts/publish-ota.mjs <channel> [message]');
  process.exit(1);
}
const message = messageParts.join(' ').trim();

const original = readFileSync(FILE, 'utf8');
const match = original.match(/export const OTA_PATCH = (\d+);/);
if (!match) {
  console.error(`Could not find "export const OTA_PATCH = N;" in ${FILE}`);
  process.exit(1);
}
const next = Number(match[1]) + 1;
const bumped = original.replace(
  /export const OTA_PATCH = \d+;/,
  `export const OTA_PATCH = ${next};`,
);
writeFileSync(FILE, bumped);

console.log(`Bumped OTA_PATCH -> ${next}. Publishing to channel "${channel}"...`);

try {
  const flag = message ? `--message ${JSON.stringify(message)}` : '';
  execSync(`eas update --channel ${channel} ${flag}`.trim(), {
    stdio: 'inherit',
    cwd: ROOT,
  });
  console.log(`OTA #${next} published on channel "${channel}".`);
  console.log('Remember to commit constants/otaVersion.ts.');
} catch {
  console.error('eas update failed; reverting OTA_PATCH.');
  writeFileSync(FILE, original);
  process.exit(1);
}
