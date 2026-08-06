import Link from 'next/link'

/**
 * Permanent, immediately visible disclosure for the legacy `/war-room` route.
 *
 * This banner exists because parts of this route still render simulated
 * placeholder data (council seating, sentinel metrics, baby observer) that is
 * not produced by live providers or any backend execution. It must render
 * before any panel so an operator cannot mistake placeholder content for a
 * working system. Do not move it into a tooltip, footer, drawer, or
 * collapsible panel.
 */
export function LegacyRouteDisclosure() {
  return (
    <section
      data-testid="legacy-route-disclosure"
      aria-label="Legacy route disclosure"
      className="mx-auto mb-8 max-w-6xl rounded-xl border-2 border-amber-400/60 bg-amber-950/40 p-5 shadow-[0_0_32px_rgba(212,175,55,0.15)]"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-300">
        Legacy demo route — read before using this page
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-amber-100/90">
        <li>
          The <strong>Council seating, Sentinel metrics, and Baby Observer</strong> sections below show{' '}
          <strong>simulated placeholder data</strong>. They are not live provider output and no AI provider
          produced them.
        </li>
        <li>
          Those named sections are <strong>not connected to live providers or execution</strong>. A council member
          shown as &ldquo;executing&rdquo; or &ldquo;reviewing&rdquo; there does not mean that provider responded to
          anything.
        </li>
        <li>
          Other panels on this route (for example Signal Radar, Opportunity Scout, Provider Runtime, Runtime
          Integrity) <strong>may use real backend data</strong>. This warning applies only to the Council seating,
          Sentinel metrics, and Baby Observer sections.
        </li>
        <li>
          Controls that have no backend action on this route are disabled and labeled as such.
        </li>
      </ul>
      <p className="mt-4 text-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-400/10 px-4 py-2 font-semibold text-amber-200 transition hover:bg-amber-400/20 hover:text-amber-100"
        >
          Open the real Live Council interface →
        </Link>
      </p>
    </section>
  )
}
