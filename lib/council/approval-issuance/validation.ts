import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import { handleApprovalIssueRequest } from './handler'
import { buildApprovalIssuanceTemplate } from './templates'
import type { IssueApprovalInput, IssueApprovalResult } from '../approval-authority/types'
import type { ApprovalIssueResponse } from './types'

export type ApprovalIssuanceValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

type FakeAuthority = {
  calls: IssueApprovalInput[]
  issue(input: IssueApprovalInput): Promise<IssueApprovalResult>
}

const COMMANDER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'

export async function runGate16ApprovalIssuanceValidation(): Promise<ApprovalIssuanceValidationResult[]> {
  const results: ApprovalIssuanceValidationResult[] = []

  results.push(checkRouteFirstStatement())

  const preview = await executeCase({
    caseId: 'gate16_preview_no_write',
    description: 'Preview returns canonical approval text and does not write.',
    body: { mode: 'preview', targetId: 'reminder-preview', templateVersion: 'apple_reminder_mark_read_v1' },
    expect: response => response.ok && response.status === 'previewed' && Boolean(response.exactApprovedText),
    expected: 'previewed and zero authority.issue calls',
    expectedCalls: 0,
  })
  results.push(preview)

  const templateV1 = buildApprovalIssuanceTemplate('apple_reminder_mark_read_v1', { targetId: 'reminder-issue' })
  const exactV1 = templateV1.ok ? templateV1.exactApprovedText : ''
  results.push(await executeCase({
    caseId: 'gate16_issue_valid',
    description: 'Confirmed exact-text issue writes an approval with 46P metadata.',
    body: {
      mode: 'issue',
      targetId: 'reminder-issue',
      templateVersion: 'apple_reminder_mark_read_v1',
      exactApprovedText: exactV1,
      confirmed: true,
      ttlSeconds: 300,
    },
    expect: response => response.ok && response.status === 'issued' && Boolean(response.approvalId),
    expected: 'issued with one authority.issue call and metadata',
    expectedCalls: 1,
    inspectCalls: calls => (
      calls[0]?.issued_by_user_id === COMMANDER_ID &&
      calls[0]?.authority_basis === 'configured_commander_user_id' &&
      calls[0]?.issuance_route === 'operator_approval_surface'
    ),
  }))

  results.push(await executeCase({
    caseId: 'gate16_missing_commander_config',
    description: 'Missing Commander config fails unavailable before approval write.',
    body: { mode: 'preview', targetId: 'reminder-config' },
    commanderConfig: { ok: false, reason: 'missing', message: 'missing config' },
    expect: response => !response.ok && response.status === 'commander_config_unavailable',
    expected: '503 commander_config_unavailable and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_malformed_commander_config',
    description: 'Malformed Commander config fails unavailable before approval write.',
    body: { mode: 'preview', targetId: 'reminder-config' },
    commanderConfig: { ok: false, reason: 'malformed', message: 'malformed config' },
    expect: response => !response.ok && response.status === 'commander_config_unavailable',
    expected: '503 commander_config_unavailable and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_unauthenticated',
    description: 'Unauthenticated request fails before approval write.',
    body: { mode: 'preview', targetId: 'reminder-auth' },
    userId: null,
    expect: response => !response.ok && response.status === 'unauthenticated',
    expected: '401 unauthenticated and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_commander_mismatch',
    description: 'Authenticated non-Commander fails before approval write.',
    body: { mode: 'preview', targetId: 'reminder-mismatch' },
    userId: OTHER_USER_ID,
    expect: response => !response.ok && response.status === 'commander_mismatch',
    expected: '403 commander_mismatch and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_unconfirmed_issue',
    description: 'Issue mode without confirmation is blocked.',
    body: { mode: 'issue', targetId: 'reminder-unconfirmed', exactApprovedText: 'wrong' },
    expect: response => !response.ok && response.status === 'unconfirmed',
    expected: '400 unconfirmed and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_exact_text_mismatch',
    description: 'Issue mode with mismatched exact text is blocked.',
    body: { mode: 'issue', targetId: 'reminder-mismatch-text', exactApprovedText: 'wrong', confirmed: true },
    expect: response => !response.ok && response.status === 'exact_text_mismatch',
    expected: '409 exact_text_mismatch and zero writes',
    expectedCalls: 0,
  }))

  results.push(await executeCase({
    caseId: 'gate16_unknown_template',
    description: 'Unknown template is blocked.',
    body: { mode: 'preview', targetId: 'reminder-template', templateVersion: 'deleted_template' },
    expect: response => !response.ok && response.status === 'unknown_template',
    expected: '400 unknown_template and zero writes',
    expectedCalls: 0,
  }))

  const spoofTemplate = buildApprovalIssuanceTemplate('apple_reminder_mark_read_v1', { targetId: 'reminder-spoof' })
  results.push(await executeCase({
    caseId: 'gate16_client_metadata_ignored',
    description: 'Client-supplied authority metadata is ignored and server values are written.',
    body: {
      mode: 'issue',
      targetId: 'reminder-spoof',
      templateVersion: 'apple_reminder_mark_read_v1',
      exactApprovedText: spoofTemplate.ok ? spoofTemplate.exactApprovedText : '',
      confirmed: true,
      issued_by_user_id: OTHER_USER_ID,
      authority_basis: 'client_spoof',
      issuance_route: 'client_spoof',
    },
    expect: response => response.ok && response.status === 'issued',
    expected: 'server metadata overrides spoofed client metadata',
    expectedCalls: 1,
    inspectCalls: calls => (
      calls[0]?.issued_by_user_id === COMMANDER_ID &&
      calls[0]?.authority_basis === 'configured_commander_user_id' &&
      calls[0]?.issuance_route === 'operator_approval_surface'
    ),
  }))

  const templateV2 = buildApprovalIssuanceTemplate('apple_reminder_mark_read_v2', { targetId: 'reminder-versioned' })
  results.push(await executeCase({
    caseId: 'gate16_v1_v2_templates_valid',
    description: 'v1 remains valid after v2 exists.',
    body: {
      mode: 'issue',
      targetId: 'reminder-versioned',
      templateVersion: 'apple_reminder_mark_read_v2',
      exactApprovedText: templateV2.ok ? templateV2.exactApprovedText : '',
      confirmed: true,
    },
    expect: response => response.ok && response.status === 'issued',
    expected: 'v2 issues while v1 builder remains valid',
    expectedCalls: 1,
    inspectCalls: () => buildApprovalIssuanceTemplate('apple_reminder_mark_read_v1', { targetId: 'reminder-versioned' }).ok,
  }))

  results.push(await executeCase({
    caseId: 'gate16_invalid_ttl',
    description: 'TTL inside the previously-buggy 30-59 second range is blocked before approval write.',
    body: { mode: 'preview', targetId: 'reminder-ttl', ttlSeconds: 45 },
    expect: response => !response.ok && response.status === 'invalid_request',
    expected: '400 invalid_request and zero writes',
    expectedCalls: 0,
  }))

  results.push(checkPrebuildGateScript())

  return results
}

