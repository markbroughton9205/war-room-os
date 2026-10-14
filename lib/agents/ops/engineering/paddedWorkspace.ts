import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * A larger "existing codebase" around a small fixture app, for measuring context retrieval: 4 small reusable helpers and 1 conventions document that a
 * feature can legitimately build on, plus 30 modules of unrelated domains. Vocabulary is chosen so the code planner's keyword seeds of the chat / task / alert
 * fixtures do not hit these files (the plan must be the same with and without the padding; checked in paddedWorkspace.validation.ts).
 */
export const PAD_RELEVANT = ['src/lib/jsonFile.mjs', 'src/lib/ids.mjs', 'src/lib/validate.mjs', 'src/http/respond.mjs', 'docs/CONVENTIONS.md'] as const

const RELEVANT: Record<string, string> = {
  'src/lib/jsonFile.mjs': `import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Read a JSON document from disk; a missing file yields the fallback. */
export function readJsonFile(file, fallback) {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Write a JSON document atomically (temp file + rename) so a crash never leaves half a file. Creates the directory. */
export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}
`,
  'src/lib/ids.mjs': `/** Next positive integer id for a list of records that carry numeric ids (numbers or numeric strings). Ids are never reused: the maximum existing id plus one. Returns a number; convert it if an API contract wants another form. */
export function nextNumericId(records) {
  let max = 0
  for (const r of records) {
    const n = Number(r.id)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}
`,
  'src/lib/validate.mjs': `/** A trimmed non-empty string, or throws an Error with the given message (callers map it to HTTP 400). */
export function requireText(value, message) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message)
  return value.trim()
}

/** One of the allowed values, or throws an Error with the given message. */
export function requireOneOf(value, allowed, message) {
  if (!allowed.includes(value)) throw new Error(message)
  return value
}
`,
  'src/http/respond.mjs': `/** Send a JSON body with a status code. */
export function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Parse a JSON request body; an empty body is an empty object. */
export async function readJsonBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw || '{}')
}
`,
  'docs/CONVENTIONS.md': `# Service conventions

These apply to every small HTTP service in this repository.

- Error responses are JSON objects shaped { "error": "<reason>" }. A request for an unknown id answers 404, invalid input answers 400, a successful creation answers 201.
- Data kept on disk is JSON. Read it with readJsonFile and write it with writeJsonAtomic from src/lib/jsonFile.mjs, which creates the directory and never leaves a half-written file. The file location comes from an environment variable named in the feature description, with a default under ./data in the working directory.
- New record ids come from nextNumericId in src/lib/ids.mjs (a positive integer; the feature's own contract decides how an id is shown). Ids are never reused.
- Validate user input with requireText and requireOneOf from src/lib/validate.mjs and let the HTTP layer turn the thrown Error into a 400.
- HTTP handlers use sendJson and readJsonBody from src/http/respond.mjs.
- Tests use node:test and node:assert, import the functions from src/ directly, and cover one behaviour per test.
`,
}

/** The same conventions as docs/CONVENTIONS.md, but buried in a long platform guide (about 3.6 KB): documentation too long to hand over whole, which is when a research brief is worth its two model swaps. */
const GUIDE_A = 'Office and facilities. The office is open from 08:00 to 18:00 on working days. Visitors register at the front desk and wear a badge. Meeting rooms are booked through the shared calendar and released when unused for fifteen minutes. Parking spaces are assigned by seniority. The kitchen is cleaned every evening and shared food is thrown away on Fridays.\n\nBranch naming. Feature branches start with feature/, fixes with fix/, and releases with release/. Commit messages are written in the imperative mood and stay under seventy-two characters on the first line. Pull requests need one approval. Squash merging is preferred for small changes and merge commits for long-running branches.\n\nBackups. Database backups run nightly at 02:30 and are kept for thirty days; weekly backups are kept for a year. Restores are rehearsed once per quarter by the operations team. Backup encryption keys are rotated every twelve months and stored in the hardware vault.\n\n'
const GUIDE_B = '\n\nIncident communication. During an incident the on-call engineer opens a channel, posts a summary every thirty minutes, and writes a short review within five working days. Customers are informed through the status page. Severity levels are numbered one to four. The review template lists timeline, impact, causes and follow-up tasks.\n\nTraining. New staff complete security awareness training in their first two weeks and refresh it every year. Optional workshops on testing, accessibility and documentation run monthly. Certificates are paid by the company when the topic is relevant to the role.\n\nProcurement. Software purchases above a fixed amount need a second signature. Open-source dependencies are reviewed for licence terms before adoption. Vendor contracts are renewed in January and the list of vendors is kept by the finance team.\n\nAccessibility. Every page must be usable with a keyboard only, images carry text alternatives, and colour is never the only carrier of meaning. Automated checks run on every release and a manual review is done twice a year with assistive technology. Findings are tracked in the shared board and closed within two sprints.\n\nTravel. Journeys are booked through the approved agency, expenses are filed within thirty days, and receipts are attached to each claim. Long-haul flights in economy class are the default; exceptions need approval from a department head.\n'
export const PAD_RELEVANT_LONGGUIDE = ['src/lib/jsonFile.mjs', 'src/lib/ids.mjs', 'src/lib/validate.mjs', 'src/http/respond.mjs', 'docs/PLATFORM_GUIDE.md'] as const

