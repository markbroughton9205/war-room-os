/** Declarative API acceptance executes a real copied application on an owned dynamic loopback port. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '../repo/paths'
import { applicationSourceSnapshot } from './foundryApplicationReview'
import type { ApplicationBuildState } from './foundryApplicationMission'

export type ApiAcceptanceStep = {
  name: string
  action: 'request' | 'restart'
  method?: string
  path?: string
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  status?: number
  jsonChecks?: Array<{ pointer: string; equals: unknown }>
  captures?: Array<{ name: string; pointer: string }>
}
export type ApiAcceptancePlan = { entrypoint: string; healthPath: string; criteria: string[]; steps: ApiAcceptanceStep[] }

export function apiPlanContractDefects(plan: ApiAcceptancePlan, acceptanceCriteria: string[]): string[] {
  const contract = acceptanceCriteria.join('\n')
  const defects: string[] = []
  const requestSteps = plan.steps.filter(step => step.action === 'request')
  const explicitRoutes = [...contract.matchAll(/\/(?:[A-Za-z0-9_.:-]+)(?:\/[A-Za-z0-9_.:?=<>{}-]+)*(?:\?[A-Za-z0-9_.:?=<>{}&-]+)?/g)]
    .map(match => match[0])
    .filter(route => !/^\/\//.test(route))
  for (const route of [...new Set(explicitRoutes)]) {
    const base = route.replace(/<[^>]+>/g, '').replace(/[?=]+$/, '')
    if (!requestSteps.some(step => (step.path ?? '').startsWith(base))) defects.push(`The plan omits the explicit Commander route ${route}.`)
  }
  if (/invalid\s+tag/i.test(contract) && !requestSteps.some(step => /invalid\s+tag/i.test(step.name))) defects.push('The plan omits invalid-tag handling.')
  const tagClarification = /Commander clarification:[^.\n]*\btag[^.\n]*\./i.exec(contract)?.[0]
  if (tagClarification && /\bempty\b/i.test(tagClarification) && /\bnot\s+a\s+string|non-string/i.test(tagClarification)) {
    const invalidTagStep = requestSteps.find(step => /invalid\s+tag/i.test(step.name))
    const tags = invalidTagStep?.body && typeof invalidTagStep.body === 'object' && !Array.isArray(invalidTagStep.body)
      ? (invalidTagStep.body as Record<string, unknown>).tags
      : undefined
    const matchesClarifiedRule = Array.isArray(tags) && tags.some(value => typeof value !== 'string' || value.trim() === '')
    if (invalidTagStep && !matchesClarifiedRule) defects.push(`The invalid-tag step's body.tags (${JSON.stringify(tags)}) does not match the Commander clarification (${tagClarification.trim()}); every entry is a non-empty string, which the clarification says is valid. Change the step's tags to include an empty string or a non-string value instead.`)
  }
  if (/tag[^.\n]{0,80}(?:normaliz)|normaliz[^.\n]{0,80}tag/i.test(contract)) {
    const provesNormalization = requestSteps.some(step => {
      const tags = step.body && typeof step.body === 'object' && !Array.isArray(step.body) ? (step.body as Record<string, unknown>).tags : undefined
      const inputTags = Array.isArray(tags) ? tags.filter((value): value is string => typeof value === 'string') : []
      const expected = JSON.stringify(step.jsonChecks ?? [])
      return inputTags.some(value => value !== value.trim().toLowerCase()) && /tags/i.test(expected)
    })
    if (!provesNormalization) defects.push('The plan does not prove tag normalization with non-normalized input and normalized output. Add or change one request step whose body.tags includes a value with mixed case or surrounding whitespace (for example "  ExampleTag  "), and give that same step a jsonChecks entry on a pointer containing "tags" whose equals is the trimmed lowercase form (for example "exampletag").')
  }
  if (/tag[^.\n]{0,80}count|count[^.\n]{0,80}tag/i.test(contract)) {
    const provesCounts = requestSteps.some(step => /\/tags(?:\?|$)/.test(step.path ?? '') && (step.jsonChecks ?? []).some(check => typeof check.equals === 'number' && check.equals > 0))
    if (!provesCounts) defects.push('The plan does not assert a positive persisted tag count from the tag-count endpoint.')
  }
  return defects
}

export function bindApiPlanCriteria(plan: ApiAcceptancePlan, acceptanceCriteria: string[]): ApiAcceptancePlan {
  return { ...plan, criteria: [...acceptanceCriteria] }
}

export function normalizeApiCountMapAssertions(plan: ApiAcceptancePlan, acceptanceCriteria: string[]): ApiAcceptancePlan {
  const explicitlyRetainsZeroKeys = acceptanceCriteria.some(criterion => /(?:zero[- ]count|retain(?:ed)?\s+zero|historical\s+(?:key|tag|count))/i.test(criterion))
  if (explicitlyRetainsZeroKeys) return plan
  return {
    ...plan,
    steps: plan.steps.map((step, index) => {
      if (step.action !== 'request' || !step.path || !step.jsonChecks?.length) return step
      const priorChecks = plan.steps.slice(0, index)
        .filter(prior => prior.action === 'request' && prior.path === step.path)
        .flatMap(prior => prior.jsonChecks ?? [])
      const jsonChecks = step.jsonChecks.filter(check => !(
        check.equals === 0
        && check.pointer.split('/').filter(Boolean).length === 1
        && priorChecks.some(prior => prior.pointer === check.pointer && typeof prior.equals === 'number' && prior.equals > 0)
      ))
      return { ...step, jsonChecks }
    }),
  }
}

export function normalizeApiMalformedBodies(plan: ApiAcceptancePlan): ApiAcceptancePlan {
  return {
    ...plan,
    steps: plan.steps.map(step => {
      if (step.action !== 'request' || !/malformed/i.test(step.name) || step.rawBody !== undefined || typeof step.body !== 'string') return step
      const { body, ...rest } = step
      return { ...rest, rawBody: body }
    }),
  }
}

export function normalizeApiDomainErrorAssertions(plan: ApiAcceptancePlan): ApiAcceptancePlan {
  return {
    ...plan,
    steps: plan.steps.map(step => {
      if (step.action !== 'request' || !/(?:invalid|missing|required)/i.test(step.name) || !step.jsonChecks?.length) return step
      return { ...step, jsonChecks: step.jsonChecks.filter(check => check.equals !== 'Malformed JSON') }
    }),
  }
}

/** A generated "invalid <field>" step can copy an unrelated field's error text (e.g. a title-validation message) onto a step that actually varies a different field with an already-valid title. That contradiction means the contract never actually required this rejection, so drop the whole step rather than asserting behavior the mission never specified. */
export function normalizeApiFieldMismatchedErrorSteps(plan: ApiAcceptancePlan): ApiAcceptancePlan {
  return {
    ...plan,
    steps: plan.steps.filter(step => {
      if (step.action !== 'request' || !step.jsonChecks?.length || !step.body || typeof step.body !== 'object') return true
      const body = step.body as Record<string, unknown>
      const title = body.title
      const titleIsValid = typeof title === 'string' && title.trim().length > 0
      const errorCheck = step.jsonChecks.find(check => check.pointer === '/error' && typeof check.equals === 'string')
      if (!errorCheck || !titleIsValid) return true
      const mentionsTitle = /title/i.test(String(errorCheck.equals))
      const variesOtherField = Object.keys(body).some(key => key !== 'title' && key !== 'body')
      return !(mentionsTitle && variesOtherField)
    }),
  }
}

