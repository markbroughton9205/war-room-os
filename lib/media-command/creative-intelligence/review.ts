/**
 * Semantic creative review from bounded evidence.
 * Distinguishes OBSERVED / INFERRED / HUMAN_REQUIRED.
 * Does not replace deterministic QC or factual CREATIVE_INTENT_MATCH.
 */
import type { HvsProductionIntent } from '../production-ai-types'
import type { HvsLesson, HvsLessonConflict, HvsPlanningConstraint } from '../lessons/types'
import { captureLessonFromUtterance } from '../lessons/retrieve'
import {
  HVS_CREATIVE_REVIEW_SCHEMA,
  type HvsCreativeApproach,
  type HvsCreativeFinding,
  type HvsCreativeIntentAnalysis,
  type HvsCreativeRefinement,
  type HvsCreativeRefinementKind,
  type HvsCreativeReview,
  type HvsCreativeReviewVerdict,
  type HvsCreativeSelfChallenge,
} from './types'
import type { HvsCreativeEvidence } from './evidence'
import { parseCreativeReview, type HvsCreativeProvider } from './provider'

const REFINEMENT_MAP: Record<HvsCreativeRefinementKind, { patch: string | null; commands: string[] }> = {
  SHORTEN_OPENING: { patch: 'CHANGE_OPENING', commands: ['rippleTrim'] },
  EXTEND_SHOT: { patch: 'EXTEND_SHOT', commands: ['rippleTrim'] },
  REORDER_BEAT: { patch: 'MOVE_SHOT', commands: ['moveClip'] },
  CHANGE_TITLE_HIERARCHY: { patch: 'CHANGE_CAPTIONS', commands: ['updateTitle'] },
  ADJUST_TITLE_SAFE_AREA: { patch: 'CHANGE_CAPTIONS', commands: ['updateTitle'] },
  REDUCE_MUSIC_LEVEL: { patch: 'CHANGE_AUDIO', commands: ['setVolume'] },
  INCREASE_VOICE_PRIORITY: { patch: 'CHANGE_AUDIO', commands: ['updateAudioGraph'] },
  CHANGE_COLOR_DIRECTION: { patch: 'CHANGE_LOOK', commands: ['updateColorPipeline'] },
  CHANGE_SHOT_TYPE: { patch: 'REPLACE_SHOT', commands: ['slipClip'] },
  ADD_ESTABLISHING_SHOT: { patch: 'CHANGE_OPENING', commands: ['insertClip'] },
  REMOVE_REDUNDANT_BEAT: { patch: 'REMOVE_SHOT', commands: ['rippleDelete'] },
}

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function finding(partial: Omit<HvsCreativeFinding, 'confidence'> & { confidence?: number }): HvsCreativeFinding {
  return { confidence: 0.7, ...partial }
}

function refinement(kind: HvsCreativeRefinementKind, summary: string): HvsCreativeRefinement {
  const map = REFINEMENT_MAP[kind]
  return {
    kind,
    summary,
    mapsToPatchKind: map.patch,
    mapsToCommandKinds: map.commands,
    automaticEditOp: false,
  }
}

function storyAppropriate(mode: string, prompt: string): boolean {
  if (/CLEANUP|utility|caption fix/i.test(mode)) return false
  if (/\bad\b|commercial|promo|tiktok|shorts|social/i.test(`${mode} ${prompt}`)) return false
  return /film|show|story|narrative|short film/i.test(`${mode} ${prompt}`)
}

function selfChallenge(intent: HvsCreativeIntentAnalysis, evidence: HvsCreativeEvidence): HvsCreativeSelfChallenge {
  return {
    asked: true,
    moreElegant: evidence.overlayCount > 2 ? 'Fewer type cards would be more elegant.' : 'Current type load is sparse enough to keep.',
    moreCinematic: evidence.openingHoldSec && evidence.openingHoldSec >= 8 ? 'A held opening can be cinematic if the rest of the cut still lands on time.' : 'Coverage may be too chopped to feel cinematic.',
    clearer: evidence.overlayTextChars > 80 ? 'Title density is competing with the picture.' : 'Hierarchy can stay as planned if type remains sparse.',
    moreEfficient: evidence.shots.length > 12 ? 'Fewer shots would be cheaper to finish.' : 'Shot count is production-efficient.',
    overcomplicated: evidence.shots.length > 16 ? 'The cut looks overbuilt for the request.' : 'Approach is not obviously overcomplicated.',
    tooGeneric: evidence.style ? 'Style is named; generic look risk is lower.' : 'Without a named style the look may read generic.',
    servesIntent: intent.objective,
  }
}