const D = (name: string, body: string): [string, string] => [name, body]
const DISTRACTORS: [string, string][] = [
  D('src/billing/invoice.mjs', `export function invoiceTotal(lines) {\n  return lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)\n}\n\nexport function invoiceNumber(year, counter) {\n  return 'INV-' + year + '-' + String(counter).padStart(5, '0')\n}\n`),
  D('src/billing/tax.mjs', `export function addVat(amount, rate = 0.2) {\n  return Math.round(amount * (1 + rate) * 100) / 100\n}\n\nexport function vatPortion(gross, rate = 0.2) {\n  return Math.round((gross - gross / (1 + rate)) * 100) / 100\n}\n`),
  D('src/billing/currency.mjs', `const RATES = { EUR: 1, USD: 1.08, GBP: 0.86 }\nexport function convert(amount, from, to) {\n  return Math.round((amount / RATES[from]) * RATES[to] * 100) / 100\n}\n`),
  D('src/billing/ledger.mjs', `export function balance(entries) {\n  return entries.reduce((b, e) => b + (e.kind === 'credit' ? e.amount : -e.amount), 0)\n}\n`),
  D('src/login/password.mjs', `import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'\nexport function hashPassword(pw) {\n  const salt = randomBytes(16)\n  return salt.toString('hex') + ':' + scryptSync(pw, salt, 32).toString('hex')\n}\nexport function checkPassword(pw, stored) {\n  const [salt, hash] = stored.split(':')\n  return timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'))\n}\n`),
  D('src/login/token.mjs', `import { createHmac } from 'node:crypto'\nexport function signToken(payload, secret) {\n  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')\n  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')\n}\n`),
  D('src/login/lockout.mjs', `export function isLockedOut(failures, limit = 5) {\n  return failures >= limit\n}\n\nexport function nextDelayMs(failures) {\n  return Math.min(60000, 500 * 2 ** failures)\n}\n`),
  D('src/mail/template.mjs', `export function render(template, vars) {\n  return template.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => (k in vars ? String(vars[k]) : ''))\n}\n`),
  D('src/mail/outbox.mjs', `const outbox = []\nexport function enqueueMail(to, subject, body) {\n  outbox.push({ to, subject, body, tries: 0 })\n  return outbox.length\n}\nexport function pendingMail() {\n  return outbox.filter((m) => m.tries < 3)\n}\n`),
  D('src/mail/addresses.mjs', `export function isEmail(s) {\n  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s)\n}\n\nexport function domainOf(s) {\n  return s.split('@')[1] ?? ''\n}\n`),
  D('src/geo/distance.mjs', `export function haversineKm(a, b) {\n  const r = (d) => (d * Math.PI) / 180\n  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon)\n  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2\n  return 6371 * 2 * Math.asin(Math.sqrt(h))\n}\n`),
  D('src/geo/zones.mjs', `export function zoneOffsetMinutes(zone) {\n  const table = { UTC: 0, CET: 60, EST: -300, PST: -480 }\n  return table[zone] ?? 0\n}\n`),
  D('src/reports/csv.mjs', `export function toCsv(rows, columns) {\n  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'\n  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\\n')\n}\n`),
  D('src/reports/chart.mjs', `export function barLengths(values, width = 20) {\n  const max = Math.max(1, ...values)\n  return values.map((v) => Math.round((v / max) * width))\n}\n`),
  D('src/reports/summary.mjs', `export function mean(xs) {\n  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0\n}\n\nexport function median(xs) {\n  const s = [...xs].sort((a, b) => a - b)\n  const m = Math.floor(s.length / 2)\n  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2\n}\n`),
  D('src/search/tokenize.mjs', `export function tokenize(text) {\n  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)\n}\n`),
  D('src/search/rank.mjs', `import { tokenize } from './tokenize.mjs'\nexport function rankDocs(docs, query) {\n  const q = new Set(tokenize(query))\n  return docs.map((d) => ({ d, hits: tokenize(d.text).filter((t) => q.has(t)).length })).sort((a, b) => b.hits - a.hits)\n}\n`),
  D('src/cache/lru.mjs', `export class Lru {\n  constructor(limit) { this.limit = limit; this.map = new Map() }\n  get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v }\n  set(k, v) { this.map.delete(k); this.map.set(k, v); if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value) }\n}\n`),
  D('src/cache/expiry.mjs', `export function isExpired(entry, now = Date.now()) {\n  return entry.expiresAt !== undefined && entry.expiresAt <= now\n}\n`),
  D('src/jobs/cron.mjs', `export function matchesMinute(spec, date) {\n  const [min, hour] = spec.split(' ')\n  return (min === '*' || Number(min) === date.getMinutes()) && (hour === '*' || Number(hour) === date.getHours())\n}\n`),
  D('src/jobs/retry.mjs', `export async function withRetry(fn, tries = 3) {\n  let last\n  for (let i = 0; i < tries; i++) { try { return await fn() } catch (e) { last = e } }\n  throw last\n}\n`),
  D('src/i18n/catalog.mjs', `const CATALOG = { en: { hello: 'Hello' }, de: { hello: 'Hallo' }, fr: { hello: 'Bonjour' } }\nexport function translate(lang, key) {\n  return CATALOG[lang]?.[key] ?? CATALOG.en[key] ?? key\n}\n`),
  D('src/i18n/numbers.mjs', `export function formatNumber(n, lang = 'en') {\n  return new Intl.NumberFormat(lang).format(n)\n}\n`),
  D('src/metrics/counter.mjs', `const counters = new Map()\nexport function inc(name, by = 1) {\n  counters.set(name, (counters.get(name) ?? 0) + by)\n}\nexport function snapshot() {\n  return Object.fromEntries(counters)\n}\n`),
  D('src/metrics/histogram.mjs', `export function bucketCounts(values, edges) {\n  const out = new Array(edges.length + 1).fill(0)\n  for (const v of values) { let i = 0; while (i < edges.length && v > edges[i]) i++; out[i]++ }\n  return out\n}\n`),
  D('src/storage/blob.mjs', `export function chunkBuffer(buf, size) {\n  const out = []\n  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size))\n  return out\n}\n`),
  D('src/units/convert.mjs', `export const celsiusToFahrenheit = (c) => c * 1.8 + 32\nexport const kmToMiles = (km) => km * 0.621371\n`),
  D('src/text/slug.mjs', `export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')\n}\n`),
  D('src/text/truncate.mjs', `export function truncate(s, max) {\n  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…'\n}\n`),
  D('test/units.test.mjs', `import test from 'node:test'\nimport assert from 'node:assert'\nimport { kmToMiles } from '../src/units/convert.mjs'\ntest('kmToMiles', () => { assert.ok(Math.abs(kmToMiles(10) - 6.21371) < 1e-6) })\n`),
]

export function padWorkspace(root: string, opts: { longGuide?: boolean } = {}): { added: string[]; relevant: string[] } {
  const added: string[] = []
  const relevant: Record<string, string> = opts.longGuide ? Object.fromEntries(Object.entries(RELEVANT).filter(([k]) => k !== 'docs/CONVENTIONS.md').concat([['docs/PLATFORM_GUIDE.md', GUIDE_A + '# Service conventions\n\n' + RELEVANT['docs/CONVENTIONS.md'].replace(/^# Service conventions\n\n/, '') + GUIDE_B]])) : RELEVANT
  for (const [rel, body] of [...Object.entries(relevant), ...DISTRACTORS]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body); added.push(rel)
  }
  return { added, relevant: [...(opts.longGuide ? PAD_RELEVANT_LONGGUIDE : PAD_RELEVANT)] }
}
