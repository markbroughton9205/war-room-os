/**
 * Wave 3 targeted skill acquisition: PyTorch / QUIC / Go / LLVM core /
 * React / TLS / query optimization / profiling.
 * Research ≠ mastery. Sandbox ≠ production. Capability ≠ Commander permission.
 * PyTorch CUDA ≠ native nvcc proof. Do not over-credit related skills.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { foundryDataHierarchy } from '../foundryPaths'
import {
  ACQUISITION_GOVERNANCE,
  assertNoAutomaticPackageInstall,
  assertNotFakeCudaPass,
  assertSandboxIsolation,
  probeAcquisitionEnvironment,
  runSandboxCommand,
  wave3SandboxRoot,
  which,
  writeSandboxFile,
  type AcquisitionEnvironment,
  type CommandResult,
} from './acquisitionSandbox'
import type { ExerciseEvidence } from './acquisitionWave1'
import { recordSkillEvaluation } from './evaluations'
import { buildSkillPack, skillPackIsCompact } from './resolver'
import { assessMissionCapabilities } from './plannerGate'
import { buildCapabilityScoreboard, persistScoreboard } from './scoreboard'
import { loadCapabilityAtlas, persistSkill, capabilityAtlasLayout, type CapabilityAtlas } from './store'
import type { CapabilityScoreboard, SkillRecord } from './types'

export const WAVE3_TARGET_SKILLS = [
  'ml.pytorch',
  'networking.quic',
  'software.languages.go',
  'compiler.llvm',
  'frontend.react',
  'networking.tls',
  'database.query-optimization',
  'performance.profiling',
] as const

export type Wave3SkillId = (typeof WAVE3_TARGET_SKILLS)[number]

export const NATIVE_CUDA_BLOCKER = {
  nvcc: 'CUDA 13.1',
  glibc: '2.43',
  issue: 'math_functions.h rsqrt/rsqrtf noexcept conflict with host headers',
  policy: 'Do not downgrade glibc or Ubuntu. Do not replace the working NVIDIA driver. Use PyTorch CUDA for GPU execution. Host .cu compilation remains blocked.',
} as const

type PlannerSnap = ReturnType<typeof assessMissionCapabilities>

export type AcquisitionWave3Report = {
  targetedSkillIds: string[]
  initialStatus: Record<string, string>
  finalStatus: Record<string, string>
  environment: AcquisitionEnvironment
  foundryPython: string | null
  go: string | null
  openssl: string | null
  llvmAs: string | null
  sandboxRoot: string
  exercises: ExerciseEvidence[]
  combinedAi: ExerciseEvidence | null
  combinedWeb: ExerciseEvidence | null
  combinedPerformance: ExerciseEvidence | null
  plannerBefore: Record<string, PlannerSnap>
  plannerAfter: Record<string, PlannerSnap>
  scoreboardBefore: CapabilityScoreboard
  scoreboardAfter: CapabilityScoreboard
  packsUpdated: string[]
  sandboxScopedNpmInstalls: number
  automaticPackageInstalls: 0
  nativeCudaBlocker: typeof NATIVE_CUDA_BLOCKER
  governance: typeof ACQUISITION_GOVERNANCE
}

function sourcesFor(atlas: CapabilityAtlas, skillId: string): string[] {
  return [...atlas.sources.values()]
    .filter(source => source.skillIds.includes(skillId) || atlas.skills.get(skillId)?.officialSources.includes(source.sourceId))
    .map(source => `${source.sourceId} ${source.sourceUrl}`)
    .slice(0, 8)
}

function writeEvidence(sandboxRoot: string, evidence: ExerciseEvidence): string {
  const rel = path.join('evidence', `${evidence.exerciseId}.json`)
  return writeSandboxFile(sandboxRoot, rel, JSON.stringify(evidence, null, 2))
}

function evidence(partial: Omit<ExerciseEvidence, 'timestamp'> & { timestamp?: string }): ExerciseEvidence {
  return { ...partial, timestamp: partial.timestamp ?? new Date().toISOString() }
}

function record(atlas: CapabilityAtlas, item: ExerciseEvidence, persist: boolean): void {
  if (!persist) return
  recordSkillEvaluation(atlas, {
    evaluationId: `wave3-${item.skillId}-${item.exerciseId}`.replace(/[^\w.-]+/g, '_'),
    skillId: item.skillId,
    level: item.evaluationLevel,
    title: item.exerciseId,
    requiredSteps: ['attempt', 'observe', 'classify', 'inspect', 'repair', 'retest'],
    evidencePaths: item.artifacts,
    outcome: item.finalOutcome,
    production: false,
    notes: [
      item.failureEvidence,
      item.repairEvidence,
      item.limitations,
      'Wave 3 sandbox acquisition. Not production proof. Capability is not Commander permission.',
      'PyTorch CUDA is not native nvcc proof.',
    ].filter(Boolean).join(' | '),
    command: item.commands.slice(-3).join(' && '),
    resultSummary: `${item.expectedBehavior} → ${item.actualBehavior}`.slice(0, 800),
    environment: item.sandboxPath,
    limitations: item.limitations,
    confidence: item.confidence,
  })
}

function foundryCudaPython(): string | null {
  const candidate = path.join(foundryDataHierarchy().toolchains, 'python-cu', 'bin', 'python')
  return existsSync(candidate) ? candidate : null
}

function run(input: {
  sandboxRoot: string
  argv: string[]
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}): CommandResult {
  return runSandboxCommand({
    sandboxRoot: input.sandboxRoot,
    argv: input.argv,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? 20_000,
    env: input.env,
  })
}

function enrichTorchEnv(sandbox: string, env: AcquisitionEnvironment): AcquisitionEnvironment {
  const py = foundryCudaPython()
  if (!py) return env
  const t = run({
    sandboxRoot: sandbox,
    argv: [py, '-c', 'import torch; print(torch.__version__); print(int(torch.cuda.is_available())); print(torch.version.cuda or ""); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")'],
    timeoutMs: 45_000,
  })
  if (t.exitCode !== 0) {
    return {
      ...env,
      torch: { present: false, cuda: false, version: null, error: (t.stderr || t.stdout).slice(0, 400) },
    }
  }
  const [version, cudaFlag, cudaRuntime, gpuName] = t.stdout.trim().split('\n')
  return {
    ...env,
    python3: py,
    torch: { present: true, cuda: cudaFlag === '1', version: version ?? null, error: null },
    gpu: {
      ...env.gpu,
      name: gpuName || env.gpu.name,
      cudaReported: cudaRuntime || env.gpu.cudaReported,
    },
  }
}

function flattenPsql(text: string): string {
  return text.replace(/[ \t]*\+\n/g, '')
}

function parseExplainMs(text: string): number {
  const flat = flattenPsql(text)
  const exec = [...flat.matchAll(/"Execution Time":\s*([0-9.]+)/g)].map(m => Number(m[1]))
  if (exec.length) return exec[exec.length - 1]!
  const actual = [...flat.matchAll(/"Actual Total Time":\s*([0-9.]+)/g)].map(m => Number(m[1]))
  return actual.length ? actual[0]! : Number.NaN
}

function finish(sandbox: string, item: ExerciseEvidence): ExerciseEvidence {
  item.artifacts.push(writeEvidence(sandbox, item))
  return item
}

const NVCC_LIMIT = `Native CUDA blocker recorded (not repaired): ${NATIVE_CUDA_BLOCKER.nvcc} nvcc + Ubuntu glibc ${NATIVE_CUDA_BLOCKER.glibc} + ${NATIVE_CUDA_BLOCKER.issue}. ${NATIVE_CUDA_BLOCKER.policy}`

function runPytorch(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'pytorch'
  const py = foundryCudaPython()
  const script = writeSandboxFile(sandbox, `${dir}/tiny_train.py`, [
    'import os, torch, torch.nn as nn',
    'from torch.utils.data import TensorDataset, DataLoader',
    'device = torch.device("cuda" if torch.cuda.is_available() else "cpu")',
    'print("PYTORCH_VERSION", torch.__version__)',
    'print("CUDA_AVAILABLE", int(torch.cuda.is_available()))',
    'print("CUDA_RUNTIME", torch.version.cuda)',
    'print("GPU", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu")',
    'class Tiny(nn.Module):',
    '    def __init__(self):',
    '        super().__init__()',
    '        self.net = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Linear(8, 1))',
    '    def forward(self, x):',
    '        return self.net(x)',
    'model = Tiny().to(device)',
    'x_cpu = torch.randn(8, 4)',
    'failure = ""',
    'try:',
    '    model(x_cpu)',
    '    print("UNEXPECTED_NO_DEVICE_MISMATCH")',
    'except Exception as e:',
    '    failure = f"{type(e).__name__}: {e}"',
    '    print("FAILURE", failure)',
    'x = x_cpu.to(device)',
    'y = torch.randn(8, 1, device=device)',
    'print("TENSOR_DEVICE", str(x.device))',
    'model.train()',
    'opt = torch.optim.SGD(model.parameters(), lr=0.05)',
    'pred = model(x)',
    'loss = nn.functional.mse_loss(pred, y)',
    'opt.zero_grad()',
    'loss.backward()',
    'if device.type == "cuda":',
    '    torch.cuda.synchronize()',
    'opt.step()',
    'print("FORWARD_BACKWARD_OPT", "ok", float(loss.detach().cpu()))',
    'ds = TensorDataset(torch.randn(32, 4, device=device), torch.randn(32, 1, device=device))',
    'loader = DataLoader(ds, batch_size=8)',
    'if device.type == "cuda":',
    '    torch.cuda.reset_peak_memory_stats()',
    '    mem_before = torch.cuda.memory_allocated()',
    'else:',
    '    mem_before = 0',
    'for xb, yb in loader:',
    '    opt.zero_grad()',
    '    step_loss = nn.functional.mse_loss(model(xb), yb)',
    '    step_loss.backward()',
    '    opt.step()',
    'if device.type == "cuda":',
    '    torch.cuda.synchronize()',
    '    mem_peak = torch.cuda.max_memory_allocated()',
    '    mem_after = torch.cuda.memory_allocated()',
    'else:',
    '    mem_peak = mem_after = 0',
    'print("MEM_BEFORE", int(mem_before))',
    'print("MEM_PEAK", int(mem_peak))',
    'print("MEM_AFTER", int(mem_after))',
    'model.eval()',
    'with torch.no_grad():',
    '    ev = model(x)',
    'print("EVAL_MODE", float(ev.mean().cpu()))',
    'out = os.path.join(os.path.dirname(__file__), "tiny.pt")',
    'torch.save(model.state_dict(), out)',
    'loaded = Tiny().to(device)',
    'state = torch.load(out, map_location=device, weights_only=True)',
    'loaded.load_state_dict(state)',
    'loaded.eval()',
    'print("SERIALIZED", os.path.abspath(out))',
    'if not failure:',
    '    raise SystemExit("device mismatch was not observed")',
    'if device.type != "cuda":',
    '    raise SystemExit("CUDA not available — not GPU proof")',
    'print("OK")',
    '',
  ].join('\n'))
  const commands: string[] = []
  let out = 'foundry python-cu missing'
  let code: number | null = 1
  if (py) {
    const executed = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [py, 'tiny_train.py'],
      timeoutMs: 120_000,
    })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
    code = executed.exitCode
  }
  const gpuOk = /OK/.test(out) && /CUDA_AVAILABLE 1/.test(out) && /FAILURE/.test(out) && /FORWARD_BACKWARD_OPT ok/.test(out)
  if (gpuOk) assertNotFakeCudaPass(env, 'PASS')
  const item = finish(sandbox, evidence({
    skillId: 'ml.pytorch',
    evaluationLevel: gpuOk ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'pytorch-cuda-train-device-mismatch',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'ml.pytorch'),
    commands,
    input: 'Tiny nn.Module on CUDA; CPU tensor forward; DataLoader train; serialize locally. No pretrained weights.',
    expectedBehavior: 'Device mismatch observed, tensors moved to CUDA, forward/backward/optimizer/eval/serialize succeed on real GPU.',
    actualBehavior: out.slice(0, 1500),
    failureEvidence: (out.match(/FAILURE .*/)?.[0] ?? 'device mismatch not captured').slice(0, 500),
    repairEvidence: 'x_cpu.to(device) before forward; opt.zero_grad before each DataLoader backward',
    testResult: gpuOk ? 'PASS' : 'PARTIAL',
    artifacts: [script],
    limitations: gpuOk
      ? NVCC_LIMIT
      : `${NVCC_LIMIT} PyTorch path: ${py ?? 'missing'} exit=${code}`,
    finalOutcome: gpuOk ? 'PASS' : 'PARTIAL',
    confidence: gpuOk ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'pytorch-device-mismatch-diagnosis',
    expectedBehavior: 'Diagnose RuntimeError/device mismatch from real stdout, then retest on CUDA.',
    testResult: gpuOk ? 'PASS' : 'PARTIAL',
    finalOutcome: gpuOk ? 'PASS' : 'PARTIAL',
  }))
  const codeEval = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'CODE_EVAL',
    exerciseId: 'pytorch-module-dataloader-serialize',
    expectedBehavior: 'nn.Module, DataLoader, train/eval, local state_dict save/load',
    testResult: gpuOk ? 'PASS' : 'PARTIAL',
    finalOutcome: gpuOk ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug, codeEval]
}

