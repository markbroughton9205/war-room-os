import type { ModelRole } from '../roles'

export type CheckResult = { pass: boolean; detail: string; /** optional label for per-class tallies (e.g. vulnerable vs clean) */ klass?: string }
export type Fixture = {
  id: string
  role: ModelRole
  system: string
  prompt: string
  json?: boolean
  maxTokens?: number
  /** Deterministic verdict on the model's reply. Never calls a model. */
  check: (reply: string) => Promise<CheckResult> | CheckResult
  /** Reference answer used only to validate the fixture itself (the checker must pass it, and must reject `broken`). */
  reference?: string
  broken?: string
}
