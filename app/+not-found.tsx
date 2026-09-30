import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

export default function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: t('navigation.oops') }} />
      <View style={styles.container}>
        <Text style={styles.title}>{t('notFound.title')}</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>{t('notFound.goHome')}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: Colors.white,
  },
  title: {
    fontSize: Typography.fontSize.h1,
    fontWeight: Typography.fontWeight.bold,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.primary,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: Typography.fontSize.body,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.secondary,
  },
});
