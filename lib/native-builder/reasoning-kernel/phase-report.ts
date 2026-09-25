/**
 * Shared printer for a phase validator.
 */
import type { PhaseResult } from './later-fixtures'

export function reportPhase(title: string, results: PhaseResult[]): void {
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  console.log(`${results.length - failed.length}/${results.length} PASS`)
  console.log(title, failed.length ? 'FAIL' : 'PASS')
  if (failed.length) process.exit(1)
}
