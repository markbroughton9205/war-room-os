'use client'

import { useCallback } from 'react'

import { matrixChannelStatus, matrixStatus } from '@/lib/ui/matrixStatusBus'

export function useMatrixStatus() {
  const signalWorking = useCallback((message = 'Working…') => {
    matrixStatus('working', message)
  }, [])

  const signalOutbound = useCallback((message = 'Request sent…') => {
    matrixChannelStatus('violet', message)
  }, [])

  const signalInbound = useCallback((message = 'Response received') => {
    matrixChannelStatus('cyan', message)
  }, [])

  const signalSuccess = useCallback((message = 'Ready') => {
    matrixStatus('success', message)
  }, [])

  const signalVerified = useCallback((message = 'Verified') => {
    matrixChannelStatus('white', message)
  }, [])

  const signalWarning = useCallback((message = 'Attention needed') => {
    matrixStatus('warning', message)
  }, [])

  const signalError = useCallback((message = 'Something went wrong') => {
    matrixStatus('error', message)
  }, [])

  return { signalWorking, signalOutbound, signalInbound, signalSuccess, signalVerified, signalWarning, signalError }
}
