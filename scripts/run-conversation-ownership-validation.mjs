import { runConversationOwnershipValidation } from '../lib/war-room/conversationOwnership.validation.ts'

const results = await runConversationOwnershipValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nConversation ownership validation: ${passCount}/${results.length} PASS`)
console.log(
  'NOTE: this runner is STRUCTURAL. Historical live SCHEMA→BACKFILL→ENFORCE + A/B closeout is documented in docs/WR_CONVERSATION_OWNERSHIP_MIGRATION.md (#19_LIVE_MIGRATION=CONFIRMED). This script does not re-probe production and is not a live SQL-unapplied claim.',
)
if (passCount !== results.length) process.exitCode = 1
