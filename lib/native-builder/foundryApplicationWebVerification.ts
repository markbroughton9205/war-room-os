/** Real loopback runtime and Playwright acceptance for directly built web applications. */
import { createServer, connect } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '../repo/paths'
import { loadPlaywrightChromium, chromiumChildEnv } from './foundryPlaywright'
import { applicationSourceSnapshot } from './foundryApplicationReview'
import { extractJsonObject, requestLocalCoderJson } from './localCoder'
import { startOwnedProcess, stopOwnedProcesses } from './terminalExecutor'
import type { ApplicationBuildState, ApplicationProofKind } from './foundryApplicationMission'

export type WebAcceptanceStep = {
  name: string
  action: 'goto' | 'fill' | 'click' | 'checkText' | 'checkValue' | 'checkVisible' | 'reload' | 'restart' | 'viewport'
  selector?: string
  value?: string
  text?: string
  width?: number
  height?: number
}
export type WebAcceptancePlan = { sourceDigest: string; entrypoint: string; healthPath: string; criteria: string[]; steps: WebAcceptanceStep[] }

export function webEvidenceKinds(runtimeRequirements: ApplicationProofKind[], restartObserved: boolean): ApplicationProofKind[] {
  return [
    'ui',
    ...(runtimeRequirements.includes('api') ? ['api' as const] : []),
    ...(restartObserved ? ['persistence' as const, 'restart' as const] : []),
    'shutdown',
  ]
}

export function webAcceptancePlanDefects(plan: Omit<WebAcceptancePlan, 'sourceDigest'>, commanderGoal: string): string[] {
  const defects: string[] = []
  const steps = plan.steps
  const names = steps.map(step => step.name)
  if (new Set(names).size !== names.length) defects.push('Every browser step needs a unique descriptive name.')
  if (steps.some(step => step.action === 'checkText' && !(step.text ?? '').trim())) defects.push('checkText cannot use an empty expected string because that assertion always passes.')
  if (!steps.some(step => /empty/i.test(step.name) && ((step.action === 'checkText' && Boolean(step.text?.trim())) || step.action === 'checkVisible'))) defects.push('The plan lacks a concrete initial empty-state assertion.')
  if (/invalid|blank|whitespace|validation/i.test(commanderGoal)) {
    const invalidFill = steps.findIndex(step => step.action === 'fill' && !(step.value ?? '').trim())
    const invalidClick = steps.findIndex((step, index) => index > invalidFill && step.action === 'click')
    const errorCheck = steps.findIndex((step, index) => index > invalidClick && step.action === 'checkText' && Boolean(step.text?.trim()))
    if (invalidFill < 0 || invalidClick < 0 || errorCheck < 0) defects.push('The plan lacks a complete blank-input submission followed by a concrete visible error assertion.')
  }
  if (/\bcomplete[ds]?\b|mark.*complete/i.test(commanderGoal)) {
    const completionClick = steps.findIndex(step => step.action === 'click' && /complete|toggle|task/i.test(`${step.name} ${step.selector ?? ''}`))
    if (completionClick < 0 || !steps.slice(completionClick + 1).some(step => /^check/.test(step.action) && /complete|total|task/i.test(`${step.name} ${step.selector ?? ''} ${step.text ?? ''}`))) defects.push('The plan lacks a completion interaction followed by observable completion proof.')
  }
  if (/filter/i.test(commanderGoal)) {
    const filters = steps.filter(step => step.action === 'click' && /filter|open|completed|all/i.test(`${step.name} ${step.selector ?? ''}`))
    if (new Set(filters.map(step => step.selector)).size < 3) defects.push('The plan lacks distinct real interactions for open, completed, and all filters.')
  }
  if (/totals?|counts?/i.test(commanderGoal) && !steps.some(step => /^check/.test(step.action) && /total|count/i.test(`${step.name} ${step.selector ?? ''}`))) defects.push('The plan lacks an observable totals/count assertion.')
  const reload = steps.findIndex(step => step.action === 'reload')
  if (reload < 0 || !steps.slice(reload + 1).some(step => /^check/.test(step.action))) defects.push('The plan lacks a state assertion after reload.')
  const restart = steps.findIndex(step => step.action === 'restart')
  if (restart < 0 || !steps.slice(restart + 1).some(step => /^check/.test(step.action))) defects.push('The plan lacks a persisted-state assertion after runtime restart.')
  if (!steps.some(step => step.action === 'viewport' && (step.width ?? 9999) <= 480)) defects.push('The plan lacks a mobile viewport check.')
  return defects
}