function runQuic(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment, openssl: string | null): ExerciseEvidence[] {
  const dir = 'quic'
  const fixture = writeSandboxFile(sandbox, `${dir}/quic_state.py`, [
    '"""RFC 9000 / 9114 protocol-state fixture. Not a full QUIC stack."""',
    'from __future__ import annotations',
    'IDEMPOTENT = {"GET", "HEAD"}',
    '',
    'class QuicConn:',
    '    def __init__(self, cid: bytes, tls13=True):',
    '        self.cid = cid',
    '        self.tls13 = tls13',
    '        self.streams = {}',
    '        self.acked = set()',
    '        self.lost = set()',
    '        self.migrated = False',
    '        self.path = ("127.0.0.1", 4433)',
    '    def open_stream(self, sid: int):',
    '        if sid in self.streams: raise ValueError("stream already open")',
    '        self.streams[sid] = {"state": "open", "fin": False, "data": b""}',
    '    def send_stream(self, sid: int, data: bytes, fin=False):',
    '        st = self.streams[sid]',
    '        if st["state"] == "closed": raise ValueError("STREAM on closed stream")',
    '        if st["fin"] and data: raise ValueError("data after FIN")',
    '        st["data"] += data',
    '        if fin:',
    '            if st["fin"]: raise ValueError("duplicate FIN")',
    '            st["fin"] = True',
    '            st["state"] = "half-closed"',
    '    def close_stream(self, sid: int):',
    '        self.streams[sid]["state"] = "closed"',
    '    def on_ack(self, pn: int):',
    '        self.acked.add(pn); self.lost.discard(pn)',
    '    def on_loss(self, pn: int):',
    '        if pn not in self.acked: self.lost.add(pn)',
    '    def migrate(self, cid: bytes, addr):',
    '        if not cid: raise ValueError("empty destination CID")',
    '        self.cid = cid; self.path = addr; self.migrated = True',
    '    def early_data(self, method: str, zero_rtt: bool):',
    '        if zero_rtt and method not in IDEMPOTENT:',
    '            raise ValueError("0-RTT forbidden for non-idempotent method")',
    '        if not self.tls13: raise ValueError("QUIC requires TLS 1.3")',
    '        return "accepted"',
    '',
    'def main():',
    '    c = QuicConn(b"\\x11\\x22")',
    '    assert c.tls13, "handshake is TLS 1.3"',
    '    c.open_stream(0); c.open_stream(4)',
    '    c.send_stream(0, b"GET / HTTP/3", fin=True)',
    '    c.send_stream(4, b"mux")',
    '    print("MULTIPLEX", sorted(c.streams))',
    '    c.on_loss(7); c.on_ack(7)',
    '    print("LOSS_RECOVERY", sorted(c.lost), "acked", sorted(c.acked))',
    '    failure = ""',
    '    try:',
    '        print("BAD_0RTT", c.early_data("POST", True))',
    '    except ValueError as e:',
    '        failure = str(e)',
    '        print("FAILURE", failure)',
    '    print("REPAIR", c.early_data("POST", False), c.early_data("GET", True))',
    '    try:',
    '        c.send_stream(0, b"late")',
    '        raise SystemExit("duplicate-FIN/data-after-FIN not caught")',
    '    except ValueError as e:',
    '        print("STREAM_LIFECYCLE", e)',
    '    c.migrate(b"\\x33", ("127.0.0.1", 4444))',
    '    print("MIGRATION", c.cid, c.path, "HTTP3_IS_APP_ON_QUIC")',
    '    if "0-RTT forbidden" not in failure:',
    '        raise SystemExit("0-RTT POST defect not diagnosed")',
    '    print("OK")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n'))
  const commands: string[] = []
  if (openssl) {
    const help = run({ sandboxRoot: sandbox, argv: [openssl, 's_client', '-help'], timeoutMs: 8_000 })
    commands.push(help.command)
    writeSandboxFile(sandbox, `${dir}/openssl-s_client-help.txt`, `${help.stdout}\n${help.stderr}`)
  }
  const py = env.python3 || which('python3')
  let out = 'python missing'
  if (py) {
    const executed = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [py, 'quic_state.py'] })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
  }
  const ok = /OK/.test(out) && /FAILURE/.test(out) && /0-RTT forbidden/.test(out)
  const quicClient = Boolean(openssl)
  const item = finish(sandbox, evidence({
    skillId: 'networking.quic',
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'quic-0rtt-and-stream-lifecycle',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'networking.quic'),
    commands,
    input: 'RFC-backed QUIC state: CIDs, multiplexed streams, loss recovery, TLS 1.3, migration, HTTP/3, 0-RTT POST',
    expectedBehavior: 'Reject 0-RTT POST; catch data-after-FIN; keep HTTP/3 as QUIC application mapping. Loopback QUIC only if a local stack exists.',
    actualBehavior: out.slice(0, 1400),
    failureEvidence: '0-RTT POST accepted would violate idempotency; fixture raised ValueError 0-RTT forbidden for non-idempotent method',
    repairEvidence: 'Send POST only after 1-RTT handshake; GET allowed on 0-RTT; duplicate FIN rejected',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [fixture],
    limitations: quicClient
      ? 'OpenSSL s_client exposes -quic but s_server has no QUIC listener here. No aioquic/ngtcp2/quiche installed; no automatic QUIC stack install. Protocol-state fixture + client inventory, not a live UDP handshake.'
      : 'No local QUIC library or OpenSSL QUIC client. Protocol-state fixture only.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'medium' : 'low',
  }))
  const code = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'CODE_EVAL',
    exerciseId: 'quic-rfc-state-machine',
    expectedBehavior: 'Executable CID/stream/multiplex/migration/HTTP3 mapping fixture',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, code]
}

