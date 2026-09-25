/**
 * Foundry must distinguish development *tooling* from a required development *runtime*.
 *
 * A package.json "dev" script (pnpm/next dev, port 3001) may exist.
 * Installed War Room and Foundry missions must not launch it.
 * Presence of that script is not a reason to mutate package.json.
 */
import type { FoundryAction } from './foundryActions'
import { LOCAL_UI_ORIGIN } from '@/lib/sovereign-runtime/constants'

const LOCAL_UI_HOST_PORT = LOCAL_UI_ORIGIN.replace(/^https?:\/\//, '')

export const DEV_SERVER_REQUIREMENT_PASS =
  `DEV_TOOLING_PRESENT. DEV_RUNTIME_REQUIRED=false. package.json left unchanged. Installed Foundry uses production UI ${LOCAL_UI_HOST_PORT} with relative /api paths. Do not start next/pnpm/npm/yarn dev or bind port 3001.`

const PACKAGE_JSON = /(^|\/)package\.json$/i
const DEV_SCRIPT_KEY = /["']dev["']\s*:/
const DEV_RUNTIME_LANGUAGE =
  /dev(elopment)?\s+server|next\s+dev|pnpm\s+(run\s+)?dev|npm\s+(run\s+)?dev|yarn\s+(run\s+)?dev|port\s+3001|localhost:3001|must not.*(dev|3001)|conflict.*dev script/i

export type DevRuntimeVerdict = {
  toolingPresent: boolean
  runtimeRequired: boolean
  requirement: 'PASS' | 'FAIL'
  detail: string
}

export function classifyDevRuntime(opts: {
  productionRouteOn3848: boolean
  relativeFoundryApis: boolean
  installedSpawnsNextDev: boolean
  installedSpawnsPort3001: boolean
  missionRequiresPort3001: boolean
}): DevRuntimeVerdict {
  const runtimeRequired =
    !opts.productionRouteOn3848 ||
    !opts.relativeFoundryApis ||
    opts.installedSpawnsNextDev ||
    opts.installedSpawnsPort3001 ||
    opts.missionRequiresPort3001
  return {
    toolingPresent: true,
    runtimeRequired,
    requirement: runtimeRequired ? 'FAIL' : 'PASS',
    detail: runtimeRequired
      ? 'DEV_RUNTIME_REQUIRED — installed Foundry still depends on a development server.'
      : DEV_SERVER_REQUIREMENT_PASS,
  }
}

export function isPackageJsonPath(filePath: string): boolean {
  return PACKAGE_JSON.test(filePath.replace(/\\/g, '/'))
}

/** True when the model is trying to edit package.json only to fight a "dev" script. */
export function isUnnecessaryDevScriptPackageMutation(action: FoundryAction): boolean {
  if (action.type !== 'PATCH_FILE' && action.type !== 'DELETE_FILE') return false
  if (!isPackageJsonPath(action.path)) return false
  if (action.type === 'DELETE_FILE') {
    return DEV_RUNTIME_LANGUAGE.test(action.reason ?? '')
  }
  const blob = `${action.matchText}\n${action.replacementText}\n${action.reason ?? ''}`
  const hadDev = DEV_SCRIPT_KEY.test(action.matchText)
  const hasDev = DEV_SCRIPT_KEY.test(action.replacementText)
  const removingDev = hadDev && !hasDev
  const rewritingDevAway =
    hadDev && hasDev && /next\s+dev|port\s+3001/.test(action.matchText) && !/next\s+dev|port\s+3001/.test(action.replacementText)
  return removingDev || rewritingDevAway || (hadDev && DEV_RUNTIME_LANGUAGE.test(blob))
}

export function isDevServerLaunch(cmd: string, args: readonly string[] = []): boolean {
  const base = cmd.replace(/\.cmd$/i, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const tokens = args.map(a => a.toLowerCase())
  if (base === 'next' && tokens.includes('dev')) return true
  if (base === 'npx' && tokens.includes('next') && tokens.includes('dev')) return true
  if ((base === 'pnpm' || base === 'npm' || base === 'yarn') && (tokens[0] === 'dev' || (tokens[0] === 'run' && tokens[1] === 'dev'))) return true
  const joined = [base, ...tokens].join(' ')
  if (/\bnext\s+dev\b/.test(joined)) return true
  if (/\b(--port|-p)\s*3001\b/.test(joined) && (base === 'next' || tokens.includes('next') || tokens.includes('dev'))) return true
  return false
}

export function isDevPackageScript(operation: { id?: string; targets?: string[] } | undefined): boolean {
  if (!operation) return false
  if (operation.id !== 'package_script') return false
  return (operation.targets?.[0] ?? '').toLowerCase() === 'dev'
}
