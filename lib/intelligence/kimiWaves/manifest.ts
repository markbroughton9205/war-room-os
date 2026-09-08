export type KimiWaveFileManifest = {
  wave: 1 | 2
  sequence: number
  filename: string
  relativePath: string
  domain: string
  /** Best-effort artifact date from the preserved reports themselves — never "parsed today". */
  artifactAt: string
}

export const KIMI_WAVE_REPORTS_ROOT = 'docs/research/earth-knowledge/kimi-source-reports'

/**
 * The 16 preserved Wave 1 / Wave 2 source reports. Integrated copies under earth_kb_integrated/
 * are derived, not the provenance artifacts this layer indexes.
 */
export const KIMI_WAVE_FILE_MANIFEST: KimiWaveFileManifest[] = [
  { wave: 1, sequence: 1, filename: '01_software_coding.md', relativePath: 'earth_kb_wave1/01_software_coding.md', domain: 'SOFTWARE / CODING', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 2, filename: '02_bugs_patches.md', relativePath: 'earth_kb_wave1/02_bugs_patches.md', domain: 'BUGS / PATCHES / PACKAGE & RELEASE INFRASTRUCTURE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 3, filename: '03_cybersecurity.md', relativePath: 'earth_kb_wave1/03_cybersecurity.md', domain: 'CYBERSECURITY / VULNERABILITIES / MALWARE / THREAT INTELLIGENCE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 4, filename: '04_medical_diseases.md', relativePath: 'earth_kb_wave1/04_medical_diseases.md', domain: 'MEDICAL / DISEASES / DIAGNOSTICS / CLINICAL KNOWLEDGE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 5, filename: '05_pharmaceuticals.md', relativePath: 'earth_kb_wave1/05_pharmaceuticals.md', domain: 'PHARMACEUTICALS / DRUGS / REGULATORY / MEDICINE DATA', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 6, filename: '06_traditional_medicine.md', relativePath: 'earth_kb_wave1/06_traditional_medicine.md', domain: 'TRADITIONAL / INDIGENOUS / COMPLEMENTARY MEDICINE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 7, filename: '07_biology_biodiversity.md', relativePath: 'earth_kb_wave1/07_biology_biodiversity.md', domain: 'BIOLOGY / BIODIVERSITY / SPECIES / ECOLOGY', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 1, sequence: 8, filename: '08_genomics_molecular.md', relativePath: 'earth_kb_wave1/08_genomics_molecular.md', domain: 'GENOMICS / MOLECULAR BIOLOGY / BIOINFORMATICS', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 9, filename: '09_history_archaeology.md', relativePath: 'earth_kb_wave2/09_history_archaeology.md', domain: 'HISTORY / ARCHAEOLOGY / CULTURE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 10, filename: '10_government_law_economics.md', relativePath: 'earth_kb_wave2/10_government_law_economics.md', domain: 'GOVERNMENT / LAW / ECONOMICS / PUBLIC DATA / TRANSPORTATION', artifactAt: '2026-08-01T00:00:00.000Z' },
  { wave: 2, sequence: 11, filename: '11_science_engineering_patents.md', relativePath: 'earth_kb_wave2/11_science_engineering_patents.md', domain: 'SCIENCE / ENGINEERING / PATENTS / ACADEMIC', artifactAt: '2026-08-01T00:00:00.000Z' },
  { wave: 2, sequence: 12, filename: '12_maps_space.md', relativePath: 'earth_kb_wave2/12_maps_space.md', domain: 'MAPS / GIS / EARTH OBSERVATION / SPACE / ASTRONOMY / TRANSPORTATION', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 13, filename: '13_academic_archives_museums.md', relativePath: 'earth_kb_wave2/13_academic_archives_museums.md', domain: 'ACADEMIC / ARCHIVES / LIBRARIES / MUSEUMS', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 14, filename: '14_statistics_intl_orgs.md', relativePath: 'earth_kb_wave2/14_statistics_intl_orgs.md', domain: 'STATISTICS / INTERNATIONAL ORGANIZATIONS', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 15, filename: '15_general_web_reference.md', relativePath: 'earth_kb_wave2/15_general_web_reference.md', domain: 'GENERAL WEB / REFERENCE / KNOWLEDGE INFRASTRUCTURE', artifactAt: '2026-08-08T00:00:00.000Z' },
  { wave: 2, sequence: 16, filename: '16_regional_specialized.md', relativePath: 'earth_kb_wave2/16_regional_specialized.md', domain: 'REGIONAL / NON-WESTERN / SPECIALIZED / RARE KNOWLEDGE', artifactAt: '2026-08-08T00:00:00.000Z' },
]
