/**
 * Clipboard helpers with manual-copy fallback when write is blocked (client-safe).
 */

export type CopyToClipboardResult = 'copied' | 'manual' | 'empty'

export async function copyTextToClipboard(text: string): Promise<CopyToClipboardResult> {
  const trimmed = text.trim()
  if (!trimmed) return 'empty'

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(trimmed)
      return 'copied'
    } catch {
      /* user activation or permission block — fall through */
    }
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.value = trimmed
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      if (document.execCommand('copy')) return 'copied'
    } catch {
      /* fall through to manual */
    } finally {
      document.body.removeChild(textarea)
    }
  }

  return 'manual'
}
