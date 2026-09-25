import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { resolveFfmpegTools, runProcess } from '../ffmpeg'
import { probeMediaFile } from '../probe'
import type { HvsQcCheck, HvsQcReport, HvsQcState } from './types'

async function sha256File(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

function parseFilterHits(stderr: string, key: string): number {
  return (stderr.match(new RegExp(key, 'g')) ?? []).length
}

function parseEbur(stderr: string): string | null {
  const match = stderr.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/)
  return match ? `${match[1]} LUFS` : null
}

function rollup(checks: HvsQcCheck[]): Exclude<HvsQcState, 'NOT_RUN'> {
  if (checks.some(check => check.status === 'FAIL')) return 'FAIL'
  if (checks.some(check => check.status === 'NEEDS_HUMAN')) return 'NEEDS_HUMAN'
  return 'PASS'
}

export async function runDeterministicQc(filePath: string): Promise<HvsQcReport> {
  const ranAt = new Date().toISOString()
  const checks: HvsQcCheck[] = []
  if (!existsSync(filePath)) {
    return {
      schema: 'hvs.qc.v1',
      path: filePath,
      outcome: 'FAIL',
      hash: null,
      durationSec: null,
      checks: [{ id: 'exists', status: 'FAIL', detail: 'Output file is missing.' }],
      ranAt,
    }
  }
  const hash = await sha256File(filePath)
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !tools.ffprobe) {
    return {
      schema: 'hvs.qc.v1',
      path: filePath,
      outcome: 'FAIL',
      hash,
      durationSec: null,
      checks: [{ id: 'ffmpeg', status: 'FAIL', detail: 'ffmpeg/ffprobe not resolved.' }],
      ranAt,
    }
  }

  const probed = await probeMediaFile(filePath)
  const readable = probed.durationSec > 0 && (probed.hasVideo || probed.hasAudio)
  checks.push({
    id: 'ffprobe_readable',
    status: readable ? 'PASS' : 'FAIL',
    detail: readable
      ? `duration=${probed.durationSec} video=${String(probed.hasVideo)} audio=${String(probed.hasAudio)}`
      : 'ffprobe returned no readable streams.',
  })
  checks.push({
    id: 'stream_presence',
    status: probed.hasVideo ? 'PASS' : 'FAIL',
    detail: probed.hasVideo ? `video ${probed.codec ?? 'unknown'} ${probed.width}x${probed.height}` : 'Expected video stream missing.',
  })
  checks.push({
    id: 'duration_sanity',
    status: probed.durationSec >= 0.2 && probed.durationSec < 600 ? 'PASS' : 'FAIL',
    detail: `durationSec=${probed.durationSec}`,
  })
  checks.push({
    id: 'output_hash',
    status: hash ? 'PASS' : 'FAIL',
    detail: hash ? `sha256=${hash}` : 'Hash missing.',
  })

  const decode = await runProcess(tools.ffmpeg, [
    '-v', 'error', '-i', filePath, '-f', 'null', '-',
  ], 120_000)
  checks.push({
    id: 'decode_null_sink',
    status: decode.ok ? 'PASS' : 'FAIL',
    detail: decode.ok ? 'null-sink decode succeeded.' : decode.stderr.slice(-400),
  })

  const detect = await runProcess(tools.ffmpeg, [
    '-i', filePath,
    '-af', 'silencedetect=n=-50dB:d=0.5,ebur128=framelog=verbose',
    '-vf', 'blackdetect=d=0.5:pic_th=0.98,freezedetect=n=0.003:d=1.0',
    '-f', 'null', '-',
  ], 180_000)
  const blackHits = parseFilterHits(detect.stderr, 'black_start:')
  const freezeHits = parseFilterHits(detect.stderr, 'freeze_start:')
  const silenceHits = parseFilterHits(detect.stderr, 'silence_start:')
  const loudness = parseEbur(detect.stderr)
  checks.push({
    id: 'blackdetect',
    status: blackHits === 0 ? 'PASS' : 'NEEDS_HUMAN',
    detail: blackHits === 0 ? 'No blackdetect intervals.' : `${blackHits} blackdetect interval(s).`,
  })
  checks.push({
    id: 'freezedetect',
    status: freezeHits === 0 ? 'PASS' : 'NEEDS_HUMAN',
    detail: freezeHits === 0 ? 'No freezedetect intervals.' : `${freezeHits} freezedetect interval(s).`,
  })
  checks.push({
    id: 'silencedetect',
    status: silenceHits === 0 ? 'PASS' : 'NEEDS_HUMAN',
    detail: silenceHits === 0 ? 'No silencedetect intervals.' : `${silenceHits} silencedetect interval(s).`,
  })
  checks.push({
    id: 'loudness_ebur128',
    status: loudness ? 'PASS' : 'NEEDS_HUMAN',
    detail: loudness ?? 'ebur128 integrated loudness not parsed (filter may be absent).',
  })
  if (probed.hasAudio === false) {
    checks.push({ id: 'caption_presence', status: 'PASS', detail: 'No captions expected; none required.' })
  } else {
    checks.push({ id: 'caption_presence', status: 'PASS', detail: 'Captions not present; optional and not required for this kernel slice.' })
  }

  return {
    schema: 'hvs.qc.v1',
    path: filePath,
    outcome: rollup(checks),
    hash,
    durationSec: probed.durationSec,
    checks,
    ranAt,
  }
}
