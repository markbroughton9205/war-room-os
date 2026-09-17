export const PLANETARY_REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS registry_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parent_companies (
  parent_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  ownership_type TEXT NOT NULL,
  country TEXT,
  homepage TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS publishers (
  publisher_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  parent_id TEXT,
  country TEXT,
  homepage TEXT,
  UNIQUE(canonical_name, country),
  FOREIGN KEY(parent_id) REFERENCES parent_companies(parent_id)
);

CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  canonical_domain TEXT NOT NULL UNIQUE,
  domain_aliases_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL,
  journalism_type TEXT,
  source_role TEXT NOT NULL,
  ownership_type TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  parent_company_id TEXT,
  country TEXT,
  region TEXT,
  continent TEXT,
  state_province TEXT,
  county_district TEXT,
  city_locality TEXT,
  locality_class TEXT NOT NULL,
  hq_geography TEXT,
  coverage_geography TEXT,
  dateline_geography TEXT,
  coverage_geometry_json TEXT,
  administrative_areas_json TEXT NOT NULL DEFAULT '[]',
  primary_language TEXT NOT NULL,
  supported_languages_json TEXT NOT NULL DEFAULT '[]',
  requested_discovery_language TEXT,
  actual_query_language TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  original_reporting INTEGER NOT NULL DEFAULT 0,
  homepage TEXT NOT NULL,
  status TEXT NOT NULL,
  discovery_method TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  last_verified_at TEXT,
  last_healthy_at TEXT,
  freshness_class TEXT NOT NULL,
  robots_policy TEXT NOT NULL DEFAULT 'UNKNOWN',
  terms_metadata TEXT,
  license_metadata TEXT,
  retention_policy TEXT NOT NULL DEFAULT 'METADATA_ONLY',
  reliability_metadata TEXT,
  wire_relationship TEXT,
  notes TEXT,
  gap_priority TEXT,
  verification_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(publisher_id) REFERENCES publishers(publisher_id),
  FOREIGN KEY(parent_company_id) REFERENCES parent_companies(parent_id)
);

CREATE INDEX IF NOT EXISTS sources_region_idx ON sources(region);
CREATE INDEX IF NOT EXISTS sources_language_idx ON sources(primary_language);
CREATE INDEX IF NOT EXISTS sources_status_idx ON sources(status);
CREATE INDEX IF NOT EXISTS sources_locality_idx ON sources(locality_class);
CREATE INDEX IF NOT EXISTS sources_parent_idx ON sources(parent_company_id);

CREATE TABLE IF NOT EXISTS endpoints (
  endpoint_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  endpoint_type TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IDLE',
  last_fetch_at TEXT,
  last_success_at TEXT,
  etag TEXT,
  last_modified TEXT,
  retry_after TEXT,
  observed_publish_cadence_seconds INTEGER,
  recommended_poll_interval_seconds INTEGER NOT NULL,
  error_class TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  latency_ms INTEGER,
  activation_state TEXT NOT NULL DEFAULT 'DISCOVERED',
  content_type TEXT,
  item_count INTEGER,
  UNIQUE(source_id, url),
  FOREIGN KEY(source_id) REFERENCES sources(source_id)
);

CREATE INDEX IF NOT EXISTS endpoints_source_idx ON endpoints(source_id);

