/**
 * Hardened preload — minimal allowlisted bridge.
 */
const { contextBridge, ipcRenderer } = require('electron')

const ALLOW = new Set([
  'sovereign.getRuntimeTruth',
  'sovereign.getHealth',
  'sovereign.getBootState',
  'sovereign.openExternalSafe',
])

contextBridge.exposeInMainWorld('warRoomDesktop', {
  invoke(channel, ...args) {
    if (!ALLOW.has(channel)) {
      return Promise.reject(new Error('IPC channel denied'))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
})
