/**
 * Deterministic regression suite for the aircraft heading -> billboard-rotation conversion. Run
 * directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftOrientation.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { terraAircraftBillboardRotationRadians } from './aircraftOrientation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function approxEquals(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('heading_north_is_unrotated', approxEquals(terraAircraftBillboardRotationRadians(0), 0), String(terraAircraftBillboardRotationRadians(0))))
  results.push(check('heading_east_rotates_negative_quarter_turn', approxEquals(terraAircraftBillboardRotationRadians(90), -Math.PI / 2), String(terraAircraftBillboardRotationRadians(90))))
  results.push(check('heading_south_rotates_negative_half_turn', approxEquals(terraAircraftBillboardRotationRadians(180), -Math.PI), String(terraAircraftBillboardRotationRadians(180))))
  results.push(check('heading_west_rotates_negative_three_quarter_turn', approxEquals(terraAircraftBillboardRotationRadians(270), -(3 * Math.PI) / 2), String(terraAircraftBillboardRotationRadians(270))))
  results.push(check('rotation_is_linear_and_sign_reversing', approxEquals(terraAircraftBillboardRotationRadians(45), -terraAircraftBillboardRotationRadians(-45)), String(terraAircraftBillboardRotationRadians(45))))

  return results
}

export function runAircraftOrientationValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftOrientationValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftOrientation validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
