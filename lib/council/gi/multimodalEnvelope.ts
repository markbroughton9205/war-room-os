import { COMMANDER_TURN_SCHEMA, type AssetRef, type CommanderTurnV1, type EnvelopeValidationIssue, type EnvelopeValidationResult, type TurnPart } from './types'
import { isForbiddenCaptureLabel, normalizeCaptureTruth } from './captureTruth'

const HASH_RE = /^[a-f0-9]{32,128}$/i

function issue(code: string, message: string): EnvelopeValidationIssue {
  return { code, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectAssetRefs(parts: TurnPart[]): AssetRef[] {
  const refs: AssetRef[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (part.kind === 'file' || part.kind === 'image' || part.kind === 'audio' || part.kind === 'video') {
      if (!seen.has(part.asset_ref.asset_id)) {
        seen.add(part.asset_ref.asset_id)
        refs.push(part.asset_ref)
      }
    }
  }
  return refs
}

function parseAssetRef(raw: unknown, issues: EnvelopeValidationIssue[], label: string): AssetRef | null {
  if (!isRecord(raw)) {
    issues.push(issue('CT-ASSET', `${label} requires AssetRef`))
    return null
  }
  const asset_id = typeof raw.asset_id === 'string' ? raw.asset_id.trim() : ''
  const content_hash = typeof raw.content_hash === 'string' ? raw.content_hash.trim() : ''
  const mime = typeof raw.mime === 'string' ? raw.mime.trim() : ''
  const storage = raw.storage
  if (!asset_id) issues.push(issue('CT-ASSET-ID', `${label} missing asset_id`))
  if (!content_hash) issues.push(issue('CT-03', `${label} missing content_hash`))
  else if (!HASH_RE.test(content_hash)) issues.push(issue('CT-03', `${label} content_hash is not a hex digest`))
  if (!mime) issues.push(issue('CT-MIME', `${label} missing mime`))
  if (storage !== 'LOCAL' && storage !== 'HYBRID' && storage !== 'CLOUD_ORIGIN') {
    issues.push(issue('CT-STORAGE', `${label} storage must be LOCAL | HYBRID | CLOUD_ORIGIN`))
  }
  if (raw.url && raw.inline) {
    issues.push(issue('CT-DUAL', `${label} must not carry both inline bytes and url`))
  }
  if (!asset_id || !content_hash || !mime) return null
  if (storage !== 'LOCAL' && storage !== 'HYBRID' && storage !== 'CLOUD_ORIGIN') return null
  return {
    asset_id,
    content_hash,
    storage,
    mime,
    bytes: typeof raw.bytes === 'number' ? raw.bytes : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
  }
}

function parsePart(raw: unknown, issues: EnvelopeValidationIssue[], index: number): TurnPart | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    issues.push(issue('CT-PART', `parts[${index}] is not a typed TurnPart`))
    return null
  }
  const kind = raw.kind
  if (kind === 'text') {
    const text = typeof raw.text === 'string' ? raw.text : ''
    const content_type = raw.content_type === 'text/markdown' ? 'text/markdown' : 'text/plain'
    return { kind: 'text', content_type, text }
  }
  if (kind === 'uri') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    if (!url) issues.push(issue('CT-URI', `parts[${index}] uri missing url`))
    const fetch_policy =
      raw.fetch_policy === 'BROKER_FETCH' || raw.fetch_policy === 'REFUSE' || raw.fetch_policy === 'LINK_OUT'
        ? raw.fetch_policy
        : 'LINK_OUT'
    if (!url) return null
    return { kind: 'uri', url, fetch_policy }
  }
  if (kind === 'structured') {
    const data = isRecord(raw.data) ? raw.data : {}
    return { kind: 'structured', content_type: 'application/json', data }
  }
  if (kind === 'file' || kind === 'image' || kind === 'audio' || kind === 'video') {
    const asset_ref = parseAssetRef(raw.asset_ref, issues, `parts[${index}].asset_ref`)
    if (!asset_ref) return null
    const content_type = typeof raw.content_type === 'string' && raw.content_type.trim() ? raw.content_type : asset_ref.mime
    if (kind === 'file') return { kind: 'file', content_type, asset_ref, name: typeof raw.name === 'string' ? raw.name : undefined }
    if (kind === 'image') return { kind: 'image', content_type, asset_ref, alt: typeof raw.alt === 'string' ? raw.alt : undefined }
    if (kind === 'audio') {
      return {
        kind: 'audio',
        content_type,
        asset_ref,
        duration_ms: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
      }
    }
    return {
      kind: 'video',
      content_type,
      asset_ref,
      duration_ms: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
    }
  }
  issues.push(issue('CT-KIND', `parts[${index}] unknown kind ${kind}`))
  return null
}

export function extractTurnText(envelope: Pick<CommanderTurnV1, 'text' | 'parts'>): string {
  if (typeof envelope.text === 'string' && envelope.text.trim()) return envelope.text.trim()
  const texts = envelope.parts
    .filter((part): part is Extract<TurnPart, { kind: 'text' }> => part.kind === 'text')
    .map(part => part.text.trim())
    .filter(Boolean)
  return texts.join('\n').trim()
}

