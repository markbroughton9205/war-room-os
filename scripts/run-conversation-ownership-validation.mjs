import { runConversationOwnershipValidation } from '../lib/war-room/conversationOwnership.validation.ts'

const results = await runConversationOwnershipValidation()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
const passCount = results.filter(r => r.pass).length
console.log(`\nConversation ownership validation: ${passCount}/${results.length} PASS`)
console.log('NOTE: live DB proof is BLOCKED BY MIGRATION - supabase/war_room_conversations_ownership.sql has not been applied.')
if (passCount !== results.length) process.exitCode = 1
