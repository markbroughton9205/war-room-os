import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { PLANETARY_EVIDENCE_SCHEMA, PLANETARY_REGISTRY_SCHEMA } from './registrySchema'
import { PLANETARY_REGISTRY_SCHEMA_VERSION, planetaryRegistryDir, planetaryRegistrySqlitePath } from './registryPaths'
import type { EndpointActivationState, RegistryEndpoint, RegistryParentCompany, RegistryPublisher, RegistrySource } from './registryTypes'

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export class PlanetaryRegistryStore {
  readonly dbPath: string
  private readonly db: DatabaseSync

  constructor(rootDir?: string) {
    mkdirSync(planetaryRegistryDir(rootDir), { recursive: true })
    this.dbPath = planetaryRegistrySqlitePath(rootDir)
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(PLANETARY_REGISTRY_SCHEMA)
    this.ensureEndpointColumns()
    this.db.exec(PLANETARY_EVIDENCE_SCHEMA)
    this.db.exec('CREATE INDEX IF NOT EXISTS endpoints_activation_idx ON endpoints(activation_state)')
    this.db.prepare('INSERT OR REPLACE INTO registry_meta(key, value) VALUES (?, ?)').run('schema_version', String(PLANETARY_REGISTRY_SCHEMA_VERSION))
    this.db.prepare('INSERT OR REPLACE INTO registry_meta(key, value) VALUES (?, ?)').run('engine', 'node:sqlite')
    this.db.prepare('INSERT OR REPLACE INTO registry_meta(key, value) VALUES (?, ?)').run('label', 'LOCAL_SQLITE_PLANETARY_REGISTRY')
  }

  close(): void {
    this.db.close()
  }

  upsertParent(parent: RegistryParentCompany): void {
    this.db.prepare(`
      INSERT INTO parent_companies(parent_id, canonical_name, ownership_type, country, homepage, notes)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(parent_id) DO UPDATE SET
        canonical_name=excluded.canonical_name,
        ownership_type=excluded.ownership_type,
        country=excluded.country,
        homepage=excluded.homepage
    `).run(parent.parentId, parent.canonicalName, parent.ownershipType, parent.country, parent.homepage)
  }

  upsertPublisher(publisher: RegistryPublisher): void {
    this.db.prepare(`
      INSERT INTO publishers(publisher_id, canonical_name, parent_id, country, homepage)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(publisher_id) DO UPDATE SET
        canonical_name=excluded.canonical_name,
        parent_id=excluded.parent_id,
        country=excluded.country,
        homepage=excluded.homepage
    `).run(publisher.publisherId, publisher.canonicalName, publisher.parentId, publisher.country, publisher.homepage)
  }

  findSourceByDomain(domain: string): RegistrySource | null {
    const row = this.db.prepare('SELECT * FROM sources WHERE canonical_domain = ?').get(domain.toLowerCase()) as Record<string, unknown> | undefined
    return row ? this.mapSource(row) : null
  }

  upsertSource(source: RegistrySource): { inserted: boolean; duplicate: boolean } {
    const existing = this.findSourceByDomain(source.canonicalDomain)
    if (existing && existing.sourceId !== source.sourceId) {
      return { inserted: false, duplicate: true }
    }
    this.db.prepare(`
      INSERT INTO sources(
        source_id, canonical_name, aliases_json, canonical_domain, domain_aliases_json, source_type, journalism_type,
        source_role, ownership_type, publisher_id, parent_company_id, country, region, continent, state_province,
        county_district, city_locality, locality_class, hq_geography, coverage_geography, dateline_geography,
        coverage_geometry_json, administrative_areas_json, primary_language, supported_languages_json,
        requested_discovery_language, actual_query_language, topics_json, original_reporting, homepage, status,
        discovery_method, discovered_at, last_verified_at, last_healthy_at, freshness_class, robots_policy,
        terms_metadata, license_metadata, retention_policy, reliability_metadata, wire_relationship, notes,
        gap_priority, verification_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        canonical_name=excluded.canonical_name,
        source_type=excluded.source_type,
        status=excluded.status,
        last_verified_at=excluded.last_verified_at,
        last_healthy_at=excluded.last_healthy_at,
        verification_json=excluded.verification_json,
        robots_policy=excluded.robots_policy,
        retention_policy=excluded.retention_policy,
        notes=excluded.notes,
        gap_priority=excluded.gap_priority
    `).run(
      source.sourceId, source.canonicalName, json(source.aliases), source.canonicalDomain, json(source.domainAliases),
      source.sourceType, source.journalismType, source.sourceRole, source.ownershipType, source.publisherId,
      source.parentCompanyId, source.country, source.region, source.continent, source.stateProvince,
      source.countyDistrict, source.cityLocality, source.localityClass, source.hqGeography, source.coverageGeography,
      source.datelineGeography, json(source.coverageGeometry), json(source.administrativeAreas), source.primaryLanguage,
      json(source.supportedLanguages), source.requestedDiscoveryLanguage, source.actualQueryLanguage, json(source.topics),
      source.originalReportingCapability ? 1 : 0, source.homepage, source.status, source.discoveryMethod,
      source.discoveredAt, source.lastVerifiedAt, source.lastHealthyAt, source.freshnessClass, source.robotsPolicy,
      source.termsMetadata, source.licenseMetadata, source.retentionPolicy, source.reliabilityMetadata,
      source.wireRelationship, source.notes, source.gapPriority, json(source.verification),
    )
    return { inserted: !existing, duplicate: false }
  }

  upsertEndpoint(endpoint: RegistryEndpoint): void {
    this.db.prepare(`
      INSERT INTO endpoints(
        endpoint_id, source_id, endpoint_type, url, status, last_fetch_at, last_success_at, etag, last_modified,
        retry_after, observed_publish_cadence_seconds, recommended_poll_interval_seconds, error_class,
        consecutive_failures, http_status, latency_ms, activation_state, content_type, item_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint_id) DO UPDATE SET
        status=excluded.status,
        last_fetch_at=excluded.last_fetch_at,
        last_success_at=excluded.last_success_at,
        etag=excluded.etag,
        last_modified=excluded.last_modified,
        retry_after=excluded.retry_after,
        consecutive_failures=excluded.consecutive_failures,
        http_status=excluded.http_status,
        latency_ms=excluded.latency_ms,
        error_class=excluded.error_class,
        activation_state=excluded.activation_state,
        content_type=excluded.content_type,
        item_count=excluded.item_count
    `).run(
      endpoint.endpointId, endpoint.sourceId, endpoint.endpointType, endpoint.url, endpoint.status,
      endpoint.lastFetchAt, endpoint.lastSuccessAt, endpoint.etag, endpoint.lastModified, endpoint.retryAfter,
      endpoint.observedPublishCadenceSeconds, endpoint.recommendedPollIntervalSeconds, endpoint.errorClass,
      endpoint.consecutiveFailures, endpoint.httpStatus, endpoint.latencyMs,
      endpoint.activationState ?? 'DISCOVERED', endpoint.contentType ?? null, endpoint.itemCount ?? null,
    )
  }

  recordDiscovery(input: { sourceId?: string | null; method: string; queryLanguage?: string | null; requestedLanguage?: string | null; detail?: string | null; nowIso: string }): void {
    this.db.prepare('INSERT INTO discovery_events(source_id, method, query_language, requested_language, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.sourceId ?? null, input.method, input.queryLanguage ?? null, input.requestedLanguage ?? null, input.detail ?? null, input.nowIso)
  }

  recordVerification(input: { sourceId: string; stage: string; ok: boolean; detail?: string | null; nowIso: string }): void {
    this.db.prepare('INSERT INTO verification_events(source_id, stage, ok, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.sourceId, input.stage, input.ok ? 1 : 0, input.detail ?? null, input.nowIso)
  }

  recordHealth(input: { endpointId: string; httpStatus: number | null; latencyMs: number | null; etag: string | null; lastModified: string | null; errorClass: string | null; nowIso: string }): void {
    this.db.prepare('INSERT INTO health_events(endpoint_id, http_status, latency_ms, etag, last_modified, error_class, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.endpointId, input.httpStatus, input.latencyMs, input.etag, input.lastModified, input.errorClass, input.nowIso)
  }

  listSources(): RegistrySource[] {
    return (this.db.prepare('SELECT * FROM sources').all() as Record<string, unknown>[]).map(row => this.mapSource(row))
  }

  listEndpoints(): RegistryEndpoint[] {
    return (this.db.prepare('SELECT * FROM endpoints').all() as Record<string, unknown>[]).map(row => this.mapEndpoint(row))
  }

  listParents(): RegistryParentCompany[] {
    return (this.db.prepare('SELECT * FROM parent_companies').all() as Record<string, unknown>[]).map(row => ({
      parentId: String(row.parent_id),
      canonicalName: String(row.canonical_name),
      ownershipType: String(row.ownership_type),
      country: (row.country as string | null) ?? null,
      homepage: (row.homepage as string | null) ?? null,
    }))
  }

  counts(): {
    sources: number
    endpoints: number
    liveSources: number
    liveEndpoints: number
    publishers: number
    parents: number
  } {
    const sources = Number((this.db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n)
    const endpoints = Number((this.db.prepare('SELECT COUNT(*) AS n FROM endpoints').get() as { n: number }).n)
    const liveSources = Number((this.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE status = 'LIVE'").get() as { n: number }).n)
    const liveEndpoints = Number((this.db.prepare("SELECT COUNT(*) AS n FROM endpoints WHERE status IN ('OK', 'NOT_MODIFIED')").get() as { n: number }).n)
    const publishers = Number((this.db.prepare('SELECT COUNT(*) AS n FROM publishers').get() as { n: number }).n)
    const parents = Number((this.db.prepare('SELECT COUNT(*) AS n FROM parent_companies').get() as { n: number }).n)
    return { sources, endpoints, liveSources, liveEndpoints, publishers, parents }
  }

  private mapSource(row: Record<string, unknown>): RegistrySource {
    return {
      sourceId: String(row.source_id),
      canonicalName: String(row.canonical_name),
      aliases: parseJson(String(row.aliases_json ?? '[]'), []),
      canonicalDomain: String(row.canonical_domain),
      domainAliases: parseJson(String(row.domain_aliases_json ?? '[]'), []),
      sourceType: row.source_type as RegistrySource['sourceType'],
      journalismType: (row.journalism_type as string | null) ?? null,
      sourceRole: row.source_role as RegistrySource['sourceRole'],
      ownershipType: String(row.ownership_type),
      publisherId: String(row.publisher_id),
      parentCompanyId: (row.parent_company_id as string | null) ?? null,
      country: (row.country as string | null) ?? null,
      region: (row.region as RegistrySource['region']) ?? null,
      continent: (row.continent as string | null) ?? null,
      stateProvince: (row.state_province as string | null) ?? null,
      countyDistrict: (row.county_district as string | null) ?? null,
      cityLocality: (row.city_locality as string | null) ?? null,
      localityClass: row.locality_class as RegistrySource['localityClass'],
      hqGeography: (row.hq_geography as RegistrySource['hqGeography']) ?? null,
      coverageGeography: (row.coverage_geography as RegistrySource['coverageGeography']) ?? null,
      datelineGeography: (row.dateline_geography as RegistrySource['datelineGeography']) ?? null,
      coverageGeometry: parseJson(row.coverage_geometry_json as string | null, null),
      administrativeAreas: parseJson(String(row.administrative_areas_json ?? '[]'), []),
      primaryLanguage: String(row.primary_language),
      supportedLanguages: parseJson(String(row.supported_languages_json ?? '[]'), []),
      requestedDiscoveryLanguage: (row.requested_discovery_language as string | null) ?? null,
      actualQueryLanguage: (row.actual_query_language as string | null) ?? null,
      topics: parseJson(String(row.topics_json ?? '[]'), []),
      originalReportingCapability: Boolean(row.original_reporting),
      homepage: String(row.homepage),
      status: row.status as RegistrySource['status'],
      discoveryMethod: String(row.discovery_method),
      discoveredAt: String(row.discovered_at),
      lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
      lastHealthyAt: (row.last_healthy_at as string | null) ?? null,
      freshnessClass: row.freshness_class as RegistrySource['freshnessClass'],
      robotsPolicy: row.robots_policy as RegistrySource['robotsPolicy'],
      termsMetadata: (row.terms_metadata as string | null) ?? null,
      licenseMetadata: (row.license_metadata as string | null) ?? null,
      retentionPolicy: row.retention_policy as RegistrySource['retentionPolicy'],
      reliabilityMetadata: (row.reliability_metadata as string | null) ?? null,
      wireRelationship: (row.wire_relationship as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      gapPriority: (row.gap_priority as string | null) ?? null,
      verification: parseJson(String(row.verification_json ?? '{}'), {}),
    }
  }

  private mapEndpoint(row: Record<string, unknown>): RegistryEndpoint {
    return {
      endpointId: String(row.endpoint_id),
      sourceId: String(row.source_id),
      endpointType: row.endpoint_type as RegistryEndpoint['endpointType'],
      url: String(row.url),
      status: row.status as RegistryEndpoint['status'],
      lastFetchAt: (row.last_fetch_at as string | null) ?? null,
      lastSuccessAt: (row.last_success_at as string | null) ?? null,
      etag: (row.etag as string | null) ?? null,
      lastModified: (row.last_modified as string | null) ?? null,
      retryAfter: (row.retry_after as string | null) ?? null,
      observedPublishCadenceSeconds: (row.observed_publish_cadence_seconds as number | null) ?? null,
      recommendedPollIntervalSeconds: Number(row.recommended_poll_interval_seconds),
      errorClass: (row.error_class as string | null) ?? null,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      httpStatus: (row.http_status as number | null) ?? null,
      latencyMs: (row.latency_ms as number | null) ?? null,
      activationState: (row.activation_state as EndpointActivationState) || (row.endpoint_type === 'HTML' ? 'HTML_ONLY' : 'DISCOVERED'),
      contentType: (row.content_type as string | null) ?? null,
      itemCount: (row.item_count as number | null) ?? null,
    }
  }

  private ensureEndpointColumns(): void {
    const cols = new Set((this.db.prepare('PRAGMA table_info(endpoints)').all() as Array<{ name: string }>).map(row => row.name))
    if (!cols.has('activation_state')) this.db.exec("ALTER TABLE endpoints ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'DISCOVERED'")
    if (!cols.has('content_type')) this.db.exec('ALTER TABLE endpoints ADD COLUMN content_type TEXT')
    if (!cols.has('item_count')) this.db.exec('ALTER TABLE endpoints ADD COLUMN item_count INTEGER')
  }

  upsertMission(input: { missionId: string; commanderIntent: string; complexity: string; protocol: string; createdAt: string; payload?: unknown }): void {
    this.db.prepare(`
      INSERT INTO missions(mission_id, commander_intent, complexity, protocol, created_at, mission_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET mission_json=excluded.mission_json
    `).run(input.missionId, input.commanderIntent, input.complexity, input.protocol, input.createdAt, json(input.payload ?? {}))
  }

  upsertDocument(doc: {
    documentId: string
    missionId?: string | null
    sourceId?: string | null
    endpointId?: string | null
    canonicalUrl: string
    url: string
    title: string | null
    publisher: string | null
    outlet: string | null
    parentCompany: string | null
    publishedAt: string | null
    retrievedAt: string
    originalLanguage: string | null
    detectedLanguage: string | null
    languageConfidence: number | null
    requestedLanguage: string | null
    queryLanguage: string | null
    translationLanguage: string | null
    evidenceLanguageMatch: boolean | null
    eventGeography: string | null
    sourceGeography: string | null
    sourceLocality: string | null
    taskGeography: string | null
    topic: string | null
    sourceClass: string | null
    evidenceClass: string | null
    contentHash: string | null
    simhash: string | null
    storyOriginId: string | null
    independentOriginId: string | null
    retentionMode: string
    originalText: string | null
    byline: string | null
    wireAttribution: string | null
    payload?: unknown
  }): { inserted: boolean; duplicate: boolean } {
    const existing = this.db.prepare('SELECT document_id FROM documents WHERE canonical_url = ?').get(doc.canonicalUrl) as { document_id?: string } | undefined
    if (existing?.document_id && existing.document_id !== doc.documentId) return { inserted: false, duplicate: true }
    this.db.prepare(`
      INSERT INTO documents(
        document_id, mission_id, source_id, endpoint_id, canonical_url, url, title, publisher, outlet, parent_company,
        published_at, retrieved_at, original_language, detected_language, language_confidence, requested_language,
        query_language, translation_language, evidence_language_match, event_geography, source_geography, source_locality,
        task_geography, topic, source_class, evidence_class, content_hash, simhash, story_origin_id, independent_origin_id,
        retention_mode, original_text, byline, wire_attribution, document_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        title=excluded.title,
        retrieved_at=excluded.retrieved_at,
        detected_language=excluded.detected_language,
        original_language=excluded.original_language,
        language_confidence=excluded.language_confidence,
        evidence_language_match=excluded.evidence_language_match,
        requested_language=excluded.requested_language,
        query_language=excluded.query_language,
        topic=excluded.topic,
        source_class=excluded.source_class,
        evidence_class=excluded.evidence_class,
        published_at=excluded.published_at,
        document_json=excluded.document_json
    `).run(
      doc.documentId, doc.missionId ?? null, doc.sourceId ?? null, doc.endpointId ?? null, doc.canonicalUrl, doc.url,
      doc.title, doc.publisher, doc.outlet, doc.parentCompany, doc.publishedAt, doc.retrievedAt, doc.originalLanguage,
      doc.detectedLanguage, doc.languageConfidence, doc.requestedLanguage, doc.queryLanguage, doc.translationLanguage,
      doc.evidenceLanguageMatch == null ? null : doc.evidenceLanguageMatch ? 1 : 0, doc.eventGeography, doc.sourceGeography,
      doc.sourceLocality, doc.taskGeography, doc.topic, doc.sourceClass, doc.evidenceClass, doc.contentHash, doc.simhash,
      doc.storyOriginId, doc.independentOriginId, doc.retentionMode, doc.originalText, doc.byline, doc.wireAttribution, json(doc.payload ?? {}),
    )
    return { inserted: !existing, duplicate: false }
  }

  listDocuments(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM documents').all() as Record<string, unknown>[]
  }

  upsertStoryCluster(input: {
    storyClusterId: string
    syndicationClusterId: string
    canonicalStoryOrigin: string
    independentOriginId: string
    originConfidence: number
    originMethod: string
    memberDocumentIds: string[]
    createdAt: string
  }): void {
    this.db.prepare(`
      INSERT INTO story_clusters(story_cluster_id, syndication_cluster_id, canonical_story_origin, independent_origin_id, origin_confidence, origin_method, member_document_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(story_cluster_id) DO UPDATE SET member_document_ids_json=excluded.member_document_ids_json
    `).run(input.storyClusterId, input.syndicationClusterId, input.canonicalStoryOrigin, input.independentOriginId, input.originConfidence, input.originMethod, json(input.memberDocumentIds), input.createdAt)
  }

  listStoryClusters(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM story_clusters').all() as Record<string, unknown>[]
  }

  upsertGapResearch(input: Record<string, unknown> & { gapId: string; coverageCell: string; researchPrompt: string; createdAt: string }): void {
    this.db.prepare(`
      INSERT INTO gap_research(
        gap_id, coverage_cell, research_prompt, requested_language, actual_query_language, target_geography, target_topic,
        target_source_class, target_locality, target_evidence_class, excluded_json, fallback_level, candidate_sources_json,
        qualifying_sources_json, candidate_documents_json, qualifying_documents_json, rejected_documents_json,
        rejection_reasons_json, independent_origins, coverage_before, coverage_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gap_id) DO UPDATE SET coverage_after=excluded.coverage_after, independent_origins=excluded.independent_origins
    `).run(
      input.gapId, input.coverageCell, input.researchPrompt, input.requestedLanguage ?? null, input.actualQueryLanguage ?? null,
      input.targetGeography ?? null, input.targetTopic ?? null, input.targetSourceClass ?? null, input.targetLocality ?? null,
      input.targetEvidenceClass ?? null, json(input.excluded ?? []), Number(input.fallbackLevel ?? 0), json(input.candidateSources ?? []),
      json(input.qualifyingSources ?? []), json(input.candidateDocuments ?? []), json(input.qualifyingDocuments ?? []),
      json(input.rejectedDocuments ?? []), json(input.rejectionReasons ?? []), Number(input.independentOrigins ?? 0),
      String(input.coverageBefore ?? ''), String(input.coverageAfter ?? ''), input.createdAt,
    )
  }

  listGapResearch(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM gap_research').all() as Record<string, unknown>[]
  }

  upsertCoverageCell(input: { cellId: string; missionId?: string | null; geography: string; topic: string; language: string; sourceType: string; timeWindow: string; evidenceQuality: string; claims: number; independentOrigins: number; status: string; payload: unknown; createdAt: string }): void {
    this.db.prepare(`
      INSERT INTO coverage_cells(cell_id, mission_id, geography, topic, language, source_type, time_window, evidence_quality, claims, independent_origins, status, cell_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cell_id) DO UPDATE SET status=excluded.status, claims=excluded.claims, independent_origins=excluded.independent_origins, cell_json=excluded.cell_json
    `).run(input.cellId, input.missionId ?? null, input.geography, input.topic, input.language, input.sourceType, input.timeWindow, input.evidenceQuality, input.claims, input.independentOrigins, input.status, json(input.payload), input.createdAt)
  }
}
