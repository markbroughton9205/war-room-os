import { isEngineerToolName, type EngineerToolName } from './engineerTools'
import type { FoundryMissionPermissions } from './foundryMissionTypes'
import type { FoundryModelToolDescription } from './foundryModelTypes'

const tool = (
  name: EngineerToolName,
  purpose: string,
  args: Record<string, string>,
  required: string[],
  permission: FoundryModelToolDescription['permission'],
  mutating: boolean,
  result: string,
): FoundryModelToolDescription => ({ name, purpose, args, required, permission, mutating, result })

/**
 * Authoritative model-facing catalog. It deliberately describes contracts, not implementation
 * internals. Mission lifecycle tools are omitted so a reasoning turn cannot recursively run itself.
 */
export const FOUNDRY_MODEL_TOOL_CATALOG: readonly FoundryModelToolDescription[] = [
  tool('workspace.inspect', 'Map the authorized repository.', {}, [], 'filesystem', false, 'Repository structure and metadata.'),
  tool('workspace.search', 'Search repository text.', { query: 'string', pathPrefix: 'optional repo-relative string' }, ['query'], 'filesystem', false, 'Matching relative paths, lines, and line numbers.'),
  tool('code.owners', 'Map files that own a feature from paths, exports, routes and tests.', { query: 'string' }, ['query'], 'filesystem', false, 'PRIMARY_OWNER, OWNER_CANDIDATES, RELATED_TESTS, REVERSE_DEPENDENTS, WHY_THIS_FILE.'),
  tool('code.symbol', 'Look up an exported symbol definition.', { name: 'string' }, ['name'], 'filesystem', false, 'Definition files and kinds.'),
  tool('code.refs', 'Look up references or reverse dependents.', { name: 'optional string', path: 'optional repo-relative string' }, [], 'filesystem', false, 'Reference files or dependents.'),
  tool('code.dependents', 'List reverse importers of a file.', { path: 'repo-relative string' }, ['path'], 'filesystem', false, 'Dependent files.'),
  tool('code.impact', 'Build a compact change-impact map before mutation.', { paths: 'optional repo-relative string[]', query: 'optional string' }, [], 'filesystem', false, 'TARGET_FILES, DEPENDENCIES, REVERSE_DEPENDENTS, LIKELY_TESTS, RUNTIME_SURFACES, RISK_AREAS.'),
  tool('code.roles', 'Classify owners as PRIMARY, SECONDARY, SHARED, API, PERSISTENCE, UI, TEST, RUNTIME.', { query: 'string' }, ['query'], 'filesystem', false, 'Compact role map.'),
  tool('engineering.review', 'Inspect the mission diff for accidental or unsafe edits.', {}, [], 'filesystem', false, 'PASS/FAIL, FINDINGS, SEVERITY, REQUIRED_ACTION. Compact; no full diffs.'),
  tool('engineering.baseline', 'Capture hashes, git state and runtime identity before editing.', { paths: 'optional repo-relative string[]' }, [], 'filesystem', false, 'Baseline hashes and identity.'),
  tool('engineering.diagnose', 'Classify a failed test/build as IMPLEMENTATION_BUG or TEST_EXPECTATION_OUTDATED.', { failure: 'optional string' }, [], 'tests', false, 'Structured diagnosis and next discriminating action.'),
  tool('engineering.memory_recall', 'Recall verified engineering memory with provenance.', { query: 'string' }, ['query'], 'filesystem', false, 'Facts/features; current repo wins if stale.'),
  tool('engineering.memory_remember', 'Store a verified engineering fact with provenance.', { topic: 'string', summary: 'string', files: 'optional repo-relative string[]', confidence: 'optional low|medium|high' }, ['topic', 'summary'], 'filesystem', false, 'Stored fact identity.'),
  tool('engineering.plan', 'Form a multi-file refactor plan and ALLOWED_CHANGE_SET.', { query: 'optional string' }, [], 'filesystem', false, 'Goal, files, contracts, tests, risks.'),
  tool('engineering.boundary', 'Refuse edits outside the allowed change set.', { paths: 'optional repo-relative string[]' }, [], 'filesystem', false, 'Boundary ok or refused paths.'),
  tool('engineering.consistency', 'Check imports, contracts and leftover old paths across changed files.', {}, [], 'filesystem', false, 'CROSS_FILE_CONSISTENCY PASS/FAIL.'),
  tool('engineering.test_review', 'Review a generated or updated test for meaningful behavior.', { path: 'optional repo-relative string' }, [], 'tests', false, 'TEST_REVIEW PASS/FAIL.'),
  tool('engineering.contracts', 'Find remaining stale callers after a contract change.', { name: 'optional symbol' }, [], 'filesystem', false, 'CONTRACT_MIGRATION PASS/FAIL.'),
  tool('engineering.dead_code', 'Advisory unused-export scan. Never auto-deletes.', { path: 'repo-relative string' }, ['path'], 'filesystem', false, 'DEAD_CODE advisory; AUTO_DELETE=NO.'),
  tool('engineering.write_set_expand', 'Request WRITE_SCOPE expansion with reason and ownership evidence. Never silent. Terra requires Commander authorization and is refused in PASS 014.', { path: 'repo-relative string', reason: 'string', ownerEvidence: 'string', commanderAuthorized: 'optional true only with Commander approval' }, ['path', 'reason', 'ownerEvidence'], 'filesystem', false, 'Updated ALLOWED_WRITE_SET or REFUSED_WRITE_SET_EXPANSION / REFUSED_PROTECTED_SUBSYSTEM.'),
  tool('file.read', 'Read a compact region of one repository file. Use aroundMatch, startLine/endLine, symbol, or query for large files instead of dumping the whole file. Broker returns short-lived edit anchors; do not copy source as matchText.', { path: 'repo-relative string', aroundMatch: 'optional unique text to window around', startLine: 'optional number', endLine: 'optional number', symbol: 'optional symbol name', query: 'optional text used to focus the smallest useful region' }, ['path'], 'filesystem', false, 'PATH, SHA256, EDITABLE_REGION with anchorId, LINES, compact SOURCE preview. Exact source bytes stay broker-side.'),
  tool('file.write', 'Create or replace a small file through Tool Broker. Requires TARGET_FILE, OWNER_EVIDENCE, IMPACT_SUMMARY, BASELINE_CAPTURED. Do not use for large existing files.', { path: 'repo-relative string', content: 'complete string', reason: 'string' }, ['path', 'content', 'reason'], 'filesystem', true, 'MUTATION_ALLOWED or refusal with ownership/baseline evidence.'),
  tool('file.replace_unique', 'Replace one uniquely identified region in an existing file. USE when the file is too large for file.write. When file.read returned anchorId, pass that anchorId plus replacementText. Do not reconstruct matchText. MATCH_TEXT is optional for larger models and must occur exactly once if supplied. DO NOT USE to create a file, replace most of a file, or edit ambiguous text. Broker enforces hash, uniqueness, baseline, owner evidence, Terra, and line limits. An anchor is a locator, not authorization.', { path: 'repo-relative string', expectedSha256: 'optional sha256 from file.read; broker fills from a valid anchorId', anchorId: 'optional short-lived id from file.read', matchText: 'optional unique existing string; omit when using anchorId', replacementText: 'bounded replacement string', reason: 'string', before: 'optional unique context before match', after: 'optional unique context after match' }, ['path', 'replacementText', 'reason'], 'filesystem', true, 'STATUS=APPLIED plus FILE, OLD/NEW sha256, MATCH_COUNT, CHANGED_LINE_RANGE, audit id, ANCHOR_ID. Refuses MATCH_NOT_FOUND, MATCH_NOT_UNIQUE, STALE_FILE_HASH, STALE_EDIT_ANCHOR, ANCHOR_INVALID_MISSION, BASELINE_REQUIRED, OWNER_EVIDENCE_REQUIRED, EDIT_SCOPE_TOO_LARGE.'),
  tool('file.patch', 'Apply a hash-bound unique-anchor StructuredPatch.', {
    proposal: "{issueId,sourceKind:'deterministic',proposerId,diagnosis,confidence:'high',relevantFiles:[path],plannedChanges:[{file:path,reason,operation:'replace_range',patch:{operation:'replace_range',file:path,expectedOriginalHash:fileReadSha256,matchText:exactUniqueText,replacementText}}],validations:[],risks:[],rollbackPlan,generatedAt:ISO8601}",
  }, ['proposal'], 'filesystem', true, 'Transactional patch outcomes; stale hash or ambiguous anchor is refused.'),
  tool('git.status', 'Inspect branch and working-tree state.', {}, [], 'filesystem', false, 'Branch, commit and dirty state.'),
  tool('git.diff', 'Inspect current source diff.', { paths: 'optional repo-relative string[]' }, [], 'filesystem', false, 'Unified diff.'),
  tool('terminal.execute', 'Run one typed validation operation; never a shell string.', { operation: 'object {id:node_test|validation_script|package_script|package_install|http_probe|eslint_targeted|tsc_noemit|typecheck_scope, targets?:string[]}' }, ['operation'], 'terminal', true, 'Exit code, stdout, stderr and timing.'),
  tool('test.list_suites', 'List registered package validation suites.', {}, [], 'tests', false, 'Allowed suite names.'),
  tool('test.run', 'Run one registered test/validation suite.', { suite: 'package.json validate:* script name' }, ['suite'], 'tests', true, 'Exit code and output.'),
  tool('lint.run', 'Lint selected changed files.', { targets: 'optional repo-relative string[]' }, [], 'lint', true, 'Lint exit and output.'),
  tool('typecheck.run', 'Run typecheck and classify errors in scope.', { scopeGlob: 'optional path scope' }, [], 'typecheck', true, 'Repo/scoped error counts and baseline note.'),
  tool('process.start', 'Start an owned safe local process.', { cmd: 'executable', args: 'string[]', label: 'string' }, ['cmd', 'args', 'label'], 'process', true, 'Owned process id.'),
  tool('process.status', 'Inspect processes owned by this mission.', {}, [], 'process', false, 'Owned process state.'),
  tool('process.stop', 'Stop processes owned by this mission.', {}, [], 'process', true, 'Stopped process outcomes.'),
  tool('process.list', 'List machine processes with optional filter.', { filter: 'optional string', limit: 'optional number' }, [], 'process', false, 'Redacted process records.'),
  tool('port.inspect', 'Inspect a local TCP port owner.', { port: 'number' }, ['port'], 'process', false, 'Listening state and owner evidence.'),
  tool('logs.tail', 'Read a bounded log tail.', { source: 'registered source', lines: 'optional number' }, ['source'], 'process', false, 'Redacted lines.'),
  tool('logs.search', 'Search a registered log.', { source: 'registered source', query: 'string' }, ['source', 'query'], 'process', false, 'Redacted matches.'),
  tool('browser.start', 'Ensure persistent Foundry Chromium is running.', {}, [], 'browser', true, 'Browser/page identity.'),
  tool('browser.navigate', 'Navigate active browser tab to an allowed URL.', { url: 'loopback or allowlisted URL', pageId: 'optional string' }, ['url'], 'browser', true, 'Status, title, URL and pageId.'),
  tool('browser.get_text', 'Read bounded visible text.', { selector: 'optional selector', pageId: 'optional string' }, [], 'browser', false, 'Redacted text.'),
  tool('browser.inspect', 'Read URL, title and accessibility snapshot.', { pageId: 'optional string' }, [], 'browser', false, 'Accessibility evidence.'),
  tool('browser.get_dom', 'Read bounded DOM.', { pageId: 'optional string' }, [], 'browser', false, 'Redacted HTML.'),
  tool('browser.screenshot', 'Capture browser visual evidence.', { pageId: 'optional string', fullPage: 'optional boolean' }, [], 'browser', false, 'Screenshot path.'),
  tool('browser.console', 'Read captured browser console evidence.', { pageId: 'optional string' }, [], 'browser', false, 'Bounded console entries.'),
  tool('browser.network', 'Read captured browser network evidence.', { pageId: 'optional string' }, [], 'browser', false, 'Bounded requests and status.'),
  tool('computer.windows', 'Enumerate desktop windows through X11 and accessibility.', {}, [], 'computerUse', false, 'Window and accessibility records.'),
  tool('computer.observe', 'Observe a desktop window/accessibility tree.', { windowId: 'optional string', text: 'optional accessible name', name: 'optional accessible name', role: 'optional role' }, [], 'computerUse', false, 'Bounded desktop observation.'),
  tool('computer.find_control', 'Find a desktop control by accessible name and role before clicking.', { name: 'accessible name', role: 'optional role such as button', app: 'optional window or app name' }, ['name'], 'computerUse', false, 'Semantic hits with coordinates when AT-SPI exposes the control.'),
  tool('computer.wait_for_control', 'Poll the accessibility tree until a named control is stable in the War Room window.', { name: 'accessible name', role: 'optional role such as button', app: 'optional window or app name', timeoutMs: 'optional timeout', pollIntervalMs: 'optional poll interval', stable: 'optional two-poll stability, default true' }, ['name'], 'computerUse', false, 'First stable semantic hit or an honest timeout.'),
  tool('computer.click_and_wait', 'Click a semantic control and PASS only after the expected next state appears. AT-SPI action success is not state success; retries once via semantic bounds.', { name: 'accessible name', role: 'optional role', app: 'optional window or app name', expected: 'optional expected next name/role/text/absentName', timeoutMs: 'optional timeout' }, ['name'], 'computerUse', true, 'method AT_SPI_ACTION or SEMANTIC_BOUNDS_CLICK plus timing and expectedStateObserved.'),
  tool('computer.click', 'Click a control. Prefer accessible name/role in the War Room window; coordinate x/y is last resort.', { name: 'optional accessible name', role: 'optional role', app: 'optional window or app name', x: 'optional number', y: 'optional number' }, [], 'computerUse', true, 'method AT_SPI_ACTION, SEMANTIC_BOUNDS_CLICK, or COORDINATE_FALLBACK.'),
  tool('computer.type', 'Type into the focused War Room control after a semantic click.', { text: 'string to type', app: 'optional window or app name' }, ['text'], 'computerUse', true, 'Characters typed.'),
  tool('computer.screenshot', 'Capture desktop/window visual evidence.', { windowId: 'optional string' }, [], 'computerUse', false, 'Screenshot path.'),
  tool('external_app.discover', 'Discover a registered external desktop application through ExternalAppBroker. Not generic desktop control.', { app: 'registered app id, currently cursor' }, ['app'], 'computerUse', false, 'Window identity, backend, and discovery evidence.'),
  tool('external_app.focus', 'Focus a registered external application window. Does not broaden computer.focus_window.', { app: 'registered app id' }, ['app'], 'computerUse', true, 'ACTION_SUCCESS and focused STATE_SUCCESS.'),
  tool('external_app.observe', 'Observe and bind a semantic target in a registered app. Re-observation required after move/resize/restart.', { app: 'registered app id', target: 'optional composer|submit|response' }, ['app'], 'computerUse', false, 'Ephemeral target binding.'),
  tool('external_app.insert_text', 'Insert bounded text into a bound target after focus and composer verification.', { app: 'registered app id', text: 'bounded mission text' }, ['app', 'text'], 'computerUse', true, 'ACTION_SUCCESS plus inserted-state STATE_SUCCESS.'),
  tool('external_app.cancel', 'Cancel an active external interaction without killing the application.', { app: 'registered app id' }, ['app'], 'computerUse', true, 'Cancelled waiting/input/monitoring; CURSOR_KILLED=NO.'),
  tool('external_app.status', 'Inspect ExternalAppBroker registry, bindings, and Cursor debug discovery.', { app: 'optional registered app id' }, [], 'computerUse', false, 'Registry and backend status. No secrets.'),
  tool('cursor.submit_prompt', 'Submit the bound Cursor composer after text verification. Requires STATE_SUCCESS, not ACTION_SUCCESS alone.', { app: 'cursor' }, [], 'computerUse', true, 'ACTION_SUCCESS and generation-start STATE_SUCCESS.'),
  tool('cursor.observe_generation', 'Watch Cursor until generation starts, continues, and finishes. Not a fixed timeout guess.', { timeoutMs: 'optional number' }, [], 'computerUse', false, 'generating/finished evidence.'),
  tool('cursor.read_response', 'Extract only the response for the bound submission. Does not dump chat history or credentials.', {}, [], 'computerUse', false, 'Bounded response text or honest extraction failure.'),
  tool('build.run', 'Build the exact current War Room source under shared lock.', {}, [], 'build', true, 'Build result and lineage.'),
  tool('package.run', 'Package a completed exact build under shared lock.', {}, [], 'package', true, 'AppImage, deb and unpacked artifact identities.'),
  tool('installer.install_production', 'Install exact package artifacts side-by-side.', { appimage: '{path,sha256}', deb: '{path,sha256}', linuxUnpackedDir: 'string', feature: 'string', commanderConfirmed: 'true' }, ['appimage', 'deb', 'linuxUnpackedDir', 'feature'], 'installProduction', true, 'Install stamp and installId.'),
  tool('installer.activate', 'Point the canonical launcher at one exact install.', { installId: 'string', commanderConfirmed: 'true' }, ['installId'], 'activateInstall', true, 'Previous and new active identity.'),
  tool('installer.active_status', 'Inspect canonical active install identity.', {}, [], 'activateInstall', false, 'Active install and validity.'),
  tool('runtime.transition_to_active', 'Stop verified prior owners and launch active install.', { commanderConfirmed: 'true' }, [], 'installedRuntimeControl', true, 'Transition steps and final verification.'),
  tool('runtime.verify', 'Verify active/running exact identity and health.', {}, [], 'installedRuntimeControl', false, 'Ownership, ports, health and identityMatch.'),
  tool('deploy.inspect', 'Inspect a deployment target. Live deploy remains forbidden.', { target: 'deployment target object' }, ['target'], 'liveDeploy', false, 'Backend capability/status.'),
  tool('research.search', 'Search the public internet for building facts. No login, purchase, or form submit.', { query: 'string' }, ['query'], 'internetResearch', false, 'Titles, URLs, snippets, and LIVE/CONFIG_NEEDED status.'),
  tool('research.fetch', 'GET a public https page. Refuses private hosts, credentials, POST, and paywall/login flows.', { url: 'https URL' }, ['url'], 'internetResearch', false, 'Sanitized text and title.'),
  tool('research.record', 'Store a mission-scoped research record. Distinguish RESEARCHED_FACT from FOUNDRY_DESIGN_DECISION.', { source: 'string', title: 'string', claim: 'string', relevance: 'string', usedFor: 'string', kind: 'RESEARCHED_FACT or FOUNDRY_DESIGN_DECISION', confidence: 'optional low|medium|high' }, ['source', 'title', 'claim', 'relevance', 'usedFor', 'kind'], 'internetResearch', false, 'Stored research record with freshness.'),
  tool('capability.scoreboard', 'Report factual Foundry coding-capability counts. Does not invent mastery scores.', {}, [], 'filesystem', false, 'SKILLS_REGISTERED, SOURCE_BACKED, EVALUATED, PROVEN, PRODUCTION_PROVEN, STALE, FAILED, UNKNOWN, UNSUPPORTED.'),
  tool('capability.query', 'Search the Capability Atlas taxonomy and skills. Registered is not proven.', { query: 'optional string' }, [], 'filesystem', false, 'Matching skills and taxonomy nodes with evidence-based status.'),
  tool('capability.resolve', 'Map a Commander mission to PRIMARY/SECONDARY/OPTIONAL/MISSING skills.', { mission: 'string' }, ['mission'], 'filesystem', false, 'Skill resolution with SKILL_GAP entries when competence is missing.'),
  tool('capability.pack', 'Load a compact Skill Pack of references, not full documentation.', { skillId: 'string' }, ['skillId'], 'filesystem', false, 'Compact pack with sources, tools, failure patterns, and validation methods.'),
  tool('capability.inspect', 'Inspect one skill record, sources, evaluations, and relationships.', { skillId: 'string' }, ['skillId'], 'filesystem', false, 'Skill detail. Documentation is not mastery.'),
  tool('capability.gap', 'Return SKILL_GAP records and bounded acquisition plans. Does not train WRIM.', { mission: 'string' }, ['mission'], 'filesystem', false, 'Gaps plus sandbox-evaluation acquisition plans. autoTrustResearch=false.'),
  tool('capability.self_knowledge', 'Answer what Foundry has, has proven, can do locally, never tested, or should learn next.', { mission: 'optional string' }, [], 'filesystem', false, 'Self-knowledge bundle and scoreboard.'),
  tool('project.create', 'Reserved. Application Builder creates isolated FoundryProjects workspaces; do not scatter files in War Room.', {}, [], 'filesystem', true, 'Project identity or refusal.'),
  tool('project.inspect', 'Inspect the isolated application project root.', {}, [], 'filesystem', false, 'Project metadata and files.'),
  tool('project.command', 'Run one allowlisted command with cwd locked to the project root.', { cmd: 'executable', args: 'string[]' }, ['cmd', 'args'], 'terminal', true, 'Exit code, stdout, stderr.'),
  tool('project.preview', 'Read PROJECT READY preview metadata. Live deploy remains forbidden.', {}, [], 'filesystem', false, 'Local preview URL, features, limitations.'),
  tool('hvs.project.create', 'Create an HVS .hvsproj. Foundry does not store HVS project state.', { name: 'project name string' }, ['name'], 'filesystem', true, 'HVS project id and kernel receipt.'),
  tool('hvs.project.open', 'Open an existing HVS .hvsproj by project id.', { projectId: 'HVS project id' }, ['projectId'], 'filesystem', false, 'Project metadata and state hash.'),
  tool('hvs.project.save', 'Persist the current HVS .hvsproj.', { projectId: 'HVS project id' }, ['projectId'], 'filesystem', true, 'Updated timestamp and state hash.'),
  tool('hvs.timeline.insert', 'Commit an hvs.edit.v1 insert. Requires assetId or local sourcePath.', { projectId: 'HVS project id', trackId: 'string', assetId: 'optional asset id', sourcePath: 'optional local fixture path', rights: 'optional OWNABLE|UNKNOWN|...', startSec: 'optional number', mode: 'optional preview|commit' }, ['projectId'], 'filesystem', true, 'clipId plus EditOp receipt.'),
  tool('hvs.timeline.remove', 'Commit an hvs.edit.v1 ripple-delete.', { projectId: 'HVS project id', clipId: 'clip id', mode: 'optional preview|commit' }, ['projectId', 'clipId'], 'filesystem', true, 'removed clip id plus EditOp receipt.'),
  tool('hvs.timeline.undo', 'Undo the last committed HVS EditOp when an undo snapshot exists.', { projectId: 'HVS project id' }, ['projectId'], 'filesystem', true, 'Restored project state receipt.'),
  tool('hvs.ffmpeg.probe', 'Probe local media with ffprobe. Does not ingest internet media.', { path: 'optional file path', projectId: 'optional HVS project id', assetId: 'optional asset id' }, [], 'filesystem', false, 'Typed duration/streams/hash.'),
  tool('hvs.ffmpeg.proxy', 'Generate a PROXY AssetRef. Proxy is never master.', { projectId: 'HVS project id', assetId: 'ORIGINAL asset id' }, ['projectId', 'assetId'], 'filesystem', true, 'proxy AssetRef, hash, source relationship.'),
  tool('hvs.ffmpeg.master', 'Encode one software-baseline master. UNKNOWN rights fail closed for commercial export.', { projectId: 'HVS project id', commercial: 'optional boolean, default true' }, ['projectId'], 'filesystem', true, 'master path, hash, policy class, receipt.'),
  tool('hvs.qc.run', 'Run deterministic FFmpeg QC. AI aesthetic review is not QC.', { projectId: 'optional HVS project id', assetId: 'optional asset id', path: 'optional file path' }, [], 'filesystem', true, 'PASS|FAIL|NEEDS_HUMAN plus checks.'),
] as const

