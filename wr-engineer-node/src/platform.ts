/**
 * Cross-platform machine facts — pure Node.js `os` module, no native dependencies, identical code
 * path on Windows/macOS/Linux (the mapping itself, nodePlatformFromOsPlatform, is imported from the
 * main repo so both sides agree on the same three-value enum — see that function's own header for
 * why it's shared rather than reimplemented here).
 *
 * NOTE on packaging: this file (and cli.ts/pair.ts/heartbeat.ts) currently imports shared protocol
 * types via a relative path into the main war-room-os repo (../../lib/wr-engineer/node/*), which is
 * correct and dependency-free WITHIN this monorepo/worktree but means this package is not yet a
 * truly standalone artifact you could `npm install` on an unrelated machine — extracting those
 * shared types into a tiny published package (e.g. `@war-room/wr-engineer-protocol`) is a clean,
 * bounded Phase 3 packaging task, deliberately out of scope for this foundation phase.
 */
import os from 'node:os'
import { nodePlatformFromOsPlatform, type NodePlatform } from '../../lib/wr-engineer/node/types'

export type MachineFacts = {
  platform: NodePlatform
  architecture: string
  hostname: string
  osVersion: string
}

export const AGENT_VERSION = '0.1.0'

export function collectMachineFacts(): MachineFacts {
  const platform = nodePlatformFromOsPlatform(os.platform())
  if (!platform) {
    throw new Error(`wr-engineer-node does not support this platform: ${os.platform()}. Supported: windows, macos, linux.`)
  }
  return {
    platform,
    architecture: os.arch(),
    hostname: os.hostname(),
    osVersion: os.release(),
  }
}