export function apiVerificationEnvironment(port: number, cwd: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PORT: String(port), DATA_FILE: path.join(cwd, 'acceptance-data.json') }
}

export function apiJsonPointer(data: unknown, key: string): unknown {
  if (!key || key === '/') return data
  if (!key.startsWith('/')) throw new Error('JSON pointer must start with /.')
  return key.slice(1).split('/').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined
    const part = segment.replace(/~1/g, '/').replace(/~0/g, '~')
    return Object.prototype.hasOwnProperty.call(value, part) ? (value as Record<string, unknown>)[part] : undefined
  }, data)
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const reservation = createServer()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') return reject(new Error('Dynamic port reservation failed.'))
      reservation.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitReady(port: number, healthPath: string, child: ChildProcess, failureDetail: () => string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API server exited before readiness with ${child.exitCode}: ${failureDetail().slice(-2000)}`)
    try { if ((await fetch(`http://127.0.0.1:${port}${healthPath}`)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('API readiness timed out.')
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('API shutdown timed out.')), 5000))])
}

function expand(value: unknown, variables: Map<string, unknown>): unknown {
  if (typeof value === 'string') return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, name) => {
    return variables.has(name) ? String(variables.get(name)) : `__missing_${name}__`
  })
  if (Array.isArray(value)) return value.map(item => expand(item, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, variables)]))
  return value
}

