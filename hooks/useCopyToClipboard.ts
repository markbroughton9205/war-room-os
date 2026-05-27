'use client'

import { useCallback } from 'react'

import { useManualCopy } from '@/components/war-room/operator/ManualCopyProvider'
import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import { copyTextToClipboard, type CopyToClipboardResult } from '@/lib/operator/copyToClipboard'

export type CopyToClipboardOptions = {
  successMessage?: string
  manualTitle?: string
  /** When false, skip matrix status toasts (caller handles UI). */
  notify?: boolean
}

export function useCopyToClipboard() {
  const { openManualCopy } = useManualCopy()
  const { signalSuccess, signalWarning } = useMatrixStatus()

  const copy = useCallback(
    async (text: string, options?: CopyToClipboardOptions): Promise<CopyToClipboardResult> => {
      const notify = options?.notify !== false
      const result = await copyTextToClipboard(text)

      if (result === 'copied') {
        if (notify) signalSuccess(options?.successMessage ?? 'Copied')
        return result
      }

      if (result === 'manual') {
        if (notify) signalWarning('Manual copy needed')
        openManualCopy(text, options?.manualTitle)
        return result
      }

      if (notify) signalWarning('Nothing to copy')
      return result
    },
    [openManualCopy, signalSuccess, signalWarning],
  )

  return { copy }
}
