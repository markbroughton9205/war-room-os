/**
 * Sends one NODE_HEARTBEAT to the configured server, authenticated by this node's stored device
 * credential (see config.ts). The server independently verifies the credential hash and rejects a
 * revoked node outright (lib/wr-engineer/node/identity.ts) — this client trusts nothing about its
 * own acceptance beyond the server's response.
 */
import { readNodeConfig } from './config'
import { AGENT_VERSION } from './platform'

export async function heartbeat(): Promise<void> {
  const config = await readNodeConfig()
  if (!config) {
    console.error('No node config found. Run "wr-engineer-node register <nodeId> <credential>" first.')
    process.exitCode = 1
    return
  }

  const res = await fetch(`${config.serverUrl}/api/wr-engineer/nodes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'NODE_HEARTBEAT', nodeId: config.nodeId, credential: config.credential, agentVersion: AGENT_VERSION }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`Heartbeat rejected: ${body.error ?? res.status}`)
    process.exitCode = 1
    return
  }
  console.log(`Heartbeat accepted. last_seen=${body.lastSeenAt}`)
}
