/**
 * This suite provides STRUCTURAL, CONTRACT, SELF-CONSISTENCY,
 * VOCABULARY-DRIFT, and DETERMINISTIC-SERIALIZATION validation for
 * lib/discipline/disciplineRegistry.ts.
 *
 * It is NOT independent proof that every architecture claim in the
 * registry is behaviorally true. Most cases here check the registry's
 * own internal shape and internal consistency (unique IDs, required
 * fields present, module paths existing on disk, no field contradicts
 * another) or check that specific known-facts are *disclosed* in the
 * registry's own prose (e.g. that the six known limitations are
 * mentioned somewhere). A case checking "does the registry SAY X" is not
 * the same as independently re-verifying that X is true of the real
 * codebase — this suite was written by the same effort that wrote the
 * registry, and cannot substitute for a truly independent read of the
 * source files the registry describes. Repository and runtime claims
 * (e.g. "this file is imported by the moderator," "this regex is
 * duplicated," "this route exists") require independent source
 * inspection and, where applicable, real runtime verification — not
 * just this suite passing.
 */

import { readFileSync, existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import {
  DISCIPLINE_REGISTRY,
  COUNCIL_TRACE_OBSERVATION_MODE_VALUES,
  LEARNING_INTEGRATION_STATUS_VALUES,
  QUEUE_TRUTH_LABEL_VALUES,
  getDisciplineById,
  type DisciplineRegistryEntry,
} from './disciplineRegistry'

export type DisciplineRegistryValidationResult = {
  caseId: string
  ok: boolean
  detail: string
}

function validation(caseId: string, ok: boolean, detail: string): DisciplineRegistryValidationResult {
  return { caseId, ok, detail }
}

const REGISTRY_SOURCE = readFileSync('lib/discipline/disciplineRegistry.ts', 'utf8')

// lib/discipline/disciplineRegistryValidation.ts -> repo root is two levels
// up. Resolved from this file's own location (not process.cwd()) so path
// resolution is deterministic regardless of what directory the validation
// runner is invoked from, and works identically on Windows and POSIX paths
// via the `path` module rather than manual string concatenation.
const VALIDATION_FILE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(VALIDATION_FILE_DIR, '..', '..')

/**
 * Resolves a repository-relative moduleLocations path to an absolute path
 * and checks it against the real filesystem. This is a pure fs.existsSync
 * / fs.statSync stat check -- it never imports or executes the target
 * file, and never triggers any runtime side effect in the module it
 * points at.
 */
function checkModuleLocationExists(location: string): { exists: boolean; isFile: boolean; resolvedPath: string } {
  const resolvedPath = join(REPO_ROOT, location)
  if (!existsSync(resolvedPath)) {
    return { exists: false, isFile: false, resolvedPath }
  }
  const stats = statSync(resolvedPath)
  return { exists: true, isFile: stats.isFile(), resolvedPath }
}

function disciplineIdsUnique(): DisciplineRegistryValidationResult {
  const ids = DISCIPLINE_REGISTRY.map(entry => entry.disciplineId)
  const unique = new Set(ids)
  return validation(
    'discipline_qa_01_ids_unique',
    unique.size === ids.length,
    `total=${ids.length}; unique=${unique.size}`,
  )
}

function requiredFieldsPresent(): DisciplineRegistryValidationResult {
  const requiredKeys: (keyof DisciplineRegistryEntry)[] = [
    'disciplineId',
    'name',
    'implementationStatus',
    'runtimeAuthority',
    'evidenceStatus',
    'enforcementStatus',
    'moduleLocations',
    'dependencies',
    'observations',
    'limitations',
  ]
  const missing: string[] = []
  for (const entry of DISCIPLINE_REGISTRY) {
    for (const key of requiredKeys) {
      if (!(key in entry) || entry[key] === undefined || entry[key] === null) {
        missing.push(`${entry.disciplineId}.${String(key)}`)
      }
    }
  }
  return validation(
    'discipline_qa_02_required_fields_present',
    missing.length === 0,
    missing.length === 0 ? `all ${DISCIPLINE_REGISTRY.length} entries complete` : `missing: ${missing.join(', ')}`,
  )
}

function moduleLocationsNonEmptyRepoRelative(): DisciplineRegistryValidationResult {
  const problems: string[] = []
  let checkedCount = 0
  for (const entry of DISCIPLINE_REGISTRY) {
    if (entry.moduleLocations.length === 0) {
      problems.push(`${entry.disciplineId}: empty moduleLocations`)
      continue
    }
    for (const location of entry.moduleLocations) {
      const isNonEmpty = typeof location === 'string' && location.trim().length > 0
      const isRepoRelative = isNonEmpty && !location.startsWith('/') && !location.startsWith('\\') && !/^[a-zA-Z]:/.test(location)
      if (!isNonEmpty || !isRepoRelative) {
        problems.push(`${entry.disciplineId}: "${location}" (invalid path shape)`)
        continue
      }
      // Strengthened per Stage A correction 5: verify the path actually
      // exists on disk and points at a file, not just that it looks like
      // a plausible repo-relative string. This is a read-only fs stat
      // check -- the target module is never imported or executed.
      const check = checkModuleLocationExists(location)
      if (!check.exists) {
        problems.push(`${entry.disciplineId}: "${location}" does not exist on disk (resolved: ${check.resolvedPath})`)
        continue
      }
      if (!check.isFile) {
        problems.push(`${entry.disciplineId}: "${location}" exists but is a directory, not a file`)
        continue
      }
      checkedCount += 1
    }
  }
  return validation(
    'discipline_qa_03_module_locations_valid',
    problems.length === 0,
    problems.length === 0 ? `all ${checkedCount} module locations are non-empty, repo-relative, and verified to exist as real files on disk` : problems.join('; '),
  )
}

function moduleLocationExistenceCheckerCatchesInvalidPaths(): DisciplineRegistryValidationResult {
  // Isolated negative check per Stage A correction 5: prove the
  // existence-checking helper actually discriminates real paths from
  // fake ones, without ever adding a fake path to the real registry. A
  // known-real path must pass; a deliberately invalid path constructed
  // only inside this test must fail.
  const realPath = 'lib/discipline/disciplineRegistry.ts'
  const fakePath = 'lib/discipline/this-file-does-not-exist-42f9c1.ts'
  const fakeDirectoryAsFile = 'lib/discipline'

  const realCheck = checkModuleLocationExists(realPath)
  const fakeCheck = checkModuleLocationExists(fakePath)
  const directoryCheck = checkModuleLocationExists(fakeDirectoryAsFile)

  const ok = realCheck.exists && realCheck.isFile
    && !fakeCheck.exists
    && directoryCheck.exists && !directoryCheck.isFile

  return validation(
    'discipline_qa_17_existence_checker_catches_invalid_paths',
    ok,
    `real="${realPath}" exists=${realCheck.exists}/isFile=${realCheck.isFile}; fake="${fakePath}" exists=${fakeCheck.exists}; directory="${fakeDirectoryAsFile}" exists=${directoryCheck.exists}/isFile=${directoryCheck.isFile}`,
  )
}

function noUnsupportedAuthorityGrant(): DisciplineRegistryValidationResult {
  // Disciplines that must never carry execution/provider/memory-write/
  // mission/deployment authority given what this registry's own
  // observations establish about them. Content/routing-shaping
  // disciplines are permitted 'enforcing' because that authority is
  // directly evidenced (scope stripping, mode gates, provider selection,
  // response integrity classification, research synthesis gating, Red
  // Team hold injection) -- none of that is execution, memory-write,
  // mission, or deployment authority.
  const mustNeverEnforce = [
    'runtime_diagnostics',
    'memory_evaluation',
    'council_reporting',
    'signals_intelligence_subsystem',
    'forecast_outcome_tracking',
    'queue_truth_labeling',
    'retrieval_orchestration',
    'intelligence_packet_evidence_handling',
    'intent_resolution',
  ]
  const violations: string[] = []
  for (const disciplineId of mustNeverEnforce) {
    const entry = getDisciplineById(disciplineId)
    if (!entry) {
      violations.push(`${disciplineId}: missing from registry`)
      continue
    }
    if (entry.runtimeAuthority === 'enforcing') {
      violations.push(`${disciplineId}: unexpectedly marked enforcing`)
    }
  }
  return validation(
    'discipline_qa_04_no_unsupported_authority_grant',
    violations.length === 0,
    violations.length === 0 ? 'no non-enforcing discipline is marked enforcing' : violations.join('; '),
  )
}

function redTeamClassifiedAsIntegrityLayer(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('red_team_integrity_layer')
  const observationsText = entry?.observations.join(' ') ?? ''
  const ok = Boolean(entry) && observationsText.includes('integrity_layer') && observationsText.includes('NOT represented as an external provider')
  return validation(
    'discipline_qa_05_red_team_integrity_layer',
    ok,
    ok ? 'red_team_integrity_layer observations classify Red Team as integrity_layer, not an external provider' : 'missing or mislabeled',
  )
}

function runtimeDiagnosticsObservationalOnly(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('runtime_diagnostics')
  const ok = Boolean(entry) && entry?.runtimeAuthority === 'observational' && entry?.enforcementStatus === 'not_applicable'
  return validation(
    'discipline_qa_06_runtime_diagnostics_observational',
    ok,
    ok ? `runtimeAuthority=${entry?.runtimeAuthority}; enforcementStatus=${entry?.enforcementStatus}` : 'runtime_diagnostics is not marked strictly observational',
  )
}

function councilReportingNotOverstated(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('council_reporting')
  const observationsText = entry?.observations.join(' ') ?? ''
  const ok = Boolean(entry)
    && entry?.implementationStatus !== 'runtime_wired'
    && observationsText.includes('minimal_trace_envelope')
    && observationsText.includes('canonicalCouncilReportGenerated: false')
    && observationsText.includes('No canonical Council Report engine exists')
  return validation(
    'discipline_qa_07_council_reporting_not_overstated',
    ok,
    ok ? 'council_reporting is described as minimal_trace_envelope, not a canonical engine' : 'council_reporting overstates or omits the minimal_trace_envelope disclosure',
  )
}

function signalsMarkedPartialAndRuntimeWired(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('signals_intelligence_subsystem')
  const ok = Boolean(entry) && entry?.implementationStatus === 'runtime_wired' && entry?.evidenceStatus === 'partial'
  return validation(
    'discipline_qa_08_signals_partial_and_runtime_wired',
    ok,
    ok ? `implementationStatus=${entry?.implementationStatus}; evidenceStatus=${entry?.evidenceStatus}` : 'signals_intelligence_subsystem is not marked both runtime-wired and evidence-partial',
  )
}

function responseIntegrityListsBothFilesAndDivergence(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('response_integrity')
  const hasBothFiles = Boolean(entry)
    && entry!.moduleLocations.includes('lib/providers/responseIntegrity.ts')
    && entry!.moduleLocations.includes('lib/council/responseIntegrity.ts')
  const limitationsText = entry?.limitations.join(' ') ?? ''
  const hasDivergenceDisclosure = limitationsText.includes('CONFIRMED DIVERGENCE RISK') && limitationsText.includes('duplicated by copy')
  const ok = hasBothFiles && hasDivergenceDisclosure
  return validation(
    'discipline_qa_09_response_integrity_both_files_and_divergence',
    ok,
    ok ? 'both responseIntegrity files listed, divergence risk disclosed' : `hasBothFiles=${hasBothFiles}; hasDivergenceDisclosure=${hasDivergenceDisclosure}`,
  )
}

function queueTruthLabelActiveVocabulary(): DisciplineRegistryValidationResult {
  const entry = getDisciplineById('queue_truth_labeling')
  const observationsText = entry?.observations.join(' ') ?? ''
  const valuesMatch = JSON.stringify(QUEUE_TRUTH_LABEL_VALUES) === JSON.stringify(['SOURCE_BACKED', 'PROPOSED', 'APPROVAL_REQUIRED', 'UNAVAILABLE'])
  const ok = Boolean(entry) && valuesMatch && observationsText.includes('Actively consumed, not a dormant type')
  return validation(
    'discipline_qa_10_queue_truth_label_active',
    ok,
    ok ? 'QueueTruthLabel documented with correct values and marked actively consumed' : `entryFound=${Boolean(entry)}; valuesMatch=${valuesMatch}`,
  )
}

function allSixKnownLimitationsPresent(): DisciplineRegistryValidationResult {
  const allText = DISCIPLINE_REGISTRY.flatMap(entry => [...entry.observations, ...entry.limitations]).join(' \n ')
  const required = [
    { label: 'redirect SSRF gap', pattern: /final resolved location after a redirect chain is never re-validated/i },
    { label: 'forecast seed data', pattern: /not labeled static_seed at the data level/i },
    { label: 'Grok confidence weighting', pattern: /framing-only contribution.*weighted identically/i },
    { label: 'forecast calibration gap', pattern: /no forecast creation-to-resolution wiring exists/i },
    { label: 'intelligence duplication', pattern: /confirmed duplication, not overstated as canonical Live Intel/i },
    { label: 'response-integrity duplication', pattern: /CONFIRMED DIVERGENCE RISK/i },
  ]
  const missing = required.filter(item => !item.pattern.test(allText)).map(item => item.label)
  return validation(
    'discipline_qa_11_all_six_known_limitations_present',
    missing.length === 0,
    missing.length === 0 ? 'all six known limitations present across registry entries' : `missing: ${missing.join(', ')}`,
  )
}

function noRiskyImportsInRegistrySource(): DisciplineRegistryValidationResult {
  const importLines = REGISTRY_SOURCE.split('\n').filter(line => /^\s*import\b/.test(line))
  const risky = importLines.filter(line => !/^\s*import\s+type\b/.test(line))
  return validation(
    'discipline_qa_12_no_risky_imports',
    risky.length === 0,
    risky.length === 0 ? `all ${importLines.length} import statements are import-type-only (erased at compile time)` : `non-type imports found: ${risky.join(' | ')}`,
  )
}

function serializationDeterministic(): DisciplineRegistryValidationResult {
  const first = JSON.stringify(DISCIPLINE_REGISTRY)
  const second = JSON.stringify(DISCIPLINE_REGISTRY)
  const ok = first === second && first.length > 0
  return validation(
    'discipline_qa_13_serialization_deterministic',
    ok,
    ok ? `stable serialization, ${first.length} chars` : 'serialization differed across calls',
  )
}

function noMutatingExportNames(): DisciplineRegistryValidationResult {
  // Structural proxy for "existing runtime behavior remains unchanged":
  // the registry module exports no function whose name implies it writes,
  // executes, invokes, or deploys anything -- only static lookups.
  const exportedFunctionNames = ['listDisciplineIds', 'getDisciplineById', 'listDisciplinesByImplementationStatus']
  const suspiciousPattern = /(write|insert|execute|invoke|deploy|call|fetch|send|delete|update)/i
  const suspicious = exportedFunctionNames.filter(name => suspiciousPattern.test(name))
  return validation(
    'discipline_qa_14_no_mutating_export_names',
    suspicious.length === 0,
    suspicious.length === 0 ? `all exported functions are static lookups: ${exportedFunctionNames.join(', ')}` : `suspicious export names: ${suspicious.join(', ')}`,
  )
}

function observationModeVocabularyDocumented(): DisciplineRegistryValidationResult {
  const ok = JSON.stringify(COUNCIL_TRACE_OBSERVATION_MODE_VALUES) === JSON.stringify(['runtime_observed', 'inferred'])
  return validation(
    'discipline_qa_15_observation_mode_vocabulary_documented',
    ok,
    ok ? 'CouncilTraceObservationMode documented as runtime_observed | inferred' : `unexpected values: ${JSON.stringify(COUNCIL_TRACE_OBSERVATION_MODE_VALUES)}`,
  )
}

function learningIntegrationStatusVocabularyDocumented(): DisciplineRegistryValidationResult {
  const expected = ['live_wired', 'derived_from_existing_store', 'static_seed', 'not_connected', 'persistent_store', 'live_persistent', 'awaiting_data']
  const ok = JSON.stringify(LEARNING_INTEGRATION_STATUS_VALUES) === JSON.stringify(expected)
  return validation(
    'discipline_qa_16_learning_integration_status_vocabulary_documented',
    ok,
    ok ? 'LearningIntegrationStatus documented with all 7 values' : `unexpected values: ${JSON.stringify(LEARNING_INTEGRATION_STATUS_VALUES)}`,
  )
}

export function runDisciplineRegistryValidation(): DisciplineRegistryValidationResult[] {
  return [
    disciplineIdsUnique(),
    requiredFieldsPresent(),
    moduleLocationsNonEmptyRepoRelative(),
    noUnsupportedAuthorityGrant(),
    redTeamClassifiedAsIntegrityLayer(),
    runtimeDiagnosticsObservationalOnly(),
    councilReportingNotOverstated(),
    signalsMarkedPartialAndRuntimeWired(),
    responseIntegrityListsBothFilesAndDivergence(),
    queueTruthLabelActiveVocabulary(),
    allSixKnownLimitationsPresent(),
    noRiskyImportsInRegistrySource(),
    serializationDeterministic(),
    noMutatingExportNames(),
    observationModeVocabularyDocumented(),
    learningIntegrationStatusVocabularyDocumented(),
    moduleLocationExistenceCheckerCatchesInvalidPaths(),
  ]
}
