'use client'

import { useCallback } from 'react'

import { matrixStatus } from '@/lib/ui/matrixStatusBus'

export function useMatrixStatus() {
  const signalWorking = useCallback((message = 'Working…') => {
    matrixStatus('working', message)
  }, [])

  const signalSuccess = useCallback((message = 'Ready') => {
    matrixStatus('success', message)
  }, [])

  const signalWarning = useCallback((message = 'Attention needed') => {
    matrixStatus('warning', message)
  }, [])

  const signalError = useCallback((message = 'Something went wrong') => {
    matrixStatus('error', message)
  }, [])

  return { signalWorking, signalSuccess, signalWarning, signalError }
}
