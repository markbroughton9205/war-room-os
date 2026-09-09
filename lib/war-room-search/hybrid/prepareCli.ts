import { prepareLocalEmbeddingModel } from './prepareModel'
import { localModelGovernance } from './modelStore'

async function main() {
  const allowDownload = process.argv.includes('--download')
  const governance = localModelGovernance()
  console.log(JSON.stringify({
    action: 'prepare-embeddings',
    allowDownload,
    model: governance.model,
    officialSource: governance.officialSource,
    onnxSource: governance.onnxSource,
    license: governance.license,
    commercialUse: governance.commercialUse,
    approximateDownloadBytes: governance.approximateDownloadBytes,
    expectedRuntimeMemoryBytes: governance.expectedRuntimeMemoryBytes,
    dimensions: governance.dimensions,
    inferenceBackend: governance.inferenceBackend,
    storageLocation: governance.storageLocation,
    gitignored: governance.gitignored,
  }, null, 2))
  if (!allowDownload) {
    console.log('Refusing to download. Re-run with --download after reviewing the license above.')
    process.exit(2)
  }
  const result = await prepareLocalEmbeddingModel({ allowDownload: true })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
