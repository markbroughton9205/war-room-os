/**
 * Self-review (pure: no filesystem, network or clock).
 *
 * A distinct engineering step between "tests pass" and "call it done": the implementer looks at its own evidence the way an
 * independent reader would, before anyone else does. It is not a summary of what was done and not another "does this look
 * right?" question to a model — every finding here is derived from the acceptance criteria, the files on disk, and the tests,
 * the same evidence foundryReviewEvidence/foundryEditScope already use. Nothing here calls a model.
 */
import { definedNames, claimedAbsent } from './foundryReviewEvidence'
import { importClosure, importedStems } from './foundryEditScope'
import { significantWords } from './foundryAcceptanceBasis'
import type { AcceptanceBasis } from './foundryAcceptanceBasis'
import { nextFindingId, type AcceptanceCoverageItem, type Phase6Finding, type Phase6Source, type Recommendation } from './foundryPhase6Types'

export type SelfReviewInput = {
  missionId: string
  generation: number
  basis: AcceptanceBasis
  /** Every project file as it is now. */
  sources: readonly Phase6Source[]
  /** The files this mission actually edited this generation. */
  touchedFiles: readonly string[]
  /** The files that implement what was asked (as scopeOfEdit/PRIMARY_IMPLEMENTATION already tracks it). */
  primaryFiles: readonly string[]
  testsGreenNow: boolean
  /** The implementer's own account of what it did, if any (e.g. the last worker summary). Optional: self-review works without it. */
  implementerClaim?: string
  /** Only supplied when the acceptance criteria require surviving a restart/reopen. */
  restartEvidence?: { required: boolean; survived: boolean } | null
  /** A fact about the environment the result may depend on (a local-only path, an env var), if the implementer noted one. */
  environmentDependencyNotes?: readonly string[]
}

export type SelfReviewResult = {
  missionId: string
  generation: number
  reviewedArtifactIds: string[]
  acceptanceCoverage: AcceptanceCoverageItem[]
  findings: Phase6Finding[]
  contradictions: string[]
  regressionRisks: string[]
  evidenceGaps: string[]
  scopeAssessment: { inScope: string[]; outOfScope: string[] }
  implementationAssessment: string
  recommendation: Recommendation
  evidenceRefs: string[]
}

function sourceText(sources: readonly Phase6Source[], file: string): string {
  return sources.find(item => item.file === file)?.text ?? ''
}

