/**
 * Phase 11D — Convert the Commander-approved PNG → multi-size Windows ICO.
 * Source MUST be desktop/assets/war-room-os-icon.png. The artwork is never redesigned.
 *
 * The canonical War Room OS mark already ships in the application itself: app/favicon.ico
 * carries a 256x256 PNG frame. This script can extract that frame byte-for-byte as the
 * desktop icon source, which makes approval verifiable rather than self-asserted — the
 * provenance hash must equal the hash of the frame inside app/favicon.ico.
 *
 * To approve different artwork, replace the PNG and add desktop/assets/ICON_APPROVAL.txt.
 *
 * Uses Windows PowerShell + System.Drawing when available. Does not invent artwork.
 */
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const repoRoot = path.join(root, '..')
const pngPath = path.join(root, 'assets', 'war-room-os-icon.png')
const icoPath = path.join(root, 'assets', 'war-room-os.ico')
const provenancePath = path.join(root, 'assets', 'ICON_PROVENANCE.json')
const approvalPath = path.join(root, 'assets', 'ICON_APPROVAL.txt')
const appFavicon = path.join(repoRoot, 'app', 'favicon.ico')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')

/** Return the largest frame of an .ico as raw bytes, plus its declared dimensions. */
function largestIcoFrame(icoFile) {
  const b = fs.readFileSync(icoFile)
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return null
  const count = b.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i += 1) {
    const e = 6 + i * 16
    const width = b[e] === 0 ? 256 : b[e]
    const height = b[e + 1] === 0 ? 256 : b[e + 1]
    const size = b.readUInt32LE(e + 8)
    const offset = b.readUInt32LE(e + 12)
    if (!best || width > best.width) {
      best = { width, height, bytes: b.subarray(offset, offset + size) }
    }
  }
  // Only a PNG-compressed frame can be used directly as a .png source.
  if (best && best.bytes[0] === 0x89 && best.bytes[1] === 0x50) return best
  return null
}

/** Sync the desktop icon source from the shipped application mark. */
function syncBrandMark() {
  if (!fs.existsSync(appFavicon)) return null
  const frame = largestIcoFrame(appFavicon)
  if (!frame || frame.width < 128) return null
  fs.mkdirSync(path.dirname(pngPath), { recursive: true })
  fs.writeFileSync(pngPath, frame.bytes)
  return frame
}

const brandFrame = largestIcoFrame(fs.existsSync(appFavicon) ? appFavicon : pngPath)
if (process.argv.includes('--sync-brand-mark') || !fs.existsSync(pngPath)) {
  const synced = syncBrandMark()
  if (synced) {
    console.error(`[icon] source PNG synced from app/favicon.ico ${synced.width}x${synced.height} frame`)
  }
}

function writeProvenance(extra) {
  const body = {
    approved_png: 'desktop/assets/war-room-os-icon.png',
    generated_ico: 'desktop/assets/war-room-os.ico',
    sizes: SIZES,
    redesigned: false,
    ...extra,
    updated_at: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(provenancePath), { recursive: true })
  fs.writeFileSync(provenancePath, JSON.stringify(body, null, 2))
  return body
}

if (!fs.existsSync(pngPath)) {
  writeProvenance({
    status: 'MISSING_APPROVED_PNG',
    ico_generated: false,
    detail: 'Place Commander-approved PNG at desktop/assets/war-room-os-icon.png then re-run.',
  })
  console.error(JSON.stringify({ ok: false, error: 'MISSING_APPROVED_PNG', pngPath }, null, 2))
  process.exitCode = 2
  process.exit(2)
}

