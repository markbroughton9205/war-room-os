/**
 * Foundry Master loop: local coder proposes structured actions; Engineering Core executes.
 * Used for novel projects when deterministic templates do not apply.
 */
import { getIssue, getRepair, saveRepair } from './storage'
import { buildRepoMap } from './repoMap'
import { appendProjectMemory, writeProjectMemory } from './projectMemory'
import { executeTypedTerminal, startOwnedProcess, stopOwnedProcesses, terminalRepoDiff, terminalRepoStatus } from './terminalExecutor'
import { commanderResolve } from './runtime'
import { isRepairCancellationRequested } from './processRegistry'
import { extractJsonObject, requestLocalCoderJson, resolveLocalCoder } from './localCoder'
import { executeFoundryAction, parseFoundryActions, type FoundryAction } from './foundryActions'
import { parseDirectRoleMention, roleBrief, selectSpecialists, type FoundryRole } from './foundryRoles'
import { appendFoundryActivity, appendFoundryChat, attachMissionToSession, getFoundrySession, saveFoundrySession } from './foundrySessions'
import {
  activityTextForAction,
  canEnterRepairing,
  failureFromValidation,
  parseNodeTestCounts,
  stepForTurn,
  toCommanderState,
  workEventFromAction,
} from './foundryCommanderState'
import type { FoundryWorkEvent, NativeCodingMissionState, NativeEngineerProgressStep, NativeRepairRecord, NativeValidationResult } from './types'

const MAX_TURNS = 12

function isDuplicateFailureLoop(signatures: string[], next: string, limit = 3): boolean {
  return [...signatures, next].filter(s => s === next).length >= limit
}

const ACTION_SYSTEM = `You are a War Room Foundry specialist. Return ONLY a JSON object, no markdown.
Shape:
{"role":"BUILDER","summary":"one sentence","actions":[{"type":"CREATE_FILE","path":"server.mjs","content":"...","reason":"..."}]}
Allowed action types: READ_FILE, SEARCH_CODE, CREATE_FILE, PATCH_FILE, DELETE_FILE, RUN_COMMAND, START_PROCESS, STOP_PROCESS, RUN_VALIDATION, INSPECT_DIFF, ASK_SPECIALIST, COMPLETE_MISSION, NOTE.
Rules:
- No shell strings. RUN_VALIDATION operation.id must be node_test, package_script, package_install, or http_probe.
- Prefer Node ESM (.mjs) and the node:test / node:fs / node:http stdlib. Do not add npm dependencies unless required.
- If the Commander asked for a command-line tool, create a CLI entry (cli.mjs or similar) using process.argv. Do not create an HTTP server for a CLI request.
- If the Commander asked for a web or HTTP app, listen on 127.0.0.1:18765 and implement GET /health returning {"ok":true}.
- CREATE_FILE content must be complete file source.
- DELETE_FILE is rejected unless commanderConfirmed is true.
- Never git commit, push, or deploy.
- After source files exist, include RUN_VALIDATION {"operation":{"id":"node_test"}}.
- COMPLETE_MISSION only after tests passed.
- DEV_TOOLING_PRESENT is not DEV_RUNTIME_REQUIRED. A package.json "dev" / "next dev" / port 3001 script may exist. Do not patch package.json to remove it. Do not start next/pnpm/npm/yarn dev. Installed War Room Foundry runs on 127.0.0.1:3848 with relative /api paths.`

function failureSig(results: NativeValidationResult[]): string {
  return results.filter(r => !r.ok).map(r => `${r.operation.id}:${r.exitCode}:${(r.stderr || r.stdout).slice(0, 200)}`).join('|') || 'ok'
}

