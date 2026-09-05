/**
 * `wr-engineer-node pair <PAIRING_CODE>` — submits a NODE_HELLO + the Commander-issued pairing
 * code to the server's PUBLIC pairing/attempt endpoint (see
 * app/api/wr-engineer/nodes/pairing/attempt/route.ts and lib/supabase/middleware.ts's
 * PUBLIC_API_PATHS — this call carries no Supabase session because none can exist for a bare
 * machine daemon). Authorization then happens out-of-band in the War Room UI; once the Commander
 * authorizes, they relay the issued nodeId + device credential to this machine (Phase 2 scope — see
 * platform.ts's packaging note for the honest boundary here), which is stored via `register`.
 */
import { collectMachineFacts, AGENT_VERSION } from './platform'
import { NODE_INSPECTION_CAPABILITIES } from '../../lib/wr-engineer/node/types'

export async function pair(serverUrl: string, code: string): Promise<void> {
  const facts = collectMachineFacts()
  const res = await fetch(`${serverUrl}/api/wr-engineer/nodes/pairing/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      hello: {
        nodeName: `${facts.hostname} (${facts.platform})`,
        platform: facts.platform,
        architecture: facts.architecture,
        hostname: facts.hostname,
        osVersion: facts.osVersion,
        agentVersion: AGENT_VERSION,
        capabilities: [...NODE_INSPECTION_CAPABILITIES],
      },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`Pairing request failed: ${body.error ?? res.status}`)
    process.exitCode = 1
    return
  }
  console.log(`Pairing request submitted (token ${body.tokenId}, state ${body.state}).`)
  console.log('Waiting for Commander authorization in War Room. Once authorized, run:')
  console.log('  wr-engineer-node register <nodeId> <credential>')
}
