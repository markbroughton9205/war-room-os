import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateWorkspaceAttachment } from './attachments'
import { validateProposalInput } from './input'
import { validateWorkspaceProposalTransition } from './lifecycle'
import { checkWorkspaceRateLimit } from './rateLimit'
import { validateWorkspaceSettings } from './settings'
import { createSupabaseWorkspaceStore, failure, isWorkspaceProposalStatus, type WorkspaceStore } from './store'
import type { WorkspaceCommanderTransitionInput } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ContributorContext =
  | { ok: true; userId: string; store: WorkspaceStore }
  | { ok: false; response: NextResponse }

async function requireContributorContext(actionLabel: string, storeFactory = createSupabaseWorkspaceStore): Promise<ContributorContext> {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return { ok: false, response: environmentBlocked }

  let userId: string | null = null
  let sessionClient: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null
  try {
    sessionClient = await createSupabaseServerClient()
    const { data, error } = await sessionClient.auth.getUser()
    if (!error && data.user?.id) userId = data.user.id
  } catch {
    userId = null
  }
  if (!userId) return { ok: false, response: NextResponse.json({ error: `${actionLabel} requires authentication.` }, { status: 401 }) }
  if (!sessionClient) return { ok: false, response: NextResponse.json({ error: `${actionLabel} requires authentication.` }, { status: 401 }) }

  const { data: member, error: memberError } = await sessionClient.from('workspace_members').select('workspace_owner_id').eq('workspace_owner_id', userId).maybeSingle()
  if (memberError) return { ok: false, response: NextResponse.json({ error: 'workspace_member_lookup_failed' }, { status: 500 }) }
  if (!member) return { ok: false, response: NextResponse.json({ error: 'workspace_membership_required' }, { status: 403 }) }

  const store = storeFactory()
  return { ok: true, userId, store }
}

async function requireCommanderContext(actionLabel: string, storeFactory = createSupabaseWorkspaceStore): Promise<ContributorContext> {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return { ok: false, response: environmentBlocked }

  const commander = await requireCommanderSession(actionLabel)
  if (!commander.ok) return { ok: false, response: commander.response }
  return { ok: true, userId: commander.userId, store: storeFactory() }
}

export async function handleWorkspaceGet(): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace')
  if (!ctx.ok) return ctx.response
  const member = await ctx.store.getMember(ctx.userId)
  if (!member.ok) return jsonStoreFailure(member)
  const settings = await ctx.store.getSettings(ctx.userId)
  if (!settings.ok) return jsonStoreFailure(settings)
  const proposals = await ctx.store.listProposals(ctx.userId)
  if (!proposals.ok) return jsonStoreFailure(proposals)
  return NextResponse.json({
    member: member.value,
    settings: settings.value,
    proposalSummary: summarizeProposals(proposals.value),
  })
}

export async function handleWorkspaceSettingsGet(): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace settings')
  if (!ctx.ok) return ctx.response
  const settings = await ctx.store.getSettings(ctx.userId)
  return settings.ok ? NextResponse.json({ settings: settings.value }) : jsonStoreFailure(settings)
}

export async function handleWorkspaceSettingsPatch(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace settings update')
  if (!ctx.ok) return ctx.response
  const rateLimit = checkWorkspaceRateLimit(ctx.userId, 'settings_update')
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfterSeconds)
  const parsed = validateWorkspaceSettings(await safeJson(req))
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const saved = await ctx.store.upsertSettings(ctx.userId, parsed.value)
  return saved.ok ? NextResponse.json({ settings: saved.value }) : jsonStoreFailure(saved)
}

export async function handleWorkspaceProposalsGet(): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace proposals')
  if (!ctx.ok) return ctx.response
  const proposals = await ctx.store.listProposals(ctx.userId)
  return proposals.ok ? NextResponse.json({ proposals: proposals.value }) : jsonStoreFailure(proposals)
}

export async function handleWorkspaceProposalsPost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace proposal creation')
  if (!ctx.ok) return ctx.response
  const rateLimit = checkWorkspaceRateLimit(ctx.userId, 'proposal_create')
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfterSeconds)
  const input = validateProposalInput(await safeJson(req))
  if (!input.ok) return NextResponse.json({ error: input.reason }, { status: 400 })
  const created = await ctx.store.createProposal(ctx.userId, input.value)
  return created.ok ? NextResponse.json(created.value, { status: 201 }) : jsonStoreFailure(created)
}