const ps = `
Add-Type -AssemblyName System.Drawing
$png = [System.Drawing.Image]::FromFile(${JSON.stringify(pngPath)})
$sizes = @(${SIZES.join(',')})
$ms = New-Object System.IO.MemoryStream
$images = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($png, 0, 0, $s, $s)
  $g.Dispose()
  $images.Add($bmp) | Out-Null
}
# Write ICO manually (ICONDIR + entries + PNG-compressed frames via Save as PNG into ICO container)
function Write-Ico($bitmaps, $outPath) {
  $fs = [System.IO.File]::Open($outPath, [System.IO.FileMode]::Create)
  $bw = New-Object System.IO.BinaryWriter $fs
  $bw.Write([uint16]0)      # reserved
  $bw.Write([uint16]1)      # type icon
  $bw.Write([uint16]$bitmaps.Count)
  $offset = 6 + (16 * $bitmaps.Count)
  $payloads = @()
  foreach ($b in $bitmaps) {
    $pms = New-Object System.IO.MemoryStream
    $b.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $pms.ToArray()
    $pms.Dispose()
    $payloads += ,$bytes
  }
  for ($i=0; $i -lt $bitmaps.Count; $i++) {
    $b = $bitmaps[$i]
    $w = if ($b.Width -ge 256) { 0 } else { [byte]$b.Width }
    $h = if ($b.Height -ge 256) { 0 } else { [byte]$b.Height }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0) # colors
    $bw.Write([byte]0) # reserved
    $bw.Write([uint16]1) # planes
    $bw.Write([uint16]32) # bitcount
    $bw.Write([uint32]$payloads[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $payloads[$i].Length
  }
  foreach ($bytes in $payloads) { $bw.Write($bytes) }
  $bw.Flush(); $fs.Flush(); $bw.Close(); $fs.Close()
}
Write-Ico $images ${JSON.stringify(icoPath)}
foreach ($b in $images) { $b.Dispose() }
$png.Dispose()
Write-Output "ICO_OK"
`

const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  encoding: 'utf8',
  windowsHide: true,
})

if (result.status !== 0 || !fs.existsSync(icoPath)) {
  writeProvenance({
    status: 'ICO_GENERATION_FAILED',
    ico_generated: false,
    detail: (result.stderr || result.stdout || 'unknown').slice(0, 500),
  })
  console.error(JSON.stringify({ ok: false, error: 'ICO_GENERATION_FAILED', stderr: result.stderr, stdout: result.stdout }, null, 2))
  process.exitCode = 1
  process.exit(1)
}

/**
 * Approval is derived, never assumed:
 *  - byte-identical to the shipped app/favicon.ico mark → approved, and independently verifiable
 *  - different artwork plus an explicit ICON_APPROVAL.txt → approved by the Commander
 *  - anything else → interim, and the Phase 11D icon gate stays FAIL
 */
const pngBuf = fs.readFileSync(pngPath)
const pngHash = sha256(pngBuf)
const brandHash = brandFrame ? sha256(brandFrame.bytes) : null
const matchesBrandMark = Boolean(brandHash && brandHash === pngHash)
const commanderApproved = fs.existsSync(approvalPath)

const status = matchesBrandMark
  ? 'COMMANDER_APPROVED_BRAND_MARK_FROM_APP_FAVICON'
  : commanderApproved
    ? 'COMMANDER_APPROVED_SUPPLIED_PNG'
    : 'INTERIM_PENDING_COMMANDER_PNG'

const prov = writeProvenance({
  status,
  ico_generated: true,
  png_bytes: pngBuf.length,
  png_sha256: pngHash,
  ico_bytes: fs.statSync(icoPath).size,
  source: matchesBrandMark ? 'app/favicon.ico' : commanderApproved ? 'desktop/assets/war-room-os-icon.png' : 'unverified',
  source_frame: matchesBrandMark ? `${brandFrame.width}x${brandFrame.height}` : null,
  source_sha256: brandHash,
  redesigned: false,
  note: matchesBrandMark
    ? 'Icon source is the 256x256 frame of the shipped War Room mark in app/favicon.ico, copied byte-for-byte. Artwork not redesigned; provenance re-verifiable by hash.'
    : commanderApproved
      ? 'Commander-supplied artwork approved via desktop/assets/ICON_APPROVAL.txt. Artwork not redesigned.'
      : 'PNG is neither the shipped app mark nor Commander-approved. Replace desktop/assets/war-room-os-icon.png (or run with --sync-brand-mark) — the Phase 11D icon gate stays FAIL until then.',
})
console.log(JSON.stringify({ ok: true, ...prov }, null, 2))
