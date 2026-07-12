import { NextResponse } from 'next/server'
import { createSupabaseApprovalAuthority } from '../approval-authority/SupabaseApprovalAuthority'
import { createSupabaseServerClient } from '../../supabase/server'
import { readCommanderIdentityConfig, isUuid } from '../../security/commanderIdentity'
import {
  APPROVAL_ISSUANCE_ACTION_TYPE,
  APPROVAL_ISSUANCE_TARGET_SYSTEM,
  buildApprovalIssuanceTemplate,
  type ApprovalIssuanceTemplateVersion,
} from './templates'
import type {
  ApprovalIssueRequestBody,
  ApprovalIssueResponse,
  ApprovalIssuerAuthority,
  ApprovalIssuerAuthResult,
} from './types'

const DEFAULT_TEMPLATE_VERSION: ApprovalIssuanceTemplateVersion = 'apple_reminder_mark_read_v1'
const DEFAULT_TTL_SECONDS = 5 * 60
const MIN_TTL_SECONDS = 60
const MAX_TTL_SECONDS = 15 * 60

export type ApprovalIssueHandlerOptions = {
  readCommanderConfig?: typeof readCommanderIdentityConfig
  resolveAuthenticatedUser?: () => Promise<ApprovalIssuerAuthResult>
  createApprovalAuthority?: () => ApprovalIssuerAuthority
}

export async function handleApprovalIssueRequest(
  request: Request,
  options: ApprovalIssueHandlerOptions = {}
): Promise<NextResponse<ApprovalIssueResponse>> {
  const commanderConfig = (options.readCommanderConfig ?? readCommanderIdentityConfig)()
  if (!commanderConfig.ok) {
    return jsonResponse('commander_config_unavailable', 503, {
      safeSummary: commanderConfig.message,
    })
  }

  const auth = await (options.resolveAuthenticatedUser ?? resolveAuthenticatedUser)()
  if (!auth.user) {
    return jsonResponse('unauthenticated', 401, {
      safeSummary: auth.errorMessage ?? 'Authenticated Commander session required.',
    })
  }

  if (auth.user.id !== commanderConfig.commanderUserId) {
    return jsonResponse('commander_mismatch', 403, {
      safeSummary: 'Authenticated user is not the configured Commander.',
      issuedByUserId: auth.user.id,
    })
  }

  const bodyResult = await readRequestBody(request)
  if (!bodyResult.ok) {
    return jsonResponse('invalid_request', 400, { safeSummary: bodyResult.message })
  }

  const body = bodyResult.body
  const mode = body.mode ?? 'preview'
  if (mode !== 'preview' && mode !== 'issue') {
    return jsonResponse('invalid_request', 400, { safeSummary: 'mode must be preview or issue.' })
  }

  const targetId = body.targetId?.trim() ?? ''
  if (!targetId) {
    return jsonResponse('invalid_request', 400, { safeSummary: 'targetId is required.' })
  }

  const ttl = validateTtlSeconds(body.ttlSeconds)
  if (!ttl.ok) {
    return jsonResponse('invalid_request', 400, { safeSummary: ttl.message, targetId })
  }

  const templateVersion = body.templateVersion ?? DEFAULT_TEMPLATE_VERSION
  const template = buildApprovalIssuanceTemplate(templateVersion, { targetId })
  if (!template.ok) {
    return jsonResponse(template.status === 'unknown_template' ? 'unknown_template' : 'invalid_request', 400, {
      safeSummary: template.message,
      targetId,
    })
  }

  if (mode === 'preview') {
    return jsonResponse('previewed', 200, {
      ok: true,
      safeSummary: 'Approval text previewed. No approval has been issued.',
      exactApprovedText: template.exactApprovedText,
      targetId,
      templateVersion: template.templateVersion,
      issuedByUserId: auth.user.id,
    })
  }

  if (body.confirmed !== true) {
    return jsonResponse('unconfirmed', 400, {
      safeSummary: 'Commander confirmation is required before issuing approval.',
      exactApprovedText: template.exactApprovedText,
      targetId,
      templateVersion: template.templateVersion,
      issuedByUserId: auth.user.id,
    })
  }

  if (body.exactApprovedText !== template.exactApprovedText) {
    return jsonResponse('exact_text_mismatch', 409, {
      safeSummary: 'exactApprovedText must exactly match the generated approval text.',
      exactApprovedText: template.exactApprovedText,
      targetId,
      templateVersion: template.templateVersion,
      issuedByUserId: auth.user.id,
    })
  }

  const issueResult = await (options.createApprovalAuthority ?? createSupabaseApprovalAuthority)().issue({
    exact_approved_text: template.exactApprovedText,
    commander_input: body.commanderInput?.trim() || `Issue approval for ${APPROVAL_ISSUANCE_ACTION_TYPE}:${targetId}`,
    approved_by: auth.user.email?.trim() || auth.user.id,
    action_type: APPROVAL_ISSUANCE_ACTION_TYPE,
    target_system: APPROVAL_ISSUANCE_TARGET_SYSTEM,
    target_id: targetId,
    issued_by_user_id: auth.user.id,
    authority_basis: 'configured_commander_user_id',
    issuance_route: 'operator_approval_surface',
    ttlMs: ttl.ttlSeconds * 1000,
  })

  if (!issueResult.ok || !issueResult.approval) {
    return jsonResponse('issue_failed', 500, {
      safeSummary: issueResult.errorMessage ?? 'Approval could not be issued.',
      exactApprovedText: template.exactApprovedText,
      targetId,
      templateVersion: template.templateVersion,
      issuedByUserId: auth.user.id,
    })
  }

  return jsonResponse('issued', 200, {
    ok: true,
    safeSummary: 'Approval issued. It can now be consumed once by the approved action path.',
    exactApprovedText: template.exactApprovedText,
    approvalId: issueResult.approval.approval_id,
    targetId,
    templateVersion: template.templateVersion,
    issuedByUserId: auth.user.id,
    expiresAt: issueResult.approval.expires_at,
  })
}

