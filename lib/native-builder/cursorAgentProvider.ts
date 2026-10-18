import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { foundryDataHierarchy } from './foundryPaths'
import { redactSecretsFromOutput } from './outputRedaction'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { buildFoundryModelPrompt, FOUNDRY_MODEL_SYSTEM_PROMPT } from './foundryModelPrompt'
import type {
  FoundryMissionModel,
  FoundryModelRequest,
  FoundryModelResponse,
} from './foundryModelTypes'

export const CURSOR_AGENT_EXECUTABLE =
  '/home/chosenone/.config/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent'

const TIMEOUT_MS = 180_000
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

type TreeEntry = { path: string; sha256: string; size: number }

async function snapshotTree(root: string): Promise<TreeEntry[]> {
  const names = await readdir(root, { recursive: true })
  const entries: TreeEntry[] = []
  for (const name of names.sort()) {
    const absolute = path.join(root, name)
    const info = await stat(absolute).catch(() => null)
    if (!info?.isFile()) continue
    const content = await readFile(absolute)
    entries.push({
      path: name,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.length,
    })
  }
  return entries
}

function safeEnvironment() {
  const dirs = foundryDataHierarchy()
  const home = path.join(dirs.cursorAgentState, 'home')
  const config = path.join(dirs.cursorAgentState, 'config')
  const data = path.join(dirs.cursorAgentState, 'data')
  const runtime = path.join(dirs.cursorAgentState, 'runtime')
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: process.env.LANG ?? 'C.UTF-8',
    HOME: home,
    TMPDIR: dirs.cursorAgentLogs,
    TMP: dirs.cursorAgentLogs,
    TEMP: dirs.cursorAgentLogs,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: dirs.cursorAgentCache,
    XDG_STATE_HOME: runtime,
    CURSOR_DATA_DIR: data,
    NO_OPEN_BROWSER: '1',
  }
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL
  return env
}

async function runCursorAgent(model: string, request: FoundryModelRequest): Promise<
  { ok: true; text: string; model: string } | { ok: false; error: string; model: string }
