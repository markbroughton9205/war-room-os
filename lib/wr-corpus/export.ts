/**
 * Export WR-CORPUS metadata/version/provenance. No secrets, tokens, or hidden CoT.
 */
import fs from 'node:fs'
import path from 'node:path'
import { detectCredentialMaterial } from '@/lib/ascension/world-learning-agent/learn'
import { WrCorpusStore } from './store'
import { WrCorpusPolicyError } from './hashes'

export function exportWrCorpusMetadata(input: { ownerUserId: string; dataDirOverride?: string | null }): {
  filePath: string
  bytes: number
} {
  const store = new WrCorpusStore(input.dataDirOverride)
  try {
    const payload = {
      exported_at: new Date().toISOString(),
      owner_user_id: input.ownerUserId,
      versions: store.listVersions(),
      tombstones: store.listTombstones(),
      migration_events: store.listMigrationEvents(),
      notes: [
        'Reconstruct migrated state from canonical metadata + immutable artifacts + recovery provenance.',
        'Secrets, tokens, and hidden CoT are not exported.',
      ],
    }
    const text = JSON.stringify(payload, null, 2)
    if (detectCredentialMaterial(text) || /hidden[_-]?cot/i.test(text)) {
      throw new WrCorpusPolicyError('SECRET_EXPORT_DENIED', 'Export blocked: secret or hidden CoT material detected.')
    }
    fs.mkdirSync(store.paths.exports, { recursive: true })
    const filePath = path.join(store.paths.exports, `wr-corpus-export-${Date.now()}.json`)
    fs.writeFileSync(filePath, text, 'utf8')
    return { filePath, bytes: Buffer.byteLength(text) }
  } finally {
    store.close()
  }
}