async function resolveAuthenticatedUser(): Promise<ApprovalIssuerAuthResult> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  return {
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    errorMessage: error?.message ?? null,
  }
}

async function readRequestBody(request: Request): Promise<
  | { ok: true; body: ApprovalIssueRequestBody }
  | { ok: false; message: string }
> {
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'JSON object body required.' }
    }
    return { ok: true, body: parsed as ApprovalIssueRequestBody }
  } catch {
    return { ok: false, message: 'Valid JSON body required.' }
  }
}

function validateTtlSeconds(value: number | undefined): { ok: true; ttlSeconds: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, ttlSeconds: DEFAULT_TTL_SECONDS }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: 'ttlSeconds must be an integer.' }
  }
  if (value < MIN_TTL_SECONDS || value > MAX_TTL_SECONDS) {
    return { ok: false, message: `ttlSeconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}.` }
  }
  return { ok: true, ttlSeconds: value }
}

function jsonResponse(
  status: ApprovalIssueResponse['status'],
  httpStatus: number,
  overrides: Partial<ApprovalIssueResponse> = {}
): NextResponse<ApprovalIssueResponse> {
  const body: ApprovalIssueResponse = {
    ok: overrides.ok ?? (status === 'issued' || status === 'previewed'),
    status,
    safeSummary: overrides.safeSummary ?? status,
    exactApprovedText: overrides.exactApprovedText ?? null,
    approvalId: overrides.approvalId ?? null,
    targetId: overrides.targetId ?? null,
    actionType: APPROVAL_ISSUANCE_ACTION_TYPE,
    targetSystem: APPROVAL_ISSUANCE_TARGET_SYSTEM,
    templateVersion: overrides.templateVersion ?? null,
    issuedByUserId: normalizeUuidOrNull(overrides.issuedByUserId),
    authorityBasis: overrides.authorityBasis ?? (status === 'issued' ? 'configured_commander_user_id' : null),
    issuanceRoute: overrides.issuanceRoute ?? (status === 'issued' ? 'operator_approval_surface' : null),
    expiresAt: overrides.expiresAt ?? null,
  }
  return NextResponse.json(body, { status: httpStatus })
}

function normalizeUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  return isUuid(value) ? value : null
}
