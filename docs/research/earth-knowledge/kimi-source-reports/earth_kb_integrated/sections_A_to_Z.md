# WAR ROOM OS — EARTH KNOWLEDGE BASE REGISTRY: ANALYTICAL SECTIONS A–Z

Derived strictly from the 16 verified discovery reports (wave1 cats 01–08, wave2 cats 09–16). Category numbers in parentheses cite the source report. Where reports disagree, the disagreement is noted. Africa is covered by the separate Africa registry (`/mnt/agents/output/war_room_africa_api_registry.md`) and is cross-referenced, not duplicated.

---

## SECTION A — TOP 100 SOURCES OVERALL

Ranked by: authority tier (official/curatorial mandate), breadth, uniqueness (no substitute), machine-accessibility (documented API/bulk, no auth wall). Ties broken toward free + no-key access.

| # | Source | Cat | Why essential |
|---|--------|-----|---------------|
| 1 | Wikidata (Action API + WDQS) | 15 | Universal entity/identifier hub (~115M items); the join key for everything else |
| 2 | NCBI E-utilities (PubMed/PMC/GenBank/ClinVar/dbSNP/GEO/SRA/Taxonomy) | 04/08 | One gateway to the world's biomedical literature + genomic core |
| 3 | Europe PMC | 04 | 43M+ abstracts, 6M full text, citations/annotations API; PubMed superset, keyless |
| 4 | Wikipedia REST + MediaWiki APIs | 15 | Largest multilingual open encyclopedia (64M+ articles) |
| 5 | GitHub API (REST+GraphQL, incl GHSA) | 01/02 | Hub of all OSS + largest live bug/fix corpus + advisory DB |
| 6 | GBIF | 07 | Largest unified species-occurrence graph (~3B records) |
| 7 | UniProt (REST + ID Mapping + SPARQL) | 08 | Universal protein ID hub mapping to 150+ databases |
| 8 | OSV.dev | 02 | Gold-standard vuln aggregator, 30+ ecosystems, free bulk |
| 9 | NVD API 2.0 | 02/03 | Canonical CVSS scoring + CPE↔CVE mapping (250k+ CVEs) |
| 10 | openFDA | 05 | Only unified REST across FDA drug/device/food datasets |
| 11 | PubChem PUG-REST | 05 | Largest open chemistry resource + cross-reference hub |
| 12 | ClinicalTrials.gov API v2 | 04 | Largest structured trial registry (576k+, 220+ countries) |
| 13 | arXiv (API + OAI-PMH + S3 bulk) | 11 | Primary global preprint firehose for physics/math/CS |
| 14 | OSM Overpass + Planet/Geofabrik | 12 | Richest crowd POI/road data + only complete redistributable global map |
| 15 | Overture Maps (GERS) | 12 | Stable global entity IDs (2.6B buildings, 64M places) — geo join key |
| 16 | GeoNames | 12/15 | Most-used open gazetteer join key (27M+ features) |
| 17 | Copernicus CDSE (STAC) | 12 | Authoritative free 10m optical + SAR global time series |
| 18 | USGS Landsat (auth-free STAC/S3) | 12 | 50+ yr continuous calibrated global land record |
| 19 | NASA Earthdata CMR | 12 | Single catalog across all NASA Earth science (2B+ granules) |
| 20 | ECMWF CDS (ERA5) | 12 | Gold-standard global climate reanalysis (1940–) |
| 21 | NOAA NCEI (CDO v2 + ADS v1) | 12 | Deepest free global weather-station archive (1700s–) |
| 22 | Eurostat Dissemination API | 14 | Canonical EU comparable statistics, SDMX, keyless |
| 23 | OECD Data Explorer (SDMX) | 14 | DAC aid, PISA, OECD-harmonized datasets |
| 24 | UN SDG API | 14 | Single authoritative SDG indicator store |
| 25 | UN DESA WPP Data Portal | 14 | Canonical global demographic projections (1950–2100) |
| 26 | US Census Bureau API | 14 | Definitive US small-area demographics |
| 27 | FRED + ALFRED | 10 | 800k+ macro series incl unique vintage/revision data |
| 28 | EUR-Lex/CELLAR SPARQL | 10 | Richest EU legal knowledge graph (since 1952) |
| 29 | Congress.gov API | 10 | Authoritative US legislative status/amendment graph |
| 30 | GovInfo API + bulk | 10 | Only machine source of authenticated US Code/CFR XML |
| 31 | legislation.gov.uk | 10 | Point-in-time versioning of UK law back to 1267, keyless |
| 32 | CourtListener | 10 | Largest free US case-law + RECAP docket corpus |
| 33 | GLEIF LEI API | 10 | Only global LEI resolver with corporate-tree links |
| 34 | UK Companies House | 10 | Free official PSC/UBO data + streaming company events |
| 35 | SEC EDGAR | 10 | Free XBRL financials for every US filer (1994–) |
| 36 | USAspending | 10 | Award-level US outlays + full Postgres dump |
| 37 | EU TED API | 10 | Complete EU procurement funnel (~600k notices/yr) |
| 38 | OpenSanctions | 10 | Normalized graph over 300+ sanctions/PEP sources |
| 39 | Internet Archive / Wayback | 15 | Web time travel (900B+ pages) + 40M texts |
| 40 | Common Crawl | 15 | Only open web-scale crawl corpus (250B+ pages) |
| 41 | ORCID public API | 15 | Canonical researcher identity join key (19M+ iDs) |
| 42 | ROR | 15 | Standard organization ID (110k+, GRID successor), CC0 |
| 43 | VIAF | 15 | Person/org identity hub: QID↔LCNAF↔GND↔BnF↔NDL↔ISNI |
| 44 | Data Commons (REST + MCP) | 15 | Single DCID join across hundreds of statistical sources |
| 45 | Wikimedia dumps | 15 | Canonical offline replication of all Wikimedia knowledge |
| 46 | MITRE ATT&CK (STIX repo) | 03 | Canonical adversary TTP taxonomy (Enterprise/Mobile/ICS) |
| 47 | CISA KEV | 02/03 | Only authoritative actively-exploited + ransomware-flag list |
| 48 | abuse.ch (MalwareBazaar/ThreatFox/URLhaus) | 03 | Only vetted confirmed-malware/C2/URL corpus, free, CC0 |
| 49 | VirusTotal v3 | 03 | Largest multi-engine verdict consensus (70+ engines) |
| 50 | Software Heritage | 01 | Only universal deduplicated source-code archive w/ persistent SWHIDs |

| # | Source | Cat | Why essential |
|---|--------|-----|---------------|
| 51 | PyPI | 01 | Authoritative Python release metadata |
| 52 | npm Registry | 01 | Authoritative JS ecosystem feed w/ replication stream |
| 53 | WHO ICD API | 04 | Only official global disease-coding system with an API |
| 54 | UMLS Metathesaurus API | 04 | 200+ vocabularies, 3M+ concepts, CUI graph/crosswalks |
| 55 | PMC Open Access Subset | 04 | Largest legal bulk full-text biomedical corpus (migrating to AWS 2026) |
| 56 | WHO GHO OData | 04 | Broadest official cross-country health indicators (~3,000) |
| 57 | Open Targets Platform | 04 | Only open integrated target–disease–drug evidence graph |
| 58 | RxNorm/RxNav | 05 | Canonical RxCUI bridge across US drug vocabularies + free DDI |
| 59 | DailyMed SPL | 05 | Complete versioned US prescribing-information corpus |
| 60 | ChEMBL | 05 | Largest curated literature bioactivity set + drug warnings |
| 61 | COCONUT 2.0 | 06 | Largest single open natural-products collection (>400k, incl TCM/S. African) |
| 62 | WHO IRIS (OAI-PMH) | 06 | Authoritative WHO document corpus incl traditional-medicine strategy |
| 63 | Catalogue of Life via ChecklistBank | 07 | Single API over thousands of taxonomic checklists |
| 64 | WoRMS (Aphia) | 07 | Definitive marine nomenclature; AphiaID reused across OBIS/IRMNG |
| 65 | IUCN Red List API v4 | 07 | Only authoritative global extinction-risk assessment |
| 66 | OBIS | 07 | Marine occurrences with depth + environmental measurement data |
| 67 | ICTV MSL/VMR | 07 | Sole official virus taxonomy authority |
| 68 | BacDive + LPSN (DSMZ) | 07 | Standardized bacterial phenotypes + official prokaryote nomenclature |
| 69 | Ensembl REST | 08 | Best gene-model + variant-consequence (VEP) API |
| 70 | ENA Portal API | 08 | Richest programmatic INSDC metadata search (50 req/s published) |
| 71 | RCSB PDB | 08 | Authoritative experimental structure archive + AlphaFold integration |
| 72 | AlphaFold DB | 08 | Only proteome-scale predicted structures (214M+) |
| 73 | STRING | 08 | Largest PPI association network + enrichment (CC BY since v11.5) |
| 74 | Reactome | 08 | Open, unrestricted KEGG alternative with analysis API |
| 75 | gnomAD (GraphQL) | 08 | Largest population-variant-frequency API (800k+ exomes/genomes) |
| 76 | Seshat | 09 | Largest expert-coded quantitative world-history dataset |
| 77 | World Historical Gazetteer | 09 | Global temporal gazetteer backbone (2M+ places, 70+ datasets) |
| 78 | ARIADNE portal | 09 | Pan-European/global archaeological discovery layer (40+ repos) |
| 79 | PANGAEA | 09 | Citable paleoenvironmental data backbone (400k+ DOIs) |
| 80 | NASA ADS | 11 | Astronomy/physics citation graph (17M+ records, 1800s–) |
| 81 | INSPIRE-HEP | 11 | HEP author disambiguation + citation graph, CC0 |
| 82 | Materials Project | 11 | Largest coherent DFT materials corpus (~155k) |
| 83 | EPO OPS | 11 | Best free global patent family + legal status (INPADOC) |
| 84 | USPTO Open Data Portal | 11 | Authoritative US patent prosecution/file-wrapper (PEDS/BDSS successor) |
| 85 | Space-Track | 12 | Only authoritative satellite conjunction + full historical catalog |
| 86 | ESA Gaia Archive (TAP) | 12 | Definitive 3-D Milky Way map (1.8B+ sources) |
| 87 | NASA Exoplanet Archive (TAP) | 12 | Canonical confirmed-exoplanet census with provenance |
| 88 | CDS SIMBAD + VizieR | 12 | Universal astronomical object-name resolver + 25k catalogs |
| 89 | NOAA SWPC | 12 | Official real-time space-weather backbone, keyless |
| 90 | OpenAIRE Graph | 13 | Best EU-grant-aware scholarly graph (386M+ products) |
| 91 | OpenCitations | 13 | Fully open citation graph (~2B citations, CC0) |
| 92 | HAL | 13 | Canonical French national OA archive (4.6M+) |
| 93 | J-STAGE WebAPI | 13 | Authoritative Japanese journal literature — key Asia gap filler |
| 94 | Trove v3 | 13 | OCR full text of Australian newspapers back to 1803 |
| 95 | NARA Catalog v2 | 13 | Complete US federal archival metadata incl OCR |
| 96 | e-Stat Japan | 10/14 | Single gateway to all Japanese government statistics |
| 97 | KOSIS | 14 | 100% of Korean official statistics via one API |
| 98 | data.go.kr | 16 | One of the world's largest single national open-API catalogs |
| 99 | ReliefWeb API v2 | 14 | Full-text humanitarian situation reports (1996–), real-time |
| 100 | CBDB + CHGIS | 16 | Structured pre-modern Chinese biographical + geospatial backbone |

---

## SECTION B — THE FIRST 25 TO INTEGRATE (optimal starter pack)

Selection: maximum cross-domain join value per integration hour; all free; 18 of 25 need no credential at all.

1. **Wikidata (15)** — the entity spine; every later source maps onto QIDs.
2. **Wikipedia REST API (15)** — instant multilingual summaries for any entity.
3. **NCBI E-utilities (04/08)** — one client unlocks PubMed, Taxonomy, ClinVar, GEO, SRA.
4. **Europe PMC (04)** — keyless full-text + citation graph for the biomedical layer.
5. **ClinicalTrials.gov v2 (04)** — keyless, structured, daily; the trial-entity backbone.
6. **openFDA (05)** — drugs, devices, recalls, adverse events in one keyless REST.
7. **PubChem (05)** — chemical entity resolution + xrefs to everything molecular.
8. **GBIF (07)** — species-occurrence ground truth; keyless reads.
9. **UniProt (08)** — protein ID mapping hub; async ID-mapping pattern reusable elsewhere.
10. **OSV.dev (02)** — one bulk zip + one API covers 30+ package ecosystems' vulnerabilities.
11. **NVD (02/03)** — CVE/CPE/CVSS canonical layer (optional key, free).
12. **GitHub API (01/02)** — repos, issues, releases, GHSA advisories with one token.
13. **CISA KEV (02/03)** — single-file bulk; the "actively exploited" flag for triage.
14. **arXiv (11)** — OAI-PMH + Atom; the preprint firehose pattern.
15. **OSM Overpass + Geofabrik (12)** — global POI/boundary queries + local planet index.
16. **GeoNames (12/15)** — free toponym resolution; geonameid becomes a core join key.
17. **Eurostat (14)** — SDMX-JSON pattern unlocks dozens of other statistical APIs later.
18. **US Census API (14)** — the US demographic ground truth; free key.
19. **FRED (10)** — 800k+ macro series through one free key.
20. **Congress.gov + GovInfo (10)** — US law machine layer; GovInfo doubles as bulk pattern.
21. **GLEIF (10)** — corporate identity resolution (LEI), keyless, daily golden copy.
22. **SEC EDGAR (10)** — company financials free with just a declared User-Agent.
23. **ORCID (15)** — person identity for the research graph; keyless public API.
24. **Internet Archive metadata + Wayback CDX (15)** — time travel + item metadata, keyless.
25. **ReliefWeb (14)** — real-time humanitarian events stream with a trivial appname registration.

Dependency note: 2, 12, 15–24 all emit identifiers (QID, PMID, RxCUI, DOI, geonameid, LEI, CIK, ORCID) that Sections U/T use as the router's primary keys; integrating these 25 first makes every subsequent wave cheaper.

---

## SECTION C — SOURCES REQUIRING SIGNUP / API KEY

URLs taken verbatim from the discovery blocks. "Free" = no payment; see Section G for paid tiers.

| Source | Cat | Key type | Official signup URL (from block) |
|--------|-----|----------|----------------------------------|
| GitHub | 01/02 | Personal access token | github.com/settings/tokens |
| GitLab | 01/02 | PAT | gitlab.com/-/profile/personal_access_tokens (also …/-/user_settings/personal_access_tokens in 02) |
| Codeberg | 01 | Token | codeberg.org/user/settings/applications |
| Software Heritage | 01 | Bearer (optional, raises quota) | archive.softwareheritage.org/oidc |
| Stack Exchange | 01 | App key (+OAuth PKCE) | stackapps.com/apps/oauth/register |
| W3C API | 01 | Free key (required) | w3.org/users/myprofile/apikeys |
| crates.io (writes only) | 01 | Token via GitHub OAuth | crates.io/me |
| NVD | 02/03 | Optional key (recommended) | https://nvd.nist.gov/developers/request-an-api-key |
| Mozilla Bugzilla | 02 | API key (for security bugs) | bugzilla.mozilla.org/userprefs.cgi?tab=apikey |
| Launchpad (write) | 02 | OAuth 1.0a | launchpad.net/+login |
| Apache Jira (write) | 02 | Account | issues.apache.org/jira/secure/Signup!default.jspa |
| Libraries.io | 02 | API key (required) | https://libraries.io/login |
| VulDB | 03 | Paid API key | https://vuldb.com/pay |
| abuse.ch (MalwareBazaar/ThreatFox/URLhaus) | 03 | Free Auth-Key (mandatory since 2025) | https://auth.abuse.ch/ |
| VirusTotal | 03 | x-apikey | https://www.virustotal.com/gui/join-us |
| Hybrid Analysis | 03 | api-key | hybrid-analysis.com profile |
| ANY.RUN | 03 | API-Key | app.any.run → Profile → API and Limits |
| AlienVault OTX | 03 | X-OTX-API-KEY | otx.alienvault.com Settings |
| AbuseIPDB | 03 | Key header | abuseipdb.com/register |
| GreyNoise | 03 | Key header | https://viz.greynoise.io/signup |
| Shodan | 03 | Key | account.shodan.io/register |
| Censys Platform v3 | 03 | Bearer PAT + org ID | platform.censys.io PAT page |
| PhishStats | 03 | Optional X-API-Key | phishstats.info Settings→API keys |
| ransomware.live Pro | 03 | X-API-KEY | ransomware.live/api (Pro portal) |
| NCBI (optional, raises rate) | 04/08 | Account API key | ncbi.nlm.nih.gov/account (…/account/settings in 08) |
| WHO ICTRP (crawl/web service) | 04 | user/pass via email | ictrpinfo@who.int |
| WHO ICD API | 04 | OAuth2 client id+secret | https://icd.who.int/icdapi |
| UMLS | 04 | Free license + per-account key | uts.nlm.nih.gov |
| SNOMED CT | 04 | Content license / affiliate | snomed.org membership/affiliate pages |
| LOINC FHIR | 04 | Free account (Basic auth) | loinc.org |
| NCBO BioPortal | 04 | Free account key | bioportal.bioontology.org/account |
| Orphadata premium | 04 | Data Transfer Agreement | orphadata.com |
| NICE Syndication | 04 | Signed licence + access key | nice.org.uk syndication / syndication@nice.org.uk |
| IHME GHDx | 04 | Free account | ghdx.healthdata.org |
| GISAID | 04 | Registration + DAA | gisaid.org/registration |
| ProMED | 04 | Paid subscription | promedmail.org/subscribe |
| openFDA (optional) | 05 | API key | https://open.fda.gov/apis/authentication/ |
| BindingDB (optional account) | 05 | Account | https://www.bindingdb.org/bind/register.jsp |
| DrugBank | 05 | API key (paid commercial / free academic) | https://go.drugbank.com/forms/request-academic-license |
| EMA SPOR/PMS | 05 | EMA account | EMA identity portal per EU IDMP IG |
| NPAtlas (elevated) | 06 | Key by email | support@npatlas.org |
| TKDL | 06 | NDA license | via CSIR-TKDL Unit |
| Kew MPNS services | 06 | Agreement | mpns@kew.org |
| BHL | 06 | Free key | https://www.biodiversitylibrary.org/getapikey.aspx |
| GBIF (async downloads) | 07 | Account | https://www.gbif.org/user/profile |
| iNaturalist (write/JWT) | 07 | OAuth app | https://www.inaturalist.org/oauth/applications/new |
| eBird | 07 | API key | https://ebird.org/api/keygen |
| IUCN Red List v4 | 07 | Free token (reviewed) | https://api.iucnredlist.org/users/sign_up |
| TRY Plant Trait DB | 07 | Account + request | https://www.try-db.org/TryWeb/dp.php |
| LPSN | 07 | Free Keycloak account | https://sso.dsmz.de |
| BioGRID/ORCS | 08 | Free API key (REQUIRED) | https://webservice.thebiogrid.org/ (Register) |
| MetaboLights (submission) | 08 | Token | ebi.ac.uk/metabolights registration |
| KEGG FTP | 08 | Paid subscription | bioinformatics.jp |
| tDAR (advanced) | 09 | Free account | core.tdar.org register |
| WHG (contribution) | 09 | Token | whgazetteer.org register |
| Seshat | 09 | Account (manual approval) | seshat-db.com register |
| impresso | 09 | API token | impresso-project.ch/datalab |
| NLI | 09 | API key | nli.org.il/en/research-and-teach/open-library |
| Chinese Text Project | 09 | Free API key | ctext.org account settings |
| EUR-Lex webservice | 10 | Free registration user/pass | eur-lex.europa.eu/content/help/data-reuse/register-webservice.html |
| Congress.gov | 10 | API key | https://api.congress.gov/sign-up/ |
| GovInfo (api.data.gov) | 10 | Key (DEMO_KEY works) | https://api.data.gov/signup/ |
| CourtListener | 10 | Free token | https://www.courtlistener.com/register/ |
| EU FSD (optional crawler token) | 10 | Account | webgate.ec.europa.eu/europeaid/fsd/fsf#!/account |
| OpenSanctions | 10 | API key (self-serve) | https://www.opensanctions.org/api/ |
| OpenCorporates | 10 | Free token | https://opencorporates.com/api_accounts/new |
| UK Companies House | 10 | API key (Basic) | developer.company-information.service.gov.uk/get-started |
| Brazil Portal da Transparência | 10 | Token (Gov.br verified account) | portaldatransparencia.gov.br/api-de-dados/cadastrar-email |
| EU TED | 10 | Free key (EU Login) | https://ted.europa.eu/en/registration |
| Chile Mercado Público | 10 | Free ticket | https://desarrolladores.mercadopublico.cl/ObtenerTicket |
| IFES ElectionGuide | 10 | Token (approval) | https://electionguide.org/request_access/ |
| FRED | 10 | API key | https://fredaccount.stlouisfed.org/apikeys |
| WTO | 10/14 | Free subscription key | https://apiportal.wto.org/signup (…/register in 14) |
| e-Stat Japan | 10/14 | Free appId | https://www.e-stat.go.jp/api/api-info/form (…/api/api-dev/api_page in 14) |
| NASA ADS | 11 | Free token | ui.adsabs.harvard.edu account settings |
| Materials Project | 11 | API key | next-gen.materialsproject.org register |
| MPDS | 11 | API key | mpds.io register |
| IEEE Xplore | 11 | Free API key | developer.ieee.org register |
| EPO OPS | 11 | OAuth2 client key+secret | developers.epo.org register |
| USPTO ODP | 11 | API key (MyUSPTO + ID.me) | data.uspto.gov getting started |
| PatentsView | 11 | Free key | patentsview.org/apis/purpose |
| USPTO TSDR | 11 | API key | account.uspto.gov/api-manager |
| WIPO PATENTSCOPE machine access | 11 | Contract | wipo.int/en/web/pct |
| KIPRIS Plus | 11 | Free ServiceKey | plus.kipris.or.kr register+apply |
| Google Patents Public Datasets | 11 | GCP account+billing | console.cloud.google.com |
| Lens.org | 11 | Token after plan approval | Lens account → API and Data tab |
| IP Australia | 11 | Portal-issued key | https://portal.api.ipaustralia.gov.au/ |
| GeoNames | 12/15 | Username token | https://www.geonames.org/login (enable free web services) |
| Mapillary | 12 | OAuth client token | https://www.mapillary.com/dashboard/developers |
| Copernicus CDSE | 12 | OAuth2 registration | https://dataspace.copernicus.eu register |
| USGS EarthExplorer M2M | 12 | EROS account + approval | https://ers.cr.usgs.gov/register/ |
| NASA Earthdata (downloads) | 12 | Earthdata Login | https://urs.earthdata.nasa.gov/users/new |
| JAXA G-Portal | 12 | Free account | gportal.jaxa.jp register |
| ISRO Bhuvan archive | 12 | Registration | bhuvan.nrsc.gov.in open data registration |
| OpenWeatherMap | 12 | API key | https://home.openweathermap.org/users/sign_up |
| ECMWF CDS | 12 | Personal Access Token | https://cds.climate.copernicus.eu/user/register |
| NOAA NCEI CDO v2 | 12 | Token (email) | https://www.ncei.noaa.gov/cdo-web/token |
| Met Office DataHub | 12 | API key | https://datahub.metoffice.gov.uk signup |
| OpenTopography | 12 | API key | https://portal.opentopography.org/myopentopo |
| LINZ | 12 | Free key | https://data.linz.govt.nz signup |
| Space-Track | 12 | Account + agreement | https://www.space-track.org/auth/createAccount |
| ESA DISCOSweb | 12 | API token | discosweb.esoc.esa.int register |
| N2YO | 12 | API key | https://www.n2yo.com/login/ |
| NASA Open APIs / JPL | 12 | Key (DEMO_KEY limited) | https://api.nasa.gov |
| Gaia (advanced) | 12 | Account | cosmos.esa.int register |
| MAST | 12 | MyST token | https://auth.mast.stsci.edu |
| SDSS CasJobs | 12 | SciServer token | https://www.sciserver.org/register |
| CiNii | 13 | Free appID | https://support.nii.ac.jp/en/cia/api/api_user |
| RePEc/IDEAS | 13 | Free access code | https://ideas.repec.org/api.html request form |
| Redalyc | 13 | Registration key | redalyc.org API registration |
| BASE | 13 | API key (email application) | base-search.net API registration |
| KISTI ScienceON | 13 | Key (Korean portal) | https://apigateway.kisti.re.kr |
| Trove v3 | 13 | API key | trove.nla.gov.au My Profile → API tab |
| DigitalNZ (optional since 2026) | 13/16 | Key | digitalnz.org/developers/getting-started (…/developers/signup in 16) |
| DDB + Archivportal-D | 13 | API key | deutsche-digitale-bibliothek.de My DDB |
| KB Delpher (bulk grant) | 13 | Email grant | dataservices@kb.nl |
| NARA v2 | 13 | API key | email Catalog_API@nara.gov |
| Museum keys: Harvard Art Museums, Cooper Hewitt, Paris Musées, FNG, Te Papa | 13 | Key/token via web form | per-museum developer pages (13) |
| IOM DTM v3 | 14 | Subscription key | dtm.iom.int API access request |
| IEA | 14 | Token + paid licence | https://www.iea.org/accounts |
| ReliefWeb | 14 | Approved appname (required) | https://reliefweb.int/api-app-name form |
| IATI Datastore | 14 | Free APIM subscription key | https://developer.iatistandard.org subscribe |
| Socrata (IDB, datos.gov.co) | 14 | App token (optional) | https://dev.socrata.com/register |
| Nomis (optional uid) | 14 | Free account | nomisweb.co.uk/myaccount |
| Destatis GENESIS | 14 | user/pass | www-genesis.destatis.de/genesis/online |
| INSEE BDM | 14 | OAuth2 client creds | https://api.insee.fr/catalogue/ create app |
| GUS BDL (optional) | 14 | X-ClientId | https://api.stat.gov.pl BDL |
| Rosstat EMISS fedstat | 14 | Free key (Russian registration) | https://fedstat.ru/opendata |
| KOSIS | 14 | Free apiKey | https://kosis.kr/openapi/ login |
| OGD India data.gov.in | 14/16 | Free key | https://data.gov.in signup (https://auth.data.gov.in/signup in 16) |
| BPS Indonesia | 14 | Free key | https://webapi.bps.go.id/developer/ |
| US Census | 14 | Free key | https://api.census.gov/data/key_signup.html |
| INEGI | 14 | Free token | https://www.inegi.org.mx/app/desarrolladores/ |
| US EIA | 14 | Free key | https://www.eia.gov/opendata/register.php |
| Wikimedia Enterprise | 15 | Key | https://enterprise.wikimedia.com/signup/ |
| Data Commons | 15 | API key (mandatory) | https://apikeys.datacommons.org |
| Google KG Search | 15 | GCP API key | console.cloud.google.com kgsearch |
| BabelNet | 15 | API key | https://babelnet.org/register |
| Internet Archive (save/upload) | 15 | IAS3 keys | https://archive.org/account/signup |
| FrameNet | 15 | Free registration | https://framenet.icsi.berkeley.edu/fndrupal/user/register |
| Merriam-Webster | 15 | API key | https://dictionaryapi.com/register/index |
| ORCID (member features) | 15 | OAuth client creds | https://orcid.org/developer-tools |
| MusicBrainz (edit) | 15 | Account | musicbrainz.org/register |
| Brave Search | 15 | Key | https://api.search.brave.com/app/keys |
| Mojeek | 15 | Key | mojeek.com/services/search/web-search-api |
| Reddit | 15 | OAuth via Responsible Builder ticket | https://www.reddithelp.com/hc/en-us/requests |
| Diffbot | 15 | Token | https://app.diffbot.com/get-started |
| Golden | 15 | Key | golden.com request access |
| Wikibase Cloud (hosting) | 15 | Account | https://www.wikibase.cloud signup |
| data.go.kr | 16 | serviceKey + per-API activation | https://www.data.go.kr join |
| Local Contexts Hub | 16 | API key | https://localcontextshub.org/ register |
| OpenSky Network | 16 | OAuth2 client creds | https://opensky-network.org/ register |
| xeno-canto v3 | 16 | API key (mandatory) | https://xeno-canto.org/account/register |
| Movebank (restricted studies) | 16 | Account | https://www.movebank.org/movebank/#!/signup |
| Mushroom Observer (writes) | 16 | Key | https://mushroomobserver.org/account/api_keys |
| Ocean Networks Canada | 16 | Free token | https://data.oceannetworks.ca register |
| AILLA (media) | 16 | Registration | ailla.utexas.org register |
| Wildlife Insights | 16 | Account | wildlifeinsights.org register |

