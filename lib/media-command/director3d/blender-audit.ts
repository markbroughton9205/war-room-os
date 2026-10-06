import { execFileSync } from 'node:child_process'

export type BlenderAudit = {
  status: 'AVAILABLE' | 'NOT_INSTALLED' | 'PARTIAL'
  binary: string | null
  version: string | null
  pythonApi: string | null
  gpuVisible: boolean | null
  headless: boolean | null
  notes: string
}

export function auditBlender(): BlenderAudit {
  const candidates = ['blender', '/usr/bin/blender', '/snap/bin/blender']
  for (const binary of candidates) {
    try {
      const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 4000 })
      const version = out.split('\n')[0]?.trim() ?? null
      return {
        status: 'AVAILABLE',
        binary,
        version,
        pythonApi: 'bpy (not invoked in Slice 1)',
        gpuVisible: null,
        headless: /blender/i.test(out),
        notes: 'Blender is present. HVS scene truth remains Hvs3DScene. Blender is an optional execution backend only.',
      }
    } catch {
      /* try next */
    }
  }
  return {
    status: 'NOT_INSTALLED',
    binary: null,
    version: null,
    pythonApi: null,
    gpuVisible: null,
    headless: null,
    notes: 'BLENDER_NOT_INSTALLED. Three.js foundation continues. Do not install automatically.',
  }
}

/**
 * Optional future adapter. Does not write .blend as canonical truth.
 * Hvs3DScene → temp .blend → artifacts → AssetRecord.
 */
export type HvsBlenderAdapter = {
  convertScene: 'planned'
  importAssets: 'planned'
  cameras: 'planned'
  lights: 'planned'
  keyframes: 'planned'
  renderInvocation: 'planned'
  artifactCollection: 'planned'
  canonicalTruth: 'Hvs3DScene'
}

export const HVS_BLENDER_ADAPTER: HvsBlenderAdapter = {
  convertScene: 'planned',
  importAssets: 'planned',
  cameras: 'planned',
  lights: 'planned',
  keyframes: 'planned',
  renderInvocation: 'planned',
  artifactCollection: 'planned',
  canonicalTruth: 'Hvs3DScene',
}

export const HVS_GODOT_STATUS = 'DEFERRED' as const