async function bump(repairId: string, step: NativeEngineerProgressStep, detail: string, extra?: Partial<NativeCodingMissionState>): Promise<NativeRepairRecord> {
  const record = await getRepair(repairId)
  if (!record?.codingMission) throw new Error(`No coding mission ${repairId}`)
  if (step === 'REPAIRING' && !canEnterRepairing({
    failureEvidence: extra?.failureEvidence !== undefined ? extra.failureEvidence : record.codingMission.failureEvidence,
    validationResults: record.validationResults,
  })) {
    step = 'BUILDING'
    detail = detail.startsWith('REPAIRING') ? detail : `Building: ${detail}`
  }
  const coding = record.codingMission
  const workstream: FoundryWorkEvent[] = extra?.workstream ?? coding.workstream ?? []
  const next: NativeCodingMissionState = {
    ...coding,
    ...extra,
    currentStep: step,
    currentAction: extra?.currentAction ?? detail,
    lastCompletedAction: extra?.lastCompletedAction ?? coding.lastCompletedAction,
    nextAction: extra?.nextAction ?? coding.nextAction,
    commanderState: toCommanderState({ currentStep: step, failureEvidence: extra?.failureEvidence ?? coding.failureEvidence }, record.validationResults),
    workstream,
    progressEvents: [...coding.progressEvents, { at: new Date().toISOString(), step, detail }].slice(-200),
  }
  const updated = { ...record, codingMission: next, updatedAt: new Date().toISOString() }
  await saveRepair(updated)
  return updated
}

async function note(repairId: string, sessionId: string | undefined, role: FoundryRole, detail: string, speakerText?: string) {
  if (sessionId) {
    await appendFoundryActivity(sessionId, role, detail)
    if (speakerText) await appendFoundryChat(sessionId, role, speakerText)
  }
  const record = await getRepair(repairId)
  if (!record?.codingMission) return
  const coding = record.codingMission
  await saveRepair({
    ...record,
    codingMission: {
      ...coding,
      activeRole: role,
      activityLog: [...(coding.activityLog ?? []), { at: new Date().toISOString(), role, detail }].slice(-200),
      chatLog: speakerText
        ? [...(coding.chatLog ?? []), { at: new Date().toISOString(), speaker: role, text: speakerText.slice(0, 4000) }].slice(-200)
        : coding.chatLog,
    },
    updatedAt: new Date().toISOString(),
  })
}