---

## SECTION D — OFFICIAL SIGNUP PAGES QUICK LIST (credential env var → URL)

Deduplicated to credential-holding env vars (base-URL-only vars excluded — see Section V). One row per service; shared credentials shown once.

| Env var | Signup URL |
|---------|-----------|
| WARROOM_GITHUB_TOKEN | github.com/settings/tokens |
| WARROOM_GITLAB_TOKEN | gitlab.com/-/profile/personal_access_tokens |
| WARROOM_CODEBERG_TOKEN | codeberg.org/user/settings/applications |
| WARROOM_SWH_API_TOKEN | archive.softwareheritage.org/oidc |
| WARROOM_STACKEXCHANGE_KEY | stackapps.com/apps/oauth/register |
| WARROOM_W3C_API_KEY | w3.org/users/myprofile/apikeys |
| WARROOM_NVD_API_KEY | https://nvd.nist.gov/developers/request-an-api-key |
| WARROOM_BUGZILLA_MOZILLA_KEY | bugzilla.mozilla.org/userprefs.cgi?tab=apikey |
| WARROOM_LIBRARIESIO_KEY | https://libraries.io/login |
| WARROOM_VULDB_API_KEY | https://vuldb.com/pay |
| WARROOM_ABUSECH_AUTH_KEY | https://auth.abuse.ch/ |
| WARROOM_VT_API_KEY | https://www.virustotal.com/gui/join-us |
| WARROOM_HYBRID_ANALYSIS_API_KEY | hybrid-analysis.com profile |
| WARROOM_ANYRUN_API_KEY | app.any.run → Profile → API and Limits |
| WARROOM_OTX_API_KEY | otx.alienvault.com Settings |
| WARROOM_ABUSEIPDB_API_KEY | abuseipdb.com/register |
| WARROOM_GREYNOISE_API_KEY | https://viz.greynoise.io/signup |
| WARROOM_SHODAN_API_KEY | account.shodan.io/register |
| WARROOM_CENSYS_PAT | platform.censys.io PAT page |
| WARROOM_PHISHSTATS_API_KEY | phishstats.info Settings→API keys |
| WARROOM_RANSOMWARE_LIVE_API_KEY | ransomware.live/api |
| WARROOM_NCBI_API_KEY / WARROOM_NCBI_DATASETS_API_KEY | ncbi.nlm.nih.gov/account/settings |
| WARROOM_ICTRP_CREDENTIALS | ictrpinfo@who.int (email) |
| WARROOM_WHO_ICD_CLIENT_ID + _SECRET | https://icd.who.int/icdapi |
| WARROOM_UMLS_API_KEY | uts.nlm.nih.gov |
| WARROOM_SNOMED_LICENSE | snomed.org membership/affiliate pages |
| WARROOM_LOINC_USER + _PASSWORD | loinc.org |
| WARROOM_BIOPORTAL_API_KEY | bioportal.bioontology.org/account |
| WARROOM_NICE_SYNDICATION_KEY | nice.org.uk syndication / syndication@nice.org.uk |
| WARROOM_GHDX_ACCOUNT | ghdx.healthdata.org |
| WARROOM_GISAID_CREDENTIALS | gisaid.org/registration |
| WARROOM_PROMED_SUBSCRIPTION | promedmail.org/subscribe |
| WARROOM_OPENFDA_API_KEY | https://open.fda.gov/apis/authentication/ |
| WARROOM_DRUGBANK_API_KEY | https://go.drugbank.com/forms/request-academic-license |
| WARROOM_EMA_SPOR_TOKEN | EMA identity portal per EU IDMP IG |
| WARROOM_NPATLAS_API_KEY | support@npatlas.org (email) |
| WARROOM_TKDL_LICENSE | via CSIR-TKDL Unit |
| WARROOM_BHL_API_KEY | https://www.biodiversitylibrary.org/getapikey.aspx |
| WARROOM_GBIF_USER + _PASS | https://www.gbif.org/user/profile |
| WARROOM_EBIRD_API_KEY | https://ebird.org/api/keygen |
| WARROOM_IUCN_REDLIST_TOKEN | https://api.iucnredlist.org/users/sign_up |
| WARROOM_TRY_ACCOUNT | https://www.try-db.org/TryWeb/dp.php |
| WARROOM_LPSN_USER + _PASS | https://sso.dsmz.de |
| WARROOM_BIOGRID_API_KEY | https://webservice.thebiogrid.org/ |
| WARROOM_SESHAT_USERNAME + _PASSWORD | seshat-db.com register |
| WARROOM_IMPRESSO_API_TOKEN | impresso-project.ch/datalab |
| WARROOM_NLI_API_KEY | nli.org.il/en/research-and-teach/open-library |
| WARROOM_CTEXT_API_KEY | ctext.org account settings |
| WARROOM_EURLEX_WS_USER | eur-lex.europa.eu/content/help/data-reuse/register-webservice.html |
| WARROOM_CONGRESS_GOV_API_KEY | https://api.congress.gov/sign-up/ |
| WARROOM_GOVINFO_API_KEY | https://api.data.gov/signup/ |
| WARROOM_COURTLISTENER_TOKEN | https://www.courtlistener.com/register/ |
| WARROOM_EU_FSD_TOKEN | webgate.ec.europa.eu/europeaid/fsd/fsf#!/account |
| WARROOM_OPENSANCTIONS_API_KEY | https://www.opensanctions.org/api/ |
| WARROOM_OPENCORPORATES_API_TOKEN | https://opencorporates.com/api_accounts/new |
| WARROOM_COMPANIES_HOUSE_API_KEY | developer.company-information.service.gov.uk/get-started |
| WARROOM_BR_TRANSPARENCIA_API_KEY | portaldatransparencia.gov.br/api-de-dados/cadastrar-email |
| WARROOM_TED_API_KEY | https://ted.europa.eu/en/registration |
| WARROOM_CL_MERCADOPUBLICO_TICKET | https://desarrolladores.mercadopublico.cl/ObtenerTicket |
| WARROOM_ELECTIONGUIDE_TOKEN | https://electionguide.org/request_access/ |
| WARROOM_FRED_API_KEY | https://fredaccount.stlouisfed.org/apikeys |
| WARROOM_WTO_API_KEY | https://apiportal.wto.org/signup |
| WARROOM_ESTAT_APPID (a.k.a. WARROOM_ESTAT_APP_ID — name conflict, see V) | https://www.e-stat.go.jp/api/api-info/form |
| WARROOM_ADS_API_TOKEN | ui.adsabs.harvard.edu account settings |
| WARROOM_MP_API_KEY | next-gen.materialsproject.org register |
| WARROOM_MPDS_API_KEY | mpds.io register |
| WARROOM_IEEE_API_KEY | developer.ieee.org register |
| WARROOM_EPO_OPS_KEY + _SECRET | developers.epo.org register |
| WARROOM_USPTO_ODP_API_KEY | data.uspto.gov getting started |
| WARROOM_PATENTSVIEW_API_KEY | patentsview.org/apis/purpose |
| WARROOM_USPTO_TSDR_API_KEY | account.uspto.gov/api-manager |
| WARROOM_KIPRIS_API_KEY | plus.kipris.or.kr register+apply |
| WARROOM_GCP_CREDENTIALS / WARROOM_BQ_PROJECT | console.cloud.google.com |
| WARROOM_LENS_API_TOKEN | Lens account → API and Data tab |
| WARROOM_IPAUSTRALIA_API_KEY | https://portal.api.ipaustralia.gov.au/ |
| WARROOM_GEONAMES_USERNAME | https://www.geonames.org/login |
| WARROOM_MAPILLARY_TOKEN | https://www.mapillary.com/dashboard/developers |
| WARROOM_CDSE_USER + _PASSWORD | https://dataspace.copernicus.eu register |
| WARROOM_USGS_M2M_USER + _TOKEN | https://ers.cr.usgs.gov/register/ |
| WARROOM_EARTHDATA_TOKEN | https://urs.earthdata.nasa.gov/users/new |
| WARROOM_JAXA_GPORTAL_USER | gportal.jaxa.jp register |
| WARROOM_OPENWEATHER_API_KEY | https://home.openweathermap.org/users/sign_up |
| WARROOM_CDSAPI_TOKEN | https://cds.climate.copernicus.eu/user/register |
| WARROOM_NOAA_CDO_TOKEN | https://www.ncei.noaa.gov/cdo-web/token |
| WARROOM_METOFFICE_DATAHUB_KEY | https://datahub.metoffice.gov.uk signup |
| WARROOM_OPENTOPO_API_KEY | https://portal.opentopography.org/myopentopo |
| WARROOM_LINZ_API_KEY | https://data.linz.govt.nz signup |
| WARROOM_SPACETRACK_USER + _PASSWORD | https://www.space-track.org/auth/createAccount |
| WARROOM_DISCOS_TOKEN | discosweb.esoc.esa.int register |
| WARROOM_N2YO_API_KEY | https://www.n2yo.com/login/ |
| WARROOM_NASA_API_KEY | https://api.nasa.gov |
| WARROOM_MAST_API_TOKEN | https://auth.mast.stsci.edu |
| WARROOM_SDSS_SCISERVER_TOKEN | https://www.sciserver.org/register |
| WARROOM_CINII_APPID | https://support.nii.ac.jp/en/cia/api/api_user |
| WARROOM_REPEC_CODE | https://ideas.repec.org/api.html |
| WARROOM_REDALYC_API_KEY | redalyc.org API registration |
| WARROOM_BASE_API_KEY | base-search.net API registration |
| WARROOM_KISTI_API_KEY | https://apigateway.kisti.re.kr |
| WARROOM_TROVE_API_KEY | trove.nla.gov.au My Profile → API tab |
| WARROOM_DIGITALNZ_API_KEY | digitalnz.org/developers/getting-started |
| WARROOM_DDB_API_KEY | deutsche-digitale-bibliothek.de My DDB |
| WARROOM_KBNL_ACCESS | dataservices@kb.nl (email) |
| WARROOM_NARA_API_KEY | Catalog_API@nara.gov (email) |
| WARROOM_IOM_DTM_API_KEY | dtm.iom.int API access request |
| WARROOM_IEA_API_TOKEN | https://www.iea.org/accounts |
| WARROOM_RELIEFWEB_APPNAME | https://reliefweb.int/api-app-name |
| WARROOM_IATI_SUBSCRIPTION_KEY | https://developer.iatistandard.org |
| WARROOM_IDB_SOCRATA_TOKEN / WARROOM_DATOSGOVCO_APP_TOKEN | https://dev.socrata.com/register |
| WARROOM_NOMIS_API_KEY | nomisweb.co.uk/myaccount |
| WARROOM_GENESIS_USER + _PASSWORD | www-genesis.destatis.de/genesis/online |
| WARROOM_INSEE_CLIENT_ID + _SECRET | https://api.insee.fr/catalogue/ |
| WARROOM_ROSSTAT_API_KEY | https://fedstat.ru/opendata |
| WARROOM_KOSIS_API_KEY | https://kosis.kr/openapi/ login |
| WARROOM_DATA_GOV_IN_API_KEY (a.k.a. WARROOM_DATAGOVIN_API_KEY — conflict, see V) | https://data.gov.in signup |
| WARROOM_BPS_API_KEY | https://webapi.bps.go.id/developer/ |
| WARROOM_CENSUS_API_KEY | https://api.census.gov/data/key_signup.html |
| WARROOM_INEGI_TOKEN | https://www.inegi.org.mx/app/desarrolladores/ |
| WARROOM_EIA_API_KEY | https://www.eia.gov/opendata/register.php |
| WARROOM_WIKIMEDIA_ENTERPRISE_KEY | https://enterprise.wikimedia.com/signup/ |
| WARROOM_DATACOMMONS_API_KEY | https://apikeys.datacommons.org |
| WARROOM_GOOGLE_KG_API_KEY | console.cloud.google.com kgsearch |
| WARROOM_BABELNET_API_KEY | https://babelnet.org/register |
| WARROOM_IA_S3_ACCESS_KEY + _SECRET_KEY | https://archive.org/account/signup |
| WARROOM_FRAMENET_DATA_DIR (registration) | https://framenet.icsi.berkeley.edu/fndrupal/user/register |
| WARROOM_MW_API_KEY | https://dictionaryapi.com/register/index |
| WARROOM_BRAVE_SEARCH_API_KEY | https://api.search.brave.com/app/keys |
| WARROOM_MOJEEK_API_KEY | mojeek.com/services/search/web-search-api |
| WARROOM_REDDIT_CLIENT_ID + _SECRET | https://www.reddithelp.com/hc/en-us/requests |
| WARROOM_DIFFBOT_TOKEN | https://app.diffbot.com/get-started |
| WARROOM_GOLDEN_API_KEY | golden.com request access |
| WARROOM_DATAGOKR_SERVICE_KEY | https://www.data.go.kr join |
| WARROOM_LOCALCONTEXTS_API_KEY | https://localcontextshub.org/ register |
| WARROOM_OPENSKY_CLIENT_ID + _SECRET | https://opensky-network.org/ register |
| WARROOM_XENOCANTO_API_KEY | https://xeno-canto.org/account/register |
| WARROOM_MOVEBANK_USER + _PASS | https://www.movebank.org/movebank/#!/signup |
| WARROOM_MUSHROOMOBSERVER_API_KEY | https://mushroomobserver.org/account/api_keys |
| WARROOM_ONC_TOKEN | https://data.oceannetworks.ca register |
| WARROOM_WILDLIFEINSIGHTS_CREDS | wildlifeinsights.org register |

---

## SECTION E — SOURCES NEEDING NO CREDENTIALS AT ALL

No signup, no key, no account for the primary read path (a declared User-Agent counts as no credential). Grouped by category.

