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
import * as Clipboard from 'expo-clipboard';
import { useColors, Typography, Spacing } from '@/constants/theme';
import {
  deletePrivateKey,
  exportToJson as exportPassportDb,
  importFromJson as importPassportDb,
  getAllEntries as getAllPassportDbEntries,
  wipeDb as wipePassportDb,
  type PassportKeyEntry,
} from '@/utils/identity';
import { useTerms } from '@/contexts/TermsContext';

export default function KeyManagementScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const { clear: clearTerms } = useTerms();

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
      setStatus(`Sauvegarde copiée (${dbEntries.length} passeport${dbEntries.length > 1 ? 's' : ''}).`);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Échec de la copie.');
    }
  };

  const handleDbImport = (mode: 'merge' | 'replace') => {
    if (!dbImportPaste.trim()) {
      Alert.alert('Vide', 'Collez une sauvegarde JSON avant d\'importer.');
      return;
    }
    const verb = mode === 'replace' ? 'Remplacer' : 'Fusionner';
    const warning =
      mode === 'replace'
        ? 'Tous les passeports actuellement enregistrés seront supprimés et remplacés par ceux du fichier.'
        : 'Les passeports déjà présents seront conservés (jamais écrasés). Seuls les nouveaux passeports seront ajoutés.';
    Alert.alert(
      `${verb} la base ?`,
      warning,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: verb,
          style: mode === 'replace' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              const r = await importPassportDb(dbImportPaste, mode);
              setDbImportPaste('');
              await refreshDb();
              setStatus(`Import ${mode === 'replace' ? '(remplacement)' : '(fusion)'} : ${r.added} ajouté${r.added > 1 ? 's' : ''}, ${r.skipped} ignoré${r.skipped > 1 ? 's' : ''}.`);
            } catch (e: any) {
              Alert.alert('Format invalide', e?.message ?? 'Impossible de lire la sauvegarde.');
            }
          },
        },
      ],
    );
  };

  const handleDbWipe = () => {
    Alert.alert(
      'Effacer la base de passeports ?',
      'Toutes les associations (passeport → clé BJJ) seront supprimées. Cela ne supprime pas la clé "active" actuelle. Faites une sauvegarde au préalable si nécessaire.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer',
          style: 'destructive',
          onPress: async () => {
            await wipePassportDb();
            await refreshDb();
            setStatus('Base de passeports effacée.');
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
      'Tout supprimer ?',
      "Cette action va effacer :\n\n" +
      "  • La clé privée BJJ actuelle\n" +
      "  • Toutes les associations passeport → clé\n" +
      "  • L'acceptation des CGU (vous devrez les ré-accepter au redémarrage)\n\n" +
      "Toute identité déjà enregistrée sur la blockchain avec ces clés ne pourra plus être utilisée depuis cette application — assurez-vous d'avoir exporté la base de passeports si vous voulez la conserver.\n\n" +
      "Cette action est irréversible. Continuer ?",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Tout supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePrivateKey();
              await wipePassportDb();
              await clearTerms();
              await refreshDb();
              setStatus("Données effacées. Redémarrez l'application — vous devrez ré-accepter les CGU.");
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? "Échec de l'effacement.");
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
          Base de passeports ({dbEntries.length})
        </Text>
        <Text style={styles.helpText}>
          {"Chaque passeport scanné est associé à une clé BJJ distincte (clé unique par passeport). " +
           "Sauvegardez la base avant de désinstaller l'application — sans elle, vos identités " +
           "on-chain seront inaccessibles."}
        </Text>

        {dbEntries.length > 0 && (
          <View style={[styles.keyBox, { gap: 6 }]}>
            {dbEntries.map((e) => (
              <Text key={e.passportHash} style={styles.keyText} numberOfLines={1}>
                {(e.label ?? '—') + '  ·  '}
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
            <Text style={styles.buttonText}>Exporter (JSON)</Text>
          </Pressable>
          <Pressable
            style={[styles.button, dbEntries.length === 0 && styles.buttonDisabled]}
            onPress={handleDbWipe}
            disabled={dbEntries.length === 0}
          >
            <Text style={styles.buttonText}>Effacer</Text>
          </Pressable>
        </View>

        <Text style={[styles.helpText, { marginTop: 14 }]}>
          {"Restaurer une sauvegarde : collez ci-dessous le JSON exporté précédemment."}
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
            <Text style={styles.buttonText}>Fusionner</Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={() => handleDbImport('replace')}>
            <Text style={styles.dangerButtonText}>Remplacer tout</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tout supprimer</Text>
        <Text style={styles.helpText}>
          {"⚠️ Efface la clé privée BJJ, la base de passeports et l'acceptation des CGU. " +
           "L'application redémarrera comme une installation neuve : vous devrez ré-accepter " +
           "les CGU et rescanner votre passeport. Les identités déjà enregistrées on-chain " +
           "avec les clés effacées ne pourront plus être utilisées depuis cette application — " +
           "exportez la base de passeports d'abord si vous voulez la conserver. " +
           "Action irréversible."}
        </Text>
        <Pressable style={styles.dangerButton} onPress={handleWipeAll}>
          <Text style={styles.dangerButtonText}>Tout supprimer</Text>
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
