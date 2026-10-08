/** War Room session/auth seam — READ-ONLY bridge (isolated). Turns the live Commander gate result + session facts into the broker's
 * strict, credential-free actor. It imports NOTHING from live War Room: the live gate (`requireCommanderSession`, Next.js server-only) is
 * represented by the shape it returns, which the host route passes in per request.
 *
 * Live gate result shapes (lib/security/commanderSession.ts):  {ok:true, userId} | {ok:false, response:{status: 401|403|503}}
 * The live gate does NOT expose session id / authentication time / expiry; those must come as `facts` from a host-owned accessor
 * (see docs/AUTH_SEAM.md). Without facts the bridge FAILS CLOSED (AUTH_SOURCE_UNAVAILABLE).
 *
 * Credentials never enter: only gate.userId, gate.response.status and the four fact keys are read; everything else is ignored/rejected,
 * and the request-scoped handle is a random in-memory id, not a War Room credential. */
import { randomBytes } from 'node:crypto'
import { BlueprintError, refuse } from './base.mjs'
import { validateActor } from './adapters.mjs'

export const AUTH_FAILURE_CODES = Object.freeze(['UNAUTHENTICATED', 'COMMANDER_REQUIRED', 'SESSION_STALE', 'SESSION_MISMATCH', 'ACTOR_MISMATCH', 'AUTH_SOURCE_UNAVAILABLE'])
const MSG = Object.freeze({
  UNAUTHENTICATED: 'No authenticated Commander session.', COMMANDER_REQUIRED: 'Commander session required.', SESSION_STALE: 'Session is expired, revoked or too old.',
  SESSION_MISMATCH: 'Session does not match the approval.', ACTOR_MISMATCH: 'Actor does not match the approval.', AUTH_SOURCE_UNAVAILABLE: 'Session source unavailable; failing closed.',
})
/** Fixed text only: raw gate responses / host errors never reach errors, receipts or events. */
export const authFailure = code => { if (!AUTH_FAILURE_CODES.includes(code)) throw new Error('unknown auth failure'); return new BlueprintError(code, 'auth', MSG[code]) }
const fail = code => { throw authFailure(code) }

export const LIVE_SESSION_TTL_MS = 12 * 3600_000 // lib/sovereign-runtime/local-ownership/types.ts LOCAL_SESSION_TTL_MS
export const SESSION_FACT_KEYS = Object.freeze(['sessionId', 'authenticatedAt', 'expiresAt', 'source'])
export const FORBIDDEN_CREDENTIAL_FIELDS = Object.freeze(['token', 'cookie', 'wr_local_session', 'authorization', 'bearer', 'access_token', 'refresh_token', 'password', 'secret', 'identity', 'installation_id', 'response'])
const ID = /^[\w.-]{1,120}$/
/** Per-source session-id formats. Live local sessions: `lses_<32 hex>` (issueSession -> newPrefixedId('lses', 16)); the cookie/bearer token is a DIFFERENT
 * 43-char base64url string, so a token mistakenly supplied as a session id can never match and is never persisted. Unknown sources fail closed. */
export const SESSION_ID_PATTERNS = Object.freeze({ 'war-room.local-session': /^lses_[a-f0-9]{32}$/ })

/** Commander-only read policy: every live Foundry read route is gated by requireCommanderSession; no broader mechanism is introduced. */
export const commanderOnlyPolicy = Object.freeze({ canRead: actor => actor?.role === 'commander', maxAuthAgeMs: LIVE_SESSION_TTL_MS, allowApprovalTransfer: () => false })
export const READ_AUTH_MAP = Object.freeze({ preview: 'commander', historicalPreview: 'commander', receiptRead: 'commander', statusRead: 'commander', phase9OutcomeRead: 'commander' })

