/**
 * Foundry Ask validation: the read-only answer path is tool-less, reads only real files,
 * calls the model once, and reports failures honestly. Uses a fake model and a spy filesystem.
 */
import { ASK_SYSTEM_PROMPT, answerAsk, buildAskPrompt, extractMentionedPaths, pickAskFiles, type AskDeps } from './foundryAsk'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const FILES = ['README.md', 'commander-facts.json', 'foundry-memory.json', 'backend/api.py', 'frontend/view.py', 'shared/contract.py', 'tests/test_tickets.py', 'archive/n01.py', '__pycache__/x.pyc', 'notes/keep.txt']
const CONTENT: Record<string, string> = {
  'backend/api.py': 'def list_tickets(query=None):\n    return []\n',
  'shared/contract.py': 'STATUS_QUERY = "status"\n',
  'frontend/view.py': 'def visible(status=None):\n    return []\n',
}

function harness(answer = 'It lists tickets, optionally filtered by status.') {
  const reads: string[] = []
  const calls: { system: string; prompt: string }[] = []
  const deps: AskDeps = {
    fileNames: FILES,
    readFile: async path => { reads.push(path); return path in CONTENT ? { ok: true, content: CONTENT[path] } : { ok: false, error: 'missing' } },
    complete: async input => { calls.push(input); return { ok: true, text: answer, model: 'qwen2.5-coder:14b' } },
  }
  return { deps, reads, calls }
}

async function main() {
  check('mentions_are_extracted', JSON.stringify(extractMentionedPaths('what does @backend/api.py do? and @shared/contract.py')) === '["backend/api.py","shared/contract.py"]', 'mentions')
  check('mention_needs_a_file_extension', extractMentionedPaths('email me @home please').length === 0, 'no false positives')

  const picked = pickAskFiles({ question: 'Explain the view', mentioned: [], fileNames: FILES })
  check('named_file_is_picked_first', picked[0] === 'frontend/view.py', picked.join(','))
  check('noise_and_tests_are_never_picked', picked.every(p => !p.startsWith('archive/') && !p.includes('__pycache__') && !p.startsWith('tests/')), picked.join(','))
  check('foundry_metadata_files_are_never_sources', !pickAskFiles({ question: 'explain', mentioned: [], fileNames: FILES }).some(p => /commander-facts|foundry-memory/.test(p)) && !buildAskPrompt('q', [], FILES).includes('foundry-memory'), 'metadata excluded')
  check('mentioned_file_outranks_the_rest', pickAskFiles({ question: 'x', mentioned: ['shared/contract.py'], fileNames: FILES })[0] === 'shared/contract.py', 'mention first')
  check('unknown_mentions_are_never_invented', !pickAskFiles({ question: 'x', mentioned: ['nope/ghost.py'], fileNames: FILES }).includes('nope/ghost.py'), 'ghost')
  check('file_count_is_bounded', pickAskFiles({ question: 'x', mentioned: [], fileNames: Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`), limit: 3 }).length === 3, 'limit')

  const { deps, reads, calls } = harness()
  const outcome = await answerAsk(deps, 'What does @backend/api.py do?')
  check('answers_from_real_files', outcome.ok && outcome.answer.startsWith('It lists tickets') && outcome.filesUsed.includes('backend/api.py'), outcome.ok ? outcome.filesUsed.join(',') : outcome.detail)
  check('sources_are_reported', outcome.ok && /\n\nSources: .*backend\/api\.py/.test(outcome.answer), outcome.ok ? outcome.answer.split('\n').pop() ?? '' : '')
  check('only_reads_happen', reads.every(path => FILES.includes(path)) && reads.length >= 1, reads.join(','))
  check('model_called_exactly_once', calls.length === 1, String(calls.length))
  check('prompt_declares_read_only', calls[0].system === ASK_SYSTEM_PROMPT && calls[0].system.includes('read-only') && calls[0].system.includes('never claim to have done so'), 'system prompt')
  check('prompt_carries_the_source_and_question', calls[0].prompt.includes('QUESTION: What does @backend/api.py do?') && calls[0].prompt.includes('SOURCE backend/api.py') && calls[0].prompt.includes('list_tickets'), 'prompt')
  check('prompt_offers_no_tools', !/tool|file\.replace|write|run command/i.test(calls[0].prompt) && Object.keys(deps).sort().join(',') === 'complete,fileNames,readFile', 'deps are read-only')

  const long = harness('x'.repeat(9000))
  const trimmed = await answerAsk(long.deps, 'Explain the contract')
  check('answer_is_bounded', trimmed.ok && trimmed.answer.length < 3200, trimmed.ok ? String(trimmed.answer.length) : trimmed.detail)

  const bigFile = harness()
  bigFile.deps.readFile = async () => ({ ok: true, content: 'y'.repeat(20000) })
  await answerAsk(bigFile.deps, 'Explain @backend/api.py')
  check('file_excerpts_are_bounded', bigFile.calls[0].prompt.length < 4000 * 6 + 2000, String(bigFile.calls[0].prompt.length))

  const failing = harness()
  failing.deps.complete = async () => ({ ok: false, detail: 'Unreachable: connect ECONNREFUSED' })
  const failed = await answerAsk(failing.deps, 'Explain the view')
  check('model_failure_is_reported_honestly', !failed.ok && failed.detail.includes('ECONNREFUSED'), failed.ok ? 'no' : failed.detail)
  const empty = harness('   ')
  const emptyOut = await answerAsk(empty.deps, 'Explain the view')
  check('empty_answer_is_a_failure_not_a_fabrication', !emptyOut.ok, emptyOut.ok ? 'ok?' : emptyOut.detail)
  check('blank_question_is_rejected_without_a_model_call', (await answerAsk(harness().deps, '   ')).ok === false && harness().calls.length === 0, 'blank')

  const unreadable = harness()
  unreadable.deps.readFile = async () => ({ ok: false, error: 'EACCES' })
  const noFiles = await answerAsk(unreadable.deps, 'Explain the view')
  check('unreadable_files_are_skipped_not_invented', noFiles.ok && noFiles.filesUsed.length === 0 && !noFiles.answer.includes('Sources:') && !unreadable.calls[0].prompt.includes('SOURCE '), noFiles.ok ? 'answered without sources' : noFiles.detail)
  check('build_prompt_lists_project_files_but_not_noise', buildAskPrompt('q', [], FILES).includes('backend/api.py') && !buildAskPrompt('q', [], FILES).includes('__pycache__'), 'listing')

  const failed2 = results.filter(result => !result.pass)
  console.log(`ASK_VALIDATION ${failed2.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed2.length}/${results.length}`)
  if (failed2.length) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
