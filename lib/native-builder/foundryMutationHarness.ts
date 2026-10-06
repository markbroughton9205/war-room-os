/**
 * Mutation checks for pure modules: a validator is only worth what it catches. Each mutation removes or reverses one rule of a module; a copy of the
 * module with that one change is loaded next to the original, the validator's scenarios run against it, and at least one scenario must fail. A rule no
 * scenario notices is a rule nothing protects.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type Mutation = { name: string; from: string; to: string }

export type MutationOutcome = { name: string; caught: boolean; failed: string[] }

/** Runs `scenarios` against a copy of `file` with the mutation applied. `scenarios` returns the names of the scenarios that failed. */
export async function runMutation<T>(file: string, mutation: Mutation, scenarios: (module: T) => string[]): Promise<MutationOutcome> {
  const source = readFileSync(file, 'utf8')
  if (source.split(mutation.from).length !== 2) return { name: mutation.name, caught: false, failed: [`mutation text not found exactly once: ${mutation.from.slice(0, 60)}`] }
  const copy = path.join(path.dirname(file), `${path.basename(file, '.ts')}.mutant-${process.pid}.ts`)
  try {
    writeFileSync(copy, source.replace(mutation.from, mutation.to), 'utf8')
    const loaded = await import(`${pathToFileURL(copy).href}?m=${Date.now()}`) as T
    const failed = scenarios(loaded)
    return { name: mutation.name, caught: failed.length > 0, failed }
  } catch (error) {
    // A mutant that no longer loads is not a caught rule: the mutation must change behaviour, not break the module.
    return { name: mutation.name, caught: false, failed: [`mutant did not load: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`] }
  } finally {
    rmSync(copy, { force: true })
  }
}
