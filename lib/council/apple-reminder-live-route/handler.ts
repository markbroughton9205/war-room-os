import { randomUUID } from 'crypto'
import {
  AppleReminderActionPacketFactory,
  AppleShortcutBridgeUrlBuilder,
  AppleShortcutReceiptParser,
  createAppleRemindersBridgePolicy,
  type AppleReminderActionPacket,
} from '../apple-reminders-bridge'
import { ledgerEntryFromApplePacket } from '../auto-mode-ledger/ledgerEntryFactory'
import {
  APPLE_REMINDER_LIVE_ROUTE_FLAG,
  LIVE_APPLE_REMINDER_EXECUTION_FLAG,
  type AppleApprovalConsumeStatus,
  type AppleReminderLiveRouteAuditRecord,
  type AppleReminderLiveRouteBlockedReason,
  type AppleReminderLiveRouteEnv,
  type AppleReminderLiveRouteFlagState,
  type AppleReminderLiveRouteOptions,
  type AppleReminderLiveRouteRequest,
  type AppleReminderLiveRouteResponse,
} from './types'

const PACKET_LIFETIME_MS = 5 * 60 * 1000

export async function handleAppleReminderLiveCommand(
  rawRequest: unknown,
  options: AppleReminderLiveRouteOptions
): Promise<AppleReminderLiveRouteResponse> {
  const now = options.now ?? new Date().toISOString()
  const env: AppleReminderLiveRouteEnv = options.env ?? {
    WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE:
      process.env.WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE,
    WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION:
      process.env.WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION,
  }
  const flagState = readRouteFlags(env)
  const requestId = `apple_reminder_live_${Date.parse(now) || 0}_${randomUUID().slice(0, 8)}`

  if (!flagState.routeEnabled || !flagState.liveExecutionEnabled) {
    return blocked({
      requestId,
      command: 'unknown',
      flagState,
      blockedReason: 'route_disabled',
      note: 'Apple reminder live route flags are disabled.',
      now,
    })
  }

  const parsed = parseRequest(rawRequest)
  if (!parsed) {
    return blocked({
      requestId,
      command: 'unknown',
      flagState,
      blockedReason: 'invalid_request',
      note: 'Request body does not match a known command shape.',
      now,
    })
  }

  if (parsed.command === 'issue_apple_reminder_packet') {
    return handleIssue(parsed, requestId, flagState, options, now)
  }

  return handleSubmitReceipt(parsed, requestId, flagState, options, now)
}

