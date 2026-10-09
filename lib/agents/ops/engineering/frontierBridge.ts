import type { DirectProviderFamily, DirectProviderCallResult } from '@/lib/council/providerDirectCall'

/**
 * The bridge to outside (frontier) specialists. It reuses War Room's existing hosted-provider call (invokeDirectCouncilProvider) and adds nothing else:
 * no repo access, no tools, no credentials handling. It only turns one bounded text request into one text reply. What happens to the reply is Foundry's decision.
 */
export type FrontierInvoke = (family: DirectProviderFamily, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number; system?: string }) => Promise<DirectProviderCallResult>
export type FrontierProvider = {
  family: DirectProviderFamily
  model: string
  available: () => boolean
  ask: (i: { system: string; prompt: string; maxTokens: number; timeoutMs: number }) => Promise<{ ok: true; text: string } | { ok: false; detail: string }>
}
export function makeFrontierProvider(family: DirectProviderFamily, invoke: FrontierInvoke, isConfigured: (f: DirectProviderFamily) => boolean): FrontierProvider {
  return {
    family, model: `hosted:${family}`,
    available: () => isConfigured(family),
    async ask(i) {
      if (!isConfigured(family)) return { ok: false, detail: `${family} is not configured in this process` }
      const r = await invoke(family, i.prompt, { timeoutMs: i.timeoutMs, maxTokens: i.maxTokens, system: i.system })
      return r.ok && r.text.trim() ? { ok: true, text: r.text } : { ok: false, detail: r.error ?? `empty reply (${String(r.transportStatus)})` }
    },
  }
}
/** The real provider (lazy import so validators and local-only builds never load hosted-call code). */
export async function defaultFrontierProvider(family: DirectProviderFamily): Promise<FrontierProvider> {
  const m = await import('@/lib/council/providerDirectCall')
  return makeFrontierProvider(family, m.invokeDirectCouncilProvider, m.isProviderFamilyConfigured)
}
