// HOST-OWNED fixture package recipe: packs the CURRENT build's bundle (BP_IN) into app.pkg (header line + body). Flags: --fail --sleep=MS --wrong-source --ignore-term
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const argv = process.argv.slice(2), has = n => argv.includes(`--${n}`), val = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null }
const IN = process.env.BP_IN, OUT = process.env.BP_OUT, sleep = ms => new Promise(r => setTimeout(r, ms)), sha = b => createHash('sha256').update(b).digest('hex')
if (has('ignore-term')) process.on('SIGTERM', () => {})
if (has('fail')) { console.error('package failed: password=HUNTER2'); process.exit(3) }
const ms = Number(val('sleep') ?? 0); if (ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) await sleep(40) }
const bundle = fs.readFileSync(path.join(IN, 'bundle.mjs')); let body = bundle; if (has('wrong-source')) body = Buffer.from('// tampered\n' + bundle)
fs.writeFileSync(path.join(OUT, 'app.pkg'), JSON.stringify({ name: 'fixture-app', files: [{ name: 'bundle.mjs', sha256: sha(bundle), bytes: bundle.length }] }) + '\n' + body.toString())
