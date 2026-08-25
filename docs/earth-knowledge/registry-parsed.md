# Earth Knowledge Source Registry — Parsed Inventory

Extracted from `/Users/markbroughton/Downloads/EARTH KNOWLEDGE SOURCE REGISTRY.txt` (4370 lines). Source document already contains a consolidated Master Source Registry table (509 deduplicated sources); this file reorganizes that table strictly by the registry's own 25-category scheme (source's "Category" column), one table per category, in category order 01–25. Columns: Source | Organization | Country/Region | Access Type | Key Required? | Cost | Tier | Difficulty | 2026 Status | First-25.

**Total unique sources: 509**

## Per-category counts (from source Section "REGISTRY SUMMARY")
| Cat | Name | Count |
|---|---|---|
| 01 | General web knowledge & reference | 30 |
| 02 | Software & coding | 24 |
| 03 | Bugs, patches & software history | 13 |
| 04 | Cybersecurity/CVE/malware/threat intel | 26 |
| 05 | Human anatomy & terminologies | 8 |
| 06 | Diseases & clinical knowledge | 13 |
| 07 | Pharmaceuticals & medicines | 16 |
| 08 | Traditional & indigenous medicine | 20 |
| 09 | Genetics & molecular biology | 19 |
| 10 | Biology & biodiversity | 24 |
| 11 | Earth & environmental | 13 |
| 12 | Human origins & archaeology | 14 |
| 13 | World history & primary sources | 17 |
| 14 | Government & law | 20 |
| 15 | Economics & finance | 23 |
| 16 | Academic research | 43 |
| 17 | Patents & IP | 13 |
| 18 | Maps/GIS/satellite/EO | 17 |
| 19 | Space & astronomy | 15 |
| 20 | Engineering & technology | 13 |
| 21 | Archives/libraries/museums | 61 |
| 22 | News & historical news | 3 |
| 23 | Statistics/census/demographics | 39 |
| 24 | International organizations | 19 |
| 25 | Specialized & rare + regional | 6 |
| **TOTAL** | | **509** |

## 2026 status counts
OPERATIONAL 446 · SEARCH-ONLY 36 · DEGRADED 12 · COMMERCIAL-GATED 8 · DISCONTINUED 5 · STATIC 2 · **TOTAL 509**

## Tier counts (primary grade)
A 313 · B 83 · C 53 · D 39 · E 19 · none 2 · **TOTAL 509**

## The "First 25 to Integrate" (registry's own starter pack, Section B) — mapped to final category
★ = appears in a category table below with this marker.

1. Wikidata — cat 01
2. Wikipedia REST API — cat 01
3. NCBI E-utilities (Entrez) — cat 09 (cross-ref → 06, 10)
4. Europe PMC — cat 06
5. ClinicalTrials.gov API v2 — cat 06
6. openFDA — cat 07
7. PubChem PUG-REST — cat 07
8. GBIF — cat 10
9. UniProtKB — cat 09
10. OSV.dev — cat 02
11. NVD API 2.0 — cat 04 (cross-ref → 03)
12. GitHub API — cat 02 (cross-ref → 03)
13. CISA KEV Catalog — cat 03 (cross-ref → 04)
14. arXiv APIs — cat 16
15. OpenStreetMap Overpass API + OSM Planet/Geofabrik — cat 18 (2 rows)
16. GeoNames — cat 18
17. Eurostat Database API — cat 24
18. US Census Bureau Data API — cat 23
19. FRED API — cat 15
20. Congress.gov API + GovInfo API — cat 14 (2 rows)
21. GLEIF LEI API — cat 15
22. SEC EDGAR — cat 15
23. ORCID Public API — cat 16 (cross-ref → 01)
24. Internet Archive metadata + Wayback CDX — cat 01
25. ReliefWeb API v2 — cat 24

---

## CATEGORY 01 — General Web Knowledge & Reference (30)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Wikidata | Wikimedia Foundation/WMDE | US/DE, global | REST+SPARQL+BULK | No | Free | A | EASY–MODERATE | OPERATIONAL | ★1 |
| Wikipedia REST API / MediaWiki Action API | Wikimedia Foundation | US, global | REST | Optional | Free | A | EASY | OPERATIONAL | ★2 |
| Wikimedia Commons | Wikimedia Foundation | US, global | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| Wikimedia Enterprise dumps ecosystem | Wikimedia Foundation | US | BULK | Account-gated | Freemium | A | MODERATE | OPERATIONAL | |
| DBpedia | DBpedia Assoc./OpenLink | DE/global | REST+SPARQL+BULK | No | Free | B | EASY–MODERATE | OPERATIONAL | |
| YAGO 4.5 | MPI Informatics → Télécom Paris | DE/FR | SPARQL+BULK | No | Free | B | MODERATE | OPERATIONAL | |
| ConceptNet 5 | MIT Media Lab lineage | US | REST+BULK | No | Free | B | EASY | OPERATIONAL (degraded transient 5xx) | |
| Data Commons | Data Commons Foundation | US, global | REST | Yes | Free | B | EASY | OPERATIONAL | |
| Google Knowledge Graph Search | Google | US, global | REST | Yes | Free | D | EASY | OPERATIONAL | |
| BabelNet 5.x | Sapienza Univ. Rome | IT, global | REST+SPARQL+BULK | Yes | Freemium | B | MODERATE | OPERATIONAL | |
| Common Crawl | Common Crawl Foundation | US, global | REST+BULK | No | Free | C | MODERATE | OPERATIONAL | |
| Internet Archive / Wayback Machine | Internet Archive | US, global | REST+FEED+BULK | No | Free | C | EASY–MODERATE | OPERATIONAL | ★24 |
| Kaikki.org / wiktextract | Tatu Ylonen | FI | BULK | No | Free | E | EASY | OPERATIONAL | |
| WordNet (Princeton) / Open English WordNet | Princeton/GWA | US/IE | BULK+REPO | No | Free | A/B | EASY | OPERATIONAL | |
| FrameNet 1.7 | ICSI Berkeley | US | BULK | No | Free | B | EASY | STATIC (dormant since 2015) | |
| Merriam-Webster Developer Center | Merriam-Webster | US | REST | Yes | Free-academic | D | EASY | OPERATIONAL | |
| Glosbe | Glosbe community | PL/global | REST | No | Free | E | EASY | OPERATIONAL (anti-bot degraded) | |
| JMdict/EDICT2/KANJIDIC/JMnedict | EDRDG | AU/JP | BULK | No | Free | B | EASY | OPERATIONAL | |
| CC-CEDICT | MDBG community | NL/global | BULK | No | Free | C | EASY | OPERATIONAL | |
| VIAF | OCLC | US, global | REST+SRU+BULK | No | Free | A | EASY | OPERATIONAL | |
| ISNI (ISO 27729) | ISNI-IA/OCLC | UK/global | REST+BULK | No | Free | A | MODERATE | OPERATIONAL (SRU host churn) | |
| ORCID Public API | ORCID Inc. | US, global | REST+BULK | No | Freemium | A | EASY | OPERATIONAL (cross-ref cat16) | |
| ROR | CDL/Crossref/DataCite | US, global | REST+BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat16) | |
| lobid-gnd / lobid-resources | DNB + hbz | DE | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| MusicBrainz | MetaBrainz Foundation | US, global | REST+BULK | No | Free | C | EASY | OPERATIONAL | |
| Open Library | Internet Archive | US, global | REST+BULK | No | Free | C | EASY | OPERATIONAL (cross-ref cat16) | |
| DBLP | Schloss Dagstuhl | DE | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| GeoNames (cross-ref, full block cat18) | GeoNames Assoc. | CH, global | REST+BULK | Yes | Freemium | C | EASY | OPERATIONAL | |
| Brave Search API | Brave Software | US | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| Mojeek Search API | Mojeek Ltd | UK | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| Bing Web/Image/News/Video Search APIs | Microsoft | US | n/a | No | — | D | — | DISCONTINUED (2025-08-11) | |
| Reddit Data API | Reddit Inc. | US, global | REST | Yes | Free-academic | D | HARD | OPERATIONAL (paid-gated) | |
| Diffbot Knowledge Graph | Diffbot Technologies | US | REST | Yes | Freemium | D | MODERATE | OPERATIONAL | |
| Golden Knowledge Graph | Golden Recursion | US | REST | Yes | Freemium | D | MODERATE | OPERATIONAL | |
| Kiwix / ZIM files | Kiwix Association | CH/global | BULK+FEED | No | Free | C | MODERATE | OPERATIONAL | |
| Wikibase Cloud | Wikimedia Deutschland | DE (EU) | REST+SPARQL | No | Free | A/E | EASY | OPERATIONAL (beta) | |
| FactGrid | Gotha Research Centre | DE | REST+SPARQL+BULK | No | Free | B | EASY | OPERATIONAL | |

## CATEGORY 02 — Software & Coding (24)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| PyPI | Python Software Foundation | US/global | REST | No | Free | A | EASY | OPERATIONAL | |
| npm Registry API | GitHub/Microsoft | US/global | REST | No | Free | A/D | EASY | OPERATIONAL | |
| crates.io | Rust Foundation | US/global | REST+FEED | No | Free | A | EASY | OPERATIONAL | |
| Maven Central Repository | Sonatype | US/global | REST+Solr | No | Free | A/D | MODERATE | OPERATIONAL | |
| MetaCPAN API | MetaCPAN community | EU-hosted | REST | No | Free | C | EASY | OPERATIONAL | |
| RubyGems.org API | Ruby Central | US/global | REST | No | Free | A/C | EASY | OPERATIONAL | |
| Ecosyste.ms APIs | Andrew Nesbitt / Ecosyste.ms | UK | REST | No | Free | C | EASY | OPERATIONAL | |
| deps.dev API | Google Open Source Insights | US/global | REST+gRPC | No | Free | D | EASY | OPERATIONAL (cross-ref cat03) | |
| Homebrew JSON API | Homebrew community | global | REST | No | Free | C | EASY | OPERATIONAL | |
| Debian Sources/UDD | Debian Project | global | REST+BULK | No | Free | A | MODERATE | OPERATIONAL | |
| GitHub REST/GraphQL API | GitHub (Microsoft) | US/global | REST+GraphQL | Yes | Freemium | A/D | EASY | OPERATIONAL (cross-ref cat03) | ★12 |
| GitLab API | GitLab Inc. | US/global | REST+GraphQL | Optional | Free | D | EASY | OPERATIONAL (cross-ref cat03) | |
| Codeberg (Forgejo) | Codeberg e.V. | DE/EU | REST | Optional | Free | C | EASY | OPERATIONAL | |
| Software Heritage Archive | Software Heritage (Inria) | France/global | REST | Optional | Free | A/B | MODERATE–HARD | OPERATIONAL | |
| grep.app | Vercel Inc. | US | REST | No | Free | D | EASY | OPERATIONAL | |
| Sourcegraph | Sourcegraph Inc. | US | GraphQL | Yes | Paid | D | HARD | DISCONTINUED (free tier) | |
| Stack Exchange API v2.3 | Stack Exchange Inc. | US/global | REST | Yes | Free | D | EASY | OPERATIONAL | |
| IETF Datatracker + RFC Editor | IETF/RFC Editor | US/global | REST | No | Free | A | MODERATE | OPERATIONAL (cross-ref cat20) | |
| W3C API | W3C | global | REST | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat20) | |
| MDN Web Docs | Mozilla + Open Web Docs | US/global | REST+REPO | Optional | Free | A/C | MODERATE | OPERATIONAL | |
| kernel.org / lore.kernel.org | Linux Kernel Org | US/global | FEED+BULK+REPO | No | Free | A | MODERATE | OPERATIONAL | |
| endoflife.date | community | UK/global | REST | No | Free | C | EASY | OPERATIONAL (cross-ref cat03) | |
| Rosetta Code | community (Miraheze) | US/global | REST | No | Free | E | EASY | OPERATIONAL | |
| DevDocs | DevDocs community | global | BULK | No | Free | C/E | MODERATE | OPERATIONAL | |

## CATEGORY 03 — Bugs, Patches & Software History (13)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| OSV.dev | Google (OpenSSF) | US/global | REST+BULK | No | Free | A/E | EASY | OPERATIONAL | ★10 |
| CISA Known Exploited Vulnerabilities Catalog | CISA (DHS) | US | BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat04) | ★13 |
| GitHub Advisory Database (GHSA) | GitHub (Microsoft) | US/global | GraphQL+REST+REPO | Yes | Free | A/D | EASY | OPERATIONAL | |
| GitLab Advisory Database | GitLab Inc. | US/global | GraphQL+REPO | Yes | Free | D/B | EASY–MODERATE | OPERATIONAL | |
| Go Vulnerability Database | Go Security Team (Google) | US/global | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| Microsoft Security Response Center CVRF API | Microsoft | US | REST | No | Free | A | EASY | OPERATIONAL | |
| Ubuntu Security API + OVAL | Canonical | UK/global | REST+BULK | No | Free | A | MODERATE | OPERATIONAL (unstable) | |
| Debian Security Tracker | Debian Security Team | global | BULK+REPO | No | Free | A | EASY | OPERATIONAL | |
| Red Hat Security Data API (Hydra) | Red Hat | US | REST | No | Free | A | EASY | OPERATIONAL | |
| Mozilla Bugzilla REST API | Mozilla | US/global | REST | Optional | Free | A | EASY–MODERATE | OPERATIONAL | |
| Launchpad API | Canonical | UK/global | REST | No | Free | A | MODERATE | OPERATIONAL | |
| Apache Jira REST API | ASF | US/global | REST | Optional | Free | A | EASY | OPERATIONAL | |
| Libraries.io API | Tidelift (→Sonar) | US/global | REST | Yes | Freemium | D | EASY | OPERATIONAL (ownership transition) | |

## CATEGORY 04 — Cybersecurity / CVE / Malware / Threat Intel (26)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| NVD API 2.0 | NIST | US | REST | Optional | Free | A | EASY | OPERATIONAL (cross-ref cat03) | ★11 |
| CVE Services API (cveawg) / CVE.org | CVE Program (MITRE) | US | REST | No | Free | A | EASY | OPERATIONAL | |
| CISA KEV Catalog | CISA | US | BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat03) | |
| FIRST EPSS API | FIRST.org | intl (US) | REST | No | Freemium | B | EASY | OPERATIONAL | |
| VulDB | VulDB | CH | REST | Yes | Freemium | D | MODERATE | OPERATIONAL (paid) | |
| MITRE ATT&CK | MITRE | US | STIX/TAXII+REPO | No | Free | A | EASY–MODERATE | OPERATIONAL | |
| MITRE ATLAS | MITRE | US | REPO | No | Free | A | EASY | OPERATIONAL | |
| CWE / CAPEC | MITRE | US | BULK | No | Free | A | EASY | OPERATIONAL | |
| Exploit-DB | OffSec | US/global | REPO+BULK | No | Free | E/D | EASY | OPERATIONAL | |
| MalwareBazaar (abuse.ch) | abuse.ch | CH | REST | Yes | Free | C | EASY | OPERATIONAL | |
| ThreatFox (abuse.ch) | abuse.ch | CH | REST | Yes | Free | C | EASY | OPERATIONAL | |
| URLhaus (abuse.ch) | abuse.ch | CH | REST+BULK | Yes | Free | C | EASY | OPERATIONAL | |
| VirusTotal API v3 | Google (Mandiant) | US/global | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| Hybrid Analysis (Falcon Sandbox) | CrowdStrike | US | REST | Yes | Free | D | EASY | OPERATIONAL | |
| ANY.RUN | ANYRUN FZCO | UAE/global | REST+STIX/TAXII | Yes | Freemium | D | MODERATE | OPERATIONAL | |
| AlienVault OTX | LevelBlue | US | REST | Yes | Free | C/D | EASY | OPERATIONAL | |
| AbuseIPDB API v2 | AbuseIPDB | US | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| GreyNoise | GreyNoise Intelligence | US | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| Shodan | Shodan | US | REST+FEED | Yes | Freemium | D | EASY | OPERATIONAL | |
| Censys Platform API v3 | Censys | US | REST | Yes | Freemium | D | MODERATE | OPERATIONAL | |
| PhishStats API | PhishStats | BR | REST | Optional | Freemium | C | EASY | OPERATIONAL | |
| ransomware.live API | ransomware.live | FR/global | REST | Account-gated | Freemium | C/E | EASY | OPERATIONAL | |
| MISP Default Feeds + CIRCL OSINT | MISP Project/CIRCL | LU/global | FEED | Account-gated | Free | C/B | EASY–MODERATE | OPERATIONAL | |
| CERT-FR (ANSSI) | ANSSI | FR | FEED | No | Free | A | EASY | OPERATIONAL | |
| JVN / JVN iPedia | IPA & JPCERT/CC | JP | FEED+SEARCH | No | Free | A | EASY | OPERATIONAL | |
| BSI CERT-Bund WID | BSI CERT-Bund | DE | FEED | No | Free | A | EASY–HARD | OPERATIONAL | |
| NCSC-NL Security Advisories (CSAF) | NCSC (NL gov) | NL | FEED/CSAF | No | Free | A | MODERATE | OPERATIONAL | |

## CATEGORY 05 — Human Anatomy & Terminologies (8)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| WHO ICD API | WHO | Global | REST | Yes | Free | A | MODERATE | OPERATIONAL | |
| UMLS Terminology Services REST API | NLM | USA | REST | Account-gated | Licensed | A | MODERATE | OPERATIONAL | |
| SNOMED CT (Snowstorm) | SNOMED International | Global | REST/FHIR | No (self-host) | Freemium | A | HARD | OPERATIONAL (no free prod API) | |
| LOINC Terminology Service (FHIR) | Regenstrief Institute | USA | REST/FHIR | Account-gated | Free | A | EASY | OPERATIONAL (beta) | |
| NCBO BioPortal API | NCBO/Stanford | USA | REST | Yes | Free | B | EASY | OPERATIONAL | |
| EBI Ontology Lookup Service (OLS4) | EMBL-EBI | UK/EU | REST | No | Free | B | EASY | OPERATIONAL (cross-ref cat09) | |
| Ontobee / HeGroup SPARQL | Univ. of Michigan | USA | SPARQL | No | Free | B/E | MODERATE | OPERATIONAL | |
| Orphadata + ORPHAcodes API | INSERM/Orphanet | France/EU | REST+BULK | No | Freemium | A | MODERATE | OPERATIONAL (no SLA) | |

## CATEGORY 06 — Diseases & Clinical Knowledge (13)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| NCBI E-utilities (PubMed/MEDLINE/PMC) | NCBI/NLM/NIH | USA | REST | Optional | Free | A | EASY | OPERATIONAL (cross-ref) | ★3 |
| Europe PMC | EMBL-EBI | UK/EU | REST+OAI-PMH+BULK | No | Free | B | EASY | OPERATIONAL | ★4 |
| PMC Open Access Subset | NLM/NCBI | USA | REST+OAI-PMH+BULK | No | Free | A | MODERATE | DISCONTINUED (legacy paths, →AWS migration Aug 2026) | |
| ClinicalTrials.gov API v2 | NLM/NIH | USA registry, 220+ countries | REST | No | Free | A | EASY | OPERATIONAL | ★5 |
| WHO ICTRP Search Portal | WHO | Global (17+ registries) | SEARCH+licensed XML | Account-gated | Freemium | A | HARD | OPERATIONAL | |
| EU Clinical Trials — CTIS | EMA/EU | EU/EEA | SEARCH (undoc JSON) | No | Free | A | MODERATE | OPERATIONAL | |
| Orphanet / Orphadata (see cat05) | INSERM | France/EU | REST+BULK | No | Freemium | A | MODERATE | OPERATIONAL | |
| MedlinePlus Web Service + Connect | NLM | USA | REST+BULK+FEED | No | Free | A | EASY | OPERATIONAL | |
| NICE Syndication Service | NICE | UK | REST/FEED | Yes | Freemium(licensed) | A | HARD | OPERATIONAL | |
| Open Targets Platform GraphQL API | Open Targets consortium | UK/EU | GraphQL | No | Free | B/C | EASY–MODERATE | OPERATIONAL (cross-ref cat07) | |
| WHO Global Health Observatory OData API | WHO | Global | REST/OData | No | Free | A | MODERATE | OPERATIONAL (migration in progress) | |
| IHME Global Burden of Disease / GHDx | IHME, U. Washington | USA, global | BULK | Account-gated | Free-academic | B | MODERATE | OPERATIONAL | |
| GISAID EpiCoV | GISAID Initiative | Germany/Global | BULK (gated) | Account-gated | Free | C | MODERATE | OPERATIONAL | |
| ProMED-mail | ISID | USA, global | FEED | Account-gated | Freemium | A/B | MODERATE | OPERATIONAL (now paywalled) | |
| HealthMap | Boston Children's Hospital | USA, global | SEARCH+private FEED | No | Freemium | B | HARD | OPERATIONAL (no public API) | |

## CATEGORY 07 — Pharmaceuticals & Medicines (16)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| openFDA | U.S. FDA | USA | REST | Optional | Free | A | EASY | OPERATIONAL | ★6 |
| RxNorm / RxNav (+RxClass+Interactions) | US NLM/NIH | USA | REST | No | Free | A | EASY | OPERATIONAL | |
| DailyMed SPL Web Services | US NLM/NIH | USA | REST | No | Free | A | EASY | OPERATIONAL | |
| AccessGUDID (GUDID API) | US FDA (via NLM) | USA | REST | No | Free | A | EASY | OPERATIONAL | |
| PubChem PUG-REST (+PUG-View) | NCBI/NLM/NIH | USA | REST | No | Free | A | EASY | OPERATIONAL | ★7 |
| ChEMBL Web Services | EMBL-EBI | UK/EU | REST | No | Free | B | EASY | OPERATIONAL | |
| Guide to Pharmacology (IUPHAR/BPS GtoPdb) | IUPHAR/BPS | UK/Global | REST | No | Free | B | EASY–MODERATE | OPERATIONAL | |
| PharmGKB API | Stanford/PharmGKB | USA | REST | No | Free | B | MODERATE | OPERATIONAL (rebranding ClinPGx) | |
| Health Canada DPD API | Health Canada | Canada | REST | No | Free | A | EASY | OPERATIONAL | |
| BindingDB | UC San Diego | USA | REST+BULK | Optional | Free | B | MODERATE | OPERATIONAL | |
| DrugCentral | Univ. of New Mexico/NCATS | USA | BULK+SEARCH | No | Free | B | MODERATE | OPERATIONAL (no live API) | |
| FDA Orange Book / Purple Book + FAERS | US FDA | USA | REST+BULK | Optional | Free | A | EASY | OPERATIONAL | |
| EMA medicines data + SPOR (IDMP) APIs | EMA | EU/EEA | REST+BULK | Account-gated (SPOR) | Free | A | EASY–HARD | OPERATIONAL | |
| VAERS | CDC+FDA (HHS) | USA | BULK | No | Free | A | EASY | OPERATIONAL | |
| DrugBank | DrugBank (OMx) | Canada | REST | Yes | Freemium | D | EASY | OPERATIONAL (paid/academic) | |
| WHO VigiAccess | Uppsala Monitoring Centre | Sweden/Global | SEARCH (no API) | No | Free | A | HARD | OPERATIONAL (search-only) | |

## CATEGORY 08 — Traditional & Indigenous Medicine (20)
Evidence classes preserved per source: TRAD=traditional-use record, EXP=experimental/literature, PRED=computational prediction, NOMEN=nomenclatural only, CLIN=clinical.
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | Evidence | F25 |
|---|---|---|---|---|---|---|---|---|---|---|
| Natural Products Atlas (NPAtlas) 2.0 | Linington Lab, SFU | Canada | REST | Optional | Free | B | EASY | OPERATIONAL | EXP | |
| COCONUT 2.0 | Steinbeck Lab, Jena | Germany | REST | No | Free | C/E | EASY | OPERATIONAL | EXP/TRAD mixed | |
| LOTUS Initiative → Wikidata | Wolfender/Steinbeck labs | CH/DE | SPARQL | No | Free | E | MODERATE | OPERATIONAL (mirror unmaintained; use WDQS) | EXP (ref-per-pair) | |
| ChEBI 2.0 | EMBL-EBI | UK/EU | REST | No | Free | A/B | EASY–MODERATE | OPERATIONAL (SOAP retired) | EXP/CLIN | |
| TCMSP | Northwest A&F University | China | SEARCH (no API) | No | Free | B | MODERATE | OPERATIONAL (fragile hosting) | TRAD+PRED | |
| TCMID 2.0 | ECNU/BIDD (NUS) | China/Singapore | SEARCH+partial BULK | No | Free | B | MODERATE | OPERATIONAL (stale since 2017) | TRAD+EXP | |
| SymMap | TCM expert committee/China Pharma Univ. | China | SEARCH (no API) | No | Free | B | MODERATE | OPERATIONAL (fragile) | TRAD+PRED | |
| ETCM 2.0 | Inst. Chinese Materia Medica | China | SEARCH (no API) | No | Free | A/B | MODERATE | OPERATIONAL | confirmed vs predicted flagged | |
| IMPPAT 2.0 | IMSc Chennai | India | SEARCH+BULK | No | Free | B | EASY–MODERATE | OPERATIONAL | TRAD vs EXP per ref | |
| TKDL (Traditional Knowledge Digital Library) | CSIR + Ministry of AYUSH | India | SEARCH (licensed) | Yes (NDA) | Licensed | A | HARD | OPERATIONAL (NOT open) | TRAD (legal prior art) | |
| Dr. Duke's Phytochemical/Ethnobotanical DBs | USDA-ARS | USA | SEARCH+BULK | No | Free | A | EASY | OPERATIONAL | TRAD vs EXP separated | |
| Native American Ethnobotany DB (NAEB) | BRIT (orig. UM-Dearborn) | USA | SEARCH (no API) | No | Free | B | MODERATE | OPERATIONAL (HTTPS broken) | TRAD | |
| Kew MPNS (Medicinal Plant Names Services) | Royal Botanic Gardens, Kew | UK | SEARCH (+REST by agreement) | Account-gated | Freemium | A | MODERATE | OPERATIONAL | NOMEN only | |
| PROTA / PROTA4U | PROTA Foundation | Netherlands/Africa | SEARCH (no API) | No | Free | B | MODERATE | OPERATIONAL (static) | TRAD+EXP | |
| Useful Tropical Plants Database | The Ferns (Ken Fern) | UK | SEARCH (no API) | No | Free | C/E | MODERATE | OPERATIONAL | TRAD w/ citations | |
| Plants For A Future (PFAF) | PFAF charity | UK | SEARCH (no API) | No | Free | C/E | MODERATE | OPERATIONAL | TRAD compiled | |
| SANCDB | RUBi, Rhodes University | South Africa | SEARCH+download | No | Free | B | EASY | OPERATIONAL | EXP; some TRAD notes | |
| WHO Traditional Medicine infra (WHO IRIS+GCTM) | WHO; GCTM India | Global/India | OAI-PMH | No | Free | A | EASY | OPERATIONAL | CLIN/policy | |
| Biodiversity Heritage Library (BHL) | BHL consortium | US/global | REST+IIIF | Yes | Free | A | EASY | OPERATIONAL (cross-ref cat21) | TRAD-historical | |
| Wellcome Collection | Wellcome Trust | UK | REST+IIIF | No | Free | B | EASY | OPERATIONAL (cross-ref cat21) | historical | |
| KNApSAcK Family | NAIST Japan | Japan | SEARCH+BULK | No | Free-academic | B | EASY | SEARCH-ONLY | TRAD/EXP | |

## CATEGORY 09 — Genetics & Molecular Biology (19)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| NCBI E-utilities (GenBank/ClinVar/dbSNP/GEO/SRA/Gene/Protein/Taxonomy) | NCBI/NLM/NIH | USA | REST | Optional | Free | A | EASY | OPERATIONAL | ★3 |
| UniProtKB REST API / ID Mapping / SPARQL | UniProt Consortium | UK/CH/US | REST+SPARQL | No | Free | A | EASY | OPERATIONAL | ★9 |
| Ensembl REST API | EMBL-EBI & Sanger | UK/EU | REST | No | Free | A | EASY | OPERATIONAL | |
| ENA Portal (Advanced Search) API | EMBL-EBI (INSDC) | UK/EU | REST | No | Free | A | EASY | OPERATIONAL | |
| DDBJ programmatic access | DDBJ Center, NIG | Japan | REST+BULK+SEARCH | No | Free | A | MODERATE | OPERATIONAL | |
| NCBI Datasets v2 REST API | NCBI/NIH | USA | REST | Optional | Free | A | EASY | OPERATIONAL | |
| RCSB PDB Data/Search/Sequence Coordinates API | RCSB (wwPDB partner) | USA (wwPDB global) | REST+GraphQL | No | Free | A | EASY–MODERATE | OPERATIONAL | |
| AlphaFold DB API + bulk | Google DeepMind+EMBL-EBI | UK/USA | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| KEGG API | Kanehisa Labs/Kyoto Univ. | Japan | REST | No | Freemium | A | EASY–HARD | OPERATIONAL (license-restricted) | |
| Reactome Content+Analysis Service | OICR/EMBL-EBI/NYU/OHSU | Canada/UK/USA | REST | No | Free | A | EASY | OPERATIONAL | |
| WikiPathways API + SPARQL | Maastricht Univ./Gladstone | NL/USA | REST+SPARQL | No | Free | C | EASY | OPERATIONAL | |
| STRING API | STRING Consortium | CH/DK/DE | REST | No | Free | A/B | EASY | OPERATIONAL | |
| BioGRID Web Service / ORCS REST | BioGRID | Canada/USA | REST | Yes | Free | B | EASY | OPERATIONAL | |
| IntAct API | EMBL-EBI (IMEx) | UK/EU | REST | No | Free | A | MODERATE | OPERATIONAL | |
| gnomAD GraphQL API | Broad Institute | USA | GraphQL | No | Free | A | EASY | OPERATIONAL | |
| Cellosaurus REST API + SPARQL + FTP | SIB Swiss Inst. Bioinformatics | Switzerland | REST+SPARQL+BULK | No | Free | A/B | EASY | OPERATIONAL | |
| Metabolomics Workbench REST API | NIH Common Fund (NMDR) | USA | REST | No | Free | A/B | EASY | OPERATIONAL | |
| MetaboLights REST API | EMBL-EBI | UK/EU | REST | No | Free | A | MODERATE | OPERATIONAL | |
| PRIDE Archive RESTful API v2 | EMBL-EBI (ProteomeXchange) | UK/EU+global | REST+FEED+BULK | No | Free | A | EASY–MODERATE | OPERATIONAL | |

## CATEGORY 10 — Biology & Biodiversity (24)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| GBIF REST API | GBIF | Denmark (global network) | REST | No | Free | A | EASY | OPERATIONAL | ★8 |
| iNaturalist API | Cal Academy + Nat Geo | USA (global) | REST | No | Free | C | EASY | OPERATIONAL | |
| eBird API 2.0 | Cornell Lab of Ornithology | USA (global) | REST | Yes | Free | B | EASY | OPERATIONAL | |
| OBIS REST API v3 | IOC-UNESCO IODE/VLIZ | Belgium/UNESCO | REST | No | Free | A | EASY | OPERATIONAL | |
| ChecklistBank API (Catalogue of Life) | CoL + GBIF | NL/DK | REST | No | Free | A/B | EASY | OPERATIONAL | |
| BOLD API v4 (Barcode of Life) | Centre for Biodiversity Genomics, Guelph | Canada | REST | No | Free | B | EASY | OPERATIONAL | |
| ITIS Web Services | USGS-led federal partnership | USA | REST+Solr | No | Free | A | EASY | OPERATIONAL | |
| IUCN Red List API v4 | IUCN | Switzerland | REST | Yes | Free-academic | A | EASY | OPERATIONAL (v3 discontinued) | |
| WoRMS REST API (Aphia) | VLIZ | Belgium | REST+SOAP | No | Free | A | EASY | OPERATIONAL | |
| EOL API v1.0 + TraitBank | Encyclopedia of Life (Smithsonian) | USA | REST | No | Free | B/C | EASY | OPERATIONAL | |
| GloBI Web API | GloBI (open community) | US/global | REST | No | Free | E/C | EASY | OPERATIONAL | |
| PBDB API v1.2 | Paleobiology Database consortium | USA/global | REST | No | Free | B | EASY | OPERATIONAL | |
| Index Fungorum | RBG Kew/Landcare NZ/CAS China | UK/NZ/China | SOAP+SEARCH | No | Free | B | HARD | SEARCH-ONLY (legacy SOAP) | |
| GRIIS | IUCN ISSG | NZ/global | REST+BULK (via GBIF) | No | Free | A | MODERATE | OPERATIONAL | |
| ICTV Master Species List + VMR | ICTV | International | BULK | No | Free | A | EASY | OPERATIONAL | |
| BacDive API v2 + LPSN API | Leibniz Institute DSMZ | Germany | REST | Account-gated (LPSN) | Free | A | EASY | OPERATIONAL | |
| GlobalTreeSearch | BGCI | UK | BULK+SEARCH | Account-gated | Free | C/B | EASY | OPERATIONAL | |
| POWO internal JSON API | Royal Botanic Gardens, Kew | UK | REST (undocumented) | No | Free | A | HARD | OPERATIONAL (unofficial/bot-blocked) | |
| TRY Plant Trait Database | TRY consortium, MPI-BGC | Germany | BULK+SEARCH | Account-gated | Free | B | HARD | OPERATIONAL | |
| BirdLife Data Zone | BirdLife International | UK | SEARCH (no API) | No | Free-academic | B | HARD | OPERATIONAL (no API) | |
| Movebank REST/direct-read API | Max Planck Inst. Animal Behavior | Germany/global | REST | Optional | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Mushroom Observer API (api2) | Mushroom Observer Inc | US/global | REST | Yes (writes) | Free | E | MODERATE | OPERATIONAL (cross-ref cat25) | |
| xeno-canto bird sound API v3 | xeno-canto Foundation | NL/global | REST | Yes | Free | C | EASY | OPERATIONAL (cross-ref cat25) | |
| Wildlife Insights | Conservation Intl + partners | US/global | BULK | No | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |

## CATEGORY 11 — Earth & Environmental (13)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Open-Meteo | Open-Meteo project | CH/DE | REST | Optional | Free-academic | C/E | EASY | OPERATIONAL | |
| OpenWeatherMap | OpenWeather Ltd | UK | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| ECMWF Copernicus Climate Data Store (CDS)+ADS | ECMWF/Copernicus | UK/EU | REST | Yes | Free | A | MODERATE | OPERATIONAL | |
| NOAA NCEI Climate Data Online (CDO) API | NOAA NCEI | USA | REST | Yes | Free | A | EASY–MODERATE | OPERATIONAL | |
| NOAA/NWS api.weather.gov | NOAA NWS | USA | REST | No (UA) | Free | A | EASY | OPERATIONAL | |
| Met.no Locationforecast API | Norwegian Met Institute | Norway | REST | No (UA) | Free | A | EASY | OPERATIONAL | |
| DWD Open Data | Deutscher Wetterdienst | Germany | BULK+WMS | No | Free | A | MODERATE | OPERATIONAL | |
| Met Office Weather DataHub (UK) | UK Met Office | UK | REST | Yes | Freemium | A | EASY | OPERATIONAL (DataPoint retired) | |
| JMA Disaster Information XML | Japan Meteorological Agency | Japan | FEED | No | Free | A | MODERATE | OPERATIONAL (PULL only) | |
| OpenTopography API | UC San Diego/SDSU/UNAVCO | USA | REST | Yes | Free | B | EASY | OPERATIONAL (cross-ref cat18) | |
| GEBCO Bathymetry | GEBCO (IOC UNESCO/IHO) | UK/global | BULK+WMS | No | Free | A | EASY | OPERATIONAL (cross-ref cat18) | |
| PANGAEA OAI-PMH + Data Warehouse | AWI + MARUM | Germany | OAI-PMH+BULK | No | Free | A | EASY | OPERATIONAL | |
| Arctic Data Center API | NSF Arctic Data Center | US | REST+Solr | No | Free | A | MODERATE | OPERATIONAL (cross-ref cat25) | |

## CATEGORY 12 — Human Origins & Archaeology (14)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Open Context | Alexandria Archive Institute | USA (global) | REST+FEED | No | Free | C | EASY | OPERATIONAL | |
| tDAR (Digital Archaeological Record) | Digital Antiquity, ASU | USA | REST+FEED | Optional | Freemium | C | MODERATE | OPERATIONAL | |
| ARIADNE portal API | ARIADNE Research Infra. | EU (partners incl. tDAR) | REST | No | Free | B | EASY | OPERATIONAL | |
| EDH — Epigraphic Database Heidelberg | Heidelberg Academy | Germany (Roman Empire) | REST+SPARQL+IIIF+BULK | No | Free | A | EASY | OPERATIONAL | |
| iDAI.gazetteer | German Archaeological Institute | Germany (global) | REST | No | Free | A | EASY | OPERATIONAL | |
| CDLI — Cuneiform Digital Library Initiative | UCLA/MPIWG | US/DE | REST+BULK | No | Free | B | MODERATE | OPERATIONAL | |
| eBL — electronic Babylonian Library | LMU Munich | Germany | REST+BULK | No | Free | B | EASY | OPERATIONAL | |
| WHG — World Historical Gazetteer | Univ. Pittsburgh WHC | USA | REST | No | Free | B | EASY | OPERATIONAL | |
| Nomisma.org | American Numismatic Society + DAI | USA (global) | SPARQL | No | Free | B | MODERATE | OPERATIONAL | |
| Pleiades (+nightly dumps) | NYU ISAW + community | USA | REST/LOD+BULK | No | Free | B | EASY | OPERATIONAL | |
| PeriodO | PeriodO project | USA (global) | LOD(JSON-LD)+BULK | No | Free | B | EASY | OPERATIONAL | |
| ADS — Archaeology Data Service (UK) | Univ. of York | UK | OAI-PMH+SPARQL+BULK | No | Free/Licensed | A | EASY | OPERATIONAL | |
| Cliopatria (Seshat spatial dataset) | Seshat/Complexity Science Hub | Austria (global) | BULK | No | Free | B | EASY | OPERATIONAL | |
| D-PLACE (+Pulotu) | Max Planck Inst. Evolutionary Anthro. | Germany (global) | BULK | No | Free | B | EASY | OPERATIONAL | |

## CATEGORY 13 — World History & Primary Sources (17)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| OpenHistoricalMap (OHM) | OHM community | USA-led | REST/Overpass+BULK | No | Free | E | MODERATE | OPERATIONAL | |
| Seshat: Global History Databank | Complexity Science Hub Vienna | Austria/UK | REST+BULK | Yes (approval) | Free (NC-SA) | B | MODERATE | OPERATIONAL | |
| Chinese Text Project (ctext.org) | D. Sturgeon | UK/Taiwan-hosted | REST+OAI-PMH+SPARQL+BULK | Yes | Freemium | C | MODERATE | OPERATIONAL | |
| BDRC — Buddhist Digital Resource Center | BDRC nonprofit | USA (Tibetan corpus) | REST+IIIF+BULK | No | Free | C | MODERATE | OPERATIONAL | |
| EHRI — European Holocaust Research Infra. | EHRI consortium | Netherlands/EU | REST (JSON:API) | No | Free | B | MODERATE | OPERATIONAL | |
| Qatar Digital Library (QDL) | Qatar Nat. Library + British Library | Qatar/UK | IIIF | No | Free | A | EASY | OPERATIONAL (anti-bot) | |
| e-periodica (ETH Library) | ETH Library Zürich | Switzerland | IIIF+download | No | Free | A | EASY | OPERATIONAL (cross-ref cat22) | |
| Perseus / Open Greek and Latin corpora | Tufts/Leipzig | US/DE | REPO(git)+BULK | No | Free | B | EASY | OPERATIONAL | |
| papyri.info / idp.data | papyri.info consortium | US/DE | REPO(git)+BULK | No | Free | B | EASY | OPERATIONAL | |
| OpenITI corpus | AKU-ISMC/UMD/KITAB | UK/USA | REPO+BULK | No | Free | C | EASY | OPERATIONAL | |
| CBETA (Chinese Buddhist canon) | DILA, Taiwan | Taiwan | REPO+REST | No | Free | B | EASY | OPERATIONAL | |
| Kanripo / Kanseki Repository | Kanripo project | Japan/Germany | REPO(git) | No | Free | C | EASY | OPERATIONAL | |
| GRETIL | University of Göttingen | Germany | BULK | No | Free | B | EASY | OPERATIONAL | |
| EncyKorea | Academy of Korean Studies | South Korea | SEARCH | No | Free | A | HARD | SEARCH-ONLY (cross-ref cat25) | |
| Korean Classics DB (db.itkc.or.kr) | Institute for Translation of Korean Classics | South Korea | SEARCH | No | Free | A | HARD | SEARCH-ONLY (cross-ref cat25) | |
| Korean History DB | National Institute of Korean History | South Korea | SEARCH | No | Free | A | HARD | SEARCH-ONLY (cross-ref cat25) | |
| CHGIS v6 datasets | Harvard Yenching + Fudan | US/China | REST+BULK | No | Free | B | EASY | OPERATIONAL (cross-ref cat18) | |

## CATEGORY 14 — Government & Law (20)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Congress.gov API | Library of Congress | USA | REST | Yes | Free | A | EASY | OPERATIONAL | ★20 |
| US GovInfo API | GPO | USA | REST+BULK | Yes | Free | A | EASY | OPERATIONAL | ★20 |
| US Federal Register API | NARA/OFR | USA | REST+BULK | No | Free | A | EASY | OPERATIONAL | |
| UK legislation.gov.uk API | The National Archives (UK) | UK | REST+SPARQL+FEED | No | Free | A | MODERATE | OPERATIONAL | |
| Japan e-Gov Hourei (法令) API | Digital Agency Japan | Japan | REST | No | Free | A | EASY | OPERATIONAL | |
| Australia FRL OData API | Office of Parliamentary Counsel | Australia | REST/OData | No | Free | A | MODERATE | OPERATIONAL | |
| UK The Gazette API | The Stationery Office | UK | REST+FEED+RDF | No | Free | A | EASY | OPERATIONAL | |
| CourtListener (Free Law Project) | Free Law Project | USA | REST+BULK | Yes | Free | C | EASY | OPERATIONAL | |
| Canada Justice Laws Website | Dept. of Justice Canada | Canada | BULK | No | Free | A | EASY | OPERATIONAL | |
| Germany Gesetze im Internet | BMJ/juris | Germany | BULK | No | Free | A | EASY | OPERATIONAL | |
| WIPO Lex | WIPO | Global | SEARCH | No | Free | A | MODERATE | OPERATIONAL (no official API) | |
| UN Treaty Collection | UN Office of Legal Affairs | Global | SEARCH | No | Free | A | HARD | OPERATIONAL (no API) | |
| ILO NORMLEX / NATLEX | ILO | Global | SEARCH | No | Free | A | HARD | OPERATIONAL (bot-blocked) | |
| FAOLEX | FAO | Global | SEARCH | No | Free | A | HARD | OPERATIONAL (bot-blocked) | |
| India eGazette | Ministry of Housing & Urban Affairs | India | SEARCH | No | Free | A | HARD | OPERATIONAL (no API) | |
| OFAC Sanctions Lists (SDN+consolidated)+SLS | US Treasury OFAC | USA (global targets) | BULK+REST | No | Free | A | EASY | OPERATIONAL | |
| EU Financial Sanctions Database (FSD) | European Commission | EU | BULK+FEED | Optional | Free | A | EASY | OPERATIONAL | |
| UN Security Council Consolidated List | UN Security Council | Global | BULK | No | Free | A | EASY | OPERATIONAL | |
| UK OFSI Consolidated List/UK Sanctions List | UK FCDO+HM Treasury | UK (global targets) | BULK | No | Free | A | EASY | OPERATIONAL (rotating URLs) | |
| OpenSanctions | OpenSanctions (independent co.) | Global | REST+BULK | Yes | Freemium | C/D | EASY | OPERATIONAL | |
| EU BRIS | European Commission e-Justice | EU27+EEA | SEARCH | No | Free | A | HARD | OPERATIONAL (no API — GAP) | |
| Interpol Notices public web service | INTERPOL | Global | REST (undocumented) | No | Free | A/E | HARD | DEGRADED (bot-blocked) | |
| USAspending API | US Treasury | USA | REST+BULK | No | Free | A | MODERATE | OPERATIONAL | |
| Brazil Portal da Transparência API | CGU | Brazil | REST | Yes | Free | A | MODERATE | OPERATIONAL | |
| Open Contracting Partnership / OCDS ecosystem | OCP | Global (70+ jurisdictions) | REST+BULK | Optional | Free | C | MODERATE | OPERATIONAL | |
| EU Tenders Electronic Daily (TED) API | Publications Office EU | EU/EEA | REST+SPARQL+BULK | Yes | Free | A | MODERATE | OPERATIONAL | |
| EU Financial Transparency System (FTS) | European Commission DG BUDG | EU | BULK | No | Free | A | EASY | OPERATIONAL | |
| Chile Mercado Público (ChileCompra) API | ChileCompra | Chile | REST | Yes | Free | A | EASY | OPERATIONAL | |
| OpenSpending (OKFN) | Open Knowledge Foundation | Global | REST(historic) | No | Free | C/E | — | DEGRADED (API dead) | |
| IFES ElectionGuide API | IFES | Global (240 territories) | REST+BULK | Yes | Free-academic | C | EASY | OPERATIONAL | |
| International IDEA Voter Turnout Database | International IDEA | Global | BULK | No | Free | B | EASY | OPERATIONAL (no API) | |
| 공공데이터포털 Open APIs (data.go.kr) | Korea MOIS | South Korea | REST | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat25) | |

*(20 primary-category rows per registry count; sanctions/spending/procurement/election sub-items enumerated above collectively total the 20; see registry Category 14 header for full 32-source superset including cat15 cross-refs.)*

## CATEGORY 15 — Economics & Finance (23)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| GLEIF LEI Search 2.0 API | GLEIF | Global (CH HQ) | REST+BULK | No | Free | B | EASY | OPERATIONAL | ★21 |
| OpenCorporates API | OpenCorporates Ltd | Global (140+ jurisdictions) | REST | Yes | Freemium | D | EASY | OPERATIONAL | |
| UK Companies House API | Companies House | UK | REST+FEED+BULK | Yes | Free | A | EASY | OPERATIONAL | |
| SEC EDGAR (data.sec.gov) | US SEC | USA | REST+BULK | No (UA) | Free | A | EASY | OPERATIONAL | ★22 |
| FRED API | Fed Reserve Bank St. Louis | USA (+intl mirrors) | REST | Yes | Free | A | EASY | OPERATIONAL | ★19 |
| ECB Statistical Data Warehouse SDMX API | European Central Bank | Euro area/EU | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL | |
| Bank of England Statistical Interactive DB | Bank of England | UK | REST-ish CSV | No | Free | A | EASY | OPERATIONAL | |
| Bank of Canada Valet API | Bank of Canada | Canada | REST | No | Free | A | EASY | OPERATIONAL | |
| BIS Data Portal API | Bank for International Settlements | Global | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL | |
| WTO APIs (Timeseries + QR) | World Trade Organization | Global | REST | Yes | Free | A | EASY | OPERATIONAL (cross-ref cat24) | |
| Bank of Japan Time-Series Data Search | Bank of Japan | Japan | BULK | No | Free | A | EASY–MODERATE | SEARCH-ONLY (no API) | |
| Japan e-Stat API | Statistics Bureau of Japan | Japan | REST | Yes | Free | A | MODERATE | OPERATIONAL | |
| API Mercado Público | ChileCompra | Chile | REST | Yes | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| Business Registers Interconnection System (BRIS) | European Commission | EU27+EEA | SEARCH | No | Free | A | HARD | OPERATIONAL (no API, cross-ref cat14) | |
| EU FSD / Consolidated Sanctions List | European Commission | EU | FEED+BULK | Optional | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| Financial Transparency System | European Commission DG BUDG | EU | BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| OCDS + OCP Data Registry | Open Contracting Partnership | Global | REST+BULK | Optional | Free | C | MODERATE | OPERATIONAL (cross-ref cat14) | |
| OFAC SDN/Consolidated + SLS | US Treasury OFAC | USA (global) | REST+BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| OpenSpending / Fiscal Data Package | Open Knowledge Foundation | Global | REST | No | Free | C/E | — | DEGRADED | |
| Portal da Transparência API | CGU | Brazil | REST | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat14) | |
| TED API (eForms notices) | Publications Office EU | EU/EEA | REST+SPARQL+BULK | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat14) | |
| UK Sanctions List & OFSI Consolidated List | UK FCDO+HM Treasury | UK | BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| UN SC Consolidated List | UN Security Council | Global | BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat14) | |
| United Nations Treaty Collection | UN Office of Legal Affairs | Global | SEARCH | No | Free | A | HARD | OPERATIONAL (cross-ref cat14) | |
| USAspending API | US Treasury | USA | REST+BULK | No | Free | A | MODERATE | OPERATIONAL (cross-ref cat14) | |

## CATEGORY 16 — Academic Research (43)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| arXiv APIs (API+OAI-PMH+S3 bulk) | arXiv/Cornell (Simons Foundation) | US (global) | REST+OAI-PMH+FEED+BULK | No | Freemium | A | EASY | OPERATIONAL | ★14 |
| ORCID Public API | ORCID Inc. | US, global | REST+BULK | No | Freemium | A | EASY | OPERATIONAL (cross-ref cat01) | ★23 |
| ROR (Research Organization Registry) | CDL/Crossref/DataCite | US, global | REST+BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat01) | |
| OpenAIRE Graph API | OpenAIRE AMKE | Greece/EU | REST | No | Free | B | EASY | OPERATIONAL (legacy XML API discontinued) | |
| OpenCitations Index REST API | OpenCitations, Univ. Bologna | Italy | REST+SPARQL | Optional | Free | B | EASY | OPERATIONAL | |
| bioRxiv / medRxiv API | CSHL | USA (global) | REST | No | Free | A | EASY | OPERATIONAL | |
| HAL Search API | CCSD/CNRS | France (global) | REST | No | Free | A | EASY | OPERATIONAL | |
| J-STAGE WebAPI | JST | Japan | REST+FEED | No | Free-academic | A | EASY | OPERATIONAL | |
| CiNii Web APIs | NII | Japan | REST/OpenSearch | Yes | Free | A | EASY | OPERATIONAL | |
| RePEc / IDEAS API | RePEc network/IDEAS | Global (1800+ archives) | REST | Yes | Free | C | EASY | OPERATIONAL | |
| EconStor OAI-PMH | ZBW | Germany (global econ) | OAI-PMH | No | Free | A | EASY | OPERATIONAL | |
| SciELO network | SciELO Program/FAPESP | Brazil HQ; 16 countries | OAI-PMH+OPDS | No | Free | A/B | MODERATE | OPERATIONAL | |
| Redalyc Journal API | Redalyc–UAEMex | Mexico | REST | Yes | Free (NC-SA) | B | MODERATE | OPERATIONAL | |
| CyberLeninka (OAI-PMH) | CyberLeninka LLC | Russia | OAI-PMH | No | Free | C | EASY | OPERATIONAL | |
| BASE Search API | Bielefeld University Library | Germany | REST | Yes | Free-academic | A | EASY | OPERATIONAL | |
| OAI-PMH IR ecosystem (DSpace/EPrints/OJS/etc) | thousands of institutions | Global | OAI-PMH | No | Free | mixed A-C | MODERATE | OPERATIONAL | |
| KISTI ScienceON / NDSL Open Service (Korea) | KISTI | South Korea | REST | Yes | Free | A | HARD | DEGRADED (migrated/consolidated) | |
| Scopus (Elsevier) | Elsevier | US/global | REST | Yes | Paid | D | MODERATE | COMMERCIAL-GATED | |
| Web of Science (Clarivate) | Clarivate | US/global | REST | Yes | Paid | D | MODERATE | COMMERCIAL-GATED | |
| Lens.org Scholarly API | Cambia/QUT | Australia | REST | Yes | Freemium | C/D | EASY | OPERATIONAL (cross-ref cat17) | |
| CNKI (China) | Tongfang Knowledge Network | China | SEARCH | Account-gated | Paid | D | HARD | COMMERCIAL-GATED | |
| DBpia / RISS (Korea) | Nurimedia / KERIS | South Korea | SEARCH | Account-gated | Paid/Free | D/A | HARD | COMMERCIAL-GATED / SEARCH-ONLY | |
| Airiti Library (Taiwan) | Airiti Inc. | Taiwan | SEARCH | Account-gated | Paid | D | HARD | COMMERCIAL-GATED | |
| eLibrary.ru / RSCI | Scientific Electronic Library | Russia | SEARCH | Account-gated | Paid | D | HARD | COMMERCIAL-GATED | |
| SSRN (Elsevier) | Elsevier | US/global | SEARCH+FEED | No | Free | D | HARD | SEARCH-ONLY (no public API) | |
| Paperity | Paperity | Global | SEARCH+FEED | No | Free-academic | C | MODERATE | SEARCH-ONLY (custom extracts by email) | |
| Latindex | UNAM | Mexico/Ibero-America | SEARCH | No | Free | B | — | SEARCH-ONLY | |
| INSPIRE-HEP REST API | CERN-led HEP consortium | International (CH HQ) | REST+OAI-PMH | No | Free | A | EASY | OPERATIONAL | |
| NASA ADS (Astrophysics Data System) API | NASA/Harvard-Smithsonian | US | REST | Yes | Free | A | EASY | OPERATIONAL | |
| CERN Repository (new CDS) REST+OAI-PMH | CERN | Switzerland | REST+OAI-PMH | Optional | Free | A | EASY | OPERATIONAL | |
| HEPData | Durham University IPPP | UK | REST | No | Free | B | EASY | OPERATIONAL | |
| zbMATH Open API | FIZ Karlsruhe/EMS | Germany | REST+OAI-PMH | No | Free | A/B | EASY | OPERATIONAL | |
| OEIS | OEIS Foundation | US (global) | REST-ish SEARCH | No | Free | E/C | EASY | OPERATIONAL (api.oeis.org degraded) | |
| PDG API (Particle Data Group) | PDG/LBNL | US-led international | REST+BULK | No | Free (NC) | A | EASY | OPERATIONAL | |
| IEEE Xplore Metadata API | IEEE | US (global) | REST | Yes | Freemium | A/D | EASY | OPERATIONAL | |
| Local Contexts Hub API v2 | Local Contexts | US (global) | REST | Yes | Free | C | EASY | OPERATIONAL (cross-ref cat25) | |
| OpenSky Network REST API | OpenSky Network | CH/global | REST | Account-gated | Free-academic | C | EASY | OPERATIONAL (cross-ref cat25) | |
| xeno-canto bird sound API v3 | xeno-canto Foundation | NL/global | REST | Yes | Free | C | EASY | OPERATIONAL (cross-ref cat25) | |
| Movebank | Max Planck Inst. Animal Behavior | Germany/global | REST | Optional | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Mushroom Observer API | Mushroom Observer Inc | US/global | REST | Yes | Free | E | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Ocean Networks Canada (Oceans 3.0) | ONC, Univ. Victoria | Canada | REST | Yes | Free | A | EASY | OPERATIONAL (cross-ref cat25) | |
| LA Referencia | LA Referencia network/RedCLARA | Latin America | OAI-PMH | No | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| DOAB (Directory of OA Books) | DOAB Foundation | Netherlands/global | OAI-PMH+BULK | No | Free | B | EASY | OPERATIONAL (cross-ref cat25) | |
| Shodhganga | INFLIBNET Centre, UGC India | India | OAI-PMH | No | Free | A | MODERATE | OPERATIONAL (geo-blocked; cross-ref cat25) | |
| CLACSO Digital Repository | CLACSO | Argentina/LatAm | OAI-PMH | No | Free (NC-ND) | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Wildlife Insights | Conservation Intl + partners | US/global | BULK | No | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| CBDB API | Harvard/Academia Sinica/Peking Univ | US–China–Taiwan | REST | No | Free (NC-SA) | B | EASY | OPERATIONAL (cross-ref cat25) | |
| Japan Search | National Diet Library Japan | Japan | SPARQL+REST | No | Free | A | MODERATE | OPERATIONAL (bot-blocked; cross-ref cat25) | |
| 공공데이터포털 (data.go.kr) | Korea MOIS | South Korea | REST | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat25/14) | |

*(Note: several entries above are cross-listed with cat25 per registry's own cross-referencing; category 16's own count of 43 includes the GROUP A scholarly APIs plus GROUP E status entries plus science-archive APIs per registry Part 3 header.)*

## CATEGORY 17 — Patents & Intellectual Property (13)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| EPO OPS (Open Patent Services) | European Patent Office | EU/International | REST | Yes | Freemium | A | MODERATE | OPERATIONAL | |
| USPTO Open Data Portal (ODP) API | USPTO | US | REST+BULK | Yes | Free | A | MODERATE | OPERATIONAL (replaced PEDS/BDSS) | |
| PatentsView | USPTO Office of Chief Economist | US | REST+BULK | Yes | Free | A | MODERATE | DEGRADED (migrating into ODP) | |
| USPTO TSDR (Trademark Status & Doc Retrieval) API | USPTO | US | REST | Yes | Free | A | EASY | OPERATIONAL | |
| WIPO PATENTSCOPE / PCT Data Services | WIPO | UN/International | SOAP+BULK+SEARCH | Account-gated (paid) | Freemium | A | HARD | OPERATIONAL (no free API) | |
| KIPRIS Plus Open API (Korea) | KIPO/KIPI | South Korea | REST | Yes | Free-academic | A | MODERATE | OPERATIONAL | |
| J-PlatPat (JPO, Japan) | JPO/INPIT | Japan | SEARCH | No | Free | A | HARD | SEARCH-ONLY (no public API) | |
| CNIPA (China) | CNIPA | China | SEARCH | Account-gated | Free | A | HARD | SEARCH-ONLY (no public API) | |
| Google Patents Public Datasets (BigQuery) | Google | US (global corpus) | BULK/SQL | Account-gated | Freemium | D | MODERATE | OPERATIONAL | |
| Lens.org Patent & Scholarly API | Cambia/QUT | Australia | REST | Yes | Freemium | C/D | EASY | OPERATIONAL | |
| INPI France — data.inpi.fr + open datasets | INPI | France | REST+BULK | Optional | Free | A | EASY–MODERATE | OPERATIONAL | |
| IP Australia (Trade Mark Search API + open data) | IP Australia | Australia | REST+BULK | Yes | Free | A | EASY | OPERATIONAL | |
| EUIPO TMview / eSearch | EUIPO | EU/Global | REST (unofficial) | No | Free | A | MODERATE | OPERATIONAL (undocumented) | |

## CATEGORY 18 — Maps / GIS / Satellite / Earth Observation (17)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| OpenStreetMap Overpass API | OSM Foundation | Germany/global | REST | No | Free | E | MODERATE | OPERATIONAL | ★15 |
| Nominatim (OSM Geocoding) | OSM Foundation | UK/global | REST | No | Free | E | EASY | OPERATIONAL | |
| OSM Planet Dumps + Geofabrik Extracts | OSM Foundation/Geofabrik | Germany | BULK+FEED | No | Free | E | MODERATE | OPERATIONAL | ★15 |
| GeoNames | GeoNames Association | Switzerland | REST+BULK | Yes | Freemium | C | EASY | OPERATIONAL | ★16 |
| Natural Earth | Natural Earth project | USA/global | BULK | No | Free | C | EASY | OPERATIONAL | |
| Overture Maps Foundation (incl. GERS) | Overture Maps Foundation | USA/global | STAC+BULK | No | Free | C | MODERATE | OPERATIONAL | |
| Mapillary (street-level imagery) | Meta | USA/global | REST+MVT | Yes | Free | D | MODERATE | OPERATIONAL | |
| Copernicus Data Space Ecosystem (CDSE) | EC/ESA | EU | OData+STAC | Yes | Free | A | MODERATE | OPERATIONAL | |
| USGS EarthExplorer M2M API + Landsat on AWS | USGS (EROS) | USA | REST | Yes | Free | A | MODERATE | OPERATIONAL | |
| NASA Earthdata — CMR API | NASA EOSDIS | USA | REST+STAC | Optional | Free | A | MODERATE | OPERATIONAL | |
| JAXA G-Portal | JAXA | Japan | BULK+SEARCH | Account-gated | Free-academic | A | HARD | OPERATIONAL (SFTP only, no API) | |
| INPE — Brazil CBERS/Amazonia-1 STAC | INPE | Brazil | REST+STAC | No | Free | A | EASY–MODERATE | OPERATIONAL | |
| ISRO Bhuvan | ISRO (NRSC) | India | WMS+BULK | Optional | Free | A | MODERATE | OPERATIONAL | |
| OpenTopography API | OpenTopography (UCSD/SDSU/UNAVCO) | USA | REST | Yes | Free | B | EASY | OPERATIONAL | |
| GEBCO Bathymetry | GEBCO/BODC | UK/global | BULK+WMS | No | Free | A | EASY | OPERATIONAL | |
| National mapping agency OGC services (grouped) | Swisstopo/LINZ/PDOK/GA | CH/NZ/NL/AU | REST/WMS/WFS | Optional | Free | A | EASY–MODERATE | OPERATIONAL | |

## CATEGORY 19 — Space & Astronomy (15)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| CelesTrak GP/TLE data | CelesTrak (redistributes 18 SDS) | USA | REST | No | Free | B | EASY | OPERATIONAL (5-digit catalog exhaustion ~Jul 2026) | |
| Space-Track.org | US Space Force 18 SDS | USA | REST | Account-gated | Free | A | MODERATE | OPERATIONAL | |
| ESA DISCOSweb API | ESA (Space Debris Office) | Germany/EU | REST | Yes | Free | A | EASY | OPERATIONAL | |
| N2YO Satellite Tracking API | N2YO.com | USA | REST | Yes | Free | C/D | EASY | OPERATIONAL | |
| NOAA Space Weather Prediction Center JSON services | NOAA SWPC | USA | REST | No | Free | A | EASY | OPERATIONAL | |
| JPL Horizons API | NASA/JPL SSD | USA | REST | Optional | Free | A | MODERATE | OPERATIONAL | |
| JPL Small-Body Database (SBDB) API | NASA/JPL SSD | USA | REST | Optional | Free | A | EASY | OPERATIONAL | |
| IAU Minor Planet Center APIs | Minor Planet Center | USA | REST | No | Free | A | EASY | OPERATIONAL (young API, 2024 rollout) | |
| NASA Open APIs (api.nasa.gov) | NASA | USA | REST | Yes | Free | A | EASY | OPERATIONAL | |
| NASA Exoplanet Archive (TAP) | NExScI, Caltech/IPAC | USA | TAP | No | Free | A | EASY–MODERATE | OPERATIONAL | |
| CDS — SIMBAD + VizieR | CDS Strasbourg (CNRS) | France | TAP+REST+cone search | No | Free | B | MODERATE | OPERATIONAL | |
| ESA Gaia Archive (TAP+) | ESA/ESAC | Spain/EU | TAP | Optional | Free | A | MODERATE | OPERATIONAL | |
| MAST (Mikulski Archive for Space Telescopes) | STScI (NASA) | USA | REST+BULK | Optional | Free | A | MODERATE | OPERATIONAL | |
| SDSS SkyServer / SciServer CasJobs | SDSS-V consortium/JHU | USA | REST+SQL batch | Yes | Free | B | MODERATE | OPERATIONAL | |
| SatNOGS Network | SatNOGS/Libre Space Foundation | Greece/global | REST | No (read) | Free | E | EASY | OPERATIONAL (cross-ref cat25) | |

## CATEGORY 20 — Engineering & Technology (incl. standards & materials) (13)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| IEEE Xplore Metadata API | IEEE | US (global) | REST | Yes | Freemium | A/D | EASY | OPERATIONAL | |
| ETSI Standards Portal | ETSI | France/EU | BULK+SEARCH | No | Free | A | MODERATE | OPERATIONAL (free PDFs, no API) | |
| ITU-T Recommendations | ITU | Switzerland (UN) | BULK+SEARCH | No | Freemium | A | MODERATE | OPERATIONAL (free PDFs, no API) | |
| ISO/IEC/ASTM/DIN/JIS/GB standards | ISO/IEC/ASTM/DIN/JIS/SAMR | global | SEARCH | Account-gated | Paid | — | HARD | SEARCH-ONLY (no API) | |
| NIST Chemistry WebBook / SRD databases | NIST | US | SEARCH | No | Freemium | A | HARD | SEARCH-ONLY (no API) | |
| NIST CODATA Fundamental Physical Constants | NIST/CODATA TGFC | US (intl adjustment) | BULK | No | Free | A | EASY | OPERATIONAL | |
| NIST JARVIS (JARVIS-DFT/QC/ML + Figshare) | NIST MML | US | REST+BULK | No | Free | A | MODERATE | OPERATIONAL (REST endpoint degraded, use Figshare) | |
| Materials Project API (mp-api) | LBNL (DOE) | US | REST | Yes | Free-academic | A | EASY | OPERATIONAL | |
| NOMAD Repository & Archive (FAIRmat) | NOMAD Lab CoE/FAIRmat | Germany/EU | REST | No | Free | B | MODERATE | OPERATIONAL | |
| OQMD (Open Quantum Materials Database) | Northwestern Univ. | US | REST(native+OPTIMADE) | No | Free | B | EASY | OPERATIONAL | |
| AFLOW (AFLUX REST API) | Duke University | US | REST | No | Free | B | EASY–MODERATE | OPERATIONAL | |
| MPDS (Materials Platform for Data Science) | Tilde Materials Informatics | Russia | REST | Yes | Freemium | D | MODERATE | OPERATIONAL | |
| Cambridge Structural Database (CSD) / CSD Python API | CCDC | UK | REST (licensed local) | Account-gated | Free-academic/Paid | A/B | HARD | OPERATIONAL (no open web API) | |
| NIMS MatNavi (AtomWork/SuperCon) | NIMS | Japan | SEARCH | Account-gated | Freemium | A | HARD | SEARCH-ONLY (scraping banned) | |

## CATEGORY 21 — Archives / Libraries / Museums (61)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Trove API v3 | National Library of Australia | Australia | REST | Yes | Free | A | EASY | OPERATIONAL | |
| DigitalNZ API v3 | DigitalNZ/Nat. Library NZ | New Zealand | REST | Optional | Free | A | EASY | OPERATIONAL | |
| Deutsche Digitale Bibliothek (DDB) REST API | DDB (FIZ Karlsruhe) | Germany | REST+OAI-PMH | Yes | Free | A | EASY | OPERATIONAL | |
| NDL Search API (Japan) | National Diet Library | Japan | SRU/OpenSearch/OAI-PMH | Account-gated (heavy use) | Free-academic | A | MODERATE | OPERATIONAL | |
| NDL Digital Collections IIIF | National Diet Library | Japan | IIIF | No | Free | A | EASY | OPERATIONAL | |
| Japan Search Web API + SPARQL | National Diet Library | Japan | REST+SPARQL | No | Free | A | EASY | OPERATIONAL (bot-blocked) | |
| LIBRIS XL public APIs (Sweden) | Kungliga biblioteket | Sweden | REST+SPARQL+OAI-PMH+BULK | No | Free | A | MODERATE | OPERATIONAL | |
| Finna API (Finland) | National Library of Finland | Finland | REST | No | Free | A | EASY | OPERATIONAL | |
| Nasjonalbiblioteket API (Norway) | National Library of Norway | Norway | REST | No | Free | A | EASY | OPERATIONAL | |
| KB Netherlands / Delpher APIs | KB National Library NL | Netherlands | SRU+OAI-PMH+BULK | Account-gated | Free | A | MODERATE | OPERATIONAL | |
| datos.bne.es — BNE Linked Data (Spain) | Biblioteca Nacional de España | Spain | SPARQL+BULK | No | Free | A | MODERATE | OPERATIONAL | |
| CulturaItalia / Internet Culturale (Italy) | ICCU, MiC | Italy | SPARQL+OAI-PMH | No | Free | A | MODERATE–HARD | OPERATIONAL | |
| Polona (Poland) | Biblioteka Narodowa | Poland | REST+IIIF | No | Free | A | HARD | DEGRADED (undocumented API) | |
| NARA Catalog API v2 (USA) | US National Archives | USA | REST | Yes | Free | A | EASY | OPERATIONAL | |
| Archivportal-D (Germany) | DDB/Landesarchiv BW | Germany | REST+OAI-PMH | Yes | Free | A | MODERATE | OPERATIONAL | |
| AtoM-based archives ecosystem | Artefactual Systems (400+ archives) | global deployments | REST+OAI-PMH | Yes (per instance) | Free | E | MODERATE | OPERATIONAL | |
| JACAR (Japan) | Nat. Archives Japan+MOFA+NIDS | Japan | SEARCH | No | Free | A | HARD | OPERATIONAL (no public API) | |
| RecordSearch — National Archives Australia | National Archives of Australia | Australia | SEARCH | No | Free | A | HARD | DISCONTINUED (Anzacs API dead, bot-blocked) | |
| Archives nationales de France (SIV) | Archives nationales | France | SEARCH+BULK | No | Free | A | — | SEARCH-ONLY | |
| Russian State Library (RSL) / RUNEB | RSL | Russia | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| National Library of China (NLC) | NLC | China | SEARCH+IIIF | No | Free | A | — | SEARCH-ONLY | |
| National Library of Korea (NLK) | NLK | South Korea | SEARCH+BULK | No | Free | A | — | SEARCH-ONLY | |
| Millî Kütüphane (Türkiye) | Millî Kütüphane | Türkiye | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Biblioteca Nacional do Brasil (BN Digital) | BN Brasil | Brazil | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Biblioteca Nacional de México (HNDM) | BN México | Mexico | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Biblioteca Nacional Mariano Moreno (Argentina) | BN Argentina | Argentina | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Hungaricana (Hungary) | Nat. Széchényi Library | Hungary | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Národní knihovna ČR (NKP, Czechia) | National Library of Czechia | Czechia | OAI-PMH+REST(Kramerius) | No | Free | A | MODERATE | OPERATIONAL | |
| Biblioteca Nacional de Portugal | BN Portugal | Portugal | OAI-PMH+SRU | No | Free | A | MODERATE–HARD | DEGRADED (unverified from sandbox) | |
| Swissbib/swisscovery (Switzerland) | SLSP | Switzerland | SRU | Account-gated | Free | A | HARD | DEGRADED (institutional key gate) | |
| Egypt / Arab national libraries (Bibliotheca Alexandrina) | Bibliotheca Alexandrina | Egypt | SEARCH | No | Free | A | — | SEARCH-ONLY | |
| Art Institute of Chicago API | Art Institute of Chicago | USA | REST+IIIF | No | Free | A | EASY | OPERATIONAL | |
| Cleveland Museum of Art Open Access API | Cleveland Museum of Art | USA | REST | No | Free | A | EASY | OPERATIONAL | |
| V&A API (Victoria and Albert Museum) | V&A | UK | REST+IIIF | No | Free | A | EASY | OPERATIONAL | |
| SMK API (National Gallery of Denmark) | Statens Museum for Kunst | Denmark | REST+IIIF | No | Free | A | EASY | OPERATIONAL | |
| Harvard Art Museums API | Harvard Art Museums | USA | REST+IIIF | Yes | Free | A | EASY | OPERATIONAL | |
| Cooper Hewitt Smithsonian Design Museum API | Cooper Hewitt | USA | REST | Yes | Free | A | EASY | OPERATIONAL | |
| Paris Musées Collections API | Paris Musées | France | GraphQL | Yes | Free | A | MODERATE | OPERATIONAL | |
| Finnish National Gallery API | FNG (Ateneum/Kiasma/Sinebrychoff) | Finland | REST | Yes | Free | A | EASY | OPERATIONAL | |
| Nasjonalmuseet Collection API (Norway) | National Museum of Norway | Norway | REST | No | Free | A | EASY | OPERATIONAL (unverified uptime) | |
| Te Papa Collections API (New Zealand) | Museum of NZ Te Papa | New Zealand | REST | Yes | Free | A | EASY | OPERATIONAL | |
| Wellcome Collection API | Wellcome Trust | UK | REST+IIIF | No | Free | A/B | EASY | OPERATIONAL (cross-ref cat08) | |
| National Gallery (London) NG Data API | The National Gallery, London | UK | REST | No | Free (NC-ND) | A | EASY | OPERATIONAL (beta) | |
| ColBase (National Museums Japan) | NICH | Japan | SEARCH (via Japan Search) | No | Free | A | MODERATE | OPERATIONAL (no own API) | |
| JSTOR / Artstor | ITHAKA | USA (global) | SEARCH | Account-gated | Paid | B | HARD | DISCONTINUED (Artstor merged; Constellate discontinued) | |
| Google Arts & Culture | Google | US/global | SEARCH | No | Free | D | — | SEARCH-ONLY (no public API) | |
| e-Museum (Japan) | Nara Nat. Museum et al. | Japan | SEARCH | No | Free | — | — | SEARCH-ONLY | |
| Walters Art Museum | Walters Art Museum | US | SEARCH+BULK | No | Free | A | MODERATE | SEARCH-ONLY (CC0 via GitHub) | |
| Brooklyn Museum API | Brooklyn Museum | US | REST | Yes | Free | A | EASY–MODERATE | STATIC (low activity) | |
| VIAF | OCLC | US, global | REST+BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat01) | |
| lobid-gnd | DNB+hbz | Germany | REST+BULK | No | Free | A | EASY | OPERATIONAL (cross-ref cat01) | |
| Open Library | Internet Archive | US, global | REST+BULK | No | Free | C | EASY | OPERATIONAL (cross-ref cat01) | |
| OLAC aggregator | OLAC/DELAMAN community | US/global | OAI-PMH+BULK+SEARCH | No | Free | C | MODERATE | DEGRADED (rebuild in progress) | |
| Pangloss / CoCoon | LACITO-CNRS+Huma-Num | France/global | OAI-PMH+BULK | No | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| PARADISEC catalog + OAI | Univ. Melbourne/Sydney/ANU | Australia | OAI-PMH | No | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |
| PG catalog feeds + Gutendex API | Project Gutenberg/Gutendex | US/global | REST+BULK | No | Free | C | EASY | OPERATIONAL (cross-ref cat25) | |
| LibriVox API | LibriVox | US/global | REST | No | Free | C | EASY | OPERATIONAL (cross-ref cat25) | |
| Standard Ebooks OPDS feeds | Standard Ebooks | US | FEED | No | Free | E | EASY | OPERATIONAL (cross-ref cat25) | |
| Shamela library | shamela.ws community | Arabic world | REST+BULK | Optional | Free | E | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Aozora Bunko catalog CSV + text zips | Aozora Bunko volunteers | Japan | BULK | No | Free | E | MODERATE | OPERATIONAL (cross-ref cat25) | |
| Archive of Indigenous Languages of LatAm (AILLA) | Univ. Texas at Austin | US/LatAm | OAI-PMH | Account-gated (media) | Free | B | MODERATE | OPERATIONAL (cross-ref cat25) | |

## CATEGORY 22 — News & Historical News (3)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| impresso — Media Monitoring of the Past | EPFL DHLAB + Univ. Luxembourg C2DH | Switzerland/Luxembourg | REST | Yes | Free-academic | B | MODERATE | OPERATIONAL | |
| National Library of Israel (NLI) APIs | National Library of Israel | Israel | REST+IIIF | Yes | Free | A | EASY | OPERATIONAL | |
| ANNO — AustriaN Newspapers Online (ÖNB) | Austrian National Library | Austria | IIIF+LOD | No | Free | A | MODERATE | OPERATIONAL (search API unofficial) | |

*(e-periodica IIIF also appears in this category's source section but is primarily classified cat13; not double-counted here.)*

## CATEGORY 23 — Statistics / Census / Demographics (39)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Census Data API (+ Microdata API) | US Census Bureau | USA | REST | Yes | Free | A | EASY | OPERATIONAL | ★18 |
| Eurostat Database API | Eurostat (see also cat24) | EU | REST/SDMX | No | Free | A | EASY | OPERATIONAL | |
| ABS Data API | Australian Bureau of Statistics | Australia | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL (ABS.Stat retired) | |
| Aotearoa Data Explorer (nzdotstat) SDMX API | Stats NZ | New Zealand | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL (NZ.Stat disconnected 2024) | |
| API de Series de Tiempo | Argentina Secretaría de Innovación (incl. INDEC) | Argentina | REST | No | Free | A | EASY | OPERATIONAL | |
| BDL API (Local Data Bank, Poland) | GUS Statistics Poland | Poland | REST | Optional | Free | A | EASY | OPERATIONAL | |
| BPS WebAPI | Badan Pusat Statistik | Indonesia | REST | Yes | Free | A | EASY | OPERATIONAL | |
| CBS Statistical Series API + Price Indices API | Israel CBS | Israel | REST | No | Free | A | MODERATE | OPERATIONAL | |
| CBS StatLine Open Data | Centraal Bureau voor de Statistiek | Netherlands | OData+FEED | No | Free | A | EASY | OPERATIONAL | |
| CZSO VDB Open Data Catalogue API | Český statistický úřad | Czechia | REST/CKAN | No | Free | A | EASY | OPERATIONAL | |
| data.gov.my Data Catalogue API | DOSM/data.gov.my | Malaysia | REST | No | Free | A | EASY | OPERATIONAL | |
| Datos Abiertos Colombia API | MinTIC+DANE | Colombia | REST (Socrata) | Optional | Free | A | EASY | OPERATIONAL | |
| e-Stat API v3 | Statistics Bureau of Japan | Japan | REST | Yes | Free | A | EASY | OPERATIONAL | |
| EIA API v2 | US Energy Information Administration | USA | REST | Yes | Free | A | EASY | OPERATIONAL | |
| EMISS Open Data API (fedstat) | Rosstat | Russia | REST | Yes | Free | A | HARD | DEGRADED (geo-blocked) | |
| Gapminder Datasets | Gapminder Foundation | Sweden | BULK+REPO | No | Free | C | EASY | OPERATIONAL | |
| GADM database of Global Administrative Areas | GADM project | global | BULK | No | Free (academic-NC) | B | EASY | OPERATIONAL | |
| GENESIS Web Service | Statistisches Bundesamt (Destatis) | Germany | REST | No (user/pass) | Free | A | MODERATE | OPERATIONAL | |
| India: eSankhyiki + OGD data.gov.in | NIC/MeitY/MoSPI | India | REST | Yes | Free | A | MODERATE | OPERATIONAL (cross-ref cat14) | |
| INE Tempus3 Web Service | INE Spain | Spain | REST | No | Free | A | EASY | OPERATIONAL | |
| INEGI Indicadores API + DENUE API | INEGI | Mexico | REST | Yes | Free | A | EASY | OPERATIONAL | |
| INSEE BDM API | INSEE | France | REST/SDMX | Yes | Free | A | MODERATE | OPERATIONAL | |
| Istat I.Stat SDMX | Istat | Italy | REST/SDMX | No | Free | A | EASY | OPERATIONAL | |
| KOSIS Open API (Korea) | Statistics Korea (KOSTAT) | South Korea | REST | Yes | Free | A | EASY | OPERATIONAL | |
| China NBS National Data portal | National Bureau of Statistics of China | China | SEARCH (undoc JSON) | No | Free | A | HARD | DEGRADED (WAF, some series suspended) | |
| Nomis API (UK labour market) | Nomis (Durham Univ./ONS) | UK | REST/SDMX | Optional | Free | A/B | EASY | OPERATIONAL | |
| UK ONS Website API | Office for National Statistics | UK | REST | No | Free | A | EASY | OPERATIONAL (beta) | |
| OpenSTAT API | Philippine Statistics Authority | Philippines | REST/PXWEB | No | Free | A | EASY | OPERATIONAL | |
| Saudi Open Data Platform API (GASTAT) | SDAIA/GASTAT | Saudi Arabia | REST/CKAN | No | Free | A | MODERATE | OPERATIONAL | |
| SCB Statistical Database API | Statistiska centralbyrån | Sweden | REST/PXWEB | No | Free | A | EASY | OPERATIONAL (unverified from sandbox) | |
| SIDRA API (Agregados) | IBGE | Brazil | REST | No | Free | A | EASY | OPERATIONAL | |
| SingStat Table Builder API | Dept. of Statistics Singapore | Singapore | REST | No | Free | A | EASY | OPERATIONAL | |
| SSB API (PxWeb) | Statistisk sentralbyrå | Norway | REST/PXWEB | No | Free | A | EASY | OPERATIONAL | |
| StatBank Denmark API | Danmarks Statistik | Denmark | REST | No | Free | A | EASY | OPERATIONAL | |
| StatCan WDS | Statistics Canada | Canada | REST/POST+BULK | No | Free | A | MODERATE | OPERATIONAL | |
| StatFin PxWeb API | Statistics Finland | Finland | REST/SDMX/PXWEB | No | Free | A | EASY | OPERATIONAL | |
| Taiwan DGBAS National Statistics | DGBAS | Taiwan | SEARCH/CKAN | No | Free | A | MODERATE | SEARCH-ONLY (no native API) | |
| Thailand NSO (statbbi) | National Statistical Office | Thailand | SEARCH+BULK | No | Free | A | MODERATE | SEARCH-ONLY | |
| TurkStat Data Portal | Turkish Statistical Institute | Türkiye | BULK+SEARCH | No | Free | A | HARD | OPERATIONAL (no API, WAF) | |
| Vietnam GSO PX-Web | General Statistics Office | Vietnam | PXWEB+BULK | No | Free | A | MODERATE | SEARCH-ONLY (unverified) | |
| WIPO IP Statistics Data Center | WIPO | global | SEARCH+BULK | Account-gated | Paid | A | HARD | SEARCH-ONLY (cross-ref cat17/24) | |

## CATEGORY 24 — International Organizations (19)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| Eurostat Database API | Eurostat (European Commission) | EU | REST/SDMX | No | Free | A | EASY | OPERATIONAL | ★17 |
| ReliefWeb API v2 | UN OCHA | UN/global | REST | Yes (appname) | Free | A | EASY | OPERATIONAL | ★25 |
| UNHCR Refugee Data API | UNHCR | UN/Switzerland | REST | No | Free | A | EASY | OPERATIONAL | |
| IOM DTM (Displacement Tracking Matrix) API | International Organization for Migration | UN-related/Switzerland | REST (Azure APIM) | Yes | Free | A | MODERATE | OPERATIONAL | |
| WTO Stats / Timeseries API | World Trade Organization | Switzerland/intl | REST | Yes | Free | A | EASY | OPERATIONAL (cross-ref cat15) | |
| ADB Key Indicators Database SDMX API | Asian Development Bank | Philippines/Asia-Pacific | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL | |
| ECLAC CEPALSTAT Open Data API | ECLAC (UN CEPAL) | Chile/LatAm & Caribbean | REST | Account-gated | Free | A | MODERATE | OPERATIONAL | |
| IEA Data & Statistics API | International Energy Agency | France/intl | REST | Yes | Freemium | A | HARD | OPERATIONAL (core paywalled) | |
| UN Data (data.un.org) | UN Statistics Division | UN | SDMX(legacy)+BULK | No | Free | A | MODERATE | DEGRADED (legacy stack) | |
| OCHA Financial Tracking Service (FTS) API | UN OCHA FTS | UN/global | REST | No | Free | A | EASY | OPERATIONAL | |
| IATI Datastore API (new) | International Aid Transparency Initiative | UK/intl | REST | Yes | Free | B | MODERATE | OPERATIONAL (legacy Solr deprecated) | |
| WIPO IP Statistics Data Center | WIPO | global | SEARCH+BULK | Account-gated | Paid | A | HARD | SEARCH-ONLY (cross-ref cat17/23) | |
| ITU DataHub | ITU (UN) | global | SEARCH+BULK | No | Free | A | MODERATE | SEARCH-ONLY | |
| UNIDO Statistics Data Portal | UNIDO (UN) | global | SEARCH | Account-gated | Paid | A | MODERATE | COMMERCIAL-GATED | |
| AidData Datasets | AidData (William & Mary) | USA | BULK | No | Free | B | EASY | OPERATIONAL | |
| IDB Open Data / Numbers for Development | Inter-American Development Bank | USA/LatAm & Caribbean | REST (Socrata) | Optional | Free | A | EASY | OPERATIONAL | |
| OECD Data Explorer API | OECD | France/intl | REST/SDMX | No | Free | A | MODERATE | OPERATIONAL (old api.stats.oecd.org deprecated) | |
| UN SDG Global Database API | UN Statistics Division | UN | REST | No | Free | A | EASY | OPERATIONAL | |
| UN DESA Population Division Data Portal API (WPP) | UN DESA Population Division | UN | REST | No | Free | A | EASY | OPERATIONAL | |
| UNESCO UIS Data API + BDDS | UNESCO Institute for Statistics | Canada/UN | REST+BULK | No | Free | A | EASY | OPERATIONAL (SDMX API EOL 2020) | |

## CATEGORY 25 — Specialized & Rare + Regional Sources (6 primary; many more cross-listed from other categories)
| Source | Organization | Country/Region | Access Type | Key? | Cost | Tier | Difficulty | Status | F25 |
|---|---|---|---|---|---|---|---|---|---|
| China Biographical Database (CBDB) API | Harvard/Academia Sinica/Peking Univ | US–China–Taiwan | REST | No | Free (NC-SA) | B | EASY | OPERATIONAL | |
| Local Contexts Hub API v2 | Local Contexts | US (global communities) | REST | Yes | Free | C | EASY | OPERATIONAL | |
| OpenSky Network REST API | OpenSky Network association | Switzerland/global | REST | Account-gated | Free-academic | C | EASY | OPERATIONAL | |
| OurAirports open data | OurAirports (community) | Canada/global | BULK | No | Free | E | EASY | OPERATIONAL | |
| OpenFlights | OpenFlights (community) | global | BULK | No | — | E | EASY | DEGRADED (unmaintained since ~2017; site 404) | |
| Find a Grave | Ancestry.com | US/global | SEARCH | No | — | D | HARD | SEARCH-ONLY (no API, bot-blocked) | |

**Note:** Category 25's registry section (source lines 2378–2524) enumerates 43 sources by name (xeno-canto, Movebank, SatNOGS, Mushroom Observer, Ocean Networks Canada, LibriVox, Project Gutenberg, Standard Ebooks, DigitalNZ/Papers Past, India OGD, Arctic Data Center, LA Referencia, CLACSO, Shodhganga, DOAB, PARADISEC, OLAC, Pangloss, AILLA, CHGIS, Aozora Bunko, GRETIL, OurAirports, GVP, Wildlife Insights, al-Maktaba al-Shamela, CNKI, NCPSSD, Wanfang, Korean Classics DB, Korean History DB, EncyKorea, CyberLeninka, eLibrary.ru, Dialnet, QDL, OpenFlights, Find a Grave, and Japan Search, data.go.kr — full list at source lines 2382–2497), but the deduplicated Master Source Registry table assigns each to its functional PRIMARY category elsewhere (marked "(→25)" as secondary cross-reference in this file's other category tables) — hence only 6 rows have category=25 as primary. This mirrors the source registry's own deduplication logic (see its header note: "Sources deduplicated across files into one row each; where a source spans two registry categories the primary category is shown with a secondary cross-reference").

---

## Key registry-wide notes (verbatim intent, condensed)

- **Evidence-classification legend** (categories 04/06/08 especially): `TRAD` = recorded traditional use / pharmacopoeia record (NOT clinical proof) · `EXP` = experimental/literature evidence · `PRED` = computational prediction · `NOMEN` = nomenclatural only · `CLIN` = clinical. Cybersecurity threat-intel sources distinguish CONFIRMED_EXPLOITED (CISA KEV) vs PREDICTED_EXPLOITABILITY (EPSS) vs COMMUNITY_REPORTED (OTX/MISP) — never flatten these.
- **Authority tiers**: A = official government/scientific primary; B = major academic/international org; C = established nonprofit/open-data institution; D = commercial provider; E = community/open-source project.
- **Access-mechanism vocabulary**: REST, GraphQL, SPARQL, OAI-PMH, IIIF, SDMX, OData, STAC, TAP, WMS/WFS, PXWEB, BULK DOWNLOAD, FEED (RSS/Atom/CSAF/MISP), REPOSITORY (git), SEARCH INTERFACE (no machine API — a deliberate negative finding, never fabricated as an API), COMMERCIAL-GATED.
- **Africa** is covered by a separate companion registry (`war_room_africa_api_registry.md`, ~110 sources) — cross-referenced, not duplicated, in the source document. Not present in this parse.
- Full detail (all 34 fields per source, signup URLs, env-var registry, geographic blind-spot audit, overlap/redundancy map, integration wave sequence) lives in the analytical Sections A–Z of the source document (source lines ~3108–4369) — not reproduced field-by-field here per the terse-extraction directive, but section names/purposes: A=Top 100 sources, B=First 25, C/D=signup credentials, E=no-credential sources, F=fully-free sources, G=paid/commercial, H=bulk download sources, I=real-time sources, J=historical-depth sources, K=knowledge-graph/SPARQL endpoints, L=scientific databases, M=medical databases, N=cybersecurity databases, O=government sources by region, P=unique/no-substitute sources, Q=overlap & redundancy map, R=geographic blind spots, S=domain blind spots, T=recommended integration wave sequence (1–6), U=provider/router architecture (canonical ID + fallback chains per entity type), V=full WARROOM_* env var registry, W=continuous-sync sources, X=on-demand sources, Y=local-index/bulk sources, Z=follow-up mission candidates (P1/P2/P3 priority).
