/**
 * QA gallery, vote-flow states: the same view as app/qa-gallery.tsx, on a
 * route presented exactly like app/voting-flow.tsx (iOS modal sheet with the
 * native header, Android card without one; see app/_layout.tsx).
 *
 * Dev and beta builds only; the store app redirects to the home.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { qaAllowed } from '@/utils/qa-overrides';
import { GalleryView } from '@/qa/GalleryView';

export default function QaGalleryFlowScreen() {
  if (!qaAllowed()) return <Redirect href="/" />;
  return <GalleryView presentation="flow" />;
}
