/**
 * #22 Phase 11D — per-surface icon verification.
 *
 * Verifies the Commander-approved icon on each Windows surface independently and reports
 * PASS / FAIL / NOT_SUPPORTED per surface. Failures are never aggregated into an overall PASS.
 *
 * Verification method: the approved ICO's 256x256 frame is a PNG payload. resedit (used by
 * electron-builder) writes icon frames verbatim into the executable's RT_ICON resources, so the
 * frame bytes must be findable inside the installed .exe. Shortcuts are resolved through the
 * Windows shell and must reference that same executable.
 *
 * Usage: node scripts/phase11d-icon-surface-proof.mjs [installDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const installDir = process.argv[2] || path.join(localApp, 'Programs', 'War Room OS')
const exePath = path.join(installDir, 'War Room OS.exe')

const assets = path.join(repoRoot, 'desktop', 'assets')
const pngPath = path.join(assets, 'war-room-os-icon.png')
const icoPath = path.join(assets, 'war-room-os.ico')
const approvalPath = path.join(assets, 'ICON_APPROVAL.txt')
const provenancePath = path.join(assets, 'ICON_PROVENANCE.json')

const surfaces = {}
const record = (name, verdict, detail) => {
  surfaces[name] = { verdict, detail }
  console.error(`[icon] ${name} = ${verdict} — ${detail}`)
}

/** Largest frame of an .ico, used as the fingerprint to look for inside binaries. */
function largestFrame(file) {
  const b = fs.readFileSync(file)
  let best = null
  for (let i = 0; i < b.readUInt16LE(4); i += 1) {
    const e = 6 + i * 16
    const width = b[e] === 0 ? 256 : b[e]
    const size = b.readUInt32LE(e + 8)
    const offset = b.readUInt32LE(e + 12)
    if (!best || width > best.width) best = { width, bytes: b.subarray(offset, offset + size) }
  }
  return best
}

