/** Node 24 builtin SQLite type bridge until @types/node is updated from major 20.
 * Runtime implementation is provided exclusively by node:sqlite; no replacement code. */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
  export class StatementSync {
    run(...values: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    get(...values: unknown[]): Record<string, unknown> | undefined
    all(...values: unknown[]): Record<string, unknown>[]
  }
}
