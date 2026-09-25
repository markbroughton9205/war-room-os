/**
 * W4 source + in-process fixtures: governed Workbench SCM.
 * Disposable Git only. Never commit/push the canonical War Room repo.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { runFoundryWorkbenchW3Validation } from './foundryWorkbenchW3.validation'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { executeEngineerTool } from './engineerTools'
import { FOUNDRY_AUTHORITY_SNAPSHOT } from './foundryContractTypes'
import { FOUNDRY_WORKBENCH_EVENT_TYPES, foundryWorkbenchEventsRegisteredOnAgentBus } from './foundryWorkbenchEvents'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import {
  AUTO_COMMIT_AFTER_AI_EDIT,
  AUTO_PUSH_AFTER_COMMIT,
  CHECKOUT_POLICY,
  FETCH_POLICY,
  MERGE_POLICY,
  PULL_POLICY,
  REBASE_POLICY,
  STOCK_GIT_MUTATION_COMMANDS,
  SYNC_DISABLED_UNTIL_GOVERNED,
  W4_HUNK_PROPOSAL_STATUS,
  WORKTREE_POLICY,
  collectScmSnapshot,
  ensureFoundryWorkbenchW4Fixture,
  envelopeWithScm,
  runFoundryW4Command,
  stockGitMutationWiredInAdapter,
  w4AuthorityStillZero,
} from './foundryWorkbenchW4'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function git(args: string[], cwd: string) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true })
}

async function run() {
  await runFoundryWorkbenchW3Validation()
  const results: CaseResult[] = []
  const adapter = source('desktop/workbench-host/extensions/foundry-adapter/extension.js')
  const adapterPkg = source('desktop/workbench-host/extensions/foundry-adapter/package.json')
  const policy = source('desktop/workbench-host/policy.cjs')
  const pane = source('components/war-room/foundry/FoundryWorkbenchAiPanel.tsx')
  const w4 = source('lib/native-builder/foundryWorkbenchW4.ts')
  const main = source('desktop/src/main.cjs')

  results.push(check('flag_default_off', isFoundryWorkbenchW0Enabled({} as NodeJS.ProcessEnv) === false, 'default off'))
  results.push(check('git_ui_enabled', /git\.enabled': true/.test(policy) && /showCommitInput': false/.test(policy), 'native Git UI, stock commit input hidden'))
  results.push(check('mutation_unbound', /command: '-git.commit'/.test(policy) && /command: '-git.push'/.test(policy) && /command: '-git.sync'/.test(policy) && /command: '-git.publish'/.test(policy) && /command: '-git.forcePush'/.test(policy), 'stock mutation keys unbound'))
  results.push(check('adapter_no_stock_git_exec', stockGitMutationWiredInAdapter(adapter) === 0, `wired=${stockGitMutationWiredInAdapter(adapter)}`))
  results.push(check('adapter_scm_commands', /foundry.reviewChanges/.test(adapterPkg) && /foundry.governedCommit/.test(adapterPkg) && /foundry.governedPush/.test(adapterPkg), 'Foundry SCM commands'))
  results.push(check('adapter_git_wrap', /__foundryGoverned/.test(adapter) && /interceptGitApi/.test(adapter), 'vscode.git API wrap'))
  results.push(check('openvsx_off', /serviceUrl: ''/.test(source('desktop/workbench-host/prepare.cjs')), 'OpenVSX off'))
  results.push(check('marketplace_off', !/marketplace\.visualstudio\.com/.test(source('desktop/workbench-host/index.cjs')), 'Marketplace off'))
  results.push(check('no_sandbox', !/appendSwitch\(['"]no-sandbox['"]\)/.test(main), 'sandbox policy unchanged'))
  results.push(check('events_registered', foundryWorkbenchEventsRegisteredOnAgentBus() && ['SCM_STAGE', 'SCM_COMMIT_REFUSED', 'SCM_PUSH_COMPLETED'].every(type => (FOUNDRY_AGENT_EVENT_TYPES as readonly string[]).includes(type) && (FOUNDRY_WORKBENCH_EVENT_TYPES as readonly string[]).includes(type)), 'SCM events on existing bus'))
  results.push(check('auto_commit_setting', AUTO_COMMIT_AFTER_AI_EDIT === false && AUTO_PUSH_AFTER_COMMIT === false && w4AuthorityStillZero(), 'AUTO commit/push off'))
  results.push(check('sync_disabled', SYNC_DISABLED_UNTIL_GOVERNED === true, 'SYNC_DISABLED_UNTIL_GOVERNED'))
  results.push(check('hunk_deferred', W4_HUNK_PROPOSAL_STATUS === 'DEFERRED_W4_1' && /DEFERRED_W4_1/.test(w4), 'hunk accept deferred'))
  results.push(check('git_chip', /chips\?\.git/.test(pane), 'Composer git chip'))
  results.push(check('fetch_pull_policies', FETCH_POLICY === 'COMMANDER_READ_NETWORK_ALLOWED' && PULL_POLICY === 'UNAVAILABLE_W4' && MERGE_POLICY === 'VISUALIZATION_ONLY_EXECUTION_DISABLED' && REBASE_POLICY === 'DISABLED' && CHECKOUT_POLICY === 'DISABLED_W4' && WORKTREE_POLICY === 'FOUNDRY_AGENT_WORKSPACES_OWNED', 'mutation policies'))
  results.push(check('project_ready_not_commit', FOUNDRY_AUTHORITY_SNAPSHOT.autoCommit === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoPush === 0, 'PROJECT READY ≠ committed/pushed'))
  results.push(check('parent_folders_never', /openRepositoryInParentFolders': 'never'/.test(policy), 'no parent-repo auto-open'))
  results.push(check('stock_command_list', STOCK_GIT_MUTATION_COMMANDS.includes('git.commit') && STOCK_GIT_MUTATION_COMMANDS.includes('git.push'), 'stock mutation list'))

  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const previousStateDir = process.env.FOUNDRY_WORKBENCH_STATE_DIR
  process.env.FOUNDRY_PROJECTS_ROOT = path.join(os.tmpdir(), `w4-projects-${process.pid}`)
  process.env.FOUNDRY_WORKBENCH_STATE_DIR = path.join(os.tmpdir(), `w4-state-${process.pid}`)
  mkdirSync(process.env.FOUNDRY_PROJECTS_ROOT, { recursive: true })
  mkdirSync(process.env.FOUNDRY_WORKBENCH_STATE_DIR, { recursive: true })
  const fixture = ensureFoundryWorkbenchW4Fixture(path.join(process.env.FOUNDRY_PROJECTS_ROOT, 'w4-scm-fixture'))

  const canonical = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: resolveRepoRoot() })
  results.push(check('canonical_repo_refused', canonical.ok === false && canonical.code === 'CANONICAL_REPO_REFUSED', String(canonical.code)))

  writeFileSync(path.join(fixture, 'tracked.ts'), 'export const seed = 2\n')
  const status = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: fixture })
  results.push(check('fixture_A_status', status.ok === true && Boolean(status.snapshot?.changedFiles.some(item => item.includes('tracked.ts'))), JSON.stringify(status.snapshot?.changedFiles)))

  const diff = await runFoundryW4Command({ kind: 'scmDiff', workspaceRoot: fixture, instruction: 'Explain these changes.' })
  results.push(check('fixture_B_diff', diff.ok === true && diff.readOnly === true && Boolean(diff.snapshot?.boundedDiffHunks.length || diff.text), String(diff.readOnly)))

  const stage = await runFoundryW4Command({ kind: 'scmStage', workspaceRoot: fixture, files: ['tracked.ts'] })
  results.push(check('fixture_C_stage', stage.ok === true && Boolean(stage.snapshot?.stagedFiles.some(item => item.includes('tracked.ts'))), JSON.stringify(stage.snapshot?.stagedFiles)))

  const unstage = await runFoundryW4Command({ kind: 'scmUnstage', workspaceRoot: fixture, files: ['tracked.ts'] })
  results.push(check('fixture_D_unstage', unstage.ok === true && !unstage.snapshot?.stagedFiles.some(item => item.includes('tracked.ts')), JSON.stringify(unstage.snapshot?.stagedFiles)))

  await runFoundryW4Command({ kind: 'scmStage', workspaceRoot: fixture, files: ['tracked.ts'] })
  const noApproval = await runFoundryW4Command({
    kind: 'governedCommit',
    workspaceRoot: fixture,
    instruction: 'w4 fixture commit',
    commanderApproved: false,
  })
  results.push(check('fixture_E_commit_no_approval', noApproval.ok === false && noApproval.code === 'COMMIT_APPROVAL_REQUIRED', String(noApproval.code)))
  const headBefore = git(['rev-parse', 'HEAD'], fixture).stdout.trim()

  const approved = await runFoundryW4Command({
    kind: 'governedCommit',
    workspaceRoot: fixture,
    instruction: 'w4 fixture commit',
    commanderApproved: true,
  })
  const headAfter = git(['rev-parse', 'HEAD'], fixture).stdout.trim()
  results.push(check('fixture_F_commit_approved', approved.ok === true && headAfter !== headBefore, approved.error || headAfter.slice(0, 12)))

  const pushNo = await runFoundryW4Command({ kind: 'governedPush', workspaceRoot: fixture, commanderApproved: false, remote: 'origin' })
  results.push(check('fixture_G_push_no_approval', pushNo.ok === false && pushNo.code === 'PUSH_APPROVAL_REQUIRED', String(pushNo.code)))

  const pushYes = await runFoundryW4Command({ kind: 'governedPush', workspaceRoot: fixture, commanderApproved: true, remote: 'origin' })
  const originHead = git(['rev-parse', 'HEAD'], path.join(path.dirname(fixture), `${path.basename(fixture)}.bare.git`))
  results.push(check('fixture_H_push_approved', pushYes.ok === true && originHead.status === 0 && originHead.stdout.trim() === headAfter, pushYes.error || originHead.stdout.trim().slice(0, 12)))

  const bypasses = await Promise.all(STOCK_GIT_MUTATION_COMMANDS.map(stockCommand => runFoundryW4Command({ kind: 'scmBypass', stockCommand, workspaceRoot: fixture })))
  results.push(check('fixture_I_stock_bypass', bypasses.every(item => item.ok === false && item.code === 'STOCK_GIT_INTERCEPTED'), `n=${bypasses.length}`))
  results.push(check('fixture_J_palette_bypass', /command: '-git.commit'/.test(policy) && /command: '-git.push'/.test(policy) && stockGitMutationWiredInAdapter(adapter) === 0, 'palette unbind + no adapter exec'))
  results.push(check('fixture_K_keybinding_bypass', /foundry.governedCommit/.test(policy) && /command: '-git.commit'/.test(policy) && /ctrl\+enter/.test(policy), 'ctrl+enter rebound'))

  const agentCommit = await runFoundryW4Command({ kind: 'agentCommit', workspaceRoot: fixture })
  const agentPush = await runFoundryW4Command({ kind: 'agentPush', workspaceRoot: fixture })
  const agentStage = await runFoundryW4Command({ kind: 'agentStage', workspaceRoot: fixture })
  results.push(check('fixture_L_agent_commit', agentCommit.ok === false && agentCommit.code === 'AGENT_AUTONOMOUS_COMMIT', String(agentCommit.code)))
  results.push(check('fixture_M_agent_push', agentPush.ok === false && agentPush.code === 'AGENT_AUTONOMOUS_PUSH', String(agentPush.code)))
  results.push(check('ai_staging_refused', agentStage.ok === false && agentStage.code === 'AGENT_STAGING_REFUSED', String(agentStage.code)))

  const broker = await runWithWorkspaceRoot(fixture, () => executeEngineerTool({
    tool: 'file.write',
    input: { path: 'tracked.ts', content: 'export const seed = 3\n', reason: 'W4 Tool Broker AI edit' },
  }, { repairId: 'w4-workbench' }))
  const afterAi = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: fixture })
  results.push(check('fixture_N_ai_edit_scm', broker.ok === true && Boolean(afterAi.snapshot?.changedFiles.some(item => item.includes('tracked.ts'))), `broker=${broker.ok} changed=${afterAi.snapshot?.changedFiles.join(',')}`))

  const review = await runFoundryW4Command({ kind: 'reviewChanges', workspaceRoot: fixture, instruction: 'Review this diff. Do not commit or push.' })
  results.push(check('fixture_O_review', review.ok === true && review.readOnly === true && git(['rev-parse', 'HEAD'], fixture).stdout.trim() === headAfter, String(review.readOnly)))

  const sync = await runFoundryW4Command({ kind: 'scmSync', workspaceRoot: fixture })
  const pull = await runFoundryW4Command({ kind: 'scmPull', workspaceRoot: fixture })
  const merge = await runFoundryW4Command({ kind: 'scmMerge', workspaceRoot: fixture })
  const rebase = await runFoundryW4Command({ kind: 'scmRebase', workspaceRoot: fixture })
  const checkout = await runFoundryW4Command({ kind: 'scmCheckout', workspaceRoot: fixture })
  const publish = await runFoundryW4Command({ kind: 'scmPublish', workspaceRoot: fixture })
  const force = await runFoundryW4Command({ kind: 'scmForce', workspaceRoot: fixture })
  results.push(check('sync_refused', sync.ok === false && sync.code === 'SYNC_DISABLED_UNTIL_GOVERNED', String(sync.code)))
  results.push(check('pull_unavailable', pull.ok === false && pull.code === 'PULL_UNAVAILABLE_W4', String(pull.code)))
  results.push(check('merge_disabled', merge.ok === false, String(merge.code)))
  results.push(check('rebase_disabled', rebase.ok === false, String(rebase.code)))
  results.push(check('checkout_disabled', checkout.ok === false, String(checkout.code)))
  results.push(check('publish_disabled', publish.ok === false, String(publish.code)))
  results.push(check('force_disabled', force.ok === false, String(force.code)))

  const dirty = await runFoundryW4Command({ kind: 'scmStage', workspaceRoot: fixture, files: ['tracked.ts'], dirtyBuffers: [path.join(fixture, 'tracked.ts')] })
  results.push(check('dirty_buffer_not_staged', dirty.ok === false && dirty.code === 'GIT_DIRTY_BUFFER', String(dirty.code)))

  const nestedInner = git(['rev-parse', '--show-toplevel'], path.join(fixture, 'nested')).stdout.trim()
  const rootTop = git(['rev-parse', '--show-toplevel'], fixture).stdout.trim()
  results.push(check('nested_repo_not_parent', path.resolve(nestedInner) !== path.resolve(rootTop) && path.resolve(rootTop) === path.resolve(fixture), `root=${rootTop} nested=${nestedInner}`))

  const envelope = envelopeWithScm(fixture)
  results.push(check('scm_context_caps', Boolean(envelope.git?.branch) && (envelope.git?.boundedDiffHunks.length || 0) <= 8 && (envelope.git?.changedFiles.length || 0) <= 40, `branch=${envelope.git?.branch} hunks=${envelope.git?.boundedDiffHunks.length}`))

  const counts = {
    UNGOVERNED_WORKBENCH_COMMIT_COUNT: stockGitMutationWiredInAdapter(adapter),
    UNGOVERNED_WORKBENCH_PUSH_COUNT: (adapter.match(/executeCommand\(\s*['"]git\.push/g) || []).length,
    AGENT_AUTONOMOUS_COMMIT_COUNT: agentCommit.ok ? 1 : 0,
    AGENT_AUTONOMOUS_PUSH_COUNT: agentPush.ok ? 1 : 0,
    AUTO_COMMIT_AFTER_AI_EDIT_COUNT: AUTO_COMMIT_AFTER_AI_EDIT ? 1 : 0,
    AUTO_PUSH_AFTER_COMMIT_COUNT: AUTO_PUSH_AFTER_COMMIT ? 1 : 0,
  }
  results.push(check('required_counts_zero', Object.values(counts).every(value => value === 0), JSON.stringify(counts)))

  if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
  else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
  if (previousStateDir === undefined) delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  else process.env.FOUNDRY_WORKBENCH_STATE_DIR = previousStateDir
  try { rmSync(path.dirname(fixture), { recursive: true, force: true }) } catch { /* tmp */ }

  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W4_VALIDATION failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W4_VALIDATION PASS')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}

export { run as runFoundryWorkbenchW4Validation }