function checkRouteFirstStatement(): ApprovalIssuanceValidationResult {
  const route = readFileSync('app/api/council/approval/issue/route.ts', 'utf8')
  const functionBody = route.match(/export async function POST\(request: Request\) \{\s*([\s\S]*?)\n\}/)?.[1] ?? ''
  const firstStatement = functionBody.trim().split('\n')[0]?.trim() ?? ''
  const passed = firstStatement === 'const environmentBlocked = assertLiveActionsAllowed()'
  return {
    caseId: 'gate16_route_environment_gate_first',
    description: 'Approval issue route checks live-action environment before any other statement.',
    expected: 'first statement is assertLiveActionsAllowed call',
    observed: firstStatement,
    result: passed ? 'PASS' : 'FAIL',
    notes: [],
  }
}

function checkPrebuildGateScript(): ApprovalIssuanceValidationResult {
  const packageJson = readFileSync('package.json', 'utf8')
  const validUuid = '11111111-1111-4111-8111-111111111111'
  const productionValid = spawnSync(process.execPath, ['scripts/validate-commander-identity.cjs'], {
    env: { ...process.env, VERCEL_ENV: 'production', WAR_ROOM_COMMANDER_USER_ID: validUuid },
    encoding: 'utf8',
  })
  const productionInvalid = spawnSync(process.execPath, ['scripts/validate-commander-identity.cjs'], {
    env: { ...process.env, VERCEL_ENV: 'production', WAR_ROOM_COMMANDER_USER_ID: 'not-a-uuid' },
    encoding: 'utf8',
  })
  const passed = productionValid.status === 0 &&
    productionInvalid.status !== 0 &&
    packageJson.includes('"prebuild": "node scripts/validate-commander-identity.cjs"')
  return {
    caseId: 'gate16_prebuild_gate_configured',
    description: 'Production prebuild gate executes against real UUID inputs.',
    expected: 'valid UUID exits 0; malformed UUID exits nonzero; package prebuild is wired',
    observed: `validExit=${productionValid.status}; invalidExit=${productionInvalid.status}; packageScript=${packageJson.includes('"prebuild": "node scripts/validate-commander-identity.cjs"')}`,
    result: passed ? 'PASS' : 'FAIL',
    notes: [
      trimSpawnOutput(productionValid.stdout) || trimSpawnOutput(productionValid.stderr) || productionValid.error?.message,
      trimSpawnOutput(productionInvalid.stderr) || trimSpawnOutput(productionInvalid.stdout) || productionInvalid.error?.message,
    ].filter((note): note is string => Boolean(note)),
  }
}

