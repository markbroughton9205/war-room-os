import { signOut } from '@/lib/auth/actions'

export function LogoutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded px-3 py-2 text-xs font-bold tracking-widest"
        style={{ border: '1px solid rgba(248,113,113,0.35)', color: '#F87171', background: 'rgba(0,0,0,0.28)' }}
      >
        Log out
      </button>
    </form>
  )
}
