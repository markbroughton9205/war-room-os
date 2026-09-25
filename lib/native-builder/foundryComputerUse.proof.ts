/**
 * PASS 003 Computer Use proof against a throwaway GTK X11 test window, then a read-only
 * observation of the installed War Room window. Never focuses/closes unrelated apps.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { executeEngineerTool } from './engineerTools'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const ctx = { repairId: randomUUID() }
  try {
    const status = await executeEngineerTool({ tool: 'computer.status', input: {} }, ctx)
    const screens = await executeEngineerTool({ tool: 'computer.screens', input: {} }, ctx)
    add([
      check('cu_01_status', status.ok, JSON.stringify(status.result ?? status.error)),
      check('cu_02_screens', screens.ok, JSON.stringify(screens.result ?? screens.error)),
    ])

    const opened = await executeEngineerTool({ tool: 'computer.open_app', input: { app: 'foundry-cu-test' } }, ctx)
    add([check('cu_03_open_test_app', opened.ok, JSON.stringify(opened.result ?? opened.error))])
    if (!opened.ok) throw new Error(`test app did not open: ${opened.error}`)

    const windows = await executeEngineerTool({ tool: 'computer.windows', input: {} }, ctx)
    const focus = await executeEngineerTool({ tool: 'computer.focus_window', input: { title: 'Foundry Computer Use Test' } }, ctx)
    add([
      check('cu_04_enumerate_windows', windows.ok, JSON.stringify(windows.error ?? 'ok')),
      check('cu_05_focus_exact_test_window', focus.ok, JSON.stringify(focus.result ?? focus.error)),
    ])

    const shot = await executeEngineerTool({ tool: 'computer.screenshot', input: {} }, ctx)
    const located = await executeEngineerTool({ tool: 'computer.find_text', input: { text: 'FOUNDRY_CU_MARKER_ALPHA' } }, ctx)
    const hits = (located.result as { hits?: unknown[] } | undefined)?.hits ?? []
    add([
      check('cu_06_screenshot', shot.ok || (shot.result as { status?: string })?.status === 'BLOCKED', JSON.stringify(shot.result ?? shot.error)),
      check('cu_07_find_text', located.ok && hits.length > 0, JSON.stringify(located.result ?? located.error)),
    ])

    const clicked = await executeEngineerTool({ tool: 'computer.click', input: { text: 'Click Me' } }, ctx)
    await executeEngineerTool({ tool: 'computer.wait', input: { ms: 300 } }, ctx)
    const typed = await executeEngineerTool({ tool: 'computer.type', input: { text: 'foundry-cu-typed' } }, ctx)
    const keyed = await executeEngineerTool({ tool: 'computer.key', input: { key: 'Return' } }, ctx)
    const hotkey = await executeEngineerTool({ tool: 'computer.hotkey', input: { keys: 'ctrl+a' } }, ctx)
    const scrolled = await executeEngineerTool({ tool: 'computer.scroll', input: { dy: 5 } }, ctx)
    add([
      check('cu_08_click', clicked.ok, JSON.stringify(clicked.result ?? clicked.error)),
      check('cu_09_type', typed.ok, JSON.stringify(typed.result ?? typed.error)),
      check('cu_10_key_hotkey', keyed.ok && hotkey.ok, JSON.stringify({ keyed: keyed.error ?? 'ok', hotkey: hotkey.error ?? 'ok' })),
      check('cu_11_scroll', scrolled.ok, JSON.stringify(scrolled.result ?? scrolled.error)),
    ])

    const written = await executeEngineerTool({ tool: 'computer.clipboard_write', input: { text: 'FOUNDRY_CU_CLIP' } }, ctx)
    const writeBlocked = (written.result as { status?: string } | undefined)?.status === 'BLOCKED'
    const writeRoundtrip = (written.result as { roundtrip?: boolean } | undefined)?.roundtrip === true
    add([
      check('cu_12_clipboard', written.ok && writeRoundtrip || writeBlocked, JSON.stringify(written.result ?? written.error)),
    ])

    const dialog = await executeEngineerTool({ tool: 'computer.file_dialog', input: {} }, ctx)
    const dialogBlocked = (dialog.result as { status?: string } | undefined)?.status === 'BLOCKED'
    add([check('cu_13_file_dialog_proven_or_hard_blocked', dialog.ok || dialogBlocked, JSON.stringify(dialog.result ?? dialog.error))])

    const observeWr = await executeEngineerTool({ tool: 'computer.windows', input: {} }, ctx)
    const x11 = (observeWr.result as { x11?: { title: string }[] } | undefined)?.x11 ?? []
    const sawWarRoom = Array.isArray(x11) && x11.some(w => /war room/i.test(w.title))
    add([check('cu_14_observe_war_room_window_or_honest_absence', observeWr.ok, JSON.stringify({ sawWarRoom, titles: Array.isArray(x11) ? x11.map(w => w.title).slice(0, 12) : observeWr.result }) )])
  } finally {
    await executeEngineerTool({ tool: 'computer.close_app', input: {} }, ctx)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`foundry computer-use proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryComputerUseProof }
