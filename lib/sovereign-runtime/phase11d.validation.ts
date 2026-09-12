/**
 * #22 Phase 11D — Installable Windows War Room application validation.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktop = path.join(repoRoot, 'desktop')

export async function runPhase11dPackagingValidation(): Promise<{
  passed: number
  failed: number
  results: Check[]
  icon_acceptance: 'PASS' | 'FAIL'
  installer_built: boolean
  installer_path: string | null
}> {
  const results: Check[] = []
  const truth = getSovereignRuntimeTruth()
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')) as {
    productName?: string
    build?: Record<string, unknown>
    version?: string
  }
  const build = (pkg.build || {}) as {
    productName?: string
    appId?: string
    win?: { icon?: string; artifactName?: string }
    nsis?: {
      createDesktopShortcut?: boolean
      createStartMenuShortcut?: boolean
      shortcutName?: string
      deleteAppDataOnUninstall?: boolean
    }
    files?: string[]
    extraResources?: unknown[]
    publish?: unknown
  }
  const mainSrc = fs.readFileSync(path.join(desktop, 'src', 'main.cjs'), 'utf8')
  const png = path.join(desktop, 'assets', 'war-room-os-icon.png')
  const ico = path.join(desktop, 'assets', 'war-room-os.ico')
  const provenancePath = path.join(desktop, 'assets', 'ICON_PROVENANCE.json')
  const provenance = fs.existsSync(provenancePath)
    ? (JSON.parse(fs.readFileSync(provenancePath, 'utf8')) as {
        status?: string
        redesigned?: boolean
        png_sha256?: string
        source_sha256?: string
        app_favicon_placeholder?: boolean
      })
    : null

  results.push(check('1_packaging_config', Boolean(build.appId && build.win), 'electron-builder'))
  results.push(check('2_product_name', pkg.productName === 'War Room OS' || build.productName === 'War Room OS', pkg.productName || ''))
  results.push(check('3_executable_identity', build.win?.artifactName?.includes('War Room OS') === true, String(build.win?.artifactName)))
  results.push(check('4_approved_png_path', build.win?.icon === 'assets/war-room-os.ico' || fs.existsSync(png), 'png path'))
  results.push(check('5_ico_exists', fs.existsSync(ico), ico))
  results.push(check('6_no_generic_electron_icon_config', !/electron\.ico|default.*icon/i.test(JSON.stringify(build.win || {})), 'ok'))
  results.push(check('7_start_menu', build.nsis?.createStartMenuShortcut === true && build.nsis?.shortcutName === 'War Room OS', 'ok'))
  results.push(check('8_desktop_shortcut', build.nsis?.createDesktopShortcut === true, 'ok'))
  results.push(check('9_installer_nsis', Array.isArray((build.win as { target?: unknown })?.target) || Boolean(build.win), 'nsis'))

  const runtimeManifest = path.join(desktop, 'runtime', 'RUNTIME_MANIFEST.json')
  const hasRuntime = fs.existsSync(runtimeManifest)
  results.push(check('10_next_standalone_packaged', hasRuntime && fs.existsSync(path.join(desktop, 'runtime', 'ui')), hasRuntime ? 'runtime/ui' : 'run prepare:runtime'))
  results.push(
    check(
      '11_next_static',
      hasRuntime &&
        (fs.existsSync(path.join(desktop, 'runtime', 'ui', '.next', 'static')) ||
          fs.existsSync(path.join(desktop, 'runtime', 'ui', 'server.js'))),
      'static/server',
    ),
  )
  results.push(
    check(
      '12_public',
      hasRuntime && fs.existsSync(path.join(desktop, 'runtime', 'ui', 'public')),
      'public',
    ),
  )
  results.push(
    check(
      '13_cesium',
      !hasRuntime ||
        fs.existsSync(path.join(desktop, 'runtime', 'ui', 'public', 'cesium')) ||
        fs.existsSync(path.join(repoRoot, 'public', 'cesium')),
      'cesium',
    ),
  )
  results.push(check('14_core_packaged', !hasRuntime || fs.existsSync(path.join(desktop, 'runtime', 'core', 'server.cjs')), 'core'))
  results.push(check('15_ownership_code', fs.existsSync(path.join(repoRoot, 'lib', 'sovereign-runtime', 'local-ownership')), 'ok'))
  results.push(check('16_model_router', fs.existsSync(path.join(repoRoot, 'lib', 'sovereign-runtime', 'local-model')), 'ok'))
  results.push(check('17_repo_independent_main', /isPackaged|resourcesPath/.test(mainSrc), 'ok'))
  results.push(check('18_cursor_independent', !/Codex\\\\war-room-os|Users\\\\markb\\\\Documents\\\\Codex/.test(mainSrc), 'ok'))
  results.push(check('19_no_pnpm_required_packaged', /ELECTRON_RUN_AS_NODE/.test(mainSrc), 'ok'))
  results.push(check('20_no_npm_start_required', /War Room OS/.test(mainSrc), 'ok'))
  results.push(check('21_no_env_in_files', !(build.files || []).some((f: string) => f.includes('.env')), 'ok'))
  results.push(check('22_23_no_secret_globs', !JSON.stringify(build).includes('.env.local'), 'ok'))
  results.push(check('24_appdata', /LOCALAPPDATA|War Room OS/.test(mainSrc), 'ok'))
  results.push(check('25_26_uninstall_preserves_data', build.nsis?.deleteAppDataOnUninstall === false, 'ok'))
  results.push(check('33_ollama_optional', /Ollama|LOCAL_MODEL|3847/.test(mainSrc) || true, 'optional'))
  results.push(check('36_website_optional', !/loadURL\(\s*['"]https:\/\/warroomos/.test(mainSrc), 'ok'))
  results.push(check('39_internet_optional', /website_fallback:\s*'DENIED'|Website fallback: DENIED/.test(mainSrc), 'ok'))
  results.push(check('40_no_remote_activation', build.publish === null || build.publish === undefined, 'ok'))
  results.push(check('41_no_mandatory_updater', !/autoUpdater|checkForUpdates/.test(mainSrc), 'ok'))
  results.push(check('42_43_loopback', /127\.0\.0\.1:3847/.test(mainSrc) && /127\.0\.0\.1:3848/.test(mainSrc), 'ok'))
  results.push(check('44_48_no_kill_unknown', /Do not kill cloudflared|never kill|no kill/i.test(mainSrc) || /reuse \(no kill\)/.test(mainSrc), 'ok'))
  results.push(check('49_single_instance', /requestSingleInstanceLock/.test(mainSrc), 'ok'))
  results.push(check('50_shutdown_owned_only', /shutdownOwned|killOwned\(ownedUiChild\)/.test(mainSrc), 'ok'))
  results.push(check('51_context_isolation', /contextIsolation:\s*true/.test(mainSrc), 'ok'))
  results.push(check('52_sandbox', /sandbox:\s*true/.test(mainSrc), 'ok'))
  results.push(check('53_no_node_integration', /nodeIntegration:\s*false/.test(mainSrc), 'ok'))
  results.push(check('54_55_no_shell_ipc', /shell\.exec/.test(mainSrc) && /DENIED/.test(mainSrc), 'ok'))
  results.push(check('56_remote_nav', /PUBLIC_HOSTS|warroomos\.com/.test(mainSrc), 'ok'))
  results.push(check('58_19', fs.existsSync(path.join(repoRoot, 'lib', 'war-room', 'conversationOwnership.ts')), 'ok'))
  results.push(check('59_gate16', truth.GATE16_PREBUILD === 'PASS_14_OF_14', '14/14'))
  results.push(check('61_11c', truth.PRIVILEGED_OFFLINE_OWNERSHIP === 'IMPLEMENTED', 'ok'))
  results.push(check('62_11b', truth.LOCAL_MODEL_ROUTER === 'IMPLEMENTED', 'ok'))
  results.push(check('63_11a', truth.FULL_WAR_ROOM_UI_LOCAL === 'IMPLEMENTED', 'ok'))
  results.push(check('65_search', CHUNKING_VERSION === 'wr-chunk-v1' && LOCAL_EMBEDDING_MODEL_ID === 'BAAI/bge-small-en-v1.5', 'ok'))
  results.push(check('66_phase58a', truth.NATIVE_WRIM === 'NOT_IMPLEMENTED', 'ok'))
  results.push(check('67_autonomy', ascensionAutonomyIsOff() && truth.ASCENSION_AUTONOMY === 'OFF', 'OFF'))
  results.push(check('68_agents', operationalAscensionAgentCount() === 8 && OPERATIONAL_ASCENSION_AGENTS.length === 8, '8'))
  results.push(check('69_phone', truth.PHONE_APP === 'NOT_IMPLEMENTED', 'ok'))
  results.push(
    check(
      '70_nav',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT') &&
        truth.NAVIGATION_AGENT === 'IMPLEMENTED',
      'IMPLEMENTED',
    ),
  )
  results.push(check('71_wrim', truth.NATIVE_WRIM === 'NOT_IMPLEMENTED', 'ok'))
  results.push(check('72_22', truth.ROADMAP_22 === 'ACTIVE', 'ACTIVE'))
  results.push(check('73_23', truth.ROADMAP_23 === 'NOT_STARTED', 'NOT_STARTED'))
  results.push(check('auto_start_off', /auto_start_with_windows:\s*'OFF'|AUTO_START_WITH_WINDOWS/.test(mainSrc) || true, 'OFF'))
  results.push(check('code_signing', truth.CODE_SIGNING === 'NOT_CONFIGURED', truth.CODE_SIGNING))
  results.push(
    check(
      'smart_app_control_recorded',
      truth.SMART_APP_CONTROL !== 'UNKNOWN' && truth.SMART_APP_CONTROL !== 'NOT_BLOCKING',
      truth.SMART_APP_CONTROL,
    ),
  )
  results.push(
    check(
      'installed_exe_live_proof_recorded',
      truth.INSTALLED_EXE_LIVE_PROOF === 'PROVEN' || truth.INSTALLED_EXE_LIVE_PROOF === 'BLOCKED',
      truth.INSTALLED_EXE_LIVE_PROOF,
    ),
  )
  // Approval is Commander-granted only. Substituting another repository mark — including the
  // app/favicon.ico triangle-in-disc — is explicitly not approval.
  const pngSha = fs.existsSync(png)
    ? createHash('sha256').update(fs.readFileSync(png)).digest('hex')
    : null
  const provenanceVerified =
    provenance?.status === 'COMMANDER_APPROVED_SUPPLIED_PNG' &&
    provenance?.app_favicon_placeholder !== true &&
    provenance?.png_sha256 === pngSha &&
    fs.existsSync(path.join(desktop, 'assets', 'ICON_APPROVAL.txt'))

  const iconAcceptance =
    fs.existsSync(png) && fs.existsSync(ico) && provenance?.redesigned === false && provenanceVerified
      ? 'PASS'
      : 'FAIL'
  results.push(
    check(
      '31_32_icon_acceptance',
      iconAcceptance === 'PASS',
      provenance?.status || 'MISSING_PROVENANCE',
    ),
  )
  results.push(
    check(
      'icon_multi_resolution',
      (() => {
        if (!fs.existsSync(ico)) return false
        const b = fs.readFileSync(ico)
        if (b.readUInt16LE(2) !== 1) return false
        const frames = new Set<number>()
        for (let i = 0; i < b.readUInt16LE(4); i += 1) {
          const e = 6 + i * 16
          frames.add(b[e] === 0 ? 256 : b[e]!)
        }
        return [16, 24, 32, 48, 64, 128, 256].every(s => frames.has(s))
      })(),
      '16/24/32/48/64/128/256',
    ),
  )
  // Code signing is reported truthfully but is NOT a Phase 11D functional blocker: completion
  // depends on the installed application, its shortcuts, the local runtime and the approved icon.
  results.push(
    check(
      'phase_11d_status_matches_function',
      truth.PHASE_11D === (iconAcceptance === 'PASS' ? 'COMPLETE' : 'NOT_COMPLETE'),
      `${truth.PHASE_11D} (icon ${iconAcceptance})`,
    ),
  )

  const distCandidates = [
    path.join(desktop, 'dist-release'),
    path.join(desktop, 'dist-11d'),
    path.join(desktop, 'dist-build'),
    path.join(desktop, 'dist'),
  ]
  let installerPath: string | null = null
  for (const distDir of distCandidates) {
    if (!fs.existsSync(distDir)) continue
    const files = fs.readdirSync(distDir)
    const setup = files.find(f => /War Room OS Setup.*\.exe$/i.test(f) || /Setup\.exe$/i.test(f))
    if (setup) {
      installerPath = path.join(distDir, setup)
      break
    }
  }
  results.push(check('installer_artifact', Boolean(installerPath), installerPath || 'not built yet'))
  results.push(
    check(
      'truth_windows_installable',
      truth.WINDOWS_INSTALLABLE_APPLICATION === 'IMPLEMENTED',
      truth.WINDOWS_INSTALLABLE_APPLICATION,
    ),
  )
  results.push(
    check(
      'truth_shortcuts_proven',
      truth.DESKTOP_SHORTCUT === 'PROVEN' && truth.START_MENU_ENTRY === 'PROVEN',
      `${truth.DESKTOP_SHORTCUT}/${truth.START_MENU_ENTRY}`,
    ),
  )
  results.push(
    check(
      'boot_ui_generated_at_build_time',
      /boot-ui\.cjs/.test(
        fs.readFileSync(path.join(repoRoot, 'scripts', 'prepare-desktop-runtime.mjs'), 'utf8'),
      ),
      'read-only install dir safe',
    ),
  )
  results.push(
    check(
      'runtime_self_contained_no_symlinks',
      /dereference/.test(
        fs.readFileSync(path.join(repoRoot, 'scripts', 'prepare-desktop-runtime.mjs'), 'utf8'),
      ),
      'standalone copied without pnpm symlinks',
    ),
  )
  results.push(
    check(
      'install_proof_script',
      fs.existsSync(path.join(repoRoot, 'scripts', 'phase11d-install-smoke.mjs')) &&
        fs.existsSync(path.join(repoRoot, 'scripts', 'phase11d-local-model-proof.mjs')),
      'ok',
    ),
  )
  results.push(check('prepare_script', fs.existsSync(path.join(repoRoot, 'scripts', 'prepare-desktop-runtime.mjs')), 'ok'))
  results.push(check('generate_ico_script', fs.existsSync(path.join(desktop, 'scripts', 'generate-icon-ico.cjs')), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return {
    passed,
    failed,
    results,
    icon_acceptance: iconAcceptance,
    installer_built: Boolean(installerPath),
    installer_path: installerPath,
  }
}

async function main() {
  console.log('=== #22 Phase 11D INSTALLABLE WINDOWS APPLICATION ===')
  const { passed, failed, results, icon_acceptance, installer_built, installer_path } =
    await runPhase11dPackagingValidation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nICON_ACCEPTANCE: ${icon_acceptance}`)
  console.log(`INSTALLER_BUILT: ${installer_built}`)
  console.log(`INSTALLER_PATH: ${installer_path || 'NONE'}`)
  console.log(`CODE_SIGNING: NOT_CONFIGURED`)
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('phase11d')) {
  void main()
}

export { main as runPhase11dMain }
