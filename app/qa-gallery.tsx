/**
 * QA gallery (dev and beta builds only): every user-visible state of 2.0.2,
 * rendered with fixtures.
 *
 * Deep link: <scheme>://qa-gallery?state=<id>[&lang=en][&overlay=min]
 * The store app redirects to the home: no fixture is ever rendered there, and
 * no menu links here.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { qaAllowed } from '@/utils/qa-overrides';
import { GalleryView } from '@/qa/GalleryView';

export default function QaGalleryScreen() {
  if (!qaAllowed()) return <Redirect href="/" />;
  return <GalleryView presentation="card" />;
}