export function createWarRoomAuthBridge({ now = Date.now, maxAuthAgeMs = LIVE_SESSION_TTL_MS, handleTtlMs = 30_000, isSessionLive = null, allowNoRevocationCheck = false, expectedCommanderUserId = null, skewMs = 60_000, sessionIdPatterns = SESSION_ID_PATTERNS } = {}) {
  // Revocation must be observable: without a host liveness check a revoked session would stay usable until the handle expires. Opting out is explicit (tests only).
  if (typeof isSessionLive !== 'function' && allowNoRevocationCheck !== true) throw new Error('isSessionLive(sessionId) is required (host-owned revocation check)')
  const handles = new Map()
  const purge = t => { for (const [h, v] of handles) if (v.expiresAt <= t) handles.delete(h) }
  const classifyGate = gate => {
    if (!gate || typeof gate !== 'object') fail('AUTH_SOURCE_UNAVAILABLE')
    if (gate.ok === true) { if (typeof gate.userId !== 'string' || !ID.test(gate.userId)) fail('AUTH_SOURCE_UNAVAILABLE'); return gate.userId }
    if (gate.ok === false) { const st = Number(gate.response?.status); fail(st === 401 ? 'UNAUTHENTICATED' : st === 403 ? 'COMMANDER_REQUIRED' : 'AUTH_SOURCE_UNAVAILABLE') } // 503 (Commander identity unconfigured) and unknowns fail closed
    return fail('AUTH_SOURCE_UNAVAILABLE')
  }
  const classifyFacts = (facts, t) => {
    if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.keys(facts).some(k => !SESSION_FACT_KEYS.includes(k))) fail('AUTH_SOURCE_UNAVAILABLE') // extra keys (token/cookie...) are refused, not ignored
    const { sessionId, authenticatedAt, expiresAt, source } = facts
    if (typeof sessionId !== 'string' || typeof source !== 'string' || !Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt)) fail('AUTH_SOURCE_UNAVAILABLE')
    if (!sessionIdPatterns[source]?.test(sessionId)) fail('AUTH_SOURCE_UNAVAILABLE') // unknown source or session id that is not the host's session-id format (e.g. a raw token)
    if (authenticatedAt > t + skewMs) fail('AUTH_SOURCE_UNAVAILABLE')
    if (expiresAt <= t || t - authenticatedAt > maxAuthAgeMs) fail('SESSION_STALE')
    return { sessionId, authenticatedAt, expiresAt, source }
  }
  const live = sessionId => { if (!isSessionLive) return true; let ok = false; try { ok = isSessionLive(sessionId) === true } catch { ok = false } return ok }
  return {
    /** Per-request: call with the awaited live gate result and the host's session facts. Returns an opaque request handle for broker calls. */
    admit(gate, facts) {
      const t = now(), userId = classifyGate(gate), f = classifyFacts(facts, t)
      if (expectedCommanderUserId && userId !== expectedCommanderUserId) fail('COMMANDER_REQUIRED')
      if (!live(f.sessionId)) fail('SESSION_STALE')
      let actor; try { actor = validateActor({ actorId: userId, role: 'commander', sessionId: f.sessionId, authenticatedAt: f.authenticatedAt, authenticationSource: f.source }, { now: t, maxAuthAgeMs, skewMs }) } catch { fail('AUTH_SOURCE_UNAVAILABLE') }
      purge(t); if (handles.size >= 1000) fail('AUTH_SOURCE_UNAVAILABLE')
      const handle = `rq_${randomBytes(18).toString('hex')}`
      handles.set(handle, { actor, expiresAt: Math.min(t + handleTtlMs, f.expiresAt) })
      return handle
    },
    close: handle => handles.delete(handle),
    /** The host.sessions adapter the broker consumes. Unknown handles are UNAUTHENTICATED; nothing a caller supplies becomes identity. */
    sessions: {
      resolve(handle) {
        const v = typeof handle === 'string' ? handles.get(handle) : null
        if (!v) fail('UNAUTHENTICATED')
        const t = now(); if (v.expiresAt <= t || t - v.actor.authenticatedAt > maxAuthAgeMs) { handles.delete(handle); fail('SESSION_STALE') }
        if (!live(v.actor.sessionId)) { handles.delete(handle); fail('SESSION_STALE') } // revoked mid-request
        return { ...v.actor }
      },
    },
    get openHandles() { return handles.size },
  }
}
export { refuse }
