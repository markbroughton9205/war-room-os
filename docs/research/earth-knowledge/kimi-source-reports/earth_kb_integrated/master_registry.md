# WAR ROOM OS — EARTH KNOWLEDGE BASE: MASTER SOURCE REGISTRY (2026)

Single consolidated registry of **every verified machine-accessible knowledge source** found by the discovery swarm (Wave 1 files 01–08 + Wave 2 files 09–16). Sources deduplicated across files into one row each; where a source spans two registry categories the primary category is shown with a secondary cross-reference, e.g. `16 (→21)`. Status-only / search-interface / commercial-gated entries are retained as valuable *negative findings* and are marked in the **2026 Status** column.

**Column conventions** — Access Type uses the block's protocol vocabulary (REST / GraphQL / SPARQL / OAI-PMH / IIIF / SDMX / OData / STAC / TAP / PXWEB / BULK / FEED / REPO / SEARCH INTERFACE; combos joined with `+`). Key Required?: Yes / No / Optional / Account-gated. Cost: Free / Freemium / Paid / Free-academic / Licensed. Tier: A–E (primary grade, combos as given). Difficulty: EASY / MODERATE / HARD (ranges with `–`). 2026 Status: OPERATIONAL / DEGRADED / DISCONTINUED / STATIC / SEARCH-ONLY / COMMERCIAL-GATED.

---

| # | Source | Organization | Country/Region | Category | Access Type | Key Required? | Cost | Tier | Difficulty | Env Var | 2026 Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BabelNet 5.x | Sapienza University of Rome (Babelscape) | IT, global | 01 | REST+SPARQL+BULK | Yes | Freemium | B | MODERATE | WARROOM_BABELNET_API_KEY | OPERATIONAL |
| 2 | Bing Web/Image/News/Video Search APIs | Microsoft | US | 01 | n/a | No | — | D | — | — | DISCONTINUED |
| 3 | Brave Search API | Brave Software | US | 01 | REST | Yes | Freemium | D | EASY | WARROOM_BRAVE_SEARCH_API_KEY | OPERATIONAL |
| 4 | CC-CEDICT | MDBG / CC-CEDICT community | NL/global | 01 | BULK | No | Free | C | EASY | WARROOM_CCCEDICT_DUMP_URL | OPERATIONAL |
| 5 | Common Crawl | Common Crawl Foundation | US, global | 01 | REST+BULK | No | Free | C | MODERATE | WARROOM_COMMONCRAWL_INDEX_URL | OPERATIONAL |
| 6 | ConceptNet 5 | MIT Media Lab / Commonwealth Computer Research → Luminoso lineage (commonsense/conceptnet5) | US | 01 | REST+BULK | No | Free | B | EASY | WARROOM_CONCEPTNET_API_URL | OPERATIONAL |
| 7 | Data Commons | Data Commons Foundation (Google-initiated) | US, global | 01 | REST | Yes | Free | B | EASY | WARROOM_DATACOMMONS_API_KEY | OPERATIONAL |
| 8 | DBpedia | DBpedia Association / OpenLink Software (endpoint hosting) | DE/global | 01 | REST+SPARQL+BULK | No | Free | B | EASY–MODERATE | WARROOM_DBPEDIA_SPARQL_URL | OPERATIONAL |
| 9 | Diffbot KG | Diffbot Technologies | US | 01 | REST | Yes | Freemium | D | MODERATE | WARROOM_DIFFBOT_TOKEN | OPERATIONAL |
| 10 | FactGrid | Gotha Research Centre (Erfurt University) | DE | 01 | REST+SPARQL+BULK | No | Free | B | EASY | WARROOM_FACTGRID_SPARQL_URL | OPERATIONAL |
| 11 | FrameNet 1.7 | International Computer Science Institute (ICSI), Berkeley | US | 01 | BULK | No | Free | B | EASY | WARROOM_FRAMENET_DATA_DIR | STATIC |
| 12 | Glosbe (multilingual dictionary + translation memory) | Glosbe (community platform, pl) | PL/global | 01 | REST | No | Free | E | EASY | WARROOM_GLOSBE_API_URL | OPERATIONAL |
| 13 | Golden Knowledge Graph | Golden Recursion Inc. | US | 01 | REST | Yes | Freemium | D | MODERATE | WARROOM_GOLDEN_API_KEY | OPERATIONAL |
| 14 | Google Knowledge Graph Search | Google | US, global | 01 | REST | Yes | Free | D | EASY | WARROOM_GOOGLE_KG_API_KEY | OPERATIONAL |
| 15 | Internet Archive / Wayback Machine | Internet Archive (501c3) | US, global | 01 | REST+FEED+BULK | No | Free | C | EASY–MODERATE | WARROOM_IA_S3_ACCESS_KEY | OPERATIONAL |
| 16 | ISNI (ISO 27729) | ISNI International Agency (ISNI-IA; technical ops OCLC) | UK/global | 01 | REST+BULK | No | Free | A | MODERATE | WARROOM_ISNI_SRU_URL | OPERATIONAL |
| 17 | JMdict / EDICT2 / KANJIDIC / JMnedict | Electronic Dictionary Research & Development Group (EDRDG, Jim Breen) | AU/JP | 01 | BULK | No | Free | B | EASY | WARROOM_JMDICT_DUMP_URL | OPERATIONAL |
| 18 | Kaikki.org / wiktextract | Tatu Ylonen (independent, academic-adjacent) | FI | 01 | BULK | No | Free | E | EASY | WARROOM_KAIKKI_DUMP_URL | OPERATIONAL |
| 19 | Kiwix ZIM library | Kiwix Association | CH/global | 01 | BULK | No | Free | C | MODERATE | WARROOM_KIWIX_ZIM_DIR | OPERATIONAL |
| 20 | Merriam-Webster Developer Center | Merriam-Webster Inc. (Britannica subsidiary) | US | 01 | REST | Yes | Free-academic | D | EASY | WARROOM_MW_API_KEY | OPERATIONAL |
| 21 | Mojeek Search API | Mojeek Ltd | UK | 01 | REST | Yes | Freemium | D | EASY | WARROOM_MOJEEK_API_KEY | OPERATIONAL |
| 22 | MusicBrainz | MetaBrainz Foundation | US, global | 01 | REST+BULK | No | Free | C | EASY | WARROOM_MUSICBRAINZ_API_URL | OPERATIONAL |
| 23 | Reddit Data API | Reddit Inc. | US, global | 01 | REST | Yes | Free-academic | D | HARD | WARROOM_REDDIT_CLIENT_ID | OPERATIONAL |
| 24 | Wikibase Cloud | Wikimedia Deutschland (WMDE) | DE (EU data centers) | 01 | REST+SPARQL | No | Free | A/E | EASY | WARROOM_WIKIBASE_CLOUD_API_URL | OPERATIONAL |
| 25 | Wikidata | Wikimedia Foundation / Wikimedia Deutschland | US/DE, global | 01 | REST+SPARQL+BULK | No | Free | A | EASY–MODERATE | WARROOM_WIKIDATA_SPARQL_URL | OPERATIONAL |
| 26 | Wikimedia Commons | Wikimedia Foundation | US, global | 01 | REST+BULK | No | Free | A | EASY | WARROOM_COMMONS_API_URL | OPERATIONAL |
| 27 | Wikimedia Enterprise dumps ecosystem | Wikimedia Foundation | US | 01 | BULK | Account-gated | Freemium | A | MODERATE | WARROOM_WIKIMEDIA_DUMPS_URL | OPERATIONAL |
| 28 | Wikipedia REST API / MediaWiki Action API | Wikimedia Foundation | US, global (330+ language editions) | 01 | REST | Optional | Free | A | EASY | WARROOM_WIKIPEDIA_API_URL | OPERATIONAL |
| 29 | WordNet (Princeton 3.1, frozen) + Open English Wordnet (active fork) | Princeton University / Global Wordnet Association (John McCrae et al.) | US/IE, global wordnet ecosystem | 01 | BULK+REPO | No | Free | A/B | EASY | WARROOM_OEWN_DUMP_URL | OPERATIONAL |
| 30 | YAGO 4.5 | Max Planck Institute for Informatics → Télécom Paris (YAGO team) | DE/FR | 01 | SPARQL+BULK | No | Free | B | MODERATE | WARROOM_YAGO_SPARQL_URL | OPERATIONAL |
| 31 | Codeberg API | Codeberg e.V. (nonprofit) | Germany/EU | 02 | REST | Optional | Free | C | EASY | WARROOM_CODEBERG_TOKEN | OPERATIONAL |
| 32 | crates.io (Rust) | Rust Foundation | US/global | 02 | REST+FEED | No | Free | A | EASY | WARROOM_CRATES_INDEX_URL | OPERATIONAL |
| 33 | Debian Sources/UDD & distro metadata | Debian Project | global (DE) | 02 | REST+BULK | No | Free | A | MODERATE | WARROOM_DEBIAN_SOURCES_API | OPERATIONAL |
| 34 | deps.dev API | Google Open Source Insights | US/global | 02 (→03) | REST+gRPC | No | Free | D | EASY | WARROOM_DEPS_DEV_API_URL | OPERATIONAL |
| 35 | DevDocs | DevDocs community (Thibaut Courouble et al.) | global | 02 | BULK | No | Free | C/E | MODERATE | WARROOM_DEVDOCS_BASE_URL | OPERATIONAL |
| 36 | Ecosyste.ms APIs | Andrew Nesbitt / Ecosyste.ms (Open Source Collective hosted) | UK | 02 | REST | No | Free | C | EASY | WARROOM_ECOSYSTE_MS_API_URL | OPERATIONAL |
| 37 | endoflife.date API | endoflife.date community | UK/global | 02 (→03) | REST | No | Free | C | EASY | WARROOM_EOL_API_URL | OPERATIONAL |
| 38 | GitHub API | GitHub (Microsoft) | US/global | 02 (→03) | REST+GraphQL | Yes | Freemium | A/D | EASY | WARROOM_GITHUB_TOKEN | OPERATIONAL |
| 39 | GitLab REST/GraphQL API | GitLab Inc. | US/global (SaaS) + self-hosted worldwide | 02 (→03) | REST+GraphQL | Optional | Free | D | EASY | WARROOM_GITLAB_TOKEN | OPERATIONAL |
| 40 | grep.app | Vercel Inc. (acquired grep.app) | US | 02 | REST | No | Free | D | EASY | WARROOM_GREP_APP_API_URL | OPERATIONAL |
| 41 | Homebrew JSON API | Homebrew (community, Linux Foundation-hosted infra) | global | 02 | REST | No | Free | C | EASY | WARROOM_HOMEBREW_API_URL | OPERATIONAL |
| 42 | IETF Datatracker API / rfc-editor.org | IETF / RFC Editor (IETF LLC) | US/global | 02 (→20) | REST | No | Free | A | MODERATE | WARROOM_IETF_API_URL | OPERATIONAL |
| 43 | kernel.org + lore.kernel.org (public-inbox) | Linux Kernel Organization / kernel.org infra | US/global | 02 | FEED+BULK+REPO | No | Free | A | MODERATE | WARROOM_KERNEL_GIT_URL | OPERATIONAL |
| 44 | Maven Central Repository | Sonatype / Maven Central (now under Sonatype; Central Portal) | US/global | 02 | REST+Solr | No | Free | A/D | MODERATE | WARROOM_MAVEN_SEARCH_URL | OPERATIONAL |
| 45 | MDN Web Docs | Mozilla + Open Web Docs collective | US/global | 02 | REST+REPO | Optional | Free | A/C | MODERATE | WARROOM_MDN_GITHUB_TOKEN | OPERATIONAL |
| 46 | MetaCPAN API | MetaCPAN (Perl community, sponsored) | global (EU-hosted) | 02 | REST | No | Free | C | EASY | WARROOM_METACPAN_API_URL | OPERATIONAL |
| 47 | npm Registry API | GitHub / Microsoft (npm Inc.) | US/global | 02 | REST | No | Free | A/D | EASY | WARROOM_NPM_REGISTRY_URL | OPERATIONAL |
| 48 | PyPI | Python Software Foundation | US/global | 02 | REST | No | Free | A | EASY | WARROOM_PYPI_API_URL | OPERATIONAL |
| 49 | Rosetta Code | Rosetta Code community (hosted by Miraheze) | US/global | 02 | REST | No | Free | E | EASY | WARROOM_ROSETTA_API_URL | OPERATIONAL |
| 50 | RubyGems.org API | Ruby Central | US/global | 02 | REST | No | Free | A/C | EASY | WARROOM_RUBYGEMS_API_URL | OPERATIONAL |
| 51 | Software Heritage | Software Heritage (Inria, with UNESCO partnership) | France/global | 02 | REST | Optional | Free | A/B | MODERATE–HARD | WARROOM_SWH_API_TOKEN | OPERATIONAL |
| 52 | Sourcegraph | Sourcegraph Inc. | US | 02 | GraphQL | Yes | Paid | D | HARD | — | DISCONTINUED |
| 53 | Stack Exchange API v2.3 | Stack Exchange Inc. (Prosus) | US/global | 02 | REST | Yes | Free | D | EASY | WARROOM_STACKEXCHANGE_KEY | OPERATIONAL |
| 54 | W3C API | W3C | global (US/FR/JP/CN hosts) | 02 (→20) | REST | Yes | Free | A | MODERATE | WARROOM_W3C_API_KEY | OPERATIONAL |
| 55 | Apache Software Foundation Jira REST API | Apache Software Foundation (Atlassian Jira) | US/global | 03 | REST | Optional | Free | A | EASY | WARROOM_APACHE_JIRA_URL | OPERATIONAL |
| 56 | Bugzilla.mozilla.org REST API | Mozilla | US/global | 03 | REST | Optional | Free | A | EASY–MODERATE | WARROOM_BUGZILLA_MOZILLA_KEY | OPERATIONAL |
| 57 | CISA KEV (Known Exploited Vulnerabilities Catalog) | CISA (US DHS) | US | 03 (→04) | BULK | No | Free | A | EASY | WARROOM_CISA_KEV_URL | OPERATIONAL |
| 58 | Debian Security Tracker | Debian Security Team | global (EU-centric) | 03 | BULK+REPO | No | Free | A | EASY | WARROOM_DEBIAN_TRACKER_URL | OPERATIONAL |
| 59 | GitHub Advisory Database | GitHub (Microsoft) | US/global | 03 | REST+GraphQL+REPO | Yes | Free | A/D | EASY | WARROOM_GITHUB_TOKEN | OPERATIONAL |
| 60 | GitLab Advisory Database + Open Source Edition | GitLab Inc. | US/global | 03 | GraphQL+REPO | Yes | Free | D/B | EASY–MODERATE | WARROOM_GITLAB_TOKEN | OPERATIONAL |
| 61 | Go Vulnerability Database | Go Security Team (Google) | US/global | 03 | REST+BULK | No | Free | A | EASY | WARROOM_GO_VULNDB_URL | OPERATIONAL |
| 62 | Launchpad web service API | Canonical | UK/global | 03 | REST | No | Free | A | MODERATE | WARROOM_LAUNCHPAD_API_URL | OPERATIONAL |
| 63 | Libraries.io API | Tidelift (acquired by Sonar — definitive agreement announced; banner live on site) | US/global | 03 | REST | Yes | Freemium | D | EASY | WARROOM_LIBRARIESIO_KEY | OPERATIONAL |
| 64 | Microsoft Security Response Center CVRF API | Microsoft | US | 03 | REST | No | Free | A | EASY | WARROOM_MSRC_API_URL | OPERATIONAL |
| 65 | OSV.dev (Open Source Vulnerabilities) | Google (OpenSSF OSV schema) | US/global | 03 | REST+BULK | No | Free | A/E | EASY | WARROOM_OSV_API_URL | OPERATIONAL |
| 66 | Red Hat Security Data API | Red Hat Product Security | US | 03 | REST | No | Free | A | EASY | WARROOM_REDHAT_SECDATA_URL | OPERATIONAL |
| 67 | Ubuntu Security API (USN/CVE) | Canonical | UK/global | 03 | REST+BULK | No | Free | A | MODERATE | WARROOM_UBUNTU_SECURITY_URL | OPERATIONAL |
| 68 | AbuseIPDB API v2 | AbuseIPDB (Vivid Holdings) | US | 04 | REST | Yes | Freemium | D | EASY | WARROOM_ABUSEIPDB_API_KEY | OPERATIONAL |
| 69 | ANY.RUN Sandbox / TI Lookup / TI Feeds APIs | ANYRUN FZCO | UAE/global | 04 | REST | Yes | Freemium | D | MODERATE | WARROOM_ANYRUN_API_KEY | OPERATIONAL |
| 70 | ATLAS (Adversarial Threat Landscape for AI Systems) | MITRE | US | 04 | REPO | No | Free | A | EASY | none | OPERATIONAL |
| 71 | ATT&CK knowledge base | MITRE | US | 04 | REPO | No | Free | A | EASY–MODERATE | none | OPERATIONAL |
| 72 | Censys Platform API v3 (+ Legacy Search API) | Censys | US | 04 | REST | Yes | Freemium | D | MODERATE | WARROOM_CENSYS_PAT | OPERATIONAL |
| 73 | CERT-FR public MISP IOC feed (+ alertes/avis) | ANSSI | FR | 04 | FEED | No | Free | A | EASY | none | OPERATIONAL |
| 74 | CVE Services API | CVE Program (MITRE, CISA-funded) | US | 04 | REST | No | Free | A | EASY | WARROOM_CVE_SERVICES_URL | OPERATIONAL |
| 75 | CWE & CAPEC data repositories | MITRE | US | 04 | BULK | No | Free | A | EASY | none | OPERATIONAL |
| 76 | EPSS (Exploit Prediction Scoring System) | FIRST.org (model by Empirical Security/Cyentia) | intl (US) | 04 | REST | No | Freemium | B | EASY | none | OPERATIONAL |
| 77 | Exploit Database | OffSec (Offensive Security) | US/global | 04 | BULK+REPO | No | Free | E/D | EASY | none | OPERATIONAL |
| 78 | GreyNoise API (Community + Enterprise) | GreyNoise Intelligence | US | 04 | REST | Yes | Freemium | D | EASY | WARROOM_GREYNOISE_API_KEY | OPERATIONAL |
| 79 | Hybrid Analysis | CrowdStrike | US | 04 | REST | Yes | Free | D | EASY | WARROOM_HYBRID_ANALYSIS_API_KEY | OPERATIONAL |
| 80 | JVNRSS feeds + JVN iPedia DB | IPA & JPCERT/CC | JP | 04 | FEED+SEARCH INTERFACE | No | Free | A | EASY | none | OPERATIONAL |
| 81 | MalwareBazaar | abuse.ch (Bern Univ. of Applied Sciences; Spamhaus alliance) | CH | 04 | REST | Yes | Free | C | EASY | WARROOM_ABUSECH_AUTH_KEY | OPERATIONAL |
| 82 | MISP Default Feeds (50+) incl. CIRCL OSINT | MISP Project / CIRCL | LU/global | 04 | REST | Account-gated | Free | C/B | EASY–MODERATE | WARROOM_MISP_URL | OPERATIONAL |
| 83 | NCSC-NL advisories CSAF provider | NCSC (Netherlands gov) | NL | 04 | REST | No | Free | A | MODERATE | none | OPERATIONAL |
| 84 | NVD API 2.0 | NIST | US | 04 (→03) | REST | Yes | Free | A | EASY | WARROOM_NVD_API_KEY | OPERATIONAL |
| 85 | Open Threat Exchange (OTX) DirectConnect API | LevelBlue (ex-AT&T/AlienVault) | US | 04 | REST | Yes | Free | C/D | EASY | WARROOM_OTX_API_KEY | OPERATIONAL |
| 86 | PhishStats API | PhishStats | BR (research project since 2014) | 04 | REST | Optional | Freemium | C | EASY | WARROOM_PHISHSTATS_API_KEY | OPERATIONAL |
| 87 | Ransomware.live API (free v2 + Pro) | Ransomware.live (JMousqueton) | FR/global | 04 | REST | Account-gated | Freemium | C/E | EASY | WARROOM_RANSOMWARE_LIVE_API_KEY | OPERATIONAL |
| 88 | Shodan REST/Streaming APIs + InternetDB | Shodan | US | 04 | REST | Yes | Freemium | D | EASY | WARROOM_SHODAN_API_KEY | OPERATIONAL |
| 89 | ThreatFox | abuse.ch | CH | 04 | REST | Yes | Free | C | EASY | WARROOM_ABUSECH_AUTH_KEY | OPERATIONAL |
| 90 | URLhaus | abuse.ch | CH | 04 | REST+BULK | Yes | Free | C | EASY | WARROOM_ABUSECH_AUTH_KEY | OPERATIONAL |
| 91 | VirusTotal | Google (Mandiant) | US/global | 04 | REST | Yes | Freemium | D | EASY | WARROOM_VT_API_KEY | OPERATIONAL |
| 92 | VulDB | VulDB (Switzerland) | CH | 04 | REST | Yes | Freemium | D | MODERATE | WARROOM_VULDB_API_KEY | OPERATIONAL |
| 93 | Warn- und Informationsdienst (WID) | BSI CERT-Bund | DE | 04 | FEED | No | Free | A | EASY–HARD | none | OPERATIONAL |
| 94 | BioPortal REST API | NCBO / Stanford | USA | 05 | REST | Yes | Free | B | EASY | WARROOM_BIOPORTAL_API_KEY | OPERATIONAL |
| 95 | ICD API | WHO | Global | 05 | REST | Yes | Free | A | MODERATE | WARROOM_WHO_ICD_CLIENT_ID | OPERATIONAL |
| 96 | LOINC TS | Regenstrief Institute | USA, global use | 05 | REST | Account-gated | Free | A | EASY | WARROOM_LOINC_USER | OPERATIONAL |
| 97 | OLS4 API | EMBL-EBI | UK/EU | 05 (→09) | REST | No | Free | B | EASY | — | OPERATIONAL |
| 98 | Ontobee / HeGroup triple store | Univ. of Michigan (He Group) | USA | 05 | SPARQL | No | Free | B/E | MODERATE | — | OPERATIONAL |
| 99 | Orphadata + ORPHAcodes API | INSERM US14 / Orphanet consortium | France/EU, global | 05 | REST+BULK | No | Freemium | A | MODERATE | — | OPERATIONAL |
| 100 | SNOMED CT terminology (Snowstorm server; public reference instance) | SNOMED International | Global (member countries) | 05 | REST | No | Freemium | A | HARD | WARROOM_SNOMED_LICENSE | OPERATIONAL |
| 101 | UMLS Terminology Services REST API | NLM | USA | 05 | REST | Account-gated | Licensed | A | MODERATE | WARROOM_UMLS_API_KEY | OPERATIONAL |
| 102 | ClinicalTrials.gov Data API v2 | NLM/NIH | USA registry, 220+ countries coverage | 06 | REST | No | Free | A | EASY | WARROOM_CTGOV_BASE_URL | OPERATIONAL |
| 103 | CTIS public portal (euclinicaltrials.eu) | EMA/EU | EU/EEA | 06 | SEARCH INTERFACE | No | Free | A | MODERATE | — | OPERATIONAL |
| 104 | Europe PMC Web Service | EMBL-EBI | UK/EU | 06 | REST+OAI-PMH+BULK | No | Free | B | EASY | WARROOM_EUROPEPMC_BASE_URL | OPERATIONAL |
| 105 | GBD Results Tool + GHDx | IHME, University of Washington | USA, global (204 countries) | 06 | BULK | No | Free-academic | B | MODERATE | WARROOM_GHDX_ACCOUNT | OPERATIONAL |
| 106 | GHO OData API | WHO | Global (194 member states) | 06 | REST+OData | No | Free | A | MODERATE | WARROOM_WHO_GHO_BASE_URL | OPERATIONAL |
| 107 | GISAID EpiCoV platform | GISAID Initiative | Germany/Global | 06 | BULK | No | Free | C | MODERATE | WARROOM_GISAID_CREDENTIALS | OPERATIONAL |
| 108 | HealthMap | Boston Children's Hospital | USA, global (15 languages) | 06 | SEARCH INTERFACE | No | Freemium | B | HARD | — | OPERATIONAL |
| 109 | ICTRP Search Portal + Web Service | WHO | Global (aggregates 17+ primary registries: ChiCTR China, CTRI India, jRCT/JPRN Japan, CRiS Korea, ANZCTR, DRKS, IRCT Iran, PACTR Africa, ReBec Brazil, RPCEC Cuba, SLCTR, TCTR…) | 06 | SEARCH INTERFACE | Account-gated | Freemium | A | HARD | WARROOM_ICTRP_CREDENTIALS | OPERATIONAL |
| 110 | MedlinePlus APIs | NLM | USA (EN/ES) | 06 | REST+FEED+BULK | No | Free | A | EASY | — | OPERATIONAL |
| 111 | NICE Syndication API | NICE (National Institute for Health and Care Excellence) | UK | 06 | REST | Yes | Free | A | HARD | WARROOM_NICE_SYNDICATION_KEY | OPERATIONAL |
| 112 | Open Targets Platform API | Open Targets consortium (EMBL-EBI, Sanger, GSK etc.) | UK/EU | 06 (→07) | GraphQL | No | Free | B/C | EASY–MODERATE | WARROOM_OPENTARGETS_API_URL | OPERATIONAL |
| 113 | PMC Article Datasets | NLM/NCBI | USA | 06 | REST+OAI-PMH+BULK | No | Free | A | MODERATE | WARROOM_PMC_OA_BUCKET | DISCONTINUED |
| 114 | ProMED-mail | International Society for Infectious Diseases (ISID) | USA, global | 06 | FEED | No | Freemium | A/B | MODERATE | WARROOM_PROMED_SUBSCRIPTION | OPERATIONAL |
| 115 | AccessGUDID API | US FDA (hosted by NLM) | USA | 07 | REST | No | Free | A | EASY | WARROOM_GUDID_BASE_URL | OPERATIONAL |
| 116 | BindingDB | UC San Diego (Skaggs School) | USA | 07 | REST+BULK | No | Free | B | MODERATE | WARROOM_BINDINGDB_BASE_URL | OPERATIONAL |
| 117 | ChEMBL Data API | EMBL-EBI | UK/EU | 07 | REST | No | Free | B | EASY | WARROOM_CHEMBL_BASE_URL | OPERATIONAL |
| 118 | DailyMed | US NLM/NIH | USA | 07 | REST | No | Free | A | EASY | WARROOM_DAILYMED_BASE_URL | OPERATIONAL |
| 119 | DPD REST API | Health Canada | Canada | 07 | REST | No | Free | A | EASY | WARROOM_HC_DPD_BASE_URL | OPERATIONAL |
| 120 | DrugBank API | DrugBank (OMx) — commercial, Univ. of Alberta origin | Canada | 07 | REST | Yes | Freemium | D | EASY | WARROOM_DRUGBANK_API_KEY | OPERATIONAL |
| 121 | DrugCentral | Univ. of New Mexico / NCATS-linked | USA | 07 | BULK+SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_DRUGCENTRAL_DATA_URL | OPERATIONAL |
| 122 | EMA Medicines/EPAR data & SPOR services | European Medicines Agency | EU/EEA | 07 | REST+BULK | Account-gated | Free | A | EASY–HARD | WARROOM_EMA_DATA_URL | OPERATIONAL |
| 123 | FDA Orange Book data files (+ Purple Book lists) | US FDA | USA | 07 | REST+BULK | Optional | Free | A | EASY | WARROOM_ORANGEBOOK_DATA_URL | OPERATIONAL |
| 124 | GtoPdb Web Services | IUPHAR/British Pharmacological Society | UK/Global | 07 | REST | No | Free | B | EASY–MODERATE | WARROOM_GTOPDB_BASE_URL | OPERATIONAL |
| 125 | openFDA | U.S. FDA | USA | 07 | REST | Optional | Free | A | EASY | WARROOM_OPENFDA_API_KEY | OPERATIONAL |
| 126 | PharmGKB API | Stanford Univ./PharmGKB (NIH-funded) | USA | 07 | REST | No | Free | B | MODERATE | WARROOM_PHARMGKB_BASE_URL | OPERATIONAL |
| 127 | PubChem PUG-REST (+PUG-View) | NCBI/NLM/NIH | USA | 07 | REST | No | Free | A | EASY | WARROOM_PUBCHEM_BASE_URL | OPERATIONAL |
| 128 | RxNav/RxNorm APIs | US NLM/NIH | USA | 07 | REST | No | Free | A | EASY | WARROOM_RXNAV_BASE_URL | OPERATIONAL |
| 129 | VAERS data sets | CDC + FDA (HHS) | USA | 07 | BULK | No | Free | A | EASY | WARROOM_VAERS_DATA_URL | OPERATIONAL |
| 130 | VigiAccess | Uppsala Monitoring Centre for WHO PIDM | Sweden/Global (180+ member countries) | 07 | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_VIGIACCESS_URL | OPERATIONAL |
| 131 | Biodiversity Heritage Library (BHL) | BHL consortium | US/global | 08 (→21) | REST+IIIF | Yes | Free | A | EASY | WARROOM_BHL_API_KEY | OPERATIONAL |
| 132 | ChEBI 2.0 | EMBL-EBI | UK/EU | 08 | REST+SOAP | No | Free | A/B | EASY–MODERATE | WARROOM_CHEBI_API | OPERATIONAL |
| 133 | COCONUT | Steinbeck Lab, Friedrich Schiller University Jena | Germany | 08 | REST | No | Free | C/E | EASY | WARROOM_COCONUT_API | OPERATIONAL |
| 134 | Dr Duke's DB | USDA-ARS / National Agricultural Library | USA | 08 | BULK+SEARCH INTERFACE | No | Free | A | EASY | WARROOM_DRDUKE_BULK_URL | OPERATIONAL |
| 135 | ETCM v2.0 | Institute of Chinese Materia Medica, China Academy of Chinese Medical Sciences | China (national academy) | 08 | SEARCH INTERFACE | No | Free | A/B | MODERATE | WARROOM_ETCM_BASE_URL | OPERATIONAL |
| 136 | IMPPAT 2.0 | IMSc Chennai (Samal lab) | India | 08 | BULK+SEARCH INTERFACE | No | Free | B | EASY–MODERATE | WARROOM_IMPPAT_BASE_URL | OPERATIONAL |
| 137 | KNApSAcK Family | NAIST | Japan | 08 | SEARCH INTERFACE+BULK | No | Free-academic | B | EASY | — | SEARCH-ONLY |
| 138 | LOTUS / LNPN | Community (Wolfender lab UNIGE + Steinbeck lab) | Switzerland/Germany | 08 | SPARQL | No | Free | E | MODERATE | WARROOM_WDQS_ENDPOINT | OPERATIONAL |
| 139 | MPNS | Royal Botanic Gardens, Kew | UK | 08 | REST+SEARCH INTERFACE | Account-gated | Freemium | A | EASY–MODERATE | WARROOM_MPNS_BASE_URL | OPERATIONAL |
| 140 | NAEB (Moerman DB) | Botanical Research Institute of Texas (BRIT); original Univ. of Michigan-Dearborn | USA | 08 | BULK+SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_NAEB_BASE_URL | OPERATIONAL |
| 141 | NPAtlas | Linington Lab, Simon Fraser University | Canada | 08 | REST | Optional | Free | B | EASY | WARROOM_NPATLAS_API_KEY | OPERATIONAL |
| 142 | PFAF | Plants For A Future (UK charity) | UK | 08 | SEARCH INTERFACE | No | Free | C/E | MODERATE | WARROOM_PFAF_BASE_URL | OPERATIONAL |
| 143 | PROTA / PROTA4U | PROTA Foundation (Wageningen network + African partners) | Netherlands/Africa | 08 | BULK+SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_PROTA4U_BASE_URL | OPERATIONAL |
| 144 | restricted 1 CSIR-TKDL | CSIR + Ministry of AYUSH, Govt of India | India | 08 | SEARCH INTERFACE | Yes | Licensed | A | HARD | WARROOM_TKDL_LICENSE | OPERATIONAL |
| 145 | SANCDB | RUBi, Rhodes University | South Africa | 08 | BULK+SEARCH INTERFACE | No | Free | B | EASY | WARROOM_SANCDB_BASE_URL | OPERATIONAL |
| 146 | SymMap | Built by TCM expert committee (17 experts); China Pharmaceutical Univ. lineage | China | 08 | SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_SYMMAP_BASE_URL | OPERATIONAL |
| 147 | TCMID 2.0 | originally East China Normal Univ.; now mirrored at BIDD group (NUS) | China/Singapore | 08 | BULK+SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_TCMID_BASE_URL | OPERATIONAL |
| 148 | TCMSP | Northwest A&F University (Yangling) | China | 08 | BULK+SEARCH INTERFACE | No | Free | B | MODERATE | WARROOM_TCMSP_BASE_URL | OPERATIONAL |
| 149 | Useful Tropical Plants DB | The Ferns (Ken Fern) | UK | 08 | SEARCH INTERFACE | No | Free | C/E | MODERATE | WARROOM_UTP_BASE_URL | OPERATIONAL |
| 150 | WHO IRIS (OAI-PMH) + WHO Global Centre for Traditional Medicine | WHO; GCTM hosted by Govt of India (Jamnagar) | Global/India | 08 | OAI-PMH | No | Free | A | EASY | WARROOM_WHO_IRIS_OAI | OPERATIONAL |
| 151 | AlphaFold DB API + bulk | Google DeepMind + EMBL-EBI | UK/USA | 09 | REST+BULK | No | Free | A | EASY | WARROOM_ALPHAFOLD_API_BASE | OPERATIONAL |
| 152 | BioGRID Web Service / BioGRID ORCS REST | BioGRID (SickKids Toronto, Princeton, et al.) | Canada/USA | 09 | REST | Yes | Free | B | EASY | WARROOM_BIOGRID_API_KEY | OPERATIONAL |
| 153 | Cellosaurus REST API + SPARQL + FTP | CALIPHO group, SIB Swiss Institute of Bioinformatics | Switzerland | 09 | REST+SPARQL+BULK | No | Free | A/B | EASY | WARROOM_CELLOSAURUS_API_BASE | OPERATIONAL |
| 154 | DDBJ programmatic access (getentry, ARSA Web API, DDBJ Search) | DDBJ Center, National Institute of Genetics (NIG), ROIS | Japan | 09 | REST+BULK+SEARCH INTERFACE | No | Free | A | MODERATE | WARROOM_DDBJ_API_BASE | OPERATIONAL |
| 155 | ENA Portal (Advanced Search) API + Browser API | EMBL-EBI | UK/EU (INSDC partner) | 09 | REST | No | Free | A | EASY | WARROOM_ENA_PORTAL_API_BASE | OPERATIONAL |
| 156 | Ensembl REST API | EMBL-EBI & Wellcome Sanger Institute | UK/EU | 09 | REST | No | Free | A | EASY | WARROOM_ENSEMBL_REST_BASE | OPERATIONAL |
| 157 | gnomAD GraphQL API | Broad Institute | USA | 09 | GraphQL | No | Free | A | EASY | WARROOM_GNOMAD_API_BASE | OPERATIONAL |
| 158 | IntAct API | EMBL-EBI (IMEx consortium platform) | UK/EU (IMEx global) | 09 | REST | No | Free | A | MODERATE | WARROOM_INTACT_API_BASE | OPERATIONAL |
| 159 | KEGG API | Kanehisa Laboratories / Kyoto University / NPO Bioinformatics Japan | Japan | 09 | REST | No | Freemium | A | EASY–HARD | WARROOM_KEGG_REST_BASE | OPERATIONAL |
| 160 | MetaboLights REST API | EMBL-EBI | UK/EU | 09 | REST | No | Free | A | MODERATE | WARROOM_METABOLIGHTS_API_BASE | OPERATIONAL |
| 161 | Metabolomics Workbench REST API | NIH Common Fund / UCSD & U Florida (NMDR) | USA | 09 | REST | No | Free | A/B | EASY | WARROOM_METWORKBENCH_API_BASE | OPERATIONAL |
| 162 | NCBI Datasets v2 REST API | NCBI/NIH | USA | 09 | REST | Optional | Free | A | EASY | WARROOM_NCBI_DATASETS_API_KEY | OPERATIONAL |
| 163 | NCBI E-utilities (Entrez) | NCBI / NLM / NIH | USA | 09 (→06, 10) | REST | Optional | Free | A | EASY | WARROOM_NCBI_API_KEY | OPERATIONAL |
| 164 | PRIDE Archive RESTful API v2 (+ ProteomeCentral RSS) | EMBL-EBI (PRIDE); ProteomeXchange Consortium (incl. PeptideAtlas, MassIVE USA, jPOST Japan) | UK/EU + global PX partners | 09 | REST+FEED+BULK | No | Free | A | EASY–MODERATE | WARROOM_PRIDE_API_BASE | OPERATIONAL |
| 165 | RCSB PDB Data API / Search API / Sequence Coordinates API | RCSB PDB (Rutgers, UCSD, NIST-funded wwPDB partner) | USA (wwPDB global: PDBe UK, PDBj Japan, BMRB) | 09 | REST+GraphQL | No | Free | A | EASY–MODERATE | WARROOM_RCSB_API_BASE | OPERATIONAL |
| 166 | Reactome Content Service + Analysis Service | Reactome (OICR, EMBL-EBI, NYU, OHSU) | Canada/UK/USA | 09 | REST | No | Free | A | EASY | WARROOM_REACTOME_API_BASE | OPERATIONAL |
| 167 | STRING API | STRING Consortium (SIB, CPR Copenhagen, EMBL, UZH) | Switzerland/Denmark/Germany | 09 | REST | No | Free | A/B | EASY | WARROOM_STRING_API_BASE | OPERATIONAL |
| 168 | UniProtKB REST API / ID Mapping / SPARQL | UniProt Consortium (EMBL-EBI, SIB, PIR) | UK/Switzerland/USA | 09 | REST+SPARQL | No | Free | A | EASY | WARROOM_UNIPROT_REST_BASE | OPERATIONAL |
| 169 | WikiPathways API + SPARQL | WikiPathways (Maastricht University, Gladstone/UCSF et al.) | Netherlands/USA | 09 | REST+SPARQL | No | Free | C | EASY | WARROOM_WIKIPATHWAYS_API_BASE | OPERATIONAL |
| 170 | BacDive API v2 (bacterial/archaeal strains) & LPSN API (prokaryote nomenclature) | Leibniz Institute DSMZ | Germany | 10 | REST | Account-gated | Free | A | EASY | WARROOM_BACDIVE_API_BASE | OPERATIONAL |
| 171 | BirdLife Data Zone | BirdLife International | UK | 10 | SEARCH INTERFACE | No | Free-academic | B | HARD | — | OPERATIONAL |
| 172 | BOLD API v4 (Barcode of Life Data System) | Centre for Biodiversity Genomics, University of Guelph | Canada | 10 | REST | No | Free | B | EASY | WARROOM_BOLD_API_BASE | OPERATIONAL |
| 173 | ChecklistBank API (hosts Catalogue of Life releases) | Catalogue of Life + GBIF | Netherlands/Denmark | 10 | REST | No | Free | A/B | EASY | WARROOM_COL_API_BASE | OPERATIONAL |
| 174 | eBird API 2.0 | Cornell Lab of Ornithology | USA (global bird data) | 10 | REST | Yes | Free | B | EASY | WARROOM_EBIRD_API_KEY | OPERATIONAL |
| 175 | EOL API v1.0 + TraitBank | Encyclopedia of Life (Smithsonian-led consortium) | USA | 10 | REST | No | Free | B/C | EASY | WARROOM_EOL_API_BASE | OPERATIONAL |
| 176 | GBIF REST API | Global Biodiversity Information Facility | Denmark (global network) | 10 | REST | No | Free | A | EASY | WARROOM_GBIF_API_BASE | OPERATIONAL |
| 177 | GlobalTreeSearch | Botanic Gardens Conservation International (BGCI) | UK | 10 | BULK+SEARCH INTERFACE | No | Free | C/B | EASY | WARROOM_GLOBALTREESEARCH_CSV_URL | OPERATIONAL |
| 178 | GloBI Web API | GloBI (Jorrit Poelen / open community) | USA/global (open-source project) | 10 | REST | No | Free | E/C | EASY | WARROOM_GLOBI_API_BASE | OPERATIONAL |
| 179 | GRIIS (IUCN SSC Invasive Species Specialist Group) | IUCN ISSG | New Zealand/global | 10 | REST+BULK | No | Free | A | MODERATE | WARROOM_GRIIS_ZENODO_DOI | OPERATIONAL |
| 180 | ICTV Master Species List (MSL) + Virus Metadata Resource (VMR) | International Committee on Taxonomy of Viruses | International | 10 | BULK | No | Free | A | EASY | WARROOM_ICTV_MSL_URL | OPERATIONAL |
| 181 | iNaturalist API (v1 primary; v2 beta; v0 deprecated) | iNaturalist (California Academy of Sciences + National Geographic joint initiative) | USA (global user base incl. strong LatAm/Asia coverage via localized networks) | 10 | REST | No | Free | C | EASY | WARROOM_INATURALIST_API_BASE | OPERATIONAL |
| 182 | Index Fungorum (legacy SOAP webservice + search interface) | Index Fungorum Partnership (RBG Kew, Landcare Research NZ, Institute of Microbiology CAS-China) | UK/NZ/China | 10 | SOAP+SEARCH INTERFACE | No | Free | B | HARD | — | SEARCH-ONLY |
| 183 | ITIS Web Services (REST JSON + Solr endpoint) | Integrated Taxonomic Information System (USGS-led federal partnership) | USA | 10 | REST+Solr | No | Free | A | EASY | WARROOM_ITIS_API_BASE | OPERATIONAL |
| 184 | IUCN Red List API v4 (v3 REMOVED March 2025 — DISCONTINUED, no account migration) | IUCN | Switzerland | 10 | REST | Yes | Free-academic | A | EASY | WARROOM_IUCN_REDLIST_TOKEN | OPERATIONAL |
| 185 | Movebank REST/direct-read API | Max Planck Institute of Animal Behavior | Germany/global | 10 (→25) | REST | No | Free | B | MODERATE | WARROOM_MOVEBANK_USER | OPERATIONAL |
| 186 | Mushroom Observer API (api2) | Mushroom Observer Inc (nonprofit community) | US/global | 10 (→25) | REST | Yes | Free | E | MODERATE | WARROOM_MUSHROOMOBSERVER_API_KEY | OPERATIONAL |
| 187 | OBIS REST API | Ocean Biodiversity Information System (IOC-UNESCO IODE; VLIZ hosts) | Belgium/UNESCO | 10 | REST | No | Free | A | EASY | WARROOM_OBIS_API_BASE | OPERATIONAL |
| 188 | PBDB API v1.2 | Paleobiology Database (international consortium; NSF-supported) | USA/global consortium | 10 | REST | No | Free | B | EASY | WARROOM_PBDB_API_BASE | OPERATIONAL |
| 189 | POWO internal JSON API (v2, undocumented) | Royal Botanic Gardens, Kew | UK | 10 | REST | No | Free | A | HARD | WARROOM_POWO_API_BASE | OPERATIONAL |
| 190 | TRY Plant Trait Database | TRY consortium, MPI-BGC Jena | Germany | 10 | BULK+SEARCH INTERFACE | No | Free | B | HARD | WARROOM_TRY_ACCOUNT | OPERATIONAL |
| 191 | Wildlife Insights | Conservation Intl + partners (Google etc.) | US/global | 10 (→25) | BULK | No | Free | B | MODERATE | WARROOM_WILDLIFEINSIGHTS_CREDS | OPERATIONAL |
| 192 | WoRMS REST API (Aphia platform) | World Register of Marine Species, VLIZ (Flanders Marine Institute) | Belgium | 10 | REST+SOAP | No | Free | A | EASY | WARROOM_WORMS_API_BASE | OPERATIONAL |
| 193 | xeno-canto bird sound API v3 | xeno-canto Foundation (Netherlands) | Netherlands/global | 10 (→25) | REST | Yes | Free | C | EASY | WARROOM_XENOCANTO_API_KEY | OPERATIONAL |
| 194 | Arctic Data Center API | NSF Arctic Data Center (NCEAS/UCSB) | US | 11 (→25) | REST+Solr | No | Free | A | MODERATE | WARROOM_ARCTICDATA_API_BASE | OPERATIONAL |
| 195 | DWD Open Data (Germany) | Deutscher Wetterdienst | Germany | 11 | BULK | No | Free | A | MODERATE | WARROOM_DWD_OPENDATA_URL | OPERATIONAL |
| 196 | ECMWF Copernicus Climate Data Store (CDS) + ADS | ECMWF / Copernicus C3S/CAMS | UK/EU | 11 | REST | Yes | Free | A | MODERATE | WARROOM_CDSAPI_TOKEN | OPERATIONAL |
| 197 | GVP Volcanoes of the World database | Smithsonian Institution NMNH | US/global | 11 (→25) | BULK+SEARCH INTERFACE | No | Free | A | MODERATE | WARROOM_GVP_BASE | OPERATIONAL |
| 198 | JMA Disaster Information XML (Japan) | Japan Meteorological Agency | Japan | 11 | FEED | No | Free | A | MODERATE | WARROOM_JMA_XML_FEED_URL | OPERATIONAL |
| 199 | Met Office Weather DataHub (UK) | UK Met Office | UK | 11 | REST | Yes | Freemium | A | EASY | WARROOM_METOFFICE_DATAHUB_KEY | OPERATIONAL |
| 200 | Met.no Locationforecast API (Norway) | Norwegian Meteorological Institute | Norway | 11 | REST | No | Free | A | EASY | WARROOM_METNO_USER_AGENT | OPERATIONAL |
| 201 | NOAA NCEI Climate Data Online (CDO) API + Access Data Service | NOAA National Centers for Environmental Information | USA | 11 | REST | Yes | Free | A | EASY–MODERATE | WARROOM_NOAA_CDO_TOKEN | OPERATIONAL |
| 202 | NOAA/NWS api.weather.gov | NOAA National Weather Service | USA | 11 | REST | No | Free | A | EASY | WARROOM_NWS_USER_AGENT | OPERATIONAL |
| 203 | ONC Oceans 3.0 API | Ocean Networks Canada, Univ. of Victoria | Canada | 11 (→25) | REST | Yes | Free | A | EASY | WARROOM_ONC_TOKEN | OPERATIONAL |
| 204 | Open-Meteo | Open-Meteo (open-source project, Zippenfenig) | Switzerland/Germany | 11 | REST | Optional | Free-academic | C/E | EASY | WARROOM_OPENMETEO_API_KEY | OPERATIONAL |
| 205 | OpenWeatherMap (One Call / Current API) | OpenWeather Ltd | UK | 11 | REST | Yes | Freemium | D | EASY | WARROOM_OPENWEATHER_API_KEY | OPERATIONAL |
| 206 | PANGAEA OAI-PMH + Data Warehouse | Alfred Wegener Institute + MARUM (official ICSU-WDS data center) | Germany (global earth/environmental/archaeological data) | 11 | OAI-PMH+BULK | No | Free | A | EASY | WARROOM_PANGAEA_OAI | OPERATIONAL |
| 207 | ADS OAI-PMH targets + SPARQL | Archaeology Data Service, University of York | UK (UK archaeology; intl. via Internet Archaeology/OASIS) | 12 | SPARQL+OAI-PMH+BULK | No | Licensed | A | EASY | WARROOM_ADS_OAI | OPERATIONAL |
| 208 | ARIADNE portal API | ARIADNE Research Infrastructure (European consortium led by PIN/University of Florence; partners incl. ADS, DANS, DAI, SND) | EU (global partners incl. tDAR USA) | 12 | REST | No | Free | B | EASY | WARROOM_ARIADNE_API_BASE | OPERATIONAL |
| 209 | CDLI REST API + daily dumps | CDLI consortium (UCLA; MPIWG Berlin hosting) | USA/Germany (global: Mesopotamia + collections worldwide) | 12 | REST+BULK | No | Free | B | MODERATE | WARROOM_CDLI_BASE | OPERATIONAL |
| 210 | D-PLACE data (incl. Pulotu) | Max Planck Institute for Evolutionary Anthropology et al. | Germany (global ethnographic coverage) | 12 | BULK | No | Free | B | EASY | WARROOM_DPLACE_DATA | OPERATIONAL |
| 211 | eBL public API | LMU Munich (eBL project, E. Jiménez) | Germany (global: Babylonian literature) | 12 | REST+BULK | No | Free | B | EASY | WARROOM_EBL_API_BASE | OPERATIONAL |
| 212 | EDH Open Data Repository | Heidelberg Academy of Sciences and Humanities | Germany (Roman-Empire-wide content) | 12 | REST+SPARQL+IIIF+BULK | No | Free | A | EASY | WARROOM_EDH_API_BASE | OPERATIONAL |
| 213 | GRETIL e-texts | University of Göttingen | Germany (South Asia content) | 12 | BULK | No | Free | B | EASY | WARROOM_GRETIL_BASE | OPERATIONAL |
| 214 | iDAI.gazetteer | German Archaeological Institute (DAI) | Germany (global coverage, antiquity-weighted) | 12 | REST | No | Free | A | EASY | WARROOM_IDAI_GAZETTEER_BASE | OPERATIONAL |
| 215 | Integrating Digital Papyrology data | papyri.info consortium (Duke, NYU ISAW, Heidelberg et al.) | USA/Germany (Egypt, Greco-Roman world) | 12 | BULK+REPO | No | Free | B | EASY | WARROOM_PAPYRI_DATA | OPERATIONAL |
| 216 | Nomisma SPARQL + per-ID LOD | American Numismatic Society + DAI + international partners | USA (global ancient/medieval numismatics) | 12 | SPARQL | No | Free | B | MODERATE | WARROOM_NOMISMA_SPARQL | OPERATIONAL |
| 217 | Open Context | Alexandria Archive Institute (nonprofit) with UC San Diego/UCLA | USA (global content) | 12 | REST+FEED | No | Free | C | EASY | WARROOM_OPENCONTEXT_BASE | OPERATIONAL |
| 218 | PerseusDL & OGL TEI corpora | Perseus Digital Library (Tufts) / Open Greek and Latin (Leipzig et al.) | USA/Germany (Greek-Latin classical world) | 12 | BULK+REPO | No | Free | B | EASY | WARROOM_OGL_CORPUS | OPERATIONAL |
| 219 | Pleiades gazetteer of the ancient world | NYU Institute for the Study of the Ancient World + community | USA (Mediterranean/ Near East / expanding global ancient places) | 12 | REST+BULK | No | Free | B | EASY | WARROOM_PLEIADES_DATA | OPERATIONAL |
| 220 | tDAR API | Digital Antiquity (Arizona State University) | USA (global, US/CRM-heavy) | 12 | REST+FEED | No | Freemium | C | MODERATE | WARROOM_TDAR_API_BASE | OPERATIONAL |
| 221 | BDRC platform APIs (BUDA) | Buddhist Digital Resource Center (nonprofit, Cambridge MA) | USA (Tibetan/Sanskrit/Chinese Buddhist corpus, Inner Asia) | 13 | REST+IIIF+BULK | No | Free | C | MODERATE | WARROOM_BDRC_BASE | OPERATIONAL |
| 222 | CBETA XML/API | Dharma Drum Institute of Liberal Arts (DILA), Taiwan | Taiwan (pan-Asian Buddhist canon, Chinese) | 13 | REST+REPO | No | Free | B | EASY | WARROOM_CBETA_DATA | OPERATIONAL |
| 223 | CHGIS v6 datasets | Harvard Yenching Institute + Fudan Univ. | US/China | 13 (→18) | REST+BULK | No | Free | B | EASY | WARROOM_CHGIS_DATAVERSE | OPERATIONAL |
| 224 | Cliopatria polity borders | Seshat Global History Databank / Complexity Science Hub Vienna | Austria (global) | 13 | BULK | No | Free | B | EASY | WARROOM_CLIOPATRIA_GEOJSON | OPERATIONAL |
| 225 | CTP API + LOD + OAI-PMH | Chinese Text Project (D. Sturgeon; independent scholarly project) | UK/Taiwan-hosted (global pre-modern China content) | 13 | REST+SPARQL+OAI-PMH+BULK | Yes | Freemium | C | MODERATE | WARROOM_CTEXT_API_KEY | OPERATIONAL |
| 226 | EHRI Portal API v1 | EHRI consortium (KNAW NIOD et al., EU RI) | Netherlands/EU (global Holocaust archives) | 13 | REST | No | Free | B | MODERATE | WARROOM_EHRI_API_BASE | OPERATIONAL |
| 227 | EncyKorea (한국민족문화대백과) | Academy of Korean Studies | South Korea | 13 (→25) | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 228 | Kanseki Repository (KR) | Kanripo project (C. Wittern, Kyoto/Heidelberg lineage) | Japan/Germany (premodern Chinese corpus) | 13 | REPO | No | Free | C | EASY | WARROOM_KANRIPO_DATA | OPERATIONAL |
| 229 | Korean Classics DB (고전종합DB, db.itkc.or.kr) | Institute for the Translation of Korean Classics (한국고전번역원) | South Korea | 13 (→25) | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 230 | Korean History DB (역사정보통합시스템) | National Institute of Korean History | South Korea | 13 (→25) | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 231 | NLI Search API + IIIF | National Library of Israel | Israel (Jewish/Islamic/Middle-East heritage, global diaspora) | 13 | REST+IIIF | Yes | Free | A | EASY | WARROOM_NLI_API_KEY | OPERATIONAL |
| 232 | Open Islamicate Texts Initiative corpus | OpenITI team (AKU-ISMC / U Maryland / KITAB) | UK/USA (Arabic-Persian-Turkish Islamicate world) | 13 | BULK+REPO | No | Free | C | EASY | WARROOM_OPENITI_CORPUS | OPERATIONAL |
| 233 | OpenHistoricalMap | OHM community (GreenInfo Network, OSM-US et al.) | USA-led community (global coverage) | 13 | REST+BULK | No | Free | E | MODERATE | WARROOM_OHM_OVERPASS | OPERATIONAL |
| 234 | PeriodO period gazetteer | PeriodO project (UT Austin / UNC / ISAW) | USA (global scholarly period definitions) | 13 | BULK | No | Free | B | EASY | WARROOM_PERIODO_DATA | OPERATIONAL |
| 235 | QDL IIIF services | Qatar National Library + British Library (Cogapp) | Qatar/UK (Gulf, India Office Records, Arabic manuscripts) | 13 | OAI-PMH+IIIF | No | Free | A | EASY | WARROOM_QDL_IIIF_BASE | OPERATIONAL |
| 236 | Seshat API + data releases | Complexity Science Hub Vienna / Oxford / international consortium | Austria/UK (global coverage, ~30 world regions) | 13 | REST+BULK | No | Free | B | MODERATE | WARROOM_SESHAT_USERNAME | OPERATIONAL |
| 237 | WHG v3 platform & API | University of Pittsburgh World History Center (NEH/IMLS/KNAW funded) | USA (global coverage incl. CHGIS, Pleiades-linked datasets) | 13 | REST | No | Free | B | EASY | WARROOM_WHG_API_BASE | OPERATIONAL |
| 238 | Congress.gov API | Library of Congress | USA | 14 | REST | Yes | Free | A | EASY | WARROOM_CONGRESS_GOV_API_KEY | OPERATIONAL |
| 239 | CourtListener API | Free Law Project | USA | 14 | REST+BULK | Yes | Free | C | EASY | WARROOM_COURTLISTENER_TOKEN | OPERATIONAL |
| 240 | e-Gov 法令API (e-Gov Law API) | Digital Agency (デジタル庁), Japan | Japan | 14 | REST | No | Free | A | EASY | WARROOM_JP_EGOV_LAW_BASE | OPERATIONAL |
| 241 | eGazette | Dept. of Publication, Ministry of Housing & Urban Affairs | India | 14 | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_IN_EGAZETTE_BASE | OPERATIONAL |
| 242 | ElectionGuide | International Foundation for Electoral Systems (IFES) | Global (240 countries/territories) | 14 | REST+BULK | Yes | Free-academic | C | EASY | WARROOM_ELECTIONGUIDE_TOKEN | OPERATIONAL |
| 243 | EUR-Lex & CELLAR | Publications Office of the EU | EU (Luxembourg) | 14 | REST+SPARQL | Optional | Free | A | HARD | WARROOM_EURLEX_SPARQL_ENDPOINT | OPERATIONAL |
| 244 | FAOLEX | FAO | Global (200+ jurisdictions) | 14 | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_FAOLEX_BASE | OPERATIONAL |
| 245 | FederalRegister.gov API | NARA / OFR (+ GPO) | USA | 14 | REST+BULK | No | Free | A | EASY | WARROOM_FEDERAL_REGISTER_BASE | OPERATIONAL |
| 246 | FRL OData API (legislation.gov.au) | Office of Parliamentary Counsel, Australia | Australia | 14 | REST+OData | No | Free | A | MODERATE | WARROOM_AU_FRL_BASE | OPERATIONAL |
| 247 | Gesetze im Internet | Bundesministerium der Justiz / juris | Germany | 14 | BULK | No | Free | A | EASY | WARROOM_DE_GII_TOC | OPERATIONAL |
| 248 | GovInfo API | US Government Publishing Office (GPO) | USA | 14 | REST+BULK | Yes | Free | A | EASY | WARROOM_GOVINFO_API_KEY | OPERATIONAL |
| 249 | Interpol Notices public web service | INTERPOL | Global | 14 | REST | No | Free | A | HARD | WARROOM_INTERPOL_NOTICES_BASE | DEGRADED |
| 250 | Justice Laws Website (Lois et règlements codifiés) | Department of Justice Canada | Canada | 14 | BULK | No | Free | A | EASY | WARROOM_CA_LAWS_BASE | OPERATIONAL |
| 251 | legislation.gov.uk API | The National Archives (UK) | UK | 14 | REST+SPARQL+FEED | No | Free | A | MODERATE | WARROOM_UK_LEGISLATION_BASE | OPERATIONAL |
| 252 | NORMLEX & NATLEX | International Labour Organization | Global (187 member states) | 14 | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_ILO_NATLEX_BASE | OPERATIONAL |
| 253 | OpenSanctions | OpenSanctions (ICIJ-origin, now independent company) | Global | 14 | REST+BULK | Yes | Freemium | C/D | EASY | WARROOM_OPENSANCTIONS_API_KEY | OPERATIONAL |
| 254 | The Gazette (official public record) | The Stationery Office / The Gazette | UK | 14 | REST | No | Free | A | EASY | WARROOM_UK_GAZETTE_BASE | OPERATIONAL |
| 255 | Voter Turnout Database | International IDEA | Global (all countries) | 14 | BULK | No | Free | B | EASY | WARROOM_IDEA_TURNOUT_XLSX | OPERATIONAL |
| 256 | WIPO Lex | World Intellectual Property Organization | Global (190+ jurisdictions) | 14 | SEARCH INTERFACE | No | Free | A | MODERATE | WARROOM_WIPOLEX_BASE | OPERATIONAL |
| 257 | 공공데이터포털 Open APIs | Ministry of the Interior and Safety, Republic of Korea | South Korea | 14 (→25) | REST | Yes | Free | A | MODERATE | WARROOM_DATAGOKR_SERVICE_KEY | OPERATIONAL |
| 258 | API Mercado Público | ChileCompra (Ministerio de Hacienda) | Chile | 15 | REST | Yes | Free | A | EASY | WARROOM_CL_MERCADOPUBLICO_TICKET | OPERATIONAL |
| 259 | BIS Data Portal (SDMX) | Bank for International Settlements | Global | 15 | REST+SDMX | No | Free | A | MODERATE | WARROOM_BIS_API_BASE | OPERATIONAL |
| 260 | BoC Valet API | Bank of Canada | Canada | 15 | REST | No | Free | A | EASY | WARROOM_BOC_VALET_BASE | OPERATIONAL |
| 261 | BoE IADB | Bank of England | UK | 15 | REST+BULK | No | Free | A | EASY | WARROOM_BOE_IADB_BASE | OPERATIONAL |
| 262 | BoJ Time-Series Data Search | Bank of Japan | Japan | 15 | BULK | No | Free | A | EASY–MODERATE | WARROOM_BOJ_STATS_BASE | SEARCH-ONLY |
| 263 | Business Registers Interconnection System (BRIS) | European Commission e-Justice | EU27 + EEA | 15 | SEARCH INTERFACE | No | Free | A | HARD | — | OPERATIONAL |
| 264 | Companies House Public Data API | Companies House | UK | 15 | REST+BULK | Yes | Free | A | EASY | WARROOM_COMPANIES_HOUSE_API_KEY | OPERATIONAL |
| 265 | ECB SDW API | European Central Bank | Euro area/EU | 15 | REST+SDMX | No | Free | A | MODERATE | WARROOM_ECB_SDW_BASE | OPERATIONAL |
| 266 | EDGAR data APIs (data.sec.gov) | US Securities & Exchange Commission | USA | 15 | REST+BULK | No | Free | A | EASY | WARROOM_SEC_EDGAR_UA | OPERATIONAL |
| 267 | EU FSD / Consolidated Sanctions List | European Commission (DG FISMA/INTPA webgate) | EU (global targets) | 15 | FEED+BULK | No | Free | A | EASY | WARROOM_EU_FSD_TOKEN | OPERATIONAL |
| 268 | Financial Transparency System | European Commission DG BUDG | EU | 15 | BULK | No | Free | A | EASY | WARROOM_EU_FTS_PAGE | OPERATIONAL |
| 269 | FRED API | Federal Reserve Bank of St. Louis | USA (+ intl series mirrored) | 15 | REST | Yes | Free | A | EASY | WARROOM_FRED_API_KEY | OPERATIONAL |
| 270 | GLEIF LEI Search 2.0 API | Global Legal Entity Identifier Foundation | Global (Switzerland HQ) | 15 | REST+BULK | No | Free | B | EASY | WARROOM_GLEIF_BASE | OPERATIONAL |
| 271 | OCDS + OCP Data Registry | Open Contracting Partnership | Global (70+ publisher jurisdictions: Ukraine ProZorro, UK, Colombia, Mexico, Paraguay, Nigeria…) | 15 | REST+BULK | Optional | Free | C | MODERATE | WARROOM_OCDS_REGISTRY | OPERATIONAL |
| 272 | OFAC SDN/Consolidated lists & SLS | US Treasury OFAC | USA (global targets) | 15 | REST+BULK | No | Free | A | EASY | WARROOM_OFAC_SDN_URL | OPERATIONAL |
| 273 | OpenCorporates API | OpenCorporates Ltd | Global (140+ jurisdictions) | 15 | REST | Yes | Freemium | D | EASY | WARROOM_OPENCORPORATES_API_TOKEN | OPERATIONAL |
| 274 | OpenSpending / Fiscal Data Package | Open Knowledge Foundation | Global | 15 | REST | No | Free | C/E | — | — | DEGRADED |
| 275 | Portal da Transparência API | Controladoria-Geral da União (CGU) | Brazil | 15 | REST | Yes | Free | A | MODERATE | WARROOM_BR_TRANSPARENCIA_API_KEY | OPERATIONAL |
| 276 | TED API (eForms notices) | Publications Office of the EU | EU/EEA | 15 | REST+SPARQL+BULK | Yes | Free | A | MODERATE | WARROOM_TED_API_KEY | OPERATIONAL |
| 277 | UK Sanctions List & OFSI Consolidated List | UK FCDO + HM Treasury OFSI | UK (global targets) | 15 | BULK | No | Free | A | EASY | WARROOM_UK_OFSI_PAGE | OPERATIONAL |
| 278 | UN SC Consolidated List | UN Security Council | Global | 15 | BULK | No | Free | A | EASY | WARROOM_UN_SC_LIST_URL | OPERATIONAL |
| 279 | United Nations Treaty Collection (UNTC) | UN Office of Legal Affairs | Global | 15 | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_UNTC_BASE | OPERATIONAL |
| 280 | USAspending API | US Treasury (Bureau of the Fiscal Service) | USA | 15 | REST+BULK | No | Free | A | MODERATE | WARROOM_USASPENDING_BASE | OPERATIONAL |
| 281 | Airiti Library | Airiti Inc. | Taiwan | 16 (→25) | SEARCH INTERFACE | Account-gated | Paid | D | HARD | — | COMMERCIAL-GATED |
| 282 | arXiv APIs | arXiv / Cornell Tech (Simons Foundation, Cornell) | US (global content) | 16 | REST+OAI-PMH+FEED+BULK | No | Freemium | A | EASY | WARROOM_ARXIV_S3_BUCKET | OPERATIONAL |
| 283 | BASE Search API | Bielefeld University Library | Germany (global OAI-harvested corpus) | 16 | REST | Yes | Free-academic | A | EASY | WARROOM_BASE_API_KEY | OPERATIONAL |
| 284 | bioRxiv & medRxiv API (Cold Spring Harbor Laboratory API) | CSHL | USA (global content) | 16 | REST | No | Free | A | EASY | WARROOM_BIORXIV_MAILTO | OPERATIONAL |
| 285 | CERN Repository (new CDS) | CERN | Switzerland (international) | 16 | REST+OAI-PMH | Optional | Free | A | EASY | — | OPERATIONAL |
| 286 | CiNii Web APIs (CiNii Research, CiNii Books, CiNii Dissertations) | National Institute of Informatics (NII) | Japan | 16 | REST | Yes | Free | A | EASY | WARROOM_CINII_APPID | OPERATIONAL |
| 287 | CNKI (中国知网) | Tongfang Knowledge Network | China | 16 (→25) | SEARCH INTERFACE | Account-gated | Paid | D | HARD | WARROOM_CNKI_CREDS | COMMERCIAL-GATED |
| 288 | CyberLeninka | CyberLeninka LLC (open science platform) | Russia (Russian + intl OA journals) | 16 | OAI-PMH | No | Free | C | EASY | WARROOM_CYBERLENINKA_OAI_BASE | OPERATIONAL |
| 289 | DBLP | Schloss Dagstuhl — Leibniz-Zentrum für Informatik | DE | 16 | REST+BULK | No | Free | A | EASY | WARROOM_DBLP_API_URL | OPERATIONAL |
| 290 | DBpia | DBpia (Nurimedia) | South Korea | 16 (→25) | SEARCH INTERFACE | Account-gated | Paid | D | HARD | — | COMMERCIAL-GATED |
| 291 | Dialnet | Fundación Dialnet, Univ. de La Rioja | Spain/LatAm | 16 (→25) | SEARCH INTERFACE | No | Freemium | B | HARD | — | SEARCH-ONLY |
| 292 | DOAB OAI-PMH + feeds | DOAB Foundation (OAPEN + OpenEdition) | Netherlands/global | 16 (→25) | OAI-PMH+BULK | No | Free | B | EASY | WARROOM_DOAB_OAI | OPERATIONAL |
| 293 | EconStor | ZBW – Leibniz Information Centre for Economics | Germany (global economics deposits) | 16 | OAI-PMH | No | Free | A | EASY | WARROOM_ECONSTOR_OAI_BASE | OPERATIONAL |
| 294 | eLibrary.ru | Scientific Electronic Library | Russia | 16 (→25) | SEARCH INTERFACE | Account-gated | Paid | D | HARD | — | COMMERCIAL-GATED |
| 295 | HAL Search API | CCSD / CNRS | France (global deposits incl. international partners) | 16 | REST | No | Free | A | EASY | WARROOM_HAL_API_BASE | OPERATIONAL |
| 296 | HEPData | Durham University IPPP (with CERN) | UK | 16 | REST | No | Free | B | EASY | — | OPERATIONAL |
| 297 | IEEE Xplore API | IEEE | US (global) | 16 | REST | Yes | Freemium | A/D | EASY | WARROOM_IEEE_API_KEY | OPERATIONAL |
| 298 | INSPIRE | CERN-led HEP consortium (CERN, DESY, Fermilab, IHEP, IN2P3, SLAC) | International (HQ Switzerland) | 16 | REST+OAI-PMH | No | Free | A | EASY | WARROOM_INSPIRE_BASE | OPERATIONAL |
| 299 | J-STAGE WebAPI | Japan Science and Technology Agency (JST) | Japan | 16 | REST+FEED | No | Free-academic | A | EASY | WARROOM_JSTAGE_API_BASE | OPERATIONAL |
| 300 | LA Referencia (Red Federada de Repositorios) | LA Referencia network / RedCLARA | Latin America (10+ countries) | 16 (→25) | OAI-PMH | No | Free | B | MODERATE | WARROOM_LAREFERENCIA_OAI | OPERATIONAL |
| 301 | Latindex | UNAM | Mexico/Ibero-America | 16 (→25) | SEARCH INTERFACE | No | Free | B | — | — | SEARCH-ONLY |
| 302 | NASA ADS | NASA / Harvard-Smithsonian CfA | US | 16 | REST | Yes | Free | A | EASY | WARROOM_ADS_API_TOKEN | OPERATIONAL |
| 303 | NCPSSD / NSSD (国家哲学社会科学文献中心) | Chinese Academy of Social Sciences | China | 16 (→25) | SEARCH INTERFACE | No | Free | A | HARD | WARROOM_NCPSSD_ACCOUNT | SEARCH-ONLY |
| 304 | OAI-PMH IR ecosystem (DSpace / EPrints / OJS / Dataverse / Samvera) | thousands of institutions worldwide | global | 16 | OAI-PMH | No | Free | A | MODERATE | WARROOM_OAI_TARGETS | OPERATIONAL |
| 305 | OEIS | OEIS Foundation (founded N. Sloane) | US (global community) | 16 | REST | No | Free | E/C | EASY | — | OPERATIONAL |
| 306 | OpenAIRE Graph API | OpenAIRE AMKE (EU research infrastructure) | Greece/EU | 16 | REST | No | Free | B | EASY | WARROOM_OPENAIRE_API_BASE | OPERATIONAL |
| 307 | OpenCitations Index REST API | OpenCitations (University of Bologna) | Italy | 16 | REST+SPARQL | Optional | Free | B | EASY | WARROOM_OPENCITATIONS_TOKEN | OPERATIONAL |
| 308 | ORCID Public API | ORCID Inc. (nonprofit) | US, global | 16 (→01) | REST+BULK | No | Freemium | A | EASY | WARROOM_ORCID_API_URL | OPERATIONAL |
| 309 | Paperity | Paperity | global | 16 | SEARCH INTERFACE+FEED | No | Free-academic | C | MODERATE | — | SEARCH-ONLY |
| 310 | PDG API (Review of Particle Physics) | Particle Data Group / LBNL (DOE PuRe Data Resource; partners MEXT JP, INFN, CERN) | US-led international | 16 | REST+BULK | No | Free | A | EASY | — | OPERATIONAL |
| 311 | Redalyc Journal API | Redalyc–UAEMex (Universidad Autónoma del Estado de México) | Mexico | 16 | REST | Yes | Free | B | MODERATE | WARROOM_REDALYC_API_KEY | OPERATIONAL |
| 312 | RePEc API (IDEAS) | RePEc volunteer network / IDEAS (Federal Reserve Bank of St. Louis hosting) | Global (1,800+ participating archives) | 16 | REST | Yes | Free | C | EASY | WARROOM_REPEC_CODE | OPERATIONAL |
| 313 | Repositorio Digital CLACSO | Consejo Latinoamericano de Ciencias Sociales | Argentina/LatAm | 16 (→25) | OAI-PMH | No | Free | B | MODERATE | WARROOM_CLACSO_OAI | OPERATIONAL |
| 314 | RISS | KERIS | South Korea | 16 (→25) | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 315 | ROR (Research Organization Registry) | California Digital Library / Crossref / DataCite (community) | US, global | 16 (→01) | REST+BULK | No | Free | A | EASY | WARROOM_ROR_API_URL | OPERATIONAL |
| 316 | SciELO (Scientific Electronic Library Online) | SciELO Program / FAPESP + national nodes | Brazil HQ; 16 countries LatAm/Iberia/S.Africa | 16 | OAI-PMH | No | Free | A/B | MODERATE | WARROOM_SCIELO_OAI_BASES | OPERATIONAL |
| 317 | ScienceON (successor of NDSL; NDSL Open Service NOS legacy) | Korea Institute of Science and Technology Information (KISTI) | South Korea | 16 | REST | Yes | Free | A | HARD | WARROOM_KISTI_API_KEY | DEGRADED |
| 318 | Scopus | Elsevier | US/global | 16 | REST | Yes | Paid | D | MODERATE | — | COMMERCIAL-GATED |
| 319 | Shodhganga (Indian ETD repository) | INFLIBNET Centre, UGC India | India | 16 (→25) | OAI-PMH | No | Free | A | MODERATE | WARROOM_SHODHGANGA_OAI | OPERATIONAL |
| 320 | SSRN | Elsevier | US/global | 16 | SEARCH INTERFACE+FEED | No | Free | D | HARD | — | SEARCH-ONLY |
| 321 | Wanfang Data (万方数据) | Wanfang Data Co. | China | 16 (→25) | SEARCH INTERFACE | Account-gated | Paid | D | HARD | — | COMMERCIAL-GATED |
| 322 | Web of Science | Clarivate | US/global | 16 | REST | Yes | Paid | D | MODERATE | — | COMMERCIAL-GATED |
| 323 | zbMATH Open | FIZ Karlsruhe / European Mathematical Society | Germany | 16 | REST+OAI-PMH | No | Free | A/B | EASY | — | OPERATIONAL |
| 324 | CNIPA patent search (PSS / 专利检索) | China National Intellectual Property Administration | China | 17 | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 325 | EPO OPS | European Patent Office | EU/International | 17 | REST | Yes | Freemium | A | MODERATE | WARROOM_EPO_OPS_KEY | OPERATIONAL |
| 326 | Google Patents Public Datasets | Google | US (global corpus) | 17 | BULK | Account-gated | Freemium | D | MODERATE | WARROOM_GCP_CREDENTIALS | OPERATIONAL |
| 327 | INPI France (Data INPI / API diffusion) | Institut National de la Propriété Industrielle | France | 17 | REST+BULK | Optional | Free | A | EASY–MODERATE | none for open tier | OPERATIONAL |
| 328 | IP Australia APIs | IP Australia | Australia | 17 | REST+BULK | Yes | Free | A | EASY | WARROOM_IPAUSTRALIA_API_KEY | OPERATIONAL |
| 329 | J-PlatPat | Japan Patent Office (JPO) / INPIT | Japan | 17 | SEARCH INTERFACE | No | Free | A | HARD | — | SEARCH-ONLY |
| 330 | KIPRIS Plus Open API | Korean Intellectual Property Office (KIPO) / KIPI | South Korea | 17 | REST | Yes | Free-academic | A | MODERATE | WARROOM_KIPRIS_API_KEY | OPERATIONAL |
| 331 | PatentsView | USPTO Office of the Chief Economist | US | 17 | REST+BULK | Yes | Free | A | MODERATE | WARROOM_PATENTSVIEW_API_KEY | DEGRADED |
| 332 | The Lens APIs | Cambia / Queensland University of Technology | Australia | 17 (→16) | REST | Yes | Free-academic | C/D | EASY | WARROOM_LENS_API_TOKEN | OPERATIONAL |
| 333 | TMview (TMDN) | EUIPO (with national offices, USPTO, WIPO participation) | EU/Global | 17 | REST | No | Free | A | MODERATE | — | OPERATIONAL |
| 334 | USPTO ODP | US Patent & Trademark Office | US | 17 | REST+BULK | Yes | Free | A | MODERATE | WARROOM_USPTO_ODP_API_KEY | OPERATIONAL |
| 335 | USPTO TSDR API | USPTO | US | 17 | REST | Yes | Free | A | EASY | WARROOM_USPTO_TSDR_API_KEY | OPERATIONAL |
| 336 | WIPO PATENTSCOPE / PCT Data Services | World Intellectual Property Organization | UN/International | 17 | SOAP+BULK+SEARCH INTERFACE | No | Freemium | A | HARD | WARROOM_WIPO_PCT_SFTP_ | OPERATIONAL |
| 337 | Copernicus Data Space Ecosystem (CDSE) | European Commission / ESA (operated by T-Systems/CloudFerro) | EU | 18 | OData+STAC | No | Free | A | MODERATE | WARROOM_CDSE_USER | OPERATIONAL |
| 338 | GADM database of Global Administrative Areas | GADM project (UC Berkeley origin; now gadm.org) | global | 18 | BULK | No | Free | B | EASY | WARROOM_GADM_DIR | OPERATIONAL |
| 339 | GEBCO Bathymetry | GEBCO (IOC UNESCO / IHO; hosted BODC UK) | UK/global | 18 | BULK | No | Free | A | EASY | WARROOM_GEBCO_URL | OPERATIONAL |
| 340 | GeoNames | GeoNames Association (commercial support: Unxos GmbH) | Switzerland | 18 | REST+BULK | Yes | Freemium | C | EASY | WARROOM_GEONAMES_USERNAME | OPERATIONAL |
| 341 | INPE | Instituto Nacional de Pesquisas Espaciais (INPE) | Brazil | 18 | REST+STAC | No | Free | A | EASY–MODERATE | WARROOM_INPE_STAC_URL | OPERATIONAL |
| 342 | ISRO Bhuvan | Indian Space Research Organisation (NRSC) | India | 18 | BULK | No | Free | A | MODERATE | WARROOM_BHUVAN_WMS_URL | OPERATIONAL |
| 343 | JAXA G-Portal | Japan Aerospace Exploration Agency | Japan | 18 | BULK+SEARCH INTERFACE | No | Free-academic | A | HARD | WARROOM_JAXA_GPORTAL_USER | OPERATIONAL |
| 344 | Mapillary (street-level imagery) | Meta (Facebook) | USA/global | 18 | REST | Yes | Free | D | MODERATE | WARROOM_MAPILLARY_TOKEN | OPERATIONAL |
| 345 | NASA Earthdata | NASA EOSDIS | USA | 18 | REST+STAC | No | Free | A | MODERATE | WARROOM_EARTHDATA_TOKEN | OPERATIONAL |
| 346 | National mapping agency OGC services (grouped) | (a) Swisstopo geo.admin.ch API3 (Switzerland); (b) LINZ Data Service (New Zealand); (c) Kadaster PDOK (Netherlands); (d) Geoscience Australia | CH / NZ / NL / AU | 18 | REST | Optional | Free | A | EASY–MODERATE | WARROOM_LINZ_API_KEY | OPERATIONAL |
| 347 | Natural Earth | Natural Earth project (volunteer; backed by NACIS) | USA/global | 18 | BULK | No | Free | C | EASY | WARROOM_NATURALEARTH_URL | OPERATIONAL |
| 348 | Nominatim (OSM Geocoding) | OpenStreetMap Foundation | UK/global | 18 | REST | No | Free | E | EASY | WARROOM_NOMINATIM_URL | OPERATIONAL |
| 349 | OpenStreetMap Overpass API | OpenStreetMap Foundation (Overpass dev: FOSSGIS) | Germany/global | 18 | REST | No | Free | E | MODERATE | WARROOM_OSM_OVERPASS_URL | OPERATIONAL |
| 350 | OpenTopography API | OpenTopography (UC San Diego / SDSU / UNAVCO; NSF-funded) | USA | 18 | REST | Yes | Free | B | EASY | WARROOM_OPENTOPO_API_KEY | OPERATIONAL |
| 351 | OSM Planet Dumps + Geofabrik Extracts | OpenStreetMap Foundation / Geofabrik GmbH | Germany | 18 | BULK | No | Free | E | MODERATE | WARROOM_OSM_PLANET_URL | OPERATIONAL |
| 352 | Overture Maps Foundation (incl. GERS) | Overture Maps Foundation (Linux Foundation; members: AWS, Meta, Microsoft, TomTom, Esri) | USA/global | 18 | STAC+BULK | No | Free | C | MODERATE | WARROOM_OVERTURE_S3_BUCKET | OPERATIONAL |
| 353 | USGS EarthExplorer Machine-to-Machine (M2M) API + Landsat on AWS | U.S. Geological Survey (EROS) | USA | 18 | REST | Yes | Free | A | MODERATE | WARROOM_USGS_M2M_USER | OPERATIONAL |
| 354 | CDS | Centre de Données astronomiques de Strasbourg (CNRS/Univ. Strasbourg) | France | 19 | REST+TAP | No | Free | B | MODERATE | WARROOM_SIMBAD_TAP_URL | OPERATIONAL |
| 355 | CelesTrak GP/TLE data | CelesTrak (Dr. T.S. Kelso; redistributes US Space Force 18 SDS data) | USA | 19 | REST | No | Free | B | EASY | WARROOM_CELESTRAK_URL | OPERATIONAL |
| 356 | ESA DISCOSweb API | European Space Agency — Space Debris Office (ESOC) | Germany/EU | 19 | REST | Yes | Free | A | EASY | WARROOM_DISCOS_TOKEN | OPERATIONAL |
| 357 | ESA Gaia Archive (TAP+) | European Space Agency / ESAC | Spain/EU | 19 | TAP | No | Free | A | MODERATE | WARROOM_GAIA_TAP_URL | OPERATIONAL |
| 358 | IAU Minor Planet Center APIs | Minor Planet Center (IAU; SAO/CfA, Cambridge MA) | USA | 19 | REST | No | Free | A | EASY | WARROOM_MPC_API_URL | OPERATIONAL |
| 359 | JPL Horizons API | NASA/JPL Solar System Dynamics | USA | 19 | REST | Optional | Free | A | MODERATE | WARROOM_NASA_API_KEY | OPERATIONAL |
| 360 | JPL Small-Body Database (SBDB) API | NASA/JPL SSD | USA | 19 | REST | Optional | Free | A | EASY | WARROOM_NASA_API_KEY | OPERATIONAL |
| 361 | MAST | Space Telescope Science Institute (NASA contract) | USA | 19 | REST+BULK | Optional | Free | A | MODERATE | WARROOM_MAST_API_TOKEN | OPERATIONAL |
| 362 | N2YO Satellite Tracking API | N2YO.com | USA | 19 | REST | Yes | Free | C/D | EASY | WARROOM_N2YO_API_KEY | OPERATIONAL |
| 363 | NASA Exoplanet Archive (TAP) | NASA Exoplanet Science Institute (NExScI), Caltech/IPAC | USA | 19 | TAP | No | Free | A | EASY–MODERATE | WARROOM_EXOPLANET_TAP_URL | OPERATIONAL |
| 364 | NASA Open APIs (api.nasa.gov) | NASA (open data program) | USA | 19 | REST | Yes | Free | A | EASY | WARROOM_NASA_API_KEY | OPERATIONAL |
| 365 | NOAA Space Weather Prediction Center (SWPC) JSON services | NOAA SWPC | USA | 19 | REST | No | Free | A | EASY | WARROOM_SWPC_URL | OPERATIONAL |
| 366 | SatNOGS API | SatNOGS / Libre Space Foundation | Greece/global | 19 (→25) | REST | No | Free | E | EASY | WARROOM_SATNOGS_API_BASE | OPERATIONAL |
| 367 | SDSS SkyServer / SciServer CasJobs | Sloan Digital Sky Survey (SDSS-V consortium; JHU hosting) | USA | 19 | REST | Yes | Free | B | MODERATE | WARROOM_SDSS_SCISERVER_TOKEN | OPERATIONAL |
| 368 | Space-Track.org | U.S. Space Force 18th Space Defense Squadron (space-track.org) | USA | 19 | REST | No | Free | A | MODERATE | WARROOM_SPACETRACK_USER | OPERATIONAL |
| 369 | AFLOW / AFLOWLIB | Duke University (Curtarolo group) | US | 20 | REST | No | Free | B | EASY–MODERATE | — | OPERATIONAL |
| 370 | Cambridge Structural Database / CSD Python API | Cambridge Crystallographic Data Centre | UK | 20 | REST | Account-gated | Free-academic | A/B | HARD | — | OPERATIONAL |
| 371 | CODATA/NIST Fundamental Constants | NIST Physics Laboratory / CODATA TGFC | US (international adjustment) | 20 | BULK | No | Free | A | EASY | — | OPERATIONAL |
| 372 | ETSI standards | European Telecommunications Standards Institute | France/EU (global 3GPP relevance) | 20 | BULK+SEARCH INTERFACE | No | Free | A | MODERATE | — | OPERATIONAL |
| 373 | ISO/IEC/ASTM/DIN/JIS/GB national standards bodies | ISO / IEC / ASTM / DIN / JIS / SAMR | global | 20 | SEARCH INTERFACE | Account-gated | Paid | — | HARD | — | SEARCH-ONLY |
| 374 | ITU-T Recommendations | International Telecommunication Union (UN agency) | Switzerland (UN) | 20 | BULK+SEARCH INTERFACE | No | Freemium | A | MODERATE | — | OPERATIONAL |
| 375 | JARVIS | NIST (Materials Measurement Laboratory) | US | 20 | REST+BULK | No | Free | A | MODERATE | — | OPERATIONAL |
| 376 | Materials Project | Lawrence Berkeley National Laboratory (DOE) | US | 20 | REST | Yes | Free-academic | A | EASY | WARROOM_MP_API_KEY | OPERATIONAL |
| 377 | MatNavi (AtomWork, SuperCon, PolyInfo, etc.) | National Institute for Materials Science (NIMS) | Japan | 20 | SEARCH INTERFACE | No | Freemium | A | HARD | — | SEARCH-ONLY |
| 378 | MPDS / PAULING FILE online | Tilde Materials Informatics (Moscow; built on Pauling File) | Russia | 20 | REST | Yes | Freemium | D | MODERATE | WARROOM_MPDS_API_KEY | OPERATIONAL |
| 379 | NIST Chemistry WebBook (+ SRD 69, Web Thermo Tables etc.) | NIST | US | 20 | SEARCH INTERFACE | No | Freemium | A | HARD | — | SEARCH-ONLY |
| 380 | NOMAD | NOMAD Laboratory CoE / FAIRmat (MPCDF-hosted) | Germany/EU | 20 | REST | No | Free | B | MODERATE | WARROOM_NOMAD_BASE | OPERATIONAL |
| 381 | OQMD | Northwestern University (Wolverton group) | US | 20 | REST | No | Free | B | EASY | — | OPERATIONAL |
| 382 | Aozora Bunko catalog CSV + text zips | Aozora Bunko volunteers (Japan) | Japan | 21 (→25) | BULK | No | Free | E | MODERATE | WARROOM_AOZORA_CATALOG | OPERATIONAL |
| 383 | Archive of the Indigenous Languages of Latin America | Univ. of Texas at Austin | US/LatAm | 21 (→25) | OAI-PMH | No | Free | B | MODERATE | WARROOM_AILLA_BASE | OPERATIONAL |
| 384 | Archives nationales de France (SIV) | Archives nationales | France | 21 | SEARCH INTERFACE+BULK | No | Free | A | — | — | SEARCH-ONLY |
| 385 | Archivportal-D | Deutsche Digitale Bibliothek (Landesarchiv Baden-Württemberg lead) | Germany | 21 | REST+OAI-PMH | Yes | Free | A | MODERATE | WARROOM_DDB_API_KEY | OPERATIONAL |
| 386 | ArtIC Data API | Art Institute of Chicago | USA | 21 | REST+IIIF | No | Free | A | EASY | WARROOM_ARTIC_API_BASE | OPERATIONAL |
| 387 | AtoM (Access to Memory) REST API + OAI-PMH | Artefactual Systems; deployed by 400+ archives (ICA-AtoM; e.g. national/university archives in Canada, Spain, LatAm, NL) | global deployments | 21 | REST+OAI-PMH | Yes | Free | E | MODERATE | WARROOM_ATOM_INSTANCES | OPERATIONAL |
| 388 | Biblioteca Nacional de México (HNDM) | Biblioteca Nacional de México | Mexico | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 389 | Biblioteca Nacional de Portugal | Biblioteca Nacional de Portugal | Portugal | 21 | OAI-PMH+SRU | No | Free | A | MODERATE–HARD | — | DEGRADED |
| 390 | Biblioteca Nacional do Brasil (BN Digital) | Biblioteca Nacional do Brasil | Brazil | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 391 | Biblioteca Nacional Mariano Moreno | Biblioteca Nacional Mariano Moreno | Argentina | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 392 | Bibliotheca Alexandrina | Bibliotheca Alexandrina | Egypt | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 393 | Brooklyn Museum API | Brooklyn Museum | US | 21 | REST | Yes | Free | A | EASY–MODERATE | — | STATIC |
| 394 | CMA Open Access API | Cleveland Museum of Art | USA | 21 | REST | No | Free | A | EASY | WARROOM_CMA_API_BASE | OPERATIONAL |
| 395 | ColBase | National Institutes for Cultural Heritage (NICH) | Japan | 21 | SEARCH INTERFACE | No | Free | A | MODERATE | WARROOM_JPSEARCH_API_BASE | OPERATIONAL |
| 396 | Cooper Hewitt API | Cooper Hewitt, Smithsonian Design Museum | USA | 21 | REST | Yes | Free | A | EASY | WARROOM_COOPERHEWITT_TOKEN | OPERATIONAL |
| 397 | CulturaItalia LOD + Internet Culturale OAI | Istituto Centrale per il Catalogo Unico (ICCU), MiC | Italy | 21 | SPARQL+OAI-PMH | No | Free | A | MODERATE–HARD | WARROOM_CULTURAITALIA_SPARQL | OPERATIONAL |
| 398 | datos.bne.es SPARQL + dumps | Biblioteca Nacional de España | Spain | 21 | SPARQL+BULK | No | Free | A | MODERATE | WARROOM_BNE_SPARQL_BASE | OPERATIONAL |
| 399 | DDB API | Deutsche Digitale Bibliothek (FIZ Karlsruhe operation) | Germany | 21 | REST+OAI-PMH | Yes | Free | A | EASY | WARROOM_DDB_API_KEY | OPERATIONAL |
| 400 | Delpher + KB datasets APIs | KB, National Library of the Netherlands | Netherlands | 21 | OAI-PMH+BULK | Account-gated | Free | A | MODERATE | WARROOM_KBNL_ACCESS | OPERATIONAL |
| 401 | DigitalNZ API v3 | DigitalNZ / National Library of New Zealand | New Zealand | 21 | REST | Optional | Free | A | EASY | WARROOM_DIGITALNZ_API_KEY | OPERATIONAL |
| 402 | e-Museum (Japan) | e-Museum (Nara Nat. Museum et al.) | Japan | 21 (→25) | SEARCH INTERFACE | No | Free | — | — | — | SEARCH-ONLY |
| 403 | Finna REST API | National Library of Finland / Finna.fi | Finland | 21 | REST | No | Free | A | EASY | WARROOM_FINNA_API_BASE | OPERATIONAL |
| 404 | FNG Collections API | Finnish National Gallery (Ateneum, Kiasma, Sinebrychoff) | Finland | 21 | REST | Yes | Free | A | EASY | WARROOM_FNG_API_KEY | OPERATIONAL |
| 405 | Google Arts & Culture | Google | US/global | 21 | SEARCH INTERFACE | No | Free | D | — | — | SEARCH-ONLY |
| 406 | Harvard Art Museums API | Harvard Art Museums | USA | 21 | REST+IIIF | Yes | Free | A | EASY | WARROOM_HARVARD_ART_API_KEY | OPERATIONAL |
| 407 | Hungaricana | Hungaricana (National Széchényi Library) | Hungary | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 408 | JACAR (Japan Center for Asian Historical Records) | National Archives of Japan + MOFA Diplomatic Archives + NIDS | Japan | 21 | SEARCH INTERFACE | No | Free | A | HARD | — | OPERATIONAL |
| 409 | Japan Search Web API + SPARQL | National Diet Library / Government of Japan cross-domain portal | Japan | 21 | REST+SPARQL | No | Free | A | EASY | WARROOM_JPSEARCH_API_BASE | OPERATIONAL |
| 410 | JSTOR (+ former Artstor images) | ITHAKA | USA (global) | 21 | SEARCH INTERFACE | No | Paid | B | HARD | — | DISCONTINUED |
| 411 | LIBRIS XL public APIs | Kungliga biblioteket (National Library of Sweden) | Sweden | 21 | REST+SPARQL+OAI-PMH+BULK | No | Free | A | MODERATE | WARROOM_LIBRIS_API_BASE | OPERATIONAL |
| 412 | LibriVox API | LibriVox (volunteer nonprofit) | US/global | 21 (→25) | REST | No | Free | C | EASY | WARROOM_LIBRIVOX_API_BASE | OPERATIONAL |
| 413 | lobid-gnd / lobid-resources | Deutsche Nationalbibliothek (DNB) + hbz | DE | 21 (→01) | REST+BULK | No | Free | A | EASY | WARROOM_LOBID_GND_URL | OPERATIONAL |
| 414 | Millî Kütüphane (National Library of Türkiye) | Millî Kütüphane | Türkiye | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 415 | Nasjonalmuseet API v1 | National Museum of Norway | Norway | 21 | REST | No | Free | A | EASY | WARROOM_NASJONALMUSEET_API_BASE | OPERATIONAL |
| 416 | National Archives Catalog API v2 | U.S. National Archives and Records Administration | USA | 21 | REST | Yes | Free | A | EASY | WARROOM_NARA_API_KEY | OPERATIONAL |
| 417 | National Library of China (NLC) | National Library of China | China | 21 | SEARCH INTERFACE+IIIF | No | Free | A | — | — | SEARCH-ONLY |
| 418 | National Library of Korea (NLK) | National Library of Korea | South Korea | 21 | SEARCH INTERFACE+BULK | No | Free | A | — | — | SEARCH-ONLY |
| 419 | NB Catalog API (api.nb.no) + DH-lab APIs | National Library of Norway | Norway | 21 | REST | No | Free | A | EASY | WARROOM_NBNO_API_BASE | OPERATIONAL |
| 420 | NDL Digital Collections IIIF | National Diet Library | Japan | 21 | IIIF | No | Free | A | EASY | WARROOM_NDL_IIIF_BASE | OPERATIONAL |
| 421 | NDL Search Web API | National Diet Library (NDL) | Japan | 21 | OAI-PMH | No | Free-academic | A | MODERATE | WARROOM_NDLSEARCH_BASE | OPERATIONAL |
| 422 | NG API | The National Gallery, London | UK | 21 | REST | No | Free | A | EASY | WARROOM_NGLONDON_API_BASE | OPERATIONAL |
| 423 | Národní knihovna ČR (NKP, Czechia) | National Library of the Czech Republic | Czechia | 21 | OAI-PMH+REST | No | Free | A | MODERATE | — | OPERATIONAL |
| 424 | OLAC aggregator | OLAC/DELAMAN community | US/global | 21 (→25) | OAI-PMH+BULK+SEARCH INTERFACE | No | Free | C | MODERATE | WARROOM_OLAC_BASE | DEGRADED |
| 425 | Open Library | Internet Archive | US, global | 21 (→01) | REST+BULK | No | Free | C | EASY | WARROOM_OPENLIBRARY_API_URL | OPERATIONAL |
| 426 | Pangloss / CoCoon | LACITO-CNRS + Huma-Num | France/global | 21 (→25) | OAI-PMH+BULK | No | Free | B | MODERATE | WARROOM_PANGLOSS_BASE | OPERATIONAL |
| 427 | PARADISEC catalog + OAI | Univ. Melbourne/Sydney/ANU | Australia | 21 (→25) | OAI-PMH | No | Free | B | MODERATE | WARROOM_PARADISEC_OAI | OPERATIONAL |
| 428 | Paris Musées API | Paris Musées (City of Paris museums: Carnavalet, Petit Palais, etc.) | France | 21 | GraphQL | Yes | Free | A | MODERATE | WARROOM_PARISMUSEES_TOKEN | OPERATIONAL |
| 429 | PG catalog feeds + Gutendex API | Project Gutenberg; Gutendex community API | US/global | 21 (→25) | REST+BULK | No | Free | C | EASY | WARROOM_GUTENDEX_API_BASE | OPERATIONAL |
| 430 | Polona / Polona2 API | Biblioteka Narodowa (National Library of Poland) | Poland | 21 | REST+IIIF | No | Free | A | HARD | WARROOM_POLONA_IIIF_BASE | DEGRADED |
| 431 | RecordSearch | National Archives of Australia | Australia | 21 | SEARCH INTERFACE | No | Free | A | HARD | — | DISCONTINUED |
| 432 | Russian State Library (RSL) / RUNEB | Russian State Library | Russia | 21 | SEARCH INTERFACE | No | Free | A | — | — | SEARCH-ONLY |
| 433 | Shamela library | shamela.ws community | Arabic world | 21 (→25) | REST+BULK | Optional | Free | E | MODERATE | WARROOM_SHAMELA_API_KEY | OPERATIONAL |
| 434 | SMK Open API | Statens Museum for Kunst | Denmark | 21 | REST+IIIF | No | Free | A | EASY | WARROOM_SMK_API_BASE | OPERATIONAL |
| 435 | Standard Ebooks OPDS feeds | Standard Ebooks (volunteer nonprofit) | US | 21 (→25) | FEED | No | Free | E | EASY | WARROOM_STANDARDEBOOKS_OPDS | OPERATIONAL |
| 436 | Swissbib / swisscovery | Swissbib / swisscovery (SLSP) | Switzerland | 21 | SRU | Account-gated | Free | A | HARD | — | DEGRADED |
| 437 | Te Papa Collections API | Museum of New Zealand Te Papa Tongarewa | New Zealand | 21 | REST | Yes | Free | A | EASY | WARROOM_TEPAPA_API_KEY | OPERATIONAL |
| 438 | Trove API v3 | National Library of Australia | Australia | 21 | REST | Yes | Free | A | EASY | WARROOM_TROVE_API_KEY | OPERATIONAL |
| 439 | V&A Collections API v2 | Victoria and Albert Museum | UK | 21 | REST+IIIF | No | Free | A | EASY | WARROOM_VAM_API_BASE | OPERATIONAL |
| 440 | VIAF (Virtual International Authority File) | OCLC (on behalf of VIAF Council of national libraries) | US, global (50+ national libraries incl. NDL Japan, BnF, DNB, NLA, LC) | 21 (→01) | REST+BULK | No | Free | A | EASY | WARROOM_VIAF_API_URL | OPERATIONAL |
| 441 | Walters Art Museum | Walters Art Museum | US | 21 | SEARCH INTERFACE+BULK | No | Free | A | MODERATE | — | SEARCH-ONLY |
| 442 | Wellcome Collection Catalogue API | Wellcome Trust | UK (global health/culture) | 21 (→08) | REST+IIIF | No | Free | A/B | EASY | WARROOM_WELLCOME_API_BASE | OPERATIONAL |
| 443 | ANNO IIIF + ÖNB Labs LOD | Austrian National Library (ÖNB) | Austria (imperial Habsburg press, multilingual) | 22 (→13) | IIIF | No | Free | A | MODERATE | WARROOM_ONB_IIIF | OPERATIONAL |
| 444 | e-periodica IIIF | ETH Library Zürich (+ Swiss National Library content) | Switzerland (Swiss journals, multilingual DE/FR/IT/EN) | 22 (→13) | IIIF+BULK | No | Free | A | EASY | WARROOM_EPERIODICA_IIIF | OPERATIONAL |
| 445 | impresso Public API | EPFL (DHLAB) + University of Luxembourg (C2DH) + SNSF | Switzerland/Luxembourg (growing intl. newspaper corpus) | 22 (→13) | REST | Yes | Free-academic | B | MODERATE | WARROOM_IMPRESSO_API_TOKEN | OPERATIONAL |
| 446 | ABS Data API | Australian Bureau of Statistics | Australia | 23 | REST+SDMX | No | Free | A | MODERATE | WARROOM_ABS_SDMX_BASE | OPERATIONAL |
| 447 | Aotearoa Data Explorer (nzdotstat) SDMX API | Stats NZ Tatauranga Aotearoa | New Zealand | 23 | REST+SDMX | No | Free | A | MODERATE | WARROOM_STATSNZ_SDMX_BASE | OPERATIONAL |
| 448 | API de Series de Tiempo | Secretaría de Innovación Pública (incl. INDEC series) | Argentina | 23 | REST | No | Free | A | EASY | WARROOM_ARG_SERIES_API_BASE | OPERATIONAL |
| 449 | BDL API (Local Data Bank) | GUS (Statistics Poland) | Poland | 23 | REST | Optional | Free | A | EASY | WARROOM_GUS_BDL_CLIENT_ID | OPERATIONAL |
| 450 | BPS WebAPI | Badan Pusat Statistik | Indonesia | 23 | REST | Yes | Free | A | EASY | WARROOM_BPS_API_KEY | OPERATIONAL |
| 451 | CBS Statistical Series API + Price Indices API | Israel Central Bureau of Statistics | Israel | 23 | REST | No | Free | A | MODERATE | WARROOM_ISRAEL_CBS_API_BASE | OPERATIONAL |
| 452 | CBS StatLine Open Data | Centraal Bureau voor de Statistiek | Netherlands | 23 | OData+FEED | No | Free | A | EASY | WARROOM_CBS_NL_ODATA_BASE | OPERATIONAL |
| 453 | Census Data API (+ Census Microdata API) | US Census Bureau | USA | 23 | REST | Yes | Free | A | EASY | WARROOM_CENSUS_API_KEY | OPERATIONAL |
| 454 | CZSO VDB Open Data Catalogue API | Český statistický úřad | Czechia | 23 | REST+CKAN | No | Free | A | EASY | WARROOM_CZSO_CKAN_BASE | OPERATIONAL |
| 455 | data.gov.my Data Catalogue API | DOSM + Malaysian gov (data.gov.my team) | Malaysia | 23 | REST | No | Free | A | EASY | WARROOM_DATAGOVMY_API_BASE | OPERATIONAL |
| 456 | Datos Abiertos Colombia API | MinTIC + DANE (publisher) | Colombia | 23 | REST | Optional | Free | A | EASY | WARROOM_DATOSGOVCO_APP_TOKEN | OPERATIONAL |
| 457 | e-Stat API v3 | Statistics Bureau of Japan (MIC) | Japan | 23 | REST | Yes | Free | A | EASY | WARROOM_ESTAT_APP_ID | OPERATIONAL |
| 458 | EIA API v2 | US Energy Information Administration | USA | 23 | REST | Yes | Free | A | EASY | WARROOM_EIA_API_KEY | OPERATIONAL |
| 459 | EMISS Open Data API (fedstat) | Rosstat (Federal State Statistics Service) | Russia | 23 | REST | Yes | Free | A | HARD | WARROOM_ROSSTAT_API_KEY | DEGRADED |
| 460 | Gapminder Datasets | Gapminder Foundation | Sweden | 23 | BULK+REPO | No | Free | C | EASY | WARROOM_GAPMINDER_DIR | OPERATIONAL |
| 461 | GENESIS Web Service | Statistisches Bundesamt (Destatis) | Germany | 23 | REST | No | Free | A | MODERATE | WARROOM_GENESIS_USER | OPERATIONAL |
| 462 | India: eSankhyiki + OGD data.gov.in | NIC/MeitY | India | 23 (→14) | REST | Yes | Free | A | MODERATE | WARROOM_DATA_GOV_IN_API_KEY | OPERATIONAL |
| 463 | INE Tempus3 Web Service | Instituto Nacional de Estadística | Spain | 23 | REST | No | Free | A | EASY | WARROOM_INE_ES_API_BASE | OPERATIONAL |
| 464 | INEGI Indicadores API + DENUE API | INEGI | Mexico | 23 | REST | Yes | Free | A | EASY | WARROOM_INEGI_TOKEN | OPERATIONAL |
| 465 | INSEE BDM (Banque de Données Macroéconomiques) API | INSEE | France | 23 | REST+SDMX | Yes | Free | A | MODERATE | WARROOM_INSEE_CLIENT_ID | OPERATIONAL |
| 466 | IstatData SDMX WS | Istat (Istituto Nazionale di Statistica) | Italy | 23 | REST+SDMX | No | Free | A | EASY | WARROOM_ISTAT_SDMX_BASE | OPERATIONAL |
| 467 | KOSIS OpenAPI | Statistics Korea (KOSTAT) | South Korea | 23 | REST | Yes | Free | A | EASY | WARROOM_KOSIS_API_KEY | OPERATIONAL |
| 468 | NBS National Data portal | National Bureau of Statistics of China | China | 23 | REST | No | Free | A | HARD | n/a (no credentials) | DEGRADED |
| 469 | Nomis API | Nomis (Durham University, on behalf of ONS) | UK | 23 | REST+SDMX | Optional | Free | A/B | EASY | WARROOM_NOMIS_API_BASE | OPERATIONAL |
| 470 | ONS API (beta website API) | Office for National Statistics | UK | 23 | REST | No | Free | A | EASY | WARROOM_ONS_API_BASE | OPERATIONAL |
| 471 | OpenSTAT API | Philippine Statistics Authority | Philippines | 23 | REST+PXWEB | No | Free | A | EASY | WARROOM_PSA_API_BASE | OPERATIONAL |
| 472 | Saudi Open Data Platform API (GASTAT datasets) | SDAIA (platform) + GASTAT | Saudi Arabia | 23 | REST+CKAN | No | Free | A | MODERATE | WARROOM_SAUDI_OPENDATA_BASE | OPERATIONAL |
| 473 | SCB Statistical Database API | Statistiska centralbyrån | Sweden | 23 | REST+PXWEB | No | Free | A | EASY | WARROOM_SCB_API_BASE | OPERATIONAL |
| 474 | SIDRA API (Agregados) | IBGE | Brazil | 23 | REST | No | Free | A | EASY | WARROOM_IBGE_SIDRA_BASE | OPERATIONAL |
| 475 | SingStat Table Builder API | Department of Statistics Singapore | Singapore | 23 | REST | No | Free | A | EASY | WARROOM_SINGSTAT_API_BASE | OPERATIONAL |
| 476 | SSB API (PxWeb) | Statistisk sentralbyrå | Norway | 23 | REST+PXWEB | No | Free | A | EASY | WARROOM_SSB_API_BASE | OPERATIONAL |
| 477 | StatBank Denmark API | Danmarks Statistik | Denmark | 23 | REST | No | Free | A | EASY | WARROOM_DST_API_BASE | OPERATIONAL |
| 478 | StatCan WDS | Statistics Canada | Canada | 23 | REST+BULK | No | Free | A | MODERATE | WARROOM_STATCAN_WDS_BASE | OPERATIONAL |
| 479 | StatFin PxWeb API | Statistics Finland | Finland | 23 | REST+SDMX+PXWEB | No | Free | A | EASY | WARROOM_STATFIN_API_BASE | OPERATIONAL |
| 480 | Taiwan DGBAS National Statistics | DGBAS | Taiwan | 23 | SEARCH INTERFACE+CKAN | No | Free | A | MODERATE | WARROOM_TAIWAN_DATAGOV_BASE | SEARCH-ONLY |
| 481 | Thailand NSO (statbbi) | National Statistical Office | Thailand | 23 | SEARCH INTERFACE+BULK | No | Free | A | MODERATE | — | SEARCH-ONLY |
| 482 | TurkStat Data Portal | Turkish Statistical Institute | Türkiye | 23 | BULK+SEARCH INTERFACE | No | Free | A | HARD | — | OPERATIONAL |
| 483 | Vietnam GSO PX-Web | General Statistics Office | Vietnam | 23 | PXWEB+BULK | No | Free | A | MODERATE | — | SEARCH-ONLY |
| 484 | WIPO IP Statistics Data Center | WIPO | global | 23 (→17) | SEARCH INTERFACE+BULK | Account-gated | Paid | A | HARD | — | SEARCH-ONLY |
| 485 | ADB KIDB SDMX API v4 | Asian Development Bank | Philippines/Asia-Pacific | 24 | REST+SDMX | No | Free | A | MODERATE | WARROOM_ADB_SDMX_BASE | OPERATIONAL |
| 486 | AidData Datasets | AidData (William & Mary) | USA | 24 | BULK | No | Free | B | EASY | WARROOM_AIDDATA_DIR | OPERATIONAL |
| 487 | CEPALSTAT API | ECLAC (UN CEPAL) | Chile/Latin America & Caribbean | 24 | REST | Optional | Free | A | MODERATE | WARROOM_CEPALSTAT_API_BASE | OPERATIONAL |
| 488 | DTM API | International Organization for Migration | UN-related org/Switzerland | 24 | REST | Yes | Free | A | MODERATE | WARROOM_IOM_DTM_API_KEY | OPERATIONAL |
| 489 | Eurostat Database API | Eurostat (European Commission) | EU | 24 | REST+SDMX | No | Free | A | EASY | WARROOM_EUROSTAT_API_BASE | OPERATIONAL |
| 490 | FTS API | UN OCHA FTS | UN/global | 24 | REST | No | Free | A | EASY | WARROOM_OCHA_FTS_API_BASE | OPERATIONAL |
| 491 | IATI Datastore API | International Aid Transparency Initiative | UK/intl | 24 | REST | Yes | Free | B | MODERATE | WARROOM_IATI_SUBSCRIPTION_KEY | OPERATIONAL |
| 492 | IDB Open Data / Numbers for Development | Inter-American Development Bank | USA/Latin America & Caribbean | 24 | REST | Optional | Free | A | EASY | WARROOM_IDB_SOCRATA_TOKEN | OPERATIONAL |
| 493 | IEA API | International Energy Agency | France/intl | 24 | REST | Yes | Freemium | A | HARD | WARROOM_IEA_API_TOKEN | OPERATIONAL |
| 494 | ITU DataHub | ITU (UN) | global | 24 | SEARCH INTERFACE+BULK | No | Free | A | MODERATE | — | SEARCH-ONLY |
| 495 | OECD Data API | OECD | France/intl | 24 | REST+SDMX | No | Free | A | MODERATE | WARROOM_OECD_SDMX_BASE | OPERATIONAL |
| 496 | ReliefWeb API | UN OCHA | UN/global | 24 | REST | No | Free | A | EASY | WARROOM_RELIEFWEB_APPNAME | OPERATIONAL |
| 497 | UIS Data API | UNESCO Institute for Statistics | Canada/UN | 24 | REST | No | Free | A | EASY | WARROOM_UIS_API_BASE | OPERATIONAL |
| 498 | UN Data Portal API (WPP) | UN DESA Population Division | UN | 24 | REST | No | Free | A | EASY | WARROOM_UN_DESA_API_BASE | OPERATIONAL |
| 499 | UN SDG API | UN Statistics Division (UNSD) | UN | 24 | REST | No | Free | A | EASY | WARROOM_UN_SDG_API_BASE | OPERATIONAL |
| 500 | UNdata | UN Statistics Division | UN | 24 | REST+SDMX+SOAP+BULK | No | Free | A | MODERATE | WARROOM_UNDATA_BASE | DEGRADED |
| 501 | UNHCR Population Statistics API | UNHCR | UN/Switzerland | 24 | REST | No | Free | A | EASY | WARROOM_UNHCR_API_BASE | OPERATIONAL |
| 502 | UNIDO Statistics Data Portal | UNIDO (UN) | global | 24 | SEARCH INTERFACE | Account-gated | Paid | A | MODERATE | — | COMMERCIAL-GATED |
| 503 | WTO Timeseries API | World Trade Organization | Switzerland/intl | 24 (→15) | REST | Yes | Free | A | EASY | WARROOM_WTO_API_KEY | OPERATIONAL |
| 504 | CBDB API | Harvard Univ / Academia Sinica / Peking Univ | US–China–Taiwan | 25 | REST | No | Free | B | EASY | WARROOM_CBDB_API_BASE | OPERATIONAL |
| 505 | Find a Grave | Ancestry.com | US/global | 25 | SEARCH INTERFACE | No | — | D | HARD | — | SEARCH-ONLY |
| 506 | Local Contexts Hub API v2 | Local Contexts (Indigenous data sovereignty nonprofit) | US (global communities) | 25 | REST | Yes | Free | C | EASY | WARROOM_LOCALCONTEXTS_API_KEY | OPERATIONAL |
| 507 | OpenFlights | OpenFlights (community) | global | 25 | BULK | No | — | E | EASY | — | DEGRADED |
| 508 | OpenSky Network REST API | OpenSky Network association (research, Switzerland-based) | Switzerland/global | 25 | REST | Account-gated | Free-academic | C | EASY | WARROOM_OPENSKY_CLIENT_ID | OPERATIONAL |
| 509 | OurAirports open data | OurAirports (community) | Canada/global | 25 | BULK | No | Free | E | EASY | WARROOM_OURAIRPORTS_CSV | OPERATIONAL |


---

## REGISTRY SUMMARY

**Total unique sources:** 509


### Count per category

| Category | Name | Count |
|---|---|---|
| 01 | General web | 30 |
| 02 | Software/coding | 24 |
| 03 | Bugs/patches | 13 |
| 04 | Cybersecurity | 26 |
| 05 | Anatomy/terminologies | 8 |
| 06 | Diseases/clinical | 13 |
| 07 | Pharmaceuticals | 16 |
| 08 | Traditional medicine | 20 |
| 09 | Genetics/molecular | 19 |
| 10 | Biology/biodiversity | 24 |
| 11 | Earth/environmental (weather/climate) | 13 |
| 12 | Origins/archaeology | 14 |
| 13 | World history | 17 |
| 14 | Government/law | 20 |
| 15 | Economics/finance | 23 |
| 16 | Academic research | 43 |
| 17 | Patents/IP | 13 |
| 18 | Maps/GIS/satellite | 17 |
| 19 | Space/astronomy | 15 |
| 20 | Engineering/standards/materials | 13 |
| 21 | Archives/libraries/museums | 61 |
| 22 | News | 3 |
| 23 | Statistics/census | 39 |
| 24 | International orgs | 19 |
| 25 | Specialized/regional | 6 |
| **TOTAL** | | **509** |

### Count per 2026 status

| 2026 Status | Count |
|---|---|
| OPERATIONAL | 446 |
| SEARCH-ONLY | 36 |
| DEGRADED | 12 |
| COMMERCIAL-GATED | 8 |
| DISCONTINUED | 5 |
| STATIC | 2 |
| **TOTAL** | **509** |

### Count per tier (primary grade)

| Tier | Count |
|---|---|
| A | 313 |
| B | 83 |
| C | 53 |
| D | 39 |
| E | 19 |
| — | 2 |
| **TOTAL** | **509** |