async function handleIssue(
  request: Extract<AppleReminderLiveRouteRequest, { command: 'issue_apple_reminder_packet' }>,
  requestId: string,
  flagState: AppleReminderLiveRouteFlagState,
  options: AppleReminderLiveRouteOptions,
  now: string
): Promise<AppleReminderLiveRouteResponse> {
  // confirmed is a client-side UX guard only (prevents accidental double-fires
  // in the browser). It is NOT a security boundary -- it is trivially
  // satisfiable by any authenticated caller and carries no independent
  // verification. The real authorization boundary below is the pre-existing,
  // atomically-consumed ExplicitExecutionApproval record.
  if (request.confirmed !== true) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'not_confirmed',
      note: 'Issue request was not explicitly confirmed.',
      now,
    })
  }

  const reminderId = request.reminderId?.trim()
  if (!reminderId) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'missing_reminder_id',
      note: 'reminderId is required to issue a packet.',
      now,
    })
  }

  const approvalId = request.approvalId?.trim()
  if (!approvalId) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'missing_approval_id',
      note: 'approvalId is required to issue a packet. This route does not create approvals.',
      now,
    })
  }

  // Atomic check-and-consume against a PRE-EXISTING approval record, issued
  // by a separate, prior approved-execution-gate step. This route never
  // constructs its own approval -- doing so was the security gap being fixed.
  const consumeResult = await options.approvalConsumer.consumeForAppleReminderRead({
    approvalId,
    reminderId,
    exactApprovedText: request.exactApprovedText,
    now,
  })

  if (!consumeResult.ok || !consumeResult.authorizationSnapshot) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: mapApprovalConsumeStatusToBlockedReason(consumeResult.status),
      note: consumeResult.errorMessage ?? `Approval consume failed: ${consumeResult.status}.`,
      now,
      approvalId,
    })
  }

  const authorizationSnapshot = consumeResult.authorizationSnapshot
  const expiresAt = new Date(Date.parse(now) + PACKET_LIFETIME_MS).toISOString()

  const policy = createAppleRemindersBridgePolicy({
    iphoneShortcutBridgeEnabled: true,
    appleRemindersBridgeEnabled: true,
    allowedLiveActionTypes: ['mark_apple_reminder_read'],
  })

  const creationResult = new AppleReminderActionPacketFactory().create({
    policy,
    approval: authorizationSnapshot,
    commanderInput: authorizationSnapshot.commanderInput,
    exactApprovedText: authorizationSnapshot.exactApprovedText,
    reminderId,
    actionType: 'mark_apple_reminder_read',
    createdAt: now,
    expiresAt,
  })

  if (!creationResult.packet) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'packet_creation_blocked',
      note: creationResult.blockedReason ?? 'Packet creation blocked for an unspecified reason.',
      now,
      approvalId,
    })
  }

  const packet = creationResult.packet
  const ledgerEntry = ledgerEntryFromApplePacket(packet)
  const writeResult = await options.ledger.issuePacket(ledgerEntry)

  if (!writeResult.ok) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'ledger_issue_failed',
      note: writeResult.errorMessage ?? `Ledger issue failed: ${writeResult.status}.`,
      now,
      approvalId,
      packetId: packet.packetId,
    })
  }

  const shortcutUrl = new AppleShortcutBridgeUrlBuilder().buildManualUrl(packet)

  return {
    requestId,
    status: 'issued',
    packet,
    shortcutUrl: shortcutUrl.url,
    verification: null,
    auditRecord: buildAuditRecord({
      requestId,
      command: request.command,
      flagState,
      approvalId,
      packetId: packet.packetId,
      packetCreated: true,
      ledgerWriteAttempted: true,
      ledgerStatus: writeResult.status,
      receiptVerificationStatus: null,
      status: 'issued',
      blockedReason: null,
      notes: ['Packet issued into live Supabase ledger.', 'Shortcut URL is self-contained; no server callback exists.'],
      now,
    }),
    safeSummary: 'Apple reminder packet issued. Run the returned Shortcut URL on the Commander\'s iPhone.',
    recommendedNextAction: 'Open the Shortcut URL on the iPhone, then paste the resulting receipt back for verification.',
  }
}

async function handleSubmitReceipt(
  request: Extract<AppleReminderLiveRouteRequest, { command: 'submit_apple_reminder_receipt' }>,
  requestId: string,
  flagState: AppleReminderLiveRouteFlagState,
  options: AppleReminderLiveRouteOptions,
  now: string
): Promise<AppleReminderLiveRouteResponse> {
  const packet: AppleReminderActionPacket | null = request.packet ?? null
  if (!packet) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'invalid_request',
      note: 'submit_apple_reminder_receipt requires the original packet.',
      now,
    })
  }

  const parseResult = new AppleShortcutReceiptParser().parse(request.receiptText ?? '')
  if (parseResult.status !== 'parsed' || !parseResult.receipt) {
    return blocked({
      requestId,
      command: request.command,
      flagState,
      blockedReason: 'receipt_parse_failed',
      note: parseResult.error ?? 'Receipt text could not be parsed.',
      now,
      packetId: packet.packetId,
    })
  }

  const verification = await options.receiptVerifier.verifyWithLedger({
    packet,
    receipt: parseResult.receipt,
    now,
  })

  const status = verification.status === 'verified_clean' ? 'verified' : 'rejected'

  return {
    requestId,
    status,
    packet,
    shortcutUrl: null,
    verification,
    auditRecord: buildAuditRecord({
      requestId,
      command: request.command,
      flagState,
      approvalId: packet.approvalId,
      packetId: packet.packetId,
      packetCreated: false,
      ledgerWriteAttempted: true,
      ledgerStatus: verification.ledgerStatus,
      receiptVerificationStatus: verification.status,
      status,
      blockedReason: status === 'rejected' ? 'ledger_verification_failed' : null,
      notes: [
        '46N receipt verification against the live Supabase ledger.',
        ...verification.issues,
      ],
      now,
    }),
    safeSummary:
      status === 'verified'
        ? 'Receipt verified clean. The reminder is confirmed marked read.'
        : 'Receipt was not verified clean. See verification issues.',
    recommendedNextAction:
      status === 'verified'
        ? 'No further action required.'
        : 'Review verification issues. A fresh packet/approval is required for another attempt.',
  }
}

function readRouteFlags(env: AppleReminderLiveRouteEnv): AppleReminderLiveRouteFlagState {
  return {
    routeEnabled: env[APPLE_REMINDER_LIVE_ROUTE_FLAG] === 'true',
    liveExecutionEnabled: env[LIVE_APPLE_REMINDER_EXECUTION_FLAG] === 'true',
  }
}

