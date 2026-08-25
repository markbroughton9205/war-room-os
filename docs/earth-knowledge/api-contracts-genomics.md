# API contracts — genomics/proteomics batch (Checkpoint 2: biomedical/genetics)

All 4 confirmed live via direct unauthenticated curl during this research pass (real field names below, not just docs).

## 1. Ensembl REST API

- Host to allowlist: `rest.ensembl.org`
- Endpoint: `GET /lookup/symbol/{species}/{symbol}?content-type=application/json` (gene lookup by symbol, e.g. species=`homo_sapiens`, symbol=`BRCA2`)
- Auth: **none**. Public, unauthenticated.
- Response fields (confirmed live): `id` (stable Ensembl gene ID, e.g. `ENSG00000139618`), `display_name`, `description`, `biotype`, `species`, `assembly_name`, `seq_region_name` (chromosome), `start`, `end`, `strand`, `canonical_transcript`, `object_type`, `source`.
- Canonical URL pattern: `https://www.ensembl.org/{species}/Gene/Summary?g={id}`.
- Rate limit: documented ~15 requests/second per IP (55,000/hour), no key required; `Content-Type: application/json` via `content-type` query param or `Accept` header.
- Example confirmed live: `GET https://rest.ensembl.org/lookup/symbol/homo_sapiens/BRCA2?content-type=application/json` → `id: "ENSG00000139618"`, `display_name: "BRCA2"`, `seq_region_name: "13"`.

## 2. RCSB PDB Search + Data API

- Hosts to allowlist: `search.rcsb.org` (query), `data.rcsb.org` (record detail)
- Search endpoint: `POST https://search.rcsb.org/rcsbsearch/v2/query`, JSON body `{"query":{"type":"terminal","service":"full_text","parameters":{"value":"<text>"}},"return_type":"entry","request_options":{"paginate":{"start":0,"rows":N}}}`. Response: `{query_id, result_type, total_count, result_set: [{identifier, score}]}` — identifiers only, no metadata (a second call is needed for detail).
- Detail endpoint: `GET https://data.rcsb.org/rest/v1/core/entry/{pdbId}` (4-char PDB ID, e.g. `4HHB`). Response fields (confirmed live): `rcsb_id` (stable ID), `struct.title` (human title), `rcsb_accession_info.initial_release_date`, `rcsb_primary_citation`/`citation[]` (with `pdbx_database_id_PubMed`, `pdbx_database_id_DOI`), `audit_author[]` (names).
- Auth: **none**. Public, unauthenticated, both endpoints.
- Canonical URL: `https://www.rcsb.org/structure/{pdbId}`.
- Rate limit: no strict published numeric cap for reasonable use; a descriptive User-Agent is good etiquette.
- Example confirmed live: search `hemoglobin` → `total_count: 9140`, top result `3GOU`; detail `GET .../entry/4HHB` → `struct.title: "THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN AT 1.74 ANGSTROMS RESOLUTION"`.

## 3. STRING API (protein-protein interactions)

- Host to allowlist: `string-db.org`
- Two-step lookup (STRING's own recommended pattern — a free-text gene symbol is ambiguous across species/paralogs):
  1. `GET /api/json/get_string_ids?identifiers={symbol}&species={ncbiTaxonId}` → resolves to a canonical `stringId` (confirmed live: `TP53`+`9606` → `stringId: "9606.ENSP00000269305"`, plus `preferredName`, `annotation` (a text description), `taxonName`).
  2. `GET /api/json/interaction_partners?identifiers={stringId}&species={ncbiTaxonId}&limit=N` → array of `{stringId_A, stringId_B, preferredName_A, preferredName_B, ncbiTaxonId, score, nscore, fscore, pscore, ascore, escore, dscore, tscore}` (`score` = combined confidence 0-1).
- Auth: **none**. Public. STRING's docs ask callers to send a `caller_identity` query param (a descriptive app name) for etiquette/rate-limit fairness — not a secret, optional.
- Canonical URL: `https://string-db.org/network/{stringId}`.
- Rate limit: not strictly published; STRING documents that heavy/automated use should go through their local mirror/download instead — treat this adapter as bounded, single-gene lookups only, not bulk network export.
- Species param: NCBI taxonomy ID (human = 9606) — required for disambiguation.

## 4. gnomAD GraphQL API (population genetics)

- Host to allowlist: `gnomad.broadinstitute.org`
- Endpoint: `POST /api`, GraphQL body, e.g. `{"query":"query { gene(gene_symbol: \"TP53\", reference_genome: GRCh38) { gene_id symbol chrom start stop } }"}`.
- Auth: **none**. Public, unauthenticated.
- Response (confirmed live): `{"data":{"gene":{"gene_id":"ENSG00000141510","symbol":"TP53","chrom":"17","start":7661779,"stop":7687538}}}`. A gene query can also request nested `variants { variant_id, pos, ref, alt, consequence }` for population-frequency data — not fetched in this test pass to keep the confirmed contract minimal, but documented as available.
- Canonical URL: `https://gnomad.broadinstitute.org/gene/{gene_id}`.
- Rate limit: no formal published numeric cap; gnomAD asks for reasonable, non-bulk use via the public API (bulk users are directed to their Hail/BigQuery datasets instead).
- Note: this is a real GraphQL schema (introspectable) — an adapter should send a small, fixed query shape (gene lookup by symbol) rather than exposing arbitrary caller-supplied GraphQL, matching this codebase's "no arbitrary query passthrough" convention already used for `wikidata` (no arbitrary SPARQL).

## Summary

All 4 sources: no required credentials, no commercial gating, all confirmed live and working via direct unauthenticated HTTP during this research pass. RCSB requires two calls (search → detail) for a fully useful result; STRING requires two calls (resolve → interaction_partners) for the same reason — both are real API-shape constraints, not integration gaps, and match the existing codebase precedent (e.g. `usgs_sciencebase` and `ncbi` also compose multiple upstream calls behind one `run()`).
