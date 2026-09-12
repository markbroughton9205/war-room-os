/**
 * Header-only safetensors inspection. Never unpickles. Never executes tensors.
 */
import fs from 'node:fs'
import { sha256File } from '@/lib/wr-corpus/hashes'

export type SafetensorsTensor = {
  name: string
  dtype: string
  shape: number[]
  dataOffsets: [number, number]
}

export type SafetensorsInspect = {
  path: string
  bytes: number
  headerLen: number
  tensorCount: number
  dtypes: string[]
  names: string[]
  tensors: SafetensorsTensor[]
  modelTensorCount: number
  optTensorCount: number
  embedding: SafetensorsTensor | null
  lmHead: SafetensorsTensor | null
  pickleKeys: string[]
}

const MAX_HEADER = 50_000_000

export function inspectSafetensorsHeader(filePath: string): SafetensorsInspect {
  const fd = fs.openSync(filePath, 'r')
  try {
    const lenBuf = Buffer.alloc(8)
    fs.readSync(fd, lenBuf, 0, 8, 0)
    const headerLen = Number(lenBuf.readBigUInt64LE(0))
    if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > MAX_HEADER) {
      throw new Error(`implausible safetensors header length ${headerLen}`)
    }
    const headerBuf = Buffer.alloc(headerLen)
    fs.readSync(fd, headerBuf, 0, headerLen, 8)
    const header = JSON.parse(headerBuf.toString('utf8')) as Record<string, { dtype?: string; shape?: number[]; data_offsets?: number[] }>
    const tensors: SafetensorsTensor[] = Object.entries(header)
      .filter(([k]) => k !== '__metadata__')
      .map(([name, info]) => ({
        name,
        dtype: String(info.dtype ?? ''),
        shape: Array.isArray(info.shape) ? info.shape.map(Number) : [],
        dataOffsets: [Number(info.data_offsets?.[0] ?? 0), Number(info.data_offsets?.[1] ?? 0)],
      }))
    const names = tensors.map(t => t.name)
    const embedding =
      tensors.find(t => t.name === 'model.tok_emb.weight' || t.name === 'tok_emb.weight') ?? null
    const lmHead =
      tensors.find(t => /lm_head|output\.weight$/i.test(t.name)) ?? null
    return {
      path: filePath,
      bytes: fs.statSync(filePath).size,
      headerLen,
      tensorCount: tensors.length,
      dtypes: [...new Set(tensors.map(t => t.dtype))],
      names,
      tensors,
      modelTensorCount: tensors.filter(t => t.name.startsWith('model.') || !t.name.startsWith('opt.')).length,
      optTensorCount: tensors.filter(t => t.name.startsWith('opt.') || t.name.endsWith('.m') || t.name.endsWith('.v')).length,
      embedding,
      lmHead,
      pickleKeys: names.filter(n => /pickle|pytorch_model\.bin|__reduce__/i.test(n)),
    }
  } finally {
    fs.closeSync(fd)
  }
}

export async function hashAndInspectSafetensors(filePath: string): Promise<SafetensorsInspect & { sha256: string }> {
  const inspect = inspectSafetensorsHeader(filePath)
  const sha256 = await sha256File(filePath)
  return { ...inspect, sha256 }
}

export function stripModelPrefix(name: string): string {
  return name.startsWith('model.') ? name.slice(6) : name
}
