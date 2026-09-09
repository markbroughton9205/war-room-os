import { createQueryEmbedder } from './embedder'
import { indexCorpusDocuments } from './indexCorpus'
import { localOnnxModelPresent, resolveHybridPaths } from './modelStore'

async function main() {
  const paths = resolveHybridPaths()
  if (!localOnnxModelPresent(paths.localModelDir) && !localOnnxModelPresent(paths.modelsDir)) {
    console.error('Local embedding model is not installed. Run: pnpm run sovereign-search:prepare-embeddings -- --download')
    process.exit(2)
  }
  const embedder = createQueryEmbedder({ allowDownload: false })
  if (!embedder.available) {
    console.error(embedder.unavailableReason ?? 'SEMANTIC_UNAVAILABLE')
    process.exit(2)
  }
  const result = await indexCorpusDocuments({ embedder })
  console.log(JSON.stringify({ ok: true, ...result, model: embedder.info }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
