import type { FoundryMissionInterpretation, FoundryMissionKind, FoundryMissionStep } from './foundryMissionTypes'
import { isReadOnlyLocateRequest } from './foundryLocalModelRuntime'
import { isApplicationBuilderRequest } from './foundryRequirementsEngine'
import { assessMissionCapabilities, persistableCapabilityAssessment } from './capability-atlas/plannerGate'

function quote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim()
}

export function interpretCommanderRequest(userRequest: string, options?: { repoTruth?: string; workspace?: string }): FoundryMissionInterpretation {
  const text = userRequest.trim()
  const fromTo = text.match(/from\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?(?:\s+and|\s*$)/i)
  const addMarker = text.match(/\b(FOUNDRY[- ]P00\d|FOUNDRY READY)\b/i)
  const wantsInstall = /install|activate|installed app|production|package|exact install/i.test(text)
    && !/\bnot a production( install)?\b/i.test(text)
  const mentionsWarRoom = /war room|header|login page|terra/i.test(text) && !/test application|fixture/i.test(text)
  const mentionsFixture = /test application|fixture|status label|local-coder-label|engineering-depth|impl-bug|stale-expect|system rdy|multi-file\/|pass009\/|pass010\//i.test(text)
  const mentionsFoundryApp = /the foundry|engineering review|session details|foundrymissioncontrollerpanel|components\/war-room\/foundry|advanced session/i.test(text)
    && !mentionsFixture
  const locateOnly = isReadOnlyLocateRequest(text)
  const appBuilder = isApplicationBuilderRequest(text)
    && !locateOnly
    && !mentionsFixture
    && !mentionsFoundryApp
    && !mentionsWarRoom
    && !wantsInstall
  const kind: FoundryMissionKind = locateOnly
    ? 'fixture'
    : mentionsFixture && !wantsInstall && !mentionsFoundryApp
      ? 'fixture'
      : wantsInstall || mentionsWarRoom || mentionsFoundryApp
        ? 'application'
        : appBuilder
          ? 'app_builder'
          : 'fixture'

  let replace: { from: string; to: string } | undefined
  if (fromTo) replace = { from: quote(fromTo[1]), to: quote(fromTo[2]) }

  let insert: { marker: string; locus: string } | undefined
  if (!replace && addMarker && /add|next to|header|visible/i.test(text)) {
    insert = { marker: addMarker[1].toUpperCase().replace(/\s+/g, '-'), locus: /login/i.test(text) ? 'header+login' : 'header' }
  }

  const goal = replace
    ? `Change "${replace.from}" to "${replace.to}" without removing useful behavior.`
    : insert
      ? `Make "${insert.marker}" visible at ${insert.locus} without touching unrelated systems.`
      : text

  const successCriteria = replace
    ? [
        `Exact source of "${replace.from}" identified`,
        `"${replace.to}" is what the fixture/app now presents`,
        'Targeted tests pass',
        'Visual verification confirms the new label',
      ]
    : insert
      ? [
          `Source of the ${insert.locus} identified`,
          `${insert.marker} is visible`,
          'Targeted validation passes',
          'If this is a War Room application mission: exact mission install is active and running',
        ]
      : ['Requested behavior is implemented', 'Validation passes']

  if (kind === 'application') {
    successCriteria.push(
      'Build, package, and production install succeed',
      'MISSION_INSTALL_ID == ACTIVE_INSTALL_ID == RUNNING_INSTALL_ID',
      'Browser and/or Computer Use confirm the change on the installed app',
    )
  }
  if (kind === 'app_builder') {
    successCriteria.splice(0, successCriteria.length,
      'Isolated project workspace created outside War Room source',
      'Research recorded with source provenance',
      'Requirements and stack decision recorded',
      'Application implemented in the project root',
      'Tests pass',
      'Local preview running',
      'Desktop and mobile browser verification',
      'PROJECT READY presented without live deploy',
    )
  }

  const constraints = [
    'COMMIT = NO, PUSH = NO, LIVE DEPLOY = NO',
    'Do not modify Terra if another agent owns that work',
    'Do not kill unrelated processes',
    'Respect the Foundry build/package lock',
    ...(kind === 'app_builder'
      ? ['SPENDING = NO, PURCHASE = NO, SECRET_DISCLOSURE = NO', 'Write only inside the new project root']
      : []),
  ]

  const requiredVerification = kind === 'application'
    ? ['tests', 'build', 'package', 'install', 'identity', 'browser', 'computer']
    : kind === 'app_builder'
      ? ['research', 'tests', 'runtime', 'browser-desktop', 'browser-mobile']
      : ['tests', 'browser']

  const capabilityAssessment = persistableCapabilityAssessment(assessMissionCapabilities({
    missionText: text,
    missionKind: kind,
    workspaceContext: options?.workspace,
    repoTruth: options?.repoTruth,
    requiredVerification,
  }))

  return { goal, successCriteria, constraints, requiredVerification, kind, replace, insert, locateOnly, capabilityAssessment }
}

