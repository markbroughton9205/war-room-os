import { runWrimReconciliation } from '../lib/wrim-reconciliation/reconcile.ts'

const { paths, wrim0Hash, report } = await runWrimReconciliation()
console.log(JSON.stringify({
  reportPath: paths.reportPath,
  wrim0Hash,
  inference: report.inference,
  recommendation: report.recommendation,
  gpu: report.hardware.gpuName,
  vram: report.hardware.gpuVramMiB,
}, null, 2))
