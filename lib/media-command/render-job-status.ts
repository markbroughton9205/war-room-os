/**
 * Historical render jobs keep their original blockedReason.
 * UI must not present stale environment instructions as current runtime fact.
 */
export function isHistoricalEnvironmentFailure(reason: string | null | undefined): boolean {
  return /install ffmpeg|ffmpeg\/ffprobe was not resolved|HVS_FFMPEG_PATH/i.test(reason ?? '')
}

export function describeHistoricalEnvironmentFailure(liveBundledAvailable: boolean): string {
  return liveBundledAvailable
    ? 'Historical failure: FFmpeg was unavailable at the time of this job. Current runtime: bundled FFmpeg available.'
    : 'Historical failure: FFmpeg was unavailable at the time of this job. Current runtime still reports FFmpeg unresolved.'
}
