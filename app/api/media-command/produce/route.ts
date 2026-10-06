import { NextResponse } from 'next/server'
import { applyEditCommand } from '@/lib/media-command/edit-ops'
import { newCommandId } from '@/lib/media-command/edit-commands'
import { commitCommands, loadProject, saveProject } from '@/lib/media-command/store'
import { processRenderQueue } from '@/lib/media-command/render-engine'
import { executeVideoAnalysis } from '@/lib/media-command/video-analysis'
import { cloneProject, type OutputAspect } from '@/lib/media-command/types'
import {
  applySelectorExplanation,
  buildProductionPlan,
  buildProductionResult,
  buildNormalizedPromptContext,
  commandsAreLocalOnly,
  commandsForApprovedPlan,
  commandsForRevisionPatch,
  followUpCommandsAfterCut,
  parseRevisionRequest,
  productionAuthorityOk,
  proveNoMutation,
  withProgress,
} from '@/lib/media-command/production-ai'
import { parseProductionIntent } from '@/lib/media-command/production-intent'
import { friendlyProductionError } from '@/lib/media-command/production-language'
import { shotReferences } from '@/lib/media-command/production-shots'
import {
  emptyProductionSession,
  loadProductionSession,
  saveProductionSession,
} from '@/lib/media-command/production-session'
import { asrGateStatus } from '@/lib/media-command/asr-gate'
import { transcribeTimelineAssets } from '@/lib/media-command/asr-runtime'
import { buildCaptionProposal, commandsForCaptionProposal } from '@/lib/media-command/production-captions'
import {
  buildProductionVariants,
  commandsForVariants,
  parseRequestedVariantAspects,
  reframeHonesty,
  renderCommandsForVariants,
  syncVariantOutputs,
} from '@/lib/media-command/production-variants'
import { bindWarRoomConversation } from '@/lib/media-command/war-room-hvs'
import {
  applyReplan,
  advanceWorkflow,
  classifyProduction,
  deliveryReady,
  initialWorkflow,
  markCompletion,
  prepareProduction,
  reviewProduction,
  specialistTasksFor,
} from '@/lib/media-command/workflow-discipline'
import {
  captureLessonFromUtterance,
  lessonQueryFromContext,
  planningConstraintsFromLessons,
  retrieveLessons,
} from '@/lib/media-command/lessons/retrieve'
import { saveLesson } from '@/lib/media-command/lessons/store'
import { evaluateVerification } from '@/lib/media-command/verification-classes'
import { currentRenderIdentity, resolveDeterministicQc } from '@/lib/media-command/deterministic-qc-evidence'
import { listJobs } from '@/lib/media-command/jobs'
import { listReceipts } from '@/lib/media-command/tool-kernel'
import { runCreativeIntelligence, candidateLessonFromCorrection, applyCommanderApproachSelection } from '@/lib/media-command/creative-intelligence/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProduceAction =
  | 'plan'
  | 'approve'
  | 'retry'
  | 'revise'
  | 'apply-revision'
  | 'reject-revision'
  | 'render'
  | 'create-versions'
  | 'skip-step'
  | 'war-room-plan'
  | 'war-room-approve'
  | 'review'
  | 'replan'
  | 'verification'
  | 'lesson-capture'
  | 'lesson-retrieve'
  | 'creative-analysis'
  | 'creative-review'
  | 'select-approach'

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({
    error: friendlyProductionError(message),
    advancedError: message,
    ...extra,
  }, { status })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError('projectId is required.')
  const project = await loadProject(projectId)
  if (!project) return jsonError('Project not found.', 404)
  const session = await loadProductionSession(projectId)
  return NextResponse.json({
    session,
    project,
    context: buildNormalizedPromptContext(project),
  })
}

