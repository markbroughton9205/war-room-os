import Link from 'next/link'
import { SignupForm } from '@/components/auth/SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; invite?: string }>
}) {
  const { token: rawToken, invite: rawInvite } = await searchParams
  const token = typeof rawInvite === 'string' ? rawInvite : typeof rawToken === 'string' ? rawToken : ''

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#34D399' }}>WAR ROOM OS</h1>
          <p className="mt-1 text-xs tracking-widest" style={{ color: '#555' }}>INVITE-GATED ACCESS</p>
        </div>

        {token ? (
          <SignupForm token={token} />
        ) : (
          <div
            className="rounded px-6 py-6 text-center"
            style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(0,0,0,0.5)' }}
          >
            <p className="text-xs font-bold tracking-widest" style={{ color: '#F87171' }}>
              This invitation is invalid or unavailable. Contact the Commander.
            </p>
            <Link href="/login" className="mt-4 inline-block text-[10px] font-bold tracking-widest" style={{ color: '#FFD700' }}>
              RETURN TO LOGIN
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
