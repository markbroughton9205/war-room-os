# AFRICA REGISTRY RECONCILIATION LEDGER

**Source document:** `docs/research/source-registries/war_room_africa_api_registry.md`
**SHA-256 (source, verified byte-identical to ZIP member):** `fe6ace3773ac5622e79e09c3172587424bdb77b4e1e0205ab275f892cbae4244`
**Source size / lines:** 107,009 bytes / 710 lines
**Compared against:** `docs/research/earth-knowledge/earth_knowledge_source_registry.md` (956,891 bytes / 4,371 lines, "EARTH KNOWLEDGE SOURCE REGISTRY")
**Compiled:** 2026-08-11. Classification only — no providers implemented, no files modified except this one.

---

## 0. Methodology note — the master registry's own stated design

The master Earth Knowledge registry **explicitly excludes Africa-specific content by design**, deferring to this Africa registry as a companion document rather than duplicating it. Direct quotes found during this reconciliation:

- Line 8: *"**Companion registry:** African-focused sources live in the separate verified registry `war_room_africa_api_registry.md` (~110 sources). This registry cross-references rather than duplicates them."*
- Line 1465 (Category 14, Government & Law): *"Africa: intentionally skipped per mission (prior registry)..."*
- Line 1827 (Category 18, Maps/GIS): *"Africa: no operational African national mapping/EO API identified... rely on OSM/Overture/Copernicus."*
- Line 3110: *"Africa is covered by the separate Africa registry (`.../war_room_africa_api_registry.md`) and is cross-referenced, not duplicated."*
- Line 3743: *"Africa: covered by the separate Africa registry — cross-ref... Not duplicated here."*
- Line 3847 (regional gap table): *"**Africa** | Covered by separate Africa registry..."*
- Multiple field-34 ("similar/overlapping sources") entries read `"OpenAlex/Crossref/S2 (registered elsewhere)"` — i.e. the master registry's own authors treat these as documented in this Africa registry, not here.

**Practical consequence:** of the 133 individually-documented sources in the Africa registry, only **13 have a genuine independent detail block in the master registry** (confirmed by direct heading/field-block search, not just passing text mentions). Everything else is uniquely documented in the Africa registry. This is the expected and intended outcome of the two-registry design, not an integration gap.

**Confirmed genuine overlaps (full detail block exists in both registries):**

