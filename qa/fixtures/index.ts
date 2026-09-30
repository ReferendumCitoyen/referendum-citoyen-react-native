/**
 * Every state of the QA gallery, in inventory order.
 */
import { FLOW_STATES } from './states-flow';
import { STEP6_STATES } from './states-step6';
import { STEP7_STATES } from './states-step7';
import { STEP12_SUCCESS_STATES, STEP13_STATES } from './states-step12';
import { ALERT_STATES, HOME_STATES, SCREEN_STATES } from './states-screens';
import STATUS from './status.generated.json';
import type { ChangeStatus, GalleryState } from './types';

const ORDERED: GalleryState[] = [
  ...FLOW_STATES.slice(0, 8), // doc choice, steps 1, 2, 4, 5
  ...STEP6_STATES,
  ...STEP7_STATES,
  ...FLOW_STATES.slice(8), // steps 8 to 11
  ...STEP12_SUCCESS_STATES,
  ...STEP13_STATES,
  ...HOME_STATES,
  ...ALERT_STATES,
  ...SCREEN_STATES,
];

export const GALLERY_STATES: readonly GalleryState[] = ORDERED;

export function findState(id: string | undefined): GalleryState | undefined {
  return id ? ORDERED.find((s) => s.id === id) : undefined;
}

/** NEW / CHANGED / unchanged status of each state. */
export function statusOf(state: GalleryState): ChangeStatus {
  return state.status ?? ((STATUS as Record<string, ChangeStatus>)[state.id] ?? 'unchanged');
}

export type { GalleryState, GalleryCtx, ExpectedButton, ChangeStatus } from './types';
