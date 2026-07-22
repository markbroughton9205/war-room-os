import { readFileSync } from 'node:fs'

const migrationPath = 'supabase/war_room_phase48dba_server_table_privileges.sql'
const preflightPath = 'supabase/verification/preflight_war_room_server_table_privileges.sql'
const verifyPath = 'supabase/verification/verify_war_room_server_table_privileges.sql'
const rollbackPath = 'supabase/rollback/rollback_war_room_phase48dba_server_table_privileges.sql'
const docPath = 'docs/architecture/PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md'

const migration = readFileSync(migrationPath, 'utf8').toLowerCase()
const preflight = readFileSync(preflightPath, 'utf8').toLowerCase()
const verify = readFileSync(verifyPath, 'utf8').toLowerCase()
const rollback = readFileSync(rollbackPath, 'utf8').toLowerCase()
const doc = readFileSync(docPath, 'utf8').toLowerCase()

// Strips line comments and blanks out single-quoted string contents. Used
// before scanning for dangerous top-level SQL keywords/statements, so a
// keyword safely embedded inside a quoted string passed to EXECUTE (used
// for version-gated MAINTAIN handling) never triggers a false positive,
// and a keyword smuggled OUTSIDE quotes (i.e. actually live top-level SQL)
// is never hidden by a similarly-named string literal.
function sqlWithoutCommentsOrStrings(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'([^']|'')*'/g, "''")
}

// Strips comments ONLY (keeps string literals intact). Used everywhere a
// check must prove something about EXECUTABLE SQL and must not be
// satisfiable by a `-- comment` mentioning the right words. This is the
// direct fix for the R2 mutation gap where a hardcoded literal survived
// because the check only tested for the column-alias substring, which a
// stray comment could also supply.
function stripComments(sql) {
  return sql.replace(/--.*$/gm, '')
}

const tables = [
  'war_room_permissions_state',
  'war_room_sentinel_scans',
  'war_room_economic_provider_effectiveness',
  'war_room_economic_proposals',
  'war_room_economic_telemetry',
  'war_room_economic_unresolved_operations',
  'war_room_economic_active_missions',
]

const canonicalPrivilegeMap = {
  war_room_permissions_state: ['SELECT', 'INSERT', 'UPDATE'],
  war_room_sentinel_scans: ['SELECT', 'INSERT'],
  war_room_economic_provider_effectiveness: ['SELECT', 'INSERT', 'UPDATE'],
  war_room_economic_proposals: ['SELECT', 'INSERT'],
  war_room_economic_telemetry: ['SELECT', 'INSERT'],
  war_room_economic_active_missions: ['SELECT', 'INSERT'],
  war_room_economic_unresolved_operations: ['SELECT', 'INSERT'],
}
const knownPrivilegeTokens = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'])

const expectedGrantLines = [
  'grant select, insert, update on table public.war_room_permissions_state to service_role;',
  'grant select, insert on table public.war_room_sentinel_scans to service_role;',
  'grant select, insert on table public.war_room_economic_proposals to service_role;',
  'grant select, insert on table public.war_room_economic_telemetry to service_role;',
  'grant select, insert, update on table public.war_room_economic_provider_effectiveness to service_role;',
  'grant select, insert on table public.war_room_economic_active_missions to service_role;',
  'grant select, insert on table public.war_room_economic_unresolved_operations to service_role;',
]

// The rollback must revoke exactly the mirror image of the forward grants
// above (same tables, same privileges, from service_role) -- no more, no
// less.
const expectedRollbackRevokeStatements = expectedGrantLines.map(line =>
  line
    .replace(/^grant /, 'revoke ')
    .replace(/ to service_role;$/, ' from service_role;'),
)

// service_role's TRUNCATE/REFERENCES/TRIGGER privileges were never touched
// by the forward migration, so the rollback must never grant or revoke
// them for service_role -- only anon/authenticated get them restored.
const expectedRollbackRestoreGrantStatements = tables.map(
  table => `grant truncate, references, trigger on table public.${table} to anon, authenticated;`,
)

function check(caseId, passed, detail) {
  return { caseId, result: passed ? 'PASS' : 'FAIL', detail }
}

function normalizeStatements(sql) {
  return sqlWithoutCommentsOrStrings(sql)
    .split(';')
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(part => `${part};`)
}

function setsEqual(actual, expected) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  return a.length === e.length && a.every((value, index) => value === e[index])
}

// Captures the content of every single-quoted string passed directly to
// EXECUTE, unescaping doubled quotes. This is real SQL that runs (just
// deferred/conditionally, for version-safety) and must be structurally
// validated -- it must not be invisible to statement-level checks just
// because it is quoted.
// Requires the closing quote to be immediately followed by the statement
// terminator (only whitespace in between). This is deliberately stricter
// than "a quoted string appears somewhere after EXECUTE": without the
// trailing-`;` anchor, `execute 'a' || 'b';` would match on just `'a'` and
// silently treat everything after it (the concatenation) as if it weren't
// there, which is exactly the kind of dynamic-SQL form STEP 8 requires
// this validator to fail closed on, not silently truncate.
const EXECUTE_SIMPLE_LITERAL_RE = /execute\s+'((?:[^']|'')*)'\s*;/g