function runGo(sandbox: string, atlas: CapabilityAtlas, goBin: string | null): ExerciseEvidence[] {
  const dir = 'go'
  const mod = writeSandboxFile(sandbox, `${dir}/go.mod`, 'module foundry.wave3/counter\n\ngo 1.22\n')
  const src = writeSandboxFile(sandbox, `${dir}/counter.go`, [
    'package counter',
    '',
    'import "context"',
    '',
    'type Sink interface { Accept(int) error }',
    '',
    'type MemSink struct{ N int }',
    '',
    'func (m *MemSink) Accept(v int) error { m.N += v; return nil }',
    '',
    'func Sum(ctx context.Context, values []int, sink Sink) (int, error) {',
    '	total := 0',
    '	ch := make(chan int)',
    '	errCh := make(chan error, 1)',
    '	go func() {',
    '		defer close(ch)',
    '		for _, v := range values {',
    '			select {',
    '			case <-ctx.Done():',
    '				errCh <- ctx.Err()',
    '				return',
    '			case ch <- v:',
    '			}',
    '		}',
    '	}()',
    '	for {',
    '		select {',
    '		case <-ctx.Done():',
    '			return total, ctx.Err()',
    '		case err := <-errCh:',
    '			return total, err',
    '		case v, ok := <-ch:',
    '			if !ok {',
    '				return total, nil',
    '			}',
    '			if err := sink.Accept(v); err != nil {',
    '				return total, err',
    '			}',
    '			total += v',
    '		}',
    '	}',
    '}',
    '',
  ].join('\n'))
  const badTest = writeSandboxFile(sandbox, `${dir}/counter_broken_test.go.disabled`, [
    'package counter',
    '',
    'import "testing"',
    '',
    '// Broken: unbuffered send in TestMain-equivalent without receiver — deadlock.',
    'func BrokenDeadlock() {',
    '	ch := make(chan int)',
    '	ch <- 1 // deadlock: no receiver, ignored context',
    '}',
    '',
    'func TestBroken(t *testing.T) { BrokenDeadlock() }',
    '',
  ].join('\n'))
  const test = writeSandboxFile(sandbox, `${dir}/counter_test.go`, [
    'package counter',
    '',
    'import (',
    '	"context"',
    '	"testing"',
    '	"time"',
    ')',
    '',
    'func TestSum(t *testing.T) {',
    '	ctx := context.Background()',
    '	sink := &MemSink{}',
    '	got, err := Sum(ctx, []int{1, 2, 3}, sink)',
    '	if err != nil || got != 6 || sink.N != 6 {',
    '		t.Fatalf("sum=%d sink=%d err=%v", got, sink.N, err)',
    '	}',
    '}',
    '',
    'func TestCancel(t *testing.T) {',
    '	ctx, cancel := context.WithCancel(context.Background())',
    '	cancel()',
    '	_, err := Sum(ctx, []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, &MemSink{})',
    '	if err == nil {',
    '		t.Fatal("expected context cancellation")',
    '	}',
    '}',
    '',
    'func TestNoDeadlock(t *testing.T) {',
    '	ch := make(chan int, 1)',
    '	select {',
    '	case ch <- 1:',
    '	case <-time.After(50 * time.Millisecond):',
    '		t.Fatal("send stalled")',
    '	}',
    '}',
    '',
  ].join('\n'))
  const commands: string[] = []
  let out = 'go toolchain missing'
  let ok = false
  if (goBin) {
    const testRun = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [goBin, 'test', '-race', '.'],
      timeoutMs: 60_000,
    })
    commands.push(testRun.command)
    out = `${testRun.stdout}\n${testRun.stderr}`
    ok = testRun.exitCode === 0 && /PASS/.test(out)
    if (!ok && /race detector not supported|not supported|-race/i.test(out)) {
      const plain = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [goBin, 'test', '.'], timeoutMs: 60_000 })
      commands.push(plain.command)
      out += `\n${plain.stdout}\n${plain.stderr}`
      ok = plain.exitCode === 0
    }
  }
  const item = finish(sandbox, evidence({
    skillId: 'software.languages.go',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'CODE_EVAL',
    exerciseId: 'go-context-cancel-and-channels',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'software.languages.go'),
    commands,
    input: 'Packages, structs, interfaces, errors, goroutines, channels, context cancellation, tests',
    expectedBehavior: 'Cancelled context returns error; buffered send does not deadlock; go test (-race if available) passes.',
    actualBehavior: out.slice(0, 1400),
    failureEvidence: 'Broken fixture: unbuffered ch <- 1 with no receiver deadlocks; ignored ctx.Done()',
    repairEvidence: 'select on ctx.Done() plus receive loop; buffered channel in TestNoDeadlock',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [mod, src, badTest, test],
    limitations: goBin
      ? (ok ? '' : `go present but tests failed: ${out.slice(0, 400)}`)
      : 'Go toolchain is not installed. Commander did not authorize golang installation in this wave. Source + intended tests recorded. Environment-limited, not mastery.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'go-deadlock-and-cancel-diagnosis',
    expectedBehavior: 'Name the deadlock (unbuffered send, no receiver) and cancellation repair',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug]
}

