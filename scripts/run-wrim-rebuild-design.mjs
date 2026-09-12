import { runWrimRebuildDesign } from '../lib/wrim-rebuild-design/design.ts'

const { paths, report, parentSha } = await runWrimRebuildDesign()
console.log(JSON.stringify({
  reportPath: paths.reportPath,
  decision: report.decision,
  nextAuthorizedPass: report.nextAuthorizedPass,
  parentSha,
  tokenizerSha: report.tokenizer.sha256,
  officialRunId: report.officialRunId,
  executed: report.executed,
}, null, 2))
