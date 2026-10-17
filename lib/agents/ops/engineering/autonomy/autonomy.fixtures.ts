/**
 * TEST-ONLY reference material for the cursor-skin recipe. Foundry never copies any of this into a mission: it exists so the validator can prove the hidden verifier is
 * satisfiable (a correct implementation passes) and strict (specific defects fail), and that the real-input UI proof passes a correct cursor and fails broken ones.
 */
export const REF_LOGIC = `export const PULSE_MS = 700
export const MAX_PULSES = 6
export function createCursorState(enabled = true) { return { enabled, x: 0, y: 0, angle: 0, seq: 0, pulses: [] } }
export function moveCursor(state, x, y) {
  const dx = x - state.x, dy = y - state.y
  const moved = Math.hypot(dx, dy) >= 2
  return { ...state, x, y, angle: moved ? (Math.atan2(dy, dx) * 180) / Math.PI : state.angle }
}
export function addPulse(state, x, y, now) {
  const pulses = [...state.pulses, { id: state.seq + 1, x, y, at: now }].slice(-MAX_PULSES)
  return { ...state, seq: state.seq + 1, pulses }
}
export function expirePulses(state, now) { return { ...state, pulses: state.pulses.filter((p) => now - p.at < PULSE_MS) } }
export function setCursorEnabled(state, enabled) { return { ...state, enabled, pulses: enabled ? state.pulses : [] } }
export function parsePreference(raw) { return !(typeof raw === 'string' && raw.trim().toLowerCase() === 'standard') }
export function serializePreference(enabled) { return enabled ? 'spaceship' : 'standard' }
`

export const REF_LOGIC_TEST = `import test from 'node:test'
import assert from 'node:assert'
import { createCursorState, moveCursor, addPulse, expirePulses, setCursorEnabled, parsePreference, serializePreference, PULSE_MS, MAX_PULSES } from '../lib/ui/spaceshipCursor.mjs'
test('moveCursor is pure and sets the heading', () => {
  const s = Object.freeze(createCursorState())
  const m = moveCursor(s, 10, 10)
  assert.strictEqual(m.x, 10); assert.ok(Math.abs(m.angle - 45) < 0.01); assert.strictEqual(s.x, 0)
})
test('pulses are capped and expire', () => {
  let s = createCursorState()
  for (let i = 0; i < MAX_PULSES + 2; i++) s = addPulse(s, i, i, 100)
  assert.strictEqual(s.pulses.length, MAX_PULSES)
  assert.strictEqual(expirePulses(s, 100 + PULSE_MS).pulses.length, 0)
})
test('toggle and preference round trip', () => {
  assert.strictEqual(setCursorEnabled(addPulse(createCursorState(), 1, 1, 1), false).pulses.length, 0)
  assert.strictEqual(parsePreference(serializePreference(false)), false)
  assert.strictEqual(parsePreference(serializePreference(true)), true)
})
`

export const REF_COMPONENT = `'use client'

import { useEffect, useReducer, useState } from 'react'
import { addPulse, createCursorState, expirePulses, moveCursor, parsePreference, serializePreference, setCursorEnabled, PULSE_MS } from '@/lib/ui/spaceshipCursor.mjs'

const KEY = 'wr.spaceship-cursor'
type S = ReturnType<typeof createCursorState>
type A = { t: 'move'; x: number; y: number } | { t: 'down'; x: number; y: number; now: number } | { t: 'tick'; now: number } | { t: 'enabled'; on: boolean }
function reduce(s: S, a: A): S { return a.t === 'move' ? moveCursor(s, a.x, a.y) : a.t === 'down' ? addPulse(s, a.x, a.y, a.now) : a.t === 'tick' ? expirePulses(s, a.now) : setCursorEnabled(s, a.on) }

export function SpaceshipCursor() {
  const [fine, setFine] = useState(false)
  const [s, dispatch] = useReducer(reduce, undefined, () => createCursorState(true))
  useEffect(() => { setFine(window.matchMedia('(pointer: fine)').matches); try { dispatch({ t: 'enabled', on: parsePreference(window.localStorage.getItem(KEY)) }) } catch { /* storage unavailable */ } }, [])
  useEffect(() => {
    if (!fine || !s.enabled) return
    const move = (e: PointerEvent) => dispatch({ t: 'move', x: e.clientX, y: e.clientY })
    const down = (e: PointerEvent) => dispatch({ t: 'down', x: e.clientX, y: e.clientY, now: Date.now() })
    window.addEventListener('pointermove', move, { passive: true }); window.addEventListener('pointerdown', down, { passive: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', down) }
  }, [fine, s.enabled])
  useEffect(() => { if (!s.pulses.length) return; const t = setTimeout(() => dispatch({ t: 'tick', now: Date.now() }), PULSE_MS); return () => clearTimeout(t) }, [s.pulses])
  useEffect(() => { document.documentElement.classList.toggle('wr-ship-cursor', fine && s.enabled); return () => document.documentElement.classList.remove('wr-ship-cursor') }, [fine, s.enabled])
  if (!fine) return null
  const toggle = () => { const on = !s.enabled; dispatch({ t: 'enabled', on }); try { window.localStorage.setItem(KEY, serializePreference(on)) } catch { /* ignore */ } }
  return (
    <>
      <style>{'html.wr-ship-cursor, html.wr-ship-cursor * { cursor: none !important } @keyframes wr-pulse { from { transform: translate(-50%,-50%) scale(.2); opacity: .9 } to { transform: translate(-50%,-50%) scale(2.4); opacity: 0 } }'}</style>
      {s.enabled && <div data-testid="spaceship-cursor" aria-hidden style={{ position: 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 2147483000, transform: 'translate3d(' + s.x + 'px,' + s.y + 'px,0) translate(-50%,-50%) rotate(' + s.angle + 'deg)', filter: 'drop-shadow(0 0 6px #6cf)' }}><svg width="28" height="28" viewBox="0 0 28 28"><path d="M26 14 L4 5 L9 14 L4 23 Z" fill="#8ef" stroke="#fff" strokeWidth="1" /></svg></div>}
      {s.pulses.map((p) => <div key={p.id} data-testid="spaceship-cursor-pulse" aria-hidden style={{ position: 'fixed', left: p.x, top: p.y, width: 60, height: 60, borderRadius: '50%', border: '2px solid #6cf', boxShadow: '0 0 14px #6cf', pointerEvents: 'none', zIndex: 2147482999, animation: 'wr-pulse ' + PULSE_MS + 'ms ease-out forwards' }} />)}
      <button type="button" data-testid="spaceship-cursor-toggle" aria-pressed={s.enabled} title={s.enabled ? 'Switch to the standard cursor' : 'Switch to the spaceship cursor'} onClick={toggle} style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 2147483001, fontSize: 12, padding: '4px 8px', background: '#012', color: '#8ef', border: '1px solid #8ef', borderRadius: 4 }}>{s.enabled ? 'Ship cursor: on' : 'Ship cursor: off'}</button>
    </>
  )
}
`

