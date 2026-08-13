# 18_diagnostics_treatments.md

**War Room OS — Global Knowledge-Gap Completion**  
**Verification date:** 2026-08-13  
**Previous status:** PARTIAL  
**Recommended status:** **PRESENT**

## Executive Summary

The medical domain can now be upgraded because it has four complementary layers: **evidence-based guidelines, structured digital guidance, trials/evidence/regulatory data, and traditional/Indigenous knowledge kept in a separate evidence/context layer**. WHO Guidelines and SMART/DAKs provide global guidance and digitization structure [MD01–MD02]. ICTRP provides global trial discovery and a documented partner XML service [MD03]. NICE, EMA, Orphanet, Cochrane, PAHO, WHO regional and national guideline systems add diagnostic/treatment depth [MD05–MD12]. WHO reported in August 2026 that the Traditional Medicine Global Library contains more than **1.6 million scientific records** [MD04].

This is **knowledge infrastructure, not autonomous medical decision-making**. Clinical retrieval must remain versioned, jurisdiction-aware, population-aware and source-attributed. Traditional/historical/Indigenous practice must never be silently presented as equivalent to modern evidence-based clinical guidance.

## Scope

Symptoms/signs; diagnostic criteria and differential diagnosis; laboratory/imaging guidance; pathology; treatment guidelines and care pathways; drugs/surgery/rehabilitation; emergency and critical care; chronic disease; pediatrics/geriatrics/pregnancy; oncology/infectious disease/cardiology/neurology/psychiatry/endocrinology/GI/nephrology/pulmonology/dermatology/rheumatology/hematology; rare disease/genetics.

Future clinical ingestion should capture when available: contraindications, interactions, dose, pregnancy/lactation, pediatric limits, renal/hepatic adjustment, evidence grade/recommendation strength, safety warnings, update date, population/setting, jurisdiction and superseded status.

## Source Registry

