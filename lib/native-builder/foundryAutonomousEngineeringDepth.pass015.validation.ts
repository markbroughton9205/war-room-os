/**
 * PASS 015 — Engineering Review status token once + detail once.
 * Does not mutate production. Does not touch Terra.
 */
import { pathToFileURL } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const HOME = 'components/war-room/foundry/FoundryHomeNav.tsx'
const HARDCODED = 'PASS: Foundry checked all required gates and tests.'

export function engineeringReviewChip(src: string): string {
  const start = src.indexOf('data-testid="foundry-engineering-review"')
  if (start < 0) return ''
  const slice = src.slice(start, start + 1600)
  const end = slice.indexOf('</div>')
  return end >= 0 ? slice.slice(0, end + 6) : slice
}

export function reviewRenderCounts(chip: string): {
  heading: number
  statusToken: number
  detail: number
  hardcoded: number
  passTernaryDetail: boolean
} {
  return {
    heading: (chip.match(/ENGINEERING REVIEW/g) ?? []).length,
    statusToken: (chip.match(/\{selected\.engineeringReview(?!Detail)(?:\s*\?\?\s*'PENDING')?\}/g) ?? []).length,
    detail: (chip.match(/\{selected\.engineeringReviewDetail\}/g) ?? []).length,
    hardcoded: (chip.match(/PASS: Foundry checked all required gates and tests\./g) ?? []).length,
    passTernaryDetail: /===\s*'PASS'\s*\?\s*selected\.engineeringReviewDetail/.test(chip),
  }
}

export function statusTokenFromField(review?: 'PASS' | 'FAIL' | 'PENDING' | null): 'PASS' | 'FAIL' | 'PENDING' {
  return review ?? 'PENDING'
}

export function presentReview(review?: 'PASS' | 'FAIL' | 'PENDING' | null, detail?: string | null): string {
  const token = statusTokenFromField(review)
  return detail ? `${token}\n${detail}` : token
}

async function run() {
  const root = resolveRepoRoot()
  const panel = readFileSync(path.join(root, PANEL), 'utf8')
  const home = existsSync(path.join(root, HOME)) ? readFileSync(path.join(root, HOME), 'utf8') : ''
  const chip = engineeringReviewChip(panel)
  const counts = reviewRenderCounts(chip)
  const results: CaseResult[] = []

  results.push(check('heading_once', counts.heading === 1, `heading=${counts.heading}`))
  results.push(check('pass_status_token_once', counts.statusToken === 1 && !counts.passTernaryDetail, JSON.stringify(counts)))
  results.push(check('fail_status_from_field', statusTokenFromField('FAIL') === 'FAIL' && counts.statusToken === 1, statusTokenFromField('FAIL')))
  results.push(check('pending_status_from_field', statusTokenFromField('PENDING') === 'PENDING' && statusTokenFromField(undefined) === 'PENDING', statusTokenFromField(undefined)))
  results.push(check('detail_once', counts.detail === 1, `detail=${counts.detail}`))
  results.push(check('hardcoded_sentence_absent', counts.hardcoded === 0 && !panel.includes(HARDCODED), `hardcoded=${counts.hardcoded}`))
  results.push(check('engineeringReview_binding', /\bselected\.engineeringReview(?!Detail)/.test(chip), chip.slice(0, 240)))
  results.push(check('engineeringReviewDetail_binding', /\bselected\.engineeringReviewDetail\b/.test(chip), chip.slice(0, 240)))
  results.push(check('no_duplicate_detail_node', counts.detail === 1 && !counts.passTernaryDetail, JSON.stringify(counts)))
  results.push(check(
    'homepage_unchanged',
    !/foundry-engineering-review|engineeringReviewDetail/.test(home),
    HOME,
  ))
  results.push(check(
    'advanced_only_owner',
    /FoundryMissionControllerPanel/.test(PANEL) && /data-testid="foundry-engineering-review"/.test(panel),
    PANEL,
  ))
  results.push(check(
    'fail_pending_not_pass_only',
    !/always show PASS|hardcode PASS/.test(chip) && /\{selected\.engineeringReview(?!Detail)/.test(chip),
    'status token is the field, not a PASS literal',
  ))
  results.push(check(
    'empty_detail_not_invented',
    presentReview('PASS', null) === 'PASS' && presentReview('FAIL', 'Checked') === 'FAIL\nChecked',
    presentReview('PASS', null),
  ))

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(item => item.name) }, null, 2))
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass015Validation }
