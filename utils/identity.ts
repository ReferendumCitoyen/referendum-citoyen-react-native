import * as SecureStore from 'expo-secure-store';
import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';

// Returns the user's BJJ private key from SecureStore, generating + persisting
// a new one on first run. Uses a dynamic import so callers don't pay the
// rarime-rn-sdk load cost just to read an existing key.
export async function getOrCreatePrivateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
  if (existing) return existing;

  const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
  const generated = RarimeUtils.generateBJJPrivateKey();
  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, generated);
  return generated;
}
