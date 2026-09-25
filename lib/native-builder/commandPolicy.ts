import path from 'node:path'

/**
 * Typed command policy for War Room Engineer. Models propose structured operations;
 * this module classifies them. Nothing here executes.
 *
 * SAFE_LOCAL may run inside an authorized workspace after mission start.
 * REQUIRES_APPROVAL needs an explicit Commander gate (commit/push/outside-workspace/…).
 * DENIED never runs.
 */
export type CommandPolicyClass = 'SAFE_LOCAL' | 'REQUIRES_APPROVAL' | 'DENIED'

export type ClassifiedCommand = {
  policyClass: CommandPolicyClass
  reason: string
  approvalKind?: 'commit' | 'push' | 'deploy' | 'file_modification' | 'shell_mutating' | 'delete_data' | 'secrets_change'
}

const DENIED_GIT_SUB = /^(push|commit|merge|reset|rebase|checkout|clean)$/i

export function classifyArgv(cmd: string, args: readonly string[]): ClassifiedCommand {
  const base = cmd.replace(/\.cmd$/i, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const joined = [base, ...args].join(' ').toLowerCase()

  if (base === 'powershell' || base === 'pwsh' || base === 'cmd' || base === 'bash' || base === 'sh') {
    return { policyClass: 'DENIED', reason: 'Raw shell interpreters are never permitted. Use a typed Engineer operation.' }
  }
  if (/\brm\s+(-rf|--recursive)|remove-item\s+.*-recurse|format\s+|del\s+\/s|rd\s+\/s/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'Destructive recursive deletion is denied.', approvalKind: 'delete_data' }
  }
  if (/\breg(\.exe)?\b|\bnetsh\b|\bfirewall\b|\bschtasks\b/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'System-level configuration is denied.' }
  }
  if (/\bvercel\s+deploy|\bnetlify\s+deploy|\bpnpm\s+run\s+deploy|\bnpm\s+run\s+deploy/i.test(joined)) {
    return { policyClass: 'DENIED', reason: 'Deploy is never autonomous and is not implemented as an Engineer operation.', approvalKind: 'deploy' }
  }

  if (base === 'git') {
    const sub = args.find(a => !a.startsWith('-')) ?? ''
    if (DENIED_GIT_SUB.test(sub)) {
      if (/^push$/i.test(sub)) {
        return { policyClass: 'REQUIRES_APPROVAL', reason: 'git push requires Commander approval and is never autonomous.', approvalKind: 'push' }
      }
      if (/^commit$/i.test(sub)) {
        return { policyClass: 'REQUIRES_APPROVAL', reason: 'git commit requires Commander approval and is never autonomous.', approvalKind: 'commit' }
      }
      return { policyClass: 'DENIED', reason: `git ${sub} is a history-mutating operation and is denied.`, approvalKind: 'shell_mutating' }
    }
    if (/^(status|diff|log|show|branch|rev-parse|ls-files)$/i.test(sub)) {
      return { policyClass: 'SAFE_LOCAL', reason: 'Read-only git inspection.' }
    }
    if (/^init$/i.test(sub)) {
      return { policyClass: 'SAFE_LOCAL', reason: 'git init inside an authorized new workspace is local development.' }
    }
    return { policyClass: 'DENIED', reason: `git ${sub || '(missing subcommand)'} is not an allowlisted Engineer git operation.` }
  }

  if ((base === 'pnpm' || base === 'npm' || base === 'yarn') && args.some(a => a === '-g' || a === '--global')) {
    return { policyClass: 'REQUIRES_APPROVAL', reason: 'Global package installs require Commander approval.', approvalKind: 'shell_mutating' }
  }
  if ((base === 'pnpm' || base === 'npm' || base === 'yarn') && args[0] === 'install') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local dependency install.' }
  }
  const tokens = args.map(a => a.toLowerCase())
  const launchesDevServer =
    (base === 'next' && tokens.includes('dev')) ||
    (base === 'npx' && tokens.includes('next') && tokens.includes('dev')) ||
    ((base === 'pnpm' || base === 'npm' || base === 'yarn') && (tokens[0] === 'dev' || (tokens[0] === 'run' && tokens[1] === 'dev')))
  if (launchesDevServer) {
    return {
      policyClass: 'DENIED',
      reason: 'A package.json dev script may exist as tooling. Foundry must not launch next/pnpm/npm/yarn dev or port 3001. Installed War Room uses production UI :3848.',
    }
  }
  if (base === 'pnpm' || base === 'npm' || base === 'yarn' || base === 'node' || base === 'npx') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local Node toolchain command.' }
  }
  if (base === 'python' || base === 'python3' || base === 'py' || base === 'pip' || base === 'pip3' || base === 'uv' || base === 'pytest') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local Python toolchain command.' }
  }
  if (base === 'cargo' || base === 'dotnet' || base === 'tsc' || base === 'eslint') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Workspace-local compiler/test command.' }
  }

  return { policyClass: 'DENIED', reason: `Command "${base}" is not in the Engineer allowlist.` }
}

export function isSafeLocalCommand(cmd: string, args: readonly string[]): boolean {
  return classifyArgv(cmd, args).policyClass === 'SAFE_LOCAL'
}

/** Commands may only use a cwd inside the authorized workspace without a new Commander approval. */
export function classifyCommandCwd(cwd: string, workspaceRoot: string): ClassifiedCommand {
  const root = path.resolve(workspaceRoot)
  const abs = path.resolve(cwd)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      policyClass: 'REQUIRES_APPROVAL',
      reason: 'Command cwd is outside the authorized workspace.',
      approvalKind: 'shell_mutating',
    }
  }
  return { policyClass: 'SAFE_LOCAL', reason: 'cwd is inside the authorized workspace.' }
}

/**
 * Browser tools are not argv commands, but they can still reach arbitrary network/filesystem
 * targets if unconstrained — an SSRF-shaped risk classifyArgv was never built to see. Foundry's
 * browser tool may only look at the local machine (loopback) or files inside the workspace it is
 * already trusted to read.
 */
export function classifyBrowserTarget(rawUrl: string): ClassifiedCommand {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { policyClass: 'DENIED', reason: `Not a valid URL: ${rawUrl}` }
  }
  if (parsed.protocol === 'file:') {
    // file:// containment (repo-root escape, denylisted paths) is enforced by the caller via
    // repositoryInspector's resolveRepoRelativePath/assertCanonicalRepoPath — this only confirms
    // the scheme itself is one we ever consider.
    return { policyClass: 'SAFE_LOCAL', reason: 'file:// target — containment enforced separately.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { policyClass: 'DENIED', reason: `Browser scheme not permitted: ${parsed.protocol}` }
  }
  const host = parsed.hostname.toLowerCase()
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return { policyClass: 'SAFE_LOCAL', reason: 'Loopback target.' }
  }
  // Persistent internet browser: bounded documentation/research allowlist.
  // Arbitrary public hosts remain DENIED — this is not an open SSRF proxy.
  if (SAFE_PUBLIC_BROWSER_HOSTS.has(host)) {
    return { policyClass: 'SAFE_LOCAL', reason: `Allowlisted public Internet target (${host}).` }
  }
  return { policyClass: 'DENIED', reason: `Browser target must be loopback or an allowlisted public host (example.com / example.org), got: ${host}` }
}

/** Hosts the Foundry persistent browser may fetch besides loopback. Keep this list tiny. */
export const SAFE_PUBLIC_BROWSER_HOSTS = new Set([
  'example.com',
  'www.example.com',
  'example.org',
  'www.example.org',
  'developer.mozilla.org',
  'react.dev',
  'nextjs.org',
  'nodejs.org',
  'www.typescriptlang.org',
  'docs.cesium.com',
  'github.com',
])

/**
 * Installing a new build is a system-affecting action (it can replace what a real launcher
 * points at). A target under the real `~/.local/opt` install root is DENIED outright for an
 * autonomous mission; anywhere else requires explicit Commander confirmation.
 */
export function classifyInstallTarget(installRoot: string, realOptRoot: string): ClassifiedCommand {
  const target = path.resolve(installRoot)
  const real = path.resolve(realOptRoot)
  const rel = path.relative(real, target)
  const insideRealOpt = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  if (insideRealOpt) {
    return {
      policyClass: 'DENIED',
      reason: 'Installing directly into the real ~/.local/opt install root is never autonomous.',
      approvalKind: 'shell_mutating',
    }
  }
  return {
    policyClass: 'REQUIRES_APPROVAL',
    reason: 'Install target requires explicit Commander confirmation (commanderConfirmed: true).',
    approvalKind: 'shell_mutating',
  }
}

/**
 * PASS 002 — the dedicated production-install pathway (installerTool.installerInstallProduction).
 * Unlike classifyInstallTarget, this ALLOWS a target inside the real ~/.local/opt root, but never
 * as SAFE_LOCAL: it always requires explicit Commander confirmation, and it still refuses the bare
 * root directory itself (an install must always be a NEW named, versioned subdirectory — never
 * something that could collide with or overwrite the root or an existing sibling install).
 */
export function classifyProductionInstallTarget(installDir: string, realOptRoot: string): ClassifiedCommand {
  const target = path.resolve(installDir)
  const real = path.resolve(realOptRoot)
  if (target === real) {
    return {
      policyClass: 'DENIED',
      reason: 'A production install must target a new named subdirectory of the real install root, never the root itself.',
      approvalKind: 'shell_mutating',
    }
  }
  const rel = path.relative(real, target)
  const insideRealOpt = !rel.startsWith('..') && !path.isAbsolute(rel)
  if (!insideRealOpt) {
    return {
      policyClass: 'DENIED',
      reason: 'installerInstallProduction only targets the real install root — use installerInstall for tmp/ overrides.',
      approvalKind: 'shell_mutating',
    }
  }
  return {
    policyClass: 'REQUIRES_APPROVAL',
    reason: 'Production install into the real ~/.local/opt root requires explicit Commander confirmation (commanderConfirmed: true).',
    approvalKind: 'shell_mutating',
  }
}
