import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#FFD700' }}>⚔ WAR ROOM</h1>
          <p className="mt-1 text-xs tracking-widest" style={{ color: '#444' }}>PASSWORD RECOVERY</p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  )
}