### MD01 — WHO Guidelines
- **Source name:** WHO Guidelines
- **Organization:** World Health Organization
- **Country:** International
- **Region:** Global
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Evidence-based clinical and public-health recommendations
- **Authority level:** International public-health authority
- **Source type:** Guideline repository
- **Access URL:** https://www.who.int/publications/who-guidelines
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None
- **Signup requirement:** No
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF and linked guideline products
- **Bulk download:** No universal bulk endpoint verified
- **Search capability:** WHO publication/site search
- **Historical coverage:** Current and archived guideline publications
- **Geographic coverage:** Global; guidance may be global or disease/region specific
- **Language coverage:** Multilingual; document-specific
- **Update frequency:** Guideline-specific
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low–Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High subject to WHO terms
- **Provenance value:** High
- **Limitations:** Guidelines are not patient-specific diagnostic engines; local adaptation/current country standards remain necessary.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD02 — WHO SMART Guidelines / Digital Adaptation Kits (DAKs)
- **Source name:** WHO SMART Guidelines / Digital Adaptation Kits (DAKs)
- **Organization:** World Health Organization
- **Country:** International
- **Region:** Global
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Structured, software-neutral digital health guidance/workflows
- **Authority level:** International public-health authority
- **Source type:** Digital guideline specification / implementation kit
- **Access URL:** https://www.who.int/teams/digital-health-and-innovation/smart-guidelines
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None for public guidance
- **Signup requirement:** No
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** Structured artifacts, implementation guides and documentation; exact formats vary by product
- **Bulk download:** Product-dependent
- **Search capability:** WHO site
- **Historical coverage:** Current digital adaptation products
- **Geographic coverage:** Global with local adaptation
- **Language coverage:** Product-dependent
- **Update frequency:** Product/version cycle
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** Medium
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** DAK coverage is not universal; implementation must preserve context, version and recommendation strength.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD03 — International Clinical Trials Registry Platform (ICTRP)
- **Source name:** International Clinical Trials Registry Platform (ICTRP)
- **Organization:** World Health Organization
- **Country:** International
- **Region:** Global
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Clinical trials, interventions, outcomes and registry metadata
- **Authority level:** International public-health authority / registry aggregator
- **Source type:** Clinical-trial registry search and data service
- **Access URL:** https://www.who.int/clinical-trials-registry-platform
- **Documentation URL:** https://www.who.int/clinical-trials-registry-platform/network/trial-registration-data-set
- **API/data interface:** Real-time XML web service exists for agreed/approved partner websites; not an unrestricted anonymous API
- **Authentication:** Partner approval/agreement for web service
- **Signup requirement:** Yes for partner service; public search is separate
- **Pricing:** Public search free; partner-service pricing UNKNOWN
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** XML via partner web service; portal search; primary-registry formats vary
- **Bulk download:** UNKNOWN at WHO aggregator level
- **Search capability:** Global trials portal
- **Historical coverage:** Ongoing/completed trials from WHO primary registries
- **Geographic coverage:** Global
- **Language coverage:** Standardized English fields with some provider-language content
- **Update frequency:** Registry-fed / near-real-time
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium–High
- **Live-query suitability:** High if partner access approved
- **Sync suitability:** High
- **Local-index suitability:** Medium–High subject to terms
- **Provenance value:** High
- **Limitations:** Registration is not proof of efficacy; trial records may be incomplete/outdated; results can reside elsewhere.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** LIVE PROVIDER CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD04 — Traditional Medicine Global Library (TMGL)
- **Source name:** Traditional Medicine Global Library (TMGL)
- **Organization:** World Health Organization
- **Country:** International
- **Region:** Global
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Traditional, complementary and integrative medicine; evidence, policy, regulation, Indigenous knowledge
- **Authority level:** International public-health authority
- **Source type:** Global digital knowledge library
- **Access URL:** https://www.who.int/news/item/05-08-2026-thailand-to-host-third-who-global-summit-on-traditional-medicine-in-2027
- **Documentation URL:** https://www.who.int/news/item/25-09-2025-traditional-medicine-global-library-to-launch-in-2025
- **API/data interface:** Public API not verified in this run
- **Authentication:** UNKNOWN for library-specific advanced functions
- **Signup requirement:** UNKNOWN
- **Pricing:** WHO describes equitable online access; specific service tiers UNKNOWN
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** Scientific records, evidence maps, journals, multimedia, policy/regulation and thematic collections; machine interface UNKNOWN
- **Bulk download:** UNKNOWN
- **Search capability:** Library search exists; direct endpoint/API not independently documented here
- **Historical coverage:** Historical and contemporary traditional medicine knowledge
- **Geographic coverage:** Global; WHO described six regional portals and 194 country pages around launch
- **Language coverage:** Multilingual by design; exact inventory UNKNOWN
- **Update frequency:** Continuously growing; WHO reported >1.6 million scientific records in Aug 2026
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium until API/licensing documented
- **Live-query suitability:** UNKNOWN
- **Sync suitability:** Medium
- **Local-index suitability:** Medium subject to rights/Indigenous-data governance
- **Provenance value:** High
- **Limitations:** Traditional/Indigenous knowledge must not be presented as validated clinical efficacy without independent modern evidence; cultural authority/IP/data sovereignty matter.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD05 — PAHO Clinical Guidelines and Protocols
- **Source name:** PAHO Clinical Guidelines and Protocols
- **Organization:** Pan American Health Organization
- **Country:** International regional organization
- **Region:** Americas
- **Global scope:** Regional
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Clinical guidelines/protocols, NCDs and infectious-disease management
- **Authority level:** WHO regional public-health authority
- **Source type:** Guideline portal / dashboard
- **Access URL:** https://www.paho.org/en/better-care-ncds-initiative/regional-data-portal-better-care-ncds-initiative/clinical-guidelines
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None
- **Signup requirement:** No
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF/dashboard data; machine interface UNKNOWN
- **Bulk download:** UNKNOWN
- **Search capability:** Dashboard/portal
- **Historical coverage:** Current and archived PAHO/WHO guidance
- **Geographic coverage:** Americas and Caribbean
- **Language coverage:** English, Spanish, Portuguese, French depending product
- **Update frequency:** Ongoing
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low–Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** Regional guidance still requires country adaptation and local formulary/regulatory checks.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD06 — WHO South-East Asia Regional Office clinical guidance ecosystem
- **Source name:** WHO South-East Asia Regional Office clinical guidance ecosystem
- **Organization:** World Health Organization — SEARO
- **Country:** International regional organization
- **Region:** South-East Asia
- **Global scope:** Regional
- **Domain:** Diagnostics / Treatments
- **Subdomain:** NCD, infectious disease, testing/treatment protocols and country implementation
- **Authority level:** WHO regional public-health authority
- **Source type:** Regional guidance / implementation portal
- **Access URL:** https://www.who.int/southeastasia
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None
- **Signup requirement:** No
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF/data products
- **Bulk download:** UNKNOWN
- **Search capability:** WHO regional search
- **Historical coverage:** Current and archived programs
- **Geographic coverage:** Bangladesh, Bhutan, DPR Korea, India, Indonesia, Maldives, Myanmar, Nepal, Sri Lanka, Thailand, Timor-Leste
- **Language coverage:** English plus country-level local-language materials
- **Update frequency:** Ongoing
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low–Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** Country protocols differ; regional portal is not one normalized clinical API.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD07 — NICE guidance + NICE Syndication API
- **Source name:** NICE guidance + NICE Syndication API
- **Organization:** National Institute for Health and Care Excellence
- **Country:** United Kingdom
- **Region:** Europe / UK
- **Global scope:** UK-specific with international reference value
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Clinical guidance, pathways, diagnostics, medicines and technology appraisal
- **Authority level:** National guideline authority
- **Source type:** Guidance repository + syndication interface
- **Access URL:** https://www.nice.org.uk/about/what-we-do/our-programmes/nice-syndication-api
- **Documentation URL:** https://www.nice.org.uk/about/what-we-do/our-programmes/nice-syndication-api
- **API/data interface:** NICE Syndication API
- **Authentication:** API/licence terms apply
- **Signup requirement:** May be required depending use
- **Pricing:** Licensing can apply, especially for international/metadata reuse
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** Structured API content plus HTML/PDF guidance
- **Bulk download:** UNKNOWN
- **Search capability:** Yes
- **Historical coverage:** Current/archived NICE guidance
- **Geographic coverage:** England/UK context
- **Language coverage:** English
- **Update frequency:** Guideline/product cycle
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** High subject to licence/access
- **Sync suitability:** High
- **Local-index suitability:** Medium subject to licence
- **Provenance value:** High
- **Limitations:** UK-specific recommendations/commissioning context; licensing must be resolved before automated reuse.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** LIVE PROVIDER CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD08 — EMA medicines data / electronic Product Information (ePI)
- **Source name:** EMA medicines data / electronic Product Information (ePI)
- **Organization:** European Medicines Agency
- **Country:** European Union
- **Region:** Europe
- **Global scope:** Regional
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Medicines authorization, product information, safety and regulatory assessment
- **Authority level:** Regional medicines regulator
- **Source type:** Regulatory medicines database / API pilot
- **Access URL:** https://www.ema.europa.eu/en/medicines
- **Documentation URL:** https://www.ema.europa.eu/en/human-regulatory-overview/electronic-product-information-epi
- **API/data interface:** Public ePI consuming API documented as a pilot; medicine data downloads are available
- **Authentication:** Public ePI pilot was described as no-key; re-verify production status before implementation
- **Signup requirement:** No for public medicine pages/downloads
- **Pricing:** Free public regulatory access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** Structured ePI/FHIR bundles in pilot; downloadable medicine data; HTML/PDF
- **Bulk download:** Yes for medicine data downloads; ePI bulk status UNKNOWN
- **Search capability:** Yes
- **Historical coverage:** Current/historical regulatory records and assessment documents
- **Geographic coverage:** EU/EEA regulatory scope
- **Language coverage:** EU product information is multilingual; availability varies
- **Update frequency:** Medicine datasets frequently updated; official material notes overnight data updates for downloads
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** High for supported production API
- **Sync suitability:** High
- **Local-index suitability:** High subject to terms
- **Provenance value:** High
- **Limitations:** Regulatory product information is not a complete treatment guideline; pilot/production status must be revalidated.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** LIVE PROVIDER CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD09 — Orphanet / ORDO / Orphadata
- **Source name:** Orphanet / ORDO / Orphadata
- **Organization:** INSERM / Orphanet consortium
- **Country:** France / European consortium
- **Region:** Europe / global rare-disease network
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Rare diseases, nomenclature, genes, diagnostic tests, registries and orphan drugs
- **Authority level:** Specialist rare-disease authority/reference
- **Source type:** Rare-disease portal + ontology/data downloads
- **Access URL:** https://www.orpha.net/
- **Documentation URL:** https://www.orphadata.com/ontology/
- **API/data interface:** ORDO and Orphadata structured/downloadable products
- **Authentication:** Public portal; dataset-specific terms/registration may apply
- **Signup requirement:** Dataset-dependent
- **Pricing:** Core portal free; reuse varies by dataset
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** OWL/RDF ontology and structured data products; web portal
- **Bulk download:** Yes for specified ontology/data products
- **Search capability:** Yes
- **Historical coverage:** Current rare-disease knowledge with nomenclature mappings
- **Geographic coverage:** Global reference with European institutional base
- **Language coverage:** Multilingual network; product languages vary
- **Update frequency:** Periodic releases
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** Medium
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** Identifiers/nomenclature do not themselves provide complete treatment pathways; evidence evolves.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** BULK INGEST CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD10 — Cochrane Library / CDSR / CENTRAL
- **Source name:** Cochrane Library / CDSR / CENTRAL
- **Organization:** Cochrane
- **Country:** International
- **Region:** Global
- **Global scope:** Yes
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Systematic reviews and randomized/controlled trial evidence
- **Authority level:** High-authority evidence-synthesis organization
- **Source type:** Evidence database
- **Access URL:** https://www.cochranelibrary.com/
- **Documentation URL:** https://www.cochranelibrary.com/help/using-cochrane-library
- **API/data interface:** Text/data-mining or API access is available through Wiley under licensing arrangements
- **Authentication:** Licence/click-through or commercial arrangement may be required for API/TDM
- **Signup requirement:** Use-case dependent
- **Pricing:** Public abstracts; full content/API reuse can be subscription/licence restricted
- **Rate limits:** Contract-specific/UNKNOWN
- **Machine-readable formats:** HTML/citation metadata; licensed API/TDM formats
- **Bulk download:** Licensed TDM/API pathways
- **Search capability:** Yes
- **Historical coverage:** Systematic reviews and controlled-trial records over decades
- **Geographic coverage:** Global literature
- **Language coverage:** Primarily English synthesis; translations vary
- **Update frequency:** Continuous/issue-based
- **Licensing:** UNKNOWN
- **Integration difficulty:** High because licensing
- **Live-query suitability:** High if licensed
- **Sync suitability:** High if licensed
- **Local-index suitability:** Restricted by licence
- **Provenance value:** High
- **Limitations:** Licensing and review currency matter; reviews do not substitute for current local clinical guidance.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** LIVE PROVIDER CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD11 — Standard Treatment Guidelines & Essential Medicines List
- **Source name:** Standard Treatment Guidelines & Essential Medicines List
- **Organization:** National Department of Health
- **Country:** South Africa
- **Region:** Southern Africa
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Primary/hospital/pediatric treatment guidance and essential medicines
- **Authority level:** National health ministry
- **Source type:** National treatment guideline / formulary
- **Access URL:** https://www.health.gov.za/
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None for public documents
- **Signup requirement:** No
- **Pricing:** Free public documents
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** PDF/HTML
- **Bulk download:** No structured bulk interface verified
- **Search capability:** Site/document search
- **Historical coverage:** Current and archived editions
- **Geographic coverage:** South Africa
- **Language coverage:** Primarily English official guidance; patient materials may be multilingual
- **Update frequency:** Edition cycle
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low–Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** PDF-heavy/nationally specific; medicine availability and EML status change.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD12 — Standard Treatment Guidelines / Clinical Establishments
- **Source name:** Standard Treatment Guidelines / Clinical Establishments
- **Organization:** Ministry of Health & Family Welfare, Government of India
- **Country:** India
- **Region:** South Asia
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Multi-specialty standard treatment guidelines
- **Authority level:** National health ministry
- **Source type:** National treatment guideline repository
- **Access URL:** https://clinicalestablishments.mohfw.gov.in/
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None for public documents
- **Signup requirement:** No
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** PDF/HTML
- **Bulk download:** No API/bulk endpoint verified
- **Search capability:** Portal/site search
- **Historical coverage:** Current and archived specialty guideline documents
- **Geographic coverage:** India
- **Language coverage:** English dominant on national portal; local translations may exist separately
- **Update frequency:** Guideline-specific
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low–Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** Guideline currency/state implementation must be checked; repository is document-centric.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD13 — AYUSH knowledge/terminology/pharmacovigilance ecosystem
- **Source name:** AYUSH knowledge/terminology/pharmacovigilance ecosystem
- **Organization:** Ministry of Ayush, Government of India
- **Country:** India
- **Region:** South Asia
- **Global scope:** India-based with international relevance
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Ayurveda, Yoga/Naturopathy, Unani, Siddha, Sowa-Rigpa; terminology/cases/safety
- **Authority level:** National ministry for traditional systems
- **Source type:** Government knowledge portals / terminology / pharmacovigilance
- **Access URL:** https://ayush.gov.in/
- **Documentation URL:** UNKNOWN
- **API/data interface:** Public API not verified
- **Authentication:** Portal-specific
- **Signup requirement:** Portal-specific/UNKNOWN
- **Pricing:** Public government access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF/databases; standardized terminology/coding portals exist
- **Bulk download:** UNKNOWN
- **Search capability:** Portal-specific
- **Historical coverage:** Traditional and contemporary practice/regulation
- **Geographic coverage:** India with international outreach
- **Language coverage:** English, Hindi and system/source terminology; portal-specific
- **Update frequency:** Ongoing
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** UNKNOWN
- **Sync suitability:** Medium
- **Local-index suitability:** Medium
- **Provenance value:** High
- **Limitations:** Government recognition/standardization does not establish effectiveness for every practice; evidence and modern safety remain separate.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD14 — Traditional Chinese Medicine regulatory guidance
- **Source name:** Traditional Chinese Medicine regulatory guidance
- **Organization:** National Medical Products Administration
- **Country:** China
- **Region:** East Asia
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** TCM drug registration, clinical research, product quality/regulation
- **Authority level:** National medicines regulator
- **Source type:** Regulatory guidance portal
- **Access URL:** https://english.nmpa.gov.cn/
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None for public regulatory pages
- **Signup requirement:** No for public pages
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF; machine interface UNKNOWN
- **Bulk download:** UNKNOWN
- **Search capability:** Site search
- **Historical coverage:** Current regulatory framework/notices
- **Geographic coverage:** China
- **Language coverage:** Chinese primary; selected English material
- **Update frequency:** Ongoing
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** Medium
- **Provenance value:** High
- **Limitations:** English coverage incomplete; regulation does not equal evidence of efficacy.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD15 — Australian Indigenous HealthInfoNet
- **Source name:** Australian Indigenous HealthInfoNet
- **Organization:** Edith Cowan University
- **Country:** Australia
- **Region:** Oceania
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Aboriginal and Torres Strait Islander health, cultural ways, traditional healing/evidence
- **Authority level:** Academic/public-health knowledge service
- **Source type:** Indigenous health knowledge portal
- **Access URL:** https://healthinfonet.ecu.edu.au/
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None for public content
- **Signup requirement:** No for basic access
- **Pricing:** Free public access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF/resource metadata
- **Bulk download:** UNKNOWN
- **Search capability:** Yes
- **Historical coverage:** Contemporary health evidence plus cultural/historical resources
- **Geographic coverage:** Australia
- **Language coverage:** English portal; Indigenous-language/culturally specific material varies
- **Update frequency:** Ongoing
- **Licensing:** UNKNOWN
- **Integration difficulty:** Medium
- **Live-query suitability:** Low
- **Sync suitability:** Medium
- **Local-index suitability:** Medium subject to cultural/data governance
- **Provenance value:** High
- **Limitations:** Cultural knowledge requires context/permissions/data sovereignty; not a generic treatment-protocol source.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** DOCUMENT/ARCHIVE KNOWLEDGE SOURCE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD16 — Traditional Health Practitioners legal/regulatory framework
- **Source name:** Traditional Health Practitioners legal/regulatory framework
- **Organization:** Government of South Africa / Department of Health
- **Country:** South Africa
- **Region:** Southern Africa
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** African traditional-health practitioner regulation/institutional framework
- **Authority level:** National government / legislation
- **Source type:** Law and regulatory reference
- **Access URL:** https://www.gov.za/documents/traditional-health-practitioners-act
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** None
- **Signup requirement:** No
- **Pricing:** Free public legal access
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** HTML/PDF
- **Bulk download:** No
- **Search capability:** Government site search
- **Historical coverage:** Act 22 of 2007 and subsequent implementation context
- **Geographic coverage:** South Africa
- **Language coverage:** English legal text; related translations vary
- **Update frequency:** Legislative/regulatory cycle
- **Licensing:** UNKNOWN
- **Integration difficulty:** Low
- **Live-query suitability:** Low
- **Sync suitability:** High
- **Local-index suitability:** High
- **Provenance value:** High
- **Limitations:** May 2026 parliamentary reporting identified implementation/registration delays; law is not evidence of treatment efficacy.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** PERIODIC SYNC CANDIDATE
- **Duplicate/overlap classification:** UNVERIFIED_RELATIONSHIP

