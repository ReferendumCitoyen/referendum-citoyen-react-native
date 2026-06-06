import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { OTA_PATCH } from '@/constants/otaVersion';

import { getAppVersion } from './appVersion';

// Non-PII footer interpolated into settings.contactBody so support emails carry
// enough context to triage (which build / device a reporter is on). Keys match
// the {{...}} placeholders in locales/*.json.
export type ContactVars = {
  version: string;
  build: string;
  device: string;
  platform: string;
  os: string;
  ota: string;
};

// Raw runtime values, before normalisation. Split out from the native reads so
// the formatting below can be unit-tested without mocking expo modules.
export interface RawContactInfo {
  version: string;
  build: string | number | null | undefined;
  deviceModel: string | null | undefined;
  platformOS: string;
  osVersion: string | number | null | undefined;
  otaEmbedded: boolean;
  otaPatch: number;
}

const FALLBACK = '?';

// Pure: normalise raw values into the interpolation object. OTA is a plain
// generation number — 0 when running the embedded bundle (no OTA applied).
export function buildContactVars(raw: RawContactInfo): ContactVars {
  return {
    version: raw.version || FALLBACK,
    build: String(raw.build ?? '') || FALLBACK,
    device: raw.deviceModel || FALLBACK,
    platform: prettyPlatform(raw.platformOS),
    os: String(raw.osVersion ?? '') || FALLBACK,
    ota: raw.otaEmbedded ? '0' : String(raw.otaPatch),
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
  const onEmbedded = !Updates.isEnabled || Updates.isEmbeddedLaunch;
  return buildContactVars({
    version: getAppVersion(),
    build: Application.nativeBuildVersion,
    deviceModel: deviceModel(),
    platformOS: Platform.OS,
    osVersion: Platform.Version,
    otaEmbedded: onEmbedded,
    otaPatch: OTA_PATCH,
  });
}
