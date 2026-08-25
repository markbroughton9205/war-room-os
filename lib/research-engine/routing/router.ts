import type { ResearchProviderId, ResearchQuery, ResearchQueryIntent, ResearchRouteDecision } from '@/lib/research-engine/core/types'
import { RESEARCH_PROVIDER_ENV, providerConfigStatus } from '@/lib/research-engine/config/providerEnv'
import { listImplementedProviderIds } from '@/lib/research-engine/providers/registry'

/**
 * Intent -> candidate provider list, per the routing table in the assignment
 * spec. The router never calls every provider for every request — it
 * narrows to this list, then further narrows to providers that are both
 * configured and implemented.
 */
const INTENT_PROVIDER_MAP: Record<ResearchQueryIntent, ResearchProviderId[]> = {
  general_web: ['exa', 'internet_archive', 'wayback', 'common_crawl', 'wikidata', 'wikipedia', 'brave_search', 'stack_exchange'],
  software_code: ['github', 'exa', 'arxiv', 'crossref', 'osv_dev', 'pypi', 'npm_registry', 'crates_io', 'rubygems', 'maven_central', 'endoflife', 'debian_sources', 'ietf_datatracker', 'mozilla_bugzilla', 'ubuntu_security', 'apache_jira', 'gitlab_api', 'codeberg', 'software_heritage', 'launchpad', 'metacpan', 'ecosystems', 'deps_dev', 'homebrew', 'mdn_web_docs', 'rosetta_code', 'stack_exchange'],
  scholarly: ['arxiv', 'crossref', 'ncbi', 'semantic_scholar', 'github', 'europe_pmc', 'orcid', 'ror', 'opencitations', 'biorxiv_medrxiv', 'hal', 'base_search', 'inspire_hep', 'hepdata', 'zbmath', 'oeis', 'nasa_ads', 'dblp', 'jstage', 'cinii'],
  medical_biomedical: ['ncbi', 'crossref', 'semantic_scholar', 'europe_pmc', 'pubchem', 'ebi_ols', 'medlineplus', 'who_gho', 'ontobee', 'umls', 'loinc_fhir'],
  legal_case_law: ['courtlistener', 'library_of_congress', 'wayback', 'wikidata'],
  patents_inventions: ['uspto', 'crossref', 'github', 'wikidata', 'epo_ops'],
  government_contracts: ['sam_gov', 'fmcsa', 'world_bank_projects', 'usaspending', 'eu_ted', 'mercado_publico'],
  transportation_carriers: ['fmcsa', 'opensky'],
  economics_macro: ['fred', 'imf_sdmx', 'world_bank_indicators', 'eurostat', 'sec_edgar', 'ecb_sdw', 'bank_of_canada', 'bis_stats', 'eia', 'eclac_cepalstat', 'oecd_data_explorer', 'argentina_series'],
  global_development: ['world_bank_indicators', 'world_bank_projects', 'world_bank_finances', 'world_bank_climate', 'imf_sdmx', 'reliefweb', 'un_sdg', 'idb_open_data', 'iati_datastore'],
  finance_public_data: ['fred', 'world_bank_finances', 'sec_edgar', 'brazil_transparencia'],
  climate_environment: ['world_bank_climate', 'nasa_gibs', 'nasa', 'usgs_water', 'open_meteo', 'noaa_cdo', 'met_no', 'noaa_swpc', 'nws_weather', 'arctic_data_center', 'ecmwf_cds', 'met_office_datahub'],
  earthquakes_hazards: ['usgs_earthquake', 'usgs_earthquake_feed', 'nasa_gibs', 'usgs_sciencebase'],
  water_hydrology: ['usgs_water', 'usgs_national_map', 'world_bank_climate'],
  maps_geospatial: ['nasa_gibs', 'usgs_national_map', 'usgs_sciencebase', 'osm_overpass', 'geonames', 'nominatim', 'nasa_cmr', 'copernicus_dataspace', 'opentopography', 'pdok', 'ohm_overpass'],
  historical_web: ['wayback', 'internet_archive', 'common_crawl', 'library_of_congress', 'ohm_overpass'],
  cultural_history: ['library_of_congress', 'internet_archive', 'wikidata', 'wikipedia', 'pleiades', 'idai_gazetteer', 'edh', 'nomisma', 'whg', 'open_context', 'cdli', 'ehri', 'art_institute_chicago', 'cleveland_museum', 'va_museum', 'smk', 'open_library', 'cbdb', 'libris_xl', 'nasjonalbiblioteket', 'nara_catalog', 'wellcome_collection', 'cbeta', 'ebl', 'kramerius', 'ariadne_portal', 'ndl_search', 'swisscovery'],
  entity_knowledge_graph: ['wikidata', 'library_of_congress', 'github', 'sam_gov', 'gleif', 'orcid', 'wikimedia_commons', 'dbpedia', 'isni', 'lobid_gnd', 'factgrid', 'conceptnet', 'musicbrainz', 'google_kg_search', 'merriam_webster'],
  legal_entity: ['gleif', 'opensanctions', 'companies_house'],
  space_science: ['nasa', 'nasa_gibs', 'celestrak', 'jpl_horizons', 'jpl_sbdb', 'nasa_exoplanet_archive', 'simbad', 'mast', 'gaia_archive', 'sdss_skyserver', 'inpe_bdc', 'satnogs', 'usgs_m2m', 'n2yo'],
  cyber_threat_intelligence: ['mitre_attack', 'osv_dev', 'nvd', 'cisa_kev', 'github_advisory', 'epss', 'alienvault_otx', 'malwarebazaar', 'threatfox', 'urlhaus', 'msrc_cvrf', 'redhat_security_data', 'cve_org', 'greynoise', 'phishstats', 'virustotal', 'abuseipdb', 'hybrid_analysis'],
  clinical_trials: ['clinicaltrials_gov', 'ncbi', 'europe_pmc'],
  drug_safety: ['openfda', 'pubchem', 'ncbi', 'rxnorm', 'dailymed', 'chembl', 'open_targets', 'orphadata', 'guide_to_pharmacology', 'clinpgx', 'health_canada_dpd', 'bindingdb'],
  chemistry: ['pubchem', 'chembl', 'npatlas'],
  materials_science: ['materials_project', 'oqmd', 'aflow', 'nomad_repository'],
  biodiversity: ['gbif', 'uniprot', 'inaturalist', 'obis', 'worms', 'itis', 'pbdb', 'bhl', 'checklistbank', 'eol', 'globi', 'mushroom_observer'],
  genetics: ['uniprot', 'ncbi', 'ensembl', 'rcsb_pdb', 'string_db', 'gnomad', 'ena_portal', 'ncbi_datasets', 'alphafold_db', 'reactome', 'intact', 'kegg', 'metabolights', 'pride_archive', 'wikipathways', 'cellosaurus', 'metabolomics_workbench'],
  statistics_demographics: ['us_census', 'eurostat', 'world_bank_indicators', 'geonames', 'statcan_wds', 'uk_ons', 'insee_melodi', 'unesco_uis', 'sidra_brazil', 'cbs_statline', 'bdl_poland', 'israel_cbs', 'nomis_uk', 'abs_australia', 'data_gov_my', 'datos_abiertos_colombia', 'ine_tempus3', 'singstat'],
  government_legislation: ['congress_gov', 'govinfo', 'courtlistener', 'federal_register', 'uk_legislation', 'japan_egov_hourei', 'australia_frl', 'uk_gazette'],
  humanitarian_events: ['reliefweb', 'world_bank_indicators', 'unhcr_data', 'ocha_fts'],
}