function trimSpawnOutput(value: string | Buffer | undefined): string {
  return typeof value === 'string' ? value.trim() : value?.toString('utf8').trim() ?? ''
}

async function executeCase(input: {
  caseId: string
  description: string
  body: Record<string, unknown>
  expect: (response: ApprovalIssueResponse) => boolean
  expected: string
  expectedCalls: number
  userId?: string | null
  commanderConfig?: { ok: true; commanderUserId: string } | { ok: false; reason: 'missing' | 'malformed'; message: string }
  inspectCalls?: (calls: IssueApprovalInput[]) => boolean
}): Promise<ApprovalIssuanceValidationResult> {
  const authority = createFakeAuthority()
  const response = await handleApprovalIssueRequest(makeRequest(input.body), {
    readCommanderConfig: () => input.commanderConfig ?? { ok: true, commanderUserId: COMMANDER_ID },
    resolveAuthenticatedUser: async () => ({
      user: input.userId === null ? null : { id: input.userId ?? COMMANDER_ID, email: 'commander@example.test' },
      errorMessage: input.userId === null ? 'No active session.' : null,
    }),
    createApprovalAuthority: () => authority,
  })
  const body = await response.json()
  const passed = input.expect(body) &&
    authority.calls.length === input.expectedCalls &&
    (input.inspectCalls ? input.inspectCalls(authority.calls) : true)

  return {
    caseId: input.caseId,
    description: input.description,
    expected: input.expected,
    observed: `${response.status} ${body.status}; issueCalls=${authority.calls.length}`,
    result: passed ? 'PASS' : 'FAIL',
    notes: body.safeSummary ? [body.safeSummary] : [],
  }
}

function createFakeAuthority(): FakeAuthority {
  return {
    calls: [],
    async issue(input: IssueApprovalInput): Promise<IssueApprovalResult> {
      this.calls.push(input)
      const now = new Date().toISOString()
      return {
        ok: true,
        status: 'issued',
        errorMessage: null,
        approval: {
          approval_id: randomUUID(),
          exact_approved_text: input.exact_approved_text,
          commander_input: input.commander_input,
          approved_by: input.approved_by,
          action_type: input.action_type,
          target_system: input.target_system,
          target_id: input.target_id,
          single_use: true,
          nonce: `nonce_${randomUUID()}`,
          created_at: now,
          updated_at: now,
          expires_at: new Date(Date.parse(now) + (input.ttlMs ?? 300000)).toISOString(),
          consumed_at: null,
          revoked_at: null,
          revoked_reason: null,
          status: 'active',
          issued_by_user_id: input.issued_by_user_id,
          authority_basis: input.authority_basis,
          issuance_route: input.issuance_route,
        },
      }
    },
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/council/approval/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
