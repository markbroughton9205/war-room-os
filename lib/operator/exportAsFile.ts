/**
 * File-download export helper (client-safe). First export primitive in the codebase —
 * mirrors the shape of `copyToClipboard.ts` so callers can treat copy/export as siblings.
 */

export type ExportMimeType = 'text/plain' | 'text/markdown' | 'application/json'

export type ExportFileResult = 'downloaded' | 'empty' | 'unsupported'

export function downloadTextFile(filename: string, content: string, mimeType: ExportMimeType = 'text/plain'): ExportFileResult {
  const trimmed = content.trim()
  if (!trimmed) return 'empty'

  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return 'unsupported'
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)

  return 'downloaded'
}