> {
  const dirs = foundryDataHierarchy()
  const stateDirs = [
    path.join(dirs.cursorAgentState, 'home'),
    path.join(dirs.cursorAgentState, 'config'),
    path.join(dirs.cursorAgentState, 'data'),
    path.join(dirs.cursorAgentState, 'runtime'),
  ]
  await Promise.all([
    mkdir(dirs.cursorAgentWorkspace, { recursive: true }),
    mkdir(dirs.cursorAgentLogs, { recursive: true }),
    mkdir(dirs.cursorAgentCache, { recursive: true }),
    ...stateDirs.map(dir => mkdir(dir, { recursive: true })),
  ])
  const repo = path.resolve(resolveRepoRoot())
  const workspace = path.resolve(dirs.cursorAgentWorkspace)
  const relative = path.relative(repo, workspace)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return { ok: false, error: 'Cursor reasoning workspace must be outside the War Room repository.', model }
  }
  const before = JSON.stringify(await snapshotTree(workspace))
  return new Promise(resolve => {
    const prompt = redactSecretsFromOutput(
      `${FOUNDRY_MODEL_SYSTEM_PROMPT}\n\n${buildFoundryModelPrompt(request)}\n\nReturn ONLY the decision JSON object. Do not call Cursor tools or inspect the workspace.`,
    )
    const args = [
      '--print',
      '--mode=ask',
      '--output-format=json',
      '--model',
      model,
      '--workspace',
      workspace,
      '--trust',
      '--sandbox',
      'disabled',
      prompt,
    ]
    const started = Date.now()
    const child = spawn(CURSOR_AGENT_EXECUTABLE, args, {
      cwd: workspace,
      env: safeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let exceeded = false
    let settled = false
    const timerRef: { current?: NodeJS.Timeout } = {}
    const finish = async (result: { ok: true; text: string; model: string } | { ok: false; error: string; model: string }) => {
      if (settled) return
      settled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      const after = JSON.stringify(await snapshotTree(workspace))
      const mutation = before !== after
      const finalResult = mutation
        ? { ok: false as const, error: 'Cursor Agent modified its isolated reasoning workspace; provider call refused.', model }
        : result
      await logWarRoomRepoAudit('foundry-model: cursor-agent', {
        provider: 'cursor-agent',
        model,
        ok: finalResult.ok,
        durationMs: Date.now() - started,
        stdoutBytes,
        stderrBytes,
        reasoningWorkspaceChanged: mutation,
      })
      resolve(finalResult)
    }
    const collect = (target: Buffer[], chunk: Buffer, kind: 'stdout' | 'stderr') => {
      if (kind === 'stdout') stdoutBytes += chunk.length
      else stderrBytes += chunk.length
      if (stdoutBytes + stderrBytes > MAX_OUTPUT_BYTES) {
        exceeded = true
        child.kill('SIGTERM')
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', chunk => collect(stdout, Buffer.from(chunk), 'stdout'))
    child.stderr.on('data', chunk => collect(stderr, Buffer.from(chunk), 'stderr'))
    child.on('error', error => void finish({ ok: false, error: redactSecretsFromOutput(error.message), model }))
    child.on('close', code => {
      if (exceeded) {
        void finish({ ok: false, error: `Cursor Agent exceeded the ${MAX_OUTPUT_BYTES}-byte output limit.`, model })
        return
      }
      const out = Buffer.concat(stdout).toString('utf8')
      const err = redactSecretsFromOutput(Buffer.concat(stderr).toString('utf8'))
      if (code !== 0) {
        void finish({ ok: false, error: `Cursor Agent exited ${code}: ${err.slice(0, 4_000)}`, model })
        return
      }
      try {
        const envelope = JSON.parse(out) as { type?: string; subtype?: string; is_error?: boolean; result?: unknown }
        if (envelope.type !== 'result' || envelope.is_error === true || typeof envelope.result !== 'string') {
          void finish({ ok: false, error: 'Cursor Agent returned an invalid result envelope.', model })
          return
        }
        void finish({ ok: true, text: redactSecretsFromOutput(envelope.result), model })
      } catch {
        void finish({ ok: false, error: 'Cursor Agent output was not valid JSON.', model })
      }
    })
    timerRef.current = setTimeout(() => {
      child.kill('SIGTERM')
      void finish({ ok: false, error: `Cursor Agent timed out after ${TIMEOUT_MS}ms.`, model })
    }, TIMEOUT_MS)
  })
}

export class CursorAgentProvider implements FoundryMissionModel {
  readonly provider = 'cursor-agent' as const
  constructor(readonly model: string) {
  }
  private async run(request: FoundryModelRequest): Promise<FoundryModelResponse> {
    const started = Date.now()
    const result = await runCursorAgent(this.model, request)
    if (!result.ok) {
      return {
        ok: false,
        provider: this.provider,
        model: this.model,
        error: result.error,
        failureClass: /timed out/i.test(result.error) ? 'TIMEOUT' : /not valid|invalid/i.test(result.error) ? 'MALFORMED' : 'PROVIDER',
        latencyMs: Date.now() - started,
      }
    }
    const parsed = parseAndValidateModelDecision(
      result.text,
      request.context.permissions,
      new Set(request.context.tools.map(tool => tool.name)),
    )
    if (!parsed.ok) {
      return {
        ok: false,
        provider: this.provider,
        model: this.model,
        error: parsed.error,
        failureClass: 'MALFORMED',
        latencyMs: Date.now() - started,
      }
    }
    return {
      ok: true,
      provider: this.provider,
      model: this.model,
      decision: parsed.decision,
      rawText: result.text,
      latencyMs: Date.now() - started,
    }
  }
  reasonMission(request: FoundryModelRequest) { return this.run({ ...request, kind: 'reasonMission' }) }
  chooseNextAction(request: FoundryModelRequest) { return this.run({ ...request, kind: 'chooseNextAction' }) }
  diagnoseFailure(request: FoundryModelRequest) { return this.run({ ...request, kind: 'diagnoseFailure' }) }
  replan(request: FoundryModelRequest) { return this.run({ ...request, kind: 'replan' }) }
  summarizeProgress(request: FoundryModelRequest) { return this.run({ ...request, kind: 'summarizeProgress' }) }
}
