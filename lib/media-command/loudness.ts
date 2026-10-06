/**
 * Wave 9 loudness measurement. FFmpeg ebur128. Never fake meters.
 * Do not auto-normalize.
 */
import { resolveFfmpegTools, runProcess } from './ffmpeg'

export type LoudnessReading = {
  integratedLufs: number | null
  shortTermLufs: number | null
  truePeakDbtp: number | null
  filter: string
}

export const DEFAULT_DELIVER_LOUDNESS_TARGET_LUFS = -14

export function parseEbur128(stderr: string): LoudnessReading {
  const integrated = stderr.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/)
  const shortTerm = stderr.match(/S:\s+(-?\d+(?:\.\d+)?)\s+LUFS/)
  const peak = stderr.match(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/) ?? stderr.match(/True peak:\s+(-?\d+(?:\.\d+)?)/i)
  return {
    integratedLufs: integrated ? Number(integrated[1]) : null,
    shortTermLufs: shortTerm ? Number(shortTerm[1]) : null,
    truePeakDbtp: peak ? Number(peak[1]) : null,
    filter: 'ebur128=peak=true',
  }
}

export async function measureLoudness(filePath: string): Promise<LoudnessReading> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { integratedLufs: null, shortTermLufs: null, truePeakDbtp: null, filter: 'ebur128=peak=true' }
  const run = await runProcess(tools.ffmpeg, [
    '-hide_banner', '-i', filePath,
    '-af', 'ebur128=peak=true:framelog=verbose',
    '-f', 'null', '-',
  ], 120_000)
  return parseEbur128(run.stderr + run.stdout)
}

export const LOUDNESS_AUTO_NORMALIZE = false
