'use client'

/** Loads Cesium's prebuilt global bundle without passing it through Turbopack's minifier. */
type CesiumNamespace = typeof import('cesium')

declare global {
  interface Window {
    Cesium?: CesiumNamespace
    CESIUM_BASE_URL?: string
  }
}

const CESIUM_SCRIPT_SRC = '/cesium/Cesium.js'
const CESIUM_BASE_URL = '/cesium/'
let cesiumLoadPromise: Promise<CesiumNamespace> | null = null

function attachToExistingScript(script: HTMLScriptElement): Promise<CesiumNamespace> {
  return new Promise((resolve, reject) => {
    script.addEventListener('load', () => {
      if (window.Cesium) resolve(window.Cesium)
      else reject(new Error('Cesium script tag loaded but window.Cesium is not defined.'))
    })
    script.addEventListener('error', () => reject(new Error(`Failed to load Cesium from ${CESIUM_SCRIPT_SRC}.`)))
  })
}

function injectCesiumScript(): Promise<CesiumNamespace> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CESIUM_SCRIPT_SRC
    script.async = true
    script.addEventListener('load', () => {
      if (window.Cesium) resolve(window.Cesium)
      else reject(new Error('Cesium script tag loaded but window.Cesium is not defined.'))
    })
    script.addEventListener('error', () => reject(new Error(`Failed to load Cesium from ${CESIUM_SCRIPT_SRC}. Check that public/cesium/Cesium.js exists (see scripts/copy-cesium-assets.mjs).`)))
    document.head.appendChild(script)
  })
}

export function loadCesium(): Promise<CesiumNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('loadCesium() can only be called in the browser.'))
  }
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (cesiumLoadPromise) return cesiumLoadPromise

  window.CESIUM_BASE_URL = CESIUM_BASE_URL
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${CESIUM_SCRIPT_SRC}"]`)
  const promise = existing ? attachToExistingScript(existing) : injectCesiumScript()
  cesiumLoadPromise = promise.catch(error => {
    cesiumLoadPromise = null
    throw error
  })
  return cesiumLoadPromise
}
