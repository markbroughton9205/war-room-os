import type { RegisteredExternalApp } from './types'

export const CURSOR_APP_ID = 'cursor'

export const CURSOR_REGISTRATION: RegisteredExternalApp = {
  appId: CURSOR_APP_ID,
  processIdentity: ['/usr/share/cursor/cursor', 'cursor --ozone-platform=wayland'],
  desktopIdentity: ['cursor', 'Cursor', 'Cursor Agents'],
  allowedWindowPatterns: ['/^Cursor\\b/i', '/Cursor Agents/i'],
  supportedBackends: ['accessibility', 'app-electron-debug', 'wayland-portal', 'wayland-atspi-focus', 'wayland-atspi-keysynth', 'vision'],
  supportedActions: [
    'discover',
    'focus',
    'bind_composer',
    'insert_text',
    'submit',
    'observe_generation',
    'read_response',
    'cancel',
  ],
  riskClassification: 'MEDIUM',
  interactionBoundaries: [
    'No generic any-application authority',
    'No War Room Electron CDP attachment',
    'No blind stored coordinates',
    'No credential/payment/deploy/commit/push without Commander approval',
    'No kill/restart of Cursor unless Commander explicitly authorizes one-time debug setup',
    'Read-only acceptance must not mutate files or run shell via Cursor',
  ],
}

const REGISTRY = new Map<string, RegisteredExternalApp>([[CURSOR_APP_ID, CURSOR_REGISTRATION]])

export function getRegisteredApp(appId: string): RegisteredExternalApp | null {
  return REGISTRY.get(appId) ?? null
}

export function listRegisteredApps(): RegisteredExternalApp[] {
  return [...REGISTRY.values()]
}

export function isRegisteredAppId(appId: string): boolean {
  return REGISTRY.has(appId)
}

export function genericDesktopAuthorityGranted(): boolean {
  return false
}