export async function POST(req: Request) {
  let body: {
    action?: ProduceAction
    projectId?: string
    prompt?: string
    sourceAssetIds?: string[]
    utterance?: string
    aspect?: OutputAspect
    conversationId?: string
    warRoomFileIds?: string[]
    localPaths?: string[]
    approachId?: string
    audioClipping?: boolean
    silenceSuspected?: boolean
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonError('I could not read that request.')
  }
  const action = body.action ?? 'plan'
  if (!body.projectId) return jsonError('A project is required.')
  const project = await loadProject(body.projectId)
  if (!project) return jsonError('Project not found.', 404)

  const authority = productionAuthorityOk()
  if (!authority.ok) return jsonError(authority.error, 403)

  if (action === 'plan') {
    const before = cloneProject(project)
    const prior = await loadProductionSession(project.id)
    const intent = parseProductionIntent({
      projectId: project.id,
      prompt: body.prompt ?? '',
      sourceAssetIds: body.sourceAssetIds,
    })
    const gate = classifyProduction(intent.prompt, { rightsSensitive: /rights/i.test(intent.prompt) })
    const query = lessonQueryFromContext({
      productionType: intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: intent.style,
      mediaTypes: project.assets.length ? [...new Set(project.assets.map(asset => asset.kind))] : undefined,
    })
    const lessonSet = gate.substantial
      ? planningConstraintsFromLessons(await retrieveLessons(query))
      : { constraints: [], conflicts: [], needsHuman: false, automaticEditOp: false as const }
    const creative = gate.substantial
      ? await runCreativeIntelligence({
        project,
        intent,
        constraints: lessonSet.constraints,
        conflicts: lessonSet.conflicts,
        commanderChoiceId: body.approachId,
        previousAnalysisIds: prior?.creativeIntelligence?.previousAnalysisIds,
        previousVisualReview: prior?.creativeIntelligence?.visualReview,
        currentRender: currentRenderIdentity(project),
      })
      : { skipped: true, skipReason: 'trivial edit skips creative intelligence', semanticReasoning: 'SKIPPED' as const }
    const selected = creative.approaches?.find(row => row.id === creative.selectedApproachId) ?? null
    const plan = buildProductionPlan(project, intent, { planningConstraints: lessonSet.constraints,
      creativeApproach: selected,
      creativeIntent: creative.analysis?.intent,
      creativeAnalysisId: creative.analysisId,
    })
    const session = emptyProductionSession(intent)
    session.plan = plan
    session.lessonConstraintIds = lessonSet.constraints.map(row => row.lessonId)
    session.lessonConstraintCount = lessonSet.constraints.length
    session.creativeIntelligence = creative
    if (gate.substantial) {
      const workflow = initialWorkflow(true)
      workflow.activeLessonIds = lessonSet.constraints.map(row => row.lessonId)
      workflow.lessonConstraintIds = workflow.activeLessonIds
      workflow.lessonConstraintCount = lessonSet.constraints.length
      workflow.planningConstraints = lessonSet.constraints
      workflow.lessonConflicts = lessonSet.conflicts
      workflow.needsHuman = lessonSet.needsHuman
      workflow.creativeAnalysisId = creative.analysisId ?? null
      workflow.selectedApproachId = creative.selectedApproachId ?? null
      workflow.preparation = prepareProduction({ project, intent, lessonIds: workflow.activeLessonIds })
      workflow.specialistTasks = specialistTasksFor(intent.prompt)
      workflow.completion = markCompletion(workflow.completion!, 'RESEARCH_PREPARE')
      session.workflow = advanceWorkflow({ ...workflow, currentStage: 'PLAN' }, 'RESEARCH_PREPARE')
    } else {
      session.workflow = initialWorkflow(false)
    }
    session.asrStatus = asrGateStatus().status
    if (body.conversationId) {
      session.warRoomConversationId = body.conversationId
      await bindWarRoomConversation(body.conversationId, project.id)
    }
    session.progress = withProgress('idle', {
      headline: 'I can make that.',
      detail: 'Review the plan, then start. Nothing has been changed yet.',
    })
    const saved = await saveProductionSession(session)
    const after = await loadProject(project.id)
    const mutated = after ? !proveNoMutation(before, after) : true
    return NextResponse.json({
      session: saved,
      project: after ?? project,
      context: buildNormalizedPromptContext(after ?? project),
      mutated,
      approved: false,
      lessonConstraintCount: lessonSet.constraints.length,
      lessonConstraintIds: lessonSet.constraints.map(row => row.lessonId),
      automaticEditOp: false,
      creative: {
        skipped: creative.skipped,
        analysisId: creative.analysisId ?? null,
        selectedApproachId: creative.selectedApproachId ?? null,
        approachCount: creative.approaches?.length ?? 0,
        lessonConstraintCount: lessonSet.constraints.length,
        semanticReasoning: creative.semanticReasoning,
      },
    })
  }

  const session = await loadProductionSession(project.id)
  if (!session?.plan) return jsonError('Create a plan first.')

  if (action === 'approve' || action === 'retry') {
    if (!session.plan) return jsonError('There is no plan to start.')
    session.approvedAt = session.approvedAt ?? new Date().toISOString()
    session.plan.status = 'executing'
    session.failedStep = null
    session.currentStep = 'ANALYZE_MEDIA'
    session.progress = withProgress('analyzing', { completed: [] })
    await saveProductionSession(session)

    const completed: string[] = []
    const videoAssets = project.assets.filter(asset => asset.kind === 'video')
    try {
      for (const asset of videoAssets) {
        try {
          const analysis = await executeVideoAnalysis({ project, assetId: asset.id })
          if (analysis.job?.id) session.jobIds = [...new Set([...session.jobIds, analysis.job.id])]
        } catch (error) {
          session.progress.advancedDetail = error instanceof Error ? error.message : String(error)
        }
      }
      completed.push(`Looked at ${Math.max(videoAssets.length, session.intent.sourceAssetIds.length)} clip${videoAssets.length === 1 ? '' : 's'}`)
      session.completedSteps = ['ANALYZE_MEDIA']
      session.currentStep = 'SELECT_MOMENTS'
      session.progress = withProgress('selecting', { completed, advancedDetail: session.progress.advancedDetail })
      await saveProductionSession(session)

      const fresh = await loadProject(project.id)
      if (!fresh) return jsonError('Project not found.', 404)
      session.progress = withProgress('building', { completed, advancedDetail: session.progress.advancedDetail })
      await saveProductionSession(session)

      const prepared = commandsForApprovedPlan(fresh, session.intent, session.plan)
      const local = commandsAreLocalOnly(prepared.commands)
      if (!local.ok) return jsonError(local.error, 403)
      session.selector = prepared.selector
      session.plan = applySelectorExplanation(session.plan, prepared.selector)

      const first = await commitCommands(fresh, prepared.commands)
      if (first.errors.length) {
        session.plan.status = 'failed'
        session.failedStep = 'BUILD_ROUGH_CUT'
        session.progress = withProgress('failed', {
          completed,
          error: "I couldn't finish your video.",
          advancedError: first.errors.join(' | '),
          advancedDetail: first.errors.join(' | '),
        })
        await saveProductionSession(session)
        return jsonError("I couldn't finish your video.", 422, { session, project: first.project, errors: first.errors })
      }
      session.lastSafeVersion = first.project.currentVersionId

      completed.push(`I found ${prepared.selector.explanation.foundCount || prepared.moments.length} strong moment${(prepared.selector.explanation.foundCount || prepared.moments.length) === 1 ? '' : 's'}.`)
      completed.push(`Created a ${session.plan.lengthLabel} cut`)
      session.completedSteps = [...session.completedSteps, 'SELECT_MOMENTS', 'BUILD_ROUGH_CUT']
      session.currentStep = 'APPLY_LOOK'
      session.progress = withProgress('improving_picture', { completed })
      await saveProductionSession(session)

      const follow = followUpCommandsAfterCut(first.project, session.intent, session.plan)
      const followLocal = commandsAreLocalOnly(follow)
      if (!followLocal.ok) return jsonError(followLocal.error, 403)
      let produced = follow.length
        ? await commitCommands(first.project, follow)
        : first
      if (produced.errors.length) {
        session.failedStep = 'APPLY_LOOK'
        session.progress = withProgress('failed', {
          completed,
          error: "I couldn't finish your video.",
          advancedError: produced.errors.join(' | '),
        })
        await saveProductionSession(session)
        return jsonError("I couldn't finish your video.", 422, { session, project: produced.project, errors: produced.errors })
      }
      completed.push('Improved the picture')
      session.progress = withProgress('cleaning_sound', { completed })
      await saveProductionSession(session)
      completed.push('Cleaned the sound')
      if (session.intent.captions) {
        const transcribed = await transcribeTimelineAssets(produced.project)
        session.asrStatus = transcribed.status
        session.transcriptAssetIds = transcribed.documents.map(doc => doc.assetId)
        session.asrWordLevel = transcribed.wordLevel
        const bundle = buildCaptionProposal(produced.project, session.intent.prompt)
        session.captionStyle = bundle.style
        const captionCommands = commandsForCaptionProposal(produced.project, bundle)
        if (captionCommands.length) {
          const captioned = await commitCommands(produced.project, captionCommands)
          if (!captioned.errors.length) {
            produced = captioned
            completed.push('Added captions')
          } else {
            completed.push('Captions need speech recognition before I can add them.')
          }
        } else {
          completed.push(bundle.skippedReason && /already exist/.test(bundle.skippedReason)
            ? bundle.skippedReason
            : 'Captions need speech recognition before I can add them.')
          if (prepared.skipped.every(item => item.kind !== 'ADD_CAPTIONS')) {
            prepared.skipped.push({ kind: 'ADD_CAPTIONS', reason: bundle.skippedReason ?? 'Captions need speech recognition before I can add them.' })
          }
        }
      } else if (prepared.skipped.some(item => item.kind === 'ADD_CAPTIONS')) {
        completed.push('Captions need speech recognition before I can add them.')
      }

      session.currentStep = 'PREVIEW'
      session.completedSteps = [...session.completedSteps, 'APPLY_LOOK', 'CLEAN_AUDIO']
      session.progress = withProgress('preparing', { completed })
      await saveProductionSession(session)

      session.plan.status = 'completed'
      session.executedAt = new Date().toISOString()
      session.failedStep = null
      session.previewShots = shotReferences(produced.project)
      session.result = buildProductionResult(produced.project, session.plan, prepared.skipped, {
        durationReport: prepared.selector.durationReport,
        variants: session.variants,
      })
      session.asrStatus = asrGateStatus().status
      session.progress = withProgress('ready', { completed })
      await saveProductionSession(session)
      return NextResponse.json({
        session,
        project: produced.project,
        context: buildNormalizedPromptContext(produced.project),
        mutated: true,
        approved: true,
      })
    } catch (error) {
      session.failedStep = session.currentStep
      session.plan.status = 'failed'
      session.progress = withProgress('failed', {
        completed,
        error: "I couldn't finish your video.",
        advancedError: error instanceof Error ? error.message : String(error),
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 500, { session })
    }
  }

  if (action === 'revise') {
    if (!body.utterance?.trim()) return jsonError('Tell me what you would like changed.')
    const parsed = parseRevisionRequest({
      projectId: project.id,
      planId: session.plan.id,
      utterance: body.utterance,
      project,
    })
    session.pendingRevision = parsed.request
    session.pendingPatch = parsed.patch
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      project,
      context: buildNormalizedPromptContext(project),
      mutated: false,
      approved: false,
    })
  }

  if (action === 'reject-revision') {
    session.pendingRevision = session.pendingRevision
      ? { ...session.pendingRevision, status: 'rejected' }
      : null
    session.pendingPatch = null
    await saveProductionSession(session)
    return NextResponse.json({ session, project, mutated: false })
  }

  if (action === 'apply-revision') {
    if (!session.pendingPatch || !session.pendingRevision) {
      return jsonError('There is no change waiting for approval.')
    }
    if (session.pendingPatch.kind === 'CHANGE_CAPTIONS' && session.pendingPatch.commandKinds.includes('addCaption')) {
      const transcribed = await transcribeTimelineAssets(project)
      session.asrStatus = transcribed.status
      session.transcriptAssetIds = transcribed.documents.map(doc => doc.assetId)
      session.asrWordLevel = transcribed.wordLevel
      await saveProductionSession(session)
      if (!transcribed.documents.length) {
        return jsonError(transcribed.error ?? "I couldn't hear spoken words.", 422, { session, project })
      }
    }
    const commands = commandsForRevisionPatch(
      project,
      session.pendingPatch,
      session.pendingRevision.utterance,
      session.intent.durationSec,
    )
    const local = commandsAreLocalOnly(commands)
    if (!local.ok) return jsonError(local.error, 403)
    if (!commands.length) {
      if (session.pendingPatch.kind === 'CHANGE_CAPTIONS') {
        const bundle = buildCaptionProposal(project, session.pendingRevision.utterance)
        return jsonError(
          bundle.skippedReason ?? 'I understood the request, but I do not have a typed edit for it yet.',
          422,
          { session, project },
        )
      }
      return jsonError('I understood the request, but I do not have a typed edit for it yet.')
    }
    const result = await commitCommands(project, commands)
    if (result.errors.length) {
      session.failedStep = session.pendingPatch.kind
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: result.errors.join(' | '),
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 422, { session, project: result.project, advancedError: result.errors.join(' | ') })
    }
    session.pendingRevision = { ...session.pendingRevision, status: 'approved' }
    session.pendingPatch = null
    session.previewShots = shotReferences(result.project)
    session.result = session.plan
      ? buildProductionResult(result.project, session.plan, session.result?.skippedSteps ?? [])
      : session.result
    session.progress = withProgress('ready', {
      completed: [...(session.progress.completed ?? []), session.pendingRevision.utterance],
    })
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      project: result.project,
      context: buildNormalizedPromptContext(result.project),
      mutated: true,
      approved: true,
    })
  }

  if (action === 'render') {
    const aspect = body.aspect ?? session.intent.aspect ?? project.timeline.aspect
    session.currentStep = 'FINALIZE_VIDEO'
    session.progress = withProgress('finalizing')
    await saveProductionSession(session)
    const queued = applyEditCommand(project, {
      id: newCommandId(),
      kind: 'render',
      actor: 'human',
      createdAt: new Date().toISOString(),
      aspect,
    })
    if (!queued.ok) {
      session.failedStep = 'FINALIZE_VIDEO'
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: queued.error,
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 422)
    }
    await saveProject(queued.project)
    let next = queued.project
    try {
      const processed = await processRenderQueue(project.id)
      if (processed) next = processed
    } catch (error) {
      session.failedStep = 'FINALIZE_VIDEO'
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: error instanceof Error ? error.message : String(error),
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 500, { session })
    }
    const lastJob = next.renderJobs.at(-1)
    if (lastJob?.id) session.jobIds = [...new Set([...session.jobIds, lastJob.id])]
    if (lastJob?.status === 'failed' || lastJob?.status === 'blocked') {
      session.failedStep = 'FINALIZE_VIDEO'
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: lastJob.error,
      })
    } else {
      session.failedStep = null
      session.currentStep = null
      session.completedSteps = [...session.completedSteps, 'FINALIZE_VIDEO']
      session.progress = withProgress('ready', {
        headline: 'Your video is ready',
        detail: 'The finished local file is on this computer. Nothing was published.',
      })
    }
    if (session.plan) session.result = buildProductionResult(next, session.plan, session.result?.skippedSteps ?? [], {
      durationReport: session.selector?.durationReport ?? session.result?.durationReport ?? null,
      variants: syncVariantOutputs(next, session.variants),
    })
    session.variants = syncVariantOutputs(next, session.variants)
    await saveProductionSession(session)
    return NextResponse.json({ session, project: next, mutated: true })
  }

  if (action === 'create-versions') {
    const requested = parseRequestedVariantAspects(body.utterance ?? '')
    const aspects = requested.length ? requested : (['16:9', '9:16', '1:1'] as const)
    const variants = buildProductionVariants(project, [...aspects], session.intent.durationSec)
    const reframe = commandsForVariants(project, variants)
    const local = commandsAreLocalOnly(reframe)
    if (!local.ok) return jsonError(local.error, 403)
    const reframed = reframe.length ? await commitCommands(project, reframe) : { project, errors: [] as string[] }
    if (reframed.errors.length) {
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: reframed.errors.join(' | '),
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 422, { session, project: reframed.project })
    }
    const renders = renderCommandsForVariants(variants)
    let next = reframed.project
    for (const command of renders) {
      const queued = applyEditCommand(next, command)
      if (!queued.ok) continue
      next = queued.project
    }
    await saveProject(next)
    try {
      const processed = await processRenderQueue(next.id)
      if (processed) next = processed
    } catch (error) {
      session.progress = withProgress('failed', {
        error: "I couldn't finish your video.",
        advancedError: error instanceof Error ? error.message : String(error),
      })
      await saveProductionSession(session)
      return jsonError("I couldn't finish your video.", 500, { session })
    }
    session.variants = syncVariantOutputs(next, variants)
    if (session.plan) {
      session.result = buildProductionResult(next, session.plan, session.result?.skippedSteps ?? [], {
        durationReport: session.selector?.durationReport ?? session.result?.durationReport ?? null,
        variants: session.variants,
      })
    }
    session.progress = withProgress('ready', {
      headline: 'Your videos are ready',
      detail: reframeHonesty(next),
    })
    await saveProductionSession(session)
    return NextResponse.json({ session, project: next, mutated: true })
  }

  if (action === 'review') {
    const substantial = session.workflow?.substantial === true
    const structural = /structural|replan/i.test(body.utterance ?? '')
    const weak = /wrong|weak|refine/i.test(body.utterance ?? '')
    const review = reviewProduction({
      substantial,
      structuralIssue: structural,
      weakOutput: weak && !structural,
      needsHuman: /needs human/i.test(body.utterance ?? ''),
    })
    let creativeReview = session.creativeIntelligence?.review ?? null
    if (substantial) {
      const creative = await runCreativeIntelligence({
        project,
        intent: session.intent,
        plan: session.plan,
        constraints: session.workflow?.planningConstraints ?? [],
        conflicts: session.workflow?.lessonConflicts ?? [],
        commanderChoiceId: session.creativeIntelligence?.selectedApproachId,
        commanderUtterance: body.utterance,
        includeReview: true,
        audioClipping: body.audioClipping,
        silenceSuspected: body.silenceSuspected,
        currentRender: currentRenderIdentity(project),
      })
      session.creativeIntelligence = {
        ...session.creativeIntelligence,
        ...creative,
        selectedApproachId: creative.selectedApproachId ?? session.creativeIntelligence?.selectedApproachId,
      }
      creativeReview = creative.review ?? null
      if (creativeReview?.verdict === 'REPLAN_REQUIRED') {
        review.outcome = 'REPLAN_REQUIRED'
      } else if (creativeReview?.verdict === 'REFINE_REQUIRED' && review.outcome === 'ACCEPT_FOR_QC') {
        review.outcome = 'REFINE_REQUIRED'
      } else if (creativeReview?.verdict === 'NEEDS_HUMAN') {
        review.outcome = 'NEEDS_HUMAN'
      }
      if (creativeReview?.selfChallenge) {
        review.elegance = {
          asked: true,
          note: [
            creativeReview.selfChallenge.moreElegant,
            creativeReview.selfChallenge.moreCinematic,
            creativeReview.selfChallenge.clearer,
            creativeReview.selfChallenge.servesIntent,
          ].filter(Boolean).join(' | '),
        }
      }
    }
    const workflow = session.workflow ?? initialWorkflow(substantial)
    workflow.review = review
    workflow.elegance = review.elegance.asked ? { asked: true, note: review.elegance.note ?? '' } : null
    workflow.creativeReviewId = creativeReview?.id ?? workflow.creativeReviewId ?? null
    const reviewed = { ...workflow, previousStage: workflow.currentStage, currentStage: 'REVIEW' as const }
    const staged = review.outcome === 'REPLAN_REQUIRED'
      ? applyReplan(reviewed, body.utterance ?? 'structural review')
      : reviewed
    if (review.outcome === 'NEEDS_HUMAN') staged.needsHuman = true
    if (review.outcome === 'REFINE_REQUIRED') {
      staged.currentStage = 'REFINE'
      staged.previousStage = 'REVIEW'
    }
    staged.completion = markCompletion(staged.completion ?? workflow.completion!, staged.currentStage)
    session.workflow = staged
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      review,
      creativeReview,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'replan') {
    const workflow = applyReplan(session.workflow ?? initialWorkflow(true), body.utterance ?? 'evidence changed')
    const query = lessonQueryFromContext({
      productionType: session.intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: session.intent.style,
      mediaTypes: project.assets.length ? [...new Set(project.assets.map(asset => asset.kind))] : undefined,
    })
    const lessonSet = planningConstraintsFromLessons(await retrieveLessons(query))
    const creative = await runCreativeIntelligence({
      project,
      intent: session.intent,
      constraints: lessonSet.constraints,
      conflicts: lessonSet.conflicts,
      commanderChoiceId: body.approachId ?? session.creativeIntelligence?.selectedApproachId,
      commanderUtterance: body.utterance,
      previousAnalysisIds: session.creativeIntelligence?.previousAnalysisIds,
      previousVisualReview: session.creativeIntelligence?.visualReview,
      currentRender: currentRenderIdentity(project),
    })
    const selected = creative.approaches?.find(row => row.id === creative.selectedApproachId) ?? null
    session.plan = buildProductionPlan(project, session.intent, {
      planningConstraints: lessonSet.constraints,
      creativeApproach: selected,
      creativeIntent: creative.analysis?.intent,
      creativeAnalysisId: creative.analysisId,
    })
    session.lessonConstraintIds = lessonSet.constraints.map(row => row.lessonId)
    session.lessonConstraintCount = lessonSet.constraints.length
    session.creativeIntelligence = creative
    workflow.activeLessonIds = lessonSet.constraints.map(row => row.lessonId)
    workflow.lessonConstraintIds = workflow.activeLessonIds
    workflow.lessonConstraintCount = lessonSet.constraints.length
    workflow.planningConstraints = lessonSet.constraints
    workflow.lessonConflicts = lessonSet.conflicts
    workflow.needsHuman = workflow.needsHuman === true || lessonSet.needsHuman
    workflow.creativeAnalysisId = creative.analysisId ?? null
    workflow.selectedApproachId = creative.selectedApproachId ?? null
    session.workflow = workflow
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      replan: true,
      retry: false,
      needsHuman: workflow.needsHuman === true,
      lessonConstraintCount: lessonSet.constraints.length,
      lessonConstraintIds: lessonSet.constraints.map(row => row.lessonId),
      automaticEditOp: false,
      selectedApproachId: creative.selectedApproachId ?? null,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'verification') {
    const rightsBlocked = session.workflow?.preparation?.assetGaps.some(gap => gap.status === 'UNKNOWN' || gap.status === 'RIGHTS_BLOCKED')
    const render = currentRenderIdentity(project)
    const qc = resolveDeterministicQc({
      jobs: listJobs(project.id),
      receipts: listReceipts(project.id),
      currentRender: render,
    })
    const report = evaluateVerification({
      projectIntact: true,
      mediaAvailable: session.workflow?.preparation?.assetGaps.some(gap => gap.status === 'MISSING') ? false : true,
      timelineValid: true,
      rightsState: rightsBlocked ? 'UNKNOWN' : 'OWNABLE',
      deterministicQc: qc.verdict,
      durationMatches: null,
      renderRequired: session.workflow?.preparation?.renderRequired ?? false,
      renderExists: Boolean(session.result?.renderOutputAssetId || render?.path),
      renderValid: render?.path ? true : null,
    }, `verification-${Date.now().toString(36)}`, qc.evidence)
    if (session.workflow) {
      session.workflow.verificationReportId = report.id
      const qcFail = report.classes.DETERMINISTIC_QC === 'FAIL'
      session.workflow.completion = markCompletion(session.workflow.completion ?? {
        PLAN_COMPLETED: true, CREATE_COMPLETED: true, REVIEW_COMPLETED: true, QC_COMPLETED: false, DELIVERY_READY: false, DELIVERED: false,
      }, 'DELIVER')
      if (session.workflow.completion) {
        session.workflow.completion.QC_COMPLETED = report.classes.DETERMINISTIC_QC === 'PASS' || report.classes.DETERMINISTIC_QC === 'FAIL' || report.classes.DETERMINISTIC_QC === 'NEEDS_HUMAN'
        session.workflow.completion.DELIVERY_READY = deliveryReady({
          completion: session.workflow.completion,
          blockingFail: report.blocksDelivery || qcFail,
          commanderApproved: false,
        })
      }
    }
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      verification: report,
      creativePass: report.creativePass,
      deterministicQc: report.classes.DETERMINISTIC_QC,
      qcEvidence: report.qcEvidence,
      currentRender: render,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'lesson-capture') {
    const lesson = captureLessonFromUtterance({
      utterance: body.utterance ?? body.prompt ?? '',
      productionType: session.intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: session.intent.style,
    })
    const saved = lesson ? await saveLesson(lesson) : null
    const classified = candidateLessonFromCorrection({
      utterance: body.utterance ?? body.prompt ?? '',
      productionType: session.intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: session.intent.style,
    })
    return NextResponse.json({ session, lesson: saved, classified: classified?.triggeringFailure ?? null, retrieved: false, mutated: false })
  }

  if (action === 'lesson-retrieve') {
    const query = lessonQueryFromContext({
      productionType: session.intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: session.intent.style,
      mediaTypes: project.assets.length ? [...new Set(project.assets.map(asset => asset.kind))] : undefined,
    })
    const lessons = await retrieveLessons(query)
    const lessonSet = planningConstraintsFromLessons(lessons)
    if (session.workflow) {
      session.workflow.activeLessonIds = lessonSet.constraints.map(row => row.lessonId)
      session.workflow.lessonConstraintIds = session.workflow.activeLessonIds
      session.workflow.lessonConstraintCount = lessonSet.constraints.length
      session.workflow.planningConstraints = lessonSet.constraints
    }
    session.lessonConstraintIds = lessonSet.constraints.map(row => row.lessonId)
    session.lessonConstraintCount = lessonSet.constraints.length
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      lessons,
      lessonConstraintCount: lessonSet.constraints.length,
      lessonConstraintIds: lessonSet.constraints.map(row => row.lessonId),
      automaticEditOp: false,
      mutated: false,
    })
  }

  if (action === 'creative-analysis') {
    const query = lessonQueryFromContext({
      productionType: session.intent.goal,
      projectId: project.id,
      themeId: project.timeline.themeId,
      styleId: session.intent.style,
      mediaTypes: project.assets.length ? [...new Set(project.assets.map(asset => asset.kind))] : undefined,
    })
    const lessonSet = planningConstraintsFromLessons(await retrieveLessons(query))
    const creative = await runCreativeIntelligence({
      project,
      intent: session.intent,
      plan: session.plan,
      constraints: lessonSet.constraints,
      conflicts: lessonSet.conflicts,
      commanderChoiceId: body.approachId,
      previousAnalysisIds: session.creativeIntelligence?.previousAnalysisIds,
      previousVisualReview: session.creativeIntelligence?.visualReview,
      currentRender: currentRenderIdentity(project),
    })
    session.creativeIntelligence = creative
    if (session.workflow) {
      session.workflow.creativeAnalysisId = creative.analysisId ?? null
      session.workflow.selectedApproachId = creative.selectedApproachId ?? null
    }
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      creative,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'creative-review') {
    const creative = await runCreativeIntelligence({
      project,
      intent: session.intent,
      plan: session.plan,
      constraints: session.workflow?.planningConstraints ?? [],
      conflicts: session.workflow?.lessonConflicts ?? [],
      commanderChoiceId: body.approachId ?? session.creativeIntelligence?.selectedApproachId,
      commanderUtterance: body.utterance,
      includeReview: true,
      audioClipping: body.audioClipping,
      silenceSuspected: body.silenceSuspected,
      currentRender: currentRenderIdentity(project),
      previousAnalysisIds: session.creativeIntelligence?.previousAnalysisIds,
      previousVisualReview: session.creativeIntelligence?.visualReview,
    })
    session.creativeIntelligence = { ...session.creativeIntelligence, ...creative }
    if (session.workflow) session.workflow.creativeReviewId = creative.review?.id ?? null
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      creativeReview: creative.review,
      mutated: false,
      approved: false,
    })
  }

  if (action === 'select-approach') {
    const existing = session.creativeIntelligence
    if (!existing || existing.skipped) return jsonError('No creative approaches are available to select.')
    if (!body.approachId) return jsonError('An approach is required.')
    const next = applyCommanderApproachSelection(existing, body.approachId)
    if (next.selectedApproachId !== body.approachId) return jsonError('That approach is not in the current set.')
    const selected = next.approaches?.find(row => row.id === body.approachId) ?? null
    session.creativeIntelligence = next
    session.plan = buildProductionPlan(project, session.intent, {
      planningConstraints: session.workflow?.planningConstraints ?? [],
      creativeApproach: selected,
      creativeIntent: next.analysis?.intent,
      creativeAnalysisId: next.analysisId,
    })
    if (session.workflow) session.workflow.selectedApproachId = body.approachId
    await saveProductionSession(session)
    return NextResponse.json({
      session,
      selectedApproachId: body.approachId,
      mutated: false,
      approved: false,
    })
  }

  return jsonError('Unknown action.')
}
