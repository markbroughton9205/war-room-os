/**
 * Local node config — nodeId + device credential + server URL, persisted under the OS-appropriate
 * user config directory (`~/.wr-engineer-node/config.json` on all three platforms — `os.homedir()`
 * resolves correctly on Windows/macOS/Linux with no per-OS branching needed). The credential here
 * IS the long-lived secret this node uses to authenticate every heartbeat — treat this file like an
 * SSH private key. It is never transmitted anywhere except in NODE_AUTH/NODE_HEARTBEAT payloads to
 * the configured server URL.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type NodeConfig = {
  serverUrl: string
  nodeId: string
  credential: string
}

function configPath(): string {
  return path.join(os.homedir(), '.wr-engineer-node', 'config.json')
}

export async function readNodeConfig(): Promise<NodeConfig | null> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    return JSON.parse(raw) as NodeConfig
  } catch {
    return null
  }
}

export async function writeNodeConfig(config: NodeConfig): Promise<void> {
  const p = configPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(config, null, 2), 'utf8')
}
