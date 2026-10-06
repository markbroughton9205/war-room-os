export function novaNormalizeTable(rows: Array<Record<string, string | number>>): {
  columns: string[]
  rows: Array<Record<string, string | number>>
  novelty: 'NEW_STRUCTURE'
} {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
  return {
    columns,
    rows: rows.map(row => {
      const next: Record<string, string | number> = {}
      for (const column of columns) next[column] = row[column] ?? ''
      return next
    }),
    novelty: 'NEW_STRUCTURE',
  }
}

export function novaSafeCalculate(expression: string): { ok: true; value: number; novelty: 'NEW_QUANT_RESULT' } | { ok: false; reason: string } {
  const match = expression.trim().match(/^(-?\d+(?:\.\d+)?)\s*([+*/-])\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return { ok: false, reason: 'NOVA refuses free-form hallucinated calculations.' }
  const a = Number(match[1])
  const b = Number(match[3])
  const op = match[2]
  if (op === '+') return { ok: true, value: a + b, novelty: 'NEW_QUANT_RESULT' }
  if (op === '-') return { ok: true, value: a - b, novelty: 'NEW_QUANT_RESULT' }
  if (op === '*') return { ok: true, value: a * b, novelty: 'NEW_QUANT_RESULT' }
  if (op === '/' && b !== 0) return { ok: true, value: a / b, novelty: 'NEW_QUANT_RESULT' }
  return { ok: false, reason: 'Division by zero or unsupported operator.' }
}

export function novaRejectsProseOnlyDump(output: string, hasStructure: boolean): boolean {
  return !hasStructure && output.length > 400
}
