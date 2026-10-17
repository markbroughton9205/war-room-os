import type { Subtask, UiProofSpec } from './types'

/**
 * Recipes: what Foundry already knows about a recognized CLASS of change, so the Commander never has to spell out files, interfaces or acceptance criteria.
 * A recipe fixes the part that must be exact (a pure-logic module whose behavior an independent verifier can check, the DOM hooks a pointer test needs,
 * where the feature is mounted) and leaves all implementation to the builder model.
 */
export type CursorNames = { slug: string; kebab: string; component: string; label: string }

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const kebabOf = (slug: string) => slug.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** "a small futuristic spaceship" + "cursor" -> spaceshipCursor. A model-suggested slug wins when it is a safe identifier. */
export function cursorNames(text: string, suggested?: string): CursorNames {
  const SUBJECTS = ['spaceship', 'starship', 'rocket', 'ufo', 'comet', 'arrow', 'wand', 'dragon', 'laser', 'orb', 'star', 'drone', 'saber', 'sword', 'crosshair', 'reticle', 'ship']
  const subject = SUBJECTS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text)) ?? ''
  const safe = (s: string) => /^[a-z][A-Za-z0-9]{2,30}$/.test(s)
  const slug = suggested && safe(suggested) && /cursor$/i.test(suggested) ? suggested : subject ? `${subject}Cursor` : 'customCursor'
  return { slug, kebab: kebabOf(slug), component: cap(slug), label: `${subject || 'custom'} cursor` }
}

export function cursorRecipe(n: CursorNames, request: string): { subtask: Subtask; verifyScript: string; uiProof: UiProofSpec } {
  const logic = `lib/ui/${n.slug}.mjs`, test = `test/${n.slug}.test.mjs`, comp = `components/war-room/${n.component}.tsx`, mount = 'components/ClientProviders.tsx'
  const T = (s: string) => `data-testid="${n.kebab}${s}"`
  const acceptance = [
    `${logic} is a plain ES module exporting: PULSE_MS (number, 200-2000), MAX_PULSES (number >= 3), createCursorState(enabled = true) -> {enabled, x, y, angle, seq, pulses: []}, moveCursor(state, x, y), addPulse(state, x, y, now), expirePulses(state, now), setCursorEnabled(state, enabled), parsePreference(raw), serializePreference(enabled). Every function is pure: it returns a new state and never mutates its argument.`,
    `moveCursor sets x and y and sets angle (degrees, from atan2 of the movement) only when the pointer moved at least 2 px; a smaller movement keeps the previous angle. addPulse appends {id: state.seq + 1, x, y, at: now}, increments seq and keeps only the newest MAX_PULSES. expirePulses removes pulses with now - at >= PULSE_MS. setCursorEnabled(state, false) clears the pulses. parsePreference returns false only for the string 'standard' (trimmed, any case) and true for anything else including null and undefined; serializePreference(true) is 'spaceship' and serializePreference(false) is 'standard'.`,
    `${test} keeps node:test tests for every function above: purity, angle rule, pulse cap, pulse expiry, toggle, preference parsing round trip.`,
    `${comp} is a client component ('use client') exporting SpaceshipCursor-style named export ${n.component}. It draws a small futuristic ship (inline SVG with a visible glow) in an element with ${T('')} that follows the real pointer (window pointermove listener, passive) and is rotated to the heading. It is position: fixed with pointer-events: none so it can never intercept a click, drag or text selection, and it calls neither preventDefault nor stopPropagation.`,
    `On every pointerdown the component adds an energy pulse (an expanding, fading ring with a glow) in an element with ${T('-pulse')}; each pulse is removed again after PULSE_MS (use expirePulses on a timer, no leaking timers or listeners after unmount).`,
    `A small toggle button with ${T('-toggle')}, aria-pressed and a title such as "Switch to the standard cursor" switches between the ship and the standard cursor. When the ship is off, neither ${T('')} nor any pulse is rendered and the native cursor is visible again; when on, the native cursor is hidden through a class on document.documentElement. The choice is stored in localStorage (try/catch around every access) through parsePreference/serializePreference and restored on load.`,
    `The cursor is only active for a fine pointer (window.matchMedia('(pointer: fine)')); on touch devices the component renders nothing. The component is also rendered on the server while Next.js prerenders pages, so window, document, localStorage and matchMedia are touched ONLY inside useEffect or event handlers (initial state must not read them); the first render must be identical on the server and the client.`,
    `${mount} imports ${n.component} and renders <${n.component} /> inside ClientProviders so the cursor is present on every War Room page; everything it rendered before is unchanged.`,
  ]
  const subtask: Subtask = {
    n: 1,
    title: `${cap(n.label)}`,
    request: `${request.trim()}\n\nFOUNDRY PLAN: build the cursor behaviour as a pure logic module (${logic}) with node:test tests (${test}), a client component (${comp}) that uses it, and mount the component globally in ${mount}. Keep normal clicking, dragging and text selection working (the cursor layer must never capture pointer events) and provide the switch back to the standard cursor.`,
    acceptance,
    targets: [{ path: logic, action: 'create' }, { path: test, action: 'create' }, { path: comp, action: 'create' }, { path: mount, action: 'modify' }],
    scope: { paths: [mount, 'components/WandTrail.tsx'], write: [logic, test, comp, mount] },
    hints: ['ui', 'pointer'],
    reverseFirst: false,
  }
  const verifyScript = cursorVerifier(n, { logic, comp, mount })
  const ship = `[data-testid="${n.kebab}"]`, pulse = `[data-testid="${n.kebab}-pulse"]`, toggle = `[data-testid="${n.kebab}-toggle"]`
  const uiProof: UiProofSpec = {
    kind: 'cursor-skin',
    steps: [
      { do: 'goto', path: '/war-room/engineering' },
      { do: 'inject-fixture' },
      { do: 'move', x: 240, y: 220 }, { do: 'move', x: 420, y: 330 },
      { do: 'expect', selector: ship, present: true, label: 'the ship cursor is on the page' },
      { do: 'expect-follows', selector: ship, x: 420, y: 330, tolerance: 40, label: 'the ship follows the real pointer' },
      { do: 'expect-native-cursor', hidden: true, label: 'the native cursor is hidden while the ship is on' },
      { do: 'screenshot', name: 'ship-following' },
      { do: 'click-xy', x: 420, y: 330 },
      { do: 'expect-count', selector: pulse, min: 1, label: 'a click emits an energy pulse', waitMs: 600 },
      { do: 'screenshot', name: 'pulse-on-click' },
      { do: 'expect-count', selector: pulse, min: 0, max: 0, label: 'the pulse is removed afterwards', waitMs: 3500 },
      { do: 'fixture-click-works' },
      { do: 'fixture-drag-selects' },
      { do: 'fixture-drag-moves' },
      { do: 'click-selector', selector: toggle, label: 'switch back to the standard cursor' },
      { do: 'expect', selector: ship, present: false, label: 'the ship is gone after switching back' },
      { do: 'expect-native-cursor', hidden: false, label: 'the native cursor is visible again' },
      { do: 'screenshot', name: 'standard-cursor' },
      { do: 'reload-keeps', selector: ship, present: false, label: 'the standard-cursor choice survives a reload' },
      { do: 'click-selector', selector: toggle, label: 'switch the ship back on' },
      { do: 'expect', selector: ship, present: true, label: 'the ship is back' },
    ],
  }
  return { subtask, verifyScript, uiProof }
}

