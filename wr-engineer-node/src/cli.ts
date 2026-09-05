#!/usr/bin/env node
/**
 * wr-engineer-node CLI — foundation commands only (pair, register, heartbeat). No shell/exec
 * subcommand exists: this package never exposes a raw command-execution entry point. Future
 * inspection subcommands (read-file, search, git-status/diff/log, run-validation) plug in against
 * the same registered-repository model the server already enforces (lib/wr-engineer/node/repository.ts)
 * once a real transport for the server to dispatch them exists — see the Phase 2 report's
 * "FOUNDATION_ONLY" notes on realtime transport.
 */
import { collectMachineFacts } from './platform'
import { pair } from './pair'
import { writeNodeConfig } from './config'
import { heartbeat } from './heartbeat'

const DEFAULT_SERVER_URL = process.env.WR_ENGINEER_SERVER_URL ?? 'http://localhost:3000'

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv

  switch (command) {
    case 'pair': {
      const code = args[0]
      if (!code) {
        console.error('Usage: wr-engineer-node pair <PAIRING_CODE>')
        process.exitCode = 1
        return
      }
      await pair(DEFAULT_SERVER_URL, code)
      return
    }
    case 'register': {
      const [nodeId, credential] = args
      if (!nodeId || !credential) {
        console.error('Usage: wr-engineer-node register <nodeId> <credential>')
        process.exitCode = 1
        return
      }
      await writeNodeConfig({ serverUrl: DEFAULT_SERVER_URL, nodeId, credential })
      console.log('Node registered locally. Run "wr-engineer-node heartbeat" to confirm connectivity.')
      return
    }
    case 'heartbeat':
      await heartbeat()
      return
    case 'whoami': {
      const facts = collectMachineFacts()
      console.log(JSON.stringify(facts, null, 2))
      return
    }
    default:
      console.log('wr-engineer-node — War Room remote engineering node')
      console.log('Commands: pair <code> | register <nodeId> <credential> | heartbeat | whoami')
      if (command) process.exitCode = 1
  }
}

await main()
