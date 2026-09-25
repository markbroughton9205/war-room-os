/**
 * Plan-to-code fidelity.
 * Checks the file Foundry actually wrote against the approach it selected.
 * Predicates come from public symptoms, constraints, and the model summary.
 * They do not read the hidden verifier.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export type EngineeringPatchIntent = {
  targetBehavior: string
  mustChange: string[]
  mustPreserve: string[]
  mustNotDo: string[]
  expectedStructuralEffect?: string
  expectedRuntimeEffect?: string
}

export type PlanToCodeStatus = 'IMPLEMENTED' | 'PARTIAL' | 'CONTRADICTED' | 'UNCLEAR'
export type ImplementationFidelity = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNVERIFIED'

export type PlanToCodeCheck = {
  status: PlanToCodeStatus
  fidelity: ImplementationFidelity
  intendedChange: string
  observedDiffBehavior: string
  mismatch: string
  requiredCorrection: string
  reinspected: true
  planCorrectCodeWrong: boolean
}

export type FailureGapCategory =
  | 'DIAGNOSIS_WRONG'
  | 'PLAN_CORRECT_IMPLEMENTATION_WRONG'
  | 'PATCH_INCOMPLETE'
  | 'PRESERVATION_FAILURE'
  | 'TEST_REASONING_FAILURE'
  | 'CROSS_LAYER_MISALIGNMENT'
  | 'STRUCTURAL_REQUIREMENT_MISSED'
  | 'REPEATED_FAILED_APPROACH'
  | 'PROVIDER_FAILURE'
  | 'RESOURCE_EXHAUSTED'
  | 'UNKNOWN'

export type FailedCaseAuditRow = {
  caseId: string
  finalResult: 'FAIL'
  initialHypothesis: string
  selectedApproach: string
  actualPatchSummary: string
  verifierFailure: string
  replanCount: number
  modelCalls: number
  failureGapCategory: FailureGapCategory
  evidence: string
}

const FALSE_CONFIDENCE = /\b(fixed|done|this now parses once)\b/i

export function mission03FailedCaseAudit(): FailedCaseAuditRow[] {
  return [
    {
      caseId: 'REASON-M2-HOLDS',
      finalResult: 'FAIL',
      initialHypothesis: 'dueCount stayed 0 because place() pushed onto returns while dueCount read shelf.',
      selectedApproach: 'Recorded patches moved copies onto shelf or returned returns.length.',
      actualPatchSummary: 'One patch pushed every copy onto shelf and returned shelf.length. Another returned returns.length. Neither excluded a returned copy.',
      verifierFailure: 'accepted copies must be due; place() with returned true increased dueCount',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'PATCH_INCOMPLETE',
      evidence: 'Mission 02 run notes stored both disk patches and both verifier errors.',
    },
    {
      caseId: 'REASON-M2-INVOICE',
      finalResult: 'FAIL',
      initialHypothesis: 'The sealed field is currency and the test asserts true.',
      selectedApproach: 'Adversarial replan opened on assert.ok(true). Later drafts still left that assertion or imported a missing module.',
      actualPatchSummary: 'invoice.test.mjs kept assert.ok(true), then referenced invoice.currency without a local import, including a parent-directory path that was refused.',
      verifierFailure: 'public test still asserts true; invoice is not defined; module not found',
      replanCount: 1,
      modelCalls: 6,
      failureGapCategory: 'TEST_REASONING_FAILURE',
      evidence: 'Weak assert.ok(true) triggered the existing adversarial replan. The written test stayed tautological.',
    },
    {
      caseId: 'REASON-M2-PARTS',
      finalResult: 'FAIL',
      initialHypothesis: 'lookup() parses the catalog again on every row.',
      selectedApproach: 'Parse the blob once outside the loop.',
      actualPatchSummary: 'catalog.mjs still called JSON.parse inside the for loop. Later writes did not change the file.',
      verifierFailure: 'repeated parse',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'PLAN_CORRECT_IMPLEMENTATION_WRONG',
      evidence: 'suite.json rootCause says the blob is re-parsed in every loop cycle. The saved patch still contains JSON.parse inside the loop.',
    },
    {
      caseId: 'REASON-M2-ACTOR',
      finalResult: 'FAIL',
      initialHypothesis: 'Not retained. The full-suite process stopped before the patch text was saved.',
      selectedApproach: 'Not retained.',
      actualPatchSummary: 'No patch bytes were stored for this case.',
      verifierFailure: 'Not retained.',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'UNKNOWN',
      evidence: 'The full run printed FAIL with 6 calls, first=false, recovered=false, then the process stopped. No dossier or patch file remains.',
    },
    {
      caseId: 'REASON-M2-EVENTS',
      finalResult: 'FAIL',
      initialHypothesis: 'A repeated id must replace the JSON line rather than append a second copy.',
      selectedApproach: 'Read the JSONL file and replace the matching id before writing.',
      actualPatchSummary: 'file.replace_unique reported NO_CHANGE. The store bytes stayed on the append path.',
      verifierFailure: 'No verifier error was stored because the file bytes did not change.',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'PLAN_CORRECT_IMPLEMENTATION_WRONG',
      evidence: 'suite.json rootCause names JSON-line replacement. notes are three NO_CHANGE replace calls.',
    },
    {
      caseId: 'REASON-M2-CENTS',
      finalResult: 'FAIL',
      initialHypothesis: 'Both files use Math.floor and need one shared half-up rule.',
      selectedApproach: 'Add roundHalfUp and call it from quote.mjs and bill.mjs.',
      actualPatchSummary: 'rounding.mjs defined roundHalfUp. quote.mjs and bill.mjs called it without a binding import. Later writes did not change.',
      verifierFailure: 'ReferenceError: roundHalfUp is not defined',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'PATCH_INCOMPLETE',
      evidence: 'suite.json and the run notes show the helper file plus the unbound calls.',
    },
    {
      caseId: 'REASON-M2-BIN',
      finalResult: 'FAIL',
      initialHypothesis: 'store() parses the decoded value a second time.',
      selectedApproach: 'Stop the second parse in store().',
      actualPatchSummary: 'bin.mjs dropped the decode import, then added an unused titles export. decode was unbound.',
      verifierFailure: 'SyntaxError: does not provide an export named titles; ReferenceError: decode is not defined',
      replanCount: 0,
      modelCalls: 6,
      failureGapCategory: 'PATCH_INCOMPLETE',
      evidence: 'suite.json rootCause still says store() parses twice. The saved patches removed the import and chased a titles export.',
    },
  ]
}

export function deriveEngineeringPatchIntent(input: {
  symptom: string
  constraints: string[]
  approach?: string
  rootCause?: string
}): EngineeringPatchIntent {
  const blob = [input.symptom, ...input.constraints, input.approach ?? '', input.rootCause ?? ''].join('\n')
  const mustChange: string[] = []
  const mustPreserve: string[] = []
  const mustNotDo: string[] = []
  let structural: string | undefined
  let runtime: string | undefined
  if (/pars(?:e|es|ing)[\s\S]{0,80}(loop|every|again)|outside the loop|parse once/i.test(blob)) {
    mustChange.push('parsing location')
    mustNotDo.push('JSON.parse inside a for or while loop')
    mustPreserve.push('lookup result')
    structural = 'JSON.parse is outside every for and while loop'
  }
  if (/parses near one|keep parses/i.test(blob)) {
    mustNotDo.push('parses += 1 inside a for or while loop')
    mustChange.push('parse counter increments once per call')
  }
  if (/assert\.ok\(\s*true\s*\)|asserts true/i.test(blob)) {
    mustChange.push('test assertion')
    mustNotDo.push('assert.ok(true)')
    mustPreserve.push('sealed schema field name')
    structural = 'the test file does not contain assert.ok(true)'
  }
  if (/returned[\s\S]{0,80}(must not|not increase)|not increase \w*Count/i.test(blob)) {
    mustNotDo.push('the writer records every id and never reads returned')
    mustChange.push('returned copies are excluded from the count')
    mustPreserve.push('a normal lend still counts')
  }
  if (/returns list|dueCount equal/i.test(blob)) {
    mustNotDo.push('dueCount returns returns.length')
    mustChange.push('which copies are due')
    mustPreserve.push('place still accepts a returned option')
  }
  if (/module variable|one module/i.test(blob)) {
    mustNotDo.push('one module binding read by every returned handle')
    mustChange.push('where the bound name is stored')
    mustPreserve.push('the second bind still runs')
  }
  if (/repeated id must replace|rewrite the file as CSV/i.test(blob)) {
    mustNotDo.push('append a bare field or rewrite the store as CSV')
    mustChange.push('writeEvent replaces the JSON line with the same id')
    mustPreserve.push('existing JSON line layout')
  }
  if (/one rounding function|both consumers|half up through one/i.test(blob)) {
    mustNotDo.push('Math.floor left in a consumer')
    mustNotDo.push('a helper call with no local function and no import')
    mustChange.push('both consumers call one defined or imported helper')
    runtime = 'both consumers round 10.005 to 10.01'
  }
  if (/second time|parses twice|parse that object/i.test(blob)) {
    mustNotDo.push('JSON.parse on the value decode already returned')
    mustPreserve.push('decode keeps returning an object')
    mustChange.push('the store stops parsing the decoded object')
  }
  if (/productCode|field=sku|picker payload/i.test(blob)) {
    mustNotDo.push('gate still reads productCode while the contract field is sku')
    mustPreserve.push('picker payload keeps sku')
    mustChange.push('gate reads sku')
  }
  if (/mixed-case|toUpperCase|length must stay 1/i.test(blob)) {
    mustNotDo.push('toUpperCase on the tag')
    mustNotDo.push('an extra formatTag parameter')
    mustPreserve.push('formatTag.length stays 1')
    mustChange.push('trim without forcing upper case')
  }
  if (/subtracts|return the sum/i.test(blob)) {
    mustNotDo.push('return left - right')
    mustChange.push('add the two arguments')
    mustPreserve.push('the two-argument signature')
  }
  return {
    targetBehavior: input.symptom.slice(0, 280),
    mustChange,
    mustPreserve,
    mustNotDo,
    expectedStructuralEffect: structural,
    expectedRuntimeEffect: runtime,
  }
}

export function lineInsideLoop(source: string, pattern: RegExp): boolean {
  let depth = 0
  const floors: number[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (/\b(for|while)\b/.test(line)) floors.push(depth)
    if (floors.length && pattern.test(line)) return true
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    while (floors.length && depth <= floors[floors.length - 1]) floors.pop()
  }
  return false
}

export function calleeInsideLoop(source: string, callee: string): boolean {
  return lineInsideLoop(source, new RegExp(callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

function unboundCallees(source: string): string[] {
  const declared = new Set<string>(['JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'console', 'Boolean'])
  for (const match of source.matchAll(/function\s+([A-Za-z0-9_]+)/g)) declared.add(match[1])
  for (const match of source.matchAll(/import\s*\{([^}]+)\}/g)) {
    for (const piece of match[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) declared.add(name)
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_]+)/g)) declared.add(match[1])
  const missing: string[] = []
  for (const match of source.matchAll(/(^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[2]
    if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(name)) continue
    if (!declared.has(name)) missing.push(name)
  }
  return [...new Set(missing)]
}

const IDENTIFIER_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'const', 'let', 'var', 'export', 'import', 'from', 'new', 'typeof', 'await', 'async', 'true', 'false', 'null', 'undefined', 'of', 'in', 'case', 'break', 'throw', 'else'])

function unboundRoots(source: string): string[] {
  const declared = new Set<string>()
  for (const match of source.matchAll(/function\s+([A-Za-z0-9_]+)/g)) declared.add(match[1])
  for (const match of source.matchAll(/import\s+([A-Za-z0-9_]+)\s+from/g)) declared.add(match[1])
  for (const match of source.matchAll(/import\s*\{([^}]+)\}/g)) {
    for (const piece of match[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) declared.add(name)
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_]+)/g)) declared.add(match[1])
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"/g, '""')
  const missing: string[] = []
  for (const match of stripped.matchAll(/(^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[2]
    if (IDENTIFIER_WORDS.has(name) || declared.has(name)) continue
    missing.push(name)
  }
  return [...new Set(missing)]
}

function sharedModuleBinding(source: string): boolean {
  const decl = source.match(/^let\s+([A-Za-z0-9_]+)\s*=/m)
  if (!decl) return false
  const name = decl[1]
  return new RegExp(`=>\\s*${name}\\b`).test(source) && new RegExp(`\\b${name}\\s*=`).test(source)
}

export function inspectPlanAgainstSource(input: {
  intent: EngineeringPatchIntent
  files: Record<string, string>
  approach: string
}): PlanToCodeCheck {
  const source = Object.values(input.files).join('\n')
  const mismatches: string[] = []
  const approach = `${input.approach}\n${input.intent.targetBehavior}\n${input.intent.mustNotDo.join('\n')}`
  if (input.intent.mustNotDo.some(item => /JSON\.parse inside a for or while/i.test(item)) && calleeInsideLoop(source, 'JSON.parse')) {
    mismatches.push('JSON.parse remains inside a for or while loop')
  }
  if (input.intent.mustNotDo.some(item => /parses \+= 1 inside/i.test(item)) && lineInsideLoop(source, /parses\s*\+=/)) {
    mismatches.push('the parse counter still increments inside the loop')
  }
  for (const [name, body] of Object.entries(input.files)) {
    if (/from\s+['"]\/|from\s+['"]\.\.\//.test(body)) mismatches.push(`${name} imports an absolute or parent path`)
    if (name.endsWith('.test.mjs')) {
      const loose = unboundRoots(body)
      if (loose.length) mismatches.push(`${name} uses ${loose.join(', ')} without an import or declaration`)
    }
  }
  if (input.intent.mustNotDo.some(item => /assert\.ok\(true\)/i.test(item)) && /assert\.ok\(\s*true\s*\)/.test(source)) {
    mismatches.push('assert.ok(true) is still in the written test')
  }
  if (input.intent.mustNotDo.some(item => /returns\.length/i.test(item)) && /return\s+returns\.length/.test(source)) {
    mismatches.push('the count still returns returns.length')
  }
  if (input.intent.mustNotDo.some(item => /never reads returned/i.test(item))) {
    const writer = source.match(/(?:lend|place)\s*\([^)]*\)\s*\{[^}]*\}/)
    if (writer && /\.push\(/.test(writer[0]) && !/\breturned\b/.test(writer[0])) {
      mismatches.push('the writer records every id and never reads returned')
    }
  }
  if (input.intent.mustNotDo.some(item => /module binding/i.test(item)) && sharedModuleBinding(source)) {
    mismatches.push('a module-level binding is still read by every returned handle')
  }
  if (input.intent.mustNotDo.some(item => /bare field|CSV/i.test(item))) {
    if (/appendFileSync/.test(source) || /record\.bay\s*\+/.test(source) || /writeFileSync\([^)]*'bay/.test(source)) {
      mismatches.push('writeEvent still appends a bare field or rewrites CSV')
    }
    if (/JSON\.parse\(\s*file\s*\)/.test(source) && !/readFileSync\(\s*file/.test(source)) {
      mismatches.push('the path string is parsed as JSON and the file contents are not read')
    }
  }
  if (input.intent.mustNotDo.some(item => /Math\.floor/i.test(item)) && /Math\.floor/.test(source)) {
    mismatches.push('Math.floor is still in a consumer')
  }
  if (input.intent.mustNotDo.some(item => /no local function and no import/i.test(item))) {
    for (const [name, body] of Object.entries(input.files)) {
      const missing = unboundCallees(body)
      if (missing.length) mismatches.push(`${name} calls ${missing.join(', ')} without a local function or import`)
    }
  }
  if (input.intent.mustNotDo.some(item => /decode already returned/i.test(item))) {
    for (const [name, body] of Object.entries(input.files)) {
      if (name.includes('decode')) continue
      if (/JSON\.parse/.test(body) && /decode\(/.test(body)) mismatches.push(`${name} still parses the decoded value`)
    }
  }
  if (input.intent.mustNotDo.some(item => /productCode/i.test(item)) && /productCode/.test(source) && !/body\.sku/.test(source)) {
    mismatches.push('gate still reads productCode')
  }
  if (input.intent.mustNotDo.some(item => /toUpperCase/i.test(item)) && /toUpperCase\(/.test(source)) {
    mismatches.push('toUpperCase is still applied to the tag')
  }
  if (input.intent.mustNotDo.some(item => /extra formatTag parameter/i.test(item)) && /function formatTag\([^)]*,/.test(source)) {
    mismatches.push('formatTag gained a parameter')
  }
  if (input.intent.mustNotDo.some(item => /left - right/i.test(item)) && /left\s*-\s*right/.test(source)) {
    mismatches.push('add still subtracts')
  }
  const planSaidOutside = /outside the loop|parse once|once per|parses near one/i.test(approach)
  const planCorrectCodeWrong = planSaidOutside && mismatches.some(item => /JSON\.parse remains inside|parse counter still increments/i.test(item))
  if (!input.intent.mustNotDo.length) {
    return {
      status: 'UNCLEAR',
      fidelity: 'UNVERIFIED',
      intendedChange: input.intent.targetBehavior,
      observedDiffBehavior: 'No public structural predicate was derived.',
      mismatch: '',
      requiredCorrection: '',
      reinspected: true,
      planCorrectCodeWrong: false,
    }
  }
  if (!mismatches.length) {
    return {
      status: 'IMPLEMENTED',
      fidelity: 'MATCH',
      intendedChange: input.intent.mustChange.join('; ') || input.intent.targetBehavior,
      observedDiffBehavior: 'Re-read source satisfies the public must-not list.',
      mismatch: '',
      requiredCorrection: '',
      reinspected: true,
      planCorrectCodeWrong: false,
    }
  }
  const contradicted = mismatches.length >= input.intent.mustNotDo.length || planCorrectCodeWrong || mismatches.some(item => /remains|still/.test(item))
  return {
    status: contradicted ? 'CONTRADICTED' : 'PARTIAL',
    fidelity: 'MISMATCH',
    intendedChange: input.intent.mustChange.join('; ') || input.intent.targetBehavior,
    observedDiffBehavior: mismatches.join(' | '),
    mismatch: mismatches.join(' | '),
    requiredCorrection: mismatches[0],
    reinspected: true,
    planCorrectCodeWrong,
  }
}

export function readProjectFiles(root: string, names: string[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of names) {
    try {
      files[name] = readFileSync(path.join(root, name), 'utf8')
    } catch {
      files[name] = ''
    }
  }
  return files
}

export function falseConfidencePhrase(text: string): boolean {
  return FALSE_CONFIDENCE.test(text)
}

export function canonicalPartsContradiction(): PlanToCodeCheck {
  const intent = deriveEngineeringPatchIntent({
    symptom: 'lookup() parses the whole catalog again on every row. Return the matching part and keep parses near one.',
    constraints: ['Do not raise a LIMIT constant.'],
    approach: 'parse catalog once outside the loop',
    rootCause: 'The blob is re-parsed in every loop cycle.',
  })
  return inspectPlanAgainstSource({
    intent,
    approach: 'parse catalog once outside the loop',
    files: {
      'catalog.mjs': `export function lookup(parts, id) {
  const blob = JSON.stringify(parts)
  for (const part of parts) {
    const again = JSON.parse(blob)
    if (part.id === id) return again
  }
}
`,
    },
  })
}
