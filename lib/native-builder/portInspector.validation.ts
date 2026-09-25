/**
 * port.inspect validation — runs against the real listening-socket table on this machine.
 */
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { portInspect } from './portInspector'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function listenOnEphemeralPort(): Promise<{ server: import('node:net').Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve({ server, port: address.port })
      else reject(new Error('Could not determine ephemeral port.'))
    })
  })
}

async function knownRoleTests(): Promise<CaseResult[]> {
  const all = await portInspect({})
  return [
    check('known_01_lists_real_listeners', all.ok && all.listeners.length > 0, all.ok ? String(all.listeners.length) : all.error),
    check('known_02_fields_well_typed', all.ok && all.listeners.every(l => Number.isInteger(l.port) && typeof l.address === 'string'), 'shape check'),
  ]
}

async function ownFixtureTests(): Promise<CaseResult[]> {
  const { server, port } = await listenOnEphemeralPort()
  try {
    const scoped = await portInspect({ port })
    return [
      check('fixture_01_finds_a_real_ephemeral_listener_this_process_opened', scoped.ok && scoped.listeners.some(l => l.port === port), scoped.ok ? JSON.stringify(scoped.listeners) : scoped.error),
      check('fixture_02_unrelated_port_has_unknown_role', scoped.ok && scoped.listeners.every(l => l.knownRole === null), scoped.ok ? JSON.stringify(scoped.listeners.map(l => l.knownRole)) : scoped.error),
    ]
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await knownRoleTests())
  add(await ownFixtureTests())
  const failed = results.filter(r => !r.pass)
  console.log(`portInspector validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runPortInspectorValidation }
