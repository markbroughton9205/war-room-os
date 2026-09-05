/** Truthful validator accumulator. Denominator is a fixed expected count, never the pass count. */

export type HarnessCheck = { name: string; ok: boolean; detail?: string }

export function createValidationHarness(label: string, expected: number) {
  const results: HarnessCheck[] = []

  const check = (name: string, fn: () => void) => {
    try {
      fn()
      results.push({ name, ok: true })
      console.log(`PASS ${name}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      results.push({ name, ok: false, detail })
      console.error(`FAIL ${name}: ${detail}`)
    }
  }

  const finish = (): never => {
    const total = results.length
    const passed = results.filter((item) => item.ok).length
    const failed = results.filter((item) => !item.ok).length
    console.log(`${label}: TOTAL=${total} EXPECTED=${expected} PASS=${passed} FAIL=${failed}`)
    if (failed === 0 && total === expected) {
      console.log(`${label}: ${passed}/${expected} PASS`)
      process.exit(0)
    }
    for (const item of results.filter((entry) => !entry.ok)) {
      console.error(`- ${item.name}${item.detail ? `: ${item.detail}` : ''}`)
    }
    if (total !== expected) {
      console.error(`${label}: ran ${total} checks but expected ${expected}`)
    }
    process.exit(1)
  }

  return { check, finish, results }
}
