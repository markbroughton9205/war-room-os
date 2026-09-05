import { createHash } from 'node:crypto'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { SourceRecord, SourceVersion } from './types'

/** Matches lib/research-engine/core/types.ts's ResearchDocument shape (imported loosely as
 * `unknown`-safe fields here to avoid a hard dependency direction from world-learning back into
 * research-engine's full type surface — only the fields actually used are declared). */
export type ResearchDocumentLike = {
  id: string
  provider: string
  providerRecordId: string | null
  title: string
  summary: string | null
  contentSnippet: string | null
  canonicalUrl: string | null
  sourceUrl: string | null
  sourceName: string
  contentType: string
  organization: string | null
  language: string | null
  license: string | null
  retrievedAt: string
  provenance: { sourceUrl: string; retrievedAt: string; isHistorical: boolean }
}

function contentHashFor(document: ResearchDocumentLike): string {
  const basis = `${document.title}\n${document.summary ?? ''}\n${document.contentSnippet ?? ''}`
  return createHash('sha256').update(basis).digest('hex')
}

/**
 * Registers a Research Engine result as a SourceRecord + SourceVersion, without changing
 * Research Engine itself (Phase 12) — this is a consumer, not a parallel research stack. Upserts
 * by canonical_uri: a source seen before gets a new SourceVersion only when content actually
 * changed (content_hash differs); otherwise the existing version's row is returned untouched, so
 * repeated research on a stable source never creates duplicate versions.
 */
export async function registerResearchDocumentAsSource(
  document: ResearchDocumentLike,
): Promise<{ source: SourceRecord; version: SourceVersion; isNewVersion: boolean } | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null

  const canonicalUri = document.canonicalUrl ?? document.sourceUrl ?? null
  const contentHash = contentHashFor(document)

  let source: SourceRecord | null = null
  if (canonicalUri) {
    const { data } = await sup.client
      .from('war_room_source_records')
      .select('*')
      .eq('canonical_uri', canonicalUri)
      .maybeSingle()
    source = (data as SourceRecord | null) ?? null
  }

  if (!source) {
    const { data: created, error } = await sup.client
      .from('war_room_source_records')
      .insert({
        canonical_uri: canonicalUri,
        source_type: 'web',
        title: document.title,
        publisher: document.organization,
        language: document.language,
        media_type: document.contentType || 'text',
        first_acquired_at: document.retrievedAt,
        last_checked_at: document.retrievedAt,
        content_hash: contentHash,
        access_method: document.provider,
        provenance: {
          provider: document.provider,
          providerRecordId: document.providerRecordId,
          sourceUrl: document.provenance.sourceUrl,
          isHistorical: document.provenance.isHistorical,
        },
        rights_metadata: document.license ? { license: document.license } : {},
      })
      .select('*')
      .single()
    if (error || !created) return null
    source = created as SourceRecord
  } else {
    await sup.client
      .from('war_room_source_records')
      .update({ last_checked_at: document.retrievedAt, content_hash: contentHash })
      .eq('id', source.id)
  }

  // Dedupe naturally via the (source_id, content_hash) unique index — an unchanged source
  // re-registered later just returns its existing version row instead of erroring.
  const { data: existingVersion } = await sup.client
    .from('war_room_source_versions')
    .select('*')
    .eq('source_id', source.id)
    .eq('content_hash', contentHash)
    .maybeSingle()

  if (existingVersion) {
    return { source, version: existingVersion as SourceVersion, isNewVersion: false }
  }

  const { data: latestVersion } = await sup.client
    .from('war_room_source_versions')
    .select('id')
    .eq('source_id', source.id)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: newVersion, error: versionError } = await sup.client
    .from('war_room_source_versions')
    .insert({
      source_id: source.id,
      observed_at: document.retrievedAt,
      content_hash: contentHash,
      previous_version_id: latestVersion?.id ?? null,
      change_type: latestVersion ? 'updated' : 'initial',
      content_snippet: document.summary ?? document.contentSnippet ?? null,
      extraction_version: 'wave2-passthrough-v1',
    })
    .select('*')
    .single()

  if (versionError || !newVersion) return null
  return { source, version: newVersion as SourceVersion, isNewVersion: true }
}
