import { NextResponse } from 'next/server'
import { isFoundryWorkbenchW0Enabled } from '@/lib/native-builder/foundryWorkbenchW0'
import {
  acceptW2Proposal,
  attachEditorContext,
  composerContextSnapshot,
  consumeWorkbenchBus,
  detachEditorContext,
  rejectW2Proposal,
  runFoundryW2Command,
  w2ProposalHistory,
  type FoundryW2AssistKind,
} from '@/lib/native-builder/foundryWorkbenchW2'
import type { FoundryEditorContextEnvelope } from '@/lib/native-builder/foundryEditorContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KINDS = new Set<FoundryW2AssistKind>([
  'ask', 'explain', 'explainSymbol', 'edit', 'refactor', 'docs', 'fix', 'tests', 'refs', 'openComposer',
  'attachTerminal', 'explainDiagnostic', 'openProblems', 'openTerminal', 'terminalInject',
  'reviewChanges', 'governedCommit', 'governedPush', 'agentCommit', 'agentPush', 'agentStage',
  'scmBypass', 'scmStatus', 'scmDiff', 'scmStage', 'scmUnstage', 'openScm',
  'attachDebug', 'explainDebug', 'fixFromDebug', 'agentDebugControl',
  'attachTest', 'explainTest', 'fixFailedTest', 'openTesting', 'discoverTests', 'runTests',
])

export async function GET() {
  if (!isFoundryWorkbenchW0Enabled()) {
    return NextResponse.json({ enabled: false })
  }
  const snapshot = composerContextSnapshot()
  if (snapshot.pendingCommand?.kind) {
    consumeWorkbenchBus('pending-command.json')
    const result = await runFoundryW2Command({
      kind: snapshot.pendingCommand.kind,
      envelope: snapshot.pendingCommand.envelope,
      instruction: snapshot.pendingCommand.instruction,
      commanderApproved: Boolean(snapshot.pendingCommand.commanderApproved),
      files: snapshot.pendingCommand.files,
      remote: snapshot.pendingCommand.remote,
      dirtyBuffers: snapshot.pendingCommand.dirtyBuffers,
      stockCommand: snapshot.pendingCommand.stockCommand,
    })
    return NextResponse.json({
      enabled: true,
      ...composerContextSnapshot(),
      lastResponse: result,
      history: w2ProposalHistory().map(item => ({
        proposalId: item.proposalId,
        status: item.status,
        filePath: item.filePath,
        instruction: item.instruction,
        createdAt: item.createdAt,
        modelProvider: item.modelProvider,
      })),
    })
  }
  if (snapshot.acceptRequest?.proposalId) {
    consumeWorkbenchBus('accept-request.json')
    const result = await acceptW2Proposal(snapshot.acceptRequest.proposalId)
    return NextResponse.json({ enabled: true, ...composerContextSnapshot(), lastResponse: result })
  }
  if (snapshot.rejectRequest?.proposalId) {
    consumeWorkbenchBus('reject-request.json')
    const result = await rejectW2Proposal(snapshot.rejectRequest.proposalId)
    return NextResponse.json({ enabled: true, ...composerContextSnapshot(), lastResponse: result })
  }
  return NextResponse.json({
    enabled: true,
    ...snapshot,
    history: w2ProposalHistory().map(item => ({
      proposalId: item.proposalId,
      status: item.status,
      filePath: item.filePath,
      instruction: item.instruction,
      createdAt: item.createdAt,
      modelProvider: item.modelProvider,
    })),
  })
}

export async function POST(req: Request) {
  if (!isFoundryWorkbenchW0Enabled()) {
    return NextResponse.json({ error: 'FOUNDRY_WORKBENCH_W0 is off' }, { status: 403 })
  }
  let body: {
    action?: string
    kind?: string
    instruction?: string
    proposalId?: string
    envelope?: FoundryEditorContextEnvelope
    replacementText?: string
    providerClass?: 'none' | 'local' | 'remote'
    commanderApproved?: boolean
    files?: string[]
    remote?: string
    dirtyBuffers?: string[]
    stockCommand?: string
  } = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.action === 'attach' && body.envelope) {
    const envelope = attachEditorContext(body.envelope)
    return NextResponse.json({ ok: true, envelope, chips: composerContextSnapshot().chips })
  }
  if (body.action === 'detach') {
    detachEditorContext()
    return NextResponse.json({ ok: true, detached: true })
  }
  if (body.action === 'accept') {
    if (typeof body.replacementText === 'string' && body.replacementText.length) {
      return NextResponse.json({
        ok: false,
        code: 'RENDERER_CONTENT_UNTRUSTED',
        error: 'Accept uses server-stored replacement only. Do not send replacementText.',
      }, { status: 400 })
    }
    const result = await acceptW2Proposal(String(body.proposalId || ''))
    return NextResponse.json(result)
  }
  if (body.action === 'reject') {
    const result = await rejectW2Proposal(String(body.proposalId || ''))
    return NextResponse.json(result)
  }
  const kind = (body.kind || body.action || '') as FoundryW2AssistKind
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: 'Unknown editor action.' }, { status: 400 })
  }
  const result = await runFoundryW2Command({
    kind,
    envelope: body.envelope,
    instruction: body.instruction,
    providerClass: body.providerClass,
    commanderApproved: Boolean(body.commanderApproved),
    files: body.files,
    remote: body.remote,
    dirtyBuffers: body.dirtyBuffers,
    stockCommand: body.stockCommand,
  })
  return NextResponse.json(result)
}