export function classifyCommanderCorrection(utterance: string): {
  class: HvsCreativeFinding['class']
  refinement: HvsCreativeRefinementKind | null
} | null {
  const text = utterance.trim()
  if (!text) return null
  if (/pacing|too slow|too fast|opening/i.test(text)) return { class: 'PACING', refinement: 'SHORTEN_OPENING' }
  if (/fram(e|ing)/i.test(text)) return { class: 'FRAMING', refinement: 'CHANGE_SHOT_TYPE' }
  if (/typograph|title|caption/i.test(text)) return { class: 'TYPOGRAPHY', refinement: 'CHANGE_TITLE_HIERARCHY' }
  if (/cinematic/i.test(text)) return { class: 'VISUAL_IDENTITY', refinement: 'CHANGE_COLOR_DIRECTION' }
  if (/audio|music|voice|mix/i.test(text)) return { class: 'AUDIO', refinement: 'REDUCE_MUSIC_LEVEL' }
  if (/color|grade|look/i.test(text)) return { class: 'COLOR', refinement: 'CHANGE_COLOR_DIRECTION' }
  return null
}

export function candidateLessonFromCorrection(input: {
  utterance: string
  productionType: string
  projectId?: string | null
  themeId?: string | null
  styleId?: string | null
}): HvsLesson | null {
  return captureLessonFromUtterance(input)
}