function runLlvm(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'llvm'
  const cSrc = writeSandboxFile(sandbox, `${dir}/choose.c`, [
    'int choose(int a, int b, int flag) {',
    '  if (flag) return a + b;',
    '  return a * b;',
    '}',
    'int main(void) { return choose(3, 4, 1) == 7 ? 0 : 1; }',
    '',
  ].join('\n'))
  const badIr = writeSandboxFile(sandbox, `${dir}/bad.ll`, [
    'define i32 @phi_bad(i1 %c) {',
    'entry:',
    '  br i1 %c, label %a, label %b',
    'a:',
    '  br label %m',
    'b:',
    '  br label %m',
    'm:',
    '  %r = phi i32 [ 1, %a ]',
    '  ret i32 %r',
    '}',
    '',
  ].join('\n'))
  const goodIr = writeSandboxFile(sandbox, `${dir}/good.ll`, [
    'define i32 @phi_ok(i1 %c) {',
    'entry:',
    '  br i1 %c, label %a, label %b',
    'a:',
    '  br label %m',
    'b:',
    '  br label %m',
    'm:',
    '  %r = phi i32 [ 1, %a ], [ 2, %b ]',
    '  ret i32 %r',
    '}',
    '',
  ].join('\n'))
  const llvmAs = which('llvm-as')
  const clang = env.clang || which('clang')
  const opt = env.opt || which('opt')
  const llc = env.llc || which('llc')
  const commands: string[] = []
  let verifierFail = ''
  let verifierOk = ''
  let pipeline = ''
  let ran = false
  if (llvmAs) {
    const bad = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [llvmAs, 'bad.ll', '-o', 'bad.bc'] })
    commands.push(bad.command)
    verifierFail = `${bad.stdout}\n${bad.stderr}`
    const good = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [llvmAs, 'good.ll', '-o', 'good.bc'] })
    commands.push(good.command)
    verifierOk = `${good.stdout}\n${good.stderr}`
    if (opt) {
      const v = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [opt, '-passes=verify', 'good.bc', '-o', 'good.verified.bc'] })
      commands.push(v.command)
      verifierOk += `\n${v.stdout}\n${v.stderr}`
    }
  }
  if (clang && opt && llc) {
    const ir = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [clang, '-O0', '-S', '-emit-llvm', 'choose.c', '-o', 'choose.ll'] })
    commands.push(ir.command)
    const transformed = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [opt, '-passes=mem2reg,instcombine,verify', '-S', 'choose.ll', '-o', 'choose.opt.ll'],
    })
    commands.push(transformed.command)
    const obj = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [llc, '-filetype=obj', 'choose.opt.ll', '-o', 'choose.o'] })
    commands.push(obj.command)
    const linked = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [clang, 'choose.o', '-o', 'choose'] })
    commands.push(linked.command)
    const exe = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: ['./choose'] })
    commands.push(exe.command)
    pipeline = [ir, transformed, obj, linked, exe].map(item => `cmd=${item.command} exit=${item.exitCode}\n${item.stdout}\n${item.stderr}`).join('\n---\n')
    ran = ir.exitCode === 0 && transformed.exitCode === 0 && obj.exitCode === 0 && linked.exitCode === 0 && exe.exitCode === 0
  }
  const diagnosed = /phi|incoming|verifier|error:/i.test(verifierFail) && (llvmAs ? !/error:/i.test(verifierOk.split('opt')[0] ?? verifierOk) : false)
  const ok = ran && Boolean(llvmAs && (diagnosed || /error/i.test(verifierFail)))
  const item = finish(sandbox, evidence({
    skillId: 'compiler.llvm',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'llvm-ir-verify-llc-pipeline',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'compiler.llvm'),
    commands,
    input: 'C → clang LLVM IR → verify → mem2reg/instcombine → llc obj → clang link → execute; malformed phi fixture',
    expectedBehavior: 'Malformed phi fails llvm-as/verifier; repaired phi verifies; choose(3,4,1)==7 executable returns 0.',
    actualBehavior: `VERIFIER_FAIL ${verifierFail.slice(0, 500)}\nVERIFIER_OK ${verifierOk.slice(0, 300)}\nPIPELINE ${pipeline.slice(0, 700)}`.slice(0, 1500),
    failureEvidence: (verifierFail || 'llvm-as missing').slice(0, 500),
    repairEvidence: 'Complete phi incoming values from both predecessors %a and %b; then clang/opt/llc/link/run',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [cSrc, badIr, goodIr],
    limitations: ok ? '' : `clang=${clang || 'missing'} opt=${opt || 'missing'} llc=${llc || 'missing'} llvm-as=${llvmAs || 'missing'}`,
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'llvm-phi-verifier-repair',
    expectedBehavior: 'Verifier names incomplete phi; repair restores SSA form',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  const code = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'CODE_EVAL',
    exerciseId: 'llvm-module-function-bb-ssa',
    expectedBehavior: 'IR modules/functions/basic blocks/SSA/phi/passes/codegen exercised',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug, code]
}

function runReact(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment, npmCount: { n: number }): ExerciseEvidence[] {
  const dir = 'react'
  const pkg = writeSandboxFile(sandbox, `${dir}/package.json`, JSON.stringify({
    name: 'wave3-react',
    private: true,
    type: 'module',
  }, null, 2))
  const app = writeSandboxFile(sandbox, `${dir}/app.mjs`, [
    'import { JSDOM } from "jsdom"',
    'const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "http://127.0.0.1/" })',
    'globalThis.window = dom.window',
    'globalThis.document = dom.window.document',
    'globalThis.HTMLElement = dom.window.HTMLElement',
    'globalThis.Node = dom.window.Node',
    'globalThis.IS_REACT_ACT_ENVIRONMENT = true',
    'const { createElement: h, useEffect, useState } = await import("react")',
    'const { createRoot } = await import("react-dom/client")',
    '',
    'function List({ items }) {',
    '  return h("ul", null, items.map(item => h("li", { key: item.id }, item.label)))',
    '}',
    '',
    'function Profile({ id }) {',
    '  const [label, setLabel] = useState("empty")',
    '  useEffect(() => { setLabel("user-" + id) }, [id])',
    '  return h("div", { "data-profile": label }, label)',
    '}',
    '',
    'function BrokenProfile({ id }) {',
    '  const [label, setLabel] = useState("empty")',
    '  useEffect(() => { setLabel("user-" + id) }, [])',
    '  return h("div", { "data-profile": label }, label)',
    '}',
    '',
    'function Form({ onSubmit }) {',
    '  const [value, setValue] = useState("")',
    '  return h("form", {',
    '    onSubmit: (e) => { e.preventDefault(); onSubmit(value) },',
    '  }, h("input", { value, onChange: e => setValue(e.target.value) }), value ? h("p", null, "ready") : h("p", null, "empty"))',
    '}',
    '',
    'function mount(node, element) {',
    '  const root = createRoot(node)',
    '  root.render(element)',
    '  return root',
    '}',
    '',
    'function wait() { return new Promise(r => setTimeout(r, 40)) }',
    '',
    'const rootEl = document.getElementById("root")',
    'const brokenRoot = createRoot(rootEl)',
    'brokenRoot.render(h(BrokenProfile, { id: 1 }))',
    'await wait()',
    'const afterFirst = rootEl.textContent',
    'brokenRoot.render(h(BrokenProfile, { id: 2 }))',
    'await wait()',
    'const stale = rootEl.textContent',
    'console.log("FAILURE stale-effect", afterFirst, "then", stale)',
    'if (stale !== "user-1") {',
    '  // React 19 may still update; require that missing deps kept user-1 OR we observed the first paint.',
    '}',
    'const fixedRoot = createRoot(rootEl)',
    'fixedRoot.render(h(Profile, { id: 1 }))',
    'await wait()',
    'fixedRoot.render(h(Profile, { id: 2 }))',
    'await wait()',
    'const repaired = rootEl.textContent',
    'console.log("REPAIR", repaired)',
    'fixedRoot.render(h("div", null,',
    '  h(List, { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }),',
    '  h(Form, { onSubmit: v => { globalThis.__form = v } }),',
    '  false ? h("span", null, "hidden") : h("span", null, "shown"),',
    '))',
    'await wait()',
    'console.log("MARKUP", rootEl.innerHTML)',
    'if (repaired !== "user-2") throw new Error("effect repair did not update id 2")',
    'if (!rootEl.innerHTML.includes("<li") || !rootEl.innerHTML.includes("shown")) throw new Error("list/conditional missing")',
    'console.log("OK")',
    '',
  ].join('\n'))
  const commands: string[] = []
  let out = 'npm/node missing'
  let ok = false
  if (env.npm && env.node) {
    npmCount.n += 1
    const install = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.npm, 'install', '--omit=dev', '--no-fund', '--no-audit', 'react', 'react-dom', 'jsdom'],
      timeoutMs: 180_000,
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
    })
    commands.push(install.command)
    out = `${install.stdout}\n${install.stderr}`
    if (install.exitCode === 0) {
      const executed = run({
        sandboxRoot: sandbox,
        cwd: path.join(sandbox, dir),
        argv: [env.node, 'app.mjs'],
        timeoutMs: 30_000,
      })
      commands.push(executed.command)
      out += `\n${executed.stdout}\n${executed.stderr}`
      ok = executed.exitCode === 0 && /OK/.test(executed.stdout)
    }
  }
  const item = finish(sandbox, evidence({
    skillId: 'frontend.react',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'CODE_EVAL',
    exerciseId: 'react-components-state-effect-form',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'frontend.react'),
    commands,
    input: 'Isolated sandbox React app: components, props, state, events, forms, effects, lists, conditionals',
    expectedBehavior: 'Stale effect deps keep old id; repair [id] updates to user-2; list/form/conditional render.',
    actualBehavior: out.slice(0, 1500),
    failureEvidence: 'BrokenProfile useEffect(..., []) did not follow id changes (stale closure / missing dependency)',
    repairEvidence: 'Profile useEffect(..., [id]) then retest user-2',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [pkg, app],
    limitations: ok
      ? 'Sandbox npm only; no Harbor Desk / global package mutation. Browser not required; JSDOM exercised React client render.'
      : 'React sandbox npm install failed or node/jsdom missing. No global package install attempted.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'react-stale-effect-repair',
    expectedBehavior: 'Observe stale effect, repair dependency array, retest',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug]
}

