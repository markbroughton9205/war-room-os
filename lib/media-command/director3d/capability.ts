export type Hvs3DRendererKind = 'webgl' | 'webgpu' | 'unavailable'

export type Hvs3DViewportCapability = {
  renderer: Hvs3DRendererKind
  webgpuSupported: boolean
  webglSupported: boolean
  notes: string
}

export function probe3DViewportCapability(gpu: { requestAdapter?: unknown } | null | undefined, webgl: boolean): Hvs3DViewportCapability {
  const webgpuSupported = Boolean(gpu?.requestAdapter)
  const webglSupported = webgl
  if (webglSupported) {
    return {
      renderer: 'webgl',
      webgpuSupported,
      webglSupported,
      notes: webgpuSupported
        ? 'WebGPU is present. Slice 1 previs uses WebGL. WebGPU remains a capability, not a requirement.'
        : 'WebGL viewport. WebGPU not available in this browser.',
    }
  }
  if (webgpuSupported) {
    return {
      renderer: 'webgpu',
      webgpuSupported,
      webglSupported,
      notes: 'WebGL unavailable. WebGPU capability recorded; Slice 1 still prefers a WebGL fallback when possible.',
    }
  }
  return {
    renderer: 'unavailable',
    webgpuSupported: false,
    webglSupported: false,
    notes: 'No browser 3D renderer available.',
  }
}