function rejectionReason(provider: ResearchProviderId): string {
  const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === provider)
  if (!descriptor) return 'unknown provider'
  const status = providerConfigStatus(descriptor)
  if (status === 'unavailable') return `required environment variable(s) not configured: ${descriptor.requiredEnv.join(', ')}`
  if (status === 'pending' && !descriptor.implemented) return 'adapter not implemented in this build phase'
  if (status === 'pending') return 'optional credential not configured; provider marked pending by design'
  return 'not selected for this query'
}

export function routeResearchQuery(query: ResearchQuery): ResearchRouteDecision {
  const intent = query.intent ?? null
  const implementedIds = new Set(listImplementedProviderIds())
  const explicit = query.providers && query.providers.length > 0 ? query.providers : null
  const candidates = explicit ?? (intent ? INTENT_PROVIDER_MAP[intent] ?? [] : listImplementedProviderIds())

  const selectedProviders: ResearchProviderId[] = []
  const rejectedProviders: { provider: ResearchProviderId; reason: string }[] = []

  for (const provider of candidates) {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === provider)
    const configured = descriptor ? providerConfigStatus(descriptor) === 'configured' : false
    if (configured && implementedIds.has(provider)) {
      selectedProviders.push(provider)
    } else {
      rejectedProviders.push({ provider, reason: rejectionReason(provider) })
    }
  }

  return {
    intent,
    selectedProviders,
    rejectedProviders,
    freshnessRequirement: query.requireCurrent ? 'current' : 'either',
    maxResults: Math.max(1, Math.min(query.maxResults ?? 20, 50)),
  }
}
