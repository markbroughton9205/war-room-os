import { isTerraOfficialHost, type TerraOfficialFetchService } from '@/lib/research-engine/security/hostAllowlist'
import { TERRA_PUBLIC_USER_AGENT } from '@/lib/terra/terraPublicIdentity'

export type GisFetchResult = {
  ok: boolean
  status: number
  text: string
  durationMs: number
}

let gisFetchImpl: typeof fetch = fetch

export function __setGisFetchForTests(fetchImpl: typeof fetch | null): void {
  gisFetchImpl = fetchImpl ?? fetch
}

export async function fetchTerraOfficialGis(input: {
  service: TerraOfficialFetchService
  url: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<GisFetchResult> {
  const started = Date.now()
  const parsed = new URL(input.url)
  if (parsed.protocol !== 'https:') {
    return { ok: false, status: 0, text: 'Blocked non-HTTPS GIS URL.', durationMs: Date.now() - started }
  }
  if (!isTerraOfficialHost(input.service, parsed.hostname)) {
    return { ok: false, status: 0, text: `Blocked host "${parsed.hostname}" for ${input.service}.`, durationMs: Date.now() - started }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 6_000)
  const onAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onAbort)
  try {
    const response = await gisFetchImpl(parsed.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': TERRA_PUBLIC_USER_AGENT },
      signal: controller.signal,
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text, durationMs: Date.now() - started }
  } catch (error) {
    const aborted = controller.signal.aborted
    return {
      ok: false,
      status: aborted ? 408 : 0,
      text: aborted ? 'GIS request timed out.' : (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
