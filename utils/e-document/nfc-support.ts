/**
 * "Does this device have an NFC reader at all?" (item 11 E of the 2.0.2
 * dossier). Every NFCNotSupported in the reports came from an iPad (37 of 37,
 * 9 models), and those people read "le NFC est activé sur votre téléphone"
 * at step 6, after typing their CAN: false, and unsolvable. The answer is
 * known before the flow starts, from a local call (no request).
 *
 * Returns false only on a definite "no". An error or an odd answer returns
 * null, which callers treat as "maybe": blocking a phone that does have NFC
 * would be worse than the late message step 6 still gives.
 */
import NfcManager from 'react-native-nfc-manager';

export async function checkNfcHardware(): Promise<boolean | null> {
  try {
    const supported: unknown = await NfcManager.isSupported();
    if (supported === true) return true;
    if (supported === false) return false;
    return null;
  } catch {
    return null;
  }
}