function reviewFromEvidence(input: {
  intent: HvsCreativeIntentAnalysis
  approach: HvsCreativeApproach | null
  evidence: HvsCreativeEvidence
  productionIntent: HvsProductionIntent
  commanderUtterance?: string | null
}): HvsCreativeReview {
  const findings: HvsCreativeFinding[] = []
  const refinements: HvsCreativeRefinement[] = []
  const ev = input.evidence
  const requested = ev.requestedDurationSec
  let structural = false

  if (requested != null && Math.abs(ev.timelineDurationSec - requested) > 2 && ev.timelineDurationSec > 0) {
    findings.push(finding({
      class: 'PACING',
      observation: `duration is ${Math.round(ev.timelineDurationSec)}s vs requested ${requested}s`,
      intentReference: input.intent.durationIntent ?? `${requested}s`,
      evidence: `timelineDurationSec=${ev.timelineDurationSec}`,
      severity: 'warn',
      suggestedCorrection: 'Trim the cut to the requested duration.',
      honesty: 'OBSERVED',
    }))
    refinements.push(refinement('REMOVE_REDUNDANT_BEAT', 'Shorten the program to the requested duration.'))
  }

  if (ev.openingHoldSec != null && requested != null && ev.openingHoldSec >= Math.max(8, requested * 0.3)) {
    findings.push(finding({
      class: 'PACING',
      observation: 'opening may feel slow',
      intentReference: input.intent.pacingGoal ?? 'opening pace',
      evidence: `openingHoldSec=${ev.openingHoldSec}`,
      severity: 'warn',
      suggestedCorrection: 'Shorten the opening hold.',
      honesty: 'INFERRED',
      confidence: 0.55,
    }))
    refinements.push(refinement('SHORTEN_OPENING', 'Shorten the opening hold so the requested duration still has a close.'))
  }

  if (ev.overlayTextChars >= 48 || (ev.overlayCount >= 1 && ev.overlayTextChars >= 32)) {
    findings.push(finding({
      class: 'TYPOGRAPHY',
      observation: 'title treatment is dense relative to a restrained luxury request',
      intentReference: input.intent.typographyGoal ?? 'restrained typography',
      evidence: `overlayTextChars=${ev.overlayTextChars} overlayCount=${ev.overlayCount}`,
      severity: 'warn',
      suggestedCorrection: 'Reduce title stack density and keep safe margins.',
      honesty: 'OBSERVED',
    }))
    refinements.push(refinement('CHANGE_TITLE_HIERARCHY', 'Collapse to a single lockup.'))
    if (!ev.titleSafeLocked) {
      refinements.push(refinement('ADJUST_TITLE_SAFE_AREA', 'Lock titles to title-safe.'))
    }
  }

  if (ev.audioClipping === true) {
    findings.push(finding({
      class: 'AUDIO',
      observation: 'music clipping is present in current audio evidence',
      intentReference: input.intent.audioGoal ?? 'clean audio',
      evidence: 'audioClipping=true',
      severity: 'blocking',
      suggestedCorrection: 'Reduce music level. Deterministic QC still owns the technical FAIL.',
      honesty: 'OBSERVED',
    }))
    refinements.push(refinement('REDUCE_MUSIC_LEVEL', 'Lower the music bus so it no longer clips.'))
  } else if (ev.musicTrackPresent && ev.voiceTrackPresent) {
    findings.push(finding({
      class: 'AUDIO',
      observation: 'music may dominate voice',
      intentReference: input.intent.audioGoal ?? 'voice readable',
      evidence: 'musicTrackPresent=true voiceTrackPresent=true clipping=unknown',
      severity: 'info',
      suggestedCorrection: 'Raise voice priority / duck music if mix evidence later confirms it.',
      honesty: 'INFERRED',
      confidence: 0.4,
    }))
  }

  if (ev.silenceSuspected === true) {
    findings.push(finding({
      class: 'AUDIO',
      observation: 'long dead air is suspected from silence evidence',
      intentReference: input.intent.audioGoal ?? 'continuous bed',
      evidence: 'silenceSuspected=true',
      severity: 'warn',
      suggestedCorrection: 'Trim silent holds or add a bed.',
      honesty: 'OBSERVED',
    }))
  }

  if (ev.cameraShotSizes.length || ev.cameraFraming.length) {
    findings.push(finding({
      class: 'FRAMING',
      observation: `camera metadata present: ${[...ev.cameraShotSizes, ...ev.cameraFraming].slice(0, 4).join(', ') || 'unspecified'}`,
      intentReference: input.intent.framingGoal ?? 'composed frames',
      evidence: `cameraSpecs=${ev.cameraShotSizes.join('|')}`,
      severity: 'info',
      suggestedCorrection: 'Keep requested shot size; do not invent visual inspection.',
      honesty: 'OBSERVED',
    }))
  } else {
    findings.push(finding({
      class: 'FRAMING',
      observation: 'subject framing quality cannot be confirmed without camera metadata or visual frames',
      intentReference: input.intent.framingGoal ?? 'framing',
      evidence: 'cameraSpecs=0 visualAnalysisRan=' + String(ev.visualAnalysisRan),
      severity: 'info',
      suggestedCorrection: 'Commander review of framing.',
      honesty: 'HUMAN_REQUIRED',
      confidence: 0.2,
    }))
  }

  if (ev.colorNodeTypes.length || ev.lookId) {
    findings.push(finding({
      class: 'COLOR',
      observation: `color pipeline nodes: ${ev.colorNodeTypes.join(', ') || 'none'}; look ${ev.lookId ?? 'unset'}`,
      intentReference: input.intent.colorGoal ?? 'requested look',
      evidence: `nodes=${ev.colorNodeTypes.join(',')} lookId=${ev.lookId}`,
      severity: 'info',
      suggestedCorrection: 'Keep the requested look; do not replace the color pipeline.',
      honesty: 'OBSERVED',
    }))
  }

  if (!ev.visualAnalysisRan) {
    findings.push(finding({
      class: 'COMPOSITION',
      observation: 'visual beauty / frame composition is not inspected',
      intentReference: input.intent.visualGoal ?? 'picture',
      evidence: ev.visualSkipReason ?? 'visual adapter did not run',
      severity: 'info',
      suggestedCorrection: 'Human picture review if composition must be judged.',
      honesty: 'HUMAN_REQUIRED',
      confidence: 0.1,
    }))
  }

  if (storyAppropriate(ev.productionMode, input.productionIntent.prompt)) {
    findings.push(finding({
      class: 'STORY_STRUCTURE',
      observation: 'narrative shape can be reviewed as opening / progression / close from shot roles',
      intentReference: input.intent.narrativeGoal ?? 'story',
      evidence: `shotRoles=${ev.shots.map(row => row.role).join(',')}`,
      severity: 'info',
      suggestedCorrection: 'Keep a readable progression; do not force film structure onto ads.',
      honesty: 'INFERRED',
      confidence: 0.45,
    }))
  }

  if (ev.aspect === '9:16' || input.productionIntent.platform === 'tiktok') {
    findings.push(finding({
      class: 'PLATFORM_FIT',
      observation: '9:16 / social context: title-safe and a quicker hook may matter',
      intentReference: input.intent.platformContext ?? 'social',
      evidence: `aspect=${ev.aspect} platform=${ev.platform}`,
      severity: 'info',
      suggestedCorrection: 'Keep titles inside vertical safe margins.',
      honesty: 'INFERRED',
      confidence: 0.5,
    }))
  }

  const approachNeeds = input.approach?.requiredAssetIds ?? []
  const blocked = approachNeeds.filter(id => ev.missingAssetIds.includes(id) || ev.unknownRightsAssetIds.includes(id))
  if (input.approach?.rightsRisk || blocked.length) {
    findings.push(finding({
      class: 'RIGHTS_DEPENDENCY',
      observation: 'selected concept depends on unavailable or UNKNOWN-rights media',
      intentReference: input.approach?.concept ?? 'selected approach',
      evidence: `blocked=${blocked.join(',') || ev.unknownRightsAssetIds.join(',')}`,
      severity: 'blocking',
      suggestedCorrection: 'Replan using currently ownable attached media.',
      honesty: 'OBSERVED',
    }))
    structural = true
  }

  const correction = input.commanderUtterance ? classifyCommanderCorrection(input.commanderUtterance) : null
  if (correction) {
    findings.push(finding({
      class: correction.class,
      observation: input.commanderUtterance ?? correction.class,
      intentReference: 'Commander correction',
      evidence: 'commander utterance',
      severity: 'warn',
      suggestedCorrection: correction.refinement ?? 'refine locally',
      honesty: 'HUMAN_REQUIRED',
      confidence: 0.8,
    }))
    if (correction.refinement) refinements.push(refinement(correction.refinement, input.commanderUtterance ?? correction.refinement))
  }

  let verdict: HvsCreativeReviewVerdict = 'ACCEPT_FOR_QC'
  if (structural) verdict = 'REPLAN_REQUIRED'
  else if (findings.some(row => row.honesty === 'HUMAN_REQUIRED' && row.severity === 'blocking')) verdict = 'NEEDS_HUMAN'
  else if (findings.some(row => row.severity === 'warn' || row.severity === 'blocking')) verdict = 'REFINE_REQUIRED'

  return {
    schema: HVS_CREATIVE_REVIEW_SCHEMA,
    id: nid('creview'),
    verdict,
    findings,
    strengths: input.intent.requiredElements,
    weaknesses: findings.filter(row => row.severity !== 'info').map(row => row.observation),
    proposedRefinements: refinements,
    requiresStructuralReplan: structural,
    confidence: structural ? 0.8 : 0.6,
    intentAlignment: requested != null && ev.timelineDurationSec > 0 && Math.abs(ev.timelineDurationSec - requested) > requested * 0.5
      ? 'WEAK'
      : 'ADEQUATE',
    selfChallenge: selfChallenge(input.intent, ev),
    visualAnalysisRan: ev.visualAnalysisRan,
    semanticReasoning: 'AVAILABLE',
    creativeScore: undefined,
    cinematicScore: undefined,
    qualityScore: undefined,
    tasteScore: undefined,
  }
}