const catalogByName = new Map(FOUNDRY_MODEL_TOOL_CATALOG.map(entry => [entry.name, entry]))

export function modelToolDescription(name: string): FoundryModelToolDescription | null {
  if (!isEngineerToolName(name)) return null
  return catalogByName.get(name) ?? null
}

export function toolAllowedByPermissions(
  entry: FoundryModelToolDescription,
  permissions: FoundryMissionPermissions,
): boolean {
  return entry.permission === 'none' || permissions[entry.permission] === true
}

const TERMINAL_OPERATION_IDS = new Set([
  'node_test',
  'validation_script',
  'package_script',
  'package_install',
  'http_probe',
  'eslint_targeted',
  'tsc_noemit',
  'typecheck_scope',
  'typecheck',
  'build',
  'validate_suite',
  'git_diff_check',
])

function typeMatches(value: unknown, description: string): boolean {
  if (description.startsWith('{') || description.includes('object') || description.includes('Proposal')) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }
  if (description.includes('string[]')) return Array.isArray(value) && value.every(item => typeof item === 'string')
  if (description.includes('number')) return typeof value === 'number' && Number.isFinite(value)
  if (description.includes('boolean') || description === 'true') return typeof value === 'boolean'
  if (description.includes('string')) return typeof value === 'string'
  return true
}

