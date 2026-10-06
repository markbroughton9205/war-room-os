import { runWrGa01 } from './fixture-01-short-path'
import { runWrGa02 } from './fixture-02-system-status'
import { runWrGa07 } from './fixture-07-voice-truth'
import { runWrGa08 } from './fixture-08-email-send-ask'

export async function runWrGaFixtures() {
  const ga01 = await runWrGa01()
  const ga02 = runWrGa02()
  const ga07 = runWrGa07()
  const ga08 = runWrGa08()
  return [
    { id: 'WR-GA-1', pass: ga01.pass, details: ga01 },
    { id: 'WR-GA-2', pass: ga02.pass, details: ga02 },
    { id: 'WR-GA-7', pass: ga07.pass, details: ga07 },
    { id: 'WR-GA-8', pass: ga08.pass, details: ga08 },
  ]
}