/** The independent verifier for the cursor class: it imports the delivered logic module and checks the contract; it also checks the structural promises of the component and mount point. Hidden from the builder. */
function cursorVerifier(n: CursorNames, f: { logic: string; comp: string; mount: string }): string {
  return `// Foundry independent verifier (cursor-skin recipe). argv[2] = workspace root.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = process.argv[2]
const fails = []
const ok = (c, m) => { if (!c) fails.push(m) }
const L = ${JSON.stringify(f.logic)}, C = ${JSON.stringify(f.comp)}, M = ${JSON.stringify(f.mount)}, KEB = ${JSON.stringify(n.kebab)}, NAME = ${JSON.stringify(n.component)}
for (const p of [L, C, M]) ok(existsSync(path.join(root, p)), p + ' is missing')
if (!fails.length) {
  const mod = await import(pathToFileURL(path.join(root, L)).href + '?v=' + Date.now()).catch((e) => { fails.push('logic module does not load: ' + e.message); return null })
  if (mod) {
    for (const k of ['PULSE_MS', 'MAX_PULSES', 'createCursorState', 'moveCursor', 'addPulse', 'expirePulses', 'setCursorEnabled', 'parsePreference', 'serializePreference']) ok(k in mod, 'logic module does not export ' + k)
    if (!fails.length) {
      ok(typeof mod.PULSE_MS === 'number' && mod.PULSE_MS >= 200 && mod.PULSE_MS <= 2000, 'PULSE_MS must be 200-2000')
      ok(typeof mod.MAX_PULSES === 'number' && mod.MAX_PULSES >= 3, 'MAX_PULSES must be >= 3')
      const s0 = mod.createCursorState()
      ok(s0 && s0.enabled === true && Array.isArray(s0.pulses) && s0.pulses.length === 0 && s0.seq === 0, 'createCursorState() default shape')
      ok(mod.createCursorState(false).enabled === false, 'createCursorState(false) must be disabled')
      const frozen = Object.freeze({ ...s0, pulses: Object.freeze([]) })
      let s1; try { s1 = mod.moveCursor(frozen, 100, 50) } catch (e) { fails.push('moveCursor mutates its argument: ' + e.message) }
      if (s1) {
        ok(s1.x === 100 && s1.y === 50, 'moveCursor sets x and y')
        ok(Math.abs(s1.angle - Math.atan2(50, 100) * 180 / Math.PI) < 0.5, 'moveCursor angle is atan2 of the movement in degrees')
        const s2 = mod.moveCursor(s1, 101, 50)
        ok(s2.angle === s1.angle && s2.x === 101, 'a movement under 2 px keeps the previous angle')
        let p = s2
        const now = 1000
        for (let i = 0; i < mod.MAX_PULSES + 3; i++) p = mod.addPulse(p, i, i, now + i)
        ok(p.pulses.length === mod.MAX_PULSES, 'addPulse keeps only the newest MAX_PULSES')
        ok(p.pulses[p.pulses.length - 1].id === p.seq && p.seq === mod.MAX_PULSES + 3, 'pulse ids follow seq and the newest pulse is last')
        const q = mod.addPulse(frozen, 5, 6, 50)
        ok(q.pulses.length === 1 && q.pulses[0].x === 5 && q.pulses[0].y === 6 && q.pulses[0].at === 50 && q.pulses[0].id === 1, 'addPulse record {id,x,y,at}')
        ok(mod.expirePulses(q, 50 + mod.PULSE_MS - 1).pulses.length === 1, 'a pulse younger than PULSE_MS stays')
        ok(mod.expirePulses(q, 50 + mod.PULSE_MS).pulses.length === 0, 'a pulse of age PULSE_MS is removed')
        ok(mod.setCursorEnabled(q, false).enabled === false && mod.setCursorEnabled(q, false).pulses.length === 0, 'disabling clears the pulses')
        ok(mod.setCursorEnabled(mod.setCursorEnabled(q, false), true).enabled === true, 're-enabling works')
      }
      ok(mod.parsePreference('standard') === false && mod.parsePreference('  STANDARD ') === false, "parsePreference('standard') is false")
      ok(mod.parsePreference('spaceship') === true && mod.parsePreference(null) === true && mod.parsePreference(undefined) === true && mod.parsePreference('zzz') === true, 'parsePreference defaults to true')
      ok(mod.serializePreference(true) === 'spaceship' && mod.serializePreference(false) === 'standard', 'serializePreference values')
    }
  }
  const c = readFileSync(path.join(root, C), 'utf8')
  ok(/^\\s*['"]use client['"]/.test(c), 'component must start with use client')
  ok(c.includes('data-testid="' + KEB + '"') || c.includes("data-testid='" + KEB + "'") || c.includes("'data-testid': '" + KEB + "'") || c.includes('data-testid={"' + KEB + '"}'), 'component must render data-testid ' + KEB)
  ok(c.includes(KEB + '-pulse'), 'component must render the pulse element ' + KEB + '-pulse')
  ok(c.includes(KEB + '-toggle'), 'component must render the toggle ' + KEB + '-toggle')
  ok(/pointer-?events['"]?\\s*[:=]\\s*['"{]*\\s*none|pointer-events-none/i.test(c), 'the cursor layer must be pointer-events none')
  ok(/passive/.test(c), 'pointer listeners must be passive')
  ok(!/preventDefault\\s*\\(|stopPropagation\\s*\\(/.test(c), 'the cursor layer must not call preventDefault or stopPropagation')
  ok(!/user-?select['"]?\\s*[:=]\\s*['"{]*\\s*none/i.test(c), 'the cursor layer must not disable text selection')
  ok(/pointermove/.test(c) && /pointerdown/.test(c), 'component must listen to pointermove and pointerdown')
  ok(/localStorage/.test(c) && /try\\s*{/.test(c), 'preference must be stored in localStorage inside try/catch')
  ok(/pointer:\\s*fine/.test(c), 'component must be limited to a fine pointer')
  ok(/removeEventListener/.test(c), 'listeners must be removed on unmount')
  ok(/aria-pressed/.test(c), 'toggle must expose aria-pressed')
  const m = readFileSync(path.join(root, M), 'utf8')
  ok(new RegExp('import[^;\\\\n]*\\\\b' + NAME + '\\\\b').test(m) && new RegExp('<' + NAME + '\\\\s*/>').test(m), 'ClientProviders must import and render <' + NAME + ' />')
  ok(/MediaHost/.test(m) && /ApplicationActivityGovernor/.test(m), 'ClientProviders must keep its existing providers')
  // the engine runs this verifier BEFORE it authors the test file, so a missing test file is not a verifier failure here; the controller requires the planned test file afterwards
  const tf = path.join(root, ${JSON.stringify(`test/${n.slug}.test.mjs`)})
  if (existsSync(tf)) { const r = spawnSync(process.execPath, ['--test', tf], { cwd: root, encoding: 'utf8', timeout: 100000 }); ok(r.status === 0, 'the delivered logic tests fail: ' + (r.stdout + r.stderr).split('\\n').filter((l) => /^not ok|# fail/.test(l.trim())).slice(0, 3).join(' | ')) }
}
if (fails.length) { console.log('# verifier: ' + fails.length + ' contract failure(s)'); for (const f of fails) console.log('not ok - ' + f); process.exit(1) }
console.log('# verifier: contract satisfied'); process.exit(0)
`
}