**01 Software/coding:** PyPI; npm Registry; crates.io index/CDN/dumps; Maven Central solrsearch; MetaCPAN; RubyGems (read); ecosyste.ms; deps.dev; Homebrew Formulae JSON; Debian sources/UDD/snapshot; grep.app; IETF Datatracker/RFC Editor; MDN (GitHub content repo); kernel.org/lore (git/mbox/Atom); endoflife.date; Rosetta Code; DevDocs.
**02 Bugs/patches:** OSV.dev; CVE Services (read) + cvelistV5 git; CISA KEV; FIRST EPSS; Go VulnDB; MSRC CVRF; Ubuntu OVAL; Debian Security Tracker; Red Hat Security Data (Hydra); Apache Jira (anonymous read); Mozilla Bugzilla (public bugs); Launchpad (anonymous read); GitHub/GitLab public issues (token optional).
**03 Cybersecurity:** CVE Services/cvelistV5; CISA KEV; EPSS; MITRE ATT&CK (repo + TAXII); MITRE ATLAS; CWE/CAPEC zips; Exploit-DB git; MISP default feeds (most); CERT-FR feeds; JVN RSS; BSI WID RSS; NCSC-NL CSAF feed; Shodan InternetDB (keyless endpoint).
**04 Medical:** Europe PMC; PMC OA (FTP→AWS); ClinicalTrials.gov v2; EU CTIS (undocumented); EBI OLS4; Ontobee/HeGroup SPARQL; Orphanet Science tier; MedlinePlus (+Connect); Open Targets (GraphQL + MCP); WHO GHO OData.
**05 Pharma:** openFDA (key optional); RxNorm/RxNav/RxClass/Interactions; DailyMed; AccessGUDID; PubChem; ChEMBL; GtoPdb; PharmGKB; Health Canada DPD; BindingDB API; DrugCentral (bulk); Orange/Purple Book ZIPs; EMA medicines Excel; VAERS; WHO VigiAccess (search only).
**06 Traditional medicine:** COCONUT; LOTUS→Wikidata (WDQS); ChEBI 2.0; TCMSP/TCMID/SymMap/ETCM/IMPPAT (search/partial bulk); Dr. Duke's (bulk CSV); NAEB; PROTA4U; UTP; PFAF; SANCDB; WHO IRIS OAI; Wellcome Collection; KNApSAcK.
**07 Biology:** GBIF (reads); iNaturalist (reads); Catalogue of Life/ChecklistBank (reads); NCBI Taxonomy; WoRMS; ITIS; POWO (unofficial); Index Fungorum (search); BOLD v4; EOL + TraitBank; GloBI; PBDB; OBIS; GRIIS (GBIF/Zenodo); ICTV MSL; BacDive v2 (auth dropped Feb 2026); GlobalTreeSearch (form).
**08 Genomics:** NCBI Datasets v2; Ensembl REST; UniProt; RCSB PDB; AlphaFold DB; KEGG REST (academic, license-restricted); Reactome; WikiPathways; STRING; IntAct; OLS4; ENA; DDBJ; Cellosaurus; Metabolomics Workbench; MetaboLights (read); PRIDE; gnomAD.
**09 History/archaeology:** Open Context; ARIADNE; EDH; iDAI.gazetteer; CDLI; eBL (read); WHG (read); OpenHistoricalMap (read); Nomisma; Pleiades; PeriodO; ADS OAI; PANGAEA; Qatar Digital Library (IIIF — but see anti-bot note, 16); e-periodica; ANNO; Cliopatria; D-PLACE; Perseus/OGL; papyri.info; OpenITI; CBETA; Kanripo; GRETIL; EHRI (read); BDRC.
**10 Gov/law/econ:** legislation.gov.uk; Japan e-Gov Law API; Australia FRL OData; UK Gazette; Federal Register; Canada Justice Laws; Gesetze im Internet; WIPO Lex; UN Treaty Collection; NORMLEX/NATLEX; FAOLEX; India eGazette (search); OFAC SDN/SLS; UN SC list; UK OFSI; GLEIF; SEC EDGAR (UA only); Interpol notices (undocumented, degraded); USAspending; OCDS publishers; EU FTS; OpenSpending data (dormant); IDEA turnout; ECB SDW; BoE IADB; BoC Valet; BIS; BoJ CSV.
**11 Science/patents:** arXiv; INSPIRE-HEP; CERN Repository; HEPData; zbMATH; OEIS; PDG; NIST CODATA; NIST WebBook (search); NOMAD (read); OQMD; AFLOW; JARVIS (Figshare); ETSI/ITU-T (per-doc PDFs); EUIPO TMview (unofficial); INPI France open tier (recherche-entreprises.api.gouv.fr).
**12 Maps/space:** OSM Overpass/Nominatim/Planet/Geofabrik; Natural Earth; Overture Maps; Open-Meteo (non-commercial); api.weather.gov (UA); Met.no (UA); DWD Open Data; JMA XML feed; GEBCO; Swisstopo/PDOK/GA; CelesTrak; NOAA SWPC; JPL Horizons/SBDB (DEMO_KEY); MPC; NASA Exoplanet TAP; SIMBAD/VizieR; INPE STAC; USGS Landsat STAC/S3 (auth-free path).
**13 Academic/archives/museums:** OpenAIRE (read); OpenCitations (token optional); bioRxiv/medRxiv API; HAL; J-STAGE (non-commercial); EconStor; SciELO; CyberLeninka OAI; OAI-PMH IR ecosystem; NDL Search (casual); NDL IIIF; Japan Search; LIBRIS XL; Finna; NB Norway; datos.bne.es; CulturaItalia; Polona (IIIF); AtoM instances; museum APIs w/o key: AIC, Cleveland, V&A, SMK, Nasjonalmuseet, Wellcome, NG London.
**14 Statistics:** Eurostat; OECD SDMX; UN SDG; UN DESA WPP; UNHCR; UNESCO UIS; ADB KIDB; UNdata; OCHA FTS; AidData (bulk); UK ONS; Istat; INE Spain; CBS NL; SCB; SSB; StatBank DK; StatFin; GUS BDL (key optional); CZSO; eSankhyiki (undocumented); SingStat; data.gov.my; PSA OpenSTAT; ABS; Stats NZ; StatCan; IBGE SIDRA; Argentina Series API; Israel CBS; TurkStat (bulk); Saudi CKAN; Gapminder; GADM; Taiwan data.gov.tw CKAN.
**15 General/reference:** Wikidata; Wikipedia; Wikimedia Commons; Wikimedia dumps; DBpedia; YAGO; ConceptNet; Common Crawl; IA/Wayback (read); Kaikki; WordNet/OEWN; Glosbe (degraded); JMdict; CC-CEDICT; VIAF; ISNI; ORCID (public); ROR; lobid; MusicBrainz (read); Open Library; DBLP; Kiwix; FactGrid; Wikibase Cloud instances (read).
**16 Regional/specialized:** CBDB; Japan Search; Local Contexts (metadata read — key for API v2 per block); OpenSky (anonymous limited); SatNOGS; Mushroom Observer (GET); LibriVox; Gutenberg/Gutendex; Standard Ebooks; Arctic Data Center/DataONE; LA Referencia; CLACSO; Shodhganga OAI; DOAB; PARADISEC; OLAC; Pangloss; AILLA metadata; CHGIS; Aozora; OurAirports; Smithsonian GVP (bulk); al-Shamela (bulk).

---

## SECTION F — COMPLETELY FREE SOURCES (free tier sufficient for full functional use)

Everything in Section E **plus** the following key-based services whose free tier covers full intended use:

- **Free key, full use:** NVD (02/03); BHL (06); eBird (07 — non-commercial); IUCN Red List (07 — non-commercial); BioGRID (08); NLI (09); Chinese Text Project (09 — freemium, core free); Congress.gov (10); GovInfo/api.data.gov (10); CourtListener (10); Companies House (10); Brazil Transparência (10); TED (10); Mercado Público (10); FRED (10); WTO (10/14); e-Stat (10/14); NASA ADS (11); IEEE Xplore metadata (11); KIPRIS (11 — non-commercial quota); IP Australia (11); Mapillary (12); CDSE (12); USGS M2M (12); NASA Earthdata (12); JAXA G-Portal (12); ECMWF CDS (12); NOAA CDO (12); OpenTopography (12); LINZ (12); Space-Track (12); DISCOS (12); N2YO (12); NASA Open APIs (12); MAST (12); SDSS CasJobs (12); CiNii (13); RePEc (13); BASE (13 — non-commercial); Trove (13 — non-commercial); DDB (13); NARA (13); ReliefWeb (14); IATI (14); Destatis (14); INSEE (14); KOSIS (14); data.gov.in (14/16); BPS (14); US Census (14); INEGI (14); EIA (14); Data Commons (15); abuse.ch trio (03); OTX (03); Hybrid Analysis community (03); PhishStats free tier (03); data.go.kr (16); Local Contexts (16); OpenSky registered (16); xeno-canto (16); Movebank (16); ONC (16); AILLA (16 — commercial prohibited).
- **Free but non-commercial-only licenses (flag for War Room usage policy):** eBird (07), IUCN (07), IHME (04), Seshat (09 — CC BY-NC-SA), CBDB (16 — CC BY-NC-SA), Redalyc (13 — CC BY-NC-SA), CLACSO (16 — CC BY-NC-ND), NG London (13 — CC BY-NC-ND), PDG (11 — CC BY-NC), NPAtlas (06 — CC BY-NC), ransomware.live free API (03 — CC BY-NC), GADM (14 — academic/non-commercial), BASE/Trove/J-STAGE/NDL casual (13 — non-commercial terms), BabelNet (15), Merriam-Webster (15), OpenSky (16), Materials Project (11 — commercial separate), MW/FrameNet research license (15).

---

## SECTION G — PAID / COMMERCIAL / LICENSED SOURCES (cost models as stated in blocks)

| Source | Cat | Cost model (from block) |
|--------|-----|--------------------------|
| DrugBank | 05 | PAID commercial (est. 5-figure+/yr, not public); free academic non-commercial per-project; free web checker reportedly retiring Mar 2026 (verify) |
| KEGG | 08 | PAID FTP subscription ~US$2,000–5,000/yr (bioinformatics.jp); commercial via Pathway Solutions; REST free academic but no redistribution |
| VulDB | 03 | PAID credits: 200/day tier; 10,000/day + USD 199/mo |
| VirusTotal | 03 | Freemium: free 4 req/min & 500/day, no commercial use; Premium paid |
| ANY.RUN | 03 | Freemium/paid; TI Feeds subscription |
| Shodan | 03 | $49 one-time Membership; $69–$1,099/mo tiers; academic free upgrade; credit metering |
| Censys | 03 | Freemium/paid credit-based; free tier ~100 credits lookup-only |
| GreyNoise | 03 | Freemium; enterprise bulk paid |
| AbuseIPDB | 03 | Freemium (free 1,000 checks/day) |
| PhishStats | 03 | Freemium (anon 50/day; key 150/day; Premium 1,000/day) |
| ransomware.live | 03 | Free CC BY-NC + paid Pro (3,000 calls/day) |
| ProMED | 04 | PAID subscription (changed 2025, formerly free) |
| WHO ICTRP web service | 04 | Portal free; licensed XML web service paid (cost on request) |
| SNOMED CT | 04 | Free in member countries; affiliate license otherwise (geo-freemium) |
| WHO ICD | 04 | Free; commercial use needs license agreement |
| TKDL | 06 | NDA license via CSIR-TKDL Unit (paid/licensed) |
| Kew MPNS services | 06 | Portal free; services freemium by agreement |
| OpenCorporates | 10 | Freemium (~200 req/month + 500/day free); paid bulk/commercial |
| OpenSanctions | 10 | Free non-commercial/journalism; paid commercial license (CC BY 4.0 data) |
| IFES ElectionGuide | 10 | Free non-commercial; commercial license |
| IEA | 14 | Token + paid data licence; core series paywalled (free alts: Ember, EIA) |
| WIPO IPstats | 14 | No free API; paid SOAP/SFTP CHF 600–2,000/yr |
| EPO OPS | 11 | Freemium: 4 GB/week free; >4 GB paid (~€2,800/yr) |
| WIPO PATENTSCOPE | 11 | PAID machine access: SFTP CHF 400–2,000/yr; SOAP ~CHF 2,600/yr (free web UI bans automation) |
| Lens.org | 11 | 14-day free trial (non-commercial); PAID plans |
| MPDS (Pauling File) | 11 | Freemium: limited free tier; full paid |
| CCDC CSD | 11 | PAID site license (academic discounts); confidential |
| IEEE Xplore | 11 | Metadata free w/ key; full text subscription |
| Google Patents Public Datasets | 11 | Freemium: GCP billing, 1 TB/mo query free |
| NIMS MatNavi | 11 | Free DICE account but scraping prohibited; AtomWork-Adv paid |
| NIST TRC WTT | 11 | Paywalled (WebBook itself free, search-only) |
| OpenWeatherMap | 12 | Freemium (60/min, 1M/mo w/ card); paid History Bulk |
| Open-Meteo | 12 | Free non-commercial; commercial key paid |
| Scopus / WoS | 13 | PAID institutional |
| JSTOR TDM | 13 | By agreement (Constellate discontinued 2025) |
| eLibrary.ru | 13 | PAID API only |
| Scopus-alternative Lens scholarly | 13 | Paid plans |
| Wikimedia Enterprise | 15 | Freemium paid streaming/snapshot (dumps remain free) |
| Brave Search | 15 | Freemium: free ~2,000 q/mo; paid $5/1k queries |
| Mojeek | 15 | Freemium: free 1,000 q/mo |
| Reddit | 15 | Free non-commercial 100 qpm (manual approval); paid commercial (~$0.24/1k reported, not officially published) |
| Diffbot | 15 | PAID (free trial) |
| Golden | 15 | Freemium/paid |
| ISBNdb | 15 | Paid (~$15/mo) |
| MusicBrainz live feed | 15 | Core dumps free; live feed commercial license |
| BabelNet commercial | 15 | Free non-commercial; commercial via Babelscape |
| Libraries.io | 02 | Freemium: 60 req/min free; bulk via paid Tidelift; vuln data paywalled; ownership transition Tidelift→Sonar (and see Q for cat01/cat02 status disagreement) |
| Packet Storm | 03 | RSS decommissioned 2025-10-23 → paid TI Feed API |
| eHRAF | 09 | Subscription, NO API (confirmed) |
| British Newspaper Archive / Newspapers.com / Readex / ProQuest / East View / TLG | 09 | All commercial, no open APIs |
| Standards bodies ISO/IEC/ASTM/DIN/JIS/GB | 11 | No APIs; paid or restricted portals |

---

## SECTION H — BULK DOWNLOAD SOURCES (full-dataset access)

**One-file / single-archive pulls (cheapest ingestion):** CISA KEV (02/03); OSV all.zip + per-ecosystem zips (02); Debian Security Tracker JSON (02); crates.io daily DB dump (01); RubyGems daily PG dump (01); Go VulnDB zip (02); CWE/CAPEC zips (03); EPSS daily CSV (03); NIST CODATA (11); Cliopatria GeoJSON (09); PeriodO (09); IDEA turnout XLSX (10); ICTV MSL/VMR (07); GRIIS Zenodo/GBIF (07); OurAirports CSV (16); Natural Earth (12); GEBCO (12); GADM (14); Kaikki JSONL (15); JMdict / CC-CEDICT (15); OEWN (15); CBDB SQLite (16); CHGIS Dataverse (16); Aozora catalog (16); al-Shamela SQLite (16); GVP database download (16); Dr. Duke CSV zip (06); D-PLACE repos (09); OGL/Perseus/papyri/OpenITI/CBETA/Kanripo git repos (09); MITRE ATT&CK/ATLAS repos (03); Exploit-DB git (03); MDN content + BCD (01); GloBI dumps (07); EOL/TraitBank dumps (07); MusicBrainz PG+JSON dumps (15); Open Library monthly dumps (15); DBLP dblp.xml.gz (15); VIAF/ISNI/ROR/lobid dumps (15); YAGO TTL (15); DBpedia Databus (15); ConceptNet assertions (15); FrameNet (15); WordNet (15); Kiwix ZIM (15).

**Cloud bucket / object-store bulk:** PMC OA (04, AWS migration 2026); OSV GCS (02); arXiv S3 requester-pays ~9.2TB (11); iNaturalist weekly S3 dump (07); Overture S3/Azure GeoParquet (12); USGS Landsat s3://usgs-landsat (12); Common Crawl S3 (anon since 2024) (15); AlphaFold FTP/GCS ~23 TiB (08); gnomAD GCP/AWS (08); Open Targets GCS/BigQuery (04); deps.dev BigQuery (01/02); PyPI BigQuery (01); Google Patents BigQuery (11); ChEMBL dumps (05); COCONUT Zenodo monthly (06); LOTUS Zenodo (06); eBL Zenodo (09); GRETIL Zenodo (16); AIC S3 dumps (13).

**FTP / rsync / mirror networks:** NCBI FTP (04/08); UniProt FTP (08); Ensembl FTP/MySQL (08); RCSB PDB FTP/rsync (08); ENA FTP/Aspera/Globus (08); DDBJ HTTPS/FTP (08); Cellosaurus ftp.expasy.org (08); Europe PMC FTP (04); PubChem FTP (05); DailyMed weekly/full SPL ZIPs (05); openFDA bulk ZIPs (05); VAERS (05); RxNorm monthly release (05); ChEBI FTP (06); BHL via Internet Archive (06); RFC tarballs rsync (01); CPAN rsync (01); Debian mirrors + UDD (01); OSM planet + Geofabrik + minutely diffs (12); DWD Open Data tree (12); NOAA NCEI FTP/HTTPS (12); JAXA G-Portal SFTP (12); VizieR FTP (12); SDSS SAS RSYNC (12); Stack Exchange quarterly Archive.org dump (01); Wikimedia dumps (~130GB wikidata gz) (15); IA collections via IAS3/torrents (15); Project Gutenberg rsync (16); LIBRIS EMM dump (13); datos.bne.es RDF dumps (13); KB Delpher Open Newspaper Archive 111GB ZIPs (13).

**Database dumps / full exports:** UMLS Metathesaurus files (04, licensees); Orphadata Science (04); ChEMBL PG/MySQL/SQLite (05); GtoPdb SQL/TSV (05); BindingDB full (05); DrugCentral PG dump (05); DrugBank XML (05, licensed); EMA download-medicines Excel (05); GUDID complete (05); Health Canada DPD extract (05); IHME GBD CSVs (04); GISAID packages (04, DAA); BioGRID monthly builds (08); IntAct full (08); STRING downloads (08); Reactome Neo4j/BioPAX (08); WikiPathways monthly (08); HMDB downloads (08, academic); DepMap via Figshare API (08); ecosyste.ms Zenodo releases (01); USAspending full Postgres dump (10); OFAC/EU FSD/UN SC/UK OFSI full lists (10); GLEIF golden copy daily (10); EU FTS annual CSVs (10); UNESCO UIS BDDS monthly (14); AidData GCDF (14); WPP files (14); GovInfo bulkdata (10); Canada Justice ZIPs (10); Gesetze im Internet XML ZIPs (10); EU CELLAR weekly OJ packages (10); TED daily/monthly archives (10); iDAI.gazetteer full dump (09); EDH EpiDoc ZIPs (09); CDLI GitHub daily (09); Pleiades nightly (09); WHG bulk export (09); tDAR ZIP (09); NARA bulk export (13); OpenAIRE Zenodo dumps (13); OpenCitations downloads (13); bioRxiv TSV via S3 (13); BOLD by-taxon bulk (07); TRY per-request (07); WoRMS on request / via OBIS-GBIF (07); ITIS full DB (07); BacDive CSV/JSON (07); GlobalTreeSearch CSV (07); IMPPAT GitHub (06); SANCDB downloads (06); KNApSAcK (06); FAERS raw quarterly (05).

---

## SECTION I — REAL-TIME / CONTINUOUSLY UPDATED SOURCES

**Firehose / minute-level:** npm CouchDB _changes (01); crates.io sparse index/RSS (01); GitHub events (01); kernel.org git/lore (01); CVE Services (03, on CNA publication); URLhaus dumps regen every 5 min (03); ThreatFox exports every 5 min (03); PhishStats every 90 min (03); JMA XML feed (12); NOAA SWPC 1-min series (12); api.weather.gov alerts (12); Met.no hourly (12); DWD model runs 2–8×/day (12); Open-Meteo hourly (12); OpenWeatherMap 10-min (12); OpenSky seconds-level (16); SatNOGS (16); ONC cabled observatory (16); CelesTrak several×/day (12); Space-Track multiple×/day (12); xeno-canto (16); Movebank (16); Mushroom Observer (16); bioRxiv/medRxiv (13); ClinicalTrials.gov daily (04); EU CTIS (04); GISAID near-real-time (04); HealthMap (04, private); Wikidata/Wikipedia edit streams (15); MusicBrainz live feed (15); Reddit (15, restricted); Companies House streaming (10); SEC EDGAR real-time (10); Federal Register incl public-inspection (10); OFAC intraday (10); ReliefWeb (14); OCHA FTS (14); IATI near-real-time (14); IOM DTM rounds (14); data.gov.in mandi prices (16); EIA hourly grid (14); iNaturalist (07); eBird (07); GBIF continuous (07); OBIS continuous (07); BOLD continuous (07); ENA daily INSDC exchange (08); DDBJ daily exchange (08); NCBI daily (08); PRIDE RSS (08); Stack Exchange (01).

**Daily-batch (not streaming but dependable daily refresh):** NVD (~2h lag vs MITRE, 02/03); EPSS daily model (03); MalwareBazaar batches (03); MISP/CIRCL feeds (03); DailyMed (05); Health Canada DPD (05); PubChem (05); Europe PMC (04); PMC OA incrementals (04); MedlinePlus (04); ProMED (04); arXiv (11); INSPIRE (11); NCBI Taxonomy (07); GBIF monthly export + continuous reads (07); GLEIF 3×/day (10); EU FSD daily (10); USAspending daily (10); TED daily (10); EUR-Lex daily (10); legislation.gov.uk daily (10); Australia FRL daily (10); UK Gazette daily (10); Brazil Transparência (10); Mercado Público (10); IFES during cycles (10); ECB SDW (10); BoE/BoC/BIS (10); CDLI daily (09); Pleiades nightly (09); OpenAIRE (13); GeoNames daily (12/15); CDSE NRT (12); USGS daily (12); ECMWF ERA5 ~5d latency (12); NOAA NCEI daily (12); KIPRIS daily (11); TSDR daily (11); USPTO ODP daily (11); Eurostat daily (14); GenBank/daily (08).

---

## SECTION J — HISTORICAL DEPTH SOURCES

**Pre-1900 coverage:**
- *Deep time / archaeology:* PBDB (07, entire Phanerozoic); PANGAEA (09); Open Context/DINAA (09); tDAR (09); ARIADNE (09); CDLI (09, 3200 BCE–75 CE); eBL (09); EDH (09, 6th c. BCE–9th c. CE); Pleiades (09); iDAI.gazetteer (09); Nomisma (09); Cliopatria (09, 3400 BCE–2024); Seshat (09, 10,000 BCE–); CHGIS (16, 221 BCE–1911); CBDB (16, 7th c. BCE–); papyri.info (09); Perseus/OGL (09); Kanripo/CBETA/CTP (09); GRETIL (09/16); OpenITI (09, 700–1900); BDRC (09); D-PLACE (09).
- *Pre-modern to 1900:* BHL (06, historical herbals); Wellcome (06/13); NDL IIIF (13); Japan Search (13/16, 1500–); datos.bne.es (13, 15th c.–); Polona (13, 16th c.–); ANNO (09, 1568–1954); Delpher/KB (13, 1618–); UK Gazette (10, 1665–); BoE Bank Rate 1694– (10); NOAA NCEI stations 1700s– (12); CourtListener opinions 1754– (10); StatFin from 1750 (14); NASA ADS 1800s– (11); Trove newspapers 1803– (13); PMC OCR back to 1800s (04); PubMed 1809– (04); e-periodica 18th c.– (09); impresso 18th–20th c. (09); QDL 1600s–1947 (09); FactGrid (15, pre-1900 focus); PeriodO (09); J-PlatPat 1885+ (11); AILLA/PARADISEC 1950s– (16); Exploit-DB 1988– (03); legislation.gov.uk 1267– (10, incl revised); SCB from 1860s (14); NDL bibliography 1868– (13); zbMATH 1826– (11).
**1900–2000 foundations:** RCSB PDB since 1971 (08); Landsat 1972– (12); ICTV back to 1971 (07); Gutenberg since 1971 (16); RFC series since 1969 (01); VulDB since 1970 (03); Project Gutenberg (16); Congress.gov 1973– (10); PatentsView 1976+ (11); VAERS 1990– (05); WHO VigiAccess back to 1968 (05); Eur-Lex back to 1952 (10); UN DESA WPP 1950–2100 (14); UNHCR 1951– (14); CEPALSTAT 1950– (14); PDG editions since 1957 (11); CSD since 1965 (11); INSPIRE/SPIRES 1970s– (11); HEPData 1970s– (11); WTO 1948– (10/14); IDEA turnout 1945– (10); Open-Meteo/ERA5 1940– (12); India eGazette 1926– (10); Australia FRL 1901– (10); USGS/US statutes backfiles (10); Wayback 1996– (15); ReliefWeb 1996– (14); SEC EDGAR 1994– (10); FR 1994– (10); ProMED 1994– (04); kernel history 1991+/git 2005+ (01); arXiv 1991– (11); Mozilla Bugzilla 1998– (02); GBIF records to 1600s (07); MAST/HST 1990– (12).
**2000+ (digital-native depth):** Common Crawl 2008– (15); OCHA FTS 2000– (14); FR bulk XML 2000– (10); USPTO ODP 2001+ (11); USAspending FY2001– (10); Redalyc 2002– (13); Canada PiT consolidations 2003– (10); Brazil Transparência 2004– (10); FAERS 2004– (05); EU CTR legacy 2004–2022 (04); Debian snapshot 2005– (01); ACS 2005– (14); EU FTS 2007– (10); JVN iPedia 2007– (03); ONC 2006– (16); JAXA PALSAR 2006– (12); IATI 2011– (14); bioRxiv 2013– (13); Mercado Público 2013– (10); CDSE Sentinel 2014– (12); CBERS-4 2014– (12); OpenSky ~2015– (16); ProZorro 2016– (10); PhishStats 2014– (03); CISA KEV 2021– (02/03); Argentina series 2004– (14); IBGE PAM 1974– (14); data.gov.my from 1970 (14).

---

## SECTION K — KNOWLEDGE GRAPHS & SEMANTIC ENDPOINTS (SPARQL / linked data / RDF / JSON-LD)

**Public SPARQL endpoints (no auth):** WDQS query.wikidata.org/sparql (15, also LOTUS chemistry 06); Wikibase Cloud instances (15); FactGrid database.factgrid.de/sparql (15); DBpedia (15); YAGO (15); BabelNet (15); UniProt SPARQL (08); WikiPathways SPARQL (08); Cellosaurus SPARQL (08); Ontobee + HeGroup merged-graph (04); UberGraph ubergraph.apps.renci.org/sparql (04, complement); EUR-Lex/CELLAR (10); legislation.gov.uk (10); EDH (09); Nomisma (09); ADS (09); Japan Search (13/16); LIBRIS XL (13); Finna/Fennica (13); datos.bne.es (13); CulturaItalia (13); OpenCitations SPARQL w3id.org/oc/index/sparql (13); Chinese Text Project LOD (09); BDRC LDSPDI (09); Pleiades LOD (09); PeriodO JSON-LD (09); Open Context JSON-LD (09); UK Gazette RDF (10); WHO ICD JSON-LD (04); ORDO/Orphanet OWL (04); GloBI Neo4j/RDF (07); ANNO EDM RDF (09).
**Reconciliation / linked-data tooling:** WHG OpenRefine reconciliation (09); lobid reconciliation (15); Open Targets GraphQL + MCP (04); Data Commons MCP api.datacommons.org/mcp (15); OLS4 MCP (08); OpenITI/Open Corpus repos (09).
**IIIF semantic image access:** BHL (06); Wellcome (06/13); NLI (09); QDL (09); e-periodica (09); ANNO (09); NDL (13); BDRC (09); EDH (09); Polona (13); Gallica/BnF (africa registry cross-ref).
**OAI-PMH harvest endpoints (metadata graph at scale):** Europe PMC (04); PMC OA (04); WHO IRIS (06); arXiv oaipmh.arxiv.org (11); INSPIRE (11); CERN (11); zbMATH (11); ADS (09); PANGAEA (09); QDL (09); EHRI (09, verify); HAL (13); EconStor (13); SciELO + Books (13); CyberLeninka (13); DDB/Archivportal-D (13); NDL (13); LIBRIS (13); Delpher (13); CulturaItalia (13); AtoM instances (13); LA Referencia national nodes (16); CLACSO (16); Shodhganga (16); DOAB (16); PARADISEC (16); Pangloss (16); AILLA (16); CTP (09); OAI-PMH IR ecosystem incl JAIRO Cloud (13); BASE as aggregator (13).
**Bulk RDF/LOD dumps:** Wikidata dumps (15); DBpedia Databus (15); YAGO TTL (15); lobid GND RDF (15); VIAF clusters (15); ISNI dumps (15); ROR JSON dump (15); datos.bne.es 58M triples (13); Nomisma RDF (09); BDRC buda-base RDF (09); WikiPathways RDF (08); Reactome BioPAX (08); GloBI RDF (07); LOTUS Zenodo (06); EU CELLAR RDF (10/11); FactGrid dumps (15).

---

## SECTION L — SCIENTIFIC DATABASES

**Genomics/molecular:** NCBI (GenBank/ClinVar/dbSNP/GEO/SRA/Gene) (08); NCBI Datasets v2 (08); Ensembl (08); UniProt (08); ENA (08); DDBJ (08); gnomAD (08); Cellosaurus (08); BioGRID/ORCS (08); IntAct (08); STRING (08); Reactome (08); WikiPathways (08); KEGG (08, license-restricted); OLS4/QuickGO (08); PRIDE/ProteomeXchange (08); Metabolomics Workbench (08); MetaboLights (08); HMDB (08, download-only); DepMap/Figshare (08); Expression Atlas (08, lightly documented); BOLD barcodes (07); GISAID (04, gated).
**Chemistry:** PubChem (05); ChEMBL (05); GtoPdb (05); BindingDB (05); DrugCentral (05); ChEBI (06); COCONUT (06); NPAtlas (06); LOTUS→Wikidata (06); KNApSAcK (06); Dr. Duke (06); NIST WebBook (11, search-only); NIST CODATA (11).
**Protein structure/materials:** RCSB PDB (08); AlphaFold DB (08); Materials Project (11); NOMAD (11); OQMD (11); AFLOW (11); JARVIS (11); MPDS (11, freemium); NIMS MatNavi (11, cannot ingest); CCDC CSD (11, paid).
**Physics/HEP/math:** INSPIRE-HEP (11); HEPData (11); CERN Repository (11); PDG (11); zbMATH (11); OEIS (11); arXiv (11).
**Astronomy/space:** NASA ADS (11); SIMBAD/VizieR (12); Gaia (12); MAST (12); SDSS (12); Exoplanet Archive (12); MPC (12); JPL Horizons/SBDB (12); CelesTrak (12); Space-Track (12); DISCOS (12); N2YO (12); NOAA SWPC (12); SatNOGS (16).
**Earth/climate/weather:** CDSE (12); USGS Landsat (12); NASA Earthdata CMR (12); JAXA G-Portal (12); INPE STAC (12); ISRO Bhuvan (12); ECMWF CDS (12); NOAA NCEI (12); api.weather.gov (12); Met.no (12); DWD (12); Met Office DataHub (12); JMA feed (12); Open-Meteo (12); OpenWeatherMap (12); OpenTopography (12); GEBCO (12); national mapping Swisstopo/LINZ/PDOK/GA (12); PANGAEA (09); Arctic Data Center/DataONE (16); ONC (16); Smithsonian GVP (16).
**Biodiversity/traits:** GBIF (07); iNaturalist (07); eBird (07); OBIS (07); WoRMS (07); ITIS (07); COL/ChecklistBank (07); POWO (07); IUCN (07); BOLD (07); TRY (07); EOL (07); GloBI (07); PBDB (07); ICTV (07); BacDive/LPSN (07); GRIIS (07); GlobalTreeSearch (07); xeno-canto (16); Movebank (16); Mushroom Observer (16); Wildlife Insights (16).

---

## SECTION M — MEDICAL & HEALTH DATABASES

**Literature/evidence:** PubMed/MEDLINE/PMC via E-utilities (04); Europe PMC (04); PMC OA bulk (04); bioRxiv/medRxiv (13); OpenAIRE health subset (13); BASE (13); IndMED/medIND OAI — follow-up (04 gaps); J-STAGE medical journals (13); CNKI/Ichushi — no open APIs (04 gap).
**Disease/terminology:** WHO ICD API (04); UMLS (04); SNOMED CT (04, licensed); LOINC (04); NCBO BioPortal (04); EBI OLS4 (04); Ontobee/HeGroup (04); Orphanet/ORPHAcodes (04); MedlinePlus (04); Open Targets (04); IHME GBD/GHDx (04).
**Trials/registries:** ClinicalTrials.gov v2 + AACT (04); WHO ICTRP (04, gated); EU CTIS (04); national registries via ICTRP (jRCT/ChiCTR/CTRI/CRiS/ANZCTR/DRKS/IRCT/PACTR/ReBec — search-only individually) (04).
**Drugs/devices/safety:** openFDA (05); RxNorm/RxNav (05); DailyMed (05); AccessGUDID (05); Health Canada DPD (05); EMA + SPOR (05); Orange/Purple Book (05); FAERS (05); VAERS (05); WHO VigiAccess (05); DrugBank (05, paid); PharmGKB (05); NLM ClinicalTables (04, no-auth LOINC alternative); EUDAMED (05, search-only); EudraVigilance adrreports (05, aggregate search-only).
**Public health/indicators:** WHO GHO (04); IHME GBD (04); ProMED (04, paid); HealthMap (04, private); GISAID (04, gated); DHS STATcompiler (14 cross-ref); UNHCR/IOM health-adjacent displacement (14).
**Guidelines:** NICE Syndication (04); WHO IRIS (06, OAI verified); gaps: USPSTF + US/DE/JP/IN national bodies lack APIs (04).
**Traditional/complementary:** COCONUT, NPAtlas, TCMSP, TCMID, SymMap, ETCM, IMPPAT, TKDL (licensed), Dr. Duke, NAEB, MPNS, PROTA4U, UTP, PFAF, SANCDB, KNApSAcK (all 06) — evidence-class tags TRAD/EXP/PRED/NOMEN/CLIN must be preserved per cat06.

---

## SECTION N — CYBERSECURITY DATABASES

**Vulnerability core:** NVD (02/03); CVE Services + cvelistV5 git (03); OSV.dev (02); GHSA (02); GLAD (02); Go VulnDB (02); VulDB (03, paid); JVN/iPedia (03); CNVD/CNNVD (02 gap — no open API).
**Exploitation status/intel:** CISA KEV (02/03); FIRST EPSS (03); Exploit-DB (03); ransomware.live (03); Packet Storm (03 — now paid TI feed).
**Weakness/TTP taxonomies:** MITRE ATT&CK (03); MITRE ATLAS (03, AI-adversary); CWE/CAPEC (03).
**Vendor/distro patches:** MSRC CVRF (02); Ubuntu OVAL (02); Debian Tracker (02); Red Hat Hydra/CSAF/OVALv2 (02); endoflife.date (01/02).
**Malware/IOC/URL:** MalwareBazaar, ThreatFox, URLhaus (03, abuse.ch shared key); VirusTotal (03); Hybrid Analysis (03); ANY.RUN (03); OTX (03); MISP default feeds + CIRCL OSINT (03); PhishStats (03); PhishTank (03, degraded); OpenPhish (03, unverified); Feodo Tracker (03, empty by design → Spamhaus BCL commercial).
**Network/abuse reputation:** AbuseIPDB (03); GreyNoise (03); Shodan + keyless InternetDB (03); Censys (03); Shadowserver free reports API (03 — unverified follow-up).
**National CERT feeds (machine-readable):** CERT-FR MISP/RSS (03); BSI CERT-Bund WID RSS (03); NCSC-NL CSAF ROLIE (03); JVN RSS/RDF (03); KR-CERT (03, no API unverified); CERT-In (03, RSS unverified); NCSC UK (03, scrape only).
**Package-ecosystem security:** deps.dev (01/02); ecosyste.ms (01); Libraries.io (02, freemium); Snyk (02, gated); pyup/Safety (02, freemium); GitHub/GitLab dependency + advisory layers (01/02).

---

## SECTION O — GOVERNMENT SOURCES BY REGION

*Africa: covered by the separate Africa registry — cross-ref `/mnt/agents/output/war_room_africa_api_registry.md` (includes Gallica, Europeana, Internet Archive, HathiTrust, data.bnf.fr cross-refs per cat09 header). Not duplicated here.*

**Asia:** Japan — e-Gov Law API (10); e-Stat (10/14); J-STAGE (13); CiNii (13); NDL Search + IIIF (13); Japan Search (13/16); JVN (03); J-PlatPat search-only (11); BoJ CSV (10); Bhuvan? no (India); JMA feed (12); Aozora (16); JACAR no API (13). Korea — data.go.kr (16); KOSIS (14); KISTI ScienceON (13); KIPRIS Plus (11); Korean DBs search-only (16). China — NBS degraded/undocumented (14); CNIPA captcha (11); flk.npc.gov.cn search-only (10); GSXT captcha (10); CNKI/NSSD/Wanfang no APIs (13/16); NCPSSD free alt (16); GB standards free-to-read (11); CBDB/CHGIS (16, academic). India — eSankhyiki (14); api.data.gov.in (14/16); eGazette search-only (10); Shodhganga OAI (16); Bhuvan (12); CDSCO portal-only (05); CGPDTM no API (11); TKDL (06, licensed). Indonesia — BPS WebAPI (14). Singapore — SingStat (14). Malaysia — data.gov.my (14). Philippines — PSA OpenSTAT (14). Taiwan — data.gov.tw CKAN (14). Saudi — open.data.gov.sa CKAN (14). Israel — CBS API (14). ADB KIDB regional (14).
**Europe:** EU — EUR-Lex/CELLAR (10); TED (10); FSD sanctions (10); FTS (10); BRIS no API (10); Eurostat (14); ECD? ; ECB SDW (10); EMA (05); EPO OPS (11); EUIPO TMview (11, unofficial); ECDC? (not in blocks); Europeana (africa-registry cross-ref). UK — legislation.gov.uk (10); Gazette (10); Companies House (10); OFSI (10); ONS (14); Nomis (14); Met Office (12); NICE (04); ADS (09); TNA Discovery (13 cross-ref); MHRA no API (05). Germany — Gesetze im Internet (10); Destatis GENESIS (14); DDB/Archivportal-D (13); BSI CERT-Bund (03); DWD (12); lobid/GND (15). France — INSEE (14); INPI open tier (11); HAL (13); CERT-FR (03); data.gouv partial archives (13). Italy — Istat (14); CulturaItalia (13). Spain — INE Tempus3 (14); datos.bne.es (13). Netherlands — CBS StatLine (14); PDOK (12); KB Delpher (13); NCSC-NL (03). Sweden — SCB (14); LIBRIS (13). Norway — SSB (14); NB (13); Met.no (12); BR register (10 gaps note). Denmark — StatBank (14); SMK (13). Finland — StatFin (14); Finna (13). Poland — GUS BDL (14); Polona (13). Czechia — CZSO CKAN (14); NKP Kramerius (13). Switzerland — Swisstopo (12); e-periodica (09); swisscovery key (13). Austria — ANNO (09). Russia — Rosstat fedstat (14, geo-degraded); CyberLeninka (13); eLibrary paid (13); MPDS (11); pravo.gov.ru UI-only (10).
**Latin America:** Brazil — Portal da Transparência (10); IBGE SIDRA (14); INPE STAC (12); INPI weekly RPI XML (11); Câmara/Senado dados abertos (10 follow-up); BN Brasil no API (13). Chile — Mercado Público (10); Memoria Chilena no API (09). Mexico — INEGI BIE/BISE/DENUE (14); HNDM no API (09). Argentina — Series API (14); BN Argentina no API (13). Colombia — datos.gov.co Socrata (14). Regional — ECLAC CEPALSTAT (14); IDB Socrata (14); SciELO (13); Redalyc (13); LA Referencia (16); CLACSO (16); AtoM archives (13); dLOC (09, verify); OCDS publishers incl ProZorro? (Ukraine — Europe; ProZorro standout per 10).
**Middle East:** Qatar — QDL IIIF (09, anti-bot caveat); Saudi — open.data.gov.sa (14), uqn search-only (10); UAE — FCSC portal-only (14); Türkiye — TurkStat bulk (14), Millî Kütüphane no API (13); Israel — CBS (14), NLI (09); Iran — Noorlib unverified (16); Ottoman Devlet Arşivleri no API (16).
**North America:** US — Congress.gov (10); GovInfo (10); Federal Register (10); CourtListener (10); SEC EDGAR (10); USAspending (10); OFAC (10); Census (14); EIA (14); FRED (10); BLS? (not in blocks); NARA (13); FDA/openFDA/DailyMed/GUDID/VAERS (05); ClinicalTrials.gov (04); NCBI/NLM (04/08); USGS (12); NOAA NCEI/SWPC (12); NWS (12); NASA (11/12); USPTO ODP/TSDR (11); NIST (11); Smithsonian GVP (16); ONC? (Canada); FEC candidate (10). Canada — Justice Laws (10); StatCan WDS (14); Health Canada DPD (05); BoC Valet (10); ONC (16).
**Oceania:** Australia — FRL OData (10); ABS SDMX (14); IP Australia (11); Trove (13); RecordSearch degraded (13); ADHA feed (04); Geoscience Australia (12). New Zealand — Stats NZ (14); LINZ (12); DigitalNZ (13/16); Te Papa (13). Pacific — PARADISEC (16); Digital Pasifik no API (09); SPC SDD follow-up (14).
**International:** UN SDG (14); UN DESA WPP (14); UNHCR (14); UN Treaty Collection (10); UN SC sanctions (10); UNdata (14); UNESCO UIS (14); UNICEF (14 cross-ref); WHO GHO (04); WHO ICD (04); WHO ICTRP (04); WHO IRIS (06); WHO VigiAccess (05); ILO NORMLEX/NATLEX + ILOSTAT (10); FAOLEX (10); FAOSTAT (14 cross-ref); WTO (10/14); IMF (14 cross-ref); World Bank (14 cross-ref); UN Comtrade (10/14 cross-ref); BIS (10); OECD (14); IEA (14); IOM DTM (14); OCHA FTS/HDX (14); ReliefWeb (14); IATI (14); Interpol notices (10, degraded); WIPO Lex (10); WIPO PATENTSCOPE/IPstats (11/14, paid); ICTV (07); GLEIF (10); IFES (10); IDEA (10).

---

## SECTION P — UNIQUE SOURCES (no functional substitute anywhere else)

Per the blocks' own uniqueness claims:
- **Software Heritage** (01): only universal deduplicated source-code archive with persistent SWHIDs; recovers deleted code.
- **deps.dev** (01/02): computed resolved dependency graphs + hash→artifact forensics.
- **Debian snapshot** (01): distro-history time travel back to 2005.
- **endoflife.date** (01/02): only cross-vendor EOL/lifecycle normalization.
- **grep.app** (01): fastest free cross-repo regex code search (post-Sourcegraph).
- **Rosetta Code** (01): task×language matrix (1,200+ tasks × 900+ languages).
- **Homebrew JSON** (01): unique macOS package + install analytics.
- **CISA KEV** (02/03): only authoritative actively-exploited + ransomware-flag list.
- **EPSS** (03): only open exploit-prediction model across all CVEs.
- **Go VulnDB** (02): symbol-level affected-function data.
- **MSRC** (02): definitive CVE→KB→build mapping incl backports; **Red Hat Hydra** (02): backport-aware fixed versions; **Debian Tracker** (02): no-dsa triage rationales.
- **MITRE ATLAS** (03): only structured AI-adversary KB.
- **GreyNoise RIOT** (03): unique noise-vs-targeted + benign dataset; **MalwareBazaar** (03): only vetted confirmed-malware corpus with free samples.
- **WHO ICTRP** (04): only unifier of 17+ national trial registries (800k+).
- **WHO ICD API** (04): only official global morbidity/mortality coding system with API.
- **MedlinePlus Connect** (04): only consumer KB queryable by clinical codes.
- **Open Targets** (04): only open integrated target–disease–drug scored evidence graph.
- **GISAID** (04): largest curated respiratory-virus genomes (16M+, gated).
- **IHME GBD** (04): definitive comparable burden estimates (371 diseases, 204 countries).
- **AccessGUDID** (05): only authoritative US UDI device master data; **Health Canada DPD** (05): only official Canadian marketed-product feed; **VAERS** (05): only full-narrative open vaccine-safety corpus; **WHO VigiAccess** (05): only global cross-national ADR aggregation; **Orange Book** (05): patent/exclusivity + TE codes nowhere else open; **PharmGKB** (05): only machine-readable CPIC/DPWG dosing guidelines.
- **SymMap** (06): only structured TCM↔modern symptom bridge; **MPNS** (06): only authoritative multilingual medicinal-plant name authority; **TKDL** (06): world's largest codified Indian TM prior-art corpus (licensed); **SANCDB** (06): sole referenced South African NP set; **NAEB** (06): definitive indigenous N. American plant medicine.
- **BOLD** (07): only global curated DNA-barcode reference library; **GloBI** (07): only global open food-web/interaction graph; **PBDB** (07): only global fossil-occurrence graph; **GRIIS** (07): only expert-verified national invasive checklists; **ICTV** (07): sole official virus taxonomy; **IUCN RL** (07): only authoritative extinction-risk assessment; **TRY** (07): largest curated plant-trait compendium; **BacDive/LPSN** (07): only standardized bacterial phenotypes + official prokaryote nomenclature; **BirdLife IBA/KBA** (07): unique site layer (no API).
- **gnomAD** (08): largest population-frequency API; **AlphaFold DB** (08): only proteome-scale predictions; **Cellosaurus** (08): de-facto cell-line authority incl misidentified registry; **KEGG KO** (08): unique orthology + curated maps (license-restricted); **ORCS** (08): only large curated CRISPR-screen repo.
- **WHG** (09): global temporal gazetteer backbone; **PeriodO** (09): only cross-disciplinary period authority; **Cliopatria** (09): only open global polity-boundary time series; **Seshat** (09): largest expert-coded quantitative history; **impresso** (09): unique NLP stack over 40M+ historical newspaper articles; **NLI** (09): only API to global historical Jewish press; **EHRI** (09): unique transnational Holocaust-archive integration; **EDH** (09): largest open Latin epigraphy; **CDLI/eBL** (09): authoritative cuneiform KBs.
- **GLEIF** (10): only global LEI resolver with corporate trees; **USAspending** (10): award-level outlays + full DB dump; **TED** (10): complete EU procurement funnel; **Brazil CEIS/CEPIM/CEAF** (10): unique LatAm integrity registers; **IFES** (10): only global forward-looking election calendar API; **FRED/ALFRED** (10): vintage/revision data; **BIS** (10): unique international banking statistics; **UN Treaty Collection** (10): sole authoritative depositary record; **UN SC list** (10): baseline sanctions.
- **HEPData** (11): only machine-readable HEP plot data; **PDG** (11): authoritative particle world averages; **OEIS** (11): unique integer-sequence knowledge; **EPO OPS INPADOC** (11): best free global patent family/legal status; **TM-Link (IP Australia)** (11): cross-jurisdiction linked trademarks; **INPI patents-by-SIREN** (11): patent-to-company linkage; **SuperCon/NIMS** (11): unique superconductor corpus (unreachable legally).
- **Overture GERS** (12): stable global geo-entity UUIDs; **Mapillary** (12): only open global street-level imagery; **ONC** (16): unique cabled deep-sea observatory; **JAXA G-Portal** (12): only free global L-band SAR; **DISCOS** (12): physical properties of 40k+ space objects; **NASA Exoplanet Archive** (12): canonical exoplanet census w/ provenance; **Space-Track CDM** (12): only authoritative conjunction data; **JMA feed** (12): authoritative Japan early warning.
- **Trove** (13): Australian newspaper OCR full text; **Japan Search** (13/16): only cross-domain Japanese national portal; **NB Norway DH-lab** (13): full legal-deposit corpus incl broadcast; **KB Delpher** (13): best European bulk newspaper corpus w/ ALTO; **KISTI** (13): authoritative Korean S&T corpus.
- **UN DESA WPP** (14): canonical demographic projections; **UNHCR** (14): authoritative displacement incl statelessness; **IOM DTM** (14): subnational IDP near-real-time; **OCHA FTS** (14): only systematic humanitarian funding tracker; **AidData GCDF** (14): unique project-level Chinese development finance; **INEGI DENUE** (14): Mexican business microdirectory; **data.gov.my** (14): parliament/DUN-level Malaysian demographics.
- **Kaikki** (15): THE machine-readable Wiktionary; **BabelNet** (15): 600-language synset alignment; **FrameNet** (15): unique frame-semantic annotations; **ConceptNet** (15): multilingual commonsense incl CJK; **Common Crawl** (15): only open web-scale crawl; **IA/Wayback** (15): web time travel; **Diffbot** (15): largest continuously-crawled commercial KG.
- **Local Contexts Hub** (16): only machine-readable indigenous data-sovereignty labels; **OpenSky** (16): largest open ADS-B archive; **xeno-canto** (16): largest open bird-sound corpus; **Movebank** (16): unique open wildlife telemetry; **SatNOGS** (16): only open satellite-observation network API; **AILLA** (16): unique Amazonian/Mesoamerican community-controlled archive; **PARADISEC** (16): primary Pacific/Papuan recordings archive (1,366 languages); **Shodhganga** (16): unique Indian PhD mass; **CBDB+CHGIS** (16): pre-modern China bio/geo backbone; **Shamela** (16): largest classical Arabic corpus.

---

## SECTION Q — OVERLAP & REDUNDANCY MAP (primary source per function)

| Function | Primary | Redundant/secondary (treatment) |
|----------|---------|--------------------------------|
| Biomedical abstracts | Europe PMC (04) | PubMed via E-utilities (04 — authoritative MeSH; keep both, EPMC superset) |
| CVE publication | CVE Services/cvelistV5 git (03 — fastest) | NVD (02/03 — canonical scoring; query layer); OSV (02 — aggregator); VulDB (03 — paid long tail) |
| Package advisories | OSV.dev (02) | GHSA (02 — version ranges), GLAD (02 — MIT clone), Go VulnDB/RustSec/PyPA (fully mirrored into OSV — do NOT integrate separately) |
| EOL dates | endoflife.date (01/02) | vendor pages (not machine-readable) |
| Drug interactions | RxNav Interaction API (05, free) | DrugBank (05 — paid, deeper); DIKB dead (05) |
| Bioactivity | ChEMBL (05) | BindingDB (05 — measured affinities), GtoPdb (05 — curated depth), DrugCentral (05) |
| NP structures | COCONUT (06 — aggregates 63 sources incl TCM-ID, SANCDB, Dr Duke) | NPAtlas (06 — microbial), LOTUS→Wikidata (06), ChEBI (06) — COCONUT primary, others for provenance |
| Species occurrences | GBIF (07) | iNaturalist/eBird (07 — feed GBIF; use APIs for freshness), OBIS (07 — marine + env data) |
| Taxonomy | Catalogue of Life/ChecklistBank (07) | NCBI Taxonomy (07 — genomics joins), WoRMS (marine), ITIS, POWO, ICTV (viruses), LPSN (prokaryotes), Index Fungorum → MycoBank/ChecklistBank |
| Pathways | Reactome (08, open) | KEGG (08 — license-restricted primary content), WikiPathways (08 — CC0), STRING (08) |
| PPI | STRING (08) | BioGRID (08 — curated experimental), IntAct (08 — richest detail) |
| Structures | RCSB PDB (08) | AlphaFold DB (08 — predicted complement) |
| INSDC sequences | NCBI (08) | ENA (08 — richest metadata search), DDBJ (08 — Asian node) — synchronized daily; pick per feature |
| Metabolomics | Metabolomics Workbench (08) | MetaboLights (08), HMDB (08 — download-only) |
| Ontologies (biomed) | OLS4 (04/08, keyless) | BioPortal (04 — Annotator unique), Ontobee (04), UMLS (04 — licensed crosswalks) |
| Scholarly graph | OpenAlex/Crossref/S2 (registered elsewhere) | OpenAIRE (13 — EU grants), OpenCitations (13 — open citations), BASE (13), Data Commons? no |
| Citation graph (open) | OpenCitations (13) | NASA ADS (11 — astro), INSPIRE (11 — HEP), Europe PMC citations (04), Lens (11 — paid) |
| Preprints | arXiv (11) | bioRxiv/medRxiv (13 — bio/med), Europe PMC preprints (04) |
| Economics literature | RePEc (13) | EconStor (13 — harvests RePEc handles; OAI primary) |
| Japanese scholarship | J-STAGE (13) + CiNii (13) + NDL (13) | Japan Search (13/16 — cultural cross-domain) |
| Russian OA | CyberLeninka OAI (13) | eLibrary (13 — paid API) |
| Company identity | GLEIF LEI (10) | OpenCorporates (10 — search breadth), Companies House (10 — UK primary), SEC EDGAR (10 — US filers), INPI RNE (11 — FR), INEGI DENUE (14 — MX) |
| Sanctions | Primary lists: OFAC, EU FSD, UN SC, UK OFSI (10) | OpenSanctions (10 — normalized convenience layer; use primaries for compliance); Interpol via OpenSanctions (10 — direct API degraded) |
| Procurement | OCDS registry (10) | TED (10 — EU), USAspending (10 — US), Mercado Público (10 — CL), ProZorro (10 — UA) |
| Legislation EU | EUR-Lex SPARQL (10) | CELLAR bulk (10), national gazettes |
| Patent families | EPO OPS (11) | Google Patents BQ (11 — full text/MT), Lens (11 — paid), PatentsView (11 — paused), national registers (KIPRIS free; J-PlatPat/CNIPA blocked) |
| Gazetteer | GeoNames (12/15) | OSM/Nominatim (12), Overture places (12), WHG (09 — temporal), iDAI/Pleiades (09 — ancient), GADM (14 — admin boundaries; geoBoundaries open alt), OurAirports (16 — airports) |
| Street map | OSM Planet/Overpass (12) | Overture (12 — fused, GERS ids), national mapping gold standards (12) |
| Weather obs | NOAA NCEI (12) | Met.no Frost (12), DWD (12), national APIs (12) |
| Climate reanalysis | ECMWF ERA5 (12) | Open-Meteo archive (12 — wraps ERA5/others, zero-auth) |
| Satellite catalog | Space-Track (12) | CelesTrak (12 — keyless mirror), DISCOS (12 — physical props), N2YO (12 — convenience) |
| Ephemerides | JPL Horizons (12) | MPC (12 — minor planets), SBDB (12) |
| Object names (astro) | SIMBAD (12) | NED (not in blocks), ADS (11 — literature) |
| Encyclopedic | Wikipedia/Wikidata (15) | DBpedia/YAGO (15 — structured extracts), Britannica (15 — no API), Golden/Diffbot (15 — paid) |
| Dictionaries | Kaikki (15) | WordNet/OEWN (15 — lexical graph), JMdict/CC-CEDICT (15), MW (15 — non-commercial), BabelNet (15) |
| Web search | Brave (15) | Mojeek (15), Bing (15 — DISCONTINUED 2025-08-11 → Azure grounding only) |
| Web archive | IA Wayback (15) | Common Crawl (15 — research corpus, not replay) |
| Indian gov data | api.data.gov.in (14/16) | eSankhyiki (14 — MoSPI primary), eGazette (10 — no API) |
| Aid flows | OECD DAC CRS (14) | IATI (14 — project-level), AidData (14 — China), FTS (14 — humanitarian) |
| Traditional-medicine names | MPNS (06) | POWO (07), IMPPAT (06 — Ayurvedic phytochem) |

**Status disagreements noted between reports (trust the live-probed claim):** (a) libraries.io — cat01 lists it as discontinued/sunset (successor ecosyste.ms); cat02 verified it alive 2026 with Tidelift→Sonar banner: treat as alive-but-unstable, prefer ecosyste.ms. (b) CyberLeninka — cat16 calls it search-only; cat13 verified OAI-PMH Identify 200 (2026-08): treat OAI as working. (c) QDL — cat09 Tier A IIIF; cat16 notes anti-bot making it effectively search-only for machines: implement IIIF with browser-like UA + fallback. (d) deps.dev env name differs (WARROOM_DEPS_DEV_API_URL vs WARROOM_DEPSDEV_API_URL) — canonicalize in Section V. (e) endoflife.date product count 380+ (cat01) vs 460+ (cat02) — count drift, not functional. (f) CISA KEV size ~1,400 (cat02) vs ~1,500+ (cat03). (g) GeoNames free quotas 1,000 credits/hr & 20k/day (cat12) vs 2,000/hr & 30k/day (cat15) — verify at signup. (h) DigitalNZ key: required (cat16) vs optional since 2026 (cat13) — treat optional.

---

## SECTION R — GEOGRAPHIC BLIND SPOTS (9-region audit)

Consolidated from cat16 regional summary + every GAPS section (01–16).

| Region | Strength | Weak / missing machine access |
|--------|----------|-------------------------------|
| **Africa** | Covered by separate Africa registry (`/mnt/agents/output/war_room_africa_api_registry.md`) | Per cat12: no operational African national mapping/EO API (Regional Data Cube = sandbox; SANSA limited) — rely OSM/Overture/Copernicus. Per cat10: gazettes scan-only. Per cat06: traditional-use DBs (PRELUDE, national pharmacopoeias) PDF/search-only beyond PROTA/SANCDB. Per cat08: H3Africa controlled via EGA; rely on INSDC mirrors |
| **East Asia** | STRONG (16): Japan Search LOD, data.go.kr, KOSIS, e-Stat, J-STAGE, CBDB/CHGIS, Aozora | China is the biggest single-country gap (14): NBS undocumented + WAF 403, some series suspended since 2023; CNKI/Wanfang/CQVIP/NSSD no APIs (13/16); CNIPA CAPTCHA (11); GSXT captcha (10); flk.npc.gov.cn search-only (10); CNSA/CLEP + FengYun search-only Chinese UI (12); NGDC/CNCB genomics no documented REST (08/16); CVH/NSII biodiversity no REST (07); Chinese KGs outside-CN unverified (15); npmmirror unverified (01). Taiwan: Airiti/NCL no APIs (13); DGBAS no native API (14). Korea: DBpia/RISS/NLK no APIs (13); KISTI Korean-gated/migrating (13); Korean History DB geo-blocked (16); KR-CERT no API (03). Hong Kong/Mongolia stats portal-only (14) |
| **South Asia** | MODERATE (16): eSankhyiki, data.gov.in (geo-blocked), Shodhganga OAI, BPS/SingStat-style neighbors | Geo-blocking from non-IN egress: Shodhganga, data.gov.in, indianculture.gov.in (16) — verify in-region. No national newspaper/book API; NDLI undocumented (09). Indian Culture Portal no API (16). eGazette no API (10). CGPDTM no API (11). CDSCO portal-only (05). Pakistan PBS, Bangladesh BBS, Sri Lanka DCS, Nepal CBS portal/xlsx only (14). IndMED/medIND OAI follow-up (04). Iran SCI portal-only (14) |
| **Southeast Asia** | BPS Indonesia, SingStat, data.gov.my, PSA OpenSTAT verified (14) | Thailand NSO no current dev docs (14); Vietnam GSO PX-Web unverified/unreachable (14); Myanmar portal-only (14); Sentinel Asia members-only (12) |
| **Middle East** | QDL (09, anti-bot), NLI (09), Israel CBS (14), Saudi CKAN (14), Shamela bulk (16) | WEAK (16): no open legal/gazette APIs — Saudi uqn, UAE portal search-only (10); UAE FCSC, Qatar PSA, Jordan DoS, Kuwait CSB portal-only (14); TurkStat WAF 403 (14); Millî Kütüphane no API (13); no Arabic national-library channel (13); Arabic press no national API (09); Devlet Arşivleri (Ottoman) no API (16); Noorlib Iran unverified (16); Arabic dictionaries no open machine-readable standard (15); UAE/KSA geoportals unverified (12); Arabic CERT feeds none (03) |
| **Europe** | Strongest overall: EU + national stats/law/GLAM APIs ubiquitous (10/13/14) | Ukraine war-degraded stats (14); Belarus, non-EU Balkans unverified (14); Russia: fedstat 403 WAF from non-RU IP (14), pravo.gov.ru UI-only (10), RSL/RUNEB no APIs (13), Roscosmos/RosHydromet no open APIs (12), eLibrary paid-only (13) — CyberLeninka OAI the one open island (13); Hungaricana/NKP/BN Portugal OAI unverified from sandbox (13); Archives nationales France partial CSVs only (13); CURIA no API (10) |
| **Latin America** | STRONG metadata (16): LA Referencia, CLACSO, SciELO, Redalyc, DOAB; Mercado Público, Brazil Transparência, IBGE, INEGI, datos.gov.co, Argentina Series (10/14) | HIGHEST-priority gap (09): no machine-accessible national newspaper archive — HNDM Mexico, Hemeroteca Brasileira, Memoria Chilena all no API. National libraries Brasil/México/Argentina no APIs (13). Chile INE, Peru INEI, Ecuador INEC, Bolivia, Paraguay, Venezuela no cell-level stats API (14). Most LatAm IP offices no APIs; INPI Brazil weekly XML the good path (11). Amazonian indigenous medicine no structured DB (06 — AILLA audio partial) |
| **North America** | Densest official API coverage globally (04/05/10/11/12/13/14) | Mexico HNDM (see LatAm). Canada: no gaps flagged beyond Health Canada multi-call joins (05). US: court coverage good via CourtListener; FEC candidate next wave (10) |
| **Oceania/Arctic** | STRONG (16): Trove, DigitalNZ, PARADISEC, Te Papa, ABS, Stats NZ (migration in flux 2026), LINZ; Arctic: ADC/DataONE, ONC, GVP/NCEI | Pacific island NSOs only via SPC SDD — follow-up (14); Digital Pasifik no API (09); RecordSearch NAA degraded, Anzacs API dead (13); Stats NZ Infoshare retiring from late 2026 — flux (14); Stats NZ NZ.Stat disconnected 2024 (14) |

Cross-cutting geo-block / egress list (verify from in-region egress): Shodhganga, data.gov.in, indianculture.gov.in (IN); contents.koreanhistory.or.kr (KR); Rosstat fedstat (RU); China NBS (CN); Japan Search 403 to datacenter IPs — needs browser-like UA or JP egress (16); US Census sandbox geo-block noted (14); CEPALSTAT/Israel CBS sandbox-blocked only (14).

---

## SECTION S — DOMAIN BLIND SPOTS (consolidated from every GAPS section)

1. **Symptom/diagnostic APIs (04):** none open at authority level — Infermedica/Isabel commercial; closest free: openFDA drug/event, NLM ClinicalTables, MedlinePlus Connect.
2. **Medical imaging findings (04):** no free official API (Radiopaedia closed; RadLex only via BioPortal).
3. **Clinical guidelines beyond UK (04):** WHO IRIS OAI verified (06) but USPSTF, US/DE/JP/IN national guideline bodies have no APIs.
4. **Drug pricing (05):** NO global open drug-pricing API (WHO MiND web-only). Also no dedicated withdrawn-drugs API — use EMA dataset/DrugCentral flags/ChEMBL drug_warning/NDC discontinued.
5. **Regulatory device/drug APIs missing (05):** EUDAMED, PMDA/JADER, CDSCO, NMPA, MHRA, WHO Prequalification — none.
6. **Traditional medicine (06):** no open codified Ayurvedic-formulation API (TKDL NDA); no Amazonian/S. American indigenous-medicine DB; African traditional use PDF/search-only; Russian/Central Asian & Arabic/Unani corpora manuscript-only.
7. **Ecosystems/biomes (07):** no unified REST — IUCN Global Ecosystem Typology + WWF ecoregions bulk-only. No public APIs for BirdLife, POWO, Index Fungorum, TRY, BGCI, ICTV.
8. **CRISPR perturbation (08):** no high-quality open REST — DepMap download-only, ORCS key-gated; LINCS CLUE unverified.
9. **Breaking-changes/regression knowledge (02):** genuine infra gap — only issue trackers + deps.dev approximate it.
10. **Standards full text (01/11):** ISO/IEC/ASTM/DIN/JIS/GB have no APIs and are paid/restricted; ECMA no API; IEEE text paywalled; only ETSI/ITU-T (11) and IETF/W3C metadata (01) are free. GB mandatory standards free-to-read but no API.
11. **Patent legal status JP/CN (11):** J-PlatPat and CNIPA have no public APIs; India CGPDTM + most African/LatAm IP offices none. Crossref-quality patent citations: Lens paid, PatentsView paused, OPS quota-limited.
12. **Chemistry experimental properties (11):** NIST WebBook search-only, TRC paywalled; IUPAC no data API; NIMS legally unreachable.
13. **Court data outside US (10):** CURIA no API; CELLAR RDF partial; most national judiciaries none.
14. **Company registers at scale (10):** China GSXT captcha; EU BRIS explicitly no API; commercial aggregators fill the gap — GLEIF + UK CH + FR INPI + Norway BR best free paths.
15. **Tax law (10):** no global API (IBFD/Orbitax commercial; OECD Tax DB candidate).
16. **Election results microdata (10):** no global standard; IFES calendar + IDEA turnout the best available.
17. **Census microdata (14):** IPUMS the main route; most NSOs application/CD only.
18. **National statistics portals without APIs (14):** China NBS (biggest), TurkStat, Thailand, Vietnam, Pakistan, Bangladesh, Sri Lanka, Nepal, Iran, Mongolia, Myanmar, UAE, Qatar, Jordan, Kuwait, Chile, Peru, Ecuador, Bolivia, Paraguay, Venezuela, Ukraine (war-degraded), Belarus, Taiwan DGBAS (CKAN workaround), Pacific islands (SPC SDD route).
19. **Historical newspaper APIs (09):** LatAm none (highest priority); South Asia none; China modern press commercial-only; Russia/CIS none; Arabic press none; Korean Naver News Library commercial; Europe covered (Trove/Delpher/ANNO/impresso/e-periodica patterns).
20. **Paleoanthropology (09):** no hominin fossil/occurrence API (PBDB closest). National archaeological site registers (HERs, Canmore) no APIs — ARIADNE workaround. eHRAF subscription/no API confirmed.
21. **Global event/timeline infrastructure (09):** none open beyond Seshat/Wikidata (GeaCron commercial).
22. **CERT/vuln feeds by region (02/03):** no machine-accessible Chinese (CNNVD paywalled, CNVD none), Russian, Indian (CERT-In unverified), Korean, Arabic CERT feeds.
23. **Environmental/EO by region (12):** China CNSA/FengYun, Russia Roscosmos/RosHydromet, Africa national mapping, UAE/KSA geoportals — all search-only/absent. India Bhuvan layer inventory undocumented; MOSDAC portal-only. Met Office regional text forecasts + daily extremes lost with DataPoint retirement (Dec 2025) — UK weather-text gap.
24. **Astronomy transient brokers (12):** ZTF/LSST brokers (ANTARES/AMPEL/Fink) need follow-up — not yet registry-grade.
25. **Lexical (15):** Arabic dictionaries no open standard; Chinese KGs unverified outside CN; no verified Russian encyclopedic API; Britannica no API confirmed.
26. **Discussion/social corpora (15):** Pushshift revoked 2023; successors (Arctic Shift, PullPush, Academic Torrents) unverified; Reddit restricted + no historical search.
27. **Package metadata gaps (01):** pkg.go.dev has no official API (scrape-only); Maven full rsync closed 2023; PyPI no search endpoint.
28. **Genomics regional (08):** China NGDC/CNCB thin; Russia none; Africa/LatAm INSDC-mirror-dependent; H3Africa controlled (EGA).
29. **Indigenous-language infra (16):** OLAC in DELAMAN rebuild 2025/26 — discovery layer temporarily degraded.
30. **Weather/climate warnings beyond US/JP/EU (12):** most national meteorological services (Africa, Middle East, Central Asia, LatAm) have no open alert APIs.

---

## SECTION T — RECOMMENDED INTEGRATION SEQUENCE (waves 1–6)

**Wave 1 — Identifier & entity spine (weeks 1–3).** Wikidata + Wikipedia (15); ORCID, ROR, VIAF, ISNI, lobid (15); GeoNames + OSM/Nominatim + Overture GERS (12); GLEIF (10). *Rationale:* every later record needs a join key (QID, ORCID, ROR, geonameid/GERS, LEI). No credentials needed except GeoNames username. *Depends on:* nothing.

**Wave 2 — Core live knowledge (weeks 3–8).** NCBI E-utilities + Europe PMC + ClinicalTrials.gov (04); openFDA + RxNorm + DailyMed + PubChem (05); GBIF + COL + WoRMS (07); UniProt + Ensembl + RCSB (08); OSV + NVD + CISA KEV + cvelistV5 git (02/03); GitHub + GHSA (01/02); PyPI + npm + crates.io (01); arXiv (11). *Rationale:* highest query volume; all free, mostly keyless; bulk patterns (zip/FTP/OAI) established here are reused later. *Depends on:* Wave 1 ID spine (QID↔PMID/DOI/RxCUI mappings).

**Wave 3 — Government, law, money, stats (weeks 8–14).** Congress.gov + GovInfo + Federal Register + legislation.gov.uk + EUR-Lex (10); SEC EDGAR + USAspending + Companies House + OpenSanctions + primary sanctions lists (10); FRED + ECB + BIS (10); Eurostat + OECD + UN SDG + WPP + US Census + e-Stat + KOSIS + IBGE + INEGI + StatCan (14/10); ReliefWeb + OCHA FTS + UNHCR (14); TED + USAspending procurement + OCDS (10). *Depends on:* Wave 1 (LEI/geonameid joins); SDMX client built once at Eurostat unlocks OECD/BIS/ECB/ABS/StatsNZ.

**Wave 4 — Science, earth, space (weeks 14–20).** INSPIRE + NASA ADS + zbMATH + PDG (11); Materials Project + NOMAD + OQMD (11); EPO OPS + USPTO ODP + KIPRIS + IP Australia (11); CDSE + Landsat + Earthdata CMR + ECMWF CDS + NOAA NCEI + DWD + Met.no (12); Space-Track + CelesTrak + DISCOS + SWPC (12); SIMBAD/VizieR + Gaia + Exoplanet TAP + MPC + MAST (12); ChEMBL + PharmGKB + GtoPdb + BindingDB (05); gnomAD + STRING + Reactome + BioGRID + IntAct + ENA + PRIDE (08); IUCN + OBIS + BOLD + ICTV + BacDive/LPSN + PBDB + GloBI + EOL (07); COCONUT + ChEBI + WHO IRIS (06). *Depends on:* Waves 1–2 (protein/chemical/species IDs).

**Wave 5 — Culture, history, regional (weeks 20–28).** OpenAIRE + OpenCitations + HAL + BASE + RePEc + EconStor (13); J-STAGE + CiNii + NDL + Japan Search + KISTI (13); SciELO + Redalyc + LA Referencia + CLACSO + DOAB (13/16); Trove + DigitalNZ + DDB + LIBRIS + Finna + NB + Delpher + bne.es + NARA (13); museum APIs AIC/Cleveland/V&A/SMK/Te Papa/Wellcome (13); WHG + Pleiades + PeriodO + Seshat + Cliopatria + EDH + CDLI + PANGAEA + ARIADNE (09); CBDB + CHGIS + Aozora + Shamela + OpenITI + GRETIL (09/16); PARADISEC + Pangloss + AILLA + OLAC (16); data.go.kr + data.gov.in + BPS + SingStat + data.gov.my + PSA + CEPALSTAT + IDB (14/16); TCMSP/IMPPAT/SymMap/ETCM mirrors (06 — mirror immediately per fragility warning); Movebank + xeno-canto + OpenSky + SatNOGS + ONC + GVP (16). *Depends on:* Waves 1–3; in-region egress where geo-blocked (Section R).

**Wave 6 — Commercial, gated & hard (as budget/approvals land).** DrugBank academic (05); KEGG FTP (08); VulDB (03); VirusTotal/Shodan/Censys/GreyNoise community tiers (03); OpenCorporates (10); Lens trial (11); Google Patents BQ (11); IEEE metadata (11); MPDS (11); IEA free tier (14); Brave/Mojeek free tiers (15); Diffbot trial (15); Reddit builder ticket (15); WHO ICTRP crawl credentials (04); GISAID DAA (04); ProMED subscription (04); NICE licence (04); SNOMED affiliate (04); TKDL evaluation (06); Seshat/impresso approvals (09); IFES token (10); WIPO PATENTSCOPE decision — defer, use EPO OPS (11). *Depends on:* everything above; each gated source now has its fallback already live (Section Q).

Cross-wave hygiene: (a) migration watch items must be re-verified before each wave — PMC OA→AWS (04), WHO GHO azureedge→data.who.int (04), Ensembl beta (08), USPTO ODP/PatentsView (11), CDSE STAC v1 (12), OpenAIRE Graph API (13), Stats NZ (14), ChEBI 2.0 API surface (06), xeno-canto v3 (16), OLAC rebuild (16); (b) mirror fragile single-host sources on first contact (06 list + NAEB broken TLS).

---

## SECTION U — PROVIDER/ROUTER ARCHITECTURE (canonical source per entity type + fallback chains)

Routing rule: resolve the entity to its canonical ID first (via Wave-1 spine), then query the primary; fall back in order; record license class per Section F/G before caching.

| Entity type | Canonical (primary) | Fallback chain |
|-------------|--------------------|----------------|
| Person (researcher) | ORCID (15) | Wikidata (15) → VIAF (15) → DBLP (15, CS) → INSPIRE BAI (11, HEP) → ISNI (15) |
| Person (historical/pre-modern) | Wikidata (15) | VIAF (15) → FactGrid (15, pre-1900 EU) → CBDB (16, China) → lobid/GND (15) |
| Organization | ROR (15) | GLEIF LEI (10) → Wikidata (15) → lobid (15) → OpenCorporates (10) |
| Company (registry facts) | GLEIF (10) + national register | UK: Companies House (10); US filers: SEC EDGAR (10); FR: INPI RNE (11); MX: INEGI DENUE (14); global search: OpenCorporates (10); BR integrity: Transparência CEIS (10) |
| Drug (small molecule) | RxNorm RxCUI (05) | PubChem CID (05) → DrugCentral (05) → ChEMBL (05) → DrugBank (05, licensed) → DailyMed SPL (05, labels) |
| Drug (regulatory status) | openFDA/Drugs@FDA (05) | EMA dataset (05) → Health Canada DPD (05) → Orange Book (05) |
| Chemical | PubChem (05) | ChEBI (06) → ChEMBL (05) → COCONUT (06, NP) → NIST WebBook (11, search-only) |
| Disease | WHO ICD (04) | UMLS CUI (04) → Orphanet ORPHA (04, rare) → MeSH via NCBI (04) → MONDO via OLS4 (04) |
| Clinical trial | ClinicalTrials.gov NCT (04) | WHO ICTRP (04, gated) → EU CTIS (04) |
| Species/taxon | GBIF + COL (07) | NCBI Taxonomy (07) → WoRMS (07, marine) → ITIS (07) → POWO (07, plants) → ICTV (07, virus) → LPSN (07, prokaryote) |
| Species occurrence | GBIF (07) | iNaturalist (07) → eBird (07) → OBIS (07, marine) → BOLD (07, barcode) |
| Gene/protein | UniProt (08) | NCBI Gene (08) → Ensembl (08) → AlphaFold/RCSB (08, structure) |
| Variant | ClinVar via NCBI (08) | dbSNP (08) → gnomAD (08, frequency) |
| Place (modern) | GeoNames (12/15) | OSM/Nominatim (12) → Overture GERS (12) → GADM (14, boundaries) → national mapping (12) |
| Place (historical) | WHG (09) | Pleiades (09, ancient) → iDAI.gazetteer (09) → CHGIS (16, China) → OpenHistoricalMap (09) |
| Vulnerability | CVE: NVD (02/03) | CVE Services/cvelistV5 (03) → OSV (02, ecosystem view) → GHSA (02) → VulDB (03, pre-CVE) → JVN (03, JP) |
| Exploit status | CISA KEV (02/03) | EPSS (03, probability) → Exploit-DB (03, PoC) → ThreatFox/URLhaus (03, live IOCs) |
| Paper | DOI via Crossref/OpenAlex (registered elsewhere) | Europe PMC (04) → OpenAIRE (13) → BASE (13) → HAL (13, FR) → J-STAGE/CiNii (13, JP) → SciELO/Redalyc (13, LatAm) → CyberLeninka (13, RU) |
| Citation | OpenCitations (13) | NASA ADS (11) → INSPIRE (11) → Lens (11, paid) |
| Patent | EPO OPS (11) | Google Patents BQ (11) → USPTO ODP (11, US) → KIPRIS (11, KR) → IP Australia (11) → Lens (11, paid); CN/JP legal status = gap (11) |
| Statute | National primary: legislation.gov.uk (10) / e-Gov Japan (10) / FRL AU (10) / GII DE (10) / Justice CA (10) / GovInfo US Code (10) | EUR-Lex (10, EU) → WIPO Lex (10, IP) → NORMLEX/FAOLEX (10, sector metadata) |
| Court decision | CourtListener (10, US) | EUR-Lex/CELLAR (10, EU partial); elsewhere = gap (10) |
| Statistic (country) | National NSO API per Section O | Eurostat/OECD (14, harmonized) → UN SDG (14) → Data Commons (15) → Gapminder (14, historical) |
| Statistic (international) | UN SDG / WPP / UNHCR (14) | World Bank/IMF/Comtrade (14 cross-ref) → OECD (14) → Data Commons (15) |
| Protein structure | RCSB PDB (08) | AlphaFold DB (08) → Materials-adjacent: CSD (11, paid) |
| Material | Materials Project (11) | OQMD (11) → AFLOW (11) → NOMAD (11) → JARVIS (11) → MPDS (11, freemium) |
| Astronomical object | SIMBAD (12) | VizieR (12) → Gaia (12) → MPC (12, minor planets) → SBDB (12) → Exoplanet Archive (12) |
| Satellite/space object | Space-Track (12) | CelesTrak (12) → DISCOS (12) → SatNOGS (16) |
| Weather/climate | NOAA NCEI (12, obs) + ECMWF ERA5 (12, reanalysis) | Met.no (12) → DWD (12) → Open-Meteo (12) → national NMS APIs (12) |
| News/event (humanitarian) | ReliefWeb (14) | ProMED (04, outbreaks) → OCHA FTS (14) → GDELT? (not in blocks) |
| Web page (current) | Brave (15) | Mojeek (15) → Common Crawl CDX (15) |
| Web page (historical) | Wayback CDX (15) | Common Crawl (15) |
| Book | Open Library (15) + VIAF/lobid (15) | NDL (13, JP) → LIBRIS/Finna/bne.es (13, national) → DDB (13, DE) → Google Books API (15 cross-ref) |
| Law/standard (engineering) | ETSI/ITU-T free PDFs (11) | IETF Datatracker (01) → W3C (01) → ISO/IEC = paywalled gap (11) |
| Traditional medicine | MPNS names (06) + ETCM/IMPPAT (06) | COCONUT (06) → TCMSP/SymMap (06) → WHO IRIS (06) → PubMed/EuropePMC literature (04) |
| Endangered language | OLAC (16, in rebuild) | PARADISEC (16) → Pangloss (16) → AILLA (16) → Local Contexts labels (16) |

---

## SECTION V — ENVIRONMENT VARIABLE REGISTRY (complete deduplicated WARROOM_* table)

Required?: **Y** = credential mandatory for the source's primary use; **N** = none needed (base URL, or key optional). Name conflicts found across reports are listed under "Conflicts" at the end — adopt the canonical name shown there.

**Software/bugs/security (01/02/03):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_PYPI_API_URL | PyPI | N | package metadata |
| WARROOM_NPM_REGISTRY_URL | npm | N | package feed |
| WARROOM_CRATES_INDEX_URL | crates.io | N | Rust metadata/dumps |
| WARROOM_MAVEN_SEARCH_URL | Maven Central | N | JVM artifact search |
| WARROOM_METACPAN_API_URL | MetaCPAN | N | Perl/CPAN metadata |
| WARROOM_RUBYGEMS_API_URL | RubyGems | N | gem metadata/dumps |
| WARROOM_ECOSYSTE_MS_API_URL | ecosyste.ms | N | cross-registry packages |
| WARROOM_DEPS_DEV_API_URL | deps.dev | N | dependency graphs (canonical name — see conflicts) |
| WARROOM_HOMEBREW_API_URL | Homebrew | N | macOS packages |
| WARROOM_DEBIAN_SOURCES_API | Debian sources | N | source-package search |
| WARROOM_GITHUB_TOKEN | GitHub | Y | repos/issues/GHSA |
| WARROOM_GITLAB_TOKEN | GitLab | Y | projects/GLAD |
| WARROOM_CODEBERG_TOKEN | Codeberg | N | Forgejo API |
| WARROOM_SWH_API_TOKEN | Software Heritage | N | quota raise |
| WARROOM_GREP_APP_API_URL | grep.app | N | code search |
| WARROOM_STACKEXCHANGE_KEY | Stack Exchange | N | quota raise |
| WARROOM_IETF_API_URL | IETF Datatracker | N | standards lineage |
| WARROOM_W3C_API_KEY | W3C | Y | spec registry |
| WARROOM_MDN_GITHUB_TOKEN | MDN content | N | docs repo |
| WARROOM_KERNEL_GIT_URL | kernel.org | N | git/mbox access |
| WARROOM_EOL_API_URL | endoflife.date | N | EOL data (canonical name — see conflicts) |
| WARROOM_ROSETTA_API_URL | Rosetta Code | N | task×language matrix |
| WARROOM_DEVDOCS_BASE_URL | DevDocs | N | docsets |
| WARROOM_OSV_API_URL | OSV.dev | N | vuln aggregation |
| WARROOM_NVD_API_KEY | NVD | N | rate raise (50/30s) |
| WARROOM_CVE_SERVICES_URL | CVE Services | N | optional; use cvelistV5 git |
| WARROOM_CISA_KEV_URL | CISA KEV | N | exploited-CVE file |
| WARROOM_GO_VULNDB_URL | Go VulnDB | N | Go vulns |
| WARROOM_MSRC_API_URL | MSRC CVRF | N | MS patch mapping |
| WARROOM_UBUNTU_SECURITY_URL | Ubuntu OVAL | N | Ubuntu patches |
| WARROOM_DEBIAN_TRACKER_URL | Debian Tracker | N | Debian triage JSON |
| WARROOM_REDHAT_SECDATA_URL | Red Hat Hydra | N | RHEL fixes/CSAF |
| WARROOM_BUGZILLA_MOZILLA_KEY | Mozilla Bugzilla | N | security bugs |
| WARROOM_LAUNCHPAD_API_URL | Launchpad | N | Ubuntu bugs |
| WARROOM_APACHE_JIRA_URL | Apache Jira | N | ASF issues |
| WARROOM_LIBRARIESIO_KEY | Libraries.io | Y | dependents/unmaintained |
| WARROOM_VULDB_API_KEY | VulDB | Y | pre-CVE long tail (paid) |
| WARROOM_ABUSECH_AUTH_KEY | abuse.ch (3 services) | Y | malware/IOC/URL |
| WARROOM_VT_API_KEY | VirusTotal | Y | multi-engine verdicts |
| WARROOM_HYBRID_ANALYSIS_API_KEY | Hybrid Analysis | Y | sandbox reports |
| WARROOM_ANYRUN_API_KEY | ANY.RUN | Y | live-analysis IOCs |
| WARROOM_OTX_API_KEY | AlienVault OTX | Y | pulse community |
| WARROOM_ABUSEIPDB_API_KEY | AbuseIPDB | Y | IP abuse scores |
| WARROOM_GREYNOISE_API_KEY | GreyNoise | Y | noise classification |
| WARROOM_SHODAN_API_KEY | Shodan | Y | banner/device search |
| WARROOM_CENSYS_PAT | Censys | Y | host/cert search |
| WARROOM_PHISHSTATS_API_KEY | PhishStats | N | quota raise |
| WARROOM_RANSOMWARE_LIVE_API_KEY | ransomware.live Pro | N | Pro tier only |
| WARROOM_MISP_URL / WARROOM_MISP_API_KEY | own MISP instance | N | feed aggregation |

**Medical/pharma/traditional (04/05/06):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_NCBI_API_KEY | NCBI E-utilities | N | rate raise (10/s) |
| WARROOM_NCBI_DATASETS_API_KEY | NCBI Datasets v2 | N | genome packages |
| WARROOM_EUROPEPMC_BASE_URL | Europe PMC | N | literature/full text |
| WARROOM_PMC_OA_BUCKET | PMC OA | N | bulk full text |
| WARROOM_CTGOV_BASE_URL | ClinicalTrials.gov | N | trial registry |
| WARROOM_ICTRP_CREDENTIALS | WHO ICTRP | Y | crawl/web service |
| WARROOM_WHO_ICD_CLIENT_ID / _CLIENT_SECRET | WHO ICD | Y | disease coding |
| WARROOM_UMLS_API_KEY | UMLS | Y | vocabulary graph |
| WARROOM_SNOMED_LICENSE | SNOMED CT | Y | content license |
| WARROOM_LOINC_USER / _PASSWORD | LOINC FHIR | Y | lab codes |
| WARROOM_BIOPORTAL_API_KEY | BioPortal | Y | ontologies/Annotator |
| WARROOM_NICE_SYNDICATION_KEY | NICE | Y | UK guidelines |
| WARROOM_OPENTARGETS_API_URL | Open Targets | N | target–disease graph |
| WARROOM_WHO_GHO_BASE_URL | WHO GHO | N | health indicators |
| WARROOM_GHDX_ACCOUNT | IHME GHDx | Y | burden CSVs |
| WARROOM_GISAID_CREDENTIALS | GISAID | Y | virus genomes |
| WARROOM_PROMED_SUBSCRIPTION | ProMED | Y | outbreak feed (paid) |
| WARROOM_OPENFDA_API_KEY | openFDA | N | quota raise |
| WARROOM_RXNAV_BASE_URL | RxNorm/RxNav | N | drug normalization |
| WARROOM_DAILYMED_BASE_URL | DailyMed | N | drug labels |
| WARROOM_GUDID_BASE_URL | AccessGUDID | N | device master data |
| WARROOM_PUBCHEM_BASE_URL | PubChem | N | chemistry hub |
| WARROOM_CHEMBL_BASE_URL | ChEMBL | N | bioactivity |
| WARROOM_GTOPDB_BASE_URL | GtoPdb | N | target–ligand |
| WARROOM_PHARMGKB_BASE_URL | PharmGKB | N | PGx guidelines |
| WARROOM_HC_DPD_BASE_URL | Health Canada DPD | N | CA products |
| WARROOM_BINDINGDB_BASE_URL | BindingDB | N | binding affinities |
| WARROOM_DRUGCENTRAL_DATA_URL | DrugCentral | N | drug bulk dump |
| WARROOM_ORANGEBOOK_DATA_URL | Orange Book | N | patent/exclusivity |
| WARROOM_EMA_DATA_URL / WARROOM_EMA_SPOR_TOKEN | EMA | N/Y | EU medicines; SPOR token |
| WARROOM_VAERS_DATA_URL | VAERS | N | vaccine safety bulk |
| WARROOM_DRUGBANK_API_KEY | DrugBank | Y | DDI depth (paid) |
| WARROOM_VIGIACCESS_URL | WHO VigiAccess | N | ADR aggregates |
| WARROOM_NPATLAS_API_KEY | NPAtlas | N | bandwidth raise |
| WARROOM_COCONUT_API | COCONUT | N | NP collection |
| WARROOM_WDQS_ENDPOINT | LOTUS via Wikidata | N | structure–organism SPARQL |
| WARROOM_CHEBI_API | ChEBI 2.0 | N | chemical ontology |
| WARROOM_TCMSP_BASE_URL / WARROOM_TCMID_BASE_URL / WARROOM_SYMMAP_BASE_URL / WARROOM_ETCM_BASE_URL / WARROOM_IMPPAT_BASE_URL | TCM/Ayurveda DBs | N | search-only mirrors |
| WARROOM_TKDL_LICENSE | TKDL | Y | NDA-gated corpus |
| WARROOM_DRDUKE_BULK_URL | Dr. Duke USDA | N | phytochem bulk |
| WARROOM_NAEB_BASE_URL | NAEB | N | N. American ethnobotany |
| WARROOM_MPNS_BASE_URL | Kew MPNS | N | medicinal plant names |
| WARROOM_PROTA4U_BASE_URL / WARROOM_UTP_BASE_URL / WARROOM_PFAF_BASE_URL / WARROOM_SANCDB_BASE_URL | TM plant DBs | N | use records |
| WARROOM_WHO_IRIS_OAI | WHO IRIS | N | TM/WHO documents |
| WARROOM_BHL_API_KEY | BHL | Y | historical herbals |
| WARROOM_WELLCOME_API / WARROOM_WELLCOME_API_BASE | Wellcome | N | medical MSS (two names in blocks — canonicalize to WARROOM_WELLCOME_API_BASE) |

**Biology/genomics (07/08):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_GBIF_API_BASE (+_USER/_PASS) | GBIF | N/Y | occurrences; creds for async downloads |
| WARROOM_INATURALIST_API_BASE | iNaturalist | N | sightings |
| WARROOM_EBIRD_API_KEY | eBird | Y | avian occurrences |
| WARROOM_COL_API_BASE | COL/ChecklistBank | N | taxonomy |
| WARROOM_WORMS_API_BASE | WoRMS | N | marine nomenclature |
| WARROOM_ITIS_API_BASE | ITIS | N | TSN taxonomy |
| WARROOM_POWO_API_BASE | POWO | N | plant checklist (bot-blocked) |
| WARROOM_IUCN_REDLIST_TOKEN | IUCN Red List | Y | extinction risk |
| WARROOM_BOLD_API_BASE | BOLD | N | DNA barcodes |
| WARROOM_TRY_ACCOUNT | TRY | Y | plant traits |
| WARROOM_EOL_API_BASE | EOL | N | traits/TraitBank |
| WARROOM_GLOBI_API_BASE | GloBI | N | interaction graph |
| WARROOM_PBDB_API_BASE | PBDB | N | fossils |
| WARROOM_OBIS_API_BASE | OBIS | N | marine occurrences |
| WARROOM_GRIIS_ZENODO_DOI | GRIIS | N | invasive checklists |
| WARROOM_ICTV_MSL_URL | ICTV | N | virus taxonomy |
| WARROOM_BACDIVE_API_BASE | BacDive v2 | N | bacterial phenotypes |
| WARROOM_LPSN_USER / _PASS | LPSN | Y | prokaryote nomenclature |
| WARROOM_GLOBALTREESEARCH_CSV_URL | GlobalTreeSearch | N | tree species list |
| WARROOM_ENSEMBL_REST_BASE | Ensembl | N | gene models/VEP |
| WARROOM_UNIPROT_REST_BASE | UniProt | N | protein hub |
| WARROOM_RCSB_API_BASE | RCSB PDB | N | structures |
| WARROOM_ALPHAFOLD_API_BASE | AlphaFold DB | N | predicted structures |
| WARROOM_KEGG_REST_BASE | KEGG | N | pathways (license-restricted) |
| WARROOM_REACTOME_API_BASE | Reactome | N | open pathways |
| WARROOM_WIKIPATHWAYS_API_BASE | WikiPathways | N | community pathways |
| WARROOM_STRING_API_BASE (+_CALLER_IDENTITY) | STRING | N | PPI network |
| WARROOM_BIOGRID_API_KEY | BioGRID/ORCS | Y | curated interactions |
| WARROOM_INTACT_API_BASE | IntAct | N | interaction detail |
| WARROOM_OLS4_API_BASE | OLS4 | N | OBO ontologies |
| WARROOM_ENA_PORTAL_API_BASE | ENA | N | INSDC metadata |
| WARROOM_DDBJ_API_BASE | DDBJ | N | Asian INSDC node |
| WARROOM_CELLOSAURUS_API_BASE | Cellosaurus | N | cell lines |
| WARROOM_METWORKBENCH_API_BASE | Metabolomics Workbench | N | metabolomics |
| WARROOM_METABOLIGHTS_API_BASE (+_API_TOKEN) | MetaboLights | N | metabolomics EU |
| WARROOM_PRIDE_API_BASE | PRIDE/PX | N | proteomics |
| WARROOM_GNOMAD_API_BASE | gnomAD | N | variant frequencies |
| WARROOM_DEPMAP_FIGSHARE_ARTICLE_ID | DepMap via Figshare | N | CRISPR screens |

**History/gov/patents (09/10/11):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_OPENCONTEXT_BASE | Open Context | N | archaeology datasets |
| WARROOM_TDAR_API_BASE | tDAR | N | CRM grey literature |
| WARROOM_ARIADNE_API_BASE | ARIADNE | N | pan-EU archaeology |
| WARROOM_EDH_API_BASE | EDH | N | Latin epigraphy |
| WARROOM_IDAI_GAZETTEER_BASE | iDAI.gazetteer | N | ancient places |
| WARROOM_CDLI_BASE / WARROOM_EBL_API_BASE | CDLI / eBL | N | cuneiform corpora |
| WARROOM_WHG_API_BASE | WHG | N | temporal gazetteer |
| WARROOM_OHM_OVERPASS / WARROOM_OHM_API | OpenHistoricalMap | N | historical basemap |
| WARROOM_SESHAT_USERNAME / _PASSWORD | Seshat | Y | quantitative history |
| WARROOM_IMPRESSO_API_TOKEN | impresso | Y | historical newspapers NLP |
| WARROOM_NLI_API_KEY | NLI | Y | Jewish press/MSS |
| WARROOM_CTEXT_API_KEY | Chinese Text Project | Y | early Chinese texts |
| WARROOM_BDRC_BASE | BDRC | N | Tibetan Buddhist KG |
| WARROOM_EHRI_API_BASE | EHRI | N | Holocaust archives |
| WARROOM_NOMISMA_SPARQL | Nomisma | N | ancient coins |
| WARROOM_PLEIADES_DATA / WARROOM_PERIODO_DATA | Pleiades / PeriodO | N | ancient places/periods |
| WARROOM_ADS_OAI / WARROOM_PANGAEA_OAI | ADS / PANGAEA | N | UK archaeology / paleo data |
| WARROOM_QDL_IIIF_BASE | Qatar Digital Library | N | Gulf primary sources |
| WARROOM_EPERIODICA_IIIF / WARROOM_ONB_IIIF | e-periodica / ANNO | N | periodicals/press |
| WARROOM_CLIOPATRIA_GEOJSON | Cliopatria | N | polity boundaries |
| WARROOM_DPLACE_DATA / WARROOM_OGL_CORPUS / WARROOM_PAPYRI_DATA / WARROOM_OPENITI_CORPUS / WARROOM_CBETA_DATA / WARROOM_KANRIPO_DATA | text corpora | N | git/bulk repos |
| WARROOM_GRETIL_ZENODO | GRETIL | N | Indic texts (canonical name — see conflicts) |
| WARROOM_EURLEX_SPARQL_ENDPOINT / WARROOM_EURLEX_WS_USER | EUR-Lex | N/Y | EU law KG; webservice creds |
| WARROOM_CONGRESS_GOV_API_KEY | Congress.gov | Y | US legislation |
| WARROOM_GOVINFO_API_KEY | GovInfo | Y | US Code/CFR XML |
| WARROOM_FEDERAL_REGISTER_BASE | Federal Register | N | US regulations |
| WARROOM_UK_LEGISLATION_BASE | legislation.gov.uk | N | UK law |
| WARROOM_JP_EGOV_LAW_BASE | Japan e-Gov Law | N | JP statutes |
| WARROOM_AU_FRL_BASE | Australia FRL | N | AU legislation |
| WARROOM_UK_GAZETTE_BASE | The Gazette | N | UK notices |
| WARROOM_COURTLISTENER_TOKEN | CourtListener | Y | US case law |
| WARROOM_CA_LAWS_BASE / WARROOM_DE_GII_TOC | Canada/DE laws | N | federal law XML |
| WARROOM_WIPOLEX_BASE / WARROOM_UNTC_BASE / WARROOM_ILO_NATLEX_BASE / WARROOM_FAOLEX_BASE | WIPO/UN/ILO/FAO law | N | treaty/legal metadata |
| WARROOM_IN_EGAZETTE_BASE | India eGazette | N | gazette (no API) |
| WARROOM_OFAC_SDN_URL / WARROOM_EU_FSD_TOKEN / WARROOM_UN_SC_LIST_URL / WARROOM_UK_OFSI_PAGE | sanctions lists | N | designations |
| WARROOM_OPENSANCTIONS_API_KEY | OpenSanctions | Y | normalized graph |
| WARROOM_GLEIF_BASE | GLEIF | N | LEI resolver |
| WARROOM_OPENCORPORATES_API_TOKEN | OpenCorporates | Y | company search |
| WARROOM_COMPANIES_HOUSE_API_KEY | UK Companies House | Y | UK companies/PSC |
| WARROOM_SEC_EDGAR_UA | SEC EDGAR | N | declared UA string |
| WARROOM_INTERPOL_NOTICES_BASE | Interpol | N | notices (degraded) |
| WARROOM_USASPENDING_BASE | USAspending | N | US spending |
| WARROOM_BR_TRANSPARENCIA_API_KEY | Brazil Transparência | Y | BR integrity data |
| WARROOM_OCDS_REGISTRY | OCDS publishers | N | procurement graph |
| WARROOM_TED_API_KEY | EU TED | Y | EU procurement |
| WARROOM_EU_FTS_PAGE | EU FTS | N | fund beneficiaries |
| WARROOM_CL_MERCADOPUBLICO_TICKET | Mercado Público | Y | CL procurement |
| WARROOM_ELECTIONGUIDE_TOKEN / WARROOM_IDEA_TURNOUT_XLSX | IFES / IDEA | Y/N | elections |
| WARROOM_FRED_API_KEY | FRED | Y | macro series |
| WARROOM_ECB_SDW_BASE / WARROOM_BOE_IADB_BASE / WARROOM_BOC_VALET_BASE / WARROOM_BIS_API_BASE / WARROOM_BOJ_STATS_BASE | central banks | N | rates/FX/banking stats |
| WARROOM_WTO_API_KEY | WTO | Y | trade/tariffs |
| WARROOM_ESTAT_APPID | e-Stat Japan | Y | JP statistics (canonical name — see conflicts) |
| WARROOM_ARXIV_S3_BUCKET | arXiv bulk | N | preprint corpus |
| WARROOM_ADS_API_TOKEN | NASA ADS | Y | astro citations |
| WARROOM_MP_API_KEY | Materials Project | Y | DFT materials |
| WARROOM_NOMAD_BASE | NOMAD | N | FAIR calculations |
| WARROOM_MPDS_API_KEY | MPDS | Y | experimental materials |
| WARROOM_IEEE_API_KEY | IEEE Xplore | Y | engineering index |
| WARROOM_EPO_OPS_KEY / _SECRET | EPO OPS | Y | patent families |
| WARROOM_USPTO_ODP_API_KEY | USPTO ODP | Y | US prosecution |
| WARROOM_PATENTSVIEW_API_KEY | PatentsView | Y | disambiguated patents (paused) |
| WARROOM_USPTO_TSDR_API_KEY | USPTO TSDR | Y | trademarks |
| WARROOM_WIPO_PCT_SFTP_* | WIPO PATENTSCOPE | Y | PCT feed (paid, if contracted) |
| WARROOM_KIPRIS_API_KEY | KIPRIS Plus | Y | KR IP register |
| WARROOM_GCP_CREDENTIALS / WARROOM_BQ_PROJECT | Google Patents BQ | Y | patent full text |
| WARROOM_LENS_API_TOKEN | Lens.org | Y | patent↔paper links |
| WARROOM_IPAUSTRALIA_API_KEY | IP Australia | Y | AU IP + TM-Link |

**Maps/space/academic/stats (12/13/14):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_OSM_OVERPASS_URL / WARROOM_NOMINATIM_URL / WARROOM_OSM_PLANET_URL | OSM | N | POI/geocode/planet |
| WARROOM_GEONAMES_USERNAME | GeoNames | Y | toponyms |
| WARROOM_NATURALEARTH_URL / WARROOM_GEBCO_URL | Natural Earth / GEBCO | N | boundaries/bathymetry |
| WARROOM_OVERTURE_S3_BUCKET | Overture Maps | N | GERS geo entities |
| WARROOM_MAPILLARY_TOKEN | Mapillary | Y | street imagery |
| WARROOM_CDSE_USER / _PASSWORD | Copernicus CDSE | Y | Sentinel data |
| WARROOM_USGS_M2M_USER / _TOKEN | USGS M2M | Y | Landsat ordering |
| WARROOM_EARTHDATA_TOKEN | NASA Earthdata | Y | downloads |
| WARROOM_JAXA_GPORTAL_USER | JAXA G-Portal | Y | L-band SAR |
| WARROOM_INPE_STAC_URL / WARROOM_BHUVAN_WMS_URL | INPE / ISRO | N | BR/IN imagery |
| WARROOM_OPENMETEO_API_KEY | Open-Meteo | N | commercial tier only |
| WARROOM_OPENWEATHER_API_KEY | OpenWeatherMap | Y | weather |
| WARROOM_CDSAPI_TOKEN | ECMWF CDS | Y | ERA5 reanalysis |
| WARROOM_NOAA_CDO_TOKEN | NOAA NCEI | N | v2 only; v1 keyless |
| WARROOM_NWS_USER_AGENT / WARROOM_METNO_USER_AGENT | NWS / Met.no | N | declared UA |
| WARROOM_DWD_OPENDATA_URL | DWD | N | ICON GRIB |
| WARROOM_METOFFICE_DATAHUB_KEY | Met Office | Y | UK forecasts |
| WARROOM_JMA_XML_FEED_URL | JMA | N | JP early warning |
| WARROOM_OPENTOPO_API_KEY | OpenTopography | Y | DEM/bathymetry |
| WARROOM_LINZ_API_KEY / WARROOM_SWISSTOPO_API_URL | LINZ / Swisstopo | Y/N | national mapping |
| WARROOM_CELESTRAK_URL | CelesTrak | N | orbital data |
| WARROOM_SPACETRACK_USER / _PASSWORD | Space-Track | Y | satellite catalog |
| WARROOM_DISCOS_TOKEN | ESA DISCOS | Y | object properties |
| WARROOM_N2YO_API_KEY | N2YO | Y | pass predictions |
| WARROOM_SWPC_URL | NOAA SWPC | N | space weather |
| WARROOM_NASA_API_KEY | NASA Open APIs/JPL | Y | NEO/DONKI/Horizons |
| WARROOM_MPC_API_URL | Minor Planet Center | N | minor planets |
| WARROOM_EXOPLANET_TAP_URL / WARROOM_SIMBAD_TAP_URL / WARROOM_GAIA_TAP_URL | astro TAP services | N | exoplanets/objects/Gaia |
| WARROOM_MAST_API_TOKEN | MAST | Y | JWST/HST/TESS |
| WARROOM_SDSS_SCISERVER_TOKEN | SDSS CasJobs | Y | spectroscopic surveys |
| WARROOM_OPENAIRE_API_BASE | OpenAIRE | N | scholarly graph |
| WARROOM_OPENCITATIONS_TOKEN | OpenCitations | N | quota raise |
| WARROOM_BIORXIV_MAILTO | bioRxiv/medRxiv | N | polite-pool mailto |
| WARROOM_HAL_API_BASE | HAL | N | French OA archive |
| WARROOM_JSTAGE_API_BASE | J-STAGE | N | JP journals |
| WARROOM_CINII_APPID | CiNii | Y | JP papers/books |
| WARROOM_REPEC_CODE | RePEc | Y | economics archive |
| WARROOM_ECONSTOR_OAI_BASE / WARROOM_SCIELO_OAI_BASES / WARROOM_CYBERLENINKA_OAI_BASE | OAI sources | N | econ/LatAm/RU OA |
| WARROOM_REDALYC_API_KEY | Redalyc | Y | Ibero-American journals |
| WARROOM_BASE_API_KEY | BASE | Y | OAI aggregator |
| WARROOM_OAI_TARGETS | OAI-PMH ecosystem | N | IR harvest list |
| WARROOM_KISTI_API_KEY | KISTI ScienceON | Y | Korean S&T |
| WARROOM_TROVE_API_KEY | Trove | Y | Australian GLAM |
| WARROOM_DIGITALNZ_API_KEY | DigitalNZ | N | NZ culture (optional since 2026) |
| WARROOM_DDB_API_KEY | DDB/Archivportal-D | Y | German GLAM/archives |
| WARROOM_NDLSEARCH_BASE / WARROOM_NDL_IIIF_BASE | NDL | N | JP national library |
| WARROOM_JPSEARCH_API_BASE | Japan Search | N | JP cross-domain portal (canonical name — see conflicts) |
| WARROOM_LIBRIS_API_BASE / WARROOM_FINNA_API_BASE / WARROOM_NBNO_API_BASE | Nordic libraries | N | SE/FI/NO GLAM |
| WARROOM_KBNL_ACCESS | KB Delpher | Y | newspaper bulk grant |
| WARROOM_BNE_SPARQL_BASE / WARROOM_CULTURAITALIA_SPARQL / WARROOM_POLONA_IIIF_BASE | ES/IT/PL heritage | N | linked heritage |
| WARROOM_NARA_API_KEY | NARA | Y | US archives |
| WARROOM_ATOM_INSTANCES | AtoM archives | N | LatAm archives |
| WARROOM_ARTIC_API_BASE / WARROOM_CMA_API_BASE / WARROOM_VAM_API_BASE / WARROOM_SMK_API_BASE / WARROOM_NASJONALMUSEET_API_BASE / WARROOM_NGLONDON_API_BASE | museum APIs (no key) | N | art collections |
| WARROOM_HARVARD_ART_API_KEY / WARROOM_COOPERHEWITT_TOKEN / WARROOM_PARISMUSEES_TOKEN / WARROOM_FNG_API_KEY / WARROOM_TEPAPA_API_KEY | museum APIs (keyed) | Y | art collections |
| WARROOM_EUROSTAT_API_BASE / WARROOM_OECD_SDMX_BASE / WARROOM_UN_SDG_API_BASE / WARROOM_UN_DESA_API_BASE / WARROOM_UNHCR_API_BASE | intl stats | N | EU/OECD/UN statistics |
| WARROOM_IOM_DTM_API_KEY | IOM DTM | Y | displacement |
| WARROOM_UIS_API_BASE | UNESCO UIS | N | education stats |
| WARROOM_ADB_SDMX_BASE / WARROOM_CEPALSTAT_API_BASE / WARROOM_IDB_SOCRATA_TOKEN | regional dev banks | N | Asia/LAC stats |
| WARROOM_IEA_API_TOKEN | IEA | Y | energy (paid core) |
| WARROOM_UNDATA_BASE | UNdata | N | legacy multi-agency |
| WARROOM_RELIEFWEB_APPNAME | ReliefWeb | Y | humanitarian reports |
| WARROOM_OCHA_FTS_API_BASE / WARROOM_IATI_SUBSCRIPTION_KEY | FTS / IATI | N/Y | humanitarian funding/aid |
| WARROOM_AIDDATA_DIR / WARROOM_GAPMINDER_DIR / WARROOM_GADM_DIR | bulk datasets | N | aid/development/boundaries |
| WARROOM_ONS_API_BASE / WARROOM_NOMIS_API_BASE (+_KEY) | UK stats | N | ONS/Nomis |
| WARROOM_GENESIS_USER / _PASSWORD | Destatis | Y | German stats |
| WARROOM_INSEE_CLIENT_ID / _SECRET | INSEE | Y | French stats |
| WARROOM_ISTAT_SDMX_BASE / WARROOM_INE_ES_API_BASE / WARROOM_CBS_NL_ODATA_BASE | IT/ES/NL stats | N | national statistics |
| WARROOM_SCB_API_BASE / WARROOM_SSB_API_BASE / WARROOM_DST_API_BASE / WARROOM_STATFIN_API_BASE | Nordic stats | N | SE/NO/DK/FI |
| WARROOM_GUS_BDL_CLIENT_ID / WARROOM_CZSO_CKAN_BASE | PL/CZ stats | N | regional stats |
| WARROOM_ROSSTAT_API_KEY | Rosstat fedstat | Y | Russian stats (geo-blocked) |
| WARROOM_KOSIS_API_KEY | KOSIS | Y | Korean stats |
| WARROOM_ESANKHYIKI_BASE | India MoSPI | N | Indian stats |
| WARROOM_DATA_GOV_IN_API_KEY | OGD India | Y | Indian gov data (canonical name — see conflicts) |
| WARROOM_BPS_API_KEY / WARROOM_SINGSTAT_API_BASE / WARROOM_DATAGOVMY_API_BASE / WARROOM_PSA_API_BASE | ID/SG/MY/PH stats | Y/N | SE Asian stats |
| WARROOM_ABS_SDMX_BASE / WARROOM_STATSNZ_SDMX_BASE | AU/NZ stats | N | census/statistics |
| WARROOM_CENSUS_API_KEY / WARROOM_STATCAN_WDS_BASE | US/CA census | Y/N | demographics |
| WARROOM_IBGE_SIDRA_BASE / WARROOM_ARG_SERIES_API_BASE / WARROOM_INEGI_TOKEN / WARROOM_DATOSGOVCO_APP_TOKEN | LatAm stats | N/Y | BR/AR/MX/CO |
| WARROOM_EIA_API_KEY | US EIA | Y | energy data |
| WARROOM_ISRAEL_CBS_API_BASE / WARROOM_SAUDI_OPENDATA_BASE / WARROOM_TAIWAN_DATAGOV_BASE | IL/SA/TW stats | N | national data |

**General/regional (15/16):**

