/**
 * The guard every model edit passes before it is written (pure: no filesystem, network or clock).
 *
 * A PlannedEdit carries the WHOLE old source (`before`), the WHOLE new source (`after`) and the region of the old source that changed (`start`..`end`).
 * This turns that into the changed region on each side, applies the two general rules to the new region, and puts the whole file back together:
 *   1. unaffected elements stay (a name the file still uses is never taken away with the one being changed),
 *   2. the safer equivalent is written when two supported forms do the same job.
 */
import { forensicsOf, preserveUnaffected, type Binding, type EditForensics } from './foundryEditForensics'
import { preferSecureEquivalent, type SecureRewrite } from './foundrySecureDefaults'
import { causesIn, workaroundFor, type Workaround } from './foundryCauseRepairs'

export type EditLike = { before: string; after: string; start: number; end: number }

export type GuardedEdit = {
  /** The whole new source to write. Equal to the edit's own `after` when nothing had to change. */
  after: string
  changed: boolean
  restored: Binding[]
  rewrites: SecureRewrite[]
  /** The changed region on each side, for the record and for putting the change back later. */
  span: { start: number; end: number; before: string; after: string }
  forensics: EditForensics
  /** Set when the change hides the symptom of a cause the evidence shows instead of repairing it; the edit is then not applied. */
  refused?: Workaround
}

/** null when the edit cannot be read as a region (it does not line up with the source on disk); it is then applied exactly as proposed. */
export function guardPlannedEdit(input: { file: string; source: string; edit: EditLike; secureOff?: boolean; causeEvidence?: string }): GuardedEdit | null {
  const { file, source, edit } = input
  const tail = edit.before.length - edit.end
  const spanEnd = edit.after.length - tail
  if (edit.start < 0 || edit.end < edit.start || tail < 0 || spanEnd < edit.start) return null
  if (edit.after.slice(0, edit.start) !== edit.before.slice(0, edit.start) || edit.after.slice(spanEnd) !== edit.before.slice(edit.end)) return null
  // What is on disk must still be what the model saw around the change; otherwise the region is not where the edit thinks it is.
  if (source.slice(edit.start, edit.end) !== edit.before.slice(edit.start, edit.end)) return null
  const spanBefore = edit.before.slice(edit.start, edit.end)
  const spanAfter = edit.after.slice(edit.start, spanEnd)
  const kept = preserveUnaffected({ file, source: edit.before, start: edit.start, end: edit.end, after: spanAfter })
  const secured = input.secureOff ? { after: kept.after, rewrites: [] as SecureRewrite[] } : preferSecureEquivalent({ file, after: kept.after })
  const changed = secured.after !== spanAfter
  const workaround = input.causeEvidence ? workaroundFor(causesIn(input.causeEvidence), { before: spanBefore, after: secured.after }) : null
  const whole = edit.after.slice(0, edit.start) + secured.after + edit.after.slice(spanEnd)
  return {
    after: whole,
    changed,
    restored: kept.restored,
    rewrites: secured.rewrites,
    span: { start: edit.start, end: edit.end, before: spanBefore.slice(0, 2000), after: secured.after.slice(0, 2000) },
    forensics: forensicsOf({ file, source: edit.before, start: edit.start, end: edit.end, after: secured.after, restored: kept.restored }),
    ...(workaround ? { refused: workaround } : {}),
  }
}