function mapApprovalConsumeStatusToBlockedReason(
  status: AppleApprovalConsumeStatus
): AppleReminderLiveRouteBlockedReason {
  switch (status) {
    case 'not_found': return 'approval_not_found'
    case 'not_active': return 'approval_not_active'
    case 'revoked': return 'approval_revoked'
    case 'already_consumed': return 'approval_already_consumed'
    case 'expired': return 'approval_expired'
    case 'action_type_mismatch': return 'approval_action_type_mismatch'
    case 'target_system_mismatch': return 'approval_target_system_mismatch'
    case 'reminder_mismatch': return 'approval_reminder_mismatch'
    case 'text_mismatch': return 'approval_text_mismatch'
    case 'consume_failed': return 'approval_consume_failed'
    default: return 'approval_not_found'
  }
}

function parseRequest(rawRequest: unknown): AppleReminderLiveRouteRequest | null {
  if (!rawRequest || typeof rawRequest !== 'object') return null
  const candidate = rawRequest as Partial<AppleReminderLiveRouteRequest>

  if (candidate.command === 'issue_apple_reminder_packet') {
    const c = candidate as { approvalId?: unknown; reminderId?: unknown; exactApprovedText?: unknown; confirmed?: unknown }
    if (typeof c.reminderId !== 'string') return null
    if (typeof c.approvalId !== 'string') return null
    if (typeof c.exactApprovedText !== 'string') return null
    return {
      command: 'issue_apple_reminder_packet',
      approvalId: c.approvalId,
      reminderId: c.reminderId,
      exactApprovedText: c.exactApprovedText,
      confirmed: c.confirmed === true ? true : (false as unknown as true),
    }
  }

  if (candidate.command === 'submit_apple_reminder_receipt') {
    const c = candidate as { packet?: unknown; receiptText?: unknown }
    if (!c.packet || typeof c.packet !== 'object') return null
    if (typeof c.receiptText !== 'string') return null
    return candidate as AppleReminderLiveRouteRequest
  }

  return null
}

function buildAuditRecord(input: {
  requestId: string
  command: AppleReminderLiveRouteRequest['command'] | 'unknown'
  flagState: AppleReminderLiveRouteFlagState
  approvalId: string | null
  packetId: string | null
  packetCreated: boolean
  ledgerWriteAttempted: boolean
  ledgerStatus: string | null
  receiptVerificationStatus: string | null
  status: 'blocked' | 'issued' | 'verified' | 'rejected'
  blockedReason: AppleReminderLiveRouteBlockedReason | null
  notes: string[]
  now: string
}): AppleReminderLiveRouteAuditRecord {
  return {
    auditId: `audit_${input.requestId}`,
    requestId: input.requestId,
    command: input.command,
    routeFlagState: input.flagState,
    approvalId: input.approvalId,
    packetId: input.packetId,
    packetCreated: input.packetCreated,
    ledgerWriteAttempted: input.ledgerWriteAttempted,
    ledgerStatus: input.ledgerStatus,
    receiptVerificationStatus:
      input.receiptVerificationStatus as AppleReminderLiveRouteAuditRecord['receiptVerificationStatus'],
    status: input.status,
    blockedReason: input.blockedReason,
    notes: input.notes,
    createdAt: input.now,
  }
}

function blocked(input: {
  requestId: string
  command: AppleReminderLiveRouteRequest['command'] | 'unknown'
  flagState: AppleReminderLiveRouteFlagState
  blockedReason: AppleReminderLiveRouteBlockedReason
  note: string
  now: string
  approvalId?: string
  packetId?: string
}): AppleReminderLiveRouteResponse {
  return {
    requestId: input.requestId,
    status: 'blocked',
    packet: null,
    shortcutUrl: null,
    verification: null,
    auditRecord: buildAuditRecord({
      requestId: input.requestId,
      command: input.command,
      flagState: input.flagState,
      approvalId: input.approvalId ?? null,
      packetId: input.packetId ?? null,
      packetCreated: false,
      ledgerWriteAttempted: false,
      ledgerStatus: null,
      receiptVerificationStatus: null,
      status: 'blocked',
      blockedReason: input.blockedReason,
      notes: [input.note],
      now: input.now,
    }),
    safeSummary: 'The request was blocked before any ledger write or Shortcut URL was produced.',
    recommendedNextAction: `Resolve: ${input.note}`,
  }
}
