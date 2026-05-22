import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

import { OTA_PATCH } from '@/constants/otaVersion';

// Composite app version, e.g. "1.0.5".
// Major.minor comes from the native binary (frozen at build time). Patch is the
// OTA generation: 0 on a fresh install before any OTA has been applied, then
// whatever number the loaded OTA bundle was published with.
export function getAppVersion(): string {
  const native = Application.nativeApplicationVersion ?? '1.0';
  const onEmbedded = !Updates.isEnabled || Updates.isEmbeddedLaunch;
  const patch = onEmbedded ? 0 : OTA_PATCH;
  return `${native}.${patch}`;
}
