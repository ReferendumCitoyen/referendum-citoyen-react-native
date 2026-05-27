#!/usr/bin/env node
// Publish an OTA update via `eas update`.
// Bump OTA_PATCH in constants/otaVersion.ts manually before running this.
//
// Usage: node scripts/publish-ota.mjs <channel> [message]
//   channel: e.g. "preview" or "production"
//   message: optional human-readable note shown on the EAS dashboard

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const content = readFileSync(FILE, 'utf8');
const match = content.match(/export const OTA_PATCH = (\d+);/);
if (!match) {
  console.error(`Could not find "export const OTA_PATCH = N;" in ${FILE}`);
  process.exit(1);
}
const patch = Number(match[1]);

console.log(`Publishing OTA_PATCH=${patch} to channel "${channel}"...`);

const flag = message ? `--message ${JSON.stringify(message)}` : '';
for (const platform of ['ios', 'android']) {
  console.log(`  → ${platform}`);
  execSync(`eas update --channel ${channel} --platform ${platform} ${flag}`.trim(), {
    stdio: 'inherit',
    cwd: ROOT,
  });
}
console.log(`OTA #${patch} published on channel "${channel}".`);