### MD17 — NHMRC Clinical Practice Guidelines Portal — discontinued
- **Source name:** NHMRC Clinical Practice Guidelines Portal — discontinued
- **Organization:** National Health and Medical Research Council
- **Country:** Australia
- **Region:** Oceania
- **Global scope:** No
- **Domain:** Diagnostics / Treatments
- **Subdomain:** Guideline discovery portal
- **Authority level:** National health research authority
- **Source type:** Deprecated service / negative finding
- **Access URL:** https://www.nhmrc.gov.au/health-advice/guidelines
- **Documentation URL:** UNKNOWN
- **API/data interface:** UNKNOWN
- **Authentication:** N/A
- **Signup requirement:** N/A
- **Pricing:** N/A
- **Rate limits:** UNKNOWN
- **Machine-readable formats:** Web notice / current approved-guideline information
- **Bulk download:** No
- **Search capability:** Legacy Clinical Practice Guidelines Portal no longer active; current NHMRC pages remain
- **Historical coverage:** Legacy Australian guideline portal
- **Geographic coverage:** Australia
- **Language coverage:** English
- **Update frequency:** Portal discontinued; guideline approval information continues separately
- **Licensing:** UNKNOWN
- **Integration difficulty:** N/A
- **Live-query suitability:** No
- **Sync suitability:** No for retired portal
- **Local-index suitability:** No
- **Provenance value:** High for deprecation status
- **Limitations:** Do not build against the retired portal. Use current NHMRC guidance pages and/or current guideline networks.
- **Reliability notes:** Official, primary, standards-body, university, or specialist source; capabilities not evidenced in this research run are marked UNKNOWN.
- **Verification date:** 2026-08-13
- **Integration classification:** NOT APPROPRIATE FOR AUTOMATED INTEGRATION
- **Duplicate/overlap classification:** NEGATIVE_FINDING
## Geographic Coverage