export function enforceReviewHonesty(
  review: HvsCreativeReview,
  evidence: HvsCreativeEvidence,
): HvsCreativeReview {
  const supportedObserved = (finding: HvsCreativeFinding): boolean => {
    const blob = `${finding.evidence} ${finding.observation}`.toLowerCase()
    if (finding.class === 'PACING' && /timeline|duration|openinghold/.test(blob) && (evidence.timelineDurationSec > 0 || evidence.openingHoldSec != null)) return true
    if (finding.class === 'AUDIO' && evidence.audioClipping === true && /clip/.test(blob)) return true
    if (finding.class === 'AUDIO' && evidence.silenceSuspected === true && /silence/.test(blob)) return true
    if (finding.class === 'TYPOGRAPHY' && (evidence.overlayTextChars > 0 || evidence.overlayCount > 0) && /overlay|title|lockup|type/.test(blob)) return true
    if (finding.class === 'COLOR' && (evidence.colorNodeTypes.length > 0 || evidence.lookId) && /color|look|node/.test(blob)) return true
    if (finding.class === 'FRAMING' && evidence.cameraShotSizes.length + evidence.cameraFraming.length > 0 && /camera/.test(blob)) return true
    if (finding.class === 'RIGHTS_DEPENDENCY' && (evidence.unknownRightsAssetIds.length > 0 || evidence.missingAssetIds.length > 0)) return true
    if ((finding.class === 'FRAMING' || finding.class === 'COMPOSITION' || finding.class === 'VISUAL_IDENTITY') && evidence.visualAnalysisRan && finding.evidence.includes('frame')) return true
    return false
  }
  const findings = review.findings.map(finding => {
    if (finding.honesty !== 'OBSERVED') return finding
    if (supportedObserved(finding)) return finding
    if (!evidence.visualAnalysisRan && ['FRAMING', 'COMPOSITION', 'VISUAL_IDENTITY'].includes(finding.class) && !/camera/.test(finding.evidence.toLowerCase())) {
      return { ...finding, honesty: 'HUMAN_REQUIRED' as const }
    }
    return { ...finding, honesty: 'INFERRED' as const }
  })
  return { ...review, findings, visualAnalysisRan: evidence.visualAnalysisRan, creativeScore: undefined, cinematicScore: undefined, qualityScore: undefined, tasteScore: undefined }
}