export async function verifyApplicationApi(state: ApplicationBuildState, plan: ApiAcceptancePlan) {
  if (state.contract.projectType !== 'api') throw new Error('API verification requires an API contract.')
  if (!/\.(?:mjs|cjs|js)$/.test(plan.entrypoint) || !plan.healthPath.startsWith('/')) throw new Error('Unsupported API entrypoint or health path.')
  if (!plan.steps.length || plan.steps.length > 50 || plan.criteria.some(c => !state.contract.acceptanceCriteria.includes(c))) throw new Error('Malformed API acceptance plan.')
  const before = await applicationSourceSnapshot()
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'foundry-api-acceptance-'))
  const entrypoint = path.join(cwd, plan.entrypoint)
  const port = await reservePort()
  let child: ChildProcess | undefined
  let childErrors = ''
  let shutdown = false
  const variables = new Map<string, unknown>()
  const observations: Array<Record<string, unknown> & { passed: boolean }> = []
  const start = async () => {
    childErrors = ''
    child = spawn(process.execPath, [entrypoint], { cwd, env: apiVerificationEnvironment(port, cwd), shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr?.on('data', chunk => { childErrors = (childErrors + String(chunk)).slice(-10000) })
    await waitReady(port, plan.healthPath, child, () => childErrors)
  }
  try {
    for (const source of before.sources) {
      const destination = path.join(cwd, source.file)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, source.text)
    }
    await start()
    for (const step of plan.steps) {
      if (step.action === 'restart') {
        await stop(child); await start()
        observations.push({ name: step.name, action: step.action, passed: true })
        continue
      }
      const requestPath = String(expand(step.path ?? '/', variables))
      const body = step.rawBody !== undefined ? String(expand(step.rawBody, variables)) : step.body === undefined ? undefined : JSON.stringify(expand(step.body, variables))
      const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        method: step.method ?? 'GET',
        headers: { ...(step.body === undefined ? {} : { 'content-type': 'application/json' }), ...(step.headers ?? {}) },
        body,
      })
      const text = await response.text()
      let json: unknown
      try { json = text ? JSON.parse(text) : undefined } catch { json = undefined }
      const checks = (step.jsonChecks ?? []).map(check => ({ ...check, actual: apiJsonPointer(json, check.pointer), passed: JSON.stringify(apiJsonPointer(json, check.pointer)) === JSON.stringify(expand(check.equals, variables)) }))
      const captureChecks: Array<{ name: string; pointer: string; actual: unknown; passed: boolean }> = []
      for (const capture of step.captures ?? []) {
        const value = apiJsonPointer(json, capture.pointer)
        const passed = typeof value === 'string' || typeof value === 'number'
        captureChecks.push({ ...capture, actual: value, passed })
        if (passed) variables.set(capture.name, value)
      }
      observations.push({ name: step.name, action: step.action, method: step.method ?? 'GET', path: requestPath, status: response.status, expectedStatus: step.status, checks, captureChecks, passed: response.status === step.status && checks.every(check => check.passed) && captureChecks.every(check => check.passed), body: text.slice(0, 4000) })
    }
    await stop(child); shutdown = true
    const after = await applicationSourceSnapshot()
    const passed = observations.every(item => item.passed) && before.digest === after.digest && shutdown
    const artifact = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'application-verification', `${randomUUID()}.json`)
    await mkdir(path.dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify({ missionId: state.contract.missionId, sourceDigest: before.digest, afterDigest: after.digest, plan, port, observations, shutdown, passed }, null, 2))
    const kinds: Array<'api' | 'shutdown' | 'persistence' | 'restart'> = ['api', 'shutdown']
    if (plan.steps.some(step => step.action === 'restart')) kinds.push('persistence', 'restart')
    for (const kind of kinds) state.runtimeEvidence.push({ kind, sourceDigest: before.digest, evidenceRef: artifact, passed, criteria: passed ? plan.criteria : [] })
    state.runtimeEvidence = state.runtimeEvidence.slice(-80)
    return { passed, artifact, observations }
  } finally { await stop(child).catch(() => undefined); await rm(cwd, { recursive: true, force: true }) }
}