CREATE TABLE IF NOT EXISTS discovery_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT,
  method TEXT NOT NULL,
  query_language TEXT,
  requested_language TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  http_status INTEGER,
  latency_ms INTEGER,
  etag TEXT,
  last_modified TEXT,
  error_class TEXT,
  created_at TEXT NOT NULL
);
`

export const PLANETARY_EVIDENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS missions (
  mission_id TEXT PRIMARY KEY,
  commander_intent TEXT NOT NULL,
  complexity TEXT NOT NULL,
  protocol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mission_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT,
  seat TEXT,
  query TEXT,
  requested_language TEXT,
  query_language TEXT,
  target_geography TEXT,
  target_topic TEXT,
  target_source_class TEXT,
  target_locality TEXT,
  fallback_level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  task_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS lane_packets (
  lane_id TEXT PRIMARY KEY,
  mission_id TEXT,
  task_id TEXT,
  seat TEXT,
  packet_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 1,
  packet_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  mission_id TEXT,
  source_id TEXT,
  endpoint_id TEXT,
  canonical_url TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  outlet TEXT,
  parent_company TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  original_language TEXT,
  detected_language TEXT,
  language_confidence REAL,
  requested_language TEXT,
  query_language TEXT,
  translation_language TEXT,
  evidence_language_match INTEGER,
  event_geography TEXT,
  source_geography TEXT,
  source_locality TEXT,
  task_geography TEXT,
  topic TEXT,
  source_class TEXT,
  evidence_class TEXT,
  content_hash TEXT,
  simhash TEXT,
  story_origin_id TEXT,
  independent_origin_id TEXT,
  retention_mode TEXT NOT NULL DEFAULT 'METADATA_ONLY',
  original_text TEXT,
  byline TEXT,
  wire_attribution TEXT,
  document_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(canonical_url)
);

CREATE INDEX IF NOT EXISTS documents_origin_idx ON documents(independent_origin_id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents(source_id);
CREATE INDEX IF NOT EXISTS documents_language_idx ON documents(detected_language);

CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  mission_id TEXT,
  lane_id TEXT,
  agent TEXT,
  normalized_claim TEXT NOT NULL,
  original_claim TEXT NOT NULL,
  original_language TEXT,
  topic TEXT,
  geography TEXT,
  event_time TEXT,
  confidence REAL NOT NULL DEFAULT 0.4,
  verification_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
  story_cluster_id TEXT,
  independent_origin_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_edges (
  edge_id TEXT PRIMARY KEY,
  mission_id TEXT,
  claim_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  origin_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_clusters (
  story_cluster_id TEXT PRIMARY KEY,
  syndication_cluster_id TEXT NOT NULL,
  canonical_story_origin TEXT NOT NULL,
  independent_origin_id TEXT NOT NULL,
  origin_confidence REAL NOT NULL,
  origin_method TEXT NOT NULL,
  member_document_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coverage_cells (
  cell_id TEXT PRIMARY KEY,
  mission_id TEXT,
  geography TEXT NOT NULL,
  topic TEXT NOT NULL,
  language TEXT NOT NULL,
  source_type TEXT NOT NULL,
  time_window TEXT NOT NULL,
  evidence_quality TEXT NOT NULL,
  claims INTEGER NOT NULL DEFAULT 0,
  independent_origins INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  cell_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gap_research (
  gap_id TEXT PRIMARY KEY,
  coverage_cell TEXT NOT NULL,
  research_prompt TEXT NOT NULL,
  requested_language TEXT,
  actual_query_language TEXT,
  target_geography TEXT,
  target_topic TEXT,
  target_source_class TEXT,
  target_locality TEXT,
  target_evidence_class TEXT,
  excluded_json TEXT NOT NULL DEFAULT '[]',
  fallback_level INTEGER NOT NULL DEFAULT 0,
  candidate_sources_json TEXT NOT NULL DEFAULT '[]',
  qualifying_sources_json TEXT NOT NULL DEFAULT '[]',
  candidate_documents_json TEXT NOT NULL DEFAULT '[]',
  qualifying_documents_json TEXT NOT NULL DEFAULT '[]',
  rejected_documents_json TEXT NOT NULL DEFAULT '[]',
  rejection_reasons_json TEXT NOT NULL DEFAULT '[]',
  independent_origins INTEGER NOT NULL DEFAULT 0,
  coverage_before TEXT,
  coverage_after TEXT,
  created_at TEXT NOT NULL
);
`

export const SQLITE_EVIDENCE_LEDGER_DECISION = {
  sufficient: true as const,
  target: 'LOCAL_SQLITE_PLANETARY_REGISTRY' as const,
  adaptedFrom: 'phase59a-semantics-not-postgres-ddl',
  notASecondStack: true as const,
  hostedSupabase: false as const,
  blocker: null,
  notes: 'SQLite supports missions/tasks/packets/documents/claims/edges/clusters/coverage_cells as TEXT JSON. PostgreSQL arrays, jsonb operators, RLS, and PostGIS are not required for P0/P1 evidence semantics.',
}