export async function reviewCreativeDraft(input: {
  intent: HvsCreativeIntentAnalysis
  approach: HvsCreativeApproach | null
  evidence: HvsCreativeEvidence
  productionIntent: HvsProductionIntent
  constraints?: HvsPlanningConstraint[]
  conflicts?: HvsLessonConflict[]
  commanderUtterance?: string | null
  provider?: HvsCreativeProvider
}): Promise<HvsCreativeReview> {
  const local = reviewFromEvidence(input)
  if (!input.provider) return enforceReviewHonesty(local, input.evidence)
  const remote = await input.provider.reviewDraft({
    intent: input.intent,
    approach: input.approach,
    evidence: boundEvidenceForProviderSafe(input.evidence),
    lessonRules: input.constraints?.map(row => row.rule) ?? [],
    commanderUtterance: input.commanderUtterance,
  })
  if (!remote.ok) return { ...enforceReviewHonesty(local, input.evidence), semanticReasoning: remote.semanticReasoning }
  const parsed = parseCreativeReview(remote.value)
  if (!parsed) return { ...enforceReviewHonesty(local, input.evidence), semanticReasoning: 'MALFORMED' }
  return enforceReviewHonesty({
    ...parsed,
    proposedRefinements: parsed.proposedRefinements.map(row => ({ ...row, automaticEditOp: false as const })),
    creativeScore: undefined,
    cinematicScore: undefined,
    qualityScore: undefined,
    tasteScore: undefined,
    visualAnalysisRan: input.evidence.visualAnalysisRan,
  }, input.evidence)
}

function boundEvidenceForProviderSafe(evidence: HvsCreativeEvidence): Record<string, unknown> {
  return {
    requestedDurationSec: evidence.requestedDurationSec,
    timelineDurationSec: evidence.timelineDurationSec,
    openingHoldSec: evidence.openingHoldSec,
    overlayTextChars: evidence.overlayTextChars,
    overlayCount: evidence.overlayCount,
    audioClipping: evidence.audioClipping,
    silenceSuspected: evidence.silenceSuspected,
    visualAnalysisRan: evidence.visualAnalysisRan,
    visualFrameIds: evidence.visualFrames.map(row => `${row.role}:${row.index}`),
    shotCount: evidence.shots.length,
    missingAssetCount: evidence.missingAssetIds.length,
    unknownRightsCount: evidence.unknownRightsAssetIds.length,
  }
}

export function refinementsDoNotMutate(): { automaticEditOp: false; commandCount: 0 } {
  return { automaticEditOp: false, commandCount: 0 }
}
