'use client'

import { useActionState } from 'react'
import { updatePasswordAfterRecovery } from '@/lib/auth/recoveryActions'
import { PASSWORD_UPDATE_INITIAL_STATE } from '@/lib/auth/recoveryState'

const initialState = PASSWORD_UPDATE_INITIAL_STATE

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAfterRecovery, initialState)

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded px-6 py-6"
      style={{ border: '1px solid #422006', background: 'rgba(0,0,0,0.5)' }}
    >
      <label className="block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        NEW PASSWORD
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
          style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      <label className="mt-4 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        CONFIRM PASSWORD
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
          style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      {state.message ? (
        <p className="mt-4 text-[10px] font-bold tracking-widest" style={{ color: state.status === 'error' ? '#F87171' : '#86EFAC' }} role={state.status === 'error' ? 'alert' : 'status'}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-50"
        style={{ border: '1px solid rgba(255,215,0,0.45)', color: '#FFD700', background: 'rgba(0,0,0,0.28)' }}
      >
        {pending ? 'UPDATING…' : 'UPDATE PASSWORD'}
      </button>
    </form>
  )
}
