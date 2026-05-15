import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/** @deprecated Prefer importing {@link createSupabaseAdminClient} from `@/lib/supabase/admin` for clarity. */
export function createSupabaseServerClient() {
  return createSupabaseAdminClient()
}