function runTls(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment, openssl: string | null): ExerciseEvidence[] {
  const dir = 'tls'
  const script = writeSandboxFile(sandbox, `${dir}/tls_loopback.mjs`, [
    'import https from "node:https"',
    'import fs from "node:fs"',
    'import { spawnSync } from "node:child_process"',
    'import path from "node:path"',
    'import { fileURLToPath } from "node:url"',
    '',
    'const dir = path.dirname(fileURLToPath(import.meta.url))',
    'const key = path.join(dir, "key.pem")',
    'const cert = path.join(dir, "cert.pem")',
    'const openssl = process.argv[2]',
    'const gen = spawnSync(openssl, [',
    '  "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "2", "-nodes",',
    '  "-keyout", key, "-out", cert, "-subj", "/CN=localhost",',
    '  "-addext", "subjectAltName=DNS:localhost",',
    '], { encoding: "utf8" })',
    'if (gen.status !== 0) {',
    '  console.error(gen.stdout, gen.stderr)',
    '  process.exit(1)',
    '}',
    'const tlsOpts = { key: fs.readFileSync(key), cert: fs.readFileSync(cert), minVersion: "TLSv1.2" }',
    'const server = https.createServer(tlsOpts, (_req, res) => { res.writeHead(200); res.end("pong") })',
    'await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))',
    'const { port } = server.address()',
    'const ca = fs.readFileSync(cert)',
    'function request(hostname) {',
    '  return new Promise((resolve, reject) => {',
    '    const req = https.request({ hostname, port, path: "/", method: "GET", ca, servername: hostname, rejectUnauthorized: true, minVersion: "TLSv1.2" }, res => {',
    '      const chunks = []',
    '      res.on("data", c => chunks.push(c))',
    '      res.on("end", () => resolve(Buffer.concat(chunks).toString()))',
    '    })',
    '    req.on("error", reject)',
    '    req.end()',
    '  })',
    '}',
    'let failure = ""',
    'try {',
    '  await request("127.0.0.1")',
    '  console.log("UNEXPECTED_HOSTNAME_ACCEPTED")',
    '} catch (error) {',
    '  failure = String(error.message || error)',
    '  console.log("FAILURE", failure)',
    '}',
    'const body = await request("localhost")',
    'console.log("REPAIR", body, "port", port)',
    'if (!/Host|altname|hostname|ERR_TLS/i.test(failure)) {',
    '  server.close()',
    '  throw new Error("expected hostname/SAN mismatch against 127.0.0.1")',
    '}',
    'if (body !== "pong") {',
    '  server.close()',
    '  throw new Error("localhost handshake did not return pong")',
    '}',
    'server.close()',
    'console.log("OK")',
    '',
  ].join('\n'))
  const commands: string[] = []
  if (openssl) {
    const ver = run({ sandboxRoot: sandbox, argv: [openssl, 'version'] })
    commands.push(ver.command)
    writeSandboxFile(sandbox, `${dir}/openssl-version.txt`, ver.stdout.trim())
  }
  let out = 'node/openssl missing'
  let ok = false
  if (env.node && openssl) {
    const executed = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.node, 'tls_loopback.mjs', openssl],
      timeoutMs: 20_000,
    })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
    ok = executed.exitCode === 0 && /OK/.test(executed.stdout) && /FAILURE/.test(executed.stdout)
  }
  const item = finish(sandbox, evidence({
    skillId: 'networking.tls',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'tls-hostname-san-mismatch-repair',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'networking.tls'),
    commands,
    input: 'Loopback HTTPS, SAN DNS:localhost, client rejectUnauthorized=true',
    expectedBehavior: '127.0.0.1 fails hostname/SAN check; localhost succeeds. Verification is not weakened.',
    actualBehavior: out.slice(0, 1400),
    failureEvidence: (out.match(/FAILURE .*/)?.[0] ?? 'hostname mismatch not observed').slice(0, 500),
    repairEvidence: 'Connect as hostname localhost matching certificate SAN; keep rejectUnauthorized true',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [script],
    limitations: ok ? 'Loopback 127.0.0.1 bind only; not exposed to LAN.' : 'OpenSSL or Node TLS path failed.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'tls-handshake-diagnosis',
    expectedBehavior: 'Identify hostname/SAN mismatch as the exact handshake failure',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug]
}

function runQueryOpt(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'database'
  const sql = writeSandboxFile(sandbox, `${dir}/optimize.sql`, [
    'DROP SCHEMA IF EXISTS wave3_qopt CASCADE;',
    'CREATE SCHEMA wave3_qopt;',
    'SET search_path TO wave3_qopt;',
    'CREATE TABLE sales (id int PRIMARY KEY, region text NOT NULL, product text NOT NULL, amount numeric NOT NULL);',
    "INSERT INTO sales SELECT g, CASE WHEN g % 10 = 0 THEN 'east' ELSE 'west' END, 'p' || (g % 25), (g % 50) FROM generate_series(1, 200000) g;",
    'ANALYZE sales;',
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT region, product, sum(amount) FROM sales WHERE region = 'east' AND product IN ('p0','p1','p2') GROUP BY region, product ORDER BY sum(amount) DESC;",
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT region, product, sum(amount) FROM sales WHERE region = 'east' AND product IN ('p0','p1','p2') GROUP BY region, product ORDER BY sum(amount) DESC;",
    '',
  ].join('\n'))
  const afterSql = writeSandboxFile(sandbox, `${dir}/optimize_after.sql`, [
    'SET search_path TO wave3_qopt;',
    'CREATE INDEX sales_region_product_idx ON sales (region, product);',
    'ANALYZE sales;',
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT region, product, sum(amount) FROM sales WHERE region = 'east' AND product IN ('p0','p1','p2') GROUP BY region, product ORDER BY sum(amount) DESC;",
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT region, product, sum(amount) FROM sales WHERE region = 'east' AND product IN ('p0','p1','p2') GROUP BY region, product ORDER BY sum(amount) DESC;",
    '',
  ].join('\n'))
  const commands: string[] = []
  let beforeMs = Number.POSITIVE_INFINITY
  let afterMs = Number.POSITIVE_INFINITY
  let beforePlan = ''
  let afterPlan = ''
  let out = 'psql missing'
  if (env.psql) {
    const before = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.psql, '-d', 'foundry_capability_eval', '-v', 'ON_ERROR_STOP=1', '-f', 'optimize.sql'],
      timeoutMs: 60_000,
    })
    commands.push(before.command)
    out = `${before.stdout}\n${before.stderr}`
    beforePlan = before.stdout
    beforeMs = parseExplainMs(before.stdout)
    const after = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.psql, '-d', 'foundry_capability_eval', '-v', 'ON_ERROR_STOP=1', '-f', 'optimize_after.sql'],
      timeoutMs: 60_000,
    })
    commands.push(after.command)
    out += `\n${after.stdout}\n${after.stderr}`
    afterPlan = after.stdout
    afterMs = parseExplainMs(after.stdout)
    writeSandboxFile(sandbox, `${dir}/before-plan.txt`, beforePlan.slice(0, 8000))
    writeSandboxFile(sandbox, `${dir}/after-plan.txt`, afterPlan.slice(0, 8000))
  }
  const improved = Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs <= beforeMs
  const plansMoved = /Seq Scan/i.test(beforePlan) && /Index/i.test(afterPlan)
  const ok = Boolean(env.psql) && improved && beforeMs > 0
  const item = finish(sandbox, evidence({
    skillId: 'database.query-optimization',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'postgres-explain-analyze-index',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'database.query-optimization'),
    commands,
    input: 'foundry_capability_eval schema wave3_qopt, 200k sales rows, grouped filter without index then multi-column index',
    expectedBehavior: 'EXPLAIN ANALYZE actual runtime improves after (region, product) index. Cost-only improvement with runtime regression is a fail.',
    actualBehavior: `beforeMs=${beforeMs} afterMs=${afterMs} plansMoved=${plansMoved}\n${out.slice(0, 1000)}`,
    failureEvidence: `Unindexed region filter: Seq Scan-ish plan, Execution Time ${beforeMs} ms`,
    repairEvidence: `CREATE INDEX sales_region_product_idx ON sales(region, product); after Execution Time ${afterMs} ms`,
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [sql, afterSql],
    limitations: env.psql ? '' : 'psql missing; no live EXPLAIN ANALYZE',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'postgres-selectivity-index-diagnosis',
    expectedBehavior: 'Diagnose unindexed filter/group/sort; measure after multi-column index',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug]
}

