/**
 * Contract-status plumbing (Phase 10, alert-center forensics). When the acceptance contract maps failures to HTTP statuses (404 unknown id, 409 conflict), the domain code
 * must raise errors that CARRY the status and the HTTP layer must answer with it. A model that writes the domain layer with plain `new Error(...)` leaves the API layer
 * with nothing to map, and no rewrite of the API file can fix that (the API file is not the file at fault). Both edits below are structural, bounded to single
 * statements, idempotent and fail closed; the independent verifier stays the arbiter.
 */
const NOT_FOUND = /not found|no such|does not exist|doesn'?t exist|unknown (?:id|alert|task|session|todo|record|item)\b/i
const CONFLICT = /archiv|cannot (?:modify|change|update|be|mark|edit)|can'?t (?:modify|change|update|edit)|conflict|already|not allowed|invalid (?:status )?transition|immutable|locked/i

const codesIn = (acceptance: string[]): Set<string> => new Set(acceptance.flatMap((a) => [...a.matchAll(/\b(404|409)\b/g)].map((m) => m[1])))

/** `throw new Error('Alert not found')` -> `throw Object.assign(new Error('Alert not found'), { status: 404 })` for messages that the contract's 404/409 describe. Domain files only. */
export function attachContractStatuses(rel: string, text: string, acceptance: string[]): { text: string; notes: string[] } | null {
  if (!/\.m?js$/.test(rel) || /^(?:test|public|node_modules)\//.test(rel) || /createServer\s*\(/.test(text)) return null
  const codes = codesIn(acceptance)
  if (!codes.size) return null
  const notes: string[] = []
  const out = text.replace(/\bthrow\s+new\s+Error\(\s*((['"`])(?:(?!\2)[^\\\n]|\\.)*\2)\s*\)/g, (whole, lit: string) => {
    const msg = lit.slice(1, -1)
    const status = codes.has('404') && NOT_FOUND.test(msg) ? 404 : codes.has('409') && CONFLICT.test(msg) ? 409 : 0
    if (!status) return whole
    notes.push(`${JSON.stringify(msg).slice(0, 60)} -> status ${status}`)
    return `throw Object.assign(new Error(${lit}), { status: ${status} })`
  })
  return notes.length ? { text: out, notes } : null
}

/** In the request handler's catch block, answer with the status an error carries: `reply(res, 400, ...)` -> `reply(res, Number.isInteger(err.status) ? err.status : 400, ...)`. */
export function mapCatchStatus(rel: string, text: string): string | null {
  if (!/\.m?js$/.test(rel) || !/createServer\s*\(/.test(text)) return null
  const m = /catch\s*\(\s*(\w+)\s*\)\s*\{([^}]*?)\b(reply|send|respond|json)\s*\(\s*res\s*,\s*(400|500)\s*,/.exec(text)
  if (!m) return null
  const v = m[1]
  const start = m.index + m[0].length - m[4].length - 1
  return text.slice(0, start) + `Number.isInteger(${v}.status) ? ${v}.status : ${m[4]},` + text.slice(start + m[4].length + 1)
}