function extractExecuteStrings(sql) {
  const withoutComments = stripComments(sql)
  return [...withoutComments.matchAll(EXECUTE_SIMPLE_LITERAL_RE)]
    .map(m => m[1].replace(/''/g, "'").replace(/\s+/g, ' ').trim())
}

// Extracts the body of a `startMarker( ... )` block by paren-depth tracking
// (not a naive "find the next )"), so nested tuple parens inside the body
// don't truncate extraction early.
function extractParenBlock(text, startMarker) {
  const idx = text.indexOf(startMarker)
  if (idx === -1) return null
  let i = idx + startMarker.length
  let depth = 1
  const start = i
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    i++
  }
  if (depth !== 0) return null
  return text.slice(start, i - 1)
}

// Same as extractParenBlock, but only searches for startMarker AFTER the
// first occurrence of afterMarker. Used to disambiguate a generic marker
// like `from (` (which appears many times in a file) by anchoring it to a
// preceding, query-specific piece of live SQL (a column alias unique to
// that query) rather than a prose comment, which is more resistant to
// incidental drift and cannot be satisfied by a comment alone.
function extractParenBlockAfter(text, afterMarker, startMarker) {
  const afterIdx = text.indexOf(afterMarker)
  if (afterIdx === -1) return null
  return extractParenBlock(text.slice(afterIdx), startMarker)
}

// Within a block shaped like `('table_a', ...), ('table_b', ...)` or
// `('table_a'), ('table_b')`, returns the first quoted identifier of each
// tuple -- i.e. the table name column, not anything nested deeper (e.g.
// array[...] members in a two-column tuple).
function extractCteTableNames(cteBody) {
  return [...cteBody.matchAll(/\(\s*'([a-z0-9_]+)'/g)].map(m => m[1])
}

// Within a flat `IN ('a', 'b', 'c')`-style list (no per-item wrapping
// parens), returns every quoted identifier.
function extractQuotedIdentifiers(block) {
  return [...block.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1])
}

function normalizedIncludes(content, phrase) {
  return content.replace(/\s+/g, ' ').includes(phrase.replace(/\s+/g, ' ').trim())
}

const results = []
const requiredTableSet = [...tables].sort()

// =====================================================================
// affected_tables CTE: table-set AND exact per-table privilege-array
// validation, applied to both verify.sql and preflight.sql.
// =====================================================================
const affectedTablesCteMarker = 'affected_tables(table_name, required_privileges) as ('

// Extracts (table_name -> [privilege arrays found for that table, in file
// order]) from a two-column `('table', array['A','B'])` tuple list. Kept
// separate per-occurrence (not merged) so a duplicated table_name with two
// different arrays is visible rather than silently collapsed.
function extractTableToPrivilegeArrays(cteBody) {
  const tupleRe = /\(\s*'([a-z0-9_]+)'\s*,\s*array\[([^\]]*)\]\s*\)/g
  const map = new Map()
  let m
  while ((m = tupleRe.exec(cteBody)) !== null) {
    const tableName = m[1]
    const privileges = [...m[2].matchAll(/'([a-z]+)'/g)].map(p => p[1].toUpperCase())
    if (!map.has(tableName)) map.set(tableName, [])
    map.get(tableName).push(privileges)
  }
  return map
}

function validateAffectedTablesCte(label, content) {
  const body = extractParenBlock(content, affectedTablesCteMarker)
  if (body === null) {
    results.push(check(`dbpriv_${label}_affected_tables_cte_found`, false, 'could not locate affected_tables(table_name, required_privileges) as ( ... ) -- possible rename or structural disconnect'))
    return null
  }
  results.push(check(`dbpriv_${label}_affected_tables_cte_found`, true, 'affected_tables CTE located and extracted by paren-depth parsing'))
  const names = extractCteTableNames(body)
  const uniqueNames = [...new Set(names)]
  results.push(check(`dbpriv_${label}_affected_tables_cte_no_duplicates`, names.length === uniqueNames.length, `extracted table list: ${JSON.stringify(names)}`))
  results.push(check(`dbpriv_${label}_affected_tables_cte_exact_set`, setsEqual(uniqueNames, requiredTableSet), `CTE table set = ${JSON.stringify([...uniqueNames].sort())}, required = ${JSON.stringify(requiredTableSet)}`))

  // Exact per-table privilege-array validation (STEP 3). Compares the
  // MAPPING, not the union: a privilege copied from another table, two
  // tables swapped, a missing/extra/duplicate/unknown/empty array are all
  // caught because each table's own array is checked against ITS OWN
  // canonical requirement, independent of what any other table's array
  // contains. Privilege tokens are uppercased before comparison, so a
  // casing-only change (which has no SQL semantic effect -- privilege
  // names are matched case-insensitively by has_table_privilege) is
  // correctly NOT flagged.
  const privilegeMap = extractTableToPrivilegeArrays(body)
  for (const table of tables) {
    const entries = privilegeMap.get(table) || []
    results.push(check(`dbpriv_${label}_${table}_privilege_array_present_once`, entries.length === 1, `expected exactly one array[...] entry for ${table}, found ${entries.length}`))
    if (entries.length !== 1) continue
    const privileges = entries[0]
    const uniquePrivileges = [...new Set(privileges)]
    results.push(check(`dbpriv_${label}_${table}_privilege_array_no_duplicates`, privileges.length === uniquePrivileges.length, JSON.stringify(privileges)))
    results.push(check(`dbpriv_${label}_${table}_privilege_array_nonempty`, privileges.length > 0, 'array must not be empty'))
    const unknownTokens = privileges.filter(p => !knownPrivilegeTokens.has(p))
    results.push(check(`dbpriv_${label}_${table}_privilege_array_known_tokens`, unknownTokens.length === 0, `unknown privilege token(s): ${JSON.stringify(unknownTokens)}`))
    results.push(check(
      `dbpriv_${label}_${table}_privilege_array_matches_canonical`,
      setsEqual(uniquePrivileges, canonicalPrivilegeMap[table]),
      `found ${JSON.stringify([...uniquePrivileges].sort())}, required ${JSON.stringify([...canonicalPrivilegeMap[table]].sort())}`,
    ))
  }
  return privilegeMap
}

