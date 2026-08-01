import { pathToFileURL } from 'node:url'
import { countPersistableTranscriptMessages, shouldReplacePersistedTranscript } from './transcriptReconciliation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function msg(messageType: string) {
  return { messageType }
}

export function runTranscriptReconciliationValidation(): CaseResult[] {
  // 1. Fresh browser/tab: local has only the non-persistable system banner, server has the real
  //    completed round — the fetch must be allowed to populate the transcript.
  const emptyLocalRealServer = shouldReplacePersistedTranscript(
    [msg('system')],
    [msg('decree'), msg('response'), msg('response')],
  )

  // 2. Reload immediately after a round completes: local already has the full round (hydrated
  //    synchronously from sessionStorage) but the fire-and-forget persist writes for that round
  //    haven't landed server-side yet — the stale, shorter server fetch must NOT replace local.
  const staleServerAfterReload = shouldReplacePersistedTranscript(
    [msg('decree'), msg('response'), msg('response'), msg('response')],
    [msg('decree'), msg('response')],
  )

  // 3. Local and server agree exactly (writes caught up) — no-op, no unnecessary replace.
  const inSync = shouldReplacePersistedTranscript(
    [msg('decree'), msg('response')],
    [msg('decree'), msg('response')],
  )

  // 4. Another tab/device added a newer round server-side — server is strictly ahead, apply it.
  const serverAheadFromOtherTab = shouldReplacePersistedTranscript(
    [msg('decree'), msg('response')],
    [msg('decree'), msg('response'), msg('decree'), msg('response')],
  )

  // 5. Both empty (brand-new session, nothing said yet) — no replace needed.
  const bothEmpty = shouldReplacePersistedTranscript([], [])

  // 6. Non-persistable message types (system/error/integrity_flag) never inflate the local count,
  //    so a server fetch with real content still correctly wins over a locally-noisy transcript.
  const localNoiseDoesNotBlockRealServerData = shouldReplacePersistedTranscript(
    [msg('system'), msg('system'), msg('error')],
    [msg('decree'), msg('response')],
  )

  return [
    check(
      'transcript_01_empty_local_real_server_applies',
      emptyLocalRealServer === true,
      `applied=${emptyLocalRealServer}`,
    ),
    check(
      'transcript_02_stale_server_after_reload_does_not_replace_local',
      staleServerAfterReload === false,
      `applied=${staleServerAfterReload}`,
    ),
    check(
      'transcript_03_in_sync_does_not_replace',
      inSync === false,
      `applied=${inSync}`,
    ),
    check(
      'transcript_04_server_ahead_from_other_tab_applies',
      serverAheadFromOtherTab === true,
      `applied=${serverAheadFromOtherTab}`,
    ),
    check(
      'transcript_05_both_empty_does_not_replace',
      bothEmpty === false,
      `applied=${bothEmpty}`,
    ),
    check(
      'transcript_06_local_noise_does_not_block_real_server_data',
      localNoiseDoesNotBlockRealServerData === true,
      `applied=${localNoiseDoesNotBlockRealServerData}`,
    ),
    check(
      'transcript_07_count_ignores_system_and_error_types',
      countPersistableTranscriptMessages([msg('system'), msg('error'), msg('integrity_flag'), msg('decree'), msg('response')]) === 2,
      `count=${countPersistableTranscriptMessages([msg('system'), msg('error'), msg('integrity_flag'), msg('decree'), msg('response')])}`,
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTranscriptReconciliationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Transcript reconciliation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
