/** Deterministic import-path repair. Run: pnpm run validate:agent-eng-importfix */
import { harness } from './engtestkit'
import { addMissingMjsExtension, fixImports } from './importFix'

const { check, finish } = harness('AGENT_ENG_IMPORTFIX_VALIDATION')
const files = ['lib/agents/ops/assignmentFilter.mjs', 'test/a.test.mjs', 'src/util.mjs', 'src/dup/util.mjs', 'components/Panel.tsx']
const fx = (file: string, src: string) => fixImports(file, src, files)
check('I01_a_wrong_relative_path_and_extension_is_rewritten_to_the_one_matching_file', fx('test/a.test.mjs', "import { x } from '../../lib/agents/ops/assignmentFilter.js'\n")?.content === "import { x } from '../lib/agents/ops/assignmentFilter.mjs'\n")
check('I02_an_import_that_already_resolves_is_untouched', fx('test/a.test.mjs', "import { x } from '../lib/agents/ops/assignmentFilter.mjs'\n") === null)
check('I03_an_ambiguous_match_is_left_for_the_normal_repair_loop', fx('test/a.test.mjs', "import { u } from '../../util.mjs'\n") === null && fx('test/a.test.mjs', "import { u } from './missing-thing.mjs'\n") === null)
check('I04_an_alias_specifier_keeps_its_alias_form', fx('components/Panel.tsx', "import { f } from '@/agents/ops/assignmentFilter'\n")?.content === "import { f } from '@/lib/agents/ops/assignmentFilter.mjs'\n")
check('I05_dynamic_import_and_require_are_handled_and_quotes_kept', fx('test/a.test.mjs', 'const m = await import("../../lib/agents/ops/assignmentFilter.js")\n')?.content === 'const m = await import("../lib/agents/ops/assignmentFilter.mjs")\n')
check('I06_a_package_import_is_never_touched', fx('test/a.test.mjs', "import test from 'node:test'\nimport x from 'react'\n") === null)
check('I07_an_extensionless_alias_import_of_an_mjs_module_gets_its_extension', addMissingMjsExtension("import { f } from '@/lib/agents/ops/assignmentFilter'\n", files)?.content === "import { f } from '@/lib/agents/ops/assignmentFilter.mjs'\n" && addMissingMjsExtension("import { f } from '@/components/Panel'\n", files) === null)
check('I08_the_fixes_are_reported_for_the_receipt', (fx('test/a.test.mjs', "import { x } from '../../lib/agents/ops/assignmentFilter.js'\n")?.fixes ?? []).length === 1)
finish()