const verifyPrivilegeMap = validateAffectedTablesCte('verify', verify)
const preflightPrivilegeMap = validateAffectedTablesCte('preflight', preflight)

// Cross-file consistency: verify.sql and preflight.sql define the same
// required matrix independently -- they must match each other exactly, not
// just each individually happen to match canonical.
if (verifyPrivilegeMap && preflightPrivilegeMap) {
  for (const table of tables) {
    const verifyPrivs = (verifyPrivilegeMap.get(table) || [[]])[0] || []
    const preflightPrivs = (preflightPrivilegeMap.get(table) || [[]])[0] || []
    results.push(check(
      `dbpriv_${table}_privilege_array_matches_across_verify_and_preflight`,
      setsEqual([...new Set(verifyPrivs)], [...new Set(preflightPrivs)]),
      `verify=${JSON.stringify(verifyPrivs)}, preflight=${JSON.stringify(preflightPrivs)}`,
    ))
  }
}

// Prove the final PASS query and every intermediate CTE in verify.sql is
// actually sourced FROM affected_tables -- not a parallel, possibly
// incomplete, hardcoded list that happens to look similar.
results.push(check(
  'dbpriv_verify_required_checks_sourced_from_affected_tables',
  normalizedIncludes(verify, 'from affected_tables t cross join lateral unnest(t.required_privileges) as privilege_name'),
  'required_checks CTE must select from affected_tables',
))
results.push(check(
  'dbpriv_verify_extra_delete_check_sourced_from_affected_tables',
  normalizedIncludes(verify, "select t.table_name, has_table_privilege('service_role', 'public.' || t.table_name, 'delete') as service_role_has_delete from affected_tables t"),
  'extra_delete_check CTE must select from affected_tables',
))
results.push(check(
  'dbpriv_verify_browser_checks_sourced_from_affected_tables',
  normalizedIncludes(verify, "from affected_tables t cross join (values ('anon'), ('authenticated'), ('public')) as r(role_name)"),
  'browser_checks CTE must select from affected_tables',
))
results.push(check(
  'dbpriv_verify_table_checks_sourced_from_affected_tables',
  normalizedIncludes(verify, "from affected_tables t left join pg_class c on c.oid = to_regclass('public.' || t.table_name)"),
  'table_checks CTE must select from affected_tables',
))
results.push(check(
  'dbpriv_verify_final_pass_query_sourced_from_affected_tables',
  normalizedIncludes(verify, 'from affected_tables t join required_checks rc on rc.table_name = t.table_name join extra_delete_check edc on edc.table_name = t.table_name join table_checks tc on tc.table_name = t.table_name'),
  'final PASS query must join from affected_tables, not a disconnected/shadow source',
))

// Whole-file table-name mentions remain as a low-cost supplementary floor
// signal ONLY for migration/rollback, where the exact statement-set checks
// below already provide the authoritative proof.
for (const table of tables) {
  results.push(check(`dbpriv_${table}_migration_mentions`, migration.includes(`public.${table}`), table))
  results.push(check(`dbpriv_${table}_rollback_mentions`, rollback.includes(`public.${table}`), table))
}