export async function runFoundryMission(repairId: string): Promise<NativeRepairRecord> {
  let record = await getRepair(repairId)
  if (!record?.codingMission) throw new Error('runFoundryMission requires codingMission.')
  const sessionId = record.codingMission.sessionId
  if (sessionId) await attachMissionToSession(sessionId, repairId)

  const local = await resolveLocalCoder()
  const hostedStatus = local.hostedStatus
  if (!local.available) {
    return bump(repairId, 'BLOCKED', `Local coder unavailable: ${local.detail}`, {
      foundryMode: 'FOUNDRY_LOCAL_MODE',
      localCoderStatus: 'LOCAL_CODER_UNAVAILABLE',
      hostedCoderStatus: hostedStatus,
      blockingReason: 'LOCAL_CODER_UNAVAILABLE',
      validationOutcome: 'BLOCKED_BY_ENVIRONMENT',
    })
  }

  record = await bump(repairId, 'PLANNING', `Planning project with ${local.codingModel}.`, {
    foundryMode: 'FOUNDRY_LOCAL_MODE',
    localCoderStatus: 'LOCAL_CODER_READY',
    hostedCoderStatus: hostedStatus,
    activeRole: 'FOUNDRY_MASTER',
    currentAction: 'Planning project',
    nextAction: 'Create source files',
    commanderState: 'PLANNING',
  })
  const coding = record.codingMission
  if (!coding) throw new Error(`No coding mission ${repairId}`)

  const map = await buildRepoMap()
  await writeProjectMemory({
    architecture: map.architectureNotes,
    importantPaths: [...map.entryPoints, ...map.importantDirectories.slice(0, 12)],
    commands: [...map.testCommands, ...map.buildCommands],
    dependencies: map.dependencies,
  })

  const request = coding.commanderRequest
  const mention = parseDirectRoleMention(request)
  const specialists = selectSpecialists(mention?.remainder || request, mention?.role)
  if (sessionId) {
    const session = await getFoundrySession(sessionId)
    if (session) await saveFoundrySession({ ...session, agents: specialists })
  }
  const issue = await getIssue(record.issueId)
  if (!issue) throw new Error(`No issue for ${repairId}`)

  record = await bump(repairId, 'PLANNING', `Planning project.`, {
    plan: specialists.map(s => `${s}: ${roleBrief(s).slice(0, 80)}`),
    activeRole: 'FOUNDRY_MASTER',
    currentAction: 'Planning project',
    nextAction: 'Build source files',
  })
  await note(repairId, sessionId, 'FOUNDRY_MASTER', `Planning project`, `Objective: ${request}`)

  if (specialists.includes('ARCHITECT')) {
    const architecture = await requestLocalCoderJson({
      role: 'ARCHITECT',
      system: ACTION_SYSTEM,
      prompt: `${roleBrief('ARCHITECT')}\nCommander request:\n${request}\nWorkspace file count: ${map.fileCount}\nReturn JSON with summary and NOTE or CREATE_FILE actions if you must seed files.`,
    })
    if (architecture.ok) {
      const parsed = extractJsonObject(architecture.text)
      const summary = parsed ? String(parsed.summary ?? parsed.text ?? architecture.text.slice(0, 500)) : architecture.text.slice(0, 500)
      await note(repairId, sessionId, 'ARCHITECT', 'Architecture approved.', summary)
      if (parsed) {
        const actions = parseFoundryActions(parsed)
        if (actions.ok) {
          for (const action of actions.actions.filter(a => a.type === 'CREATE_FILE' || a.type === 'NOTE')) {
            await runAction(repairId, sessionId, 'ARCHITECT', action)
          }
        }
      }
    } else {
      await note(repairId, sessionId, 'ARCHITECT', `Architecture skipped: ${architecture.detail}`)
    }
  }

  const signatures: string[] = []
  let role: FoundryRole = mention?.role && mention.role !== 'FOUNDRY_MASTER' ? mention.role : 'BUILDER'
  let lastObservation = `Workspace has ${map.fileCount} files. Implement the Commander request.`
  let testsPassed = false
  let complete = false

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    record = (await getRepair(repairId)) ?? record
    if (isRepairCancellationRequested(repairId) || record.state === 'cancelled') {
      return bump(repairId, 'CANCELLED', 'Commander stopped the Foundry mission. Workspace changes were preserved.')
    }

    const priorFailure = canEnterRepairing({
      failureEvidence: record.codingMission?.failureEvidence,
      validationResults: record.validationResults,
    })
    const turnStep = stepForTurn({
      hasFailure: priorFailure,
      testsRan: (record.validationResults ?? []).length > 0 && !priorFailure,
    })
    record = await bump(repairId, turnStep, priorFailure
      ? `Repairing: ${record.codingMission?.failureEvidence?.errorSummary || 'recorded failure'}`
      : turn === 0 ? 'Building project files.' : 'Continuing build.', {
      attempt: turn + 1,
      activeRole: role,
      currentAction: priorFailure
        ? (record.codingMission?.failureEvidence?.repairAction || 'Fixing failed tests')
        : 'Building project files',
      nextAction: priorFailure ? 'Re-run tests' : 'Run tests',
    })

    const filesChanged = record.codingMission?.filesChanged ?? []
    const prompt = `${roleBrief(role)}
Commander request:
${mention?.remainder || request}
Observation:
${lastObservation}
Files already changed: ${filesChanged.join(', ') || '(none)'}
If source exists, run tests. If this is HTTP, health is http://127.0.0.1:18765/health.
If you are REVIEWER and tests passed, COMPLETE_MISSION.
If you cannot finish, ASK_SPECIALIST.`

    const reply = await requestLocalCoderJson({ role, system: ACTION_SYSTEM, prompt })
    if (!reply.ok) {
      lastObservation = `Local coder error: ${reply.detail}`
      await note(repairId, sessionId, role, lastObservation)
      if (isDuplicateFailureLoop(signatures, lastObservation, 3)) break
      signatures.push(lastObservation)
      role = 'DEBUGGER'
      continue
    }

    const parsed = extractJsonObject(reply.text)
    if (!parsed) {
      lastObservation = 'Model output was not schema-valid JSON. Retrying.'
      await note(repairId, sessionId, role, lastObservation, reply.text.slice(0, 800))
      signatures.push('invalid-json')
      if (isDuplicateFailureLoop(signatures, 'invalid-json', 3)) break
      continue
    }

    const actions = parseFoundryActions(parsed)
    if (!actions.ok) {
      lastObservation = actions.error
      await note(repairId, sessionId, role, lastObservation)
      continue
    }

    await note(repairId, sessionId, role, actions.summary || `${role} produced ${actions.actions.length} action(s).`, actions.summary)

    for (const action of actions.actions) {
      if (action.type === 'ASK_SPECIALIST') {
        role = action.specialist
        lastObservation = action.task
        await note(repairId, sessionId, 'FOUNDRY_MASTER', `Assigned ${role}: ${action.task}`)
        continue
      }
      if (action.type === 'COMPLETE_MISSION') {
        complete = testsPassed
        lastObservation = complete ? (action.summary || 'Reviewer accepted.') : 'COMPLETE_MISSION ignored because tests have not passed.'
        await note(repairId, sessionId, 'REVIEWER', lastObservation)
        continue
      }
      const executed = await runAction(repairId, sessionId, role, action)
      lastObservation = executed.detail
      const skipped = Boolean(
        executed.result && typeof executed.result === 'object' && 'skipped' in executed.result && (executed.result as { skipped?: boolean }).skipped,
      )
      if ((action.type === 'RUN_VALIDATION' || action.type === 'RUN_COMMAND') && !skipped) {
        testsPassed = executed.ok
        const latest = await getRepair(repairId)
        const results = latest?.validationResults ?? []
        const sig = failureSig(results)
        const counts = parseNodeTestCounts(`${executed.detail}\n${typeof executed.result === 'object' && executed.result && 'stdout' in executed.result ? String((executed.result as { stdout?: string }).stdout ?? '') : ''}`)
        if (!executed.ok) {
          const evidence = failureFromValidation(results, `Fixing ${action.type === 'RUN_COMMAND' ? action.operation.id : (action.operation?.id ?? 'tests')}`)
          await bump(repairId, 'REPAIRING', evidence?.errorSummary || 'Test failed', {
            failureEvidence: evidence,
            currentAction: evidence?.repairAction || 'Fixing failed tests',
            nextAction: 'Re-run tests',
            lastCompletedAction: counts ? `${counts.pass}/${counts.tests} tests passed` : 'Tests failed',
          })
          if (isDuplicateFailureLoop(signatures, sig)) {
            return bump(repairId, 'BLOCKED', 'Repeated identical failure signature.', { blockingReason: sig, validationOutcome: 'BLOCKED_BY_ENVIRONMENT' })
          }
          signatures.push(sig)
          role = 'DEBUGGER'
        } else {
          await bump(repairId, 'TESTING', counts ? `${counts.pass}/${counts.tests} tests passed` : 'Tests passed', {
            failureEvidence: null,
            currentAction: counts ? `${counts.pass}/${counts.tests} tests passed` : 'Tests passed',
            nextAction: 'Complete mission',
            lastCompletedAction: counts ? `${counts.pass}/${counts.tests} tests passed` : 'Tests passed',
          })
          role = 'REVIEWER'
        }
      }
    }
    if (complete && testsPassed) break
    if (!testsPassed && filesChanged.length > 0 && role === 'BUILDER') role = 'TEST_ENGINEER'
  }

  record = (await getRepair(repairId)) ?? record
  const looksLikeWeb = (record.codingMission?.filesChanged ?? []).some(f => f.endsWith('server.mjs')) || (await buildRepoMap()).entryPoints.includes('server.mjs')
  if (looksLikeWeb) {
    await bump(repairId, 'RUNNING', 'Starting local HTTP server for runtime verification.')
    await startOwnedProcess({ repairId, cmd: 'node', args: ['server.mjs'], label: 'node server.mjs' })
    await new Promise(resolve => setTimeout(resolve, 900))
    let probe = await executeTypedTerminal({ operation: { id: 'http_probe', targets: ['http://127.0.0.1:18765/health'] }, repairId })
    if (!probe.ok) {
      await new Promise(resolve => setTimeout(resolve, 900))
      probe = await executeTypedTerminal({ operation: { id: 'http_probe', targets: ['http://127.0.0.1:18765/health'] }, repairId })
    }
    const latest = await getRepair(repairId)
    if (latest) {
      latest.validationResults = [...(latest.validationResults ?? []), probe]
      await saveRepair({ ...latest, updatedAt: new Date().toISOString() })
    }
    await stopOwnedProcesses(repairId)
    testsPassed = testsPassed && probe.ok && /"ok"\s*:\s*true/.test(probe.stdout)
    lastObservation = probe.ok ? probe.stdout.slice(0, 200) : probe.stderr
  }

  const diff = await terminalRepoDiff()
  const changedFiles = (await terminalRepoStatus()).changedFiles.map(f => f.path)
  await note(repairId, sessionId, 'REVIEWER', `Diff review complete (${changedFiles.length} file(s)).`, diff.diff.slice(0, 2000))

  record = (await getRepair(repairId)) ?? record
  if (record.state !== 'resolved' && record.state !== 'cancelled') {
    try {
      record = await commanderResolve(repairId, true)
    } catch {
      /* review state may not allow resolve yet */
    }
  }
  await appendProjectMemory('completedMissions', repairId)
  const outcome = testsPassed ? 'VALIDATED' : 'PARTIALLY_VALIDATED'
  const terminalHistory = (record.validationResults ?? []).map(v => ({
    at: v.ranAt,
    command: v.operation.id,
    ok: v.ok,
    stdout: v.stdout.slice(0, 2000),
    stderr: v.stderr.slice(0, 2000),
  }))
  return bump(repairId, testsPassed ? 'COMPLETE' : 'BLOCKED', `Foundry ${outcome}. No git commit or push was executed.`, {
    validationOutcome: outcome,
    filesChanged: changedFiles,
    terminalHistory,
    blockingReason: testsPassed ? undefined : lastObservation,
    commanderState: testsPassed ? 'COMPLETE' : 'BLOCKED',
    currentAction: testsPassed ? 'Complete' : 'Blocked',
    nextAction: testsPassed ? 'Review result' : 'Inspect failure',
    lastCompletedAction: testsPassed ? 'Tests passed' : lastObservation,
  })
}

