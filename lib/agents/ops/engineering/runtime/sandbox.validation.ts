import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { wrapSandboxed, sandboxAvailable } from './sandbox'
import { runCommand } from './commandRunner'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + d}`) }

ok('bubblewrap available', sandboxAvailable())
const ws = mkdtempSync(path.join(os.tmpdir(), 'sbx-ws-'))
writeFileSync(path.join(ws, 'a.test.mjs'), "import test from 'node:test'; import assert from 'node:assert'; test('t', () => assert.equal(1, 1))\n")
const secret = path.join(os.homedir(), '.sbx-secret-canary'); writeFileSync(secret, 'canary')
const run = (script: string, net = false) => {
  const w = wrapSandboxed([process.execPath, '-e', script], { rw: [ws], net }).argv
  return spawnSync(w[0], w.slice(1), { encoding: 'utf8', timeout: 20000 })
}
try {
  ok('workspace is writable', run(`require('fs').writeFileSync('x.txt','1')`).status === 0 && existsSync(path.join(ws, 'x.txt')))
  ok('HOME secrets are invisible', run(`require('fs').readFileSync(${JSON.stringify(secret)})`).status !== 0)
  run(`require('fs').writeFileSync(${JSON.stringify(path.join(os.homedir(), '.sbx-escape'))},'1')`)
  ok('write under HOME never reaches the host', !existsSync(path.join(os.homedir(), '.sbx-escape')))
  ok('write to /etc fails', run(`require('fs').writeFileSync('/etc/sbx-escape','1')`).status !== 0)
  ok('network is private', run(`require('net').connect(3847,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(7))`).status === 7)
  ok('host /tmp is hidden', (() => { const f = path.join(os.tmpdir(), 'sbx-host-file'); writeFileSync(f, 'h'); return run(`require('fs').readFileSync(${JSON.stringify(f)})`).status !== 0 })())
  ok('pid namespace is private', /^\d{1,3}$/.test(run(`console.log(process.pid)`).stdout.trim()) && Number(run(`console.log(process.pid)`).stdout) < 100)
  const rec = await runCommand(ws, ['node', '--test', 'a.test.mjs'], ['run_workspace_tests'])
  ok('authorized test command runs inside sandbox', rec.exitCode === 0, rec.stderr)
  const srv = net.createServer().listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r))
  const port = (srv.address() as net.AddressInfo).port
  const w2 = wrapSandboxed([process.execPath, '-e', `require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(7))`], { rw: [ws], net: true }).argv
  ok('loopback reachable when net:true (servers)', spawnSync(w2[0], w2.slice(1)).status === 0)
  srv.close()
} finally { try { execFileSync('rm', ['-f', secret]) } catch { /* */ } }
console.log(`\nsandbox validation: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
