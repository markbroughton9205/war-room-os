// Host-owned dependency PROBE. Run only as `node --permission --allow-fs-read=<workspace> --allow-fs-read=<this file> depprobe.mjs <workspace> <name> <version>`:
// it can read the workspace but cannot write, spawn, or reach anything else. It proves the module actually LOADS from the workspace's own node_modules at the exact version.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, name, version] = process.argv.slice(2)
const out = r => { process.stdout.write(JSON.stringify(r) + '\n'); process.exit(r.ok ? 0 : 3) }
try {
  const nm = path.join(root, 'node_modules'), dir = path.join(nm, name), pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (fs.realpathSync(dir) !== path.join(fs.realpathSync(nm), name)) out({ ok: false, code: 'NOT_IN_WORKSPACE' })
  if (pj.version !== version) out({ ok: false, code: 'RESOLVED_VERSION_MISMATCH', resolved: pj.version })
  const req = createRequire(path.join(root, 'probe.cjs'))
  let entry; try { entry = req.resolve(name) } catch { out({ ok: false, code: 'NOT_RESOLVABLE' }) }
  const real = fs.realpathSync(entry); if (!real.startsWith(fs.realpathSync(dir) + path.sep)) out({ ok: false, code: 'NOT_IN_WORKSPACE' })
  let mod; try { mod = req(name) } catch { mod = await import(pathToFileURL(real).href) }
  const keys = Object.keys(mod ?? {}).slice(0, 20)
  const bins = []
  for (const [b, rel] of Object.entries(typeof pj.bin === 'string' ? { [pj.name]: pj.bin } : (pj.bin ?? {}))) {
    const t = path.join(dir, rel), st = fs.lstatSync(t); if (!st.isFile() || st.isSymbolicLink()) out({ ok: false, code: 'BIN_UNUSABLE', bin: b })
    bins.push([b, createHash('sha256').update(fs.readFileSync(t)).digest('hex')])
  }
  out({ ok: true, entryRel: path.relative(fs.realpathSync(dir), real), binRels: bins.map(([b]) => b), resolved: pj.version, entrySha: createHash('sha256').update(fs.readFileSync(real)).digest('hex'), pkgSha: createHash('sha256').update(fs.readFileSync(path.join(dir, 'package.json'))).digest('hex'), exportKeys: keys, bins })
} catch { out({ ok: false, code: 'PROBE_ERROR' }) }
