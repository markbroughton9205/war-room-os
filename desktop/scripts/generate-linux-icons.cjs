/**
 * Linux hicolor icon sizes for GNOME/KDE theme lookup.
 *
 * Source MUST be desktop/assets/war-room-os.png (Commander Linux crest).
 * Does not touch desktop/assets/war-room-os-icon.png or war-room-os.ico.
 * Artwork is only resized to square standard sizes — no redesign.
 */
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const srcPng = path.join(root, 'assets', 'war-room-os.png')
const outDir = path.join(root, 'assets', 'linux-icons')
const SIZES = [16, 32, 48, 64, 128, 256, 512]

if (!fs.existsSync(srcPng)) {
  console.error(JSON.stringify({ ok: false, error: 'MISSING_LINUX_SOURCE_PNG', srcPng }, null, 2))
  process.exit(2)
}

const srcBuf = fs.readFileSync(srcPng)
const srcSha = crypto.createHash('sha256').update(srcBuf).digest('hex')
fs.mkdirSync(outDir, { recursive: true })

const py = `
from pathlib import Path
from PIL import Image
src = Path(${JSON.stringify(srcPng)})
out_dir = Path(${JSON.stringify(outDir)})
sizes = ${JSON.stringify(SIZES)}
img = Image.open(src)
if img.mode not in ("RGB", "RGBA"):
    img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
w, h = img.size
if w != h:
    raise SystemExit(f"SOURCE_NOT_SQUARE {w}x{h}")
written = []
for s in sizes:
    dest = out_dir / f"{s}x{s}.png"
    resized = img.resize((s, s), Image.Resampling.LANCZOS)
    resized.save(dest, format="PNG", optimize=True)
    written.append(str(dest))
print("LINUX_ICONS_OK")
print("\\n".join(written))
`

const result = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
if (result.status !== 0 || !String(result.stdout || '').includes('LINUX_ICONS_OK')) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'LINUX_ICON_GENERATION_FAILED',
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

const outputs = SIZES.map(s => {
  const file = path.join(outDir, `${s}x${s}.png`)
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ ok: false, error: 'MISSING_GENERATED_SIZE', file }, null, 2))
    process.exit(1)
  }
  return { size: `${s}x${s}`, file, bytes: fs.statSync(file).size }
})

console.log(
  JSON.stringify(
    {
      ok: true,
      source: 'desktop/assets/war-room-os.png',
      source_sha256: srcSha,
      source_bytes: srcBuf.length,
      redesigned: false,
      out_dir: 'desktop/assets/linux-icons',
      sizes: outputs,
    },
    null,
    2,
  ),
)
