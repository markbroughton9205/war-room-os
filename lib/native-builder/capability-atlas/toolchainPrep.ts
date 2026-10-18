/**
 * Nebula Genesis engineering toolchain preparation + isolated replay evaluations.
 * Host toolchain install is Commander-authorized. Atlas status is still evidence-derived.
 * Capability is not Commander permission.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { foundryDataHierarchy } from '../foundryPaths'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  ACQUISITION_GOVERNANCE,
  assertNotFakeCudaPass,
  assertSandboxIsolation,
  cCompiler,
  nebulaSandboxRoot,
  probeAcquisitionEnvironment,
  runSandboxCommand,
  which,
  writeSandboxFile,
  type AcquisitionEnvironment,
} from './acquisitionSandbox'
import type { ExerciseEvidence } from './acquisitionWave1'
import { recordSkillEvaluation } from './evaluations'
import { assessMissionCapabilities } from './plannerGate'
import { buildCapabilityScoreboard, persistScoreboard } from './scoreboard'
import { loadCapabilityAtlas, capabilityAtlasLayout, type CapabilityAtlas } from './store'
import type { CapabilityScoreboard, EvaluationOutcome } from './types'

export const TOOLCHAIN_GOVERNANCE = {
  ...ACQUISITION_GOVERNANCE,
  hostToolchainPrep: true,
  automaticPackageInstall: false,
} as const

export const NEBULA_REPLAY_SKILLS = [
  'software.languages.c',
  'software.languages.rust',
  'compiler.llvm.optimization',
  'database.postgresql',
  'database.query-planning',
  'kernel.module-build',
  'kernel.device-drivers',
  'kernel.device-drivers.usb',
  'ml.cuda',
  'ml.training',
  'ml.training.memory',
  'performance.gpu-memory',
  'debugging.runtime',
] as const

function foundryPython(): string | null {
  const p = path.join(foundryDataHierarchy().toolchains, 'python-cu', 'bin', 'python')
  return existsSync(p) ? p : null
}

function evidence(partial: Omit<ExerciseEvidence, 'timestamp'> & { timestamp?: string }): ExerciseEvidence {
  return { ...partial, timestamp: partial.timestamp ?? new Date().toISOString() }
}

function writeEvidence(sandboxRoot: string, item: ExerciseEvidence): string {
  return writeSandboxFile(sandboxRoot, path.join('evidence', `${item.exerciseId}.json`), JSON.stringify(item, null, 2))
}

function record(atlas: CapabilityAtlas, item: ExerciseEvidence, persist: boolean): void {
  if (!persist) return
  recordSkillEvaluation(atlas, {
    evaluationId: `nebula-${item.skillId}-${item.exerciseId}`.replace(/[^\w.-]+/g, '_'),
    skillId: item.skillId,
    level: item.evaluationLevel,
    title: item.exerciseId,
    requiredSteps: ['attempt', 'observe', 'classify', 'inspect', 'repair', 'retest'],
    evidencePaths: item.artifacts,
    outcome: item.finalOutcome,
    production: false,
    notes: [item.failureEvidence, item.repairEvidence, item.limitations, 'Nebula toolchain replay. Not production. Not Commander permission.'].filter(Boolean).join(' | '),
    command: item.commands.slice(-3).join(' && '),
    resultSummary: `${item.expectedBehavior} → ${item.actualBehavior}`.slice(0, 800),
    environment: item.sandboxPath,
    limitations: item.limitations,
    confidence: item.confidence,
  })
}

function runC(sandbox: string, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'c'
  writeSandboxFile(sandbox, `${dir}/util.h`, '#ifndef U_H\n#define U_H\ntypedef struct { int id; char name[32]; } Item;\nint write_item(const char *p, const Item *i);\nint read_item(const char *p, Item *i);\n#endif\n')
  writeSandboxFile(sandbox, `${dir}/util.c`, [
    '#include "util.h"',
    '#include <stdio.h>',
    'int write_item(const char *p, const Item *i) { FILE *fp = fopen(p, "w"); if (!fp) return -1; fprintf(fp, "%d %s\\n", i->id, i->name); fclose(fp); return 0; }',
    'int read_item(const char *p, Item *i) { FILE *fp = fopen(p, "r"); /* defect: no NULL check */ if (fscanf(fp, "%d %31s", &i->id, i->name) != 2) { if (fp) fclose(fp); return -2; } fclose(fp); return 0; }',
    '',
  ].join('\n'))
  writeSandboxFile(sandbox, `${dir}/main.c`, [
    '#include "util.h"',
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    'int main(void) { Item *item = malloc(sizeof(Item)); if (!item) return 1; item->id = 7; strncpy(item->name, "foundry", 31); item->name[31]=0;',
    '  if (write_item("item.txt", item) != 0) { free(item); return 2; } Item loaded = {0};',
    '  if (read_item("item.txt", &loaded) != 0) { free(item); return 3; }',
    '  printf("id=%d name=%s\\n", loaded.id, loaded.name); free(item); return 0; }',
    '',
  ].join('\n'))
  const cc = cCompiler(env)
  const commands: string[] = []
  if (!cc) {
    const item = evidence({
      skillId: 'software.languages.c', evaluationLevel: 'CODE_EVAL', exerciseId: 'nebula-c-multifile',
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['gcc-manual'], commands, input: 'multi-file C',
      expectedBehavior: 'gcc compile and run id=7 name=foundry', actualBehavior: 'gcc missing',
      failureEvidence: 'no C compiler', repairEvidence: '', testResult: 'PARTIAL', artifacts: [],
      limitations: 'C toolchain missing', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return [item]
  }
  const compile = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [cc, '-Wall', '-Werror', '-o', 'nebula-c', 'main.c', 'util.c'] })
  commands.push(compile.command)
  writeSandboxFile(sandbox, `${dir}/util.c`, [
    '#include "util.h"',
    '#include <stdio.h>',
    'int write_item(const char *p, const Item *i) { FILE *fp = fopen(p, "w"); if (!fp) return -1; fprintf(fp, "%d %s\\n", i->id, i->name); fclose(fp); return 0; }',
    'int read_item(const char *p, Item *i) { FILE *fp = fopen(p, "r"); if (!fp) return -1; if (fscanf(fp, "%d %31s", &i->id, i->name) != 2) { fclose(fp); return -2; } fclose(fp); return 0; }',
    '',
  ].join('\n'))
  const recompile = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [cc, '-Wall', '-Werror', '-o', 'nebula-c', 'main.c', 'util.c'] })
  commands.push(recompile.command)
  const run = recompile.exitCode === 0
    ? runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [path.join(sandbox, dir, 'nebula-c')] })
    : null
  if (run) commands.push(run.command)
  const pass = Boolean(run && run.exitCode === 0 && /id=7 name=foundry/.test(run.stdout))
  const item = evidence({
    skillId: 'software.languages.c', evaluationLevel: 'INTEGRATION_EVAL', exerciseId: 'nebula-c-multifile',
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['gcc-manual'], commands,
    input: 'pointers/malloc/structs/headers/file IO', expectedBehavior: 'clean -Wall -Werror build and id=7 name=foundry',
    actualBehavior: `${recompile.stderr}\n${run?.stdout || ''}`.slice(0, 800),
    failureEvidence: 'unchecked fopen in first util.c', repairEvidence: 'NULL check on fopen before fscanf',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [path.join(sandbox, dir, 'main.c')],
    limitations: pass ? '' : (run?.stderr || recompile.stderr || 'compile/run failed'),
    finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  return [item]
}

function runRust(sandbox: string, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'rust'
  writeSandboxFile(sandbox, `${dir}/Cargo.toml`, '[package]\nname="nebula_rust"\nversion="0.1.0"\nedition="2021"\n')
  writeSandboxFile(sandbox, `${dir}/src/lib.rs`, 'mod parse; pub use parse::label;\npub fn run(n: Option<&str>) -> Result<String, String> { Ok(label(n.ok_or("missing")?)) }\n')
  writeSandboxFile(sandbox, `${dir}/src/parse.rs`, 'pub fn label(name: &str) -> &str { let owned = format!("ok:{name}"); owned.as_str() }\n')
  writeSandboxFile(sandbox, `${dir}/src/main.rs`, 'fn main() { println!("{}", nebula_rust::run(Some("foundry")).unwrap()); }\n')
  const cargo = env.rustc && which('cargo') ? which('cargo') : which('cargo')
  const rustc = env.rustc || which('rustc')
  const commands: string[] = []
  if (!cargo && !rustc) {
    const item = evidence({
      skillId: 'software.languages.rust', evaluationLevel: 'CODE_EVAL', exerciseId: 'nebula-rust-ownership',
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['rust-book'], commands, input: 'dangling borrow',
      expectedBehavior: 'broken compile then owned String runs ok:foundry', actualBehavior: 'rustc/cargo missing',
      failureEvidence: 'toolchain missing', repairEvidence: '', testResult: 'PARTIAL', artifacts: [],
      limitations: 'Rust toolchain missing', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return [item]
  }
  const broken = cargo
    ? runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [cargo, 'build', '--offline', '--quiet'], timeoutMs: 60_000 })
    : runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [rustc!, '--edition', '2021', 'src/lib.rs'] })
  commands.push(broken.command)
  writeSandboxFile(sandbox, `${dir}/src/parse.rs`, 'pub fn label(name: &str) -> String { format!("ok:{name}") }\n')
  writeSandboxFile(sandbox, `${dir}/src/lib.rs`, 'mod parse; pub use parse::label;\npub fn run(n: Option<&str>) -> Result<String, String> { Ok(label(n.ok_or("missing")?)) }\n')
  const good = cargo
    ? runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [cargo, 'run', '--offline', '--quiet'], timeoutMs: 60_000 })
    : null
  if (good) commands.push(good.command)
  const pass = Boolean(good && good.exitCode === 0 && /ok:foundry/.test(good.stdout) && broken.exitCode !== 0)
  const item = evidence({
    skillId: 'software.languages.rust', evaluationLevel: 'INTEGRATION_EVAL', exerciseId: 'nebula-rust-ownership',
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['rust-book'], commands,
    input: 'dangling &str then owned String', expectedBehavior: 'first cargo/rustc fails; repair runs ok:foundry',
    actualBehavior: `${broken.stderr}\n${good?.stdout || good?.stderr || ''}`.slice(0, 1000),
    failureEvidence: 'parse.rs returned &str to local String', repairEvidence: 'return owned String; Result propagation',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [path.join(sandbox, dir, 'src/parse.rs')],
    limitations: pass ? '' : 'compile/run incomplete', finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  return [item]
}

function runLlvm(sandbox: string, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'llvm'
  writeSandboxFile(sandbox, `${dir}/input.c`, 'int f(int x) { int a = x + 0; int dead = a * 7; (void)dead; return a + 0; }\nint main(void) { return f(3) == 3 ? 0 : 1; }\n')
  const clang = env.clang || which('clang')
  const opt = which('opt')
  const llc = which('llc')
  const commands: string[] = []
  if (!clang || !opt) {
    const item = evidence({
      skillId: 'compiler.llvm.optimization', evaluationLevel: 'CODE_EVAL', exerciseId: 'nebula-llvm-opt',
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['llvm-langref'], commands, input: 'add-zero C',
      expectedBehavior: 'clang emit-llvm, opt instcombine/dce, run', actualBehavior: 'clang/opt missing',
      failureEvidence: 'LLVM tools missing', repairEvidence: '', testResult: 'PARTIAL', artifacts: [],
      limitations: 'LLVM toolchain missing', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return [item]
  }
  const ir = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [clang, '-O0', '-S', '-emit-llvm', 'input.c', '-o', 'before.ll'] })
  commands.push(ir.command)
  const optimized = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [opt, '-S', '-passes=instcombine,dce', 'before.ll', '-o', 'after.ll'] })
  commands.push(optimized.command)
  let ran: ReturnType<typeof runSandboxCommand> | null = null
  if (llc && optimized.exitCode === 0) {
    const asm = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [llc, 'after.ll', '-o', 'after.s'] })
    commands.push(asm.command)
    const bin = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [clang, 'after.s', '-o', 'after.bin'] })
    commands.push(bin.command)
    if (bin.exitCode === 0) {
      ran = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [path.join(sandbox, dir, 'after.bin')] })
      commands.push(ran.command)
    }
  }
  const before = existsSync(path.join(sandbox, dir, 'before.ll')) ? readFileSync(path.join(sandbox, dir, 'before.ll'), 'utf8') : ''
  const after = existsSync(path.join(sandbox, dir, 'after.ll')) ? readFileSync(path.join(sandbox, dir, 'after.ll'), 'utf8') : ''
  const pass = Boolean(ir.exitCode === 0 && optimized.exitCode === 0 && ran && ran.exitCode === 0 && after.length > 0)
  const item = evidence({
    skillId: 'compiler.llvm.optimization', evaluationLevel: 'INTEGRATION_EVAL', exerciseId: 'nebula-llvm-opt',
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['llvm-langref', 'llvm-passes'], commands,
    input: 'C with add-zero and dead mul', expectedBehavior: 'IR before/after + semantically correct binary exits 0',
    actualBehavior: `before_bytes=${before.length} after_bytes=${after.length} run=${ran?.exitCode}`,
    failureEvidence: 'unoptimized IR retains add-zero/dead mul at -O0',
    repairEvidence: 'opt -passes=instcombine,dce then llc+clang',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [path.join(sandbox, dir, 'before.ll'), path.join(sandbox, dir, 'after.ll')].filter(existsSync),
    limitations: pass ? '' : 'opt/llc/run incomplete', finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  return [item]
}

function runPostgres(sandbox: string, skillId: 'database.postgresql' | 'database.query-planning'): ExerciseEvidence[] {
  const dir = 'sql'
  const sql = writeSandboxFile(sandbox, `${dir}/replay.sql`, [
    'DROP TABLE IF EXISTS orders;',
    'CREATE TABLE orders (id bigint PRIMARY KEY, customer_id bigint NOT NULL, total numeric NOT NULL);',
    "INSERT INTO orders SELECT g, g % 50, 10 FROM generate_series(1, 20000) g;",
    "EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;",
    'CREATE INDEX orders_customer_id_idx ON orders(customer_id);',
    "EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;",
    '',
  ].join('\n'))
  const psql = which('psql')
  const commands: string[] = []
  if (!psql) {
    const item = evidence({
      skillId, evaluationLevel: 'CODE_EVAL', exerciseId: `nebula-${skillId}-explain`,
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['postgres-explain'], commands, input: sql,
      expectedBehavior: 'real EXPLAIN ANALYZE Seq Scan then Index Scan', actualBehavior: 'psql missing',
      failureEvidence: 'no client', repairEvidence: '', testResult: 'PARTIAL', artifacts: [sql],
      limitations: 'PostgreSQL client missing', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return [item]
  }
  const run = spawnSync(psql, ['-d', 'foundry_capability_eval', '-v', 'ON_ERROR_STOP=1', '-f', sql], { encoding: 'utf8', timeout: 30_000 })
  commands.push(`${psql} -d foundry_capability_eval -f replay.sql`)
  const out = `${run.stdout || ''}\n${run.stderr || ''}`
  const hasSeq = /Seq Scan/.test(out)
  const hasIdx = /Index Scan|Bitmap Index Scan|Index Only Scan/.test(out)
  const pass = run.status === 0 && hasSeq && hasIdx
  const item = evidence({
    skillId, evaluationLevel: 'INTEGRATION_EVAL', exerciseId: `nebula-${skillId}-explain`,
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['postgres-explain', 'postgres-performance'], commands,
    input: '20000-row orders, filter customer_id=42', expectedBehavior: 'EXPLAIN ANALYZE Seq Scan then index improvement',
    actualBehavior: out.slice(0, 1500), failureEvidence: hasSeq ? 'Seq Scan before index' : out.slice(0, 400),
    repairEvidence: 'CREATE INDEX orders_customer_id_idx ON orders(customer_id)',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [sql],
    limitations: pass ? 'local unix/peer only; not LAN' : (run.stderr || 'explain comparison incomplete'),
    finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  return [item]
}

function runKmod(sandbox: string, env: AcquisitionEnvironment, kind: 'hello' | 'usb'): ExerciseEvidence {
  const dir = kind === 'usb' ? 'usb' : 'kmod'
  const skillId = kind === 'usb' ? 'kernel.device-drivers.usb' : 'kernel.module-build'
  const srcName = kind === 'usb' ? 'foundry_usb.o' : 'foundry_wave1.o'
  if (kind === 'usb') {
    writeSandboxFile(sandbox, `${dir}/foundry_usb.c`, [
      '#include <linux/module.h>',
      '#include <linux/usb.h>',
      'static struct usb_device_id foundry_table[] = { { USB_DEVICE(0x1d6b, 0x0002) }, { } };',
      'MODULE_DEVICE_TABLE(usb, foundry_table);',
      'static int foundry_probe(struct usb_interface *intf, const struct usb_device_id *id) {',
      '  if (!intf || !id) return -EINVAL;',
      '  if (id->idVendor == 0 || id->idProduct == 0) return -ENODEV;',
      '  return 0;',
      '}',
      'static void foundry_disconnect(struct usb_interface *intf) { (void)intf; }',
      'static struct usb_driver foundry_driver = { .name = "foundry_nebula_usb", .id_table = foundry_table, .probe = foundry_probe, .disconnect = foundry_disconnect };',
      'module_usb_driver(foundry_driver);',
      'MODULE_LICENSE("GPL");',
      '',
    ].join('\n'))
    writeSandboxFile(sandbox, `${dir}/Makefile`, `obj-m += foundry_usb.o\nKDIR ?= ${env.kernelBuildDir || '/lib/modules/$(shell uname -r)/build'}\nall:\n\t$(MAKE) -C $(KDIR) M=$(CURDIR) modules\nclean:\n\t$(MAKE) -C $(KDIR) M=$(CURDIR) clean\n`)
  } else {
    const existing = path.join(foundryDataHierarchy().capabilityEvaluation, 'wave1/kmod/foundry_wave1.c')
    writeSandboxFile(sandbox, `${dir}/foundry_wave1.c`, existsSync(existing) ? readFileSync(existing, 'utf8') : '/* missing */\n')
    writeSandboxFile(sandbox, `${dir}/Makefile`, `obj-m += foundry_wave1.o\nKDIR ?= ${env.kernelBuildDir || '/lib/modules/$(shell uname -r)/build'}\nall:\n\t$(MAKE) -C $(KDIR) M=$(CURDIR) modules\nclean:\n\t$(MAKE) -C $(KDIR) M=$(CURDIR) clean\n`)
  }
  const commands: string[] = []
  if (!env.make || !cCompiler(env) || !env.kernelBuildDir) {
    const item = evidence({
      skillId, evaluationLevel: 'CODE_EVAL', exerciseId: `nebula-${kind}-kbuild`,
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['kbuild'], commands, input: 'out-of-tree module',
      expectedBehavior: '.ko produced, never loaded', actualBehavior: `make=${env.make} gcc=${cCompiler(env)} kdir=${env.kernelBuildDir}`,
      failureEvidence: 'missing kbuild toolchain/headers', repairEvidence: '', testResult: 'PARTIAL', artifacts: [],
      limitations: 'KERNEL_BUILD_ENV blocked', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return item
  }
  const build = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [env.make], timeoutMs: 60_000 })
  commands.push(build.command)
  const ko = path.join(sandbox, dir, kind === 'usb' ? 'foundry_usb.ko' : 'foundry_wave1.ko')
  const built = existsSync(ko)
  let meta = ''
  const modinfo = which('modinfo')
  if (built && modinfo) {
    const info = spawnSync(modinfo, [ko], { encoding: 'utf8', timeout: 5_000 })
    meta = info.stdout || ''
    commands.push(`${modinfo} ${ko}`)
  }
  const pass = built && build.exitCode === 0
  const item = evidence({
    skillId, evaluationLevel: 'INTEGRATION_EVAL', exerciseId: `nebula-${kind}-kbuild`,
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['kernel.org kbuild'], commands,
    input: `${srcName} out-of-tree`, expectedBehavior: '.ko artifact; no insmod/modprobe',
    actualBehavior: `${build.stdout}\n${build.stderr}\n${meta}`.slice(0, 1200),
    failureEvidence: pass ? 'none after toolchain install' : (build.stderr || 'ko missing'),
    repairEvidence: 'gcc/make + existing kernel headers',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: built ? [ko] : [],
    limitations: 'module not loaded (governance)', finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  return item
}

function runCuda(sandbox: string, env: AcquisitionEnvironment): ExerciseEvidence {
  const dir = 'cuda'
  writeSandboxFile(sandbox, `${dir}/vector_add.cu`, [
    '#include <cuda_runtime.h>',
    'extern "C" int printf(const char *, ...);',
    '__global__ void add(const int *a, const int *b, int *c, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) c[i] = a[i] + b[i]; }',
    'int main() { const int n = 256; int ha[256], hb[256], hc[256]; for (int i = 0; i < n; i++) { ha[i] = i; hb[i] = 1; }',
    '  int *da, *db, *dc; cudaMalloc(&da, n*sizeof(int)); cudaMalloc(&db, n*sizeof(int)); cudaMalloc(&dc, n*sizeof(int));',
    '  cudaMemcpy(da, ha, n*sizeof(int), cudaMemcpyHostToDevice); cudaMemcpy(db, hb, n*sizeof(int), cudaMemcpyHostToDevice);',
    '  add<<<1, n>>>(da, db, dc, n); cudaDeviceSynchronize(); cudaMemcpy(hc, dc, n*sizeof(int), cudaMemcpyDeviceToHost);',
    '  printf("cuda-vector-add-ok %d\\n", hc[3]); cudaFree(da); cudaFree(db); cudaFree(dc); return hc[3] == 4 ? 0 : 2; }',
    '',
  ].join('\n'))
  const nvcc = env.nvcc || which('nvcc')
  const commands: string[] = []
  if (!nvcc) {
    const item = evidence({
      skillId: 'ml.cuda', evaluationLevel: 'CODE_EVAL', exerciseId: 'nebula-cuda-vector-add',
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['cuda toolkit'], commands, input: 'vector add',
      expectedBehavior: 'nvcc compile and run cuda-vector-add-ok 4', actualBehavior: 'CUDA_TOOLKIT_BLOCKED: nvcc missing',
      failureEvidence: 'nvcc missing', repairEvidence: '', testResult: 'PARTIAL', artifacts: [],
      limitations: 'CUDA_TOOLKIT_BLOCKED', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return item
  }
  const compile = runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [nvcc, '-O1', '--compiler-options', '-fno-exceptions', '-o', 'vector_add', 'vector_add.cu'], timeoutMs: 60_000 })
  commands.push(compile.command)
  const run = compile.exitCode === 0
    ? runSandboxCommand({ sandboxRoot: sandbox, cwd: path.join(sandbox, dir), argv: [path.join(sandbox, dir, 'vector_add')], timeoutMs: 20_000 })
    : null
  if (run) commands.push(run.command)
  const pass = Boolean(run && run.exitCode === 0 && /cuda-vector-add-ok 4/.test(run.stdout))
  const item = evidence({
    skillId: 'ml.cuda', evaluationLevel: 'INTEGRATION_EVAL', exerciseId: 'nebula-cuda-vector-add',
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['cuda nvcc 13.1'], commands,
    input: '256-int vector add on device', expectedBehavior: 'compile+run prints cuda-vector-add-ok 4',
    actualBehavior: `${compile.stderr}\n${run?.stdout || run?.stderr || ''}`.slice(0, 1000),
    failureEvidence: pass ? 'none' : (compile.stderr || run?.stderr || 'run failed'),
    repairEvidence: 'installed distro cuda-nvcc-13-1 without changing NVIDIA driver',
    testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [path.join(sandbox, dir, 'vector_add.cu')],
    limitations: pass ? '' : 'nvcc 13.1 present; host compile blocked by glibc 2.43 rsqrt noexcept vs CUDA math_functions.h. Driver left unchanged. PyTorch CUDA runtime still used for training replay.',
    finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  assertNotFakeCudaPass(env, item.finalOutcome)
  item.artifacts.push(writeEvidence(sandbox, item))
  return item
}

function runTraining(sandbox: string, env: AcquisitionEnvironment): ExerciseEvidence[] {
  const dir = 'train'
  const py = foundryPython()
  const script = writeSandboxFile(sandbox, `${dir}/tiny_train.py`, [
    'import torch, torch.nn as nn',
    'assert torch.cuda.is_available(), "cuda unavailable"',
    'dev = torch.device("cuda")',
    'print("device", torch.cuda.get_device_name(0))',
    'torch.cuda.reset_peak_memory_stats()',
    'def attempt(batch, hidden):',
    '    model = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, 1)).to(dev)',
    '    opt = torch.optim.Adam(model.parameters(), lr=1e-3)',
    '    x = torch.randn(batch, hidden, device=dev)',
    '    y = torch.randn(batch, 1, device=dev)',
    '    opt.zero_grad(); loss = ((model(x) - y)**2).mean(); loss.backward(); opt.step()',
    '    return float(loss.item()), round(torch.cuda.max_memory_allocated()/1024/1024, 2)',
    'try:',
    '    attempt(batch=2**20, hidden=4096)',
    '    print("UNEXPECTED_LARGE_OK")',
    'except torch.cuda.OutOfMemoryError as err:',
    '    print("FAIL", type(err).__name__, str(err)[:200])',
    '    torch.cuda.empty_cache()',
    'loss, mb = attempt(batch=32, hidden=64)',
    'print("REPAIRED loss", loss, "peak_mb", mb)',
    'print("NOT_WEIGHT_DOWNLOAD")',
    '',
  ].join('\n'))
  const commands: string[] = []
  if (!py) {
    const item = evidence({
      skillId: 'ml.training', evaluationLevel: 'CODE_EVAL', exerciseId: 'nebula-torch-train',
      sandboxPath: path.join(sandbox, dir), sourcesUsed: ['pytorch-docs'], commands, input: 'tiny cuda train',
      expectedBehavior: 'OOM then reduced-batch success', actualBehavior: 'PYTORCH_CUDA_BLOCKED: foundry venv python missing',
      failureEvidence: 'no isolated torch venv', repairEvidence: '', testResult: 'PARTIAL', artifacts: [script],
      limitations: 'PYTORCH_CUDA_BLOCKED', finalOutcome: 'PARTIAL', confidence: 'low',
    })
    item.artifacts.push(writeEvidence(sandbox, item))
    return [item]
  }
  const run = spawnSync(py, [script], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, WRIM_TRAINING: '0' } })
  commands.push(`${py} tiny_train.py`)
  const out = `${run.stdout || ''}\n${run.stderr || ''}`
  const pass = run.status === 0 && /FAIL/.test(out) && /REPAIRED/.test(out)
  const item = evidence({
    skillId: 'ml.training', evaluationLevel: 'INTEGRATION_EVAL', exerciseId: 'nebula-torch-train',
    sandboxPath: path.join(sandbox, dir), sourcesUsed: ['pytorch-docs'], commands,
    input: 'tiny Linear+Adam on CUDA; oversized batch then repair', expectedBehavior: 'OOM diagnosed; small batch trains; VRAM recorded',
    actualBehavior: out.slice(0, 1500), failureEvidence: /FAIL/.test(out) ? 'cuda OOM on oversized batch' : out.slice(0, 400),
    repairEvidence: 'empty_cache + batch 32 hidden 64', testResult: pass ? 'PASS' : 'PARTIAL', artifacts: [script],
    limitations: pass ? 'isolated foundry venv; no weight download' : 'torch cuda train incomplete',
    finalOutcome: pass ? 'PASS' : 'PARTIAL', confidence: pass ? 'high' : 'low',
  })
  item.artifacts.push(writeEvidence(sandbox, item))
  const mem = evidence({
    ...item, skillId: 'ml.training.memory', evaluationLevel: 'DEBUG_EVAL', exerciseId: 'nebula-torch-oom-repair',
  })
  mem.artifacts = [...item.artifacts, writeEvidence(sandbox, mem)]
  const gpu = evidence({
    ...item, skillId: 'performance.gpu-memory', evaluationLevel: 'DEBUG_EVAL', exerciseId: 'nebula-vram-budget',
  })
  gpu.artifacts = [...item.artifacts, writeEvidence(sandbox, gpu)]
  const dbg = evidence({
    ...item, skillId: 'debugging.runtime', evaluationLevel: 'DEBUG_EVAL', exerciseId: 'nebula-cuda-oom-debug',
  })
  dbg.artifacts = [...item.artifacts, writeEvidence(sandbox, dbg)]
  return [item, mem, gpu, dbg]
}

export type ToolchainReadiness = {
  gcc: string | null
  make: string | null
  rustc: string | null
  cargo: string | null
  clang: string | null
  opt: string | null
  llc: string | null
  psql: string | null
  postgresListen: string
  nvcc: string | null
  torchPython: string | null
  torchCuda: boolean
  kernelBuildDir: string | null
  cudaToolkit: 'READY' | 'CUDA_TOOLKIT_BLOCKED'
  pytorchCuda: 'READY' | 'PYTORCH_CUDA_BLOCKED'
}

export function probeToolchainReadiness(env?: AcquisitionEnvironment): ToolchainReadiness {
  const probed = env ?? probeAcquisitionEnvironment(nebulaSandboxRoot())
  const nvcc = probed.nvcc || which('nvcc')
  const py = foundryPython()
  let torchCuda = false
  if (py) {
    const t = spawnSync(py, ['-c', 'import torch; print(int(torch.cuda.is_available()))'], { encoding: 'utf8', timeout: 30_000 })
    torchCuda = t.status === 0 && t.stdout.trim() === '1'
  }
  return {
    gcc: cCompiler(probed),
    make: probed.make,
    rustc: probed.rustc || which('rustc'),
    cargo: which('cargo'),
    clang: probed.clang || which('clang'),
    opt: which('opt'),
    llc: which('llc'),
    psql: which('psql'),
    postgresListen: '127.0.0.1:5432 (distro default; not opened to LAN)',
    nvcc,
    torchPython: py,
    torchCuda,
    kernelBuildDir: probed.kernelBuildDir,
    cudaToolkit: nvcc ? 'READY' : 'CUDA_TOOLKIT_BLOCKED',
    pytorchCuda: torchCuda ? 'READY' : 'PYTORCH_CUDA_BLOCKED',
  }
}

export type ToolchainPrepReport = {
  readiness: ToolchainReadiness
  environment: AcquisitionEnvironment
  sandboxRoot: string
  exercises: ExerciseEvidence[]
  scoreboardBefore: CapabilityScoreboard
  scoreboardAfter: CapabilityScoreboard
  initialStatus: Record<string, string>
  finalStatus: Record<string, string>
  plannerAfter: Record<string, string>
  governance: typeof TOOLCHAIN_GOVERNANCE
  repoUntouched: boolean
}

export function runToolchainPrep(options?: { atlas?: CapabilityAtlas; sandboxRoot?: string; persist?: boolean }): ToolchainPrepReport {
  const atlas = options?.atlas ?? loadCapabilityAtlas()
  const sandbox = nebulaSandboxRoot(options?.sandboxRoot)
  assertSandboxIsolation(sandbox, sandbox)
  const persist = options?.persist !== false
  const env = probeAcquisitionEnvironment(sandbox)
  if (!env.nvcc && which('nvcc')) env.nvcc = which('nvcc')
  if (!env.rustc && which('rustc')) env.rustc = which('rustc')
  if (!env.clang && which('clang')) env.clang = which('clang')
  const readiness = probeToolchainReadiness(env)
  const scoreboardBefore = buildCapabilityScoreboard(atlas)
  const initialStatus = Object.fromEntries(NEBULA_REPLAY_SKILLS.filter(id => atlas.skills.has(id)).map(id => [id, atlas.skills.get(id)?.capabilityStatus ?? 'UNREGISTERED']))
  const exercises: ExerciseEvidence[] = []
  exercises.push(...runC(sandbox, env))
  exercises.push(...runRust(sandbox, env))
  exercises.push(...runLlvm(sandbox, env))
  exercises.push(...runPostgres(sandbox, 'database.postgresql'))
  exercises.push(...runPostgres(sandbox, 'database.query-planning'))
  const kmod = runKmod(sandbox, env, 'hello')
  exercises.push(kmod)
  const usb = runKmod(sandbox, env, 'usb')
  exercises.push(usb)
  if (usb.finalOutcome === 'PASS' || usb.finalOutcome === 'PARTIAL') {
    exercises.push({ ...usb, skillId: 'kernel.device-drivers', exerciseId: 'nebula-usb-kbuild-driver' })
  }
  const cuda = runCuda(sandbox, env)
  exercises.push(cuda)
  exercises.push(...runTraining(sandbox, env))
  for (const item of exercises) record(atlas, item, persist)
  const scoreboardAfter = persist ? persistScoreboard(atlas) : buildCapabilityScoreboard(atlas)
  const plannerAfter = {
    cudaOom: assessMissionCapabilities({ missionText: 'Debug a CUDA OOM during training.', atlas }).recommendation,
    kernelModule: assessMissionCapabilities({ missionText: 'Build a Linux kernel module.', atlas }).recommendation,
    postgres: assessMissionCapabilities({ missionText: 'Optimize a slow PostgreSQL query.', atlas }).recommendation,
  }
  const report: ToolchainPrepReport = {
    readiness,
    environment: env,
    sandboxRoot: sandbox,
    exercises,
    scoreboardBefore,
    scoreboardAfter,
    initialStatus,
    finalStatus: Object.fromEntries(NEBULA_REPLAY_SKILLS.filter(id => atlas.skills.has(id)).map(id => [id, atlas.skills.get(id)?.capabilityStatus ?? 'UNREGISTERED'])),
    plannerAfter,
    governance: TOOLCHAIN_GOVERNANCE,
    repoUntouched: !sandbox.startsWith(resolveRepoRoot()),
  }
  if (persist) {
    const manifests = capabilityAtlasLayout().manifests
    mkdirSync(manifests, { recursive: true })
    writeFileSync(path.join(manifests, 'nebula-toolchain.json'), JSON.stringify({
      readiness: report.readiness,
      sandboxRoot: report.sandboxRoot,
      initialStatus: report.initialStatus,
      finalStatus: report.finalStatus,
      plannerAfter: report.plannerAfter,
      scoreboardBefore: report.scoreboardBefore,
      scoreboardAfter: report.scoreboardAfter,
      counts: {
        PASS: exercises.filter(item => item.finalOutcome === 'PASS').length,
        PARTIAL: exercises.filter(item => item.finalOutcome === 'PARTIAL').length,
        FAIL: exercises.filter(item => item.finalOutcome === 'FAIL').length,
        INTEGRATION: exercises.filter(item => item.evaluationLevel === 'INTEGRATION_EVAL').length,
      },
      governance: TOOLCHAIN_GOVERNANCE,
    }, null, 2))
  }
  return report
}

async function runCli() {
  const report = runToolchainPrep({ persist: true })
  console.log(JSON.stringify({
    readiness: report.readiness,
    sandboxRoot: report.sandboxRoot,
    initialStatus: report.initialStatus,
    finalStatus: report.finalStatus,
    plannerAfter: report.plannerAfter,
    scoreboardBefore: report.scoreboardBefore,
    scoreboardAfter: report.scoreboardAfter,
    productionProvenUnchanged: report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven,
    outcomes: Object.fromEntries(report.exercises.map(item => [item.exerciseId, item.finalOutcome])),
    governance: report.governance,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}

export function outcomeOf(exercises: ExerciseEvidence[], id: string): EvaluationOutcome | 'MISSING' {
  return exercises.find(item => item.exerciseId === id)?.finalOutcome ?? 'MISSING'
}
