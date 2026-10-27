'use client'

import { useSyncExternalStore } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Reads a media query through `useSyncExternalStore` rather than an effect.
 *
 * The signal lives outside React and can change without React knowing, which is
 * exactly what this hook is for. It also means the first client render agrees
 * with the server render: the server snapshot is `false`, and the store takes
 * over from there.
 */
function subscribe(onStoreChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', onStoreChange)
  return () => media.removeEventListener('change', onStoreChange)
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * Whether the user has asked their system to reduce motion.
 *
 * Needed for anything animated through an **inline style**: a stylesheet media
 * query cannot reach those, and an inline style beats every stylesheet rule
 * short of `!important`. The view cube animates its own rotation that way, so it
 * has to ask here instead.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
