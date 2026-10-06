import { WAR_ROOM_BROWSER_IPC, type WarRoomBrowserBounds, type WarRoomBrowserState } from './types'

type DesktopInvoke = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on?(channel: string, callback: (...args: unknown[]) => void): () => void
}

function desktop(): DesktopInvoke | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { warRoomDesktop?: DesktopInvoke }).warRoomDesktop
  return candidate ?? null
}

export function isWarRoomDesktopShell(): boolean {
  return Boolean(desktop())
}

export async function desktopBrowserOpen(url: string): Promise<WarRoomBrowserState | null> {
  const bridge = desktop()
  if (!bridge) return null
  return (await bridge.invoke(WAR_ROOM_BROWSER_IPC.open, { url })) as WarRoomBrowserState
}

export async function desktopBrowserNavigate(url: string, tabId?: string): Promise<WarRoomBrowserState | null> {
  const bridge = desktop()
  if (!bridge) return null
  return (await bridge.invoke(WAR_ROOM_BROWSER_IPC.navigate, { url, tabId })) as WarRoomBrowserState
}

export async function desktopBrowserCommand(
  channel: string,
  payload: Record<string, unknown> = {},
): Promise<WarRoomBrowserState | null> {
  const bridge = desktop()
  if (!bridge) return null
  return (await bridge.invoke(channel, payload)) as WarRoomBrowserState
}

export async function desktopBrowserSetBounds(bounds: WarRoomBrowserBounds): Promise<void> {
  const bridge = desktop()
  if (!bridge) return
  await bridge.invoke(WAR_ROOM_BROWSER_IPC.setBounds, bounds)
}

export function subscribeDesktopBrowserState(callback: (state: WarRoomBrowserState) => void): () => void {
  const bridge = desktop()
  if (!bridge?.on) return () => undefined
  return bridge.on(WAR_ROOM_BROWSER_IPC.stateEvent, (...args: unknown[]) => {
    const state = args[0] as WarRoomBrowserState
    if (state) callback(state)
  })
}