| Layer | Coverage | Notes |
|---|---|---|
| WHO guideline backbone | Global | Disease/public-health guidance worldwide |
| Structured digital guidance | Global but product-specific | SMART/DAKs do not yet cover every clinical domain |
| Trials | Global | WHO primary-registry network spans multiple countries/regions |
| Americas | Strong regional | PAHO + WHO; national adapters still needed |
| South-East Asia | Strong regional | WHO SEARO + country protocols |
| Europe/UK | Strong | NICE + EMA |
| Africa | Moderate–Strong | WHO global + South Africa STG; broader country STGs/regulators needed |
| South Asia | Strong example | India MoHFW + AYUSH |
| East Asia | Moderate | China NMPA/TCM; Japan/Kampo still thin |
| Oceania | Moderate | Australia Indigenous layer; retired NHMRC portal recorded; Pacific systems thin |
| Rare disease | Global reference | Orphanet/ORDO |
| Traditional/Indigenous | Global WHO spine + national examples | Evidence/cultural-governance separation required |

## Integration Classification

- **Live candidates:** MD03 ICTRP only with partner approval; MD07 NICE subject to licence; MD08 EMA only after production-API status is rechecked; MD10 Cochrane only under appropriate licence.
- **Bulk/sync:** MD02 SMART/DAKs, MD09 Orphanet/ORDO, regional/national guideline repositories.
- **Traditional:** MD04 is discovery/evidence/policy infrastructure, not an instruction generator. MD13–MD16 add government/cultural/regulatory context.
- **Negative:** MD17 is a confirmed retired integration target.

