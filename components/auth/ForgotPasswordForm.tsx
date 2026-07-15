'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { sendPasswordRecoveryEmail } from '@/lib/auth/recoveryActions'
import { PASSWORD_RECOVERY_REQUEST_INITIAL_STATE } from '@/lib/auth/recoveryState'

const initialState = PASSWORD_RECOVERY_REQUEST_INITIAL_STATE

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(sendPasswordRecoveryEmail, initialState)

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded px-6 py-6"
      style={{ border: '1px solid #422006', background: 'rgba(0,0,0,0.5)' }}
    >
      <label className="block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        EMAIL
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
          style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      {state.message ? (
        <p className="mt-4 text-[10px] font-bold tracking-widest" style={{ color: '#86EFAC' }} role="status">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-50"
        style={{ border: '1px solid rgba(255,215,0,0.45)', color: '#FFD700', background: 'rgba(0,0,0,0.28)' }}
      >
        {pending ? 'SENDING…' : 'SEND RECOVERY LINK'}
      </button>

      <Link href="/login" className="mt-4 block text-center text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }}>
        RETURN TO LOGIN
      </Link>
    </form>
  )
}
