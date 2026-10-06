import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Hdf5Dataset = { shape?: number[]; dtype?: string; value?: ArrayLike<number> }
type Hdf5File = { keys: string[]; get: (name: string) => Hdf5Dataset }

type JsfiveModule = { File: new (buffer: ArrayBuffer) => Hdf5File }

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function numbers(dataset: Hdf5Dataset | null): number[] {
  if (!dataset?.value) return []
  return Array.from(dataset.value as ArrayLike<number>, value => Number(value)).filter(Number.isFinite)
}

export function parseGlmLcfaFlashes(buffer: Buffer): { lat: number; lon: number; energy: number }[] {
  const jsfive = require('jsfive') as JsfiveModule
  const file = new jsfive.File(asArrayBuffer(buffer))
  const lat = numbers(file.get('flash_lat'))
  const lon = numbers(file.get('flash_lon'))
  const energy = numbers(file.get('flash_energy'))
  const count = Math.min(lat.length, lon.length)
  const flashes: { lat: number; lon: number; energy: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const latitude = lat[i]!
    const longitude = lon[i]!
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue
    flashes.push({ lat: latitude, lon: longitude, energy: Math.abs(energy[i] ?? 1) })
  }
  return flashes
}