## Delivered

Global guideline spine; software-neutral structured guidance; worldwide trial aggregation; UK/EU guidance and medicine-regulatory interfaces; rare-disease ontology/data; systematic reviews; PAHO/SEARO regional layers; South Africa/India national treatment examples; traditional/Indigenous source family across WHO/India/China/South Africa/Australia; explicit deprecated source finding.

## Partial

Uniform national guideline coverage; country formularies and regulators; global lab/imaging/emergency-protocol normalization; Africa-wide traditional medicine evidence/regulatory datasets; Indigenous American/Pacific/Kampo/Japanese/Unani source depth; public API/licensing details for the new WHO TMGL.

## Not Found

No core medical knowledge-infrastructure category is NOT FOUND. Country/specialty interfaces remain incomplete for implementation but no longer justify a domain-level gap.

## Access Blockers

NICE/Cochrane licensing; ICTRP partner approval; medicine regulatory/versioning rules; PDF-heavy national guidance; cultural consent/IP/data sovereignty for Indigenous/traditional sources; conflicts between current guidelines that require display rather than silent merging.

## Geographic Blind Spots

Normalize WHO AFRO/EMRO/WPRO/EURO; add national health ministries, drug regulators, formularies and guideline bodies in Africa, Latin America, Middle East and Pacific; add Japan/Kampo and broader Indigenous American authorities.

