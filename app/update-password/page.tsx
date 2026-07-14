import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { verifyRecoveryMarkerFromCookieStore } from '@/lib/auth/recovery'
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm'

export default async function UpdatePasswordPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) redirect('/login?auth=recovery_required')
  const marker = await verifyRecoveryMarkerFromCookieStore(user.id)
  if (!marker.ok) redirect('/login?auth=recovery_required')

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#FFD700' }}>⚔ WAR ROOM</h1>
          <p className="mt-1 text-xs tracking-widest" style={{ color: '#444' }}>SET NEW PASSWORD</p>
        </div>
        <UpdatePasswordForm />
      </div>
    </main>
  )
}