export function buildInitialPlan(interpretation: FoundryMissionInterpretation): FoundryMissionStep[] {
  if (interpretation.locateOnly) {
    return [
      { id: 'understand', intent: 'UNDERSTAND', title: 'Interpret Commander request', status: 'pending' },
      { id: 'search', intent: 'SEARCH', title: 'Search workspace for the relevant source', status: 'pending' },
      { id: 'read', intent: 'READ', title: 'Read candidate files', status: 'pending' },
      { id: 'map', intent: 'MAP', title: 'Map ownership and dependencies', status: 'pending' },
      { id: 'complete', intent: 'COMPLETE', title: 'Evaluate completion gate', status: 'pending' },
    ]
  }
  if (interpretation.kind === 'app_builder') {
    return [
      { id: 'understand', intent: 'UNDERSTAND', title: 'Interpret Commander outcome', status: 'pending' },
      { id: 'research', intent: 'RESEARCH', title: 'Governed internet research', status: 'pending' },
      { id: 'requirements', intent: 'REQUIREMENTS', title: 'Derive product requirements', status: 'pending' },
      { id: 'stack', intent: 'STACK', title: 'Select and record stack', status: 'pending' },
      { id: 'project_create', intent: 'PROJECT_CREATE', title: 'Create isolated project workspace', status: 'pending' },
      { id: 'patch_source', intent: 'PATCH_SOURCE', title: 'Implement inside the project root', status: 'pending' },
      { id: 'self_review', intent: 'SELF_REVIEW', title: 'Review generated application', status: 'pending' },
      { id: 'test', intent: 'TEST', title: 'Run project tests', status: 'pending' },
      { id: 'diagnose', intent: 'DIAGNOSE', title: 'Classify and repair ordinary failures', status: 'pending' },
      { id: 'launch', intent: 'LAUNCH', title: 'Start project-owned local server', status: 'pending' },
      { id: 'browser', intent: 'BROWSER_VERIFY', title: 'Browser-verify desktop and mobile', status: 'pending' },
      { id: 'preview', intent: 'PREVIEW', title: 'Present PROJECT READY', status: 'pending' },
      { id: 'complete', intent: 'COMPLETE', title: 'Evaluate completion gate', status: 'pending' },
    ]
  }
  const steps: FoundryMissionStep[] = [
    { id: 'understand', intent: 'UNDERSTAND', title: 'Interpret Commander request', status: 'pending' },
    { id: 'search', intent: 'SEARCH', title: 'Search workspace for the relevant source', status: 'pending' },
    { id: 'read', intent: 'READ', title: 'Read candidate files', status: 'pending' },
    { id: 'map', intent: 'MAP', title: 'Map relevant owners and dependencies', status: 'pending' },
    { id: 'impact', intent: 'IMPACT', title: 'Build change impact map', status: 'pending' },
    { id: 'baseline', intent: 'BASELINE', title: 'Capture targeted baseline before edit', status: 'pending' },
    { id: 'patch_source', intent: 'PATCH_SOURCE', title: 'Patch implementation (not tests first)', status: 'pending' },
    { id: 'self_review', intent: 'SELF_REVIEW', title: 'Review own diff before validation', status: 'pending' },
    { id: 'cross_file', intent: 'CROSS_FILE', title: 'Validate cross-file consistency', status: 'pending' },
    { id: 'test', intent: 'TEST', title: 'Run targeted tests', status: 'pending' },
    { id: 'diagnose', intent: 'DIAGNOSE', title: 'Classify failures with discriminating evidence', status: 'pending' },
    { id: 'test_review', intent: 'TEST_REVIEW', title: 'Review generated or updated tests', status: 'pending' },
    { id: 'contract', intent: 'CONTRACT', title: 'Verify contract migration coverage', status: 'pending' },
    { id: 'regression', intent: 'REGRESSION', title: 'Run bounded regression checks', status: 'pending' },
  ]
  if (interpretation.kind === 'fixture') {
    steps.push(
      { id: 'launch', intent: 'LAUNCH', title: 'Launch the fixture if needed', status: 'pending' },
      { id: 'browser', intent: 'BROWSER_VERIFY', title: 'Visually verify via persistent browser', status: 'pending' },
      { id: 'complete', intent: 'COMPLETE', title: 'Evaluate completion gate', status: 'pending' },
    )
  } else {
    steps.push(
      { id: 'lint', intent: 'LINT', title: 'Lint changed files', status: 'pending' },
      { id: 'typecheck', intent: 'TYPECHECK', title: 'Typecheck scoped to changed files', status: 'pending' },
      { id: 'self_check', intent: 'SELF_CHECK', title: 'Self-check before production build', status: 'pending' },
      { id: 'build', intent: 'BUILD', title: 'Production build', status: 'pending' },
      { id: 'package', intent: 'PACKAGE', title: 'Package linux artifacts', status: 'pending' },
      { id: 'install', intent: 'INSTALL', title: 'Install production version', status: 'pending' },
      { id: 'activate', intent: 'ACTIVATE', title: 'Activate exact new install', status: 'pending' },
      { id: 'transition', intent: 'TRANSITION', title: 'Controlled runtime transition', status: 'pending' },
      { id: 'identity', intent: 'IDENTITY', title: 'Verify exact active/running identity', status: 'pending' },
      { id: 'browser', intent: 'BROWSER_VERIFY', title: 'Browser-verify installed UI', status: 'pending' },
      { id: 'computer', intent: 'COMPUTER_VERIFY', title: 'Computer-use observe installed War Room', status: 'pending' },
      { id: 'complete', intent: 'COMPLETE', title: 'Evaluate completion gate', status: 'pending' },
    )
  }
  if (interpretation.capabilityAssessment?.recommendation === 'CAPABILITY_READY_WITH_VALIDATION') {
    const test = steps.find(step => step.intent === 'TEST')
    if (test) test.note = 'Capability gate: EVALUATED/AVAILABLE skills require targeted validation. EVALUATED is not PROVEN.'
  }
  return steps
}

export function replanAfterTestFailure(plan: FoundryMissionStep[]): FoundryMissionStep[] {
  const hasPatchTests = plan.some(s => s.intent === 'PATCH_TESTS')
  if (hasPatchTests) {
    return plan.map(s => (s.intent === 'PATCH_TESTS' || s.intent === 'TEST' ? { ...s, status: 'pending' as const } : s))
  }
  const testIdx = plan.findIndex(s => s.intent === 'TEST')
  const extra: FoundryMissionStep = { id: 'patch_tests', intent: 'PATCH_TESTS', title: 'Update tests that still expect the old value', status: 'pending' }
  const next = [...plan]
  next.splice(testIdx >= 0 ? testIdx : next.length, 0, extra)
  return next.map(s => (s.intent === 'TEST' ? { ...s, status: 'pending' } : s))
}
