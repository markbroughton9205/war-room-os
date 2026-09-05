/**
 * Deterministic regression suite for the camera-rectangle value signature — the fix for the
 * Council composer keystroke-loss bug (TerraShell's camera-hover-dismiss effect used to compare
 * useTerraCameraViewRectangle's returned rectangle by object identity; a hook that legitimately
 * returns a fresh wrapper object on every render, even when the underlying degrees haven't moved,
 * made that comparison misfire and could cascade into a render loop). Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/cameraRectSignature.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { terraCameraRectSignature } from './cameraRectSignature'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const rectA = { west: -80, south: 43, east: -79, north: 44 }
  const rectASameValuesDifferentObject = { west: -80, south: 43, east: -79, north: 44 }
  const rectB = { west: -80, south: 43, east: -79, north: 44.5 }

  results.push(check('null_rectangle_is_null_signature', terraCameraRectSignature(null) === null, 'no camera view yet'))
  results.push(
    check(
      'identical_values_in_a_fresh_object_produce_the_same_signature',
      terraCameraRectSignature(rectA) === terraCameraRectSignature(rectASameValuesDifferentObject) && rectA !== rectASameValuesDifferentObject,
      'a hook returning a new wrapper object every render must not look like a real camera move',
    ),
  )
  results.push(
    check(
      'materially_different_rectangle_produces_a_different_signature',
      terraCameraRectSignature(rectA) !== terraCameraRectSignature(rectB),
      'a real camera move must still be detected',
    ),
  )
  results.push(
    check(
      'signature_is_stable_across_repeated_calls',
      terraCameraRectSignature(rectA) === terraCameraRectSignature(rectA),
      'idempotent',
    ),
  )

  return results
}

export function runCameraRectSignatureValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCameraRectSignatureValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  if (failed.length > 0) process.exit(1)
}
