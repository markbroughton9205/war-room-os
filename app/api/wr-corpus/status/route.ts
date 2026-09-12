import { NextResponse } from 'next/server'
import { listCandidateReviewQueue, listWrCorpusVersions } from '@/lib/wr-corpus/query'
import { wrCorpusTruthNotes, WR_CORPUS_STATUS, ROADMAP_23_STATUS } from '@/lib/wr-corpus/identity'
import { wrTokenizerStatusPayload } from '@/lib/wr-tokenizer/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const listed = listWrCorpusVersions()
  return NextResponse.json({
    ok: true,
    wr_corpus: WR_CORPUS_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    notes: wrCorpusTruthNotes(),
    candidate_review_queue: listCandidateReviewQueue('local-commander'),
    tokenizer: wrTokenizerStatusPayload(),
    delete_layers: {
      ACTIVE_CORPUS_DELETE: 'Removes active retrieval; tombstone policy applies.',
      HISTORICAL_RECOVERY_SOURCE_PRESERVED: 'Mac recovery dump is never deleted by active delete.',
    },
    ...listed,
  })
}
