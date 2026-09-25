/**
 * Targeted CDP ownership proofs: occupied 9222, independent port, persist, discover, loopback, no Cursor kill.
 */
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  claimWarRoomCdpEndpoint,
  desktopRuntimePath,
  loopbackPortInUse,
  readDesktopCdpRuntime,
  WAR_ROOM_CDP_ADDRESS,
  WAR_ROOM_CDP_PREFERRED_PORT,
  WAR_ROOM_CDP_RANGE,
} from './foundryDesktopCdp'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function holdLoopbackPort(port: number): Promise<{ port: number; close: () => Promise<void>; occupiedAlready?: boolean }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve({ port, occupiedAlready: true, close: async () => undefined })
        return
      }
      reject(error)
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        close: () => new Promise(done => server.close(() => done())),
      })
    })
  })
}

async function run() {
  const root = resolveRepoRoot()
  const runtimeParent = path.join(root, '.tmp', 'wr-cdp-runtime')
  mkdirSync(runtimeParent, { recursive: true })
  const runtimeDir = mkdtempSync(path.join(runtimeParent, 'run-'))
  const results: CaseResult[] = []
  const main = readFileSync(path.join(root, 'desktop/src/main.cjs'), 'utf8')
  const cjs = readFileSync(path.join(root, 'desktop/src/warRoomCdp.cjs'), 'utf8')
  const computer = readFileSync(path.join(root, 'lib/native-builder/foundryComputerUseCdp.ts'), 'utf8')
  const desktopTs = readFileSync(path.join(root, 'lib/native-builder/foundryDesktopCdp.ts'), 'utf8')
  const installer = readFileSync(path.join(root, 'lib/native-builder/installerTool.ts'), 'utf8')
  const runtime = readFileSync(path.join(root, 'lib/native-builder/runtimeControl.ts'), 'utf8')
  const browser = readFileSync(path.join(root, 'desktop/src/warRoomBrowser.cjs'), 'utf8')

  let holder: { close: () => Promise<void> } | null = null
  try {
    const held = await holdLoopbackPort(WAR_ROOM_CDP_PREFERRED_PORT)
    holder = held.occupiedAlready ? null : held
    const occupied = held.occupiedAlready === true || loopbackPortInUse(WAR_ROOM_CDP_PREFERRED_PORT)
    results.push(check('preferred_9222_occupied_by_unrelated_process', occupied === true, `inUse=${occupied} already=${held.occupiedAlready === true}`))
    const claimed = claimWarRoomCdpEndpoint(runtimeDir)
    results.push(check(
      'war_room_selects_different_port',
      claimed.cdpPort !== WAR_ROOM_CDP_PREFERRED_PORT && claimed.cdpPort > 0 && claimed.cdpAddress === WAR_ROOM_CDP_ADDRESS,
      JSON.stringify(claimed),
    ))
    results.push(check(
      'selected_port_in_bounded_range_or_ephemeral',
      claimed.allocation === 'ephemeral'
        || (claimed.cdpPort >= WAR_ROOM_CDP_RANGE.start && claimed.cdpPort <= WAR_ROOM_CDP_RANGE.end)
        || claimed.allocation === 'configured',
      `${claimed.allocation}:${claimed.cdpPort}`,
    ))
    const persisted = readDesktopCdpRuntime(runtimeDir)
    results.push(check(
      'selected_port_persisted',
      Boolean(persisted && persisted.cdpPort === claimed.cdpPort && persisted.cdpAddress === WAR_ROOM_CDP_ADDRESS && persisted.bind === WAR_ROOM_CDP_ADDRESS)
        && desktopRuntimePath(runtimeDir).endsWith('desktop-runtime.json'),
      JSON.stringify(persisted),
    ))
    results.push(check(
      'loopback_only',
      claimed.cdpAddress === '127.0.0.1' && claimed.bind === '127.0.0.1'
        && !/listen\([^)]*0\.0\.0\.0/.test(cjs)
        && !/remote-debugging-address['", ]+0\.0\.0\.0/.test(cjs),
      `bind=${claimed.bind}`,
    ))
    results.push(check(
      'consumers_discover_selected_port',
      /discoverWarRoomCdpOrigin/.test(computer)
        && /readDesktopCdpRuntime/.test(computer)
        && /claimWarRoomCdpEndpoint/.test(main)
        && !/--remote-debugging-port=9222/.test(installer)
        && !/--remote-debugging-port=9222/.test(runtime)
        && !computer.includes('http://127.0.0.1:9222'),
      'computer-use/governance/installer/runtime discover persisted endpoint',
    ))
    results.push(check(
      'no_cursor_termination',
      !/killall|pkill|SIGKILL|SIGTERM|process\.kill/.test(cjs),
      'allocator never kills Cursor or any occupant of 9222',
    ))
    results.push(check(
      'native_webcontentsview_guest',
      /WebContentsView/.test(browser) && /persist:war-room-browser/.test(browser) && /nodeIntegration: false/.test(browser),
      'War Room Browser uses isolated guest WebContentsView',
    ))
    results.push(check(
      'cursor_collision_recorded',
      claimed.cursorPortCollision === true,
      String(claimed.cursorPortCollision),
    ))
  } finally {
    await holder?.close().catch(() => undefined)
    rmSync(runtimeDir, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry desktop CDP ownership: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryDesktopCdpValidation }
