/* eslint-disable @typescript-eslint/no-explicit-any -- declaration shim for the reviewed isolated .mjs module (see PROVENANCE.md): the JS is the source of truth, TS callers get structural access */
export const hash: (...args: any[]) => any
export const canonical: (...args: any[]) => any
export class BlueprintError extends Error {
  code: string
  stage: string
  observed?: any
  expected?: any
  path?: string | null
  [key: string]: any
  constructor(code: string, stage: string, message: string, detail?: Record<string, any>)
}
export function refuse(code: string, stage: string, message: string, detail?: Record<string, any>): never
export function describeError(e: unknown, ctx?: Record<string, any>): { code: string; stage: string; message: string; retryable: boolean; nextAction: string; approvalRequired: boolean; [key: string]: any }
export const atomicWrite: (...args: any[]) => any
export const createExclusive: (...args: any[]) => any
export const readJson: (...args: any[]) => any
export const checkBindingOf: (...args: any[]) => any
export const UUID: any
export const path: (...args: any[]) => any
