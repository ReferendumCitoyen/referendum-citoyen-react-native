/**
 * The QA gallery: the list of every inventory state, and one state rendered
 * full screen with a small overlay (back to the list, FR/EN).
 *
 * Mounted by two routes: app/qa-gallery.tsx (card presentation, list and
 * full-screen states) and app/qa-gallery-flow.tsx (presented like the voting
 * flow: an iOS modal sheet with the native header), because the sheet's
 * height is what decides whether a vote-flow button fits on an iPhone.
 *
 * Dev and beta builds only: the routes redirect to the home otherwise, and no
 * menu links here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from 'i18next';
import { useColors } from '@/constants/theme';
import { GALLERY_STATES, findState, statusOf } from './fixtures';
import type { GalleryCtx, GalleryState } from './fixtures/types';
import { ACTION_PREFIX, recordAction, resetActions, subscribeActions, type RecordedAction } from './fixtures/recorder';

type Params = { state?: string; lang?: string; overlay?: string };

export const FLOW_ROUTE = '/qa-gallery-flow';
export const LIST_ROUTE = '/qa-gallery';

/** The route a state is shown on. */
export function routeFor(state: GalleryState): string {
  return state.frame === 'flow' ? FLOW_ROUTE : LIST_ROUTE;
}

export function GalleryView({ presentation }: { presentation: 'card' | 'flow' }) {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const state = findState(params.state);

  // lang=en|fr from the deep link, applied once per link.
  useEffect(() => {
    if (params.lang === 'en' || params.lang === 'fr') void i18n.changeLanguage(params.lang);
  }, [params.lang]);

  // A flow state opened on the card route (the documented deep link
  // referendumcitoyen[beta]://qa-gallery?state=…) moves to the flow route.
  const wrongRoute = !!state && presentation === 'card' && state.frame === 'flow';
  useEffect(() => {
    if (!wrongRoute) return;
    router.replace({ pathname: FLOW_ROUTE as never, params: params as never });
  }, [wrongRoute, router, params]);
  if (wrongRoute) return null;

  if (!state) return <StateList />;
  return <StateScreen key={state.id} state={state} overlay={params.overlay ?? 'full'} presentation={presentation} />;
}

function StateScreen({ state, overlay, presentation }: { state: GalleryState; overlay: string; presentation: 'card' | 'flow' }) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [, force] = useState(0);
  const [last, setLast] = useState<RecordedAction | null>(null);

  useEffect(() => {
    resetActions();
    return subscribeActions(setLast);
  }, []);

  const ctx: GalleryCtx = useMemo(
    () => ({
      act: (id: string, label?: string) => () => recordAction(id, label),
      width: 0,
    }),
    [],
  );

  const toggleLang = () => {
    void i18n.changeLanguage(i18n.language === 'en' ? 'fr' : 'en').then(() => force((n) => n + 1));
  };
  const backToList = () => {
    if (router.canGoBack()) router.back();
    else router.replace(LIST_ROUTE as never);
  };

  const controls = overlay === 'full' && (
    <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="QA: liste" onPress={backToList} style={styles.pill} testID="qa-back">
        <Text style={styles.pillText}>◀ QA</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="QA: langue" onPress={toggleLang} style={styles.pill} testID="qa-lang">
        <Text style={styles.pillText}>{(i18n.language || 'fr').toUpperCase()}</Text>
      </Pressable>
    </View>
  );

  // On the iOS sheet the controls go in the native header's left slot, where
  // the flow has nothing: the content keeps the exact layout the voter sees.
  const inIosHeader = presentation === 'flow' && Platform.OS === 'ios';

  return (
    <View style={{ flex: 1, backgroundColor: colors.cardBackground }}>
      {inIosHeader && controls ? <Stack.Screen options={{ headerLeft: () => controls }} /> : null}
      {presentation === 'card' ? <Stack.Screen options={{ headerShown: false }} /> : null}
      {state.render ? state.render(ctx) : <NotRendered state={state} />}
      {/* Measurement marker (2026-09-25): says which state is mounted, wherever
          the state's own texts sit. The automation used to wait for a text of
          the state, and on a 360 x 640 screen at font scale 1.3 several of
          those sit below the fold (settings, step 12): the wait failed and the
          state was never measured. Absolute and transparent: it takes no room
          in the layout and changes nothing the voter sees. Below the status
          bar: on Android a node covered by another window (the status bar)
          is dropped from the accessibility tree. */}
      <Text pointerEvents="none" testID={`qa-state-${state.id}`} accessibilityLabel={`qa-state-${state.id}`} style={[styles.marker, { top: insets.top }]}>
        {`qa-state-${state.id}`}
      </Text>
      {!inIosHeader && controls ? (
        <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 4 }]}>
          {controls}
        </View>
      ) : null}
      {last ? (
        <View pointerEvents="none" style={[styles.toast, { top: insets.top + (inIosHeader ? 4 : 40) }]}>
          <Text style={styles.toastText} testID="qa-last-action">
            {ACTION_PREFIX}
            {last.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function NotRendered({ state }: { state: GalleryState }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, padding: 24, paddingTop: insets.top + 56 }}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>{state.id}</Text>
      <Text style={{ color: colors.text, marginBottom: 8 }}>
        {state.runtime === 'dormant'
          ? 'Inaccessible en 2.0.2 (parcours passeport désactivé par CARD_ONLY_LAUNCH).'
          : 'Non rendu dans la galerie : à reproduire à la main sur un téléphone.'}
      </Text>
      <Text style={{ color: colors.text }}>{state.trigger}</Text>
    </View>
  );
}

function StateList() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sections = useMemo(() => {
    const byGroup = new Map<string, GalleryState[]>();
    for (const s of GALLERY_STATES) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
    return [...byGroup.entries()].map(([title, data]) => ({ title, data }));
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={[styles.listTitle, { color: colors.text }]}>
        QA 2.0.2 : {GALLERY_STATES.length} états
      </Text>
      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.text, backgroundColor: colors.background }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const status = statusOf(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.id}
              testID={`qa-row-${item.id}`}
              onPress={() => router.push({ pathname: routeFor(item) as never, params: { state: item.id } as never })}
              style={[styles.row, { backgroundColor: colors.cardBackground }]}
            >
              <View style={{ flex: 1, flexShrink: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                  {item.id}
                </Text>
                <Text style={{ color: colors.text, opacity: 0.6, fontSize: 12 }} numberOfLines={2}>
                  {item.trigger}
                </Text>
              </View>
              <Text style={[styles.badge, status === 'NEW' ? styles.badgeNew : status === 'CHANGED' ? styles.badgeChanged : styles.badgeSame]}>
                {status}
              </Text>
              {item.runtime !== 'gallery' ? <Text style={[styles.badge, styles.badgeSame]}>{item.runtime}</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 4 },
  marker: { position: 'absolute', top: 0, left: 0, fontSize: 6, lineHeight: 6, color: 'transparent' },
  controls: { flexDirection: 'row', gap: 6 },
  pill: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '90%',
  },
  toastText: { color: '#fff', fontSize: 12 },
  listTitle: { fontSize: 20, fontWeight: '700', padding: 16 },
  sectionHeader: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 10 },
  badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  badgeNew: { backgroundColor: '#DCFCE7', color: '#166534' },
  badgeChanged: { backgroundColor: '#FEF3C7', color: '#92400E' },
  badgeSame: { backgroundColor: '#E5E7EB', color: '#374151' },
});