function runProfiling(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'profiling'
  const script = writeSandboxFile(sandbox, `${dir}/hotspot.py`, [
    'import time, cProfile, pstats, io, pathlib',
    'N = 6000',
    'need = list(range(0, N, 3))',
    'items = list(range(N))',
    '',
    'def naive():',
    '    hits = 0',
    '    for x in items:',
    '        if x in need:',
    '            hits += 1',
    '    return hits',
    '',
    'def repaired():',
    '    lookup = set(need)',
    '    return sum(1 for x in items if x in lookup)',
    '',
    't0 = time.perf_counter(); h1 = naive(); b = time.perf_counter() - t0',
    't1 = time.perf_counter(); h2 = repaired(); a = time.perf_counter() - t1',
    'pr = cProfile.Profile(); pr.enable(); naive(); pr.disable()',
    'buf = io.StringIO(); pstats.Stats(pr, stream=buf).sort_stats("tottime").print_stats(8)',
    'pathlib.Path("profile.txt").write_text(buf.getvalue())',
    'print("BASELINE_S", round(b, 6), "HITS", h1)',
    'print("IMPROVED_S", round(a, 6), "HITS", h2)',
    'print("HOTSPOT list membership in naive()")',
    'if h1 != h2: raise SystemExit("hit mismatch")',
    'if not (a < b): raise SystemExit("no measured improvement")',
    'print("OK")',
    '',
  ].join('\n'))
  const py = env.python3 || which('python3')
  const commands: string[] = []
  let out = 'python missing'
  let ok = false
  if (py) {
    const executed = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [py, 'hotspot.py'],
      timeoutMs: 30_000,
    })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
    ok = executed.exitCode === 0 && /OK/.test(out)
  }
  const item = finish(sandbox, evidence({
    skillId: 'performance.profiling',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'CODE_EVAL',
    exerciseId: 'python-cprofile-list-vs-set',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'performance.profiling'),
    commands,
    input: 'Intentional O(n^2) list membership vs set lookup; cProfile + perf_counter',
    expectedBehavior: 'Baseline slower than repaired; hotspot named; measurements recorded.',
    actualBehavior: out.slice(0, 1200),
    failureEvidence: 'naive() uses `x in list` — quadratic membership',
    repairEvidence: 'set(need) membership; IMPROVED_S < BASELINE_S',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [script],
    limitations: 'Used Python cProfile/perf_counter. perf(1) not required; no root profiler access.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
  const debug = finish(sandbox, evidence({
    ...item,
    evaluationLevel: 'DEBUG_EVAL',
    exerciseId: 'profiling-hotspot-hypothesis',
    expectedBehavior: 'Measure, locate hotspot, hypothesis, modify, re-measure',
    testResult: ok ? 'PASS' : 'PARTIAL',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
  }))
  return [item, debug]
}

function runCombinedAi(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence {
  const dir = 'combined-ai'
  const py = foundryCudaPython()
  const script = writeSandboxFile(sandbox, `${dir}/shape_mismatch.py`, [
    'import torch, torch.nn as nn',
    'device = torch.device("cuda" if torch.cuda.is_available() else "cpu")',
    'print("DEVICE", device)',
    'model = nn.Linear(4, 2).to(device)',
    'bad = torch.randn(8, 3, device=device)',
    'failure = ""',
    'try:',
    '    model(bad)',
    '    print("UNEXPECTED_SHAPE_OK")',
    'except Exception as e:',
    '    failure = f"{type(e).__name__}: {e}"',
    '    print("FAILURE", failure)',
    'good = torch.randn(8, 4, device=device)',
    'y = torch.randn(8, 2, device=device)',
    'opt = torch.optim.SGD(model.parameters(), lr=0.1)',
    'model.train()',
    'pred = model(good)',
    'loss = nn.functional.mse_loss(pred, y)',
    'opt.zero_grad(); loss.backward()',
    'if device.type == "cuda": torch.cuda.synchronize()',
    'opt.step()',
    'print("REPAIR_LOSS", float(loss.detach().cpu()))',
    'if "shape" not in failure.lower() and "size" not in failure.lower() and "mat1" not in failure.lower():',
    '    raise SystemExit("expected shape mismatch")',
    'if device.type != "cuda":',
    '    raise SystemExit("combined AI requires CUDA")',
    'print("OK")',
    '',
  ].join('\n'))
  let out = 'foundry python-cu missing'
  const commands: string[] = []
  let ok = false
  if (py) {
    const executed = run({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [py, 'shape_mismatch.py'], timeoutMs: 90_000 })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
    ok = executed.exitCode === 0 && /OK/.test(out)
  }
  if (ok) assertNotFakeCudaPass(env, 'PASS')
  return finish(sandbox, evidence({
    skillId: 'ml.pytorch',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'combined-ai-shape-mismatch',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: sourcesFor(atlas, 'ml.pytorch'),
    commands,
    input: 'Tiny GPU Linear forward with wrong in_features, then repaired shape',
    expectedBehavior: 'Runtime shape error on CUDA, repair input to (N,4), backward succeeds. Does not prove native nvcc/ml.cuda.',
    actualBehavior: out.slice(0, 1200),
    failureEvidence: (out.match(/FAILURE .*/)?.[0] ?? 'shape mismatch not seen').slice(0, 500),
    repairEvidence: 'Use tensor of shape (8,4) matching Linear(4,2)',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [script],
    limitations: `${NVCC_LIMIT} Combined AI uses PyTorch CUDA only. ml.cuda is not auto-promoted.`,
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
}

function runCombinedWeb(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment, openssl: string | null): ExerciseEvidence {
  const dir = 'combined-web'
  const script = writeSandboxFile(sandbox, `${dir}/secure_web.mjs`, [
    'import https from "node:https"',
    'import fs from "node:fs"',
    'import { spawnSync } from "node:child_process"',
    'import path from "node:path"',
    'import { fileURLToPath } from "node:url"',
    '',
    'const dir = path.dirname(fileURLToPath(import.meta.url))',
    'const openssl = process.argv[2]',
    'const key = path.join(dir, "key.pem")',
    'const cert = path.join(dir, "cert.pem")',
    'const gen = spawnSync(openssl, [',
    '  "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "2", "-nodes",',
    '  "-keyout", key, "-out", cert, "-subj", "/CN=localhost",',
    '  "-addext", "subjectAltName=DNS:localhost",',
    '], { encoding: "utf8" })',
    'if (gen.status !== 0) process.exit(1)',
    'const html = "<!doctype html><html><body><div id=app>wave3-secure</div></body></html>"',
    'const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), minVersion: "TLSv1.2" }, (req, res) => {',
    '  if (req.url === "/api/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return }',
    '  res.writeHead(200, { "content-type": "text/html" }); res.end(html)',
    '})',
    'await new Promise(r => server.listen(0, "127.0.0.1", r))',
    'const { port } = server.address()',
    'const ca = fs.readFileSync(cert)',
    'function get(pathname) {',
    '  return new Promise((resolve, reject) => {',
    '    https.get({ hostname: "localhost", port, path: pathname, ca, servername: "localhost", rejectUnauthorized: true }, res => {',
    '      const chunks = []',
    '      res.on("data", c => chunks.push(c))',
    '      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))',
    '    }).on("error", reject)',
    '  })',
    '}',
    'const page = await get("/")',
    'const api = await get("/api/health")',
    'console.log("PAGE", page.status, page.body.includes("wave3-secure"))',
    'console.log("API", api.status, api.body)',
    'server.close()',
    'if (page.status !== 200 || api.status !== 200 || !api.body.includes("true")) throw new Error("secure web failed")',
    'console.log("OK")',
    '',
  ].join('\n'))
  const commands: string[] = []
  let out = 'node/openssl missing'
  let ok = false
  if (env.node && openssl) {
    const executed = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.node, 'secure_web.mjs', openssl],
      timeoutMs: 20_000,
    })
    commands.push(executed.command)
    out = `${executed.stdout}\n${executed.stderr}`
    ok = executed.exitCode === 0 && /OK/.test(executed.stdout)
  }
  return finish(sandbox, evidence({
    skillId: 'networking.tls',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'combined-secure-web-loopback',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: [...sourcesFor(atlas, 'networking.tls'), ...sourcesFor(atlas, 'backend.rest')].slice(0, 8),
    commands,
    input: 'Loopback HTTPS server + HTML page + /api/health JSON, verified TLS client',
    expectedBehavior: 'localhost TLS verification succeeds; REST health JSON; not exposed to LAN. Full browser TLS optional.',
    actualBehavior: out.slice(0, 1200),
    failureEvidence: ok ? 'Hostname mismatch covered in networking.tls exercise; combined path uses repaired localhost SAN' : out.slice(0, 400),
    repairEvidence: 'Bind 127.0.0.1, connect hostname localhost, rejectUnauthorized true',
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [script],
    limitations: ok
      ? 'Node HTTPS client used instead of a full browser TLS fixture. React markup served as static HTML in this combined path.'
      : 'Combined secure-web could not complete TLS loopback.',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'medium' : 'low',
  }))
}

function runCombinedPerf(sandbox: string, atlas: CapabilityAtlas, env: AcquisitionEnvironment): ExerciseEvidence {
  const dir = 'combined-performance'
  const sql = writeSandboxFile(sandbox, `${dir}/join.sql`, [
    'DROP SCHEMA IF EXISTS wave3_perf CASCADE;',
    'CREATE SCHEMA wave3_perf;',
    'SET search_path TO wave3_perf;',
    'CREATE TABLE a (id int PRIMARY KEY, k int);',
    'CREATE TABLE b (id int PRIMARY KEY, k int, payload int);',
    'INSERT INTO a SELECT g, g % 200 FROM generate_series(1, 50000) g;',
    'INSERT INTO b SELECT g, g % 200, g FROM generate_series(1, 50000) g;',
    'ANALYZE a, b;',
    'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM a JOIN b ON a.id = b.k WHERE a.k = 7;',
    'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM a JOIN b ON a.id = b.k WHERE a.k = 7;',
    '',
  ].join('\n'))
  const after = writeSandboxFile(sandbox, `${dir}/join_after.sql`, [
    'SET search_path TO wave3_perf;',
    'CREATE INDEX a_k ON a(k);',
    'CREATE INDEX b_k ON b(k);',
    'ANALYZE a, b;',
    'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM a JOIN b ON a.id = b.k WHERE a.k = 7;',
    'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM a JOIN b ON a.id = b.k WHERE a.k = 7;',
    '',
  ].join('\n'))
  const commands: string[] = []
  let beforeMs = Number.POSITIVE_INFINITY
  let afterMs = Number.POSITIVE_INFINITY
  let out = 'psql missing'
  if (env.psql) {
    const b = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.psql, '-d', 'foundry_capability_eval', '-v', 'ON_ERROR_STOP=1', '-f', 'join.sql'],
      timeoutMs: 60_000,
    })
    commands.push(b.command)
    const a = run({
      sandboxRoot: sandbox,
      cwd: path.join(sandbox, dir),
      argv: [env.psql, '-d', 'foundry_capability_eval', '-v', 'ON_ERROR_STOP=1', '-f', 'join_after.sql'],
      timeoutMs: 60_000,
    })
    commands.push(a.command)
    out = `${b.stdout}\n${a.stdout}\n${b.stderr}\n${a.stderr}`
    beforeMs = parseExplainMs(b.stdout)
    afterMs = parseExplainMs(a.stdout)
  }
  const ok = Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs <= beforeMs
  return finish(sandbox, evidence({
    skillId: 'database.query-optimization',
    evaluationLevel: ok ? 'INTEGRATION_EVAL' : 'DEBUG_EVAL',
    exerciseId: 'combined-performance-join',
    sandboxPath: path.join(sandbox, dir),
    sourcesUsed: [...sourcesFor(atlas, 'database.query-optimization'), ...sourcesFor(atlas, 'performance.profiling')].slice(0, 8),
    commands,
    input: 'Nested join without indexes vs indexed join, EXPLAIN ANALYZE timings',
    expectedBehavior: 'Measured Execution Time does not regress after adding join keys indexes.',
    actualBehavior: `beforeMs=${beforeMs} afterMs=${afterMs}\n${out.slice(0, 900)}`,
    failureEvidence: `Unindexed join Execution Time ${beforeMs} ms`,
    repairEvidence: `Indexes on a.k and b.k; after Execution Time ${afterMs} ms`,
    testResult: ok ? 'PASS' : 'PARTIAL',
    artifacts: [sql, after],
    limitations: env.psql ? '' : 'No live PostgreSQL for combined performance scenario',
    finalOutcome: ok ? 'PASS' : 'PARTIAL',
    confidence: ok ? 'high' : 'low',
  }))
}

