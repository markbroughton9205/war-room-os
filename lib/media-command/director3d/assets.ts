import type { AssetRecord } from '../types'

/** Slice 1: GLB/GLTF. FBX/OBJ/USD later. Assets remain HVS AssetRecords. */
export const HVS_3D_MODEL_FORMATS = ['glb', 'gltf'] as const
export type Hvs3DModelFormat = (typeof HVS_3D_MODEL_FORMATS)[number]

export const HVS_3D_FUTURE_FORMATS = ['fbx', 'obj', 'usd', 'usdz'] as const

export function isHvs3DModelAsset(asset: Pick<AssetRecord, 'mimeType' | 'name' | 'originalPath'>): boolean {
  const mime = (asset.mimeType ?? '').toLowerCase()
  const name = `${asset.name} ${asset.originalPath}`.toLowerCase()
  return (
    mime === 'model/gltf-binary'
    || mime === 'model/gltf+json'
    || mime === 'model/gltf'
    || /\.glb(\b|$)/.test(name)
    || /\.gltf(\b|$)/.test(name)
  )
}

export function detect3DModelFormat(asset: Pick<AssetRecord, 'mimeType' | 'name' | 'originalPath'>): Hvs3DModelFormat | null {
  const name = `${asset.name} ${asset.originalPath}`.toLowerCase()
  if (/\.glb(\b|$)/.test(name) || asset.mimeType === 'model/gltf-binary') return 'glb'
  if (/\.gltf(\b|$)/.test(name) || /model\/gltf/.test(asset.mimeType ?? '')) return 'gltf'
  return null
}
