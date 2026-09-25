/**
 * Hardened preload — minimal allowlisted bridge.
 */
const { contextBridge, ipcRenderer } = require('electron')

const ALLOW = new Set([
  'sovereign.getRuntimeTruth',
  'sovereign.getHealth',
  'sovereign.getBootState',
  'sovereign.openExternalSafe',
  'terra.nativeLocation.getFix',
  'warRoom.browser.open',
  'warRoom.browser.navigate',
  'warRoom.browser.back',
  'warRoom.browser.forward',
  'warRoom.browser.reload',
  'warRoom.browser.stop',
  'warRoom.browser.closeTab',
  'warRoom.browser.close',
  'warRoom.browser.setBounds',
  'warRoom.browser.getState',
  'warRoomBrowser.open',
  'warRoomBrowser.navigate',
  'warRoomBrowser.back',
  'warRoomBrowser.forward',
  'warRoomBrowser.reload',
  'warRoomBrowser.stop',
  'warRoomBrowser.hide',
  'foundry.workbench.ensure',
  'foundry.workbench.setBounds',
  'foundry.workbench.hide',
  'foundry.workbench.getState',
  'foundry.workbench.stop',
  'foundry.workbench.returnFocus',
  'foundry.workbench.recover',
])

const ALLOW_EVENTS = new Set([
  'warRoom.browser.state',
])

contextBridge.exposeInMainWorld('warRoomDesktop', {
  invoke(channel, ...args) {
    if (!ALLOW.has(channel)) {
      return Promise.reject(new Error('IPC channel denied'))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, callback) {
    if (!ALLOW_EVENTS.has(channel) || typeof callback !== 'function') {
      return () => undefined
    }
    const listener = (_event, ...payload) => callback(...payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
