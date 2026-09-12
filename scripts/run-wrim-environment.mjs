import { writeEnvironmentManifest } from '../lib/wrim-environment/manifest.ts'

const { paths, manifest } = writeEnvironmentManifest()
console.log(JSON.stringify({
  reportPath: paths.reportPath,
  manifestPath: paths.manifestPath,
  WRIM_ENVIRONMENT: manifest.WRIM_ENVIRONMENT,
  WRIM_PYTORCH_PORT: manifest.WRIM_PYTORCH_PORT,
  torch: manifest.torch_version,
  continuation_match: manifest.continuation_match,
  cpu_continuation: manifest.cpu_continuation_decoded,
}, null, 2))
