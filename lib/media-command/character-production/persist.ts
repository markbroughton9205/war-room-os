/**
 * Persist character production operations beside Unreal packages.
 * Survives refresh, War Room restart, and Unreal restart. Never written into .hvsproj.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { unrealPackageDir } from '../unreal/storage'
import {
  HVS_RAEL_PRODUCTION_CHARACTER_ID,
  defaultDnaRecord,
  type HvsCharacterBuildOperation,
  type HvsCloudSubmissionRecord,
  type HvsMetaHumanLikenessAuthority,
  type HvsUnrealPreviewReceipt,
} from './types'

export function characterProductionDir(projectId: string): string {
  const dir = path.join(unrealPackageDir(projectId), 'character-production')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function characterProductionMediaDir(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  const dir = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'character-production', projectId, characterId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function characterPreviewDir(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  const dir = path.join(characterProductionMediaDir(projectId, characterId), 'preview')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function characterProductionPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterProductionDir(projectId), `${characterId}.json`)
}

export function characterAuthorityPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterProductionDir(projectId), `${characterId}.authority.json`)
}

export function characterSubmissionPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterProductionDir(projectId), `${characterId}.submission.json`)
}

export function characterPreviewReceiptPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterPreviewDir(projectId, characterId), 'preview.json')
}

function normalizeOperation(operation: HvsCharacterBuildOperation): HvsCharacterBuildOperation {
  return {
    ...operation,
    likenessState: operation.likenessState ?? null,
    likenessReceipts: operation.likenessReceipts ?? [],
    authority: operation.authority ?? null,
    keepLocal: Boolean(operation.keepLocal),
    approvalGateOpen: Boolean(operation.approvalGateOpen),
    cloudSubmission: operation.cloudSubmission ?? null,
    dna: operation.dna ?? defaultDnaRecord(),
    highFidelityPreview: operation.highFidelityPreview ?? null,
    operatorGate: operation.operatorGate ?? null,
    operatorStepUi: operation.operatorStepUi ?? null,
    epicSignInRequired: Boolean(operation.epicSignInRequired),
    textureSynthesisCalled: Boolean(operation.textureSynthesisCalled),
    payloadCategory: operation.payloadCategory ?? null,
  }
}

export function readCharacterProduction(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): HvsCharacterBuildOperation | null {
  const file = characterProductionPath(projectId, characterId)
  if (!existsSync(file)) return null
  return normalizeOperation(JSON.parse(readFileSync(file, 'utf8')) as HvsCharacterBuildOperation)
}

export function writeCharacterProduction(operation: HvsCharacterBuildOperation): string {
  const normalized = normalizeOperation(operation)
  const file = characterProductionPath(normalized.projectId, normalized.characterId)
  writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`)
  return file
}

export function characterAuditLogPath(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): string {
  return path.join(characterProductionDir(projectId), `${characterId}.audit.jsonl`)
}

export function appendCharacterAudit(operation: HvsCharacterBuildOperation): void {
  const event = operation.audit[operation.audit.length - 1]
  if (!event) return
  const file = characterAuditLogPath(operation.projectId, operation.characterId)
  writeFileSync(file, `${JSON.stringify(event)}\n`, { flag: 'a' })
}

export function readLikenessAuthority(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): HvsMetaHumanLikenessAuthority | null {
  const file = characterAuthorityPath(projectId, characterId)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as HvsMetaHumanLikenessAuthority
}

export function writeLikenessAuthority(authority: HvsMetaHumanLikenessAuthority): string {
  const file = characterAuthorityPath(authority.projectId, authority.characterId)
  writeFileSync(file, `${JSON.stringify(authority, null, 2)}\n`)
  return file
}

export function readCloudSubmission(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): HvsCloudSubmissionRecord | null {
  const file = characterSubmissionPath(projectId, characterId)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as HvsCloudSubmissionRecord
}

export function writeCloudSubmission(projectId: string, characterId: string, record: HvsCloudSubmissionRecord): string {
  const file = characterSubmissionPath(projectId, characterId)
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}

export function readPreviewReceipt(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): HvsUnrealPreviewReceipt | null {
  const file = characterPreviewReceiptPath(projectId, characterId)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as HvsUnrealPreviewReceipt
}

export function writePreviewReceipt(receipt: HvsUnrealPreviewReceipt, projectId: string): string {
  const file = characterPreviewReceiptPath(projectId, receipt.characterId)
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`)
  return file
}
