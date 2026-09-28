/**
 * User-facing screen for the per-document BJJ key DB ("Gestion des clés").
 *
 * Sections:
 *
 *   1. Documents — export the (passportHash → BJJ key) DB to a JSON file
 *      (system share sheet on iOS / Storage Access Framework on Android),
 *      and import a previous backup (merge or replace, picked via the OS
 *      document picker). Without this, a user who reinstalls the app
 *      loses every previously-registered on-chain identity, because
 *      Mainnet's Registration2 contract binds each document to a specific
 *      BJJ key and the chip cannot prove fresh ownership for a `revoke()`
 *      call. Accessible to all users.
 *
 *   2. Tout supprimer — wipes the active BJJ key, the document DB, and
 *      the accepted CGU version so the launch gate re-fires. Effectively
 *      resets the app to a fresh-install state without touching the
 *      device package or AsyncStorage entries owned by other features
 *      (theme, network choice, language). Gated behind dev mode (7 taps
 *      on the version row in Settings) — too destructive for ordinary
 *      users to be one tap away from.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { useDevMode } from '@/contexts/DevModeContext';
import {
  deletePrivateKey,
  exportToJson as exportPassportDb,
  importFromJson as importPassportDb,
  getAllEntries as getAllPassportDbEntries,
  replaceKeyForPassport,
  exportEntryToJson,
  normalizePastedKey,
  wipeDb as wipePassportDb,
  type PassportKeyEntry,
} from '@/utils/identity';
// Static, not dynamic: this is a pure comparison with no native dependency —
// only the `getProfileKey` it is handed needs the SDK.
import { verifyKeyAgainstChain, type KeyVerdict } from '@/utils/key-diagnosis';
import { useTerms } from '@/contexts/TermsContext';
import { useTranslation } from 'react-i18next';

export default function KeyManagementScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = createStyles(colors);
  const { clear: clearTerms } = useTerms();
  const { devMode } = useDevMode();
  // Screen is accessible to ordinary users — they need backup / restore to
  // survive an app reinstall without losing their on-chain identities. The
  // destructive "Tout supprimer" section further down is still gated to
  // devMode because it wipes the BJJ key, the document DB, and the
  // accepted CGU acceptance in one click. Export / import / per-document
  // list view is safe enough for general use; the export goes through the
  // file picker / share sheet so material never lands in the clipboard.
  const [status, setStatus] = useState<string | null>(null);
  const [dbEntries, setDbEntries] = useState<PassportKeyEntry[]>([]);
  // passportHash of the row whose key is being replaced, plus the pasted
  // value. Inline rather than Alert.prompt because that is iOS-only, and the
  // documents this recovers are overwhelmingly on Android (SecureStore there
  // is wiped on uninstall, which is what creates the need in the first place).
  const [replacingHash, setReplacingHash] = useState<string | null>(null);
  const [replacementKey, setReplacementKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAllPassportDbEntries().then((rows) => {
      if (!cancelled) setDbEntries(rows);
    });
    return () => { cancelled = true; };
  }, []);

  const refreshDb = async () => {
    setDbEntries(await getAllPassportDbEntries());
  };

  /**
   * Nothing leaves this screen until the voter has been told, in plain words,
   * what the file is (wave 4b, C4).
   *
   * The export is the private BJJ key in clear. Whoever holds it recomputes
   * `Poseidon3(sk, Poseidon1(sk), eventId)` for any ballot and reads how this
   * person voted, on every past and future scrutin of that document, with no
   * chip and no network. Nothing is revocable: French documents have no DG15,
   * so `Registration2.revoke()` is closed. Until tonight the only text next to
   * the button said "back the database up before uninstalling", which names
   * the benefit and not the risk, and the screen is reachable by any voter on
   * the store build.
   *
   * It does NOT let anyone vote in their place: the proof needs the real bytes
   * of DG1, so it needs the physical chip. That is worth saying too, because a
   * warning people do not believe is a warning they skip.
   *
   * WHAT ENCRYPTING IT WOULD TAKE, for the product owner and the protocol lead to decide, deliberately
   * not done tonight because it is a design change and not a correction:
   *   - a passphrase entered by the voter, with a strength floor, and the
   *     acceptance that a forgotten passphrase is a lost key, which is exactly
   *     the loss this file exists to prevent;
   *   - a memory-hard derivation (Argon2id, or scrypt) and authenticated
   *     encryption (XChaCha20-Poly1305 or AES-GCM). React Native has neither
   *     in the standard library, so it is a new native dependency on the
   *     critical path of the key store, reviewed and pinned like the others;
   *   - a file format with its own version, salt and parameters, plus an
   *     importer that still reads today's clear files, or every backup made
   *     before the change stops working;
   *   - a decision on whether an unencrypted export stays available at all.
   *     Refusing to write one is the stronger answer and the one that loses
   *     the voter who cannot manage a passphrase.
   */
  const confirmExport = (onConfirm: () => void) => {
    Alert.alert(
      t('keyManagement.exportWarningTitle', {
        defaultValue: 'Ce fichier contient votre clé de vote',
      }),
      t('keyManagement.exportWarningBody', {
        defaultValue:
          "Il permet à qui l'ouvre de savoir comment vous avez voté, sur ce scrutin et sur les suivants. Il ne permet pas de voter à votre place : cela demande aussi votre pièce d'identité. Le fichier n'est protégé par aucun mot de passe. Gardez le pour vous, sur un support que vous conservez, et évitez de l'envoyer par messagerie ou de le déposer dans un espace de stockage en ligne.",
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
        {
          text: t('keyManagement.exportWarningCta', { defaultValue: "J'ai compris" }),
          onPress: onConfirm,
        },
      ],
    );
  };

  // Build the JSON + filename once; reused by both export entry points
  // (share-sheet and direct-save-to-phone).
  const buildExportPayload = async () => {
    const json = await exportPassportDb();
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return { json, filename: `referendum-citoyen-keys-${date}.json` };
  };

  // Share-sheet export: write JSON to a temp file and hand it to the system
  // share sheet (Files, Drive, email, …). Replaces the previous
  // Clipboard.setStringAsync path — clipboard exposes the keys to every app
  // with clipboard-read access for ~15 s on Android 12+, which is a
  // meaningful leak for vote-rights-bearing material. The file lives in
  // cacheDirectory and the OS reaps it.
  //
  // On iOS this is the only export path — the share sheet's built-in
  // "Save to Files" handles direct-save use cases. On Android it sits
  // alongside `handleDbSaveToPhone` because Android's share sheet
  // surfaces "Files" inconsistently (depends on installed apps).
  const handleDbShare = () => confirmExport(runDbShare);

  const runDbShare = async () => {
    try {
      const { json, filename } = await buildExportPayload();
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          t('keyManagement.genericError'),
          t('keyManagement.exportShareUnavailable', {
            defaultValue: 'Le partage de fichiers n’est pas disponible sur cet appareil.',
          }),
        );
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: t('keyManagement.exportShareTitle', {
          defaultValue: 'Sauvegarder les clés des documents',
        }),
        UTI: 'public.json', // iOS-only hint
      });
      // The share sheet has taken its copy: the clear one in the cache has no
      // reason to outlive it (wave 4b, minor "export files never cleaned up").
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      setStatus(
        t('keyManagement.exportShared', {
          count: dbEntries.length,
          plural: dbEntries.length > 1 ? 's' : '',
          defaultValue: 'Fichier de sauvegarde généré ({{count}} document{{plural}}).',
        }),
      );
    } catch (e: any) {
      Alert.alert(t('keyManagement.genericError'), e?.message ?? t('keyManagement.exportError'));
    }
  };

  // Direct-save export (Android only): use the Storage Access Framework so
  // the user picks a destination folder (Downloads, Documents, an SD card,
  // etc.) and the JSON lands there as a real file they can find in their
  // file manager — independent of any other app being installed. iOS has
  // no equivalent OS API; iOS users save through the share sheet's
  // "Save to Files" entry instead, which is why this button is hidden on iOS.
  const handleDbSaveToPhone = () => confirmExport(runDbSaveToPhone);

  const runDbSaveToPhone = async () => {
    if (Platform.OS !== 'android') {
      // Defensive: button is Android-only in the JSX, but if a caller
      // wires it up on iOS, fall through to the share sheet rather than
      // silently no-op.
      return runDbShare();
    }
    try {
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        // User cancelled the folder picker — silent, no error.
        return;
      }
      const { json, filename } = await buildExportPayload();
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        permissions.directoryUri,
        filename,
        'application/json',
      );
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setStatus(
        t('keyManagement.exportSaved', {
          count: dbEntries.length,
          plural: dbEntries.length > 1 ? 's' : '',
          defaultValue: 'Fichier enregistré sur le téléphone ({{count}} document{{plural}}).',
        }),
      );
    } catch (e: any) {
      Alert.alert(t('keyManagement.genericError'), e?.message ?? t('keyManagement.exportError'));
    }
  };

  // Import: open the OS document picker, read the chosen JSON file, then
  // surface the existing merge/replace confirmation dialog. Replaces the
  // multiline-paste TextInput. `copyToCacheDirectory: true` is necessary on
  // Android — the raw `content://` URI from SAF isn't readable by
  // FileSystem.readAsStringAsync; the picker copies it into our sandbox.
  const handleDbImportFromFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset?.uri) {
        Alert.alert(
          t('keyManagement.importInvalidTitle'),
          t('keyManagement.importPickError', {
            defaultValue: 'Impossible de lire le fichier sélectionné.',
          }),
        );
        return;
      }
      const json = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const trimmed = json.trim();
      if (!trimmed) {
        Alert.alert(t('keyManagement.importEmptyTitle'), t('keyManagement.importEmptyBody'));
        return;
      }
      promptImportMode(trimmed);
    } catch (e: any) {
      Alert.alert(
        t('keyManagement.importInvalidTitle'),
        e?.message ?? t('keyManagement.importInvalidBody'),
      );
    }
  };

  // Shared merge/replace confirmation. Called once we have JSON content,
  // regardless of how it got there (file picker today; future paths could
  // add scanning a QR backup etc).
  const promptImportMode = (json: string) => {
    Alert.alert(
      t('keyManagement.importChooseModeTitle', {
        defaultValue: 'Importer la sauvegarde ?',
      }),
      t('keyManagement.importChooseModeBody', {
        defaultValue:
          'Fusionner : conserve les passeports existants et ajoute ceux qui ne sont pas déjà présents.\n\nTout remplacer : efface tous les passeports actuels et les remplace par ceux du fichier.',
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('keyManagement.actionMerge'),
          style: 'default',
          onPress: () => doImport(json, 'merge'),
        },
        {
          text: t('keyManagement.actionReplaceAll'),
          style: 'destructive',
          onPress: () => doImport(json, 'replace'),
        },
      ],
    );
  };

  // Derive-and-compare, shared by BOTH routes into replaceKeyForPassport (the
  // paste field below and the import-conflict prompt above). Never throws:
  // a verification we couldn't perform returns 'unknown' and falls through to
  // the caller's own "this is permanent" confirmation, because refusing a
  // recovery we merely failed to check would be worse than not checking.
  const verifyAgainstChain = async (
    candidate: string,
    onChainIdentity: string | undefined,
  ): Promise<KeyVerdict> => {
    if (!onChainIdentity) return 'unknown';
    try {
      const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
      return verifyKeyAgainstChain(candidate, onChainIdentity, (sk) =>
        RarimeUtils.getProfileKey(sk),
      );
    } catch (e: any) {
      console.warn('[key-management] could not verify replacement key:', e?.message ?? e);
      return 'unknown';
    }
  };

  // Overwrite the keys for documents the import collided with. Deliberately
  // scoped to the colliding entries only — everything else in the DB is left
  // exactly as it was, which is what makes this safe to offer at all.
  //
  // Every colliding key is checked against the chain BEFORE anything is
  // offered. This route used to skip that check entirely while the paste field
  // did it, which was exactly backwards: the other app exports a WHOLE-DB
  // backup, so the file importer is the route a cross-app recovery actually
  // takes, and it was the one that could destroy a good key without a word.
  const promptOverwriteConflicts = async (
    conflicts: { passportHash: string; privateKey: string }[],
  ) => {
    // The incoming entries carry no onChainIdentity — the exporting app's
    // schema has no such field. It lives on the row already in THIS DB, put
    // there by Step 7 the first time this document failed verification. Read
    // fresh rather than from `dbEntries`, whose setState hasn't flushed yet.
    const rows = await getAllPassportDbEntries();
    const judged: { passportHash: string; privateKey: string; verdict: KeyVerdict }[] = [];
    for (const c of conflicts) {
      const onChain = rows.find((e) => e.passportHash === c.passportHash)?.onChainIdentity;
      judged.push({ ...c, verdict: await verifyAgainstChain(c.privateKey, onChain) });
    }
    const mismatched = judged.filter((j) => j.verdict === 'mismatch');
    // 'unknown' is replaceable: nothing was recorded to check against, so the
    // user's own confirmation is the only gate there ever was on this row.
    const replaceable = judged.filter((j) => j.verdict !== 'mismatch');

    // Nothing survived the check — don't offer a destructive action at all.
    if (replaceable.length === 0) {
      Alert.alert(
        t('keyManagement.importConflictNoneMatchTitle', {
          defaultValue:
            mismatched.length > 1
              ? 'Ces clés ne correspondent pas'
              : 'Cette clé ne correspond pas',
        }),
        t('keyManagement.importConflictNoneMatchBody', {
          count: mismatched.length,
          defaultValue:
            "Cette sauvegarde ne contient pas la clé avec laquelle ce document est enregistré sur la blockchain. Rien n'a été modifié.\n\nUtilisez la sauvegarde de l'application qui a servi à enregistrer ce document.",
        }),
      );
      return;
    }

    const skippedNote =
      mismatched.length > 0
        ? t('keyManagement.importConflictSkippedNote', {
            count: mismatched.length,
            defaultValue: `\n\n${mismatched.length} clé(s) de cette sauvegarde ne correspondent pas à l'enregistrement de leur document et seront ignorées.`,
          })
        : '';

    Alert.alert(
      t('keyManagement.importConflictTitle', {
        defaultValue:
          replaceable.length > 1
            ? 'Ces documents ont déjà une clé'
            : 'Ce document a déjà une clé',
      }),
      t('keyManagement.importConflictBody', {
        count: replaceable.length,
        defaultValue:
          "La sauvegarde contient une clé pour un document déjà enregistré sur cet appareil. Rien n'a été modifié.\n\nRemplacer écrasera définitivement la clé actuelle de ce document. Ne continuez que si la clé importée est bien celle qui a servi à l'enregistrer.",
      }) + skippedNote,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('keyManagement.importConflictCta', { defaultValue: 'Remplacer' }),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const c of replaceable) {
                await replaceKeyForPassport(c.passportHash, c.privateKey);
              }
              await refreshDb();
              setStatus(
                t('keyManagement.importConflictDone', {
                  count: replaceable.length,
                  defaultValue: 'Clé remplacée. Rescannez ce document pour vérifier.',
                }),
              );
            } catch (e: any) {
              Alert.alert(t('keyManagement.genericError'), e?.message ?? String(e));
            }
          },
        },
      ],
    );
  };

  // Share ONE document's key, in the same file format a full backup uses so
  // the other app's importer takes it as-is. The whole-DB export was the only
  // transferable artifact before, so moving a single key meant handing over
  // every other key too — the safe move was the inconvenient one.
  const handleShareOneKey = (passportHash: string) =>
    confirmExport(() => { void runShareOneKey(passportHash); });

  const runShareOneKey = async (passportHash: string) => {
    try {
      const json = await exportEntryToJson(passportHash);
      // The file name carries no document identifier: this file is shared by
      // email or saved to Downloads, and 8 hex characters of passportHash are
      // the StateKeeper lookup key (wave 4b, M1bis).
      const uri = `${FileSystem.cacheDirectory}referendum-citoyen-cle.json`;
      await FileSystem.writeAsStringAsync(uri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          t('keyManagement.genericError'),
          t('keyManagement.exportShareUnavailable', {
            defaultValue: "Le partage n'est pas disponible sur cet appareil.",
          }),
        );
        return;
      }
      // Share sheet rather than the clipboard, matching the whole-DB export:
      // clipboard contents are readable by every app for ~15 s on Android 12+,
      // which is a meaningful leak for vote-rights-bearing material.
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: t('keyManagement.shareOneKeyTitle', {
          defaultValue: 'Partager la clé de ce document',
        }),
        UTI: 'public.json',
      });
      // As above: the clear copy in the cache goes once the sheet is done.
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch (e: any) {
      Alert.alert(t('keyManagement.genericError'), e?.message ?? String(e));
    }
  };

  const doImport = async (json: string, mode: 'merge' | 'replace') => {
    try {
      const r = await importPassportDb(json, mode);
      await refreshDb();
      // A merge that hit conflicts is the recovery case, not a no-op to shrug
      // at: the document is already in the DB holding the WRONG key, which is
      // why the user is importing. Skipping silently and reporting "0 added"
      // looks like the import failed. Offer the overwrite explicitly instead —
      // still never automatic, since it destroys the current key.
      if (mode === 'merge' && r.conflicts.length > 0) {
        await promptOverwriteConflicts(r.conflicts);
        return;
      }
      setStatus(
        t(
          mode === 'replace'
            ? 'keyManagement.importDoneReplace'
            : 'keyManagement.importDoneMerge',
          {
            added: r.added,
            addedPlural: r.added > 1 ? 's' : '',
            skipped: r.skipped,
            skippedPlural: r.skipped > 1 ? 's' : '',
          },
        ),
      );
    } catch (e: any) {
      Alert.alert(
        t('keyManagement.importInvalidTitle'),
        e?.message ?? t('keyManagement.importInvalidBody'),
      );
    }
  };

  // Open the inline editor for one document, pre-filling from the clipboard
  // when it already holds a well-formed key. That is the expected path — the
  // Scan ID app's "Clé d'identité" screen copies it — so the common case is
  // open, glance, confirm.
  const beginReplaceKey = async (passportHash: string) => {
    setReplacingHash(passportHash);
    setReplacementKey('');
    try {
      const clip = (await Clipboard.getStringAsync())?.trim() ?? '';
      if (/^(0x)?[0-9a-fA-F]{64}$/.test(clip)) setReplacementKey(clip);
    } catch {
      // Clipboard unavailable (permissions, headless) — the user can paste
      // into the field by hand.
    }
  };

  // Rebinding a document to a key that was registered elsewhere. Confirmed
  // explicitly because getting it wrong is unrecoverable: French documents
  // carry no DG15/AA, so `Registration2.revoke()` is closed and a document
  // bound to the wrong key can never vote again.
  const handleConfirmReplaceKey = async (passportHash: string) => {
    const raw = replacementKey.trim();
    if (!raw) return;
    // Absorbs wrapped newlines, invisible zero-width characters, quotes, a 0x
    // prefix, and a pasted single-entry export file — all shapes a key really
    // arrives in, and all of which used to fail with a length error that told
    // the user nothing useful.
    const candidate = normalizePastedKey(raw);
    if (!candidate) {
      Alert.alert(
        t('keyManagement.replaceKeyInvalidTitle', { defaultValue: 'Clé non reconnue' }),
        t('keyManagement.replaceKeyInvalidBody', {
          defaultValue:
            "Attendu : une clé privée de 64 caractères hexadécimaux, ou le contenu d'un fichier de clé exporté pour un seul document.\n\nPour restaurer une sauvegarde complète, utilisez « Importer » plus haut.",
        }),
      );
      return;
    }

    // Check the candidate against what the chain says BEFORE overwriting, when
    // we know what the chain says. Replacing is destructive and irreversible,
    // and the failure it is meant to fix looks identical afterwards — so
    // without this the user pastes, rescans, sees the same error, and has lost
    // the old key for nothing. `onChainIdentity` is recorded by Step 7 the
    // first time a document fails verification; rows that have never failed
    // don't carry one, and we fall through to the plain confirmation rather
    // than blocking on an unknown.
    const row = dbEntries.find((e) => e.passportHash === passportHash);
    const verdict = await verifyAgainstChain(candidate, row?.onChainIdentity);
    if (verdict === 'mismatch') {
      Alert.alert(
        t('keyManagement.replaceKeyMismatchTitle', {
          defaultValue: 'Cette clé ne correspond pas',
        }),
        t('keyManagement.replaceKeyMismatchBody', {
          defaultValue:
            "Ce document est enregistré sur la blockchain avec une autre clé que celle-ci. La coller ne résoudra pas l'erreur et effacerait définitivement la clé actuelle.\n\nUtilisez la sauvegarde de l'application qui a servi à enregistrer ce document.",
        }),
      );
      return;
    }
    if (verdict === 'match') {
      // Say so plainly, then still ask, since the write is permanent.
      setStatus(
        t('keyManagement.replaceKeyVerified', {
          defaultValue: '✓ Cette clé correspond à l\'enregistrement de ce document.',
        }),
      );
    }
    // 'unknown' falls through to the confirmation below, which already warns
    // the write is permanent — see verifyAgainstChain.

    Alert.alert(
      t('keyManagement.replaceKeyConfirmTitle', {
        defaultValue: 'Remplacer la clé de ce document ?',
      }),
      t('keyManagement.replaceKeyConfirmBody', {
        defaultValue:
          "La clé actuellement associée à ce document sera définitivement écrasée. Ne continuez que si cette nouvelle clé est bien celle qui a servi à l'enregistrer.",
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('keyManagement.replaceKeyCta', { defaultValue: 'Remplacer' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await replaceKeyForPassport(passportHash, candidate);
              await refreshDb();
              setReplacingHash(null);
              setReplacementKey('');
              setStatus(
                t('keyManagement.replaceKeyDone', {
                  defaultValue: 'Clé remplacée. Rescannez ce document pour vérifier.',
                }),
              );
            } catch (e: any) {
              Alert.alert(
                t('keyManagement.replaceKeyErrorTitle', { defaultValue: 'Clé invalide' }),
                e?.message ??
                  t('keyManagement.replaceKeyErrorBody', {
                    defaultValue: 'Cette clé n’a pas pu être enregistrée.',
                  }),
              );
            }
          },
        },
      ],
    );
  };

  // "Tout supprimer" — destructive reset. Wipes the BJJ private key, the
  // per-passport DB, and the accepted CGU version so the launch gate
  // re-fires. Use case: the user wants to give the device to someone
  // else, or has a corrupted state they can't otherwise recover from.
  const handleWipeAll = () => {
    Alert.alert(
      t('keyManagement.wipeAllConfirmTitle'),
      t('keyManagement.wipeAllAlertBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('keyManagement.wipeAllCta'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePrivateKey();
              await wipePassportDb();
              await clearTerms();
              await refreshDb();
              setStatus(t('keyManagement.wipeAllDone'));
            } catch (e: any) {
              Alert.alert(t('keyManagement.wipeAllError'), e?.message ?? t('keyManagement.wipeAllErrorBody'));
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('keyManagement.dbSectionTitle', { count: dbEntries.length })}
        </Text>
        <Text style={styles.helpText}>
          {t('keyManagement.dbDescription')}
        </Text>

        {dbEntries.length > 0 && (
          <View style={[styles.keyBox, { gap: 10 }]}>
            {dbEntries.map((e) => (
              <View key={e.passportHash} style={{ gap: 2 }}>
                {/* Which document this key belongs to. Two rows of bare hash
                    are indistinguishable, which is the whole complaint. Rows
                    written before the type was recorded say so and tell the
                    user how to fix it — rescanning backfills them. */}
                <Text style={styles.dbRowLabel}>
                  {e.docType === 'passport'
                    ? t('keyManagement.dbRowPassport')
                    : e.docType === 'idCard'
                      ? t('keyManagement.dbRowIdCard')
                      : t('keyManagement.dbRowUnknown')}
                </Text>
                <Text style={styles.keyText}>
                  <Text style={{ opacity: 0.55 }}>{e.passportHash}</Text>
                </Text>

                {/* Recovery path for a document the chain reports as
                    registered with another key — see replaceKeyForPassport.
                    Per-row rather than a global action so the other
                    documents' keys are never at risk. */}
                {replacingHash === e.passportHash ? (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    <TextInput
                      style={styles.keyInput}
                      value={replacementKey}
                      onChangeText={setReplacementKey}
                      placeholder={t('keyManagement.replaceKeyPlaceholder', {
                        defaultValue: 'Collez la clé (64 caractères hex)',
                      })}
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                    />
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        style={[styles.rowAction, { flex: 1 }]}
                        onPress={() => {
                          setReplacingHash(null);
                          setReplacementKey('');
                        }}
                      >
                        <Text style={styles.rowActionText}>{t('common.cancel')}</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.rowAction,
                          { flex: 1 },
                          !replacementKey.trim() && styles.buttonDisabled,
                        ]}
                        disabled={!replacementKey.trim()}
                        onPress={() => handleConfirmReplaceKey(e.passportHash)}
                      >
                        <Text style={styles.rowActionText}>
                          {t('keyManagement.replaceKeyCta', { defaultValue: 'Remplacer' })}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                    <Pressable
                      style={styles.rowActionInline}
                      onPress={() => beginReplaceKey(e.passportHash)}
                    >
                      <Text style={styles.rowActionText}>
                        {t('keyManagement.replaceKeyAction', {
                          defaultValue: 'Remplacer la clé…',
                        })}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.rowActionInline}
                      onPress={() => handleShareOneKey(e.passportHash)}
                    >
                      <Text style={styles.rowActionText}>
                        {t('keyManagement.shareOneKeyAction', {
                          defaultValue: 'Partager cette clé…',
                        })}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Save-to-phone path uses SAF — Android only. iOS users save via
            the share sheet's built-in "Save to Files" entry, so we don't
            render this button there. */}
        {Platform.OS === 'android' && (
          <Pressable
            style={[styles.button, dbEntries.length === 0 && styles.buttonDisabled, { marginBottom: 10 }]}
            onPress={handleDbSaveToPhone}
            disabled={dbEntries.length === 0}
          >
            <Text style={styles.buttonText}>
              {t('keyManagement.actionSaveToPhone', {
                defaultValue: 'Enregistrer sur le téléphone',
              })}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.button, dbEntries.length === 0 && styles.buttonDisabled]}
          onPress={handleDbShare}
          disabled={dbEntries.length === 0}
        >
          <Text style={styles.buttonText}>
            {t(Platform.OS === 'android' ? 'keyManagement.actionShare' : 'keyManagement.actionExport', {
              defaultValue: Platform.OS === 'android' ? 'Partager…' : 'Exporter (fichier .json)',
            })}
          </Text>
        </Pressable>

        <Text style={[styles.helpText, { marginTop: 14 }]}>
          {t('keyManagement.dbRestoreHint', {
            defaultValue:
              'Pour restaurer une sauvegarde, importez le fichier .json que vous avez exporté précédemment. Le choix « Fusionner » / « Tout remplacer » s’affiche au moment de l’import.',
          })}
        </Text>
        <Pressable style={styles.button} onPress={handleDbImportFromFile}>
          <Text style={styles.buttonText}>
            {t('keyManagement.actionImportFile', { defaultValue: 'Importer un fichier…' })}
          </Text>
        </Pressable>
      </View>

      {/* Destructive global reset — wipes the BJJ key, the document DB, and
          the CGU acceptance in one click. Gated to dev mode: ordinary users
          shouldn't be one tap away from losing every registered identity.
          Power users (with dev mode unlocked via 7 taps on the version row
          in Settings) still get the escape hatch. */}
      {devMode && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('keyManagement.wipeAllSectionTitle')}</Text>
          <Text style={styles.helpText}>
            {t('keyManagement.wipeAllSectionDescription')}
          </Text>
          <Pressable style={styles.dangerButton} onPress={handleWipeAll}>
            <Text style={styles.dangerButtonText}>{t('keyManagement.wipeAllCta')}</Text>
          </Pressable>
        </View>
      )}

      {status && (
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    section: {
      backgroundColor: colors.cardBackground,
      padding: Spacing.settingRow.paddingHorizontal,
      marginBottom: 12,
    },
    sectionTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.settingRow,
      color: colors.text,
      marginBottom: 8,
    },
    helpText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.7,
      marginBottom: 12,
      lineHeight: Typography.lineHeight.small,
    },
    keyBox: {
      backgroundColor: colors.background,
      borderRadius: 6,
      padding: 12,
      marginBottom: 12,
      minHeight: 48,
      justifyContent: 'center',
    },
    keyText: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 13,
      color: colors.text,
    },
    // Document type above each key. Proportional and semibold so it reads as a
    // heading against the monospace hash below it.
    dbRowLabel: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 13,
      color: colors.text,
    },
    keyTextMasked: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 13,
      color: colors.text,
      opacity: 0.5,
    },
    button: {
      flex: 3,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    // Per-document key recovery. Lower emphasis than the section buttons —
    // it sits inside a key row and must not compete with export/import.
    rowActionInline: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    rowAction: {
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    rowActionText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.small,
      color: colors.primary,
    },
    keyInput: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 13,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 60,
      textAlignVertical: 'top',
    },
    buttonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.buttonText,
    },
    dangerButton: {
      flex: 2,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: '#c43b3b',
      alignItems: 'center',
    },
    dangerButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: '#ffffff',
    },
    statusBox: {
      marginHorizontal: Spacing.settingRow.paddingHorizontal,
      padding: 12,
      backgroundColor: colors.cardBackground,
      borderLeftWidth: 4,
      borderLeftColor: colors.secondary,
      borderRadius: 6,
    },
    statusText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      lineHeight: Typography.lineHeight.small,
    },
  });
