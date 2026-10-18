/** A bounded, data-only Python counterexample proposed by the verifier. Never evaluates model-written code. */
import type { Phase6Source, Phase6Finding } from './foundryPhase6Types'
import type { AcceptanceBasis } from './foundryAcceptanceBasis'
export type VerificationProbe = { file: string; function: string; args: unknown[]; expected: unknown; criterion: string }
export function parseVerificationProbe(claim: string, basis: AcceptanceBasis, sources: readonly Phase6Source[]): VerificationProbe | null {
  const marker = claim.indexOf('PROBE_JSON ')
  if (marker < 0) return null
  try {
    const raw = claim.slice(marker + 11).trim()
    if (raw.length > 4000) return null
    const p = JSON.parse(raw) as VerificationProbe
    if (!p || typeof p !== 'object' || typeof p.file !== 'string' || !p.file.endsWith('.py') || p.file.startsWith('/') || p.file.split(/[\\/]/).some(x => x === '..' || x.startsWith('.'))) return null
    if (!sources.some(s => s.role === 'source' && s.file === p.file)) return null
    if (typeof p.function !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(p.function) || !Array.isArray(p.args) || p.args.length > 8 || !Object.hasOwn(p, 'expected')) return null
    if (!basis.criteria.includes(p.criterion)) return null
    return p
  } catch { return null }
}
export const VERIFICATION_PROBE_SCRIPT = `import contextlib, importlib.util, io, json, pathlib, sys
p = json.loads(sys.argv[1])
root = pathlib.Path.cwd().resolve()
file = (root / p['file']).resolve()
if not file.is_relative_to(root):
    raise ValueError('probe target escapes workspace')
try:
    with contextlib.redirect_stdout(io.StringIO()):
        spec = importlib.util.spec_from_file_location('foundry_verification_target', file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        actual = getattr(module, p['function'])(*p['args'])
    passed = actual == p['expected']
    print(json.dumps({'executed': True, 'passed': passed, 'actual': actual, 'expected': p['expected']}, default=repr))
    sys.exit(0 if passed else 1)
except Exception as e:
    print(json.dumps({'executed': True, 'passed': False, 'error': type(e).__name__ + ': ' + str(e)}))
    sys.exit(1)
`
export function verificationProbeFinding(probe: VerificationProbe, result: { code: number | null; stdout: string; stderr: string }): Phase6Finding | null {
  let evidence: { executed?: boolean; passed?: boolean } = {}
  try { evidence = JSON.parse(result.stdout.trim()) } catch { /* an incomplete probe proves nothing */ }
  if (result.code === 0 && evidence.executed && evidence.passed) return null
  const proven = result.code === 1 && evidence.executed === true && evidence.passed === false
  return {
    findingId: 'independent-counterexample', severity: 'BLOCKING',
    claim: proven ? `Counterexample to ${probe.criterion}: ${probe.file}:${probe.function}(${JSON.stringify(probe.args)}) expected ${JSON.stringify(probe.expected)}; observed ${result.stdout.trim().slice(0, 700)}` : `Verification counterexample could not be completed for ${probe.file}:${probe.function}.`,
    evidenceRefs: [result.stdout.trim().slice(0, 1000) || result.stderr.slice(0, 500)],
    reproduction: JSON.stringify(probe), affectedFiles: [probe.file],
    confidenceClass: proven ? 'DIRECTLY_PROVEN' : 'PLAUSIBLE_NEEDS_PROBE', actionability: proven ? 'REPAIR' : 'PROBE',
  }
}