/** A criterion is evidenced when a primary file defines something its own words name, or a test exercises the same name. */
export function criterionEvidenced(criterion: string, sources: readonly Phase6Source[], primaryFiles: readonly string[]): { evidenced: boolean; refs: string[] } {
  const words = new Set(significantWords(criterion))
  const refs: string[] = []
  for (const file of primaryFiles) {
    const text = sourceText(sources, file)
    // Forwarding is behavior at a call site, not a function definition whose name repeats the criterion.
    const forwarded = /\bforward(?:s|ing)?\s+(?:the\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(criterion)?.[1]
    if (forwarded) {
      for (const line of text.split('\n')) {
        const call = /^\s*(?:return\s+|[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\(([^)]*)\)/.exec(line)
        if (call && new RegExp(`(?:^|,)\\s*${forwarded}\\s*=\\s*${forwarded}\\s*(?:,|$)`).test(call[2])) {
          refs.push(`${file} forwards ${forwarded} to ${call[1]}`)
        }
      }
    }
    const names = [...definedNames(text)]
    const hit = names.find(name => words.has(name.toLowerCase()) || significantWords(name).some(word => words.has(word)))
    if (hit) refs.push(`${file} defines ${hit}`)
  }
  for (const item of sources) {
    if (item.role !== 'test') continue
    const testWords = significantWords(item.text)
    const overlap = testWords.filter(word => words.has(word))
    if (overlap.length >= Math.min(2, words.size) && overlap.length > 0) refs.push(`${item.file} exercises ${overlap.slice(0, 3).join(', ')}`)
  }
  return { evidenced: refs.length > 0, refs }
}

/** A touched file is in scope when it is a primary file itself, or reachable from the primary files' own imports. */
function scopeOf(touched: readonly string[], primaryFiles: readonly string[], sources: readonly Phase6Source[]): { inScope: string[]; outOfScope: string[] } {
  const scopeSources = sources.map(item => ({ file: item.file, text: item.text }))
  const reachable = importClosure(primaryFiles, scopeSources)
  const inScope: string[] = []
  const outOfScope: string[] = []
  for (const file of touched) {
    if (primaryFiles.includes(file) || reachable.has(file)) inScope.push(file)
    else outOfScope.push(file)
  }
  return { inScope, outOfScope }
}

/** Files that import a touched file (so a change there could ripple into them) that no test in the project exercises. */
function untestedRegressionRisks(touched: readonly string[], sources: readonly Phase6Source[]): string[] {
  const stems = new Set(touched.map(file => (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '')))
  const testText = sources.filter(item => item.role === 'test').map(item => item.text).join('\n')
  const risks: string[] = []
  for (const item of sources) {
    if (item.role === 'test' || touched.includes(item.file)) continue
    const imports = new Set(importedStems(item.file, item.text))
    const dependsOnTouched = [...imports].some(stem => stems.has(stem))
    if (!dependsOnTouched) continue
    const fileStem = (item.file.split('/').pop() ?? item.file).replace(/\.[^.]+$/, '')
    if (!testText.includes(fileStem)) risks.push(item.file)
  }
  return risks
}

export function runSelfReview(input: SelfReviewInput): SelfReviewResult {
  const evidenceRefs: string[] = []
  const findings: Phase6Finding[] = []
  const acceptanceCoverage: AcceptanceCoverageItem[] = input.basis.criteria.map((criterion, index) => {
    const { evidenced, refs } = criterionEvidenced(criterion, input.sources, input.primaryFiles)
    evidenceRefs.push(...refs)
    if (!evidenced) {
      findings.push({
        findingId: nextFindingId('self-review-coverage'),
        criterionId: input.basis.explicit.find(item => item.sentence === criterion)?.id ?? `criterion-${index}`,
        severity: 'BLOCKING',
        claim: `No file in scope shows direct evidence for: ${criterion}`,
        evidenceRefs: [],
        affectedFiles: [...input.primaryFiles],
        confidenceClass: 'DIRECTLY_PROVEN',
        actionability: 'REPAIR',
      })
    }
    return { criterionId: input.basis.explicit.find(item => item.sentence === criterion)?.id ?? `criterion-${index}`, criterion, evidenced, evidenceRefs: refs }
  })

  const scopeAssessment = scopeOf(input.touchedFiles, input.primaryFiles, input.sources)
  for (const file of scopeAssessment.outOfScope) {
    findings.push({
      findingId: nextFindingId('self-review-scope'),
      severity: 'BLOCKING',
      claim: `${file} was changed but is not the primary implementation and is not reached from it: nothing traces this edit to what was asked.`,
      evidenceRefs: [],
      affectedFiles: [file],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }

  const contradictions: string[] = []
  if (input.implementerClaim) {
    const absent = claimedAbsent(input.implementerClaim)
    const present = absent.filter(name => input.sources.some(item => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(item.text)))
    if (present.length) contradictions.push(`The implementer said ${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} missing, but the disk shows otherwise.`)
  }

  if (input.restartEvidence?.required && !input.restartEvidence.survived) {
    contradictions.push('The acceptance criteria require the result to survive a restart, and it did not.')
    findings.push({
      findingId: nextFindingId('self-review-persistence'),
      severity: 'BLOCKING',
      claim: 'Result does not survive a restart, though persistence is required.',
      evidenceRefs: [],
      affectedFiles: [...input.primaryFiles],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }

  if (!input.testsGreenNow) {
    findings.push({
      findingId: nextFindingId('self-review-tests'),
      severity: 'BLOCKING',
      claim: 'Tests are not green at the current generation.',
      evidenceRefs: [],
      affectedFiles: [...input.primaryFiles],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }

  const evidenceGaps = acceptanceCoverage.filter(item => !item.evidenced).map(item => item.criterion)
  const regressionRisks = untestedRegressionRisks(input.touchedFiles, input.sources)
  const environmentGaps = (input.environmentDependencyNotes ?? []).map(note => `Depends on local environment state: ${note}`)

  const recommendation: Recommendation = findings.some(item => item.severity === 'BLOCKING') ? 'REPAIR_NEEDED' : 'COMPLETE'
  const implementationAssessment = recommendation === 'COMPLETE'
    ? `Every acceptance criterion is evidenced by a primary file or a test, every changed file traces to the request, and tests are green.`
    : `${findings.filter(item => item.severity === 'BLOCKING').length} finding(s) block completion: ${findings.filter(item => item.severity === 'BLOCKING').map(item => item.claim).slice(0, 3).join(' | ')}`

  return {
    missionId: input.missionId,
    generation: input.generation,
    reviewedArtifactIds: [...input.primaryFiles, ...input.touchedFiles],
    acceptanceCoverage,
    findings,
    contradictions,
    regressionRisks,
    evidenceGaps: [...evidenceGaps, ...environmentGaps],
    scopeAssessment,
    implementationAssessment,
    recommendation,
    evidenceRefs: [...new Set(evidenceRefs)],
  }
}