// =====================================================================
// STEP 6: preflight.sql per-block structural coverage. The flat
// file-wide occurrence counter below is retained ONLY as a supplementary
// signal (per STEP 6, "may remain only as a supplementary check, not the
// authoritative coverage gate") -- it is not itself proof of anything.
// The per-block extraction here IS the authoritative gate: each of
// preflight's independently-scoped, target-table-referencing query blocks
// is located via a live-SQL anchor (a column alias unique to that query,
// not a comment) and its own table set is extracted and compared exactly.
// The same treatment is extended to verify.sql's two secondary blocks
// (pg_policies list, MAINTAIN tri-state list) for parity, since the same
// masking risk applies there.
// =====================================================================
function validateTableSetBlock(fileLabel, blockId, names) {
  if (names === null) {
    results.push(check(`dbpriv_${fileLabel}_block_${blockId}_found`, false, `could not locate the ${blockId} table-list block via its live-SQL anchor`))
    return
  }
  results.push(check(`dbpriv_${fileLabel}_block_${blockId}_found`, true, 'located'))
  const unique = [...new Set(names)]
  results.push(check(`dbpriv_${fileLabel}_block_${blockId}_no_duplicates`, names.length === unique.length, JSON.stringify(names)))
  results.push(check(`dbpriv_${fileLabel}_block_${blockId}_exact_seven_tables`, setsEqual(unique, requiredTableSet), `block table set = ${JSON.stringify([...unique].sort())}, required = ${JSON.stringify(requiredTableSet)}`))
}

// Block 1 (primary affected_tables privilege matrix) already validated above.

// Block 2: MAINTAIN reporting -- anchored on the `maintain_privilege_type_supported`
// column alias, which precedes this block's own `from (` in the same query.
{
  const block = extractParenBlockAfter(preflight, 'maintain_privilege_type_supported', 'from (')
  validateTableSetBlock('preflight', 'maintain_reporting', block === null ? null : extractCteTableNames(block))
}

// Block 3: explicit ACL-entry reporting -- anchored on `is_grantable`.
{
  const block = extractParenBlockAfter(preflight, 'is_grantable', 'from (')
  validateTableSetBlock('preflight', 'acl_entry_reporting', block === null ? null : extractCteTableNames(block))
}

// Block 4: policy metadata reporting -- the pg_policies `tablename in (...)` list.
{
  const block = extractParenBlock(preflight, 'and tablename in (')
  validateTableSetBlock('preflight', 'policy_metadata_reporting', block === null ? null : extractQuotedIdentifiers(block))
}

// Block 5: policy-presence / non-blocking-warning reporting -- the target_tables CTE.
{
  const block = extractParenBlock(preflight, 'target_tables(table_name) as (')
  validateTableSetBlock('preflight', 'policy_presence_reporting', block === null ? null : extractCteTableNames(block))
}

// Block 6: sequence-dependency reporting -- `cols.table_name in (...)`.
{
  const block = extractParenBlock(preflight, 'and cols.table_name in (')
  validateTableSetBlock('preflight', 'sequence_dependency_reporting', block === null ? null : extractQuotedIdentifiers(block))
}

// Block 7: owner/default-ACL reporting (final query) -- anchored on `unexpected_owner`.
{
  const block = extractParenBlockAfter(preflight, 'unexpected_owner', 'from (')
  validateTableSetBlock('preflight', 'owner_reporting', block === null ? null : extractCteTableNames(block))
}

// verify.sql secondary blocks, same treatment for parity.
{
  const block = extractParenBlock(verify, 'and tablename in (')
  validateTableSetBlock('verify', 'policy_metadata_reporting', block === null ? null : extractQuotedIdentifiers(block))
}
{
  const block = extractParenBlockAfter(verify, 'maintain_result', 'from (')
  validateTableSetBlock('verify', 'maintain_tristate_reporting', block === null ? null : extractCteTableNames(block))
}

// Supplementary (non-authoritative) whole-file occurrence anchoring --
// catches gross omissions cheaply, but per STEP 6 is never relied on alone.
const preflightExpectedOccurrencesPerTable = 7
const verifyExpectedOccurrencesPerTable = 3
for (const table of tables) {
  const preflightCount = (preflight.match(new RegExp(`'${table}'`, 'g')) || []).length
  const verifyCount = (verify.match(new RegExp(`'${table}'`, 'g')) || []).length
  results.push(check(
    `dbpriv_${table}_preflight_occurrence_count_supplementary`,
    preflightCount === preflightExpectedOccurrencesPerTable,
    `expected ${preflightExpectedOccurrencesPerTable} quoted occurrences across preflight's independent query blocks, found ${preflightCount}`,
  ))
  results.push(check(
    `dbpriv_${table}_verify_occurrence_count_supplementary`,
    verifyCount === verifyExpectedOccurrencesPerTable,
    `expected ${verifyExpectedOccurrencesPerTable} quoted occurrences across verify's independent query blocks, found ${verifyCount}`,
  ))
}

// =====================================================================
// STEP 3 (ALTER DEFAULT PRIVILEGES structural parsing): enumerate every
// top-level statement and every EXECUTE-embedded statement independently,
// normalize whitespace, and require an EXACT match against known-good
// canonical text.
// =====================================================================
function extractTopLevelAlterDefaultPrivileges(sql) {
  return normalizeStatements(sql).filter(s => /^alter\s+default\s+privileges\b/.test(s))
}

function extractExecuteAlterDefaultPrivileges(sql) {
  return extractExecuteStrings(sql)
    .filter(s => /^alter\s+default\s+privileges\b/.test(s))
    .map(s => `${s};`)
}

