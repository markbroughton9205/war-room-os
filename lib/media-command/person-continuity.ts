/**
 * Cross-video person continuity. Track continuity ≠ biometric identity.
 * Default labels: Person 1, Person 2. Never bake names into pixels.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { analysisDir } from './video-intelligence'
import { stripSecrets } from './secrets'
import { newJobId } from './jobs'

export type PersonEnrollmentType = 'visual-continuity' | 'human-confirmed' | 'biometric-opt-in'

export type PersonMatchStatus = 'SUGGESTED MATCH' | 'CONFIRMED MATCH' | 'REJECTED MATCH'

export type PersonEntity = {
  personEntityId: string
  projectId: string
  displayLabel: string
  enrollmentType: PersonEnrollmentType
  sourceAssetIds: string[]
  evidence: Array<{ assetId: string; note: string; appearanceHash?: string }>
  confidence: number
  biometricTemplateRef: string | null
  createdAt: string
  matchStatus: PersonMatchStatus
}

export type PersonContinuityDoc = {
  schemaVersion: 1
  projectId: string
  entities: PersonEntity[]
  audit: Array<{ at: string; action: 'suggest' | 'confirm' | 'reject' | 'split' | 'merge'; actor: string; entityIds: string[]; note: string }>
}

export function personContinuityPath(projectId: string): string {
  return path.join(analysisDir(projectId), 'person-continuity.json')
}

export function emptyPersonDoc(projectId: string): PersonContinuityDoc {
  return { schemaVersion: 1, projectId, entities: [], audit: [] }
}

export function nextPersonLabel(entities: PersonEntity[]): string {
  return `Person ${entities.length + 1}`
}

export function validatePersonDoc(doc: PersonContinuityDoc): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (doc.schemaVersion !== 1) errors.push('Unknown person-continuity schema.')
  for (const e of doc.entities ?? []) {
    if (!e.personEntityId || !e.projectId) errors.push('PersonEntity missing ids.')
    if (/^(mark|jasmine)$/i.test(e.displayLabel) && e.enrollmentType !== 'biometric-opt-in' && e.enrollmentType !== 'human-confirmed') {
      errors.push('Named identity requires explicit human confirmation or biometric opt-in.')
    }
    if (e.confidence < 0 || e.confidence > 1) errors.push('Person confidence must be 0..1.')
  }
  return { ok: errors.length === 0, errors }
}

export function writePersonDoc(doc: PersonContinuityDoc): string {
  const clean = stripSecrets(doc)
  const check = validatePersonDoc(clean)
  if (!check.ok) throw new Error(check.errors.join('; '))
  const file = personContinuityPath(doc.projectId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return file
}

export async function readPersonDoc(projectId: string): Promise<PersonContinuityDoc> {
  const file = personContinuityPath(projectId)
  if (!existsSync(file)) return emptyPersonDoc(projectId)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as PersonContinuityDoc
  } catch {
    return emptyPersonDoc(projectId)
  }
}

export function suggestPersonMatch(doc: PersonContinuityDoc, sourceAssetIds: string[], appearanceHash: string, confidence: number): PersonContinuityDoc {
  const entity: PersonEntity = {
    personEntityId: newJobId('person'),
    projectId: doc.projectId,
    displayLabel: nextPersonLabel(doc.entities),
    enrollmentType: 'visual-continuity',
    sourceAssetIds,
    evidence: sourceAssetIds.map(id => ({ assetId: id, note: 'appearance similarity — not legal identity', appearanceHash })),
    confidence,
    biometricTemplateRef: null,
    createdAt: new Date().toISOString(),
    matchStatus: 'SUGGESTED MATCH',
  }
  return {
    ...doc,
    entities: [...doc.entities, entity],
    audit: [...doc.audit, { at: entity.createdAt, action: 'suggest', actor: 'system', entityIds: [entity.personEntityId], note: 'AI suggestion does not permanently merge identities.' }],
  }
}

export function confirmPersonMatch(doc: PersonContinuityDoc, personEntityId: string, actor: string): PersonContinuityDoc {
  return {
    ...doc,
    entities: doc.entities.map(e => e.personEntityId === personEntityId ? { ...e, matchStatus: 'CONFIRMED MATCH', enrollmentType: 'human-confirmed' } : e),
    audit: [...doc.audit, { at: new Date().toISOString(), action: 'confirm', actor, entityIds: [personEntityId], note: 'Human confirmed visual continuity. Not a legal identity claim.' }],
  }
}

export function rejectPersonMatch(doc: PersonContinuityDoc, personEntityId: string, actor: string): PersonContinuityDoc {
  return {
    ...doc,
    entities: doc.entities.map(e => e.personEntityId === personEntityId ? { ...e, matchStatus: 'REJECTED MATCH' } : e),
    audit: [...doc.audit, { at: new Date().toISOString(), action: 'reject', actor, entityIds: [personEntityId], note: 'Rejected suggested match.' }],
  }
}

export function splitPersonEntity(doc: PersonContinuityDoc, personEntityId: string, actor: string): PersonContinuityDoc {
  const src = doc.entities.find(e => e.personEntityId === personEntityId)
  if (!src || src.sourceAssetIds.length < 2) return doc
  const [first, ...rest] = src.sourceAssetIds
  const child: PersonEntity = {
    ...src,
    personEntityId: newJobId('person'),
    displayLabel: nextPersonLabel(doc.entities),
    sourceAssetIds: rest,
    createdAt: new Date().toISOString(),
    matchStatus: 'SUGGESTED MATCH',
    enrollmentType: 'visual-continuity',
  }
  return {
    ...doc,
    entities: doc.entities.map(e => e.personEntityId === personEntityId ? { ...e, sourceAssetIds: [first] } : e).concat(child),
    audit: [...doc.audit, { at: child.createdAt, action: 'split', actor, entityIds: [personEntityId, child.personEntityId], note: 'Split mistaken PersonEntity.' }],
  }
}

export function mergePersonEntities(doc: PersonContinuityDoc, aId: string, bId: string, actor: string): PersonContinuityDoc {
  const a = doc.entities.find(e => e.personEntityId === aId)
  const b = doc.entities.find(e => e.personEntityId === bId)
  if (!a || !b) return doc
  const merged: PersonEntity = {
    ...a,
    sourceAssetIds: [...new Set([...a.sourceAssetIds, ...b.sourceAssetIds])],
    evidence: [...a.evidence, ...b.evidence],
    matchStatus: 'CONFIRMED MATCH',
    enrollmentType: 'human-confirmed',
  }
  return {
    ...doc,
    entities: doc.entities.filter(e => e.personEntityId !== bId).map(e => e.personEntityId === aId ? merged : e),
    audit: [...doc.audit, { at: new Date().toISOString(), action: 'merge', actor, entityIds: [aId, bId], note: 'Merged confirmed duplicate PersonEntities.' }],
  }
}

export function deletePersonContinuity(projectId: string): boolean {
  const file = personContinuityPath(projectId)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}

export const CROSS_VIDEO_CONTINUITY_IS_NOT_LEGAL_IDENTITY = true
