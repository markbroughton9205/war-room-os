/** Phase 10 continuation: guarded execution runtime. Run: pnpm run validate:agent-eng-runtime */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harness, tmp } from '../engtestkit'
import { makeNotesApp } from '../fixtures'
import { Workspace, WorkspaceError, assertSafeWorkspaceRoot, treeHash } from './workspaceFs'
import { CommandRefusal, authorizeCommand, runCommand, startWorkspaceServer } from './commandRunner'
import { OllamaModelClient, loopbackBaseUrl } from './ollamaModel'
import type { EngineeringTool } from '../../types'

const { check, finish } = harness('AGENT_ENG_RUNTIME_VALIDATION')
const ALL: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof WorkspaceError ? e.code : e instanceof CommandRefusal ? 'REFUSED' : 'other' } }

const root = makeNotesApp(path.join(tmp(), 'app'))
const ws = new Workspace(root)
// ---- workspace confinement
check('R01_reads_writes_are_confined_to_the_workspace', code(() => ws.read('../../etc/passwd')) === 'ESCAPE' && code(() => ws.write('/etc/x', 'x')) === 'ESCAPE' && code(() => ws.write('../outside.txt', 'x')) === 'ESCAPE' && code(() => ws.read('a\0b')) === 'ESCAPE')
check('R02_git_and_node_modules_are_protected', code(() => ws.write('.git/config', 'x')) === 'FORBIDDEN_PATH' && code(() => ws.write('node_modules/x/index.js', 'x')) === 'FORBIDDEN_PATH')
const outside = tmp(); writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
symlinkSync(outside, path.join(root, 'linkdir'))
check('R03_symlink_escape_is_refused', code(() => ws.read('linkdir/secret.txt')) === 'ESCAPE' && code(() => ws.write('linkdir/new.txt', 'x')) === 'ESCAPE')
const w1 = ws.write('src/new.mjs', 'export const a = 1\n')
const w2 = ws.write('src/new.mjs', 'export const a = 2\n')
check('R04_writes_are_atomic_and_report_before_after_hashes', w1.beforeHash === null && w2.beforeHash === w1.afterHash && ws.read('src/new.mjs').includes('= 2') && !ws.list().some((f) => f.endsWith('.tmp')))
check('R05_oversized_writes_refused', code(() => ws.write('big.txt', 'x'.repeat(500_000))) === 'TOO_LARGE')
const snap = ws.snapshot()
check('R06_snapshots_are_content_hashes_and_tree_hash_is_stable', Object.keys(snap).includes('server.mjs') && treeHash(snap) === treeHash(ws.snapshot()) && (ws.write('src/new.mjs', 'export const a = 3\n'), treeHash(ws.snapshot()) !== treeHash(snap)))
check('R07_unsafe_roots_are_refused_home_system_installed_runtime_and_war_room_source', code(() => assertSafeWorkspaceRoot('/')) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot(os.homedir())) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot('/tmp')) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot(process.cwd())) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot(path.join(os.homedir(), '.local/opt/war-room-os-0.2.0-phase10-agent-foundry/opt/War-Room-OS/resources/runtime/ui'))) !== 'none' && code(() => assertSafeWorkspaceRoot('relative/dir')) === 'UNSAFE_ROOT')

// ---- command authorization
const refused = [['git', 'push'], ['rm', '-rf', '.'], ['bash', '-c', 'echo hi'], ['curl', 'https://example.com'], ['node', '-e', 'process.exit(0)'], ['node', '/etc/passwd'], ['node', 'server.mjs'], ['node', '--test', '../x.test.mjs'], ['node', '--test', '--eval', 'x'], ['pnpm', 'install'], ['npm', 'install'], ['npm', 'run', 'start'], ['npx', 'tsc', '--outDir', '/tmp/x'], ['sh', '-c', 'ls'], ['python3', 'x.py']]
check('R08_everything_outside_the_allowlist_is_refused', refused.every((argv) => code(() => authorizeCommand(argv, root, ALL)) === 'REFUSED'), refused.filter((a) => code(() => authorizeCommand(a, root, ALL)) !== 'REFUSED').map((a) => a.join(' ')).join(' | '))
check('R09_tool_grants_are_required_per_command_class', code(() => authorizeCommand(['node', '--test', 'test/notesService.test.mjs'], root, ['read_workspace'])) === 'REFUSED' && code(() => authorizeCommand(['node', '--check', 'server.mjs'], root, ['run_workspace_tests'])) === 'REFUSED' && authorizeCommand(['node', '--check', 'server.mjs'], root, ['run_typecheck']).tool === 'run_typecheck' && authorizeCommand(['npm', 'run', 'test'], root, ['run_workspace_tests']).tool === 'run_workspace_tests' && code(() => authorizeCommand(['pnpm', 'run', 'test'], root, ['run_workspace_tests'])) === 'REFUSED')
const refusedRun = await runCommand(root, ['git', 'push'], ALL)
check('R10_refused_commands_never_execute_and_the_refusal_is_recorded', !!refusedRun.refused && refusedRun.exitCode === null && refusedRun.durationMs === 0)

