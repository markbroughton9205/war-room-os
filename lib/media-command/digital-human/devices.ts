import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { HvsCaptureDevice } from './types'

type AuditNode = {
  id?: string
  node?: string
  label?: string
  capture?: boolean
  metadata?: boolean
  formats?: Array<{ pixelFormat: string; sizes: Array<{ width: number; height: number }> }>
  sampleRates?: Record<string, number[]>
  error?: string
}

type AuditPayload = {
  devices?: AuditNode[]
  audioCards?: Array<{ line: string }>
  latencyMs?: number | null
  streamStarted?: boolean
  error?: string
}

export type HvsDeviceAudit = {
  devices: HvsCaptureDevice[]
  streamStarted: false
  latencyMs: null
  audioAvailable: boolean
  error: string | null
}

function toolPath(): string {
  return path.join(process.cwd(), 'lib/media-command/digital-human/v4l2_tool.py')
}

export function auditCaptureDevices(): HvsDeviceAudit {
  const result = spawnSync('python3', [toolPath(), '--audit'], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) {
    return { devices: [], streamStarted: false, latencyMs: null, audioAvailable: false, error: result.stderr || 'Webcam audit did not run.' }
  }
  let payload: AuditPayload
  try {
    payload = JSON.parse(result.stdout) as AuditPayload
  } catch {
    return { devices: [], streamStarted: false, latencyMs: null, audioAvailable: false, error: 'Webcam audit returned unreadable data.' }
  }
  const audio = (payload.audioCards ?? []).some(card => /c920|webcam/i.test(card.line))
  const devices: HvsCaptureDevice[] = (payload.devices ?? []).map(node => {
    const formats = node.formats ?? []
    const resolutionModes = formats.flatMap(format => (format.sizes ?? []).map(size => ({
      width: size.width,
      height: size.height,
      pixelFormat: format.pixelFormat,
    })))
    const fps = Object.values(node.sampleRates ?? {}).flat()
    const fpsModes = [...new Set(fps)].sort((a, b) => b - a)
    return {
      id: node.id ?? node.node ?? 'camera',
      label: node.label ?? 'Camera',
      type: node.capture ? 'VIDEO_CAPTURE' : 'VIDEO_METADATA',
      node: node.node ?? '',
      capabilities: [
        node.capture ? 'VIDEO_CAPTURE' : '',
        node.metadata ? 'META_CAPTURE' : '',
        ...(formats.map(format => format.pixelFormat)),
      ].filter(Boolean),
      resolutionModes,
      fpsModes,
      audioAvailable: Boolean(node.capture && audio),
      status: node.error ? 'UNAVAILABLE' : 'AVAILABLE',
      latencyMs: null,
    }
  })
  if (audio) {
    devices.push({
      id: 'c920-mic',
      label: 'HD Pro Webcam C920 microphone',
      type: 'AUDIO',
      node: 'hw:C920',
      capabilities: ['CAPTURE'],
      resolutionModes: [],
      fpsModes: [],
      audioAvailable: true,
      status: 'AVAILABLE',
      latencyMs: null,
    })
  }
  return {
    devices,
    streamStarted: false,
    latencyMs: null,
    audioAvailable: audio,
    error: null,
  }
}

export function selectCaptureDevice(devices: HvsCaptureDevice[]): HvsCaptureDevice | null {
  return devices.find(device => device.type === 'VIDEO_CAPTURE' && device.status !== 'UNAVAILABLE') ?? null
}
