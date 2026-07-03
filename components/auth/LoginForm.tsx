'use client'

import { useActionState } from 'react'
import { signIn, type SignInState } from '@/lib/auth/actions'

const initialState: SignInState = { error: null }

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState)

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded px-6 py-6"
      style={{ border: '1px solid #422006', background: 'rgba(0,0,0,0.5)' }}
    >
      <input type="hidden" name="next" value={next} />

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

      <label className="mt-4 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        PASSWORD
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
          style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      {state.error ? (
        <p className="mt-4 text-[10px] font-bold tracking-widest" style={{ color: '#F87171' }} role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-50"
        style={{ border: '1px solid rgba(255,215,0,0.45)', color: '#FFD700', background: 'rgba(0,0,0,0.28)' }}
      >
        {pending ? 'AUTHENTICATING…' : 'SIGN IN'}
      </button>
    </form>
  )
}