async function runAction(repairId: string, sessionId: string | undefined, role: FoundryRole, action: FoundryAction) {
  const before = await getRepair(repairId)
  const preview = activityTextForAction(action)
  const hasFailure = canEnterRepairing({
    failureEvidence: before?.codingMission?.failureEvidence,
    validationResults: before?.validationResults,
  })
  await bump(repairId, stepForTurn({
    hasFailure,
    lastActionType: action.type,
    testsRan: action.type === 'RUN_VALIDATION' || action.type === 'RUN_COMMAND',
    runningProcess: action.type === 'START_PROCESS',
  }), preview, {
    currentAction: hasFailure && action.type === 'PATCH_FILE' ? `Fixing ${'path' in action ? action.path : 'failure'}` : preview,
    nextAction: action.type === 'CREATE_FILE' || action.type === 'PATCH_FILE' ? 'Run tests' : undefined,
    lastCompletedAction: before?.codingMission?.lastCompletedAction,
  })
  const executed = await executeFoundryAction(action, { repairId })
  const record = await getRepair(repairId)
  if (record?.codingMission) {
    const current = record.codingMission
    const skipped =
      Boolean(executed.result && typeof executed.result === 'object' && 'skipped' in executed.result && (executed.result as { skipped?: boolean }).skipped)
    const filesChanged =
      executed.ok &&
      !skipped &&
      (action.type === 'CREATE_FILE' || action.type === 'PATCH_FILE')
        ? [...new Set([...current.filesChanged, action.path])]
        : current.filesChanged
    const commandsExecuted =
      !skipped && (action.type === 'RUN_VALIDATION' || action.type === 'RUN_COMMAND')
        ? [...current.commandsExecuted, action.type]
        : current.commandsExecuted
    const validationResults =
      !skipped &&
      (action.type === 'RUN_VALIDATION' || action.type === 'RUN_COMMAND') && executed.result && typeof executed.result === 'object' && 'operation' in executed.result
        ? [...(record.validationResults ?? []), executed.result as NativeValidationResult]
        : record.validationResults
    const stdout = executed.result && typeof executed.result === 'object' && 'stdout' in executed.result
      ? String((executed.result as { stdout?: string }).stdout ?? '')
      : executed.detail
    const event = workEventFromAction(action, { ok: executed.ok, detail: `${executed.detail}\n${stdout}` })
    await saveRepair({
      ...record,
      validationResults,
      codingMission: {
        ...current,
        filesChanged,
        commandsExecuted,
        lastCompletedAction: event.text,
        workstream: [...(current.workstream ?? []), event].slice(-200),
      },
      updatedAt: new Date().toISOString(),
    })
  }
  await note(repairId, sessionId, role, executed.detail)
  return executed
}