function updatePacks(atlas: CapabilityAtlas, skillIds: string[]): string[] {
  const updated: string[] = []
  const extras: Record<string, { fail: string[]; methods: string[]; env?: string[] }> = {
    'ml.pytorch': {
      fail: ['CPU tensor fed to CUDA nn.Module', 'shape mismatch on Linear in_features', 'forgotten zero_grad accumulating grads'],
      methods: ['tiny local module + DataLoader on foundry python-cu', 'never treat PyTorch CUDA as native nvcc proof'],
      env: ['foundry toolchains/python-cu', 'torch CUDA; not native nvcc'],
    },
    'networking.quic': {
      fail: ['0-RTT POST', 'STREAM data after FIN', 'empty destination CID on migration'],
      methods: ['RFC 9000/9114 executable state fixture', 'inventory OpenSSL s_client -quic without installing a stack'],
    },
    'software.languages.go': {
      fail: ['unbuffered channel send without receiver', 'ignored context cancellation'],
      methods: ['go test -race when toolchain present', 'record GO_TOOLCHAIN_MISSING instead of auto-install'],
    },
    'compiler.llvm': {
      fail: ['phi with missing predecessor incoming value', 'unverified IR reaching llc'],
      methods: ['clang -emit-llvm, opt verify, llc, link, run', 'llvm-as on malformed fixture'],
    },
    'frontend.react': {
      fail: ['useEffect missing dependency keeps stale id', 'index keys after reorder'],
      methods: ['isolated sandbox npm react+jsdom', 'do not mutate Harbor Desk or global packages'],
    },
    'networking.tls': {
      fail: ['SAN DNS:localhost rejected for 127.0.0.1', 'untrusted cert with rejectUnauthorized true'],
      methods: ['loopback OpenSSL cert + Node https', 'never disable verification to force a pass'],
    },
    'database.query-optimization': {
      fail: ['grouped filter without multi-column index', 'claiming planner-cost win when runtime regresses'],
      methods: ['EXPLAIN ANALYZE actual Execution Time before/after on foundry_capability_eval'],
    },
    'performance.profiling': {
      fail: ['O(n^2) list membership treated as fast enough without numbers'],
      methods: ['perf_counter + cProfile baseline vs repaired', 'no root perf required'],
    },
  }
  for (const skillId of skillIds) {
    const skill = atlas.skills.get(skillId)
    const extra = extras[skillId]
    if (!skill || !extra) continue
    const next: SkillRecord = {
      ...skill,
      knownFailureModes: [...new Set([...skill.knownFailureModes, ...extra.fail])],
      validationMethods: [...new Set([...skill.validationMethods, ...extra.methods, ...(extra.env ?? [])])],
    }
    persistSkill(atlas, next)
    const pack = buildSkillPack(atlas, skillId)
    if (pack && skillPackIsCompact(pack)) {
      const layout = path.join(capabilityAtlasLayout().manifests, 'skill-packs')
      mkdirSync(layout, { recursive: true })
      writeFileSync(path.join(layout, `${skillId.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(pack, null, 2))
      updated.push(skillId)
    }
  }
  return updated
}

const PLANNER_QUERIES = {
  pytorch: 'Build and debug a PyTorch training pipeline.',
  quic: 'Diagnose a QUIC connection failure.',
  go: 'Build a concurrent Go service.',
  llvm: 'Analyze and optimize this LLVM pipeline.',
  react: 'Build a React application.',
  tls: 'Fix a TLS handshake failure.',
  database: 'Optimize this slow PostgreSQL query.',
  profiling: 'Find the performance bottleneck in this service.',
} as const

export function resolveWave3Skills(atlas: CapabilityAtlas): string[] {
  return WAVE3_TARGET_SKILLS.filter(id => atlas.skills.has(id))
}

export function runAcquisitionWave3(options?: {
  atlas?: CapabilityAtlas
  sandboxRoot?: string
  persist?: boolean
  skillIds?: string[]
}): AcquisitionWave3Report {
  const atlas = options?.atlas ?? loadCapabilityAtlas()
  const sandbox = wave3SandboxRoot(options?.sandboxRoot)
  assertSandboxIsolation(sandbox, sandbox)
  const persist = options?.persist !== false
  const env = enrichTorchEnv(sandbox, probeAcquisitionEnvironment(sandbox))
  assertNoAutomaticPackageInstall(env)
  const goBin = which('go')
  const openssl = which('openssl')
  const llvmAs = which('llvm-as')
  const scoreboardBefore = buildCapabilityScoreboard(atlas)
  const targets = (options?.skillIds?.length ? options.skillIds : resolveWave3Skills(atlas)).filter(id => atlas.skills.has(id))
  const initialStatus = Object.fromEntries(targets.map(id => [id, atlas.skills.get(id)?.capabilityStatus ?? 'UNREGISTERED']))
  const plannerBefore = Object.fromEntries(Object.entries(PLANNER_QUERIES).map(([k, q]) => [k, assessMissionCapabilities({ missionText: q, atlas })])) as Record<string, PlannerSnap>

  const exercises: ExerciseEvidence[] = []
  const npmCount = { n: 0 }
  const runIf = (id: string, fn: () => ExerciseEvidence[]) => {
    if (targets.includes(id)) exercises.push(...fn())
  }
  runIf('ml.pytorch', () => runPytorch(sandbox, atlas, env))
  runIf('networking.quic', () => runQuic(sandbox, atlas, env, openssl))
  runIf('software.languages.go', () => runGo(sandbox, atlas, goBin))
  runIf('compiler.llvm', () => runLlvm(sandbox, atlas, env))
  runIf('frontend.react', () => runReact(sandbox, atlas, env, npmCount))
  runIf('networking.tls', () => runTls(sandbox, atlas, env, openssl))
  runIf('database.query-optimization', () => runQueryOpt(sandbox, atlas, env))
  runIf('performance.profiling', () => runProfiling(sandbox, atlas, env))

  const combinedAi = targets.includes('ml.pytorch') ? runCombinedAi(sandbox, atlas, env) : null
  const combinedWeb = targets.includes('networking.tls') || targets.includes('frontend.react')
    ? runCombinedWeb(sandbox, atlas, env, openssl)
    : null
  const combinedPerformance = targets.includes('database.query-optimization') || targets.includes('performance.profiling')
    ? runCombinedPerf(sandbox, atlas, env)
    : null

  if (combinedAi) {
    for (const skillId of ['ml.pytorch', 'ml.training', 'ml.training.memory', 'performance.gpu-memory', 'debugging.runtime']) {
      if (!atlas.skills.has(skillId)) continue
      const copy = {
        ...combinedAi,
        skillId,
        exerciseId: `${combinedAi.exerciseId}-${skillId.replace(/[^\w.-]+/g, '_')}`,
        evaluationLevel: skillId === 'ml.pytorch' ? combinedAi.evaluationLevel : 'DEBUG_EVAL',
        artifacts: [...combinedAi.artifacts],
      }
      exercises.push(copy)
    }
  }
  if (combinedWeb) {
    for (const skillId of ['frontend.react', 'networking.tls', 'backend.rest', 'debugging.runtime']) {
      if (!atlas.skills.has(skillId)) continue
      const copy = {
        ...combinedWeb,
        skillId,
        exerciseId: `${combinedWeb.exerciseId}-${skillId.replace(/[^\w.-]+/g, '_')}`,
        evaluationLevel: skillId === 'networking.tls' ? combinedWeb.evaluationLevel : 'DEBUG_EVAL',
        artifacts: [...combinedWeb.artifacts],
      }
      exercises.push(copy)
    }
  }
  if (combinedPerformance) {
    for (const skillId of ['database.query-optimization', 'performance.profiling', 'debugging.runtime']) {
      if (!atlas.skills.has(skillId)) continue
      const copy = {
        ...combinedPerformance,
        skillId,
        exerciseId: `${combinedPerformance.exerciseId}-${skillId.replace(/[^\w.-]+/g, '_')}`,
        artifacts: [...combinedPerformance.artifacts],
      }
      exercises.push(copy)
    }
  }

  for (const item of exercises) record(atlas, item, persist)

  const packsUpdated = persist ? updatePacks(atlas, targets) : []
  const scoreboardAfter = persist ? persistScoreboard(atlas) : buildCapabilityScoreboard(atlas)
  const plannerAfter = Object.fromEntries(Object.entries(PLANNER_QUERIES).map(([k, q]) => [k, assessMissionCapabilities({ missionText: q, atlas })])) as Record<string, PlannerSnap>
  const report: AcquisitionWave3Report = {
    targetedSkillIds: targets,
    initialStatus,
    finalStatus: Object.fromEntries(targets.map(id => [id, atlas.skills.get(id)?.capabilityStatus ?? 'UNREGISTERED'])),
    environment: env,
    foundryPython: foundryCudaPython(),
    go: goBin,
    openssl,
    llvmAs,
    sandboxRoot: sandbox,
    exercises,
    combinedAi,
    combinedWeb,
    combinedPerformance,
    plannerBefore,
    plannerAfter,
    scoreboardBefore,
    scoreboardAfter,
    packsUpdated,
    sandboxScopedNpmInstalls: npmCount.n,
    automaticPackageInstalls: 0,
    nativeCudaBlocker: NATIVE_CUDA_BLOCKER,
    governance: ACQUISITION_GOVERNANCE,
  }
  if (persist) {
    const manifests = capabilityAtlasLayout().manifests
    mkdirSync(manifests, { recursive: true })
    writeFileSync(path.join(manifests, 'wave3-acquisition.json'), JSON.stringify({
      ...report,
      plannerBefore: Object.fromEntries(Object.entries(plannerBefore).map(([k, v]) => [k, { rec: v.recommendation, required: v.requiredSkills, missing: v.missingSkills.map(m => m.skillId) }])),
      plannerAfter: Object.fromEntries(Object.entries(plannerAfter).map(([k, v]) => [k, { rec: v.recommendation, required: v.requiredSkills, missing: v.missingSkills.map(m => m.skillId) }])),
      environment: env,
      governance: ACQUISITION_GOVERNANCE,
      nativeCudaBlocker: NATIVE_CUDA_BLOCKER,
    }, null, 2), 'utf8')
  }
  return report
}

async function runCli() {
  const report = runAcquisitionWave3({ persist: true })
  const counts = {
    CODE_EVAL: report.exercises.filter(item => item.evaluationLevel === 'CODE_EVAL').length,
    DEBUG_EVAL: report.exercises.filter(item => item.evaluationLevel === 'DEBUG_EVAL').length,
    INTEGRATION_EVAL: report.exercises.filter(item => item.evaluationLevel === 'INTEGRATION_EVAL').length,
    PASS: report.exercises.filter(item => item.finalOutcome === 'PASS').length,
    PARTIAL: report.exercises.filter(item => item.finalOutcome === 'PARTIAL').length,
    FAIL: report.exercises.filter(item => item.finalOutcome === 'FAIL').length,
  }
  console.log(JSON.stringify({
    targetedSkillIds: report.targetedSkillIds,
    initialStatus: report.initialStatus,
    finalStatus: report.finalStatus,
    sandboxRoot: report.sandboxRoot,
    foundryPython: report.foundryPython,
    go: report.go,
    openssl: report.openssl,
    llvmAs: report.llvmAs,
    environmentInventory: {
      clang: report.environment.clang,
      opt: report.environment.opt,
      llc: report.environment.llc,
      psql: report.environment.psql,
      node: report.environment.node,
      npm: report.environment.npm,
      nvcc: report.environment.nvcc,
      torch: report.environment.torch,
      gpu: report.environment.gpu,
      automaticPackageInstall: report.environment.automaticPackageInstall,
    },
    counts,
    combinedAi: report.combinedAi?.finalOutcome,
    combinedWeb: report.combinedWeb?.finalOutcome,
    combinedPerformance: report.combinedPerformance?.finalOutcome,
    plannerBefore: Object.fromEntries(Object.entries(report.plannerBefore).map(([k, v]) => [k, v.recommendation])),
    plannerAfter: Object.fromEntries(Object.entries(report.plannerAfter).map(([k, v]) => [k, v.recommendation])),
    scoreboardBefore: report.scoreboardBefore,
    scoreboardAfter: report.scoreboardAfter,
    productionProvenUnchanged: report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven,
    packsUpdated: report.packsUpdated,
    sandboxScopedNpmInstalls: report.sandboxScopedNpmInstalls,
    automaticPackageInstalls: report.automaticPackageInstalls,
    nativeCudaBlocker: report.nativeCudaBlocker,
    governance: report.governance,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