function validateDefaultAclStatements(label, content, expected) {
  const topLevel = extractTopLevelAlterDefaultPrivileges(content)
  const executeEmbedded = extractExecuteAlterDefaultPrivileges(content)
  results.push(check(
    `dbpriv_${label}_default_acl_top_level_statement_count`,
    topLevel.length === expected.topLevel.length,
    `expected ${expected.topLevel.length} top-level ALTER DEFAULT PRIVILEGES statement(s), found ${topLevel.length}: ${JSON.stringify(topLevel)}`,
  ))
  results.push(check(
    `dbpriv_${label}_default_acl_top_level_statement_exact`,
    setsEqual(topLevel, expected.topLevel),
    JSON.stringify(topLevel),
  ))
  results.push(check(
    `dbpriv_${label}_default_acl_execute_embedded_statement_count`,
    executeEmbedded.length === expected.executeEmbedded.length,
    `expected ${expected.executeEmbedded.length} EXECUTE-embedded ALTER DEFAULT PRIVILEGES statement(s), found ${executeEmbedded.length}: ${JSON.stringify(executeEmbedded)}`,
  ))
  results.push(check(
    `dbpriv_${label}_default_acl_execute_embedded_statement_exact`,
    setsEqual(executeEmbedded, expected.executeEmbedded),
    JSON.stringify(executeEmbedded),
  ))
}

validateDefaultAclStatements('migration', migration, {
  topLevel: ['alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;'],
  executeEmbedded: ['alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated;'],
})
validateDefaultAclStatements('rollback', rollback, {
  topLevel: ['alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to anon, authenticated;'],
  executeEmbedded: ['alter default privileges for role postgres in schema public grant maintain on tables to anon, authenticated;'],
})

// Migration's exact target-table grant set, scoped precisely to the seven
// table CRUD grants (excludes the unrelated `grant usage on schema public
// to service_role` baseline statement).
const migrationTableGrantStatements = normalizeStatements(migration)
  .filter(s => /^grant .* on table public\.war_room_/.test(s))
results.push(check(
  'dbpriv_migration_table_grant_set_matches_exactly',
  setsEqual(migrationTableGrantStatements, expectedGrantLines),
  JSON.stringify(migrationTableGrantStatements),
))
for (const line of expectedGrantLines) {
  results.push(check(`dbpriv_expected_grant_${expectedGrantLines.indexOf(line) + 1}`, migration.includes(line), line))
}

// --- Dangerous SQL patterns forbidden in BOTH the forward migration and
// the rollback.
const forbiddenPatterns = [
  ['no_grant_all', /\bgrant\s+all\b/],
  ['no_revoke_all', /\brevoke\s+all\b/],
  ['no_grant_all_tables', /grant\s+.+\s+on\s+all\s+tables/],
  ['no_disable_rls', /disable\s+row\s+level\s+security/],
  ['no_force_rls_mutation', /\b(force|no\s+force)\s+row\s+level\s+security\b/],
  ['no_drop_policy', /drop\s+policy/],
  ['no_create_policy', /create\s+policy/],
  ['no_drop_table', /drop\s+table/],
  ['no_insert_data_mutation', /\binsert\s+into\b/],
  ['no_update_data_mutation', /\bupdate\s+public\./],
  ['no_delete_data_mutation', /\bdelete\s+from\b/],
  ['no_security_definer', /security\s+definer/],
  ['no_create_function', /create\s+(or\s+replace\s+)?function/],
  ['no_ownership_change', /alter\s+table\s+[^;]*\bowner\s+to\b/],
  ['no_supabase_admin_reference', /supabase_admin/],
  ['default_acl_always_for_role_postgres', /alter\s+default\s+privileges\s+(?!for\s+role\s+postgres\b)/],
  [
    'no_default_browser_crud_grant',
    /alter\s+default\s+privileges[^;]*\bgrant\b[^;]*\b(select|insert|update|delete)\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/,
  ],
  [
    'no_unconditional_maintain_outside_exception_trap',
    /\b(grant|revoke|alter)\b[^;]*\bmaintain\b/,
  ],
]

for (const [name, pattern] of forbiddenPatterns) {
  const migrationScan = sqlWithoutCommentsOrStrings(migration)
  const rollbackScan = sqlWithoutCommentsOrStrings(rollback)
  results.push(check(`dbpriv_migration_${name}`, !pattern.test(migrationScan), String(pattern)))
  results.push(check(`dbpriv_rollback_${name}`, !pattern.test(rollbackScan), String(pattern)))
}

// --- service_role must never receive DELETE, existing-table or default.
for (const [label, content] of [['migration', migration], ['rollback', rollback]]) {
  results.push(check(
    `dbpriv_${label}_no_service_role_delete_grant`,
    !/\bgrant\s+[^;]*\bdelete\b[^;]*\bto\s+[^;]*\bservice_role\b/.test(content),
    'service_role DELETE',
  ))
  results.push(check(
    `dbpriv_${label}_no_service_role_default_delete_grant`,
    !/alter\s+default\s+privileges[^;]*\bgrant\b[^;]*\bdelete\b[^;]*\bto\b[^;]*\bservice_role\b/.test(content),
    'service_role default DELETE',
  ))
}

