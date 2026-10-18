import { fromSeconds, zeroTime } from './time'
import { resolveFfmpegTools, runProcess } from './ffmpeg'

export type ProbedMedia = {
  durationSec: number
  width: number | null
  height: number | null
  frameRateN: number | null
  frameRateD: number | null
  variableFrameRate: boolean
  sampleRate: number | null
  channels: number | null
  mime: string
  codec: string | null
  container: string | null
  pixelFormat: string | null
  rotation: number | null
  audioStreams: Array<{ codec: string | null; sampleRate: number | null; channels: number | null }>
  hasVideo: boolean
  hasAudio: boolean
}

const EMPTY: ProbedMedia = {
  durationSec: 0,
  width: null,
  height: null,
  frameRateN: null,
  frameRateD: null,
  variableFrameRate: false,
  sampleRate: null,
  channels: null,
  mime: 'application/octet-stream',
  codec: null,
  container: null,
  pixelFormat: null,
  rotation: null,
  audioStreams: [],
  hasVideo: false,
  hasAudio: false,
}

export async function probeMediaFile(filePath: string): Promise<ProbedMedia> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffprobe) return { ...EMPTY }
  const result = await runProcess(tools.ffprobe, [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-show_entries', 'stream_tags=rotate:format_tags=rotate',
    '-print_format', 'json',
    filePath,
  ], 60_000)
  if (!result.ok && !result.stdout.trim()) return { ...EMPTY }
  try {
    const json = JSON.parse(result.stdout) as {
      format?: { duration?: string; format_name?: string; tags?: Record<string, string> }
      streams?: Array<{
        codec_type?: string
        codec_name?: string
        width?: number
        height?: number
        pix_fmt?: string
        r_frame_rate?: string
        avg_frame_rate?: string
        sample_rate?: string
        channels?: number
        tags?: Record<string, string>
        side_data_list?: Array<{ rotation?: number | string }>
      }>
    }
    const video = json.streams?.find(s => s.codec_type === 'video')
    const audioStreams = (json.streams ?? []).filter(s => s.codec_type === 'audio')
    const audio = audioStreams[0]
    const r = video?.r_frame_rate?.split('/') ?? []
    const a = video?.avg_frame_rate?.split('/') ?? []
    const rN = Number(r[0]) || 0
    const rD = Number(r[1]) || 1
    const aN = Number(a[0]) || 0
    const aD = Number(a[1]) || 1
    const variableFrameRate = rN > 0 && aN > 0 && Math.abs(rN / rD - aN / aD) > 0.05
    const rotateTag = video?.tags?.rotate ?? json.format?.tags?.rotate
    const sideRot = video?.side_data_list?.find(s => s.rotation != null)?.rotation
    const rotation = rotateTag ? Number(rotateTag) : sideRot != null ? Number(sideRot) : null
    const formatName = json.format?.format_name ?? null
    const mime = formatName?.includes('mp4') || formatName?.includes('mov')
      ? (video ? 'video/mp4' : 'audio/mp4')
      : formatName?.includes('wav') ? 'audio/wav'
        : formatName?.includes('mp3') ? 'audio/mpeg'
          : video ? 'video/mp4' : 'application/octet-stream'
    return {
      durationSec: Number(json.format?.duration ?? 0) || 0,
      width: video?.width ?? null,
      height: video?.height ?? null,
      frameRateN: aN || rN || null,
      frameRateD: aD || rD || 1,
      variableFrameRate,
      sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
      channels: audio?.channels ?? null,
      mime,
      codec: video?.codec_name ?? audio?.codec_name ?? null,
      container: formatName,
      pixelFormat: video?.pix_fmt ?? null,
      rotation: Number.isFinite(rotation) ? Number(rotation) : null,
      audioStreams: audioStreams.map(s => ({
        codec: s.codec_name ?? null,
        sampleRate: s.sample_rate ? Number(s.sample_rate) : null,
        channels: s.channels ?? null,
      })),
      hasVideo: Boolean(video),
      hasAudio: audioStreams.length > 0,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function durationAsMediaTime(sec: number) {
  return sec > 0 ? fromSeconds(sec) : zeroTime()
}
