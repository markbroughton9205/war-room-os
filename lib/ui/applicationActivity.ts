'use client'

import { useSyncExternalStore } from 'react'

export type ApplicationActivityMode = 'HOME_ACTIVE' | 'TERRA_ACTIVE' | 'FOUNDRY_ACTIVE' | 'BACKGROUND_IDLE'

export type ApplicationActivitySnapshot = {
  mode: ApplicationActivityMode
  pathname: string
  visible: boolean
  focused: boolean
  animationFps: number
  pollingMultiplier: number
}

const listeners = new Set<() => void>()
const SERVER_SNAPSHOT: ApplicationActivitySnapshot = {
  mode: 'BACKGROUND_IDLE',
  pathname: '',
  visible: false,
  focused: false,
  animationFps: 0,
  pollingMultiplier: 4,
}
let snapshot = SERVER_SNAPSHOT

function modeForPath(pathname: string, visible: boolean): ApplicationActivityMode {
  if (!visible) return 'BACKGROUND_IDLE'
  if (pathname === '/terra' || pathname.startsWith('/terra/')) return 'TERRA_ACTIVE'
  if (
    pathname === '/builder'
    || pathname.startsWith('/builder/')
    || pathname.startsWith('/war-room/engineering')
    || pathname.startsWith('/war-room/code-operator')
    || pathname.startsWith('/native-builder')
  ) return 'FOUNDRY_ACTIVE'
  if (pathname === '/' || pathname === '/war-room') return 'HOME_ACTIVE'
  return 'BACKGROUND_IDLE'
}

export function deriveApplicationActivity(pathname: string, visible: boolean, focused: boolean): ApplicationActivitySnapshot {
  const mode = modeForPath(pathname, visible)
  const animationFps = !visible ? 0 : !focused ? 4 : mode === 'HOME_ACTIVE' ? 15 : 30
  const pollingMultiplier = !visible ? 4 : !focused ? 2 : 1
  return { mode, pathname, visible, focused, animationFps, pollingMultiplier }
}

function publish(next: ApplicationActivitySnapshot): void {
  if (
    next.mode === snapshot.mode
    && next.pathname === snapshot.pathname
    && next.visible === snapshot.visible
    && next.focused === snapshot.focused
    && next.animationFps === snapshot.animationFps
    && next.pollingMultiplier === snapshot.pollingMultiplier
  ) return
  snapshot = next
  if (typeof window !== 'undefined') {
    ;(window as Window & { __warRoomActivity?: ApplicationActivitySnapshot }).__warRoomActivity = snapshot
  }
  for (const listener of listeners) listener()
}

export function updateApplicationActivity(pathname: string): void {
  if (typeof document === 'undefined') return
  publish(deriveApplicationActivity(pathname, document.visibilityState === 'visible', document.hasFocus()))
}

export function getApplicationActivitySnapshot(): ApplicationActivitySnapshot {
  return snapshot
}

export function getApplicationActivityServerSnapshot(): ApplicationActivitySnapshot {
  return SERVER_SNAPSHOT
}

export function subscribeApplicationActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useApplicationActivity(): ApplicationActivitySnapshot {
  return useSyncExternalStore(
    subscribeApplicationActivity,
    getApplicationActivitySnapshot,
    getApplicationActivityServerSnapshot,
  )
}