export async function handleWorkspaceProposalGet(proposalId: string): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace proposal')
  if (!ctx.ok) return ctx.response
  const proposal = await ctx.store.getOwnedProposal(ctx.userId, proposalId)
  if (!proposal.ok) return jsonStoreFailure(proposal)
  const [events, attachments] = await Promise.all([ctx.store.listEvents(proposalId), ctx.store.listAttachments(proposalId)])
  return NextResponse.json({
    proposal: proposal.value,
    events: events.ok ? events.value : [],
    attachments: attachments.ok ? attachments.value : [],
  })
}

export async function handleWorkspaceProposalPatch(req: NextRequest, proposalId: string): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace proposal update')
  if (!ctx.ok) return ctx.response
  const input = validateProposalInput(await safeJson(req), true)
  if (!input.ok) return NextResponse.json({ error: input.reason }, { status: 400 })
  const updated = await ctx.store.updateDraftProposal(ctx.userId, proposalId, input.value)
  return updated.ok ? NextResponse.json({ proposal: updated.value }) : jsonStoreFailure(updated)
}

export async function handleWorkspaceProposalSubmit(req: NextRequest, proposalId: string): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace proposal submission')
  if (!ctx.ok) return ctx.response
  const key = await resolveIdempotencyKey(req, await safeJson(req))
  if (!key.ok) return NextResponse.json({ error: key.reason }, { status: 400 })
  const submitted = await ctx.store.submitProposal(ctx.userId, proposalId, key.value)
  return submitted.ok ? NextResponse.json(submitted.value) : jsonStoreFailure(submitted)
}

export async function handleWorkspaceAttachmentPost(req: NextRequest, proposalId: string): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace attachment upload')
  if (!ctx.ok) return ctx.response
  const rateLimit = checkWorkspaceRateLimit(ctx.userId, 'attachment_upload')
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfterSeconds)
  const proposal = await ctx.store.getOwnedProposal(ctx.userId, proposalId)
  if (!proposal.ok) return jsonStoreFailure(proposal)
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })
  const validated = await validateWorkspaceAttachment({ workspaceOwnerId: ctx.userId, proposalId, file })
  if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 400 })
  const usage = await ctx.store.getAttachmentStorageUsage(ctx.userId)
  if (!usage.ok) return jsonStoreFailure(usage)
  if (usage.value.bytes + file.size > 100 * 1024 * 1024) return NextResponse.json({ error: 'workspace_attachment_quota_exceeded' }, { status: 429 })
  const uploaded = await ctx.store.uploadAttachmentBytes(validated.storagePath, validated.bytes, validated.mimeType)
  if (!uploaded.ok) return jsonStoreFailure(uploaded)
  const inserted = await ctx.store.insertAttachment({
    proposal_id: proposalId,
    workspace_owner_id: ctx.userId,
    storage_path: validated.storagePath,
    original_filename: file.name,
    mime_type: validated.mimeType,
    size_bytes: file.size,
    content_sha256: validated.contentSha256,
    uploaded_by_user_id: ctx.userId,
  })
  if (!inserted.ok) {
    await ctx.store.deleteAttachmentObject(validated.storagePath)
    return jsonStoreFailure(inserted)
  }
  return inserted.ok ? NextResponse.json({ attachment: inserted.value }, { status: 201 }) : jsonStoreFailure(inserted)
}

export async function handleWorkspaceAttachmentDelete(proposalId: string, attachmentId: string): Promise<NextResponse> {
  const ctx = await requireContributorContext('Workspace attachment delete')
  if (!ctx.ok) return ctx.response
  const deleted = await ctx.store.deleteOwnedAttachment(ctx.userId, proposalId, attachmentId)
  return deleted.ok ? NextResponse.json(deleted.value) : jsonStoreFailure(deleted)
}

export async function handleCommanderProposalsGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireCommanderContext('Commander proposal queue')
  if (!ctx.ok) return ctx.response
  const { searchParams } = new URL(req.url)
  const proposals = await ctx.store.listCommanderProposals({
    status: searchParams.get('status'),
    category: searchParams.get('category'),
    owner: searchParams.get('owner'),
  })
  return proposals.ok ? NextResponse.json({ proposals: proposals.value }) : jsonStoreFailure(proposals)
}