// --- Browser roles (anon, authenticated, PUBLIC) must never receive any
// existing-table CRUD grant.
for (const [label, content] of [['migration', migration], ['rollback', rollback]]) {
  for (const role of ['anon', 'authenticated', 'public']) {
    for (const privilege of ['select', 'insert', 'update', 'delete']) {
      results.push(check(
        `dbpriv_${label}_no_${role}_${privilege}_grant`,
        !new RegExp(`grant\\s+[^;]*\\b${privilege}\\b[^;]*\\bto\\s+[^;]*\\b${role}\\b`).test(content),
        `${role} ${privilege}`,
      ))
    }
  }
}

results.push(check('dbpriv_option1_no_future_service_role_crud_default', !/alter\s+default\s+privileges[^;]+grant\s+(select|insert|update|delete)\b/i.test(migration), 'no automatic future CRUD grant of any kind'))

// --- Transaction structure.
results.push(check('dbpriv_transaction_wrapped', migration.trim().startsWith('-- war room phase 48-db-a') && migration.includes('\nbegin;') && migration.trim().endsWith('commit;'), 'BEGIN/COMMIT'))
results.push(check('dbpriv_rollback_transaction_wrapped', rollback.trim().startsWith('-- rollback for war room phase 48-db-a') && rollback.includes('\nbegin;') && rollback.trim().endsWith('commit;'), 'rollback BEGIN/COMMIT'))

// --- Preflight/verification must remain strictly read-only.
results.push(check('dbpriv_preflight_read_only', !/\b(grant|revoke|alter|insert|update|delete|drop|create)\b/.test(sqlWithoutCommentsOrStrings(preflight)), 'preflight has SELECT/CTE only'))
results.push(check('dbpriv_verify_read_only', !/\b(grant|revoke|alter|insert|update|delete|drop|create)\b/.test(sqlWithoutCommentsOrStrings(verify)), 'verification has SELECT/CTE only'))

// --- Rollback scope-exactness: the rollback must contain EXACTLY the
// expected top-level GRANT/REVOKE statements -- not a superset (an added
// out-of-scope revoke/grant) and not a subset (a removed/omitted one).
const rollbackStatements = normalizeStatements(rollback)
const rollbackRevokeStatements = rollbackStatements.filter(s => s.startsWith('revoke '))
const rollbackGrantStatements = rollbackStatements.filter(s => s.startsWith('grant '))

results.push(check(
  'dbpriv_rollback_revoke_matches_forward_scope_exactly',
  setsEqual(rollbackRevokeStatements, expectedRollbackRevokeStatements),
  `expected ${expectedRollbackRevokeStatements.length} exact service_role revoke statements, found: ${JSON.stringify(rollbackRevokeStatements)}`,
))
results.push(check(
  'dbpriv_rollback_grant_matches_confirmed_baseline_exactly',
  setsEqual(rollbackGrantStatements, expectedRollbackRestoreGrantStatements),
  `expected ${expectedRollbackRestoreGrantStatements.length} exact anon/authenticated restore grants (no service_role), found: ${JSON.stringify(rollbackGrantStatements)}`,
))
results.push(check('dbpriv_rollback_has_baseline_dependent_label', rollback.includes('baseline-dependent') || rollback.includes('baseline-specific'), 'rollback explicitly labeled baseline-dependent'))
results.push(check('dbpriv_rollback_has_precondition_guard', rollback.includes('raise exception') && rollback.includes('precondition'), 'rollback aborts on unexpected live state instead of blind revoke'))
results.push(check('dbpriv_rollback_warns_insecure_default', rollback.includes('previously observed insecure default acl'), 'rollback warning'))

// --- rollback precondition must reject service_role DELETE across all
// seven target tables.
const rollbackDeletePreconditionChecks = (rollback.match(/has_table_privilege\('service_role', 'public\.\w+', 'delete'\)/g) || []).length
results.push(check(
  'dbpriv_rollback_precondition_rejects_service_role_delete',
  rollback.includes('service_role holds delete on at least one'),
  'rollback precondition must explicitly reject service_role DELETE before proceeding',
))
results.push(check(
  'dbpriv_rollback_precondition_delete_check_covers_all_seven_tables',
  rollbackDeletePreconditionChecks === 7,
  `expected 7 service_role DELETE precondition checks (one per target table), found ${rollbackDeletePreconditionChecks}`,
))
results.push(check(
  'dbpriv_rollback_precondition_wording_not_overclaiming',
  !rollback.includes('exact privilege set'),
  'rollback must not claim its guard proves an exact total privilege state',
))

