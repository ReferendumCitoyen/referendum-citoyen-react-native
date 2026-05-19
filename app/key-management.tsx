/**
 * Advanced dev-only screen for backing up and restoring the BJJ private key
 * stored in SecureStore.
 *
 * Why it exists
 * -------------
 * On Rarimo Mainnet, a French passport (TD3, no DG15 / no Active
 * Authentication) is permanently bound to whichever BJJ key was used at
 * registration time — there's no chip-level way to prove fresh ownership for
 * the on-chain `revoke()` call, so re-registering with a new key always
 * fails. To complete an end-to-end vote test against an already-registered
 * passport, the operator has to restore the original key into SecureStore.
 *
 * The screen is gated behind the existing dev-mode toggle (7 taps on the
 * version row); ordinary users should never see this screen, and the route
 * is intentionally not deep-linked from anywhere except Settings.
 *
 * After a key change, the live `Rarime` / `FreedomTool` instances that were
 * constructed with the old key (in `app/voting-flow.tsx`) are stale. The
 * cleanest reset is a manual force-stop + relaunch — we surface that
 * instruction in an Alert at the end of the restore flow.
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
import { useTranslation } from 'react-i18next';
import { useColors, Typography, Spacing } from '@/constants/theme';
import {
  readPrivateKey,
  setPrivateKey,
  deletePrivateKey,
  exportToJson as exportPassportDb,
  importFromJson as importPassportDb,
  getAllEntries as getAllPassportDbEntries,
  wipeDb as wipePassportDb,
  type PassportKeyEntry,
} from '@/utils/identity';

export default function KeyManagementScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = createStyles(colors);

  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dbEntries, setDbEntries] = useState<PassportKeyEntry[]>([]);
  const [dbImportPaste, setDbImportPaste] = useState('');

  // Read the current key on mount. We do this even when the user hasn't yet
  // tapped "Show key" so the "Copy" / "Restore" buttons can react to whether
  // a key exists at all (fresh install = no key yet).
  useEffect(() => {
    let cancelled = false;
    readPrivateKey().then((k) => {
      if (!cancelled) setCurrentKey(k);
    });
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

  const handleCopy = async () => {
    if (!currentKey) return;
    await Clipboard.setStringAsync(currentKey);
    setStatus('Clé copiée dans le presse-papiers');
  };

  const handleReveal = () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    // Confirm before showing the raw key on-screen. A bystander shouldn't be
    // able to lift the key by walking past while the screen is open.
    Alert.alert(
      'Afficher la clé privée ?',
      'Toute personne ayant accès à cette clé peut voter à votre place. ' +
      'Ne la partagez avec personne et ne l\'enregistrez que dans un gestionnaire de mots de passe.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Afficher', style: 'destructive', onPress: () => setRevealed(true) },
      ],
    );
  };

  const handleRestore = () => {
    // Validate format before showing the confirmation dialog so the user
    // doesn't tap through "Yes I want to overwrite" only to discover the
    // pasted value was unusable.
    const cleaned = pasteValue.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(cleaned)) {
      Alert.alert(
        'Format invalide',
        `Une clé BJJ est une chaîne de 64 caractères hexadécimaux (0–9, a–f). ` +
        `Reçu : ${cleaned.length} caractère${cleaned.length === 1 ? '' : 's'}.`,
      );
      return;
    }
    Alert.alert(
      'Remplacer la clé actuelle ?',
      'La clé en cours sera écrasée et perdue. Toute identité enregistrée ' +
      'sur la blockchain avec l\'ancienne clé ne pourra plus être contrôlée ' +
      'depuis cette application sans la sauvegarde correspondante.\n\n' +
      'Après le remplacement, fermez l\'application complètement (menu ' +
      'récents → balayer) puis rouvrez-la pour que le changement prenne effet.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Remplacer',
          style: 'destructive',
          onPress: async () => {
            try {
              await setPrivateKey(cleaned);
              setCurrentKey(cleaned);
              setRevealed(false);
              setPasteValue('');
              setStatus(
                'Clé remplacée. Fermez et rouvrez l\'application pour prendre en compte le changement.',
              );
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? 'Échec du remplacement de la clé.');
            }
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Supprimer la clé ?',
      'Une nouvelle clé sera générée au prochain démarrage. Toute identité ' +
      'enregistrée sur la blockchain avec la clé actuelle ne pourra plus être ' +
      'utilisée depuis cette application.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deletePrivateKey();
            setCurrentKey(null);
            setRevealed(false);
            setStatus('Clé supprimée. Redémarrez l\'application pour générer une nouvelle clé.');
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Clé actuelle</Text>
        <Text style={styles.helpText}>
          {"Identité Baby Jubjub enregistrée dans le stockage sécurisé de l'appareil. " +
           "Sauvegardez cette clé : elle est la SEULE preuve de votre identité on-chain."}
        </Text>

        <View style={styles.keyBox}>
          {currentKey ? (
            revealed ? (
              <Text style={styles.keyText} selectable>{currentKey}</Text>
            ) : (
              <Text style={styles.keyTextMasked}>
                {'•'.repeat(64)}
              </Text>
            )
          ) : (
            <Text style={styles.keyTextMasked}>(aucune clé — sera générée au prochain démarrage)</Text>
          )}
        </View>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, !currentKey && styles.buttonDisabled]}
            onPress={handleReveal}
            disabled={!currentKey}
          >
            <Text style={styles.buttonText}>
              {revealed ? 'Masquer' : 'Afficher'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.button, !currentKey && styles.buttonDisabled]}
            onPress={handleCopy}
            disabled={!currentKey}
          >
            <Text style={styles.buttonText}>Copier</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Restaurer une clé</Text>
        <Text style={styles.helpText}>
          Collez une clé BJJ existante (64 caractères hexadécimaux) pour
          remplacer la clé actuelle. Utile pour réutiliser une identité déjà
          enregistrée on-chain avec un autre appareil ou une autre application.
        </Text>

        <TextInput
          style={styles.input}
          value={pasteValue}
          onChangeText={setPasteValue}
          placeholder="0x… ou 64 caractères hex"
          placeholderTextColor={colors.text + '60'}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          multiline
        />

        <Pressable style={styles.dangerButton} onPress={handleRestore}>
          <Text style={styles.dangerButtonText}>Remplacer la clé</Text>
        </Pressable>
      </View>

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
        <Text style={styles.sectionTitle}>Supprimer la clé</Text>
        <Text style={styles.helpText}>
          {"Efface la clé actuelle. Une nouvelle sera générée au prochain démarrage de l'application."}
        </Text>
        <Pressable style={styles.dangerButton} onPress={handleDelete}>
          <Text style={styles.dangerButtonText}>Supprimer définitivement</Text>
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
