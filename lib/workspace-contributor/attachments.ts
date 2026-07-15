import { createHash, randomUUID } from 'crypto'
import { WORKSPACE_ATTACHMENT_MIME_TYPES, type WorkspaceAttachmentMimeType } from './types'

export const WORKSPACE_ATTACHMENTS_BUCKET = 'workspace-proposal-attachments'
export const MAX_WORKSPACE_ATTACHMENT_BYTES = 10 * 1024 * 1024

const MIME_TO_EXTENSION: Record<WorkspaceAttachmentMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

export type WorkspaceAttachmentValidation =
  | {
      ok: true
      mimeType: WorkspaceAttachmentMimeType
      extension: string
      contentSha256: string
      storagePath: string
      bytes: Uint8Array
    }
  | { ok: false; reason: string }

export async function validateWorkspaceAttachment(input: {
  workspaceOwnerId: string
  proposalId: string
  file: File
}): Promise<WorkspaceAttachmentValidation> {
  const mimeType = input.file.type
  if (!isAllowedMimeType(mimeType)) return { ok: false, reason: 'mime_type_rejected' }
  if (input.file.size > MAX_WORKSPACE_ATTACHMENT_BYTES) return { ok: false, reason: 'file_too_large' }
  if (!safeOriginalFilename(input.file.name)) return { ok: false, reason: 'unsafe_filename' }

  const originalExtension = extensionFromFilename(input.file.name)
  const expectedExtension = MIME_TO_EXTENSION[mimeType]
  if (!extensionMatches(mimeType, originalExtension)) return { ok: false, reason: 'extension_mismatch' }

  const bytes = new Uint8Array(await input.file.arrayBuffer())
  if (!fileSignatureMatches(mimeType, bytes)) return { ok: false, reason: 'file_signature_mismatch' }
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const storagePath = `${input.workspaceOwnerId}/${input.proposalId}/${randomUUID()}.${expectedExtension}`
  if (!storagePath.startsWith(`${input.workspaceOwnerId}/${input.proposalId}/`)) return { ok: false, reason: 'cross_workspace_path' }

  return { ok: true, mimeType, extension: expectedExtension, contentSha256, storagePath, bytes }
}

export function isAllowedMimeType(value: string): value is WorkspaceAttachmentMimeType {
  return (WORKSPACE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
}

export function safeOriginalFilename(value: string): boolean {
  if (!value || value.length > 180) return false
  if (value.includes('/') || value.includes('\\') || value.includes('..') || value.includes('\0')) return false
  return /^[A-Za-z0-9._ -]+$/.test(value)
}

function extensionFromFilename(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index === -1 ? '' : filename.slice(index + 1).toLowerCase()
}

function extensionMatches(mimeType: WorkspaceAttachmentMimeType, extension: string): boolean {
  if (mimeType === 'image/jpeg') return extension === 'jpg' || extension === 'jpeg'
  return extension === MIME_TO_EXTENSION[mimeType]
}

function fileSignatureMatches(mimeType: WorkspaceAttachmentMimeType, bytes: Uint8Array): boolean {
  if (mimeType === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes[0] === 0x52
      && bytes[1] === 0x49
      && bytes[2] === 0x46
      && bytes[3] === 0x46
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50
  }
  if (mimeType === 'application/pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  if (mimeType === 'text/plain') return isPlainText(bytes)
  return false
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true
  for (const byte of bytes) {
    if (byte === 0) return false
    if (byte < 0x09) return false
    if (byte > 0x0d && byte < 0x20) return false
  }
  return true
}
