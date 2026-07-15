'use client'

import { useActionState } from 'react'
import { useState } from 'react'
import { signUpWithInvitation } from '@/lib/auth/signupActions'
import { SIGNUP_FLOW_INITIAL_STATE } from '@/lib/signup-invitations/signupFlowState'

const initialState = SIGNUP_FLOW_INITIAL_STATE

export function SignupForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(signUpWithInvitation, initialState)
  const [clientError, setClientError] = useState<string | null>(null)
  const success = state.status === 'success'

  return (
    <form
      action={formAction}
      onSubmit={event => {
        const form = event.currentTarget
        const password = String(new FormData(form).get('password') ?? '')
        const confirmPassword = String(new FormData(form).get('confirmPassword') ?? '')
        if (password !== confirmPassword) {
          event.preventDefault()
          setClientError('Passwords do not match.')
          return
        }
        setClientError(null)
      }}
      className="w-full max-w-sm rounded px-6 py-6"
      style={{ border: '1px solid #064e3b', background: 'rgba(0,0,0,0.5)' }}
    >
      <input type="hidden" name="invite" value={token} />

      <label className="block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        INVITED EMAIL
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={success}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none disabled:opacity-60"
          style={{ border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      <label className="mt-4 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        PASSWORD
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={success}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none disabled:opacity-60"
          style={{ border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(0,0,0,0.6)' }}
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
          disabled={success}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none disabled:opacity-60"
          style={{ border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      {clientError || state.message ? (
        <p
          className="mt-4 text-[10px] font-bold tracking-widest"
          style={{ color: success ? '#34D399' : '#F87171' }}
          role="status"
        >
          {clientError ?? state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || success || !token}
        className="mt-6 w-full rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-50"
        style={{ border: '1px solid rgba(16,185,129,0.45)', color: '#34D399', background: 'rgba(0,0,0,0.28)' }}
      >
        {pending ? 'CREATING ACCOUNT…' : success ? 'CHECK EMAIL' : 'CREATE ACCOUNT'}
      </button>
    </form>
  )
}
