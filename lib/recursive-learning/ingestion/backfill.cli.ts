/** Usage: pnpm run backfill:recursive-learning [-- --apply] [--limit N] [--include CLASS,CLASS] */
import path from 'node:path'
import { defaultLearningLog } from '../paths'
import { backfillFoundryMissions } from './backfill'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

const args = process.argv.slice(2)
const val = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const root = resolveBaseRepoRoot()
const report = await backfillFoundryMissions({
  missionsDir: path.join(root, '.war-room', 'foundry-missions'),
  auditFile: path.join(root, '.war-room', 'audit', 'code-operator.jsonl'),
  log: defaultLearningLog(),
  limit: val('--limit') ? Number(val('--limit')) : undefined,
  includeClassifications: val('--include')?.split(','),
  dryRun: !args.includes('--apply'),
})
console.log(JSON.stringify(report, null, 2))
