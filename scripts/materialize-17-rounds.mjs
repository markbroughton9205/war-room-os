import { materializeAuthoritativeRoundsFromCache } from '../lib/council/session-intelligence/persist.ts'

const ids = process.argv.slice(2)
if (!ids.length) {
  console.error('Usage: materialize-17-rounds.mjs <conversationId>...')
  process.exit(1)
}

for (const id of ids) {
  const result = await materializeAuthoritativeRoundsFromCache(id)
  console.log(JSON.stringify({ conversationId: id, ...result }, null, 2))
  if (!result.ok) process.exitCode = 1
}
