/* eslint-disable @typescript-eslint/no-explicit-any -- test child process (SIGKILL crash scenarios) */
// Test child: runs advanceStages against the sandbox and SIGKILLs itself at a configured fault point. Never imported by routes.
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership'
import { buildBlueprintRuntime } from './liveRuntime'
import { refreshBlueprintWorkspace } from './liveWorkspaces'

const o = JSON.parse(String(process.env.BLUEPRINT_CRASH_OPTS)) as { password: string; execId: string; ctx: any; point: string; stage: string; buildArgs?: string[] }
const store = getLocalOwnershipStore(String(process.env.WAR_ROOM_LOCAL_DATA_DIR))
const login = store.login(o.password)
if (!login.ok) throw new Error('child login failed')
const rt = buildBlueprintRuntime({ buildArgs: o.buildArgs, leaseTtlMs: 1500, hooks: { fault: (p, st) => { if (p === o.point && st === o.stage) process.kill(process.pid, 'SIGKILL') } } })
await refreshBlueprintWorkspace(o.ctx.workspaceId)
const s = login.auth.session
const h = rt.bridge.admit({ ok: true, userId: login.auth.identity.id }, { sessionId: s.session_id, authenticatedAt: Date.parse(s.created_at), expiresAt: Date.parse(s.expires_at), source: 'war-room.local-session' })
await rt.broker.advanceStages(h, o.execId, o.ctx)