## Language Blind Spots

Arabic, French/Portuguese African guidance, Chinese/Japanese/Korean, South/Southeast Asian languages, Indigenous terminologies and multilingual medicine labeling. Safety-critical dosing text should retain the source language alongside any translation.

## Recommended Next Integrations

1. Normalize WHO Guidelines + SMART/DAK metadata into a versioned guideline graph.
2. Verify/apply for ICTRP partner service before any connector work.
3. Independently verify NICE licence terms and EMA production API status at implementation time.
4. Bulk/sync Orphanet/ORDO for rare-disease entity normalization.
5. Create a country adapter pattern: ministry + drug regulator + formulary/EML + national guideline body + emergency/public-health authority.
6. Add all WHO regions, then priority country systems.
7. Keep TMGL/traditional systems in a separate evidence/context namespace with cultural provenance.
8. Store conflicting current recommendations side-by-side rather than silently choosing one.
9. Require update/supersession/jurisdiction/population fields for treatment retrieval.

## Completion Verdict

**Diagnostics / Treatments: PRESENT.**

Authoritative global guidance, structured digital guidance, trials, evidence synthesis, drug regulatory information, rare-disease structure, regional/national treatment systems and traditional/Indigenous knowledge infrastructure are all represented. Remaining work is normalization, licensing and jurisdictional depth.