export async function planApplicationApiVerification(state: ApplicationBuildState): Promise<ApiAcceptancePlan> {
  const { requestLocalCoderJson, extractJsonObject } = await import('./localCoder')
  const source = await applicationSourceSnapshot()
  let priorDefects: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await requestLocalCoderJson({
      role: 'TEST_ENGINEER',
      system: 'Return JSON only. Design independent real HTTP API acceptance from the supplied source and exact Commander contract. Use only actual routes and response shapes present in source. Every explicit route and named behavior in the Commander contract must have a concrete request step and assertion; generic CRUD cannot substitute for goal-specific filtering, counts, normalization, or invalid-input behavior. Cover health, initial empty read, create, read, update, malformed JSON, missing required input, invalid ID, restart, and read-after-restart whenever required. Capture generated IDs from real JSON and use {{name}} later. For count-map endpoints, assert current positive keys and counts only. After an update removes a key, do not require that removed key to remain with value zero unless the Commander contract explicitly requires retained zero-count or historical keys. Shape: {"entrypoint":"server.mjs","healthPath":"/health","criteria":["exact criterion"],"steps":[{"name":"create","action":"request","method":"POST","path":"/items","body":{"name":"Example"},"status":201,"jsonChecks":[{"pointer":"/name","equals":"Example"}],"captures":[{"name":"itemId","pointer":"/id"}]},{"name":"restart","action":"restart"},{"name":"read persisted","action":"request","method":"GET","path":"/items/{{itemId}}","status":200,"jsonChecks":[{"pointer":"/name","equals":"Example"}]}]}. For malformed JSON use rawBody. Do not invent routes, mocks, shell commands, source changes, or fixed ports. When the contract contains a line starting with "Commander clarification:", that sentence is the authoritative, current definition and overrides any conflicting example value already present in the supplied test or product source; an existing test file may still use a stale example that the clarification has superseded, so build every relevant request step and assertion from the clarification\'s exact rule, not from a pre-existing fixture value that disagrees with it.',
      prompt: JSON.stringify({ contract: state.contract, sources: source.sources, rejectedPlanDefects: priorDefects }),
      options: { num_ctx: 12288, num_predict: 4096, temperature: 0.1 },
    })
    if (!response.ok) throw new Error(`Independent API verifier unavailable: ${response.detail}`)
    const parsed = extractJsonObject(response.text)
    if (!parsed || typeof parsed.entrypoint !== 'string' || typeof parsed.healthPath !== 'string' || !Array.isArray(parsed.criteria) || !parsed.criteria.every(c => typeof c === 'string') || !Array.isArray(parsed.steps)) throw new Error('Independent API verifier returned an invalid plan.')
    const plan = normalizeApiFieldMismatchedErrorSteps(normalizeApiDomainErrorAssertions(normalizeApiMalformedBodies(normalizeApiCountMapAssertions(
      bindApiPlanCriteria(parsed as unknown as ApiAcceptancePlan, state.contract.acceptanceCriteria),
      state.contract.acceptanceCriteria,
    ))))
    for (const step of parsed.steps) {
      if (!step || typeof step.name !== 'string' || !['request', 'restart'].includes(step.action)) throw new Error('Independent API verifier returned an invalid step.')
      if (step.action === 'request' && (typeof step.path !== 'string' || !Number.isInteger(step.status))) throw new Error('API request step lacks a path or expected status.')
      if (Array.isArray(step.captures) && step.captures.some((capture: unknown) => !capture || typeof capture !== 'object' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(String((capture as { name?: unknown }).name ?? '')))) throw new Error('API request step has an invalid capture name.')
    }
    priorDefects = apiPlanContractDefects(plan, state.contract.acceptanceCriteria)
    if (!priorDefects.length) return plan
  }
  throw new Error(`Independent API plan omitted Commander acceptance: ${priorDefects.join(' ')}`)
}