// ---- real execution
const t = await runCommand(root, ['node', '--test', 'test/notesService.test.mjs'], ALL, { timeoutMs: 30_000 })
check('R11_real_node_test_runs_in_the_workspace_and_passes', t.exitCode === 0 && /pass 3/.test(t.stdout) && t.outputHash.length === 64, t.stdout.split('\n').filter((l) => /pass|fail/.test(l)).join(' | '))
const c = await runCommand(root, ['node', '--check', 'src/notesService.mjs'], ALL)
writeFileSync(path.join(root, 'src/broken.mjs'), 'export function ((( {{{')
const bad = await runCommand(root, ['node', '--check', 'src/broken.mjs'], ALL)
check('R12_syntax_check_passes_good_files_and_fails_broken_ones_with_the_real_error', c.exitCode === 0 && bad.exitCode !== 0 && bad.stderr.length > 0)
writeFileSync(path.join(root, 'test/slow.test.mjs'), "import test from 'node:test'\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 20000)) })\n")
const slow = await runCommand(root, ['node', '--test', 'test/slow.test.mjs'], ALL, { timeoutMs: 700 })
check('R13_timeouts_kill_the_process_and_are_recorded', slow.timedOut && slow.durationMs < 4000)
writeFileSync(path.join(root, 'test/noisy.test.mjs'), "import test from 'node:test'\ntest('noisy', () => { console.log('x'.repeat(60000)); console.log('token sk-abcdefghijklmnopqrstuvwxyz123456 leaked'); console.log('ENVKEYS=' + Object.keys(process.env).sort().join(',')) })\n")
process.env.WAR_ROOM_TEST_SECRET_TOKEN = 'must-not-reach-child'
const noisy = await runCommand(root, ['node', '--test', 'test/noisy.test.mjs'], ALL)
check('R14_output_is_bounded_and_credentials_are_redacted', noisy.stdout.length <= 20_000 && !noisy.stdout.includes('sk-abcdefghijklmnopqrstuvwxyz123456'))
check('R15_child_environment_is_scrubbed', !noisy.stdout.includes('WAR_ROOM_TEST_SECRET_TOKEN') && /ENVKEYS=/.test(noisy.stdout))
writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/notesService.test.mjs', evil: 'rm -rf /' } }))
const viaScript = await runCommand(root, ['npm', 'run', 'test'], ALL, { timeoutMs: 60_000 })
check('R16_only_declared_safe_named_scripts_can_be_run_through_the_package_manager', code(() => authorizeCommand(['npm', 'run', 'evil'], root, ALL)) === 'REFUSED' && code(() => authorizeCommand(['npm', 'run', 'start'], root, ALL)) === 'REFUSED' && viaScript.exitCode === 0, `exit=${viaScript.exitCode} ${viaScript.stderr.slice(0, 80)}`)

// ---- server probe (real HTTP against the real fixture server)
const probe = await startWorkspaceServer(root, 'server.mjs', ALL, { NOTES_DATA_FILE: path.join(tmp(), 'n.json') })
const posted = await fetch(probe.baseUrl + '/api/notes', { method: 'POST', body: JSON.stringify({ text: 'hello' }) })
const listed = await (await fetch(probe.baseUrl + '/api/notes')).json() as { text: string }[]
const bad400 = await fetch(probe.baseUrl + '/api/notes', { method: 'POST', body: JSON.stringify({ text: '' }) })
const page = await (await fetch(probe.baseUrl + '/')).text()
await probe.stop()
let down = false; try { await fetch(probe.baseUrl + '/api/notes', { signal: AbortSignal.timeout(500) }) } catch { down = true }
check('R17_workspace_server_runs_for_real_serves_the_ui_validates_input_and_is_stopped', posted.status === 201 && listed.length === 1 && listed[0].text === 'hello' && bad400.status === 400 && page.includes('<h1>Notes</h1>') && down)
check('R18_server_start_needs_the_runtime_tool_and_a_script_inside_the_workspace', await startWorkspaceServer(root, 'server.mjs', ['read_workspace']).then(() => false, (e) => e instanceof CommandRefusal) && await startWorkspaceServer(root, '../x.mjs', ALL).then(() => false, (e) => e instanceof CommandRefusal))

// ---- model client (real HTTP to a local Ollama-compatible server; no model is faked here, only the client is exercised)
check('R19_model_endpoint_must_be_loopback', (() => { const r = (u: string) => { try { loopbackBaseUrl(u); return 'ok' } catch { return 'refused' } }; return r('http://127.0.0.1:11434') === 'ok' && r('http://localhost:11434') === 'ok' && r('https://api.openai.com') === 'refused' && r('http://10.0.0.5:11434') === 'refused' && r('http://user:pw@127.0.0.1:11434') === 'refused' && r('http://example.com') === 'refused' })())
const fake = createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d }); req.on('end', () => { const j = JSON.parse(b || '{}'); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(j.prompt === 'noeval' ? { response: 'hi' } : { response: 'hello ' + j.model, eval_count: 7, prompt_eval_count: 11 })) }) })
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()))
const fport = (fake.address() as { port: number }).port
const mc = new OllamaModelClient('qwen2.5-coder:14b', `http://127.0.0.1:${fport}`)
const r1 = await mc.generate({ system: 's', prompt: 'p' })
const r2 = await mc.generate({ system: 's', prompt: 'noeval' })
fake.close()
const r3 = await new OllamaModelClient('m', 'http://127.0.0.1:1').generate({ system: 's', prompt: 'p', timeoutMs: 500 })
check('R20_client_reports_actual_executor_real_token_counts_and_UNKNOWN_when_absent_and_honest_failures', r1.ok && r1.executor.model === 'qwen2.5-coder:14b' && r1.outputTokens === 7 && r1.promptTokens === 11 && r2.ok && r2.outputTokens === 'UNKNOWN' && !r3.ok && r3.executor !== 'UNKNOWN')
mkdirSync(path.join(root, 'x'), { recursive: true }); void readFileSync
finish()
