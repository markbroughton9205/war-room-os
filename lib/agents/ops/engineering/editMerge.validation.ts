/** Phase 10 continuation: declaration-level merge of append blocks (found through real Qwen3 / Devstral echo-the-file failures). Run: pnpm run validate:agent-eng-editmerge */
import { harness } from './engtestkit'
import { mergeAppend } from './editMerge'
import { parseEditReply } from './prompts'
import { indexSource, topLevelDuplicates } from './workspaceIndex'

const { check, finish } = harness('AGENT_ENG_EDITMERGE_VALIDATION')
const CUR = `import { allItems, pushItem } from './todoList.mjs'

export function checkTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title is required')
  return title.trim()
}

export function listTodos() {
  return allItems()
}
`
// 1. the real failure shape: the reply echoes everything that exists and then adds new code
const ECHO = `import { allItems, pushItem } from './todoList.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

export function checkTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title is required')
  return title.trim()
}

export function listTodos() {
  return allItems()
}

export function listTasks(status) {
  return allItems().filter((t) => !status || t.status === status)
}
`
const m1 = mergeAppend('src/todoService.mjs', CUR, ECHO)
const e1 = indexSource('src/todoService.mjs', m1.content, new Set())
check('E01_an_echoed_file_plus_new_code_merges_to_each_declaration_once_and_the_new_function_added', topLevelDuplicates('x.mjs', m1.content).length === 0 && e1.exports.includes('listTasks') && e1.exports.includes('checkTitle') && e1.exports.includes('listTodos') && m1.content.includes("from 'node:fs'") && m1.notes.some((n) => n.includes('dropped echoed declaration checkTitle')), JSON.stringify(m1.notes))
// 2. a changed re-declaration replaces the old one
const m2 = mergeAppend('src/todoService.mjs', CUR, `export function listTodos() {\n  return allItems().slice(0, 100)\n}\n`)
check('E02_a_re_declaration_with_a_different_body_replaces_the_existing_declaration_in_place', topLevelDuplicates('x.mjs', m2.content).length === 0 && m2.content.includes('slice(0, 100)') && !m2.content.includes('return allItems()\n}') && m2.notes.some((n) => n.startsWith('replaced')))
// 3. imports merge
const m3 = mergeAppend('src/todoService.mjs', CUR, `import { allItems, pushItem, countItems } from './todoList.mjs'\nexport function total() { return countItems() }\n`)
check('E03_new_names_from_an_already_imported_module_are_merged_into_the_existing_import', (m3.content.match(/from '\.\/todoList\.mjs'/g) ?? []).length === 1 && /countItems/.test(m3.content.split('\n')[0]) && topLevelDuplicates('x.mjs', m3.content).length === 0, m3.content.split('\n')[0])
// 4. a conflict that cannot be merged mechanically is left for the gate (wrapper under an imported name)
const m4 = mergeAppend('src/svc.mjs', `export function a() { return 1 }\n`, `import { f } from './store.mjs'\nexport function f(x) { return f(x) }\n`)
check('E04_a_wrapper_declared_under_an_imported_name_is_not_hidden_the_duplicate_stays_visible_to_the_static_gate', topLevelDuplicates('x.mjs', m4.content).includes('f'))
// 5. nothing new
const m5 = mergeAppend('src/todoService.mjs', CUR, CUR)
check('E05_an_append_that_only_echoes_the_file_changes_nothing', m5.content === CUR)
const p5 = parseEditReply('```append\n' + CUR + '```', CUR, 'src/todoService.mjs')
check('E06_the_edit_parser_reports_a_pure_echo_as_no_change_rather_than_writing_a_broken_file', p5.kind === 'invalid' && /change nothing/.test((p5 as { reason: string }).reason))
const p6 = parseEditReply('```append\n' + ECHO + '```', CUR, 'src/todoService.mjs')
check('E07_the_edit_parser_applies_the_merge_for_the_real_echo_shape', p6.kind === 'code' && p6.mode === 'edits' && topLevelDuplicates('x.mjs', p6.content).length === 0 && p6.content.includes('listTasks'))
// 8. plain appends are unchanged behaviour
const m8 = mergeAppend('src/todoService.mjs', CUR, `export function extra() { return 1 }\n`)
check('E08_a_plain_append_of_new_code_still_appends_exactly_that_code', m8.content === CUR.replace(/\s*$/, '\n\n') + 'export function extra() { return 1 }\n')
finish()
