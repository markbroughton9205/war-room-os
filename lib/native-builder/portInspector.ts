/**
 * port.inspect — read-only listening-socket inspection, backed by `ss` (typed argv). Lets Foundry
 * answer "what owns port 3848" without parsing arbitrary shell output itself, and annotates the
 * two well-known War Room ports so the agent doesn't have to hardcode them at every call site.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { LOCAL_CORE_PORT, LOCAL_UI_PORT } from '@/lib/sovereign-runtime/constants'

const execFileAsync = promisify(execFile)

export type PortKnownRole = 'war_room_core' | 'war_room_ui' | 'forbidden_dev_server' | null

export type PortListener = {
  port: number
  protocol: 'tcp' | 'tcp6'
  address: string
  pid: number | null
  processName: string | null
  knownRole: PortKnownRole
}

function knownRole(port: number): PortKnownRole {
  if (port === LOCAL_CORE_PORT) return 'war_room_core'
  if (port === LOCAL_UI_PORT) return 'war_room_ui'
  if (port === 3001) return 'forbidden_dev_server'
  return null
}

// `ss -ltnp` output (this distro's iproute2 build has no Netid column):
// State  Recv-Q Send-Q  Local Address:Port  Peer Address:Port  Process
// LISTEN 0      511     127.0.0.1:3848      0.0.0.0:*          users:(("next-server (v1",pid=24760,fd=40))
const SS_LINE = /^LISTEN\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+users:\(\("([^"]+)",pid=(\d+)/

/** With `port` given, returns just that listener (or none). Without it, lists every listening
 * TCP socket. Only LISTEN sockets are reported — this is not a general netstat/connection dump. */
export async function portInspect(input: { port?: number } = {}): Promise<{ ok: true; listeners: PortListener[] } | { ok: false; error: string }> {
  if (process.platform === 'win32') {
    return { ok: false, error: 'port.inspect is not yet implemented for win32 (Linux/macOS only today).' }
  }
  try {
    const { stdout } = await execFileAsync('ss', ['-ltnp'], { maxBuffer: 2 * 1024 * 1024, timeout: 8_000 })
    const listeners: PortListener[] = []
    for (const line of stdout.split('\n')) {
      const match = SS_LINE.exec(line.trim())
      if (!match) continue
      const [, address, portStr, processName, pidStr] = match
      const port = Number(portStr)
      if (input.port !== undefined && port !== input.port) continue
      listeners.push({
        port,
        protocol: address.includes('::') ? 'tcp6' : 'tcp',
        address,
        pid: Number(pidStr),
        processName,
        knownRole: knownRole(port),
      })
    }
    return { ok: true, listeners }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
