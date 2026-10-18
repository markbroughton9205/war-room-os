import { NextResponse } from 'next/server'
import { requireCommanderSession, requireCommanderMutationOrigin } from '@/lib/security/commanderSession'
import { commanderActor } from '@/lib/agents/ops/api'
import { autonomyController } from '@/lib/agents/ops/engineering/autonomy/service'
import { ControllerError } from '@/lib/agents/ops/engineering/autonomy/controller'
import { isCommandId } from '@/lib/agents/ops/engineering/autonomy/store'
import { rollbackPromotion } from '@/lib/agents/ops/engineering/autonomy/promote'
import { defaultLauncher } from '@/lib/agents/ops/engineering/autonomy/capabilities'
import path from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Autonomy Control Center read model: authority, capabilities, resources, active/recent commands. Reading also lets the controller continue work (it is idempotent). */
export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const c = autonomyController()
  const id = new URL(req.url).searchParams.get('command')
  try {
    if (id) {
      if (!isCommandId(id)) return NextResponse.json({ error: 'invalid command id' }, { status: 400 })
      const v = c.getCommand(id)
      return v ? NextResponse.json({ generatedAt: new Date().toISOString(), command: v }) : NextResponse.json({ error: 'unknown command' }, { status: 404 })
    }
    return NextResponse.json(await c.status())
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 500 }) }
}

/**
 * Commander controls. The actor comes from the session only; a custom header blocks cross-site requests.
 * command: one plain-language sentence starts a tracked mission (no form, no files, no criteria).
 */
export async function POST(req: Request) {
  const csrf = requireCommanderMutationOrigin(req)
  if (csrf) return csrf
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  if (req.headers.get('x-wr-agent-ops') !== '1') return NextResponse.json({ error: 'missing control header' }, { status: 400 })
  let body: Record<string, unknown>
  try { const raw = await req.json(); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object'); body = raw as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  if (JSON.stringify(body).length > 32_768) return NextResponse.json({ error: 'request too large' }, { status: 413 })
  const actor = commanderActor(commander.userId)
  if (!actor) return NextResponse.json({ error: 'Commander session required' }, { status: 403 })
  const c = autonomyController()
  const action = String(body.action ?? '')
  try {
    switch (action) {
      case 'command': {
        const r = await c.submit(String(body.text ?? ''), { kind: 'foundry-ui' }, actor)
        return NextResponse.json(r, { status: 202 })
      }
      case 'pause': return NextResponse.json({ config: c.pause(actor) })
      case 'resume': return NextResponse.json({ config: await c.resume(actor) })
      case 'cancel': return NextResponse.json({ command: await c.cancel(String(body.commandId ?? ''), actor, typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'Commander cancelled') }, { status: 202 })
      case 'estop': return NextResponse.json({ emergencyStop: c.emergencyStop(actor, typeof body.reason === 'string' && body.reason.trim() ? body.reason.slice(0, 200) : 'Emergency Stop pressed by the Commander') })
      case 'clear-stop': return NextResponse.json({ cleared: c.clearStop(actor) })
      case 'restart': return NextResponse.json({ command: await c.restartStopped(String(body.commandId ?? ''), actor) }, { status: 202 })
      case 'reopen': return NextResponse.json({ command: await c.reopen(String(body.commandId ?? ''), actor) }, { status: 202 })
      case 'settings': {
        const p = (body.settings ?? {}) as Record<string, unknown>
        const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
        const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
        return NextResponse.json({ config: c.setSettings({ fullAutonomy: bool(p.fullAutonomy), deploymentAuthority: bool(p.deploymentAuthority), autoInstall: bool(p.autoInstall), autoRecover: bool(p.autoRecover), maxStrategyAttempts: num(p.maxStrategyAttempts), maxAutoResumes: num(p.maxAutoResumes) }, actor) })
      }
      case 'rollback-promotion': {
        const backup = String(body.backup ?? '')
        const launcherDir = path.dirname(defaultLauncher())
        if (path.dirname(backup) !== launcherDir || !path.basename(backup).startsWith(path.basename(defaultLauncher()) + '.rollback-') || /[^\w./-]/.test(backup)) return NextResponse.json({ error: 'invalid backup path: it must be a rollback copy beside the launcher' }, { status: 400 })
        return NextResponse.json(rollbackPromotion(backup))
      }
      default: return NextResponse.json({ error: 'unknown action', actions: ['command', 'pause', 'resume', 'cancel', 'estop', 'clear-stop', 'restart', 'reopen', 'settings', 'rollback-promotion'] }, { status: 400 })
    }
  } catch (e) {
    if (e instanceof ControllerError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'NOT_FOUND' ? 404 : e.code === 'AUTONOMY_OFF' || e.code === 'STOPPED' ? 409 : e.code === 'ILLEGAL' || e.code === 'BUSY' ? 409 : 400 })
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 400 })
  }
}
