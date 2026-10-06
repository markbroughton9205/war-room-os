/**
 * Cause first (pure: no filesystem, network or clock).
 *
 * When the runtime evidence shows the cause of a failure, the repair belongs at the cause. A change that hard-codes the symptom (the odd key, the stray
 * character) makes the test pass and leaves the cause in place. Each known cause carries the hint that names the real repair and the tell-tale of a
 * workaround, so the model is pointed at the cause before it edits and a workaround is refused when it edits anyway.
 */

export type CauseId = 'BYTE_ORDER_MARK'

export type Cause = { id: CauseId; hint: string }

/** U+FEFF written any way it can be written in source: the character itself, ﻿ / ﻿, or the UTF-8 bytes \xef\xbb\xbf. */
const BOM_TEXT = /﻿|\\u[fF][eE][fF][fF]|\\x[eE][fF]\\x[bB][bB]\\x[bB][fF]|\bBOM\b|byte[- ]order mark/

const BOM_HINT = "The data file starts with a byte-order mark (U+FEFF), which is why the first column name shows as '\\ufeff<name>'. The repair is at the read: open the file with encoding='utf-8-sig' so the mark is dropped. Do not write the mark into the code, and do not look the column up under its odd name."

/** The causes the runtime evidence shows. */
export function causesIn(evidence: string): Cause[] {
  const causes: Cause[] = []
  if (BOM_TEXT.test(evidence)) causes.push({ id: 'BYTE_ORDER_MARK', hint: BOM_HINT })
  return causes
}

/** Source text without comment lines (`#` and `//`), so a note that mentions the mark is not mistaken for code that spells it out. */
function codeOnly(text: string): string {
  return text.split('\n').filter(line => !/^\s*(?:#|\/\/)/.test(line)).join('\n')
}

const BOM_IN_CODE = /﻿|\\u[fF][eE][fF][fF]|\\x[eE][fF]\\x[bB][bB]\\x[bB][fF]/

export type Workaround = { cause: CauseId; because: string }

/** The edit writes the symptom into the code (the mark spelled out) instead of repairing the cause the evidence shows. `before` and `after` are the changed region. */
export function workaroundFor(causes: readonly Cause[], region: { before: string; after: string }): Workaround | null {
  if (causes.some(cause => cause.id === 'BYTE_ORDER_MARK') && BOM_IN_CODE.test(codeOnly(region.after)) && !BOM_IN_CODE.test(codeOnly(region.before))) {
    return { cause: 'BYTE_ORDER_MARK', because: "the change spells the byte-order mark out in the code; the cause is how the file is opened (encoding='utf-8-sig')" }
  }
  return null
}

export function causeRefusalNote(work: Workaround): string {
  return work.cause === 'BYTE_ORDER_MARK'
    ? "I did not write the odd character into the code: the file starts with a byte-order mark, so I'm fixing how the file is read instead."
    : 'I did not apply a change that only hides the symptom.'
}