function shortcutTarget(lnk) {
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${JSON.stringify(lnk)}); Write-Output "$($s.TargetPath)|$($s.IconLocation)"`
  const out = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return String(out.stdout || '').trim()
}

// ------------------------------------------------------- APPROVED_SOURCE_PNG
const provenance = fs.existsSync(provenancePath)
  ? JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  : null
if (!fs.existsSync(pngPath)) {
  record('APPROVED_SOURCE_PNG', 'FAIL', 'desktop/assets/war-room-os-icon.png missing')
} else if (!fs.existsSync(approvalPath)) {
  record('APPROVED_SOURCE_PNG', 'FAIL', 'desktop/assets/ICON_APPROVAL.txt missing — approval not granted')
} else if (provenance?.app_favicon_placeholder === true) {
  record('APPROVED_SOURCE_PNG', 'FAIL', 'PNG is the app/favicon.ico placeholder mark, not approved artwork')
} else if (provenance?.status !== 'COMMANDER_APPROVED_SUPPLIED_PNG') {
  record('APPROVED_SOURCE_PNG', 'FAIL', `provenance status ${provenance?.status}`)
} else {
  const stat = fs.statSync(pngPath)
  record(
    'APPROVED_SOURCE_PNG',
    'PASS',
    `${stat.size} bytes, sha256 ${provenance.png_sha256?.slice(0, 12)}…, redesigned=${provenance.redesigned}`,
  )
}

// ------------------------------------------------------------- WINDOWS_ICO
let approvedFrame = null
if (!fs.existsSync(icoPath)) {
  record('WINDOWS_ICO', 'FAIL', 'desktop/assets/war-room-os.ico missing')
} else {
  const b = fs.readFileSync(icoPath)
  const frames = []
  for (let i = 0; i < b.readUInt16LE(4); i += 1) {
    const e = 6 + i * 16
    frames.push(b[e] === 0 ? 256 : b[e])
  }
  approvedFrame = largestFrame(icoPath)
  const expected = [16, 24, 32, 48, 64, 128, 256]
  const complete = expected.every(s => frames.includes(s))
  record(
    'WINDOWS_ICO',
    complete && surfaces.APPROVED_SOURCE_PNG?.verdict === 'PASS' ? 'PASS' : 'FAIL',
    `${b.length} bytes, frames ${frames.join('/')}`,
  )
}

// ------------------------------------------------------- INSTALLED_EXE_ICON
if (!fs.existsSync(exePath)) {
  record('INSTALLED_EXE_ICON', 'FAIL', `installed executable not found at ${exePath}`)
} else if (!approvedFrame) {
  record('INSTALLED_EXE_ICON', 'FAIL', 'no approved ICO frame to compare against')
} else {
  const exe = fs.readFileSync(exePath)
  const found = exe.includes(approvedFrame.bytes)
  record(
    'INSTALLED_EXE_ICON',
    found ? 'PASS' : 'FAIL',
    found
      ? `approved ${approvedFrame.width}x${approvedFrame.width} frame embedded in War Room OS.exe`
      : 'approved icon frame NOT present in the installed executable',
  )
}

// ---------------------------------------- DESKTOP_SHORTCUT_ICON / START_MENU_ICON
const shortcuts = {
  DESKTOP_SHORTCUT_ICON: path.join(
    spawnSync('powershell', ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout.trim(),
    'War Room OS.lnk',
  ),
  START_MENU_ICON: path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'War Room OS.lnk',
  ),
}
for (const [name, lnk] of Object.entries(shortcuts)) {
  if (!fs.existsSync(lnk)) {
    record(name, 'FAIL', `shortcut missing: ${lnk}`)
    continue
  }
  const [target, iconLocation] = shortcutTarget(lnk).split('|')
  const pointsAtInstalledExe = path.normalize(target || '').toLowerCase() === exePath.toLowerCase()
  const iconFromExe = (iconLocation || '').toLowerCase().includes('war room os.exe')
  record(
    name,
    pointsAtInstalledExe && iconFromExe && surfaces.INSTALLED_EXE_ICON?.verdict === 'PASS'
      ? 'PASS'
      : 'FAIL',
    `target=${target} icon=${iconLocation}`,
  )
}

// ------------------------------------------------------------- WINDOW_ICON
const mainSrc = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'main.cjs'), 'utf8')
const windowIconWired =
  /resolveIconPath\(\)/.test(mainSrc) &&
  /winOpts\.icon\s*=\s*nativeImage\.createFromPath\(iconPath\)/.test(mainSrc)
record(
  'WINDOW_ICON',
  windowIconWired && surfaces.INSTALLED_EXE_ICON?.verdict === 'PASS' ? 'PASS' : 'FAIL',
  windowIconWired
    ? 'BrowserWindow receives the packaged approved icon'
    : 'BrowserWindow icon not wired in desktop/src/main.cjs',
)

// ------------------------------------------------------------ TASKBAR_ICON
// Windows derives the taskbar icon from the window/executable icon plus the AppUserModelID.
const appUserModelId = /setAppUserModelId\(/.test(mainSrc)
record(
  'TASKBAR_ICON',
  appUserModelId && surfaces.WINDOW_ICON?.verdict === 'PASS' ? 'PASS' : 'FAIL',
  appUserModelId
    ? 'AppUserModelID set; taskbar inherits the approved window/executable icon'
    : 'setAppUserModelId missing — taskbar grouping/icon identity not established',
)

const verdicts = Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, v.verdict]))
const allPass = Object.values(verdicts).every(v => v === 'PASS' || v === 'NOT_SUPPORTED')
console.log(
  JSON.stringify(
    {
      installDir,
      surfaces,
      ICON_ACCEPTANCE: allPass ? 'PASS' : 'FAIL',
    },
    null,
    2,
  ),
)
process.exit(allPass ? 0 : 1)
