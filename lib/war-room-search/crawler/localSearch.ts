import { SovereignCorpus } from './corpus'
import type { LocalSearchHit } from './types'

export function searchLocalCorpus(query: string, opts?: { limit?: number; corpusRoot?: string; corpus?: SovereignCorpus }): LocalSearchHit[] {
  const owns = !opts?.corpus
  const corpus = opts?.corpus ?? new SovereignCorpus(opts?.corpusRoot)
  try {
    const rows = corpus.searchFts(query, opts?.limit ?? 8)
    const hits: LocalSearchHit[] = []
    for (const row of rows) {
      const document = corpus.getById(row.documentId)
      if (!document) continue
      hits.push({
        document,
        rank: row.rank,
        snippet: row.snippet || document.description || document.contentText.slice(0, 280),
      })
    }
    return hits
  } finally {
    if (owns) corpus.close()
  }
}
