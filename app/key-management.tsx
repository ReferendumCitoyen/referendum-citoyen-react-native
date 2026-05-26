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
  View,
} from 'react-native';
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
  wipeDb as wipePassportDb,
  type PassportKeyEntry,
} from '@/utils/identity';
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
  const handleDbShare = async () => {
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
  const handleDbSaveToPhone = async () => {
    if (Platform.OS !== 'android') {
      // Defensive: button is Android-only in the JSX, but if a caller
      // wires it up on iOS, fall through to the share sheet rather than
      // silently no-op.
      return handleDbShare();
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

  const doImport = async (json: string, mode: 'merge' | 'replace') => {
    try {
      const r = await importPassportDb(json, mode);
      await refreshDb();
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
          <View style={[styles.keyBox, { gap: 6 }]}>
            {dbEntries.map((e) => (
              <Text key={e.passportHash} style={styles.keyText}>
                <Text style={{ opacity: 0.55 }}>{e.passportHash}</Text>
              </Text>
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
    keyTextMasked: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 13,
      color: colors.text,
      opacity: 0.5,
    },
    button: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.buttonText,
    },
    dangerButton: {
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