| Env var | Service | Req | Purpose |
|---------|---------|-----|---------|
| WARROOM_WIKIDATA_SPARQL_URL / WARROOM_WIKIDATA_API_URL | Wikidata | N | entity hub |
| WARROOM_WIKIPEDIA_API_URL / WARROOM_WIKIMEDIA_TOKEN | Wikipedia | N | encyclopedia |
| WARROOM_COMMONS_API_URL / WARROOM_WIKIMEDIA_DUMPS_URL | Commons/dumps | N | media/bulk |
| WARROOM_WIKIMEDIA_ENTERPRISE_KEY | Wikimedia Enterprise | Y | streaming (paid) |
| WARROOM_DBPEDIA_SPARQL_URL / WARROOM_YAGO_SPARQL_URL | DBpedia/YAGO | N | structured extracts |
| WARROOM_CONCEPTNET_API_URL | ConceptNet | N | commonsense graph |
| WARROOM_DATACOMMONS_API_KEY | Data Commons | Y | statistical KG + MCP |
| WARROOM_GOOGLE_KG_API_KEY | Google KG Search | Y | kgmid reconciliation |
| WARROOM_BABELNET_API_KEY | BabelNet | Y | multilingual synsets |
| WARROOM_COMMONCRAWL_INDEX_URL | Common Crawl | N | web corpus |
| WARROOM_IA_S3_ACCESS_KEY / _SECRET_KEY / WARROOM_WAYBACK_CDX_URL | Internet Archive | N/Y | archive/S3 creds |
| WARROOM_KAIKKI_DUMP_URL / WARROOM_OEWN_DUMP_URL / WARROOM_JMDICT_DUMP_URL / WARROOM_CCCEDICT_DUMP_URL | lexical dumps | N | dictionaries |
| WARROOM_FRAMENET_DATA_DIR | FrameNet | Y | registration-gated dump |
| WARROOM_MW_API_KEY | Merriam-Webster | Y | dictionaries |
| WARROOM_GLOSBE_API_URL | Glosbe | N | translation memory (degraded) |
| WARROOM_VIAF_API_URL / WARROOM_ISNI_SRU_URL / WARROOM_ORCID_API_URL / WARROOM_ROR_API_URL / WARROOM_LOBID_GND_URL | identity services | N | person/org IDs |
| WARROOM_MUSICBRAINZ_API_URL / WARROOM_OPENLIBRARY_API_URL / WARROOM_DBLP_API_URL | music/books/CS pubs | N | media metadata |
| WARROOM_BRAVE_SEARCH_API_KEY / WARROOM_MOJEEK_API_KEY | web search | Y | search APIs |
| WARROOM_REDDIT_CLIENT_ID / _SECRET | Reddit | Y | discussion corpus |
| WARROOM_DIFFBOT_TOKEN / WARROOM_GOLDEN_API_KEY | commercial KGs | Y | entity graphs |
| WARROOM_KIWIX_ZIM_DIR / WARROOM_WIKIBASE_CLOUD_API_URL / WARROOM_FACTGRID_SPARQL_URL | offline/niche KGs | N | ZIM/Wikibase |
| WARROOM_CBDB_API_BASE / WARROOM_CHGIS_DATAVERSE | CBDB/CHGIS | N | pre-modern China |
| WARROOM_DATAGOKR_SERVICE_KEY | data.go.kr | Y | Korean open data |
| WARROOM_LOCALCONTEXTS_API_KEY | Local Contexts | Y | indigenous labels |
| WARROOM_OPENSKY_CLIENT_ID / _SECRET | OpenSky | N | ADS-B (raises quota) |
| WARROOM_XENOCANTO_API_KEY | xeno-canto v3 | Y | bird sounds |
| WARROOM_MOVEBANK_USER / _PASS | Movebank | N | telemetry (restricted studies) |
| WARROOM_SATNOGS_API_BASE / WARROOM_MUSHROOMOBSERVER_API_KEY / WARROOM_ONC_TOKEN | SatNOGS/MO/ONC | N/Y | satellites/fungi/ocean |
| WARROOM_LIBRIVOX_API_BASE / WARROOM_GUTENDEX_API_BASE / WARROOM_STANDARDEBOOKS_OPDS | book/audio | N | PD corpora |
| WARROOM_ARCTICDATA_API_BASE | Arctic Data Center | N | Arctic data |
| WARROOM_LAREFERENCIA_OAI / WARROOM_CLACSO_OAI / WARROOM_SHODHGANGA_OAI / WARROOM_DOAB_OAI / WARROOM_PARADISEC_OAI / WARROOM_PANGLOSS_BASE / WARROOM_AILLA_BASE | OAI/language archives | N | LatAm/India/Pacific |
| WARROOM_OLAC_BASE | OLAC | N | endangered languages (rebuild) |
| WARROOM_AOZORA_CATALOG | Aozora Bunko | N | JP literature |
| WARROOM_OURAIRPORTS_CSV / WARROOM_GVP_BASE | OurAirports/GVP | N | airports/volcanoes |
| WARROOM_WILDLIFEINSIGHTS_CREDS | Wildlife Insights | Y | camera traps |
| WARROOM_SHAMELA_API_KEY | al-Shamela | N | Arabic corpus (unofficial key) |

**Name conflicts found across reports (adopt canonical):** (1) deps.dev: `WARROOM_DEPS_DEV_API_URL` (01) vs `WARROOM_DEPSDEV_API_URL` (02) → canonical **WARROOM_DEPS_DEV_API_URL**. (2) endoflife.date: `WARROOM_EOL_API_URL` (01) vs `WARROOM_ENDOFLIFE_API_URL` (02) → **WARROOM_EOL_API_URL**. (3) e-Stat: `WARROOM_ESTAT_APPID` (10) vs `WARROOM_ESTAT_APP_ID` (14) → **WARROOM_ESTAT_APPID**. (4) data.gov.in: `WARROOM_DATA_GOV_IN_API_KEY` (14) vs `WARROOM_DATAGOVIN_API_KEY` (16) → **WARROOM_DATA_GOV_IN_API_KEY**. (5) Japan Search: `WARROOM_JPSEARCH_API_BASE` (13) vs `WARROOM_JPSEARCH_SPARQL` (16) → keep **WARROOM_JPSEARCH_API_BASE** (both REST+SPARQL under one base). (6) GRETIL: `WARROOM_GRETIL_BASE` (09) vs `WARROOM_GRETIL_ZENODO` (16) → **WARROOM_GRETIL_ZENODO** (latest verified dump). (7) Wellcome: `WARROOM_WELLCOME_API` (06) vs `WARROOM_WELLCOME_API_BASE` (13) → **WARROOM_WELLCOME_API_BASE**. (8) CISA KEV has an env var in cat02 (WARROOM_CISA_KEV_URL) but cat03 marks "none" — keep the URL var (02). (9) DigitalNZ listed as required key (16) vs optional (13) — keep var, mark optional.

---

## SECTION W — CONTINUOUS-SYNC SOURCES (subscribe / harvest on a schedule)

**Feeds & changelogs (poll):** npm _changes (01); crates.io RSS (01); kernel.org Atom (01); GLAD RSS (02); CISA KEV Atom/RSS + modified_id.csv (02/03); PRIDE RSS (08); ProteomeXchange RSS (08); ProMED (04, paid); MedlinePlus RSS (04); NICE feed (04); Open Context RSS (09); tDAR RSS/GeoRSS (09); UK Gazette feeds (10); EU FSD RSS (10); JVN RSS/RDF (03); BSI WID RSS (03); CERT-FR MISP/RSS (03); NCSC-NL CSAF ROLIE (03); MISP default feeds (03); URLhaus/ThreatFox 5-min exports (03); MalwareBazaar batches (03); PhishStats 90-min (03); bioRxiv/medRxiv date-sliced API + RSS (13); Wikidata/Wikipedia recent-changes streams (15); MusicBrainz live feed (15); JMA XML Atom PULL (12); Companies House streaming (10); GLEIF daily deltas (10); OpenSanctions delta feeds (10); Overture GERS changelogs (12); OSM minutely replication diffs (12); GeoNames daily diffs (12/15); ReliefWeb (14); IOM DTM rounds (14); xeno-canto (16); SatNOGS (16); ONC (16).

**Harvest cycles (OAI-PMH / scheduled pulls):** arXiv OAI daily Sun–Thu (11); Europe PMC OAI (04); PMC OA daily incrementals (04); WHO IRIS (06); HAL/EconStor/SciELO/CyberLeninka (13); DDB/Archivportal-D (13); NDL (13); LIBRIS daily (13); datos.bne.es (13); ADS/PANGAEA (09); LA Referencia/CLACSO/Shodhganga/DOAB/PARADISEC/AILLA (16); CTP (09); BASE aggregation (13).

**Release-watching (check versioned releases):** ChEMBL 1–2/yr (05); UniProt 8-week (08); Ensembl quarterly (08); STRING ~biannual (08); Reactome quarterly (08); WikiPathways monthly (08); BioGRID monthly (08); ChEBI monthly (06); COCONUT monthly (06); Overture monthly (12); ICTV annual (07); IUCN 2/yr (07); COL monthly+XR (07); GBD annual (04); ICD-11 annual (04); UMLS 2/yr (04); LOINC 2/yr (04); SNOMED ~2/yr (04); Orphadata 2/yr (04); ATT&CK ~2/yr (03); ATLAS monthly (03); CWE/CAPEC 2–3/yr (03); PDG annual (11); CODATA ~4yr (11); GEBCO annual (12); Natural Earth 1–2/yr (12); Gaia DR (DR4 ~Dec 2026, 12); OEWN annual (15); ROR ~monthly (15); MusicBrainz 2×/week dumps (15); Wikimedia dumps 2×/month (15); DBpedia monthly (15); Kaikki ~monthly (15); JMdict daily (15); Common Crawl monthly (15); Stack Exchange quarterly (01); crates.io/RubyGems daily dumps (01); iNaturalist weekly S3 (07); FAERS quarterly (05); Orange Book monthly (05); VAERS weekly (05); DailyMed weekly bulk (05); EMA daily/weekly (05); GtoPdb ~2/yr (05); DrugCentral ~annual (05); CELLAR weekly OJ (10); Canada Justice weekly ZIP (10); OFAC intraday archive (10); EU FTS annual (10); TED daily/monthly archives (10); IDEA post-election (10); UIS BDDS monthly (14); AidData periodic (14); arXiv Kaggle snapshot (11); GVP weekly bulletins (16).

---

## SECTION X — ON-DEMAND SOURCES (query only when needed)

Query-per-question APIs with no local-copy economics: Nominatim (12, 1 req/s); OSM Overpass (12); Shodan InternetDB keyless (03); GreyNoise (03); AbuseIPDB (03); VirusTotal (03); Hybrid Analysis (03); ANY.RUN (03); Censys (03); OTX (03); PhishStats (03); EPSS batch (03); NVD point queries (02/03); OSV per-package (02); GitHub code search (01); grep.app (01); Stack Exchange (01); Rosetta Code (01); RxNav interactions (05); openFDA (05); VigiAccess (05, search-only); MedlinePlus Connect code queries (04); BioPortal Annotator (04); Open Targets GraphQL (04); WHO ICD (04); UMLS (04); STRING API (08); gnomAD GraphQL (08); Reactome Analysis (08); Ensembl VEP (08); UniProt ID mapping (08); KEGG REST (08); IUCN per-species (07); eBird recent (07); iNaturalist (07); BOLD (07); PBDB (07); MPNS (06); TCMSP/SymMap/ETCM (06, search-only); WHG reconciliation (09); Seshat (09); impresso (09); OpenAIRE/OpenCitations lookup (13); BASE (13); CiNii (13); Trove/DigitalNZ/DDB/Finna/NB (13); museum APIs (13); SIMBAD cone (12); JPL Horizons (12); N2YO (12); Space-Track queries (12); DISCOS (12); CelesTrak queries (12); Exoplanet TAP (12); Open-Meteo (12); api.weather.gov (12); Met.no (12); Met Office (12); OpenWeatherMap (12); OpenTopography (12); Mapillary (12); GLEIF resolver (10); OpenCorporates (10); Companies House (10); CourtListener (10); Congress.gov (10); Interpol (10); IFES (10); FRED (10); central-bank APIs (10); all NSO query APIs (14); Data Commons (15); Google KG (15); BabelNet (15); Brave/Mojeek (15); Reddit (15); Diffbot (15); ORCID/VIAF/ISNI/ROR/lobid lookups (15); MusicBrainz WS (15); Open Library (15); DBLP (15); data.go.kr (16); OpenSky (16); xeno-canto (16); Movebank (16); Local Contexts (16); ONC (16); Wildlife Insights (16).

---

## SECTION Y — LOCAL-INDEX SOURCES (bulk-download once, index locally — best value for one-time ingestion)

Tier 1 (small, high value, download today): CISA KEV (02/03); OSV all.zip (02); Go VulnDB (02); Debian Tracker JSON (02); EPSS CSV (03); CWE/CAPEC (03); ATT&CK/ATLAS repos (03); Exploit-DB git (03); cvelistV5 git (03); endoflife.date repo (01/02); crates.io dump (01); RubyGems dump (01); MDN content + BCD (01); DevDocs docsets (01); RFC tarballs (01); NIST CODATA (11); PDG SQLite (11); OEIS stripped/names (11); PeriodO (09); Cliopatria (09); Pleiades nightly (09); EDH ZIPs (09); ICTV MSL (07); GRIIS (07); GloBI dumps (07); EOL/TraitBank (07); GlobalTreeSearch (07); OurAirports (16); GVP (16); Natural Earth (12); GEBCO (12); GADM (14); GLEIF golden copy (10); OFAC/EU FSD/UN SC/UK OFSI (10); Gesetze im Internet (10); Canada Justice ZIPs (10); IDEA turnout (10); EU FTS (10); AidData (14); Gapminder (14); Kaikki (15); OEWN (15); JMdict/CC-CEDICT (15); ROR dump (15); VIAF clusters (15); ISNI (15); lobid GND (15); DBLP (15); Open Library dumps (15); MusicBrainz dumps (15); ConceptNet (15); YAGO (15); DBpedia (15); FrameNet (15); CBDB SQLite (16); CHGIS (16); Aozora (16); Shamela (16); GRETIL (09/16); OpenITI (09); CBETA (09); Kanripo (09); Perseus/OGL (09); papyri.info (09); D-PLACE (09); Dr. Duke CSV (06); IMPPAT GitHub (06); SANCDB (06); COCONUT Zenodo (06); ChEBI (06); LOTUS Zenodo (06); DailyMed full SPL (05); ChEMBL dumps (05); GtoPdb (05); BindingDB (05); DrugCentral (05); RxNorm monthly (05); openFDA bulk (05); VAERS (05); Orange Book (05); EMA Excel (05); GUDID (05); Health Canada DPD (05); Orphadata (04); IHME GBD CSVs (04); UMLS files (04); BOLD by-taxon (07); BacDive CSV/JSON (07); ITIS full DB (07); iDAI.gazetteer (09); CDLI daily dump (09); WHG bulk (09); Kiwix ZIM set (15).

Tier 2 (large, schedule a bulk window): Wikidata dump ~130GB gz (15); Wikipedia dumps (15); Common Crawl WET subsets (15); OSM planet ~80GB + Geofabrik extracts (12); Overture GeoParquet (12); PMC OA (04); Europe PMC FTP (04); PubChem FTP (05); UniProt FTP (08); RCSB full archive (08); AlphaFold per-proteome TARs (08, full = 23 TiB — pull per need); ENA/GenBank FTP (08); ChEMBL PG dump (05); STRING downloads (08); Reactome Neo4j (08); BioGRID builds (08); IntAct (08); MetaboLights/Workbench per-study (08); gnomAD VCFs (08, selective); Open Targets Parquet (04); arXiv S3 ~9.2TB (11); Google Patents BQ extract (11); USAspending Postgres dump (10); GovInfo bulk (10); EUR-Lex CELLAR (10); CourtListener bulk (10); Stack Exchange quarterly dump (01); Debian archive/snapshot (01); Software Heritage research datasets (01); CPAN rsync (01); iNaturalist weekly S3 (07); GBIF monthly export (07); OBIS export (07); KB Delpher 111GB newspapers (13); LIBRIS EMM (13); datos.bne.es (13); OpenAIRE Zenodo (13); OpenCitations (13); bioRxiv TSV S3 (13); SciELO/LA Referencia OAI full harvest (13/16); Shodhganga OAI (16); NOAA NCEI archives (12); DWD tree (12); Landsat per-scene S3 (12); VizieR FTP (12); MPCORB (12); SDSS SAS (12); IHME full GBD (04); UIS BDDS (14); WPP files (14); ecosyste.ms Zenodo (01); deps.dev BigQuery extract (01/02); PyPI BigQuery extract (01); Kiwix full-library ZIMs (15); IA collections via IAS3 (15).

Mirror-on-first-contact (fragile single-host per cat06/16): TCMSP, TCMID, SymMap, ETCM, IMPPAT, NAEB (broken TLS), PFAF, UTP, PROTA4U, SANCDB, KNApSAcK (06); OEIS (11, degraded API); ConceptNet (15, aging); Glosbe (15); Polona IIIF (13); OLAC (16, rebuild); OpenFlights→OurAirports (16).

---

## SECTION Z — ADDITIONAL DISCOVERIES & FOLLOW-UP MISSIONS (unverified candidates flagged by agents, prioritized)

**P1 — high value, cheap to verify:**
1. **CSAF national-CERT adoption probe (03):** NCSC-NL confirmed CSAF/ROLIE; verify BSI CERT-Bund, CERT-FR, Red Hat CSAF endpoints — one parser unlocks many governments.
2. **Shadowserver free reports API (03):** keyless for own-ASN, unverified — probe.
3. **CIRCL Vulnerability-Lookup open API (02)** and MISP TAXII-gated feeds (03).
4. **Pushshift successors (15):** Arctic Shift, PullPush, Academic Torrents — dedicated probe pass.
5. **Naver Search API (15):** official, free 25k/day claimed, unverified — Korea gap filler.
6. **LINCS CLUE API (08):** clue.io free academic key, not fully verified — would close the CRISPR-perturbation gap.
7. **J-STAGE service=4 + IndMED/medIND OAI-PMH/RSS (04/13):** follow-up targets for Indian/Japanese medical literature.
8. **WHO IRIS beyond TM (04/06):** full-corpus OAI harvest mission (endpoint verified 200).
9. **EU OAI endpoints needing EU egress (13):** CulturaItalia, Hungaricana, NKP Czechia, BN Portugal — re-verify from EU network.
10. **Geo-blocked re-verification (16):** Shodhganga, data.gov.in, indianculture.gov.in (India egress); contents.koreanhistory.or.kr (Korea egress); Rosstat fedstat (Russian egress); Japan Search via JP egress/browser UA.
11. **dLOC OAI (09):** unconfirmed post-rebuild — verify; key Caribbean/LatAm newspaper source.
12. **e-newspaperarchives.ch (09)** and DDB Zeitungsportal via DDB API + SLUB OAI (09).

**P2 — domain-completing probes:**
13. **Asia genomics mission (08/16):** China NGDC/CNCB BIG Data Center interfaces (thin, Chinese docs); jPOST via ProteomeXchange confirmed — document direct API.
14. **Astronomy wave-3 candidates (12):** IRSA & HEASARC TAP (verified only via astroquery), ESO Archive, ESASky TAP/SIA2, ZTF/LSST transient brokers (ANTARES/AMPEL/Fink Kafka).
15. **Parliament APIs (10):** UK Parliament (members-api.parliament.uk), EU Parliament (data.europarl.europa.eu), Brazil Câmara/Senado (dadosabertos.camara.leg.br); plus US FEC API and IPU Parline.
16. **Regional stats follow-ups (14):** SPC SDD (.Stat) for Pacific islands; Thailand NSO; Vietnam GSO PX-Web; Ukraine/Belarus/Balkans.
17. **Korean/Japanese residual (13/16):** KISTI registration path post-NDSL; JACAR; NLK via data.go.kr; DBpia/RISS alternatives.
18. **Standards discovery layer (11):** GB openstd.samr.gov.cn scraping policy; 3GPP FTP zips pattern; ISO/IEC metadata-only discovery.
19. **China mirror ecosystems (01/15):** npmmirror (registry.npmmirror.com), Aliyun Maven mirrors, Baidu Baike/CN-DBpedia/Zhishi.me outside-CN access.
20. **CERT-In RSS, KR-CERT, OpenPhish free feed, PhishTank legacy dumps (03).**

**P3 — flagged but lower priority / watch items:**
21. **Migrations to re-verify before each integration wave:** PMC OA → AWS PMC Cloud (~Aug 2026, 04); WHO GHO azureedge deprecation → data.who.int (04); Ensembl beta + component-site retirements (08); OLS3→OLS4 URL swaps (04/08); NCBI Datasets v1 deprecated (08); ChEBI 2.0 API surface post-SOAP retirement (06); USPTO ODP + PatentsView pause (11); CDSE STAC v1 cutover (12); Exoplanet nstedAPI → TAP (12); OpenAIRE Graph API post-XML (13); Stats NZ Infoshare retirement (14); xeno-canto v3 key-only (16); OLAC DELAMAN rebuild (16); DigitalNZ key-optional change (13); VIAF transition rumors (15); ISNI SRU base re-verify (15); CelesTrak 6-digit/CSV transition (12); Space-Track gp-class migration (12); Met Office post-DataPoint gaps (12); JMA legacy telegram codes ending ~2028 (12).
22. **Dead/decommissioned — do not integrate:** Sourcegraph free (01); libraries.io→ecosyste.ms transition (01, but see Q disagreement); search.cpan.org (01); PyPI XML-RPC (01); Debian anon rsync (01); Packet Storm RSS (03); Feodo Tracker content (03); Bing Search APIs (15, 2025-08-11); Artstor (13); Constellate (13); Trove v2 (13); NARA v1 (13); NDSL (13); OpenAIRE XML Search (13); ReliefWeb v1 (14); OECD api.stats (14); ABS.Stat (14); NZ.Stat (14); UIS.Stat/SDMX (14); OpenSpending API (10); PEDS/BDSS (11); cds.cern.ch (11); api.oeis.org (11); CDSE OpenSearch (12); Met Office DataPoint (12); ECMWF legacy CDS (12); JAXA FTP (12); JMA PUSH (12); TCMBanK/CPMCP + cat06 dead domains (06); ChEBI SOAP (06); IUCN v3 (07); BacDive v1 (07); old.tcmsp-e.com/megabionet/bioinfo.org symmap/prota.org/lotus mirror (06); OpenFlights (16); The European Library (09); World Digital Library (09); Google News Archive scanning (09); dev.tdar.org (09); HTRC tools (sunset end-2026, 09); xeno-canto v2 (16); MITRE cti-taxii legacy (03); NVD legacy feeds (02); ClinicalTrials.gov v1 (04); NHS content API (04); DIKB (05).
23. **Unverified niche candidates (16):** NINJAL corpora, FirstVoices, MARKUS, eMammal, AISHub, Blitzortung, api.npolar.no, Indian Culture Portal, Noorlib (Iran), Biblioteca Digital Curt Nimuendajú; Old Bailey/Founders Online/DocSouth (09); NDLI India (09); Recogito → use WHG instead (09); Hex.pm, docs.rs, Hugging Face Hub API, APIs.guru, dev.to Forem, HN Algolia, Unicode/CLDR, Fedora Bodhi/openSUSE OBS/Arch/Winget/F-Droid/Chocolatey/Conan/Vcpkg (01); Snyk, pyup/Safety (02); Google Books API gap-filler (15); Wordnik legacy (15); Expression Atlas JSON endpoints (08); HMDB downloads (08); Global Ecosystem Typology + WWF ecoregions bulk probe (07); Asian GBIF nodes CVH/NSII, J-IBIS/S-Net, India IBP (07); IRMNG REST live (07); QuickGO add-on (08); UberGraph SPARQL (04); AACT Postgres mirror (04); ADHA Atom feed (04); Kohesio for ESI funds (10); OECD Tax DB candidate (10); EUDAMED candidate WARROOM_EUDAMED_URL (05).

---

*End of Sections A–Z. All entries derive from the 16 verified discovery reports (wave1 01–08, wave2 09–16); unverified items appear only in this Section Z, explicitly marked. Disagreements between reports are noted inline (Sections Q, V) rather than silently resolved.*