export async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.setTimeout(300)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitForHealth(origin: string, healthPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(new URL(healthPath, origin), { signal: AbortSignal.timeout(700) })
      if (response.ok) return true
    } catch { /* runtime may still be starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

async function waitForPortRelease(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!await portOpen(port)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

async function startRuntime(repairId: string, entrypoint: string, port: number, healthPath: string) {
  const started = await startOwnedProcess({ repairId, cmd: process.execPath, args: [entrypoint], label: `web:${entrypoint}:${port}`, env: { PORT: String(port), HOST: '127.0.0.1' } })
  if (!started.ok) throw new Error(`Web runtime failed to start: ${started.error}`)
  const origin = `http://127.0.0.1:${port}`
  if (!await waitForHealth(origin, healthPath)) {
    await stopOwnedProcesses(repairId)
    throw new Error(`Web runtime did not become ready at ${origin}${healthPath}`)
  }
  return { ...started, origin }
}

export async function planApplicationWebVerification(state: ApplicationBuildState): Promise<WebAcceptancePlan> {
  const source = await applicationSourceSnapshot()
  let rejected = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await requestLocalCoderJson({
      role: 'TEST_ENGINEER',
      system: 'Return JSON only. Design independent real-browser acceptance against the supplied web source and every Commander requirement. Every step name must be unique and descriptive. Every selector must be stable, present in source, and identify exactly one element; never use a broad selector such as button when the document contains multiple buttons. Assert a concrete non-empty empty-state message. For invalid form validation, fill every unrelated required field with a valid value before submitting the deliberately invalid field so native HTML validation cannot block the product handler. Cover successful creation, completion, open/completed/all filters, totals, reload persistence, restart persistence, and mobile layout whenever required by the contract. checkText must always contain non-empty expected text. Do not invent selectors or behavior. Shape: {"entrypoint":"server.mjs","healthPath":"/health","criteria":["exact criterion"],"steps":[{"name":"load","action":"goto"},{"name":"fillValidOtherField","action":"fill","selector":"#priority","value":"1"},{"name":"fillBlankTitle","action":"fill","selector":"#title","value":"   "},{"name":"submitBlankTitle","action":"click","selector":"#save"},{"name":"blankTitleError","action":"checkText","selector":"#error","text":"Required"},{"name":"reloadState","action":"reload"},{"name":"restartRuntime","action":"restart"},{"name":"persistedState","action":"checkText","selector":"#items","text":"Example"},{"name":"mobileViewport","action":"viewport","width":390,"height":844}]}. Actions allowed: goto, fill, click, checkText, checkValue, checkVisible, reload, restart, viewport.',
      prompt: JSON.stringify({ contract: state.contract, sources: source.sources, rejectedPlanDefects: rejected || undefined }),
      options: { num_ctx: 12288, num_predict: 4096, temperature: 0.1 },
    })
    if (!response.ok) throw new Error(`Independent web verifier unavailable: ${response.detail}`)
    const parsed = extractJsonObject(response.text) as Partial<WebAcceptancePlan> | null
    if (!parsed || typeof parsed.entrypoint !== 'string' || typeof parsed.healthPath !== 'string' || !Array.isArray(parsed.criteria) || !Array.isArray(parsed.steps)) { rejected = 'Invalid plan shape.'; continue }
    const allowed = new Set(['goto', 'fill', 'click', 'checkText', 'checkValue', 'checkVisible', 'reload', 'restart', 'viewport'])
    if (!parsed.steps.every(step => step && typeof step.name === 'string' && allowed.has(step.action))) { rejected = 'Invalid browser step shape or action.'; continue }
    const plan = { ...parsed, criteria: [...state.contract.acceptanceCriteria], sourceDigest: source.digest } as WebAcceptancePlan
    const defects = webAcceptancePlanDefects(plan, state.contract.commanderGoal)
    if (!plan.steps.some(step => step.action === 'click') || !plan.steps.some(step => step.action === 'fill')) defects.push('The plan lacks real fill/click interaction.')
    if (!defects.length) return plan
    rejected = defects.join(' ')
  }
  throw new Error(`Independent web verifier could not produce complete contract coverage: ${rejected}`)
}

export async function verifyApplicationWeb(state: ApplicationBuildState, plan: WebAcceptancePlan, repairId: string) {
  if (state.contract.projectType !== 'web') throw new Error('Web verification requires a web contract.')
  const before = await applicationSourceSnapshot()
  const loaded = await loadPlaywrightChromium()
  if (!loaded) throw new Error('BUILD_ENVIRONMENT_MISSING: Playwright Chromium is unavailable.')
  const port = await reserveLoopbackPort()
  const observations: Array<{ name: string; action: string; passed: boolean; detail: string }> = []
  let runtime = await startRuntime(repairId, plan.entrypoint, port, plan.healthPath)
  const browser = await loaded.chromium.launch({ headless: true, executablePath: loaded.executablePath, env: chromiumChildEnv(), args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.setDefaultTimeout(5_000)
  page.setDefaultNavigationTimeout(15_000)
  const consoleErrors: string[] = []
  const responseErrors: string[] = []
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }))
  page.on('response', response => {
    if (response.status() >= 400 && !/\/favicon\.ico(?:$|[?#])/i.test(response.url())) responseErrors.push(`${response.status()} ${response.url()}`)
  })
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/i.test(message.text())) consoleErrors.push(message.text())
  })
  let restartIndex = -1
  try {
    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index]
      try {
        if (step.action === 'goto') await page.goto(runtime.origin, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        else if (step.action === 'fill') await page.locator(step.selector!).fill(step.value ?? '')
        else if (step.action === 'click') await page.locator(step.selector!).click()
        else if (step.action === 'checkText') {
          const actual = await page.locator(step.selector!).innerText()
          if (!actual.includes(step.text ?? '')) throw new Error(`missing text ${JSON.stringify(step.text)}`)
        } else if (step.action === 'checkValue') {
          const actual = await page.locator(step.selector!).inputValue()
          if (actual !== (step.value ?? '')) throw new Error(`value ${JSON.stringify(actual)}`)
        } else if (step.action === 'checkVisible') await page.locator(step.selector!).waitFor({ state: 'visible', timeout: 5_000 })
        else if (step.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' })
        else if (step.action === 'viewport') await page.setViewportSize({ width: step.width!, height: step.height! })
        else if (step.action === 'restart') {
          restartIndex = index
          await stopOwnedProcesses(repairId)
          if (!await waitForPortRelease(port)) throw new Error('owned port did not release')
          runtime = await startRuntime(repairId, plan.entrypoint, port, plan.healthPath)
          await page.reload({ waitUntil: 'domcontentloaded' })
        }
        observations.push({ name: step.name, action: step.action, passed: true, detail: 'observed' })
      } catch (error) { observations.push({ name: step.name, action: step.action, passed: false, detail: String(error) }) }
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  await stopOwnedProcesses(repairId)
  const shutdown = await waitForPortRelease(port)
  const after = await applicationSourceSnapshot()
  const passed = observations.every(item => item.passed) && consoleErrors.length === 0 && responseErrors.length === 0 && shutdown && before.digest === after.digest
  const artifact = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'application-verification', `${randomUUID()}.json`)
  await mkdir(path.dirname(artifact), { recursive: true })
  await writeFile(artifact, JSON.stringify({ missionId: repairId, sourceDigest: before.digest, afterDigest: after.digest, port, plan, observations, consoleErrors, responseErrors, shutdown, passed, planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }, null, 2))
  const evidence = (kind: ApplicationProofKind) => ({ kind, sourceDigest: before.digest, evidenceRef: artifact, passed, criteria: passed ? plan.criteria : [] })
  const restartObserved = restartIndex >= 0 && observations.slice(restartIndex + 1).some(item => item.passed && /^check/.test(item.action))
  for (const kind of webEvidenceKinds(state.contract.runtimeRequirements, restartObserved)) state.runtimeEvidence.push(evidence(kind))
  state.runtimeEvidence = state.runtimeEvidence.slice(-80)
  return { passed, artifact, observations, consoleErrors, responseErrors, shutdown }
}
