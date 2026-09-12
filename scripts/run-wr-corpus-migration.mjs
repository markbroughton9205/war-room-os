import { migrateExistingWrCorpus } from '../lib/wr-corpus/migrate.ts'
import { listWrCorpusVersions } from '../lib/wr-corpus/query.ts'

const result = await migrateExistingWrCorpus({})
const listed = listWrCorpusVersions()
console.log(JSON.stringify({
  ok: result.ok,
  alreadyImported: result.alreadyImported,
  bytesCopied: result.bytesCopied,
  dumpRoot: result.dumpRoot,
  dumpVerification: result.dumpVerification,
  corpus0: result.corpus0,
  corpus1: result.corpus1,
  versions: listed.versions.map(v => ({
    canonical_id: v.canonical_id,
    historical_id: v.historical_id,
    record_count: v.record_count,
    bytes: v.bytes,
    content_hash: v.content_hash,
  })),
  artifactBytes: listed.artifactBytes,
  root: listed.root,
}, null, 2))
