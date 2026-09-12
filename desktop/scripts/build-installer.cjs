/**
 * Phase 11D — Windows installer build with retry.
 *
 * electron-builder extracts the Electron zip into `<output>/win-unpacked.tmp`; on Windows that
 * freshly written tree is sometimes still held by the OS/AV scanner, producing
 * `EBUSY ... default_app.asar`. Retrying after clearing the partial `.tmp` resolves it.
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const desktopRoot = path.join(__dirname, '..')
const outputDir = process.env.WAR_ROOM_INSTALLER_OUTPUT || 'dist-release'
const absOutput = path.join(desktopRoot, outputDir)
const ATTEMPTS = 3

function clearPartial() {
  const tmp = path.join(absOutput, 'win-unpacked.tmp')
  if (fs.existsSync(tmp)) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* leave it; next attempt may succeed */
    }
  }
}

function installerPath() {
  if (!fs.existsSync(absOutput)) return null
  const hit = fs.readdirSync(absOutput).find(f => /War Room OS Setup\.exe$/i.test(f))
  return hit ? path.join(absOutput, hit) : null
}

const builder = path.join(desktopRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
if (!fs.existsSync(builder)) {
  console.error('electron-builder not installed in desktop/ — run npm install there first')
  process.exit(2)
}

/**
 * Code signing via Azure Trusted Signing, opt-in so unsigned local builds keep working.
 *
 * Set WAR_ROOM_AZURE_SIGNING=1 plus the five values below. Credentials are read from the
 * environment by Azure Identity itself (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
 * no secret is ever written into the repository or into electron-builder config on disk.
 *
 * WAR_ROOM_SIGN_PUBLISHER_NAME must match the certificate subject exactly — it is not invented
 * here, and it becomes the installer's publisher name.
 */
const SIGNING_VARS = [
  'WAR_ROOM_SIGN_PUBLISHER_NAME',
  'WAR_ROOM_SIGN_ENDPOINT',
  'WAR_ROOM_SIGN_ACCOUNT_NAME',
  'WAR_ROOM_SIGN_CERT_PROFILE',
]
const CREDENTIAL_VARS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']

function signingArgs() {
  if (process.env.WAR_ROOM_AZURE_SIGNING !== '1') {
    console.log('[installer] CODE_SIGNING: NOT_CONFIGURED (set WAR_ROOM_AZURE_SIGNING=1 to sign)')
    return []
  }
  const missing = [...SIGNING_VARS, ...CREDENTIAL_VARS].filter(name => !process.env[name])
  if (missing.length) {
    console.error(
      `[installer] WAR_ROOM_AZURE_SIGNING=1 but these variables are unset: ${missing.join(', ')}`,
    )
    process.exit(2)
  }
  console.log('[installer] CODE_SIGNING: AZURE_TRUSTED_SIGNING')
  return [
    // signExecutable/signAndEditExecutable defaults apply once real signing is configured.
    '--config.win.signExecutable=true',
    `--config.win.azureSignOptions.publisherName=${process.env.WAR_ROOM_SIGN_PUBLISHER_NAME}`,
    `--config.win.azureSignOptions.endpoint=${process.env.WAR_ROOM_SIGN_ENDPOINT}`,
    `--config.win.azureSignOptions.codeSigningAccountName=${process.env.WAR_ROOM_SIGN_ACCOUNT_NAME}`,
    `--config.win.azureSignOptions.certificateProfileName=${process.env.WAR_ROOM_SIGN_CERT_PROFILE}`,
  ]
}

const signing = signingArgs()

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  clearPartial()
  console.log(`[installer] attempt ${attempt}/${ATTEMPTS} output=${outputDir}`)
  const run = spawnSync(
    process.execPath,
    [builder, '--win', 'nsis', '--x64', `--config.directories.output=${outputDir}`, ...signing],
    {
      cwd: desktopRoot,
      stdio: 'inherit',
      // Unsigned local build: never let electron-builder go hunting for certificates.
      env: signing.length ? process.env : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    },
  )
  const built = installerPath()
  if (run.status === 0 && built) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          installer: built,
          bytes: fs.statSync(built).size,
          code_signing: signing.length ? 'AZURE_TRUSTED_SIGNING' : 'NOT_CONFIGURED',
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }
  console.error(`[installer] attempt ${attempt} failed (status=${run.status})`)
}

console.error(JSON.stringify({ ok: false, error: 'INSTALLER_BUILD_FAILED', output: absOutput }, null, 2))
process.exit(1)