| Source | Master registry location |
|---|---|
| Wikidata (SPARQL) | Category 01, item #1 |
| DBpedia (SPARQL) | Category 01, item #5 |
| GeoNames | Category 01 item #28 (cross-ref) + Category 18 item #4 (full) |
| OpenStreetMap Overpass API | Category 18, item #1 |
| Natural Earth | Category 18, item #5 |
| NASA Earthdata CMR | Category 18, item #10 (marked "cross-ref: registered") |
| UN SDG Global Database API | Category 23, item #3 |
| GBIF | Category 10, item #1 |
| eBird API 2.0 | Category 10, item #3 |
| Pleiades Gazetteer | Category 12/13 (nightly-dumps block) |
| arXiv APIs | Category 16, item #1 |
| Internet Archive | Category 01, item #12 — master explicitly notes "full detail; cross-ref Africa registry general listing" (master owns the broader/global block) |
| Qatar Digital Library | Category 13 — full Qatar Digital Library detail block (Category 25 item #41 — Africa-registry cross-reference) — master's own block says "cross-ref Africa registry" |

All other sources below are classified **UNIQUE_TO_AFRICA_REGISTRY** relative to the master registry unless otherwise noted (discontinued/negative-finding sources, or sources where a *different* master entry serves an adjacent-but-non-identical purpose, are called out individually).

---

## 0.1 Research Engine provider cross-reference (Phase 7, read-only)

Files inspected (not modified): `lib/research-engine/providers/registry.ts`, `lib/research-engine/core/types.ts`, and the `lib/research-engine/providers/*.ts` adapter files. `providerEnv.ts`, `hostAllowlist.ts`, routing, and all adapters were read-only — **no code was changed.**

`IMPLEMENTED_PROVIDER_ADAPTERS` in `registry.ts` currently contains 22 working adapters: `github, arxiv, crossref, fred, world_bank_indicators, usgs_earthquake, wikidata, ncbi, exa, library_of_congress, nasa_gibs, usgs_water, usgs_earthquake_feed, usgs_sciencebase, semantic_scholar, courtlistener, internet_archive, wayback, common_crawl, sam_gov, nasa, fmcsa`.

**Africa-registry sources that already have a working War Room provider (7):**

| Africa registry source | Provider id | Notes |
|---|---|---|
| World Bank Open Data API (6.1) | `world_bank_indicators` | Direct match |
| Wikidata SPARQL (KG) | `wikidata` | Direct match |
| Library of Congress — Mali mss (3.9) / Maps (7.3) / WPA narratives (9.5) | `library_of_congress` | One provider covers all three LoC collections in the Africa registry |
| Internet Archive (4.5) | `internet_archive` | Direct match |
| Crossref REST (8.2) | `crossref` | Direct match |
| Semantic Scholar (8.3) | `semantic_scholar` | Direct match |
| arXiv (8.6) | `arxiv` | Direct match |

**Related but not a direct match:** `nasa` / `nasa_gibs` adapters exist (NASA GIBS imagery/WMTS) but are a *different* NASA API surface than NASA Earthdata CMR (7.10, granule search) — no provider currently implements CMR search specifically.

**All other ~124 Africa-registry sources have no existing Research Engine provider.** `providerEnv.ts` type declarations include a few additional *unimplemented* provider IDs (`imf_sdmx`, `uspto`, `usgs_national_map`, `world_bank_data_catalog/projects/finances/climate`) — `imf_sdmx` is declared but not in `IMPLEMENTED_PROVIDER_ADAPTERS`, so IMF DataMapper (6.2) is classified as "type declared, not implemented" rather than "no provider at all."

---

## 1. Tier 2 — Human Origins / Archaeology / Genetics (17 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|2.1|Paleobiology Database (PBDB)|PBDB Consortium (NSF)|Global incl. Africa|Fossil occurrences/taxa|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.2|ROCEEH Out of Africa DB (ROAD)|ROCEEH/Univ. Tübingen|Africa+Eurasia|Paleoanthropology localities|DATASET (R client)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|RESEARCH_REQUIRED|
|2.3|NOW Fossil Mammal Database|Univ. Helsinki|Global incl. African Neogene|Fossil mammal localities|BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|2.4|African Fossils|Turkana Basin Inst./NMK/Stony Brook|East Africa (Kenya)|3D hominin fossils|DIGITAL ARCHIVE|Account|⚠️|AFRICA_COUNTRY_SPECIFIC|None|High|DOCUMENT_LIBRARY_CANDIDATE|
|2.5|MorphoSource|Duke University|Global, strong African hominin|3D/CT specimen scans|API/ARCHIVE|Free account (some)|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.6|PaleoCore/Origins (Turkana catalog)|UT Austin/TACC|East Africa (Kenya)|Georeferenced hominin catalog|API|Project-dependent|⚠️|AFRICA_COUNTRY_SPECIFIC|None|High|CREDENTIAL_REQUIRED|
|2.7|Allen Ancient DNA Resource (AADR)|Reich Lab, Harvard|Global incl. Africa (Mota, Malawi)|Ancient DNA genotypes|DATASET/BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|2.8|Poseidon Framework|MPI-EVA Leipzig|Global incl. Africa|aDNA package mirror|BULK/CLI|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|2.9|1000 Genomes/IGSR|EMBL-EBI|Global (7 African pops, AFR n=893)|WGS genomic data|BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|2.10|HGDP + Simons Genome Diversity Project|CEPH/Simons Fdn|Global, Africa-rich|Human diversity genomes|API+BULK|No (23 restricted)|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|
|2.11|gnomAD|Broad Institute|Global|Aggregate variant frequencies|API (GraphQL)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.12|p3k14c + African regional 14C DBs|Bird/Miranda et al.|Global + African regional (aDRAC, MedAfriCarbon, SARD)|Radiocarbon dates|DATASET|No|✅|AFRICA_REGIONAL|None|**High if deduped** — 3 African regional sub-compilations named individually|BULK_INGEST_CANDIDATE|
|2.13|IntChron/IntCal|IntCal working group/Oxford|Global (SHCal southern Africa)|Calibration curves|JSON archive|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.14|Open Context|Alexandria Archive Institute|Global incl. Africa (Abydos, E. Africa)|Archaeology field data|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.15|NOAA NCEI Paleoclimatology|NOAA|Global, African Rift/lakes|Paleoclimate proxies|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.16a|Neotoma|NeotomaDB community|Global; African coverage thin|Fossil pollen/paleoecology|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|2.16b|PANGAEA|Alfred Wegener Institute|Global incl. African margins|Earth/environment datasets|OAI-PMH|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|

## 2. Tier 3 — African History & Primary Sources (18 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|3.1|Trismegistos Data Services|KU Leuven|North Africa (Egypt)|Ancient-text metadata|KG/API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|3.2|Beta maṣāḥəft|Universität Hamburg|East Africa (Ethiopia, Eritrea)|Geʿez manuscripts|IIIF+SPARQL+DTS|No|✅|AFRICA_COUNTRY_SPECIFIC|None|High|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|3.3|Thesaurus Linguae Aegyptiae (TLA)|Berlin-Brandenburg Academy|North Africa (Egypt)|Egyptian-language corpus|API+BULK|No|✅|AFRICA_COUNTRY_SPECIFIC|None|High|BULK_INGEST_CANDIDATE|
|3.4|papyri.info|Duke + papyrology consortium|North Africa (Egypt)|Papyri TEI/EpiDoc corpus|BULK (GitHub)|No|✅|AFRICA_COUNTRY_SPECIFIC|None|High|BULK_INGEST_CANDIDATE|
|3.5|Pleiades Gazetteer|ISAW NYU/Stoa|North/East Africa (ancient)|Ancient places gazetteer|API/KG|No|✅|**OVERLAPPING**|Category 12/13 nightly-dumps block|Low|EXISTING_GLOBAL_OVERLAP|
|3.6|Perseus/Scaife (CTS API)|Tufts + Leipzig|North Africa (classical)|Greek/Latin primary sources|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|3.7|HMML Reading Room/vHMML|Hill Museum & Manuscript Library|West Africa (Mali), Horn, Egypt|Manuscript images (Timbuktu etc.)|IIIF/ARCHIVE|Registration|⚠️|AFRICA_REGIONAL|None|**Very high**|DOCUMENT_LIBRARY_CANDIDATE|
|3.8|Endangered Archives Programme (EAP)|British Library/Arcadia|Pan-African (Mali, Guinea, Cameroon, Ethiopia, Swahili coast)|At-risk primary archives|IIIF COLLECTION|No|✅|AFRICA_REGIONAL|None|**Very high**|DOCUMENT_LIBRARY_CANDIDATE|
|3.9|LoC — Islamic Manuscripts from Mali|Library of Congress + Mamma Haidara Library|West Africa (Mali)|Timbuktu manuscripts|API|No|✅|**Existing RE provider** (`library_of_congress`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None (master has no dedicated LoC-Mali block)|Med|PRESERVE_SOURCE_REFERENCE|
|3.10|Gallica (BnF)|Bibliothèque nationale de France|West/Central Africa (francophone)|Colonial archives, mss, maps|SRU+OAI+IIIF|Partial|✅|UNIQUE_TO_AFRICA_REGISTRY|None|High|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|3.11|Struggles for Freedom (Aluka→JSTOR)|JSTOR/ITHAKA|Southern Africa|Liberation-movement archives|🔒 LICENSED|Subscription|🔒|UNIQUE_TO_AFRICA_REGISTRY|None|High|CREDENTIAL_REQUIRED|
|3.12|TLA on Hugging Face|BBAW|North Africa (Egypt)|Lemmatized Egyptian corpus|BULK|No|✅|AFRICA_COUNTRY_SPECIFIC|None|Med|BULK_INGEST_CANDIDATE|
|3.13|Digital Egypt for Universities|UCL Petrie Museum|North Africa (Egypt)|Egyptology reference site|SEARCH INTERFACE|n/a|⚠️|AFRICA_COUNTRY_SPECIFIC|None|Med|LOCAL_INDEX_CANDIDATE|
|3.14|UK National Archives Discovery API|The National Archives UK|Pan-African (colonial)|Colonial Office records|API|IP allowlist|✅|AFRICA_REGIONAL|None|High|CREDENTIAL_REQUIRED|
|3.15|ANOM (French colonial archives)|French Ministry of Culture|West/Central/North Africa (French)|French colonial archives|DIGITAL ARCHIVE, NO API|No|⚠️|AFRICA_REGIONAL|None|**Very high**|NO_MACHINE_API|
|3.16|Arquivo Histórico Ultramarino (digitArq)|DGARQ Portugal|Southern/West Africa (Portuguese)|Portuguese colonial archives|DIGITAL ARCHIVE, NO API|No|⚠️|AFRICA_REGIONAL|None|**Very high**|NO_MACHINE_API|
|3.17|Archives Portal Europe|European archives consortium|Pan-African (colonial metadata)|Aggregated finding aids|API|Free on request|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Med|CREDENTIAL_REQUIRED|
|3.18|UNESCO Memory of the World|UNESCO|Southern/East Africa (islands)|Curated heritage register entries|SEARCH INTERFACE|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|High|LOCAL_INDEX_CANDIDATE|

## 3. Tier 4 — Museums / Archives / Manuscripts (12 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|4.1|Smithsonian Open Access API|Smithsonian Institution|Continental (NMAfA)|Museum collections incl. African art|API|Free key|✅|UNIQUE_TO_AFRICA_REGISTRY|None (only Cooper Hewitt sub-museum in master)|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.2|Met Museum Collection API|Metropolitan Museum of Art|North Africa/Continental|Egyptian + African art|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.3|Europeana API|Europeana Foundation|Continental (diaspora-held)|African ethnographic collections|API|Free key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.4|DPLA API|Digital Public Library of America|Diaspora/USA|African-American & diaspora collections|API|Free key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.5|Internet Archive|Internet Archive|Global|Africana scans, colonial docs|API|No|✅|**Existing RE provider** (`internet_archive`); MASTER_HAS_BROADER_GLOBAL_SOURCE|Category 01 #12|Low|EXISTING_GLOBAL_OVERLAP|
|4.6|Rijksmuseum|Rijksmuseum|Continental (colonial-era)|VOC/Atlantic trade objects|API+LINKED DATA|Free key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.7|data.bnf.fr SPARQL|BnF|West/Central Africa (francophone)|Linked data, African writers|KG (SPARQL)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|4.8|Digital Bodleian|Bodleian Libraries, Oxford|West/East Africa|Arabic/Swahili mss, maps|IIIF|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|High|DOCUMENT_LIBRARY_CANDIDATE|
|4.9|Qatar Digital Library|Qatar Foundation/British Library|East Africa (Zanzibar, Indian Ocean)|Gulf/E. Africa history mss|IIIF|No|⚠️|**OVERLAPPING**|Category 13 (full detail block); Category 25 #41 (Africa-registry cross-reference)|Med|EXISTING_GLOBAL_OVERLAP|
|4.10|e-codices|Swiss libraries consortium|North Africa (small corpus)|Medieval mss transmitting African/Islamicate scholarship|IIIF+OAI-PMH|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|DOCUMENT_LIBRARY_CANDIDATE|
|4.11|HathiTrust Data API|HathiTrust|Continental|Historical Africana full text|API|OAuth key|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Med|CREDENTIAL_REQUIRED|
|4.12|British Museum|British Museum|Continental (Benin Bronzes etc.)|Museum object records|BULK/SEARCH|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Med|BULK_INGEST_CANDIDATE|

## 4. Tier 5 — African Government & AU Data (17 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|5.1|ACLED|ACLED|Pan-African|Conflict/protest events|API|OAuth (email+pw)|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|
|5.2|UCDP API|Uppsala University|Pan-African|Conflict event data|API|Free token|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|
|5.3|V-Dem|V-Dem Institute|Pan-African|Democracy indicators|DATASET/BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|PERIODIC_SYNC_CANDIDATE|
|5.4|Afrobarometer|Afrobarometer Network (Accra)|Pan-African (35+ countries, African-run)|Public-attitude surveys|DATASET|No (merged data)|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|PERIODIC_SYNC_CANDIDATE|
|5.5|Ibrahim Index (IIAG)|Mo Ibrahim Foundation|Pan-African (54 countries)|Governance measures|DATASET|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|PERIODIC_SYNC_CANDIDATE|
|5.6|Polity5|Center for Systemic Peace|Pan-African|Regime authority scores|DATASET|No|⚠️ STALE (frozen 2018)|UNIQUE_TO_AFRICA_REGISTRY|None|Low|RESEARCH_REQUIRED|
|5.7|QoG Institute Datasets|Univ. of Gothenburg|Pan-African|Harmonized governance variables|DATASET|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|PERIODIC_SYNC_CANDIDATE|
|5.8|EISA|Electoral Institute for Sustainable Democracy in Africa|Pan-African (African institution, Johannesburg)|Election observation reports|DIGITAL ARCHIVE|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|DOCUMENT_LIBRARY_CANDIDATE|
|5.9|African Elections Database|Independent (tripod)|Pan-African|Historical election results|❌ ABANDONED|n/a|❌|NEGATIVE_FINDING|None|Med|NO_MACHINE_API|
|5.10|African Development Bank — Open Data for Africa|AfDB|Pan-African (all 54)|Socio-economic indicators|PORTAL|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|LOCAL_INDEX_CANDIDATE|
|5.11|African Union|African Union|Pan-African/Continental|Treaties, AU instruments|DIGITAL ARCHIVE, NO API|No|⚠️ MAJOR GAP|NEGATIVE_FINDING|None|**Very high**|NO_MACHINE_API|
|5.12a|Nigeria NBS|Nigeria Nat'l Bureau of Statistics|West Africa (Nigeria)|Microdata catalog|Portal/CSV export|No|⚠️|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|LOCAL_INDEX_CANDIDATE|
|5.12b|Stats SA|Statistics South Africa|Southern Africa (South Africa)|SuperWEB2 browser|PORTAL, NO API|No|⚠️|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|NO_MACHINE_API|
|5.12c|Ghana GSS|Ghana Statistical Service|West Africa (Ghana)|Portal + file downloads|PORTAL, NO API|No|⚠️|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|NO_MACHINE_API|
|5.12d|Kenya Open Data|Kenya government (OGP)|East Africa (Kenya)|Open data portal (ArcGIS Hub revival)|PORTAL|No|⚠️ historically unreliable|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|RESEARCH_REQUIRED|
|5.13|openAFRICA|Code for Africa|Pan-Africa (African-run)|Grassroots open-data repo|API (CKAN)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|5.14|EITI API|EITI International Secretariat|Multi-region (Nigeria, Ghana, DRC, Senegal, Zambia…)|Extractives revenue transparency|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|

## 5. Tier 6 — Economics / Population / Development (17 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|6.1|World Bank Open Data API v2|World Bank|Pan-African (all 54 + aggregates)|Development indicators|API|No|✅|**Existing RE provider** (`world_bank_indicators`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None (master has no WB block)|Low|PRESERVE_SOURCE_REFERENCE|
|6.2|IMF DataMapper + SDMX 3.0|IMF|Pan-African (45+ economies)|Macro/fiscal data|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None (`imf_sdmx` type declared, unimplemented)|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.3|UN Comtrade|UN Statistics Division|Pan-African|Merchandise/services trade|API|Key for full; keyless preview|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|
|6.4|UNCTADstat|UNCTAD|Pan-African|Trade/investment/maritime|API|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.5|WHO GHO|WHO|Pan-African (47-state AFRO region)|Health indicators|API (OData)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.6|ILOSTAT|ILO|Pan-African|Employment/wages/informality|API (SDMX)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.7|UN SDG API|UNSD|Pan-African|SDG indicators|API|No|✅|**OVERLAPPING**|Category 23 #3|Low|EXISTING_GLOBAL_OVERLAP|
|6.8|UNICEF SDMX|UNICEF|Pan-African|Child health/nutrition/education|API (SDMX)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.9|DHS Program API|USAID/ICF|Sub-Saharan Africa (majority of 90+ countries)|Household health/demography|API|Yes, key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|CREDENTIAL_REQUIRED|
|6.10|IPUMS International|IPUMS/Univ. Minnesota|12+ African countries|Harmonized census microdata|API|Yes, key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|CREDENTIAL_REQUIRED|
|6.11|FAOSTAT|FAO|Pan-African|Agriculture/trade/food security|BULK|No|⚠️ legacy API deprecated|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|6.12|Penn World Table 10.01|Groningen GGDC|Pan-African (~50 countries)|GDP/productivity/PPP|DATASET|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|6.13|Maddison Project 2023|Groningen GGDC|Pan-African|Long-run GDP per capita|DATASET|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|6.14|WorldPop/WOPR|Univ. of Southampton|Pan-African|Population rasters|API+BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.15|WITS|World Bank|Pan-African|Trade flows/tariffs|API (SDMX)|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|6.16|UNDP HDR|UNDP|Pan-African|Human Development Index|API|Yes, free key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|
|6.17|Our World in Data|OWID/Oxford|Pan-African (curated)|Curated harmonized indicators|API-ish|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|

## 6. Tier 7 — Maps / Geography / Environment (16 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|7.1|David Rumsey Map Collection|David Rumsey Map Center/Stanford|Continental (historical maps)|Colonial/exploration maps|IIIF|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Med|DOCUMENT_LIBRARY_CANDIDATE|
|7.2|Old Maps Online|Univ. Portsmouth/MapTiler|Continental (discovery layer)|Aggregated map index|SEARCH INTERFACE|n/a|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Low|RESEARCH_REQUIRED|
|7.3|LoC Maps via loc.gov API|Library of Congress|Continental (colonial)|Maps/atlases|API|No|✅|**Existing RE provider** (`library_of_congress`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None (master has no dedicated LoC-maps block)|Low|PRESERVE_SOURCE_REFERENCE|
|7.4|OpenStreetMap Overpass API|OSM community|Global|Vector geodata (POI, boundaries)|API|No|✅|**OVERLAPPING**|Category 18 #1|Low|EXISTING_GLOBAL_OVERLAP|
|7.5|GeoNames|GeoNames|Global (African historical names)|Gazetteer|API|Free username|✅|**OVERLAPPING**|Category 01 #28 (cross-ref) / Category 18 #4 (full)|Low|EXISTING_GLOBAL_OVERLAP|
|7.6|Natural Earth|NACIS community|Global|Vector/raster basemaps|BULK|No|✅|**OVERLAPPING**|Category 18 #5|Low|EXISTING_GLOBAL_OVERLAP|
|7.7|HDX (UN OCHA)|UN OCHA|Pan-African|Humanitarian datasets/boundaries|API (CKAN)|Write-only key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|7.8|GRID3|GRID3 (Columbia CIESIN/Flowminder/WorldPop)|Sub-Saharan Africa|Population grids, facilities|API (ArcGIS Hub)|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|7.9|Digital Earth Africa|DE Africa program|Pan-African (Africa-run)|Continental satellite EO|STAC API|No (sandbox for some)|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|7.10|NASA Earthdata CMR|NASA|Global|Satellite/EO granule search|API|Login for downloads|✅|**OVERLAPPING**|Category 18 #10|Low|EXISTING_GLOBAL_OVERLAP|
|7.11|FAO AQUASTAT|FAO|Pan-African|Water/irrigation statistics|BULK|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Low|BULK_INGEST_CANDIDATE|
|7.12|GBIF|GBIF|Pan-African (SANBI node)|Species occurrences|API|No (reads)|✅|**OVERLAPPING**|Category 10 #1|Low|EXISTING_GLOBAL_OVERLAP|
|7.13|eBird|Cornell Lab|Pan-African|Bird observations|API|Yes, free key|✅|**OVERLAPPING**|Category 10 #3|Low|EXISTING_GLOBAL_OVERLAP|
|7.14|Glottolog|MPI-EVA|Pan-African (~2,000+ languages)|Language classification|BULK/CLDF|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|BULK_INGEST_CANDIDATE|
|7.15|WALS|MPI-EVA consortium|Pan-African (hundreds of languages)|Typological features|BULK/CLDF|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|BULK_INGEST_CANDIDATE|
|7.16|African NLP (Masakhane/Lanfrica/HF)|Masakhane community|West/East Africa (Hausa/Yoruba/Igbo/Swahili)|NLP corpora, African-built|API/BULK|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|

## 7. Tier 8 — Academic Literature (18 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|8.1|OpenAlex|OurResearch|Pan-African (DOAJ/AJOL/SciELO ingested)|Scholarly graph|API|No (mailto polite)|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.2|Crossref REST|Crossref|Global|DOI metadata|API|No|✅|**Existing RE provider** (`crossref`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None|Low|PRESERVE_SOURCE_REFERENCE|
|8.3|Semantic Scholar|Allen Institute for AI|Global|Citation graph|API|Optional key|✅|**Existing RE provider** (`semantic_scholar`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None|Low|PRESERVE_SOURCE_REFERENCE|
|8.4|CORE API v3|Open University/Jisc|Pan-African (strong IR coverage)|OA aggregator|API|Optional key|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|CREDENTIAL_REQUIRED|
|8.5|Unpaywall|Unpaywall|Global|OA status lookup|API|Email param|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.6|arXiv|arXiv/Cornell|Global (weak African humanities)|Preprints|API|No|✅|**Existing RE provider** (`arxiv`); **OVERLAPPING**|Category 16 #1|Low|EXISTING_GLOBAL_OVERLAP|
|8.7|DOAJ|DOAJ|Pan-African (hundreds of titles)|Vetted OA journals|API+OAI-PMH|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**High**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.8|BASE|Bielefeld Univ. Library|Pan-African (African IRs)|Repository aggregator|API|Apply for key|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|Med|CREDENTIAL_REQUIRED|
|8.9|AJOL|African Journals Online (non-profit, SA)|Pan-African (30+ countries, African-published)|African journal aggregator|OAI-PMH|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|BULK_INGEST_CANDIDATE|
|8.10|SciELO South Africa|SciELO + ASSAf|Southern Africa (South Africa)|OA SA journals|API+OAI-PMH|No|✅|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.11|Sabinet|Sabinet, SA|Southern Africa (South Africa)|Licensed SA journal backfile|🔒 NO API|Institutional|🔒|NEGATIVE_FINDING|None|**Very high**|NO_MACHINE_API|
|8.12|JSTOR Constellate/DfR|ITHAKA|Global|TDM service|❌ DISCONTINUED 2025-07-01|Request-based|❌|NEGATIVE_FINDING|None|Med|NO_MACHINE_API|
|8.13|Zenodo|CERN|Pan-African (archaeology/genomics supplements)|DOI-minting repository|API|Token for upload|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.14|Figshare|Figshare|Global|Research data repository|API|No for read|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.15|Harvard Dataverse network|Harvard|Pan-African (elections/economics)|Social-science dataset platform|API|No for read|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.16|OSF API (hosts AfricArXiv)|Center for Open Science|Pan-African (AfricArXiv = key channel)|Preprints/projects|API|No for read|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.17|Dryad|Dryad|Pan-African (genetics/ecology)|Curated datasets|API|No for read|✅|UNIQUE_TO_AFRICA_REGISTRY|None|Med|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|8.18|OCLC WorldCat|OCLC|Global|Union catalog|API 🔒|wskey+secret|🔒|UNIQUE_TO_AFRICA_REGISTRY|None|Low|CREDENTIAL_REQUIRED|

## 8. Tier 9 — African Diaspora / Slave Trade (9 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|9.1|SlaveVoyages|Consortium (Emory/Rice)|West/Central Africa (Atlantic ports)|Trans-Atlantic slave trade data|API/DATASET|No|✅|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|9.2|Enslaved.org|Matrix Center, Michigan State|West/Central Africa (Atlantic diaspora)|Named-person slavery records|KG (SPARQL)|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|CREDENTIAL_REQUIRED (retries needed; intermittent 503)|
|9.3|Freedom on the Move|Cornell|Diaspora (North America)|Fugitive slave ad transcriptions|BULK|No|✅|COMPLEMENTARY|None|Med|BULK_INGEST_CANDIDATE|
|9.4|Legacies of British Slave-ownership|UCL|Southern/East Africa (Cape, Mauritius)|1834 compensation claimants|SEARCH+CSV|No|⚠️|AFRICA_COUNTRY_SPECIFIC|None|**High**|LOCAL_INDEX_CANDIDATE|
|9.5|LoC Born in Slavery (WPA narratives)|Library of Congress|Diaspora (USA)|Formerly-enslaved narratives|API|No|✅|**Existing RE provider** (`library_of_congress`); UNIQUE_TO_AFRICA_REGISTRY vs master doc|None|Med|PRESERVE_SOURCE_REFERENCE|
|9.6|Chronicling America|Library of Congress|Diaspora (USA)|Historic newspapers|API|No|✅|COMPLEMENTARY|None|Low|FUTURE_LIVE_INTEGRATION_CANDIDATE|
|9.7|FamilySearch|FamilySearch International|Diaspora (USA)|Freedmen's Bureau/genealogy|API (OAuth)|Free dev account|⚠️|COMPLEMENTARY|None|Med|CREDENTIAL_REQUIRED|
|9.8|ELAR|SOAS London|Pan-African (oral-history collections)|Endangered-language audio/video|ARCHIVE, NO API|Registration|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|DOCUMENT_LIBRARY_CANDIDATE|
|9.9|British Library Sounds|British Library|Pan-African (field recordings)|Oral history audio|STREAMING, NO API|No|⚠️|UNIQUE_TO_AFRICA_REGISTRY|None|**Very high**|NO_MACHINE_API|

## 9. Tier 10 extras not cross-referenced elsewhere (7 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|10.1|Readex African Newspapers|Readex|Pan-African|Historical newspapers|🔒 Paid|Institutional|🔒|NEGATIVE_FINDING|None|Med|NO_MACHINE_API|
|10.2|CRL (Center for Research Libraries)|CRL|Global/member|Library consortium access|🔒|Member|🔒|UNIQUE_TO_AFRICA_REGISTRY|None|Low|NO_MACHINE_API|
|10.3|Google News Archive|Google (defunct)|Pan-African|Historical news search|❌ DISCONTINUED ~2011|n/a|❌|NEGATIVE_FINDING|None|Low|NO_MACHINE_API|
|10.4|MapAction|MapAction|Pan-African|Map products|SEARCH INTERFACE|n/a|n/a|COMPLEMENTARY (routes to HDX)|None (functionally routes to HDX, item 7.7)|Low|RESEARCH_REQUIRED|
|10.5|SAHRIS|South African Heritage Resources Agency|Southern Africa (South Africa)|National heritage sites register|SEARCH INTERFACE|n/a|n/a|AFRICA_COUNTRY_SPECIFIC|None|**Very high**|NO_MACHINE_API|
|10.6|World Digital Library|LoC (defunct)|Global|Digitized world documents|❌ DISCONTINUED|n/a|❌|NEGATIVE_FINDING|None (absorbed into loc.gov, item 3.9/7.3 family)|Low|NO_MACHINE_API|
|10.7|H3Africa genomics|H3Africa consortium|Pan-African|Controlled-access genomics|🔒 Controlled (EGA)|EGA account|🔒|UNIQUE_TO_AFRICA_REGISTRY|None (master notes "H3Africa controlled via EGA" at line 3890 as a cross-region gap, not a duplicate block)|Low|CREDENTIAL_REQUIRED|

## 10. Knowledge Graphs (cross-tier) not already listed (2 sources)

| # | Source | Org | Country/Region | Domain | Access | Auth/Key | Status | Relationship→Master | Master match | Specificity loss risk | Treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
|KG.1|Wikidata SPARQL|Wikimedia Foundation|Pan-African subset of global KG|African kingdoms/persons/heritage entities|SPARQL|No (UA required)|✅|**Existing RE provider** (`wikidata`); **OVERLAPPING**|Category 01 #1|Low|EXISTING_GLOBAL_OVERLAP|
|KG.2|DBpedia SPARQL|DBpedia|Global|Wikipedia infobox RDF extraction|SPARQL|No|✅|**OVERLAPPING**|Category 01 #5|Low|EXISTING_GLOBAL_OVERLAP|

*(OpenStreetMap-as-KG is a cross-ref to item 7.4, already counted there — not duplicated.)*

---

## 11. Phase 8 — Africa knowledge coverage by region

| Region | Coverage assessment | Representative sources |
|---|---|---|
| **Africa-wide / regional / continental** | Strong for global-infrastructure sources filtered to Africa (World Bank, IMF, WHO GHO, ACLED, UCDP, V-Dem, EITI, Digital Earth Africa, WorldPop, openAFRICA); weak for a unified cross-continental discovery layer | 6.1, 6.2, 6.5, 5.1, 5.2, 5.3, 5.14, 7.9, 6.14, 5.13 |
| **North Africa (Egypt-heavy)** | Very strong — ancient Egypt has the deepest tooling of any African subregion (Trismegistos, TLA, papyri.info, Digital Egypt) | 3.1, 3.3, 3.4, 3.12, 3.13 |
| **West Africa** | Strong for Mali/Timbuktu manuscripts (HMML, EAP, LoC) and Nigeria/Ghana stats; weak live-API coverage for most other West African states | 3.7, 3.9, 3.8, 5.12a, 5.12c |
| **Central Africa** | Weak — mostly colonial-archive coverage (ANOM) and DRC extractives (EITI); little country-specific machine access | 3.15, 5.14 |
| **East Africa** | Strong for paleoanthropology (Kenya/Turkana: African Fossils, PaleoCore) and Ethiopia manuscripts (Beta maṣāḥəft); Kenya stats portal unreliable | 2.4, 2.6, 3.2, 5.12d |
| **Southern Africa** | Strong for South Africa specifically (SciELO SA, SANCDB [master-only], SAHRIS, GBIF/SANBI node); weak for Stats SA (no API) | 8.10, 10.5, 5.12b |

**African Union / continental institutions:** African Union (5.11) is a documented **MAJOR GAP** — no AU/AUSTAT open-data API exists; AfDB Open Data for Africa (5.10) exists but is undocumented/portal-only.

**Universities/research repositories:** AJOL (8.9), CORE (8.4), openAFRICA (5.13), AfricArXiv via OSF (8.16), Masakhane (7.16) — strong African-run/African-published coverage.

**Archives/history/culture:** HMML, EAP, ANOM, AHU, TNA Discovery, Beta maṣāḥəft, papyri.info, TLA — strong on manuscripts/colonial archives, almost entirely non-API (IIIF/archive-only).

**Government/legal:** Weak — AU has no API; most national statistics offices (Stats SA, GSS, Kenya) lack REST APIs; AfDB portal undocumented.

**Statistics/economics:** Very strong — World Bank, IMF, Comtrade, UNCTADstat, ILOSTAT, Penn World Table, Maddison, IIAG, V-Dem, Afrobarometer, QoG all cover Africa well.

**Medicine/public health:** Covered mainly via WHO GHO and DHS Program (household health/demography) — this Africa registry does **not** cover African traditional/indigenous medicine (that content lives only in the master registry's Category 08, e.g. PROTA/SANCDB — see §12).

**Agriculture/environment:** FAOSTAT, AQUASTAT, WorldPop, GRID3, Digital Earth Africa — strong.

**Maps/GIS:** Strong open-infrastructure coverage (OSM Overpass, GeoNames, Natural Earth, Digital Earth Africa, GRID3, HDX) but **no African national mapping/EO agency has a documented public API** (confirmed independently by both registries).

**Science/technology:** Not a focus area of this registry (no dedicated African tech/engineering tier); covered incidentally via general academic-literature sources.

**Scholarly literature:** Very strong — OpenAlex, Crossref, CORE, DOAJ, AJOL, SciELO SA, Zenodo, arXiv, OSF/AfricArXiv.

**Libraries/museums:** Strong via Western-institution holdings (Smithsonian, Met, Europeana, British Museum, Rijksmuseum, HathiTrust) — the registry explicitly notes **no African national museum has a public collection API**.

**Languages/cultural knowledge:** Strong for classification/typology (Glottolog, WALS) and African-built NLP (Masakhane); Ethnologue and Africalex are documented gaps.

---

## 12. Phase 9 — No-information-loss check

**Total distinct sources in the Africa registry:** 133 individually-documented entries (17+18+12+17+17+16+18+9 = 124 across Tiers 2–9, plus 7 Tier-10 extras not otherwise cross-referenced, plus 2 additional Knowledge-Graph cross-tier blocks = 133). This is a more granular count than the Africa registry's own 110-row "MASTER API REGISTRY TABLE," which deliberately merges multiple detail blocks belonging to the same institution (e.g. Library of Congress's three separate collections — 3.9, 7.3, 9.5 — collapse to one row #33; Open Context's 2.14/Tier-3 cross-listing collapses to row #57). Both counts are internally consistent; this ledger preserves the finer-grained 133 to avoid losing per-collection distinctions.

| Category | Count |
|---|---|
| Exact duplicates (relationship=EXACT_DUPLICATE) | 0 |
| Overlapping / broader-global-source (genuine master detail block exists) | 13 |
| Complementary (adjacent but non-identical purpose) | 4 (Freedom on the Move, Chronicling America, FamilySearch, MapAction) |
| Unique to Africa registry (no master equivalent found) | 89 |
| Africa country-specific | 14 |
| Africa regional (multi-country, sub-continental) | 6 |
| Negative findings (discontinued/abandoned/no-API-confirmed) | 7 (African Elections Database, African Union, Sabinet, JSTOR Constellate, Readex, Google News Archive, World Digital Library) |
| Unverified/unknown (relationship classification not resolvable to any of the above) | 0 |

MapAction (10.4) is classified **COMPLEMENTARY** (routes to HDX, item 7.7); its source-level low-confidence/unverified status is an attribute of that row, not a separate relationship bucket, so it is counted once under Complementary and not counted again here.

**INFORMATION-LOSS RISK: NO MATERIAL LOSS IDENTIFIED.** The original Kimi Africa markdown is preserved byte-identical (source SHA-256 verified above), and all reconciled source provenance remains available in this ledger and in the original file. The master registry's own text confirms, independently and repeatedly, that it deliberately did not duplicate Africa-specific content — so the 89 "unique" classifications above are not integration gaps or oversights, they are the intended and expected state of a two-registry design. The 13 genuine overlaps are all general-purpose global infrastructure (Wikidata, DBpedia, GeoNames, OSM, Natural Earth, NASA Earthdata, UN SDG, GBIF, eBird, Pleiades, arXiv, Internet Archive, Qatar Digital Library) where the Africa registry adds African-specific framing/examples on top of an already-known global source — safe to treat as `EXISTING_GLOBAL_OVERLAP` without losing anything, since the Africa registry's African-specific query examples and coverage notes are preserved verbatim in this ledger and in the original file, not deleted. However, several rows carry **high or very-high specificity-loss risk** (flagged individually in the per-tier tables' "Specificity loss risk" column — e.g. 2.4, 2.6, 3.7, 3.8, 3.14–3.16, 5.4, 5.5, 5.8, 5.10, 5.12a–d, 6.9, 6.10, 7.8, 7.9, 7.14–7.16, 8.4, 8.7, 8.9, 8.16, 9.1, 9.2, 9.4, 9.8, 9.9, 10.5) if a future live-integration pass collapses these country- or regional-specific sources into broader global sources rather than implementing them individually — so literal zero-risk wording is not justified today, even though no loss has occurred yet.

**Reverse direction (information in master NOT in Africa registry):** The master registry documents at least two Africa-specific sources this Africa registry does **not** contain: **PROTA/PROTA4U** (Plant Resources of Tropical Africa, Category 08 #14) and **SANCDB** (South African Natural Compounds Database, Category 08 #17) — both traditional/indigenous-medicine sources. This is expected: the Africa registry's mission scope is history/culture/governance/economics/geography/scholarship, not medicine, so this is a legitimate domain gap rather than data loss. Flagging for awareness only — no action taken (master registry not modified).

---

## 13. Phase 10 — Next Kimi file queue (recorded only, not processed)

1. `19fdea6e-e5b2-8217-8000-0f23f8bc5ee9/academic_literature_knowledge_graphs.md`
2. `earth_kb_integrated/_digest.md`
3. `earth_kb_integrated/master_registry.md`
4. All 16 Wave 1/Wave 2 reports (archival/provenance preservation only — already represented in the master registry; **do not** trigger another full provider-implementation pass)

---

*This ledger is a classification artifact only. No provider code, host allowlist, routing, or the master Earth Knowledge registry were modified. No network requests were made during this reconciliation.*
