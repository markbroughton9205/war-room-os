declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; enableForeignKeyConstraints?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }

  export class StatementSync {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  export class Session {}
  export class constants {}
  export function backup(): unknown
}