/** ClientProviders with the cursor mounted (what a correct mission produces from the real file). */
export const mountInto = (providers: string): string => providers.replace("import { CouncilSourceNavigationProvider }", "import { SpaceshipCursor } from '@/components/war-room/SpaceshipCursor'\nimport { CouncilSourceNavigationProvider }").replace('<MediaHost />', '<MediaHost />\n              <SpaceshipCursor />')

/** A plain HTML page that implements the SAME DOM contract in the browser, with switchable defects, to exercise the real-input proof without a Next build. */
export function proofPage(defect: 'none' | 'captures-pointer' | 'pulses-never-leave' | 'no-toggle-effect' | 'wrapper' | 'ship-stuck' = 'none'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>proof</title><style>
body{margin:0;font-family:sans-serif;min-height:1200px;background:#123;color:#fff}
html.wr-ship-cursor, html.wr-ship-cursor * { cursor: none !important }
@keyframes pulse{from{transform:translate(-50%,-50%) scale(.2);opacity:.9}to{transform:translate(-50%,-50%) scale(2.4);opacity:0}}
</style></head><body><h1 style="padding:20px">Engineering (proof page, defect: ${defect})</h1><p style="padding:20px">Some page text for the cursor to float over.</p>
<script>
const DEFECT=${JSON.stringify(defect)}; let on=true; let x=0,y=0,angle=0
try{ if((localStorage.getItem('wr.spaceship-cursor')||'').trim().toLowerCase()==='standard') on=false }catch{}
const ship=document.createElement('div'); ship.dataset.testid='spaceship-cursor'; ship.setAttribute('data-testid','spaceship-cursor')
const glyph=document.createElement('div'); glyph.style.cssText='position:absolute;left:0;top:0;width:28px;height:28px;background:#8ef;border-radius:50% 0 50% 50%'; if(DEFECT==='wrapper'){ ship.appendChild(glyph) }
ship.style.cssText=DEFECT==='wrapper'?'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483000;pointer-events:none':'position:fixed;left:0;top:0;width:28px;height:28px;background:#8ef;border-radius:50% 0 50% 50%;z-index:2147483000;filter:drop-shadow(0 0 6px #6cf);'+(DEFECT==='captures-pointer'?'pointer-events:auto;width:400px;height:400px;opacity:.01':'pointer-events:none')
const tg=document.createElement('button'); tg.setAttribute('data-testid','spaceship-cursor-toggle'); tg.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483001'
function render(){ document.documentElement.classList.toggle('wr-ship-cursor',on); if(on){ if(!ship.isConnected) document.body.appendChild(ship) } else { ship.remove(); document.querySelectorAll('[data-testid=spaceship-cursor-pulse]').forEach(e=>e.remove()) } tg.textContent=on?'Ship cursor: on':'Ship cursor: off'; tg.setAttribute('aria-pressed',String(on)) }
window.addEventListener('pointermove',e=>{ if(!on) return; const dx=e.clientX-x,dy=e.clientY-y; if(Math.hypot(dx,dy)>=2) angle=Math.atan2(dy,dx)*180/Math.PI; x=e.clientX;y=e.clientY; if(DEFECT==='ship-stuck') return; if(DEFECT==='wrapper'){ glyph.style.left=(x-14)+'px'; glyph.style.top=(y-14)+'px' } else ship.style.transform='translate3d('+x+'px,'+y+'px,0) translate(-50%,-50%) rotate('+angle+'deg)' },{passive:true})
window.addEventListener('pointerdown',e=>{ if(!on) return; const p=document.createElement('div'); p.setAttribute('data-testid','spaceship-cursor-pulse'); p.style.cssText='position:fixed;left:'+e.clientX+'px;top:'+e.clientY+'px;width:60px;height:60px;border-radius:50%;border:2px solid #6cf;pointer-events:none;z-index:2147482999;animation:pulse 700ms ease-out forwards'; document.body.appendChild(p); if(DEFECT!=='pulses-never-leave') setTimeout(()=>p.remove(),700) },{passive:true})
tg.addEventListener('click',()=>{ if(DEFECT==='no-toggle-effect') return; on=!on; try{ localStorage.setItem('wr.spaceship-cursor', on?'spaceship':'standard') }catch{} render() })
document.body.appendChild(tg); render()
</script></body></html>`
}
