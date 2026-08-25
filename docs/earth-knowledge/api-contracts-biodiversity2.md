# API contracts — biodiversity batch 2 (iNaturalist, OBIS, WoRMS, ITIS)

Researched via live JSON fetches against actual endpoints. Feeds directly into new `lib/research-engine/providers/*.ts` adapters.

## 1. iNaturalist API

- Host to allowlist: `api.inaturalist.org`
- Endpoint: `GET /v1/observations?taxon_name={name}&per_page={n}` (v1 is the long-documented, stable, widely-used endpoint; a v2 exists at `/v2/` with a different response envelope but v1 remains fully supported and is the one confirmed live below — recommend v1 for adapter stability)
- Required params: none strictly required to hit the endpoint; `taxon_name` (scientific name) is the useful search filter; optional `per_page` (max 200, default 30), `page`
- Auth: **none required**, fully public read access (write endpoints need OAuth, not used here)
- Response format: JSON. Confirmed live top-level: `total_results`, `page`, `per_page`, `results[]`. Per result: `id` (stable numeric observation ID), `taxon.name` (scientific name), `taxon.id`, `observed_on` (date), `time_observed_at` (ISO datetime), `uri` (canonical URL, e.g. `https://www.inaturalist.org/observations/393957654`), `location` (lat,lon string), `place_guess`, `quality_grade` (`research`/`needs_id`/`casual`), `license_code`, `user.login`, `species_guess`.
- Rate limit: recommended ~1 req/s (60/min), hard throttle around 100/min; documented daily guidance ~10,000/day. Recommend a descriptive User-Agent per their "API Recommended Practices" page; HTTP 429 on excess.
- Example confirmed live: `GET https://api.inaturalist.org/v1/observations?taxon_name=Puma%20concolor&per_page=2` → id `393957654`, taxon.name "Puma concolor", uri `https://www.inaturalist.org/observations/393957654`, quality_grade "needs_id".

## 2. OBIS REST API v3

- Host to allowlist: `api.obis.org`
- Endpoint: `GET /v3/occurrence?scientificname={name}&size={n}`
- Required params: none strictly required; `scientificname` is the useful filter; optional `size` (page size), `geometry`, `startdate`/`enddate`
- Auth: **none required**, fully public
- Response format: JSON. Confirmed live top-level: `total`, `results[]`. Per result: `id` (stable UUID, e.g. `00042a5b-d420-450d-ba01-8a59bcfc6d4f`), `scientificName`, `vernacularName`, `decimalLatitude`, `decimalLongitude`, `eventDate` (ISO datetime), `occurrenceID`, `datasetID`, `datasetName`, `institutionCode`, `basisOfRecord`, `locality`, `waterBody`, `date_year`. No canonical URL field returned directly — OBIS's documented public record-page pattern is `https://obis.org/occurrence/{id}` (not independently re-confirmed live this pass, but this is OBIS's stable documented URL scheme).
- Rate limit: no strict published numeric cap; a descriptive User-Agent is good etiquette (GBIF-adjacent infrastructure, similar norms to the already-implemented `gbif` adapter).
- Example confirmed live: `GET https://api.obis.org/v3/occurrence?scientificname=Orcinus%20orca&size=2` → id `00042a5b-d420-450d-ba01-8a59bcfc6d4f`, scientificName "Orcinus orca", eventDate `2025-06-30T11:01:16`.

## 3. WoRMS REST API (Aphia)

- Host to allowlist: `www.marinespecies.org`
- Endpoint: `GET /rest/AphiaRecordsByName/{name}?like=false&marine_only=true`
- Required params: name is a path segment; `like` (exact vs fuzzy match, bool) and `marine_only` (bool) are the two documented query flags, both optional (defaults exist) but worth setting explicitly
- Auth: **none required**, fully public
- Response format: JSON array. Confirmed live fields per record: `AphiaID` (stable numeric ID), `scientificname`, `authority`, `status` (`accepted`/etc.), `rank`, `valid_name`, `valid_AphiaID`, `kingdom`/`phylum`/`class`/`order`/`family`/`genus`, `lsid` (LSID URI), `url` (canonical URL, e.g. `https://www.marinespecies.org/aphia.php?p=taxdetails&id=137102`), `modified` (ISO datetime), `isMarine`/`isBrackish`/`isFreshwater`/`isTerrestrial` (habitat flags, 1/0/null).
- Rate limit: no strict published numeric cap; WoRMS documents itself as a research infrastructure — reasonable-use etiquette expected, descriptive User-Agent recommended.
- Example confirmed live: `GET https://www.marinespecies.org/rest/AphiaRecordsByName/Orcinus%20orca?like=false&marine_only=true` → AphiaID `137102`, scientificname "Orcinus orca", url `https://www.marinespecies.org/aphia.php?p=taxdetails&id=137102`, modified `2008-08-20T11:25:36.853Z`.
- Note: a request with zero matches returns `[]` cleanly (standard REST array), or `-999`/`null` for certain malformed-name edge cases per WoRMS docs — worth explicit non-array/sentinel-value handling in the parser (fail closed, don't fabricate an empty success on an unexpected sentinel).

## 4. ITIS Web Services

- Host to allowlist: `www.itis.gov`
- Endpoint: `GET /ITISWebService/jsonservice/searchByScientificName?srchKey={name}` — confirmed this is genuinely JSON (not SOAP) despite the base SOAP-service branding; the `jsonservice` path prefix returns clean JSON.
- Required params: `srchKey` (scientific name)
- Auth: **none required**, fully public (US federal government service)
- Response format: JSON. Confirmed live envelope: `{ class: "...SvcScientificNameList", scientificNames: [...] }`. Per record: `tsn` (Taxonomic Serial Number — stable numeric ID), `combinedName` (full scientific name), `unitName1`/`unitName2`/`unitName3`/`unitName4` (genus/species/subspecies/variety name parts), `author`, `kingdom`. No canonical URL field returned directly — ITIS's documented stable record-page pattern is `https://www.itis.gov/servlet/SingleRpt/SingleRpt?search_topic=TSN&search_value={tsn}` (not independently re-confirmed live this pass, but this is ITIS's long-stable documented URL scheme).
- Rate limit: no strict published numeric cap (US federal service); standard fair-use expected, no key required.
- Example confirmed live: `GET https://www.itis.gov/ITISWebService/jsonservice/searchByScientificName?srchKey=Ursus%20americanus` → tsn `180544`, combinedName "Ursus americanus", author "Pallas, 1780", kingdom "Animalia".

## Flags / things to verify before shipping

- **iNaturalist**: v1 vs v2 — this pass used and confirmed v1 (`api.inaturalist.org/v1/observations`), which remains the stable, most broadly documented endpoint. A v2 exists with a different envelope; not evaluated this pass. Recommend building against v1.
- **OBIS / ITIS canonical URL patterns** (`obis.org/occurrence/{id}`, `itis.gov/servlet/SingleRpt/...`) are each API's own long-documented stable scheme but were not independently re-confirmed via a live fetch this pass (only the raw API JSON was fetched, not the human-facing record pages) — low risk, but worth a quick sanity check before shipping if canonical-URL correctness matters for a given use case.
- **WoRMS**: confirm the parser fails closed (not a fabricated empty success) on WoRMS's documented sentinel-value edge cases for malformed/ambiguous name queries, not just the empty-array case.

All 4 sources: no required credentials, no commercial gating, no external blockers. All are genuinely public REST/JSON APIs suitable for `LIVE_IMPLEMENTED` status once adapters + the existing live-verification harness cover them.
