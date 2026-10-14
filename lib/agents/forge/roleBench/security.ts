import { extractJson } from './exec'
import type { Fixture } from './types'

/** SECURITY_REVIEWER: ten vulnerable snippets (each a distinct class) and three safe look-alikes. Detection needs the right class named; a safe snippet with any finding is a false positive. */
type Case = { id: string; code: string; vuln: RegExp | null }
const CASES: Case[] = [
  { id: 'path_traversal', vuln: /path|travers|directory|\.\.|arbitrary file/i, code: "import fs from 'node:fs'\nimport path from 'node:path'\nexport function readDoc(base, name) {\n  return fs.readFileSync(path.join(base, name), 'utf8')\n}\n" },
  { id: 'sql_injection', vuln: /sql|inject/i, code: "export async function findUser(db, name) {\n  return db.query(\"SELECT * FROM users WHERE name = '\" + name + \"'\")\n}\n" },
  { id: 'command_injection', vuln: /command|shell|inject|exec/i, code: "import { exec } from 'node:child_process'\nexport function thumbnail(file, cb) {\n  exec('convert ' + file + ' -resize 64x64 out.png', cb)\n}\n" },
  { id: 'hardcoded_secret', vuln: /secret|hard-?cod|credential|api key|key/i, code: "const PAYMENT_API_SECRET = 'fixture-not-a-real-key-7f3a9c2e5b1d8046'\nexport async function charge(client, amount) {\n  return client.charges.create({ amount, currency: 'usd' }, { apiKey: PAYMENT_API_SECRET })\n}\n" },
  { id: 'missing_authorization', vuln: /auth|access control|permission|privilege|unauthori[sz]ed/i, code: "export function register(app, users) {\n  app.post('/admin/delete-user', (req, res) => {\n    users.delete(req.body.id)\n    res.sendStatus(204)\n  })\n}\n" },
  { id: 'predictable_session_token', vuln: /random|predictable|insecure|crypto|guess/i, code: "export function newSession(user) {\n  return { user, token: Math.random().toString(36).slice(2) }\n}\n" },
  { id: 'xss_inner_html', vuln: /xss|cross-?site|inner ?html|sanitiz|escap|inject/i, code: "export function showComment(el, comment) {\n  el.innerHTML = '<p>' + comment.text + '</p>'\n}\n" },
  { id: 'jwt_not_verified', vuln: /verif|signature|decode|forg/i, code: "import jwt from 'jsonwebtoken'\nexport function currentUser(req) {\n  const claims = jwt.decode(req.headers.authorization.split(' ')[1])\n  return claims.sub\n}\n" },
  { id: 'eval_user_input', vuln: /eval|code injection|arbitrary code|remote code/i, code: "export function calculate(req, res) {\n  const result = eval(req.body.expression)\n  res.json({ result })\n}\n" },
  { id: 'open_redirect', vuln: /redirect/i, code: "export function afterLogin(req, res) {\n  res.redirect(req.query.next)\n}\n" },
  { id: 'safe_parameterised_query', vuln: null, code: "export async function findUser(db, name) {\n  return db.query('SELECT * FROM users WHERE name = $1', [name])\n}\n" },
  { id: 'safe_contained_path', vuln: null, code: "import fs from 'node:fs'\nimport path from 'node:path'\nexport function readDoc(base, name) {\n  const root = path.resolve(base)\n  const full = path.resolve(root, name)\n  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('forbidden')\n  return fs.readFileSync(full, 'utf8')\n}\n" },
  { id: 'safe_unguessable_token', vuln: null, code: "import { randomBytes } from 'node:crypto'\nexport function newSession(user) {\n  return { user, token: randomBytes(32).toString('hex') }\n}\n" },
  { id: 'safe_text_content', vuln: null, code: "export function showComment(el, comment) {\n  const p = document.createElement('p')\n  p.textContent = comment.text\n  el.appendChild(p)\n}\n" },
  { id: 'safe_exec_file_args', vuln: null, code: "import { execFile } from 'node:child_process'\nexport function thumbnail(file, cb) {\n  if (!/^[\\w.-]+$/.test(file)) throw new Error('bad name')\n  execFile('convert', [file, '-resize', '64x64', 'out.png'], cb)\n}\n" },
  { id: 'safe_jwt_verified', vuln: null, code: "import jwt from 'jsonwebtoken'\nexport function currentUser(req, secret) {\n  const claims = jwt.verify(req.headers.authorization.split(' ')[1], secret, { algorithms: ['HS256'] })\n  return claims.sub\n}\n" },
  { id: 'safe_admin_guarded', vuln: null, code: "function requireAdmin(req, res, next) {\n  if (req.session?.role !== 'admin') return res.sendStatus(403)\n  next()\n}\nexport function register(app, users) {\n  app.post('/admin/delete-user', requireAdmin, (req, res) => {\n    users.delete(req.body.id)\n    res.sendStatus(204)\n  })\n}\n" },
]
const SYSTEM = 'You are a security reviewer. List ONLY real, exploitable vulnerabilities present in the code shown. Do not list style issues, hypothetical problems, or missing features. If the code is safe, return an empty findings array. Reply with one JSON object: {"findings": [{"category": "<vulnerability class>", "explanation": "<why it is exploitable>"}]}.'

export function securityFixtures(): Fixture[] {
  return CASES.map((c): Fixture => ({
    id: `security/${c.id}`, role: 'SECURITY_REVIEWER', system: SYSTEM, json: true, maxTokens: 500,
    prompt: `Review this code:\n\`\`\`js\n${c.code}\`\`\``,
    reference: JSON.stringify({ findings: c.vuln ? [{ category: c.vuln.source.split('|')[0], explanation: 'exploitable' }] : [] }),
    broken: JSON.stringify({ findings: c.vuln ? [] : [{ category: 'sql injection', explanation: 'invented' }] }),
    check(reply) {
      const j = extractJson<{ findings?: unknown }>(reply)
      if (!j || !Array.isArray(j.findings)) return { pass: false, detail: 'reply is not the requested JSON object', klass: c.vuln ? 'vulnerable' : 'safe' }
      const f = j.findings as { category?: unknown; explanation?: unknown }[]
      const text = (x: { category?: unknown; explanation?: unknown }) => `${String(x.category)} ${String(x.explanation)}`
      if (!c.vuln) return f.length === 0 ? { pass: true, detail: 'correctly found nothing', klass: 'safe' } : { pass: false, detail: `false positive: ${f.map((x) => String(x.category)).join(', ')}`, klass: 'safe' }
      return f.some((x) => c.vuln!.test(text(x))) ? { pass: true, detail: 'detected the vulnerability class', klass: 'vulnerable' } : { pass: false, detail: f.length ? `named something else: ${f.map((x) => String(x.category)).join(', ')}` : 'missed it', klass: 'vulnerable' }
    },
  }))
}
