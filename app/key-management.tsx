/**
 * Dev-only screen for the per-passport BJJ key DB and a "Tout supprimer"
 * destructive reset.
 *
 * Two sections:
 *
 *   1. Base de passeports — export the (passportHash → BJJ key) DB to
 *      JSON for backup, and import a previous backup (merge or replace).
 *      Without this, a user who reinstalls the app loses every
 *      previously-registered on-chain identity, because Mainnet's
 *      Registration2 contract binds each passport to a specific BJJ key
 *      and the chip cannot prove fresh ownership for a `revoke()` call.
 *
 *   2. Tout supprimer — wipes the active BJJ key, the passport DB, and
 *      the accepted CGU version so the launch gate re-fires. Effectively
 *      resets the app to a fresh-install state without touching the
 *      device package or AsyncStorage entries owned by other features
 *      (theme, network choice, language).
 *
 * Gated behind dev mode (7 taps on the version row in Settings); ordinary
 * users should never see this screen.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
  const router = useRouter();
  const { devMode } = useDevMode();
  // Dev-only screen. Exposes per-passport BJJ private keys (export, import,
  // wipe) — anyone with the JSON export can vote as the bound identities.
  // Production deep-links (`referendumcitoyen://key-management`) must not
  // reach the screen body. Stack.Screen registration in _layout.tsx is
  // already conditional on devMode, but Expo Router auto-registers every
  // file in `app/`, so this in-component redirect is the actual barrier.
  useEffect(() => {
    if (!devMode) router.replace('/');
  }, [devMode, router]);

  const [status, setStatus] = useState<string | null>(null);
  const [dbEntries, setDbEntries] = useState<PassportKeyEntry[]>([]);
  const [dbImportPaste, setDbImportPaste] = useState('');

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

  const handleDbExport = async () => {
    try {
      const json = await exportPassportDb();
      await Clipboard.setStringAsync(json);
      setStatus(
        t('keyManagement.exportCopied', {
          count: dbEntries.length,
          plural: dbEntries.length > 1 ? 's' : '',
        }),
      );
    } catch (e: any) {
      Alert.alert(t('keyManagement.genericError'), e?.message ?? t('keyManagement.exportError'));
    }
  };

  const handleDbImport = (mode: 'merge' | 'replace') => {
    if (!dbImportPaste.trim()) {
      Alert.alert(t('keyManagement.importEmptyTitle'), t('keyManagement.importEmptyBody'));
      return;
    }
    const title = mode === 'replace'
      ? t('keyManagement.confirmReplaceTitle')
      : t('keyManagement.confirmMergeTitle');
    const warning = mode === 'replace'
      ? t('keyManagement.dbImportReplace')
      : t('keyManagement.dbImportMerge');
    const verb = mode === 'replace' ? t('keyManagement.actionReplaceAll') : t('keyManagement.actionMerge');
    Alert.alert(
      title,
      warning,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: verb,
          style: mode === 'replace' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              const r = await importPassportDb(dbImportPaste, mode);
              setDbImportPaste('');
              await refreshDb();
              setStatus(
                t(mode === 'replace' ? 'keyManagement.importDoneReplace' : 'keyManagement.importDoneMerge', {
                  added: r.added,
                  addedPlural: r.added > 1 ? 's' : '',
                  skipped: r.skipped,
                  skippedPlural: r.skipped > 1 ? 's' : '',
                }),
              );
            } catch (e: any) {
              Alert.alert(t('keyManagement.importInvalidTitle'), e?.message ?? t('keyManagement.importInvalidBody'));
            }
          },
        },
      ],
    );
  };

  const handleDbWipe = () => {
    Alert.alert(
      t('keyManagement.wipeDbConfirmTitle'),
      t('keyManagement.wipeDbConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('keyManagement.actionDelete'),
          style: 'destructive',
          onPress: async () => {
            await wipePassportDb();
            await refreshDb();
            setStatus(t('keyManagement.wipeDbDone'));
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

  if (!devMode) return null;
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
              <Text key={e.passportHash} style={styles.keyText} numberOfLines={1}>
                <Text style={{ opacity: 0.55 }}>{e.passportHash.slice(0, 12)}…</Text>
              </Text>
            ))}
          </View>
        )}

        <View style={styles.row}>
          <Pressable
            style={[styles.button, dbEntries.length === 0 && styles.buttonDisabled]}
            onPress={handleDbExport}
            disabled={dbEntries.length === 0}
          >
            <Text style={styles.buttonText}>{t('keyManagement.actionExport')}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, dbEntries.length === 0 && styles.buttonDisabled]}
            onPress={handleDbWipe}
            disabled={dbEntries.length === 0}
          >
            <Text style={styles.buttonText}>{t('keyManagement.actionDelete')}</Text>
          </Pressable>
        </View>

        <Text style={[styles.helpText, { marginTop: 14 }]}>
          {t('keyManagement.dbRestoreHint')}
        </Text>
        <TextInput
          style={styles.input}
          value={dbImportPaste}
          onChangeText={setDbImportPaste}
          placeholder='{"version":1,"entries":[…]}'
          placeholderTextColor={colors.text + '60'}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          multiline
        />
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => handleDbImport('merge')}>
            <Text style={styles.buttonText}>{t('keyManagement.actionMerge')}</Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={() => handleDbImport('replace')}>
            <Text style={styles.dangerButtonText}>{t('keyManagement.actionReplaceAll')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('keyManagement.wipeAllSectionTitle')}</Text>
        <Text style={styles.helpText}>
          {t('keyManagement.wipeAllSectionDescription')}
        </Text>
        <Pressable style={styles.dangerButton} onPress={handleWipeAll}>
          <Text style={styles.dangerButtonText}>{t('keyManagement.wipeAllCta')}</Text>
        </Pressable>
      </View>

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
    row: {
      flexDirection: 'row',
      gap: 10,
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
    input: {
      backgroundColor: colors.background,
      borderRadius: 6,
      padding: 12,
      minHeight: 80,
      fontFamily: Typography.fontFamily.mono,
      fontSize: 13,
      color: colors.text,
      marginBottom: 12,
      textAlignVertical: 'top',
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
