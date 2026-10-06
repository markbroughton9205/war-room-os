export type WarRoomBrowserSourceContext = {
  mission_id: string | null
  session_id: string | null
  source_id: string
  claim_ids: string[]
  evidence_ids: string[]
  title: string
  verification_status: string | null
  source_authority: string
  freshness_state: string
  rejection_reason: string | null
  supporting: boolean
}

export type WarRoomBrowserTab = {
  id: string
  title: string
  url: string
  loading: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  sourceContext?: WarRoomBrowserSourceContext | null
}

export type WarRoomBrowserState = {
  open: boolean
  activeTabId: string | null
  tabs: WarRoomBrowserTab[]
}

export type WarRoomBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export const WAR_ROOM_BROWSER_IPC = {
  open: 'warRoom.browser.open',
  navigate: 'warRoom.browser.navigate',
  back: 'warRoom.browser.back',
  forward: 'warRoom.browser.forward',
  reload: 'warRoom.browser.reload',
  stop: 'warRoom.browser.stop',
  closeTab: 'warRoom.browser.closeTab',
  close: 'warRoom.browser.close',
  setBounds: 'warRoom.browser.setBounds',
  getState: 'warRoom.browser.getState',
  stateEvent: 'warRoom.browser.state',
} as const

export const EMPTY_WAR_ROOM_BROWSER_STATE: WarRoomBrowserState = {
  open: false,
  activeTabId: null,
  tabs: [],
}
