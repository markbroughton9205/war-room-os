/* eslint-disable @typescript-eslint/no-unused-expressions -- host-owned recipe script */
// HOST-OWNED War Room blueprint recipe wr-bundle-build@1 (hash-pinned by the registry; materialized from embeddedTools.generated.ts).
// Runs under the node permission model: it may read the workspace and write ONLY its own output dir. Flags are part of the recipe identity (argv).
// Flags: --fail --no-output --sleep=MS --progress --chatty --use-dep --escape --extra --exec --symlink --ignore-term
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const argv = process.argv.slice(2), has = n => argv.includes(`--${n}`), val = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null }
const OUT = process.env.BP_OUT, sleep = ms => new Promise(r => setTimeout(r, ms))
if (has('ignore-term')) process.on('SIGTERM', () => { /* deliberately ignore: forces escalation */ })
if (has('progress')) for (let i = 1; i <= 3; i++) { console.log('BP_PROGRESS ' + JSON.stringify({ step: i, total: 3, note: `compile ${i}` })); await sleep(60) }
if (has('fail')) { console.error('build failed: boom token=SECRETVALUE123 at /home/someone/private/place'); process.exit(2) }
const ms = Number(val('sleep') ?? 0); if (ms) { const t0 = Date.now(); console.log('working'); while (Date.now() - t0 < ms) { await sleep(40); if (has('chatty')) console.log('tick') } }
const files = [], walk = d => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n), st = fs.statSync(f); st.isDirectory() ? walk(f) : f.endsWith('.mjs') && files.push(f) } }
walk(path.join(process.cwd(), 'src'))
let bundle = ''; for (const f of files) bundle += `// file: ${path.relative(process.cwd(), f)}\n${fs.readFileSync(f, 'utf8')}\n`
if (has('use-dep')) { const dep = createRequire(path.join(process.cwd(), 'x.js'))('tiny-dep'); bundle += `// dep: ${dep.describe()}\n` }
if (has('escape')) fs.writeFileSync(path.join(process.cwd(), 'leak.txt'), 'x') // must be DENIED by the permission model
if (has('no-output')) process.exit(0)
if (has('symlink')) { fs.symlinkSync(path.join(process.cwd(), 'src/a.mjs'), path.join(OUT, 'bundle.mjs')) } else fs.writeFileSync(path.join(OUT, 'bundle.mjs'), bundle)
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify({ files: files.length, sha: createHash('sha256').update(bundle).digest('hex'), runId: process.env.BP_RUN_ID }))
if (has('extra')) fs.writeFileSync(path.join(OUT, 'extra.txt'), 'surprise')
if (has('exec')) fs.chmodSync(path.join(OUT, 'bundle.mjs'), 0o755)
if (process.env.BP_APPROVED_FLAG) console.log('flag seen')
