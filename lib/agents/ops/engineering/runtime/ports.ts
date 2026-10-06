/** Ports the engineering workflow depends on. Real implementations live beside this file; tests may supply labelled doubles. */
export type ModelResult =
  | { ok: true; text: string; executor: { provider: string; model: string }; promptTokens: number | 'UNKNOWN'; outputTokens: number | 'UNKNOWN'; latencyMs: number; isTestDouble?: boolean }
  | { ok: false; detail: string; executor: { provider: string; model: string } | 'UNKNOWN' }
export interface ModelClient {
  generate(input: { system: string; prompt: string; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; json?: boolean; temperature?: number; seed?: number }): Promise<ModelResult>
}

export type CommandRecord = { argv: string[]; cwd: string; exitCode: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number; startedAt: string; outputHash: string; refused?: string }
export interface WorkspacePort {
  readonly root: string
  read(rel: string): string
  exists(rel: string): boolean
  write(rel: string, content: string): { beforeHash: string | null; afterHash: string }
  hash(rel: string): string | null
  list(): string[]
  snapshot(): Record<string, string>
}