export function parseCommanderTurn(input: unknown): EnvelopeValidationResult {
  const issues: EnvelopeValidationIssue[] = []
  if (!isRecord(input)) return { ok: false, issues: [issue('CT-ROOT', 'CommanderTurn must be an object')] }

  if (isForbiddenCaptureLabel(input.capture_truth) || isForbiddenCaptureLabel(input.voice && isRecord(input.voice) ? input.voice.capture_truth : undefined)) {
    issues.push(issue('CT-LISTENING', 'capture_truth must not use LISTENING/SEEING/WATCHING'))
  }

  const schema_version =
    input.schema_version === COMMANDER_TURN_SCHEMA || input.schema_version === 'v1'
      ? COMMANDER_TURN_SCHEMA
      : COMMANDER_TURN_SCHEMA
  if (input.schema_version && input.schema_version !== COMMANDER_TURN_SCHEMA && input.schema_version !== 'v1') {
    issues.push(issue('CT-SCHEMA', `unsupported schema_version ${String(input.schema_version)}`))
  }

  const turn_id = typeof input.turn_id === 'string' ? input.turn_id.trim() : ''
  const room_id = typeof input.room_id === 'string' ? input.room_id.trim() : ''
  const session_id = typeof input.session_id === 'string' ? input.session_id.trim() : ''
  if (!turn_id) issues.push(issue('CT-TURN-ID', 'turn_id required'))
  if (!room_id) issues.push(issue('CT-ROOM-ID', 'room_id required'))
  if (!session_id) issues.push(issue('CT-SESSION-ID', 'session_id required'))

  const partsRaw = Array.isArray(input.parts) ? input.parts : []
  const parts: TurnPart[] = []
  partsRaw.forEach((raw, index) => {
    const part = parsePart(raw, issues, index)
    if (part) parts.push(part)
  })

  const text = typeof input.text === 'string' ? input.text : undefined
  if (text?.trim() && !parts.some(part => part.kind === 'text')) {
    parts.unshift({ kind: 'text', content_type: 'text/plain', text })
  }
  if (parts.length === 0 && !text?.trim()) {
    issues.push(issue('CT-EMPTY', 'CommanderTurn requires text or at least one part'))
  }

  const asset_refs = collectAssetRefs(parts)
  const capture_truth = normalizeCaptureTruth(input.capture_truth, 'NOT_REQUESTED')
  const context = isRecord(input.context) ? {
    session_title: typeof input.context.session_title === 'string' ? input.context.session_title : undefined,
    active_topic: typeof input.context.active_topic === 'string' ? input.context.active_topic : undefined,
    prior_turn_ids: Array.isArray(input.context.prior_turn_ids)
      ? input.context.prior_turn_ids.filter((id): id is string => typeof id === 'string')
      : undefined,
    conversation_id: typeof input.context.conversation_id === 'string' ? input.context.conversation_id : undefined,
  } : {}

  const created_at = typeof input.created_at === 'string' && input.created_at.trim()
    ? input.created_at
    : new Date().toISOString()

  const envelope: CommanderTurnV1 = {
    schema_version,
    turn_id: turn_id || 'invalid',
    room_id: room_id || 'invalid',
    session_id: session_id || 'invalid',
    mission_id: typeof input.mission_id === 'string' && input.mission_id.trim() ? input.mission_id.trim() : undefined,
    text,
    parts,
    asset_refs,
    capture_truth,
    context,
    created_at,
  }

  if (isRecord(input.actor) && input.actor.kind === 'COMMANDER' && typeof input.actor.user_id === 'string') {
    envelope.actor = { kind: 'COMMANDER', user_id: input.actor.user_id }
  }
  if (isRecord(input.authority)) {
    envelope.authority = {
      policy_profile: typeof input.authority.policy_profile === 'string' ? input.authority.policy_profile : 'default',
      allow_side_effects: input.authority.allow_side_effects === true,
    }
  }
  if (isRecord(input.voice)) {
    envelope.voice = {
      voice_session_id: typeof input.voice.voice_session_id === 'string' ? input.voice.voice_session_id : undefined,
      capture_truth: normalizeCaptureTruth(input.voice.capture_truth, capture_truth),
    }
    envelope.capture_truth = envelope.voice.capture_truth
  }
  if (isRecord(input.correlation)) {
    envelope.correlation = {
      reply_to_turn_id: typeof input.correlation.reply_to_turn_id === 'string' ? input.correlation.reply_to_turn_id : undefined,
      thread_id: typeof input.correlation.thread_id === 'string' ? input.correlation.thread_id : undefined,
    }
  }

  if (issues.length) return { ok: false, issues }
  return { ok: true, envelope }
}

export function assertValidCommanderTurn(input: unknown): CommanderTurnV1 {
  const parsed = parseCommanderTurn(input)
  if (!parsed.ok) {
    throw new Error(parsed.issues.map(row => `${row.code}: ${row.message}`).join('; '))
  }
  return parsed.envelope
}

export function commanderTurnFromText(input: {
  text: string
  turn_id?: string
  room_id?: string
  session_id?: string
  conversation_id?: string | null
  capture_truth?: CommanderTurnV1['capture_truth']
}): CommanderTurnV1 {
  const session_id = input.session_id || input.conversation_id || 'ephemeral-session'
  return assertValidCommanderTurn({
    schema_version: COMMANDER_TURN_SCHEMA,
    turn_id: input.turn_id || `turn_${Date.now().toString(36)}`,
    room_id: input.room_id || input.conversation_id || 'council-room',
    session_id,
    text: input.text,
    parts: [{ kind: 'text', content_type: 'text/plain', text: input.text }],
    capture_truth: input.capture_truth ?? 'NOT_REQUESTED',
    context: { conversation_id: input.conversation_id ?? undefined },
    created_at: new Date().toISOString(),
  })
}