/** Safe, unambiguous terminal.execute normalization only. Never invents an operation id. */
export function coerceTerminalExecuteArgs(input: Record<string, unknown>): void {
  const raw = input.operation
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          input.operation = parsed
        }
      } catch {
        return
      }
    } else if (TERMINAL_OPERATION_IDS.has(trimmed)) {
      input.operation = { id: trimmed }
    } else {
      return
    }
  }
  const op = input.operation
  if (!op || typeof op !== 'object' || Array.isArray(op)) return
  const rec = op as Record<string, unknown>
  if (typeof rec.id !== 'string' && typeof rec.operation === 'string' && TERMINAL_OPERATION_IDS.has(rec.operation.trim())) {
    rec.id = rec.operation.trim()
    delete rec.operation
  }
  if (typeof rec.targets === 'string' && rec.targets.trim()) {
    rec.targets = [rec.targets.trim()]
  }
}

export function validateModelToolRequest(
  name: string,
  args: unknown,
  permissions: FoundryMissionPermissions,
): { ok: true; name: EngineerToolName; args: Record<string, unknown>; entry: FoundryModelToolDescription } | { ok: false; error: string } {
  const entry = modelToolDescription(name)
  if (!entry) return { ok: false, error: `Unknown or model-inaccessible tool "${name}".` }
  if (!toolAllowedByPermissions(entry, permissions)) {
    return { ok: false, error: `Tool "${name}" requires permission ${entry.permission}, which this mission does not have.` }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: `Tool "${name}" args must be an object.` }
  }
  const input = { ...(args as Record<string, unknown>) }
  if (entry.name === 'terminal.execute') coerceTerminalExecuteArgs(input)
  if (entry.args.commanderConfirmed === 'true') {
    input.commanderConfirmed = true
  }
  for (const required of entry.required) {
    if (!(required in input)) return { ok: false, error: `Tool "${name}" is missing required argument "${required}".` }
  }
  for (const [key, value] of Object.entries(input)) {
    const expected = entry.args[key]
    if (!expected) {
      delete input[key]
      continue
    }
    if (!typeMatches(value, expected)) return { ok: false, error: `Tool "${name}" argument "${key}" must match ${expected}.` }
  }
  return { ok: true, name: entry.name, args: input, entry }
}