export async function handleCommanderProposalGet(proposalId: string): Promise<NextResponse> {
  const ctx = await requireCommanderContext('Commander proposal detail')
  if (!ctx.ok) return ctx.response
  const proposal = await ctx.store.getProposal(proposalId)
  if (!proposal.ok) return jsonStoreFailure(proposal)
  const [events, attachments] = await Promise.all([ctx.store.listEvents(proposalId), ctx.store.listAttachments(proposalId)])
  return NextResponse.json({
    proposal: proposal.value,
    events: events.ok ? events.value : [],
    attachments: attachments.ok ? attachments.value : [],
  })
}

export async function handleCommanderProposalTransition(req: NextRequest, proposalId: string): Promise<NextResponse> {
  const ctx = await requireCommanderContext('Commander proposal transition')
  if (!ctx.ok) return ctx.response
  const body = await safeJson(req)
  const key = await resolveIdempotencyKey(req, body)
  if (!key.ok) return NextResponse.json({ error: key.reason }, { status: 400 })
  const toStatus = typeof body?.toStatus === 'string' ? body.toStatus : null
  if (!isWorkspaceProposalStatus(toStatus)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  const input: WorkspaceCommanderTransitionInput = {
    toStatus,
    idempotencyKey: key.value,
    reason: typeof body.reason === 'string' ? body.reason : null,
    commanderDecision: typeof body.commanderDecision === 'string' ? body.commanderDecision : null,
    commanderDecisionReason: typeof body.commanderDecisionReason === 'string' ? body.commanderDecisionReason : null,
    implementationRef: typeof body.implementationRef === 'string' ? body.implementationRef : null,
  }
  const proposal = await ctx.store.getProposal(proposalId)
  if (!proposal.ok) return jsonStoreFailure(proposal)
  const transition = validateWorkspaceProposalTransition(proposal.value.status, input.toStatus, 'commander')
  if (!transition.ok && proposal.value.status !== input.toStatus) return NextResponse.json({ error: transition.reason }, { status: 409 })
  const transitioned = await ctx.store.commanderTransition(proposalId, ctx.userId, input)
  return transitioned.ok ? NextResponse.json(transitioned.value) : jsonStoreFailure(transitioned)
}

export async function handleCommanderAttachmentSignedUrl(proposalId: string, attachmentId: string): Promise<NextResponse> {
  const ctx = await requireCommanderContext('Commander proposal attachment')
  if (!ctx.ok) return ctx.response
  const rateLimit = checkWorkspaceRateLimit(ctx.userId, 'attachment_signed_url')
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfterSeconds)
  const proposal = await ctx.store.getProposal(proposalId)
  if (!proposal.ok) return jsonStoreFailure(proposal)
  const attachment = await ctx.store.getAttachment(attachmentId)
  if (!attachment.ok) return jsonStoreFailure(attachment)
  if (attachment.value.proposal_id !== proposalId) return NextResponse.json({ error: 'attachment_not_found' }, { status: 404 })
  const signed = await ctx.store.createSignedAttachmentUrl(attachment.value.storage_path)
  return signed.ok ? NextResponse.json(signed.value) : jsonStoreFailure(signed)
}

async function safeJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await req.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function resolveIdempotencyKey(req: NextRequest, body?: Record<string, unknown>): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const headerValue = req.headers.get('idempotency-key') ?? req.headers.get('x-idempotency-key')
  const bodyValue = body && typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
  if (headerValue && bodyValue && headerValue !== bodyValue) return { ok: false, reason: 'idempotency_key_mismatch' }
  const value = headerValue ?? bodyValue ?? randomUUID()
  if (!UUID_PATTERN.test(value)) return { ok: false, reason: 'invalid_idempotency_key' }
  return { ok: true, value }
}

function jsonStoreFailure(result: { ok: false; status: number; error: string }): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status })
}

function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json({ error: 'rate_limited', retryAfterSeconds }, { status: 429 })
}

function summarizeProposals(proposals: Array<{ status: string }>) {
  return proposals.reduce<Record<string, number>>((summary, proposal) => {
    summary[proposal.status] = (summary[proposal.status] ?? 0) + 1
    return summary
  }, { total: proposals.length })
}

export const testOnly = { requireContributorContext, requireCommanderContext, failure }
