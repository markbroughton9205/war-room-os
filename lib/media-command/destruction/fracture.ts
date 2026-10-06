import { auditBlender } from '../director3d/blender-audit'
import type { HvsFractureSpec, HvsMaterialId, HvsSupportClass, Vec3 } from './types'
import { INTERNAL_FRACTURE_ID, INTERNAL_FRACTURE_VERSION } from './types'

export type FracturePiece = {
  id: string
  column: number
  row: number | null
  size: Vec3
  position: Vec3
  supportClass: HvsSupportClass
  materialId: HvsMaterialId
}

export type FractureArtifact = {
  backend: string
  backendVersion: string
  method: HvsFractureSpec['method']
  seed: number
  pieces: FracturePiece[]
  sourcePath: string
  preFractureOnly: true
  runtimeFracture: false
}

export type HvsFractureBackend = {
  id: string
  isAvailable: () => boolean
  describe: () => { id: string; status: 'AVAILABLE' | 'NOT_INSTALLED' | 'NOT_USABLE'; version: string | null; integrationMode: string }
  prepareAsset: (sourcePath: string) => { ok: true; path: string }
  fracture: (input: { spec: HvsFractureSpec; sourcePath: string; holdRightSupport: boolean }) => FractureArtifact
  collectArtifacts: (artifact: FractureArtifact) => string[]
}

export const WALL_SPEC = {
  width: 6,
  height: 3,
  thickness: 0.22,
  columns: 10,
  rows: 6,
} as const

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function fractureInternalPrimitive(input: {
  spec: HvsFractureSpec
  sourcePath: string
  holdRightSupport: boolean
}): FractureArtifact {
  const { width, height, thickness, columns, rows } = WALL_SPEC
  const cellW = width / columns
  const cellH = height / rows
  const rand = mulberry32(input.spec.seed || 1)
  const jitter = input.spec.method === 'VORONOI' ? 0.08 : input.spec.method === 'GUIDED' ? 0.04 : 0
  const pieces: FracturePiece[] = []
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const jx = jitter ? (rand() - 0.5) * cellW * jitter : 0
      const jy = jitter ? (rand() - 0.5) * cellH * jitter : 0
      const supportClass: HvsSupportClass = column <= 1
        ? 'LEFT_SUPPORT'
        : column >= columns - 2 && input.holdRightSupport
          ? 'RIGHT_SUPPORT'
          : 'INTERIOR'
      pieces.push({
        id: `chunk-c${column}-r${row}`,
        column,
        row,
        size: { x: cellW * (1 - jitter * 0.5), y: cellH * (1 - jitter * 0.5), z: thickness },
        position: {
          x: -width / 2 + (column + 0.5) * cellW + jx,
          y: (row + 0.5) * cellH + jy,
          z: 0,
        },
        supportClass,
        materialId: input.spec.materialId,
      })
    }
  }
  if (pieces.length > 150) {
    throw new Error('Small-tier fracture exceeded 150 chunks.')
  }
  return {
    backend: INTERNAL_FRACTURE_ID,
    backendVersion: INTERNAL_FRACTURE_VERSION,
    method: input.spec.method,
    seed: input.spec.seed,
    pieces,
    sourcePath: input.sourcePath,
    preFractureOnly: true,
    runtimeFracture: false,
  }
}

export const internalPrimitiveFractureBackend: HvsFractureBackend = {
  id: INTERNAL_FRACTURE_ID,
  isAvailable: () => true,
  describe: () => ({
    id: INTERNAL_FRACTURE_ID,
    status: 'AVAILABLE',
    version: INTERNAL_FRACTURE_VERSION,
    integrationMode: 'NATIVE',
  }),
  prepareAsset: sourcePath => ({ ok: true, path: sourcePath }),
  fracture: fractureInternalPrimitive,
  collectArtifacts: artifact => [artifact.sourcePath],
}

export function blenderFractureScript(spec: HvsFractureSpec): string {
  return [
    'import bpy',
    'bpy.ops.wm.read_factory_settings(use_empty=True)',
    `print("HVS_FRACTURE_SEED ${spec.seed}")`,
    'print("HVS_FRACTURE_BACKEND BLENDER_SUBPROCESS")',
  ].join('\n')
}

export const blenderFractureBackend: HvsFractureBackend = {
  id: 'BLENDER_SUBPROCESS',
  isAvailable: () => auditBlender().status === 'AVAILABLE',
  describe: () => {
    const audit = auditBlender()
    return {
      id: 'BLENDER_SUBPROCESS',
      status: audit.status === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_INSTALLED',
      version: audit.version,
      integrationMode: 'SUBPROCESS_CLI',
    }
  },
  prepareAsset: sourcePath => ({ ok: true, path: sourcePath }),
  fracture: () => {
    const audit = auditBlender()
    if (audit.status !== 'AVAILABLE' || !audit.binary) {
      throw new Error('BLENDER_NOT_INSTALLED')
    }
    throw new Error('BACKEND_INSTALL_APPROVAL_REQUIRED')
  },
  collectArtifacts: () => [],
}

export function selectFractureBackend(): HvsFractureBackend {
  return internalPrimitiveFractureBackend
}