// --- Preflight/verification hardening.
results.push(check('dbpriv_preflight_reports_force_rls', preflight.includes('relforcerowsecurity'), 'force RLS column'))
results.push(check('dbpriv_verify_reports_force_rls', verify.includes('relforcerowsecurity'), 'force RLS column'))
results.push(check('dbpriv_preflight_reports_bypassrls', preflight.includes('rolbypassrls'), 'BYPASSRLS flag'))
results.push(check('dbpriv_preflight_reports_sequence_dependency', preflight.includes('has_sequence_privilege'), 'sequence USAGE check'))
results.push(check('dbpriv_preflight_reports_public_role', preflight.includes("('public')"), 'PUBLIC role included in role matrix'))
results.push(check('dbpriv_verify_reports_public_role', verify.includes("('public')"), 'PUBLIC role included in browser checks'))
results.push(check('dbpriv_preflight_reports_supabase_admin_defaults', preflight.includes('supabase_admin'), 'supabase_admin default ACL surfaced for comparison'))
results.push(check('dbpriv_verify_reports_supabase_admin_defaults', verify.includes('supabase_admin'), 'supabase_admin default ACL surfaced for comparison'))
results.push(check('dbpriv_verify_reports_no_service_role_delete', verify.includes('pass_no_service_role_delete'), 'verification asserts no extra service_role DELETE'))
results.push(check('dbpriv_preflight_maintain_version_gated', preflight.includes('server_version_num'), 'preflight gates MAINTAIN checks on PostgreSQL 17+'))
results.push(check('dbpriv_verify_maintain_version_gated', verify.includes('server_version_num'), 'verification gates MAINTAIN checks on PostgreSQL 17+'))

// --- warning label must describe live catalog state, not repository state.
results.push(check('dbpriv_preflight_has_corrected_warning_label', preflight.includes('rls_enabled_no_database_policy_discovered_requires_runtime_confirmation'), 'explicit non-blocking warning string using the DATABASE-derived label'))
results.push(check('dbpriv_preflight_no_misleading_repo_warning_label', !preflight.includes('rls_enabled_no_repo_policy_discovered_requires_runtime_confirmation'), 'old misleading REPO-derived label must not reappear'))
results.push(check('dbpriv_doc_uses_corrected_warning_label', doc.includes('rls_enabled_no_database_policy_discovered_requires_runtime_confirmation'), 'doc must reference the corrected DATABASE-derived warning label'))
results.push(check('dbpriv_doc_no_misleading_repo_warning_label', !doc.includes('rls_enabled_no_repo_policy_discovered_requires_runtime_confirmation'), 'doc must not reference the old misleading REPO label'))

// =====================================================================
// STEP 4 (comment-safe structural checks) + STEP 5 (general raw ACL
// text-matching ban), both scoped to the actual default ACL verification
// block in verify.sql, extracted from live (comment-stripped) SQL --
// never satisfiable by a comment alone.
// =====================================================================
const defaultAclBlockStart = verify.indexOf('with default_acl_entries as (')
const defaultAclBlockEnd = verify.indexOf('supabase_admin default acl for public tables', defaultAclBlockStart === -1 ? 0 : defaultAclBlockStart)
const defaultAclBlockRaw = defaultAclBlockStart === -1
  ? null
  : (defaultAclBlockEnd === -1 ? verify.slice(defaultAclBlockStart) : verify.slice(defaultAclBlockStart, defaultAclBlockEnd))
const defaultAclBlockStripped = defaultAclBlockRaw === null ? '' : stripComments(defaultAclBlockRaw)

results.push(check('dbpriv_verify_default_acl_block_found', defaultAclBlockRaw !== null, 'could not locate the default ACL verification block (with default_acl_entries as ( ... ))'))
results.push(check(
  'dbpriv_verify_aclexplode_executable_call_in_default_acl_block',
  /aclexplode\s*\(/.test(defaultAclBlockStripped),
  'default ACL verification block must invoke aclexplode(...) in executable SQL -- a comment mentioning the word does not satisfy this',
))
results.push(check(
  'dbpriv_verify_default_acl_block_no_raw_text_matching',
  !/(::text\s*(like|ilike|~\*?|!~\*?)\b)|(\bcast\s*\([^)]*\bas\s+text\s*\)\s*(like|ilike)\b)/.test(defaultAclBlockStripped),
  'default ACL verification block must not apply ::text/CAST(...AS text) + LIKE/ILIKE/~/~* pattern matching to any ACL-derived value, under ANY alias',
))

results.push(check(
  'dbpriv_verify_bypassrls_executable_source',
  /select\s+rolbypassrls\s+from\s+pg_roles\s+where\s+rolname\s*=\s*'service_role'/.test(stripComments(verify).replace(/\s+/g, ' ')),
  'verify.sql must contain an executable SELECT rolbypassrls FROM pg_roles WHERE rolname = ... expression -- a comment mentioning the words does not satisfy this',
))
results.push(check(
  'dbpriv_verify_bypassrls_boolean_coalesced_against_null',
  /coalesce\s*\(\s*\(\s*select\s+rolbypassrls\s+from\s+pg_roles\s+where\s+rolname\s*=\s*'service_role'\s*\)\s*,\s*false\s*\)/.test(stripComments(verify).replace(/\s+/g, ' ')),
  'the BYPASSRLS boolean used in access-path OR/AND logic must be COALESCE-guarded to false so an absent service_role role never silently produces an ambiguous NULL result',
))
const bypassrlsTriStateLabels = ['service_role_absent', 'service_role_present_bypassrls_true', 'service_role_present_bypassrls_false']
results.push(check(
  'dbpriv_verify_bypassrls_state_is_explicit_tristate',
  bypassrlsTriStateLabels.every(label => stripComments(verify).includes(label)),
  'verify.sql must report an explicit three-state BYPASSRLS label distinguishing role-absent from role-present-false, in executable SQL',
))

