import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { appVersionLabel } from './app-version';

// Non-PII footer interpolated into settings.contactBody so support emails carry
// enough context to triage (which build / device a reporter is on). Keys match
// the {{...}} placeholders in locales/*.json. Version + build identify the
// JavaScript too: the app has no over-the-air updater (app.config.ts), so the
// bundle on a phone is always the one built into that binary.
export type ContactVars = {
  version: string;
  build: string;
  device: string;
  platform: string;
  os: string;
};

// Raw runtime values, before normalisation. Split out from the native reads so
// the formatting below can be unit-tested without mocking expo modules.
export interface RawContactInfo {
  version: string;
  build: string | number | null | undefined;
  deviceModel: string | null | undefined;
  platformOS: string;
  osVersion: string | number | null | undefined;
}

const FALLBACK = '?';

// Pure: normalise raw values into the interpolation object.
export function buildContactVars(raw: RawContactInfo): ContactVars {
  return {
    version: raw.version || FALLBACK,
    build: String(raw.build ?? '') || FALLBACK,
    device: raw.deviceModel || FALLBACK,
    platform: prettyPlatform(raw.platformOS),
    os: String(raw.osVersion ?? '') || FALLBACK,
  };
}

function prettyPlatform(os: string): string {
  if (os === 'ios') return 'iOS';
  if (os === 'android') return 'Android';
  return os || FALLBACK;
}

// expo-device is a native module; if it isn't linked yet (e.g. running new JS
// over an older native build) reading modelName can throw — fall back to '?' so
// the rest of the footer still prefills without a native rebuild.
function deviceModel(): string | null {
  try {
    return Device.modelName;
  } catch {
    return null;
  }
}

// Read runtime info and return the interpolation object for settings.contactBody.
export function getContactInfoVars(): ContactVars {
  return buildContactVars({
    version: appVersionLabel(),
    build: Application.nativeBuildVersion,
    deviceModel: deviceModel(),
    platformOS: Platform.OS,
    osVersion: Platform.Version,
  });
}