results.push(check('dbpriv_verify_default_acl_checks_public_pseudo_role', verify.includes('grantee_oid = 0'), 'PUBLIC pseudo-role detected via grantee OID 0, not printed text'))
results.push(check('dbpriv_verify_default_acl_checks_service_role_delete', verify.includes("e.grantee_oid = 'service_role'::regrole") && verify.includes("e.privilege_type = 'delete'"), 'default ACL verification asserts no service_role default DELETE'))
results.push(check('dbpriv_verify_default_acl_checks_unexpected_grantee', verify.includes('pass_no_unexpected_default_acl_grantee'), 'default ACL verification rejects any unexpected grantee'))

results.push(check('dbpriv_verify_reports_rls_access_path_result', verify.includes('pass_service_role_rls_access_path'), 'explicit access-path result distinguishing named policy vs BYPASSRLS'))
const bypassOrPolicyOccurrences = (verify.match(/\(tc\.service_role_bypassrls or tc\.service_role_policy_present\)/g) || []).length
results.push(check(
  'dbpriv_verify_master_pass_accepts_bypassrls_or_policy',
  bypassOrPolicyOccurrences >= 2,
  `expected the "BYPASSRLS or named policy" condition used in both the standalone access-path result and the master pass_table_privilege_repair AND-chain, found ${bypassOrPolicyOccurrences} occurrence(s)`,
))

// --- MAINTAIN result must be an explicit tri-state label, never a false
// PASS for an unchecked (pre-PG17) version.
const maintainTriStateLabels = ['unsupported_postgresql_version', 'supported_and_correctly_absent', 'supported_but_unexpectedly_present']
results.push(check(
  'dbpriv_verify_maintain_result_is_explicit_tristate',
  maintainTriStateLabels.every(label => verify.includes(label)),
  'MAINTAIN result must report all three explicit states, never collapse an unsupported version into PASS or FAIL',
))

// =====================================================================
// STEP 8: EXECUTE parser fail-closed. Any `EXECUTE` usage in migration or
// rollback that is NOT a simple single-quoted literal (e.g. string
// concatenation, dollar-quoted dynamic SQL, format()) is explicitly
// unsupported by extractExecuteStrings and MUST cause a validator failure
// rather than being silently skipped -- silently ignoring an unparseable
// EXECUTE form would let dangerous dynamic SQL slip past every other
// EXECUTE-string-based check in this file.
// =====================================================================
function findUnparseableExecuteUsages(sql) {
  const stripped = stripComments(sql)
  const allExecuteMatches = [...stripped.matchAll(/\bexecute\b/g)]
  const parseableStartIndices = new Set([...stripped.matchAll(EXECUTE_SIMPLE_LITERAL_RE)].map(m => m.index))
  return allExecuteMatches.filter(m => !parseableStartIndices.has(m.index))
}
for (const [label, content] of [['migration', migration], ['rollback', rollback]]) {
  const unparseable = findUnparseableExecuteUsages(content)
  results.push(check(
    `dbpriv_${label}_execute_forms_all_simple_literals`,
    unparseable.length === 0,
    `found ${unparseable.length} EXECUTE usage(s) not in simple single-quoted-literal form (string concatenation, dollar-quoting, or a function call) -- failing closed rather than silently ignoring an unparseable dynamic-SQL form`,
  ))
}

// --- Doc coverage.
results.push(check('dbpriv_doc_incident_summary', doc.includes('42501'), 'doc includes root cause'))
results.push(check('dbpriv_doc_execution_requires_authorization', doc.includes('do not execute') && doc.includes('independent'), 'doc review boundary'))
results.push(check('dbpriv_doc_documents_rollback_design', doc.includes('option a') && doc.includes('baseline-specific'), 'doc names the chosen rollback design'))
results.push(check('dbpriv_doc_documents_rollback_limitations', doc.includes('rollback limitations'), 'doc states rollback limitations honestly'))
results.push(check('dbpriv_doc_documents_maintain_compatibility', doc.includes('maintain compatibility'), 'doc documents MAINTAIN compatibility approach'))
results.push(check('dbpriv_doc_documents_execute_parser_limitation', doc.includes('execute parser limitation'), "doc documents the EXECUTE parser's simple-single-quoted-literal-only constraint"))
// Doc's CRUD matrix table is documentation only -- it is never treated as
// executable proof of the actual grant set. That proof is the exact
// statement-set and privilege-array checks against migration/rollback/
// verify/preflight above.

const failed = results.filter(result => result.result === 'FAIL')
console.log(`DB privilege repair static validation: ${results.length - failed.length}/${results.length} PASS`)
for (const result of failed) {
  console.error(`${result.caseId}: ${result.detail}`)
}
if (failed.length) process.exitCode = 1
