import type { ReactNode } from 'react'
import type { CommanderReadinessCard as CommanderReadinessCardData, MoneyEstimate, NumberEstimate } from '@/lib/opportunity-readiness/types'

const READINESS_TONE: Record<CommanderReadinessCardData['readinessState'], string> = {
  READY_NOW: 'text-emerald-200 border-emerald-400/30',
  READY_WITH_PREP: 'text-cyan-200 border-cyan-400/30',
  QUALIFICATION_GAP: 'text-amber-200 border-amber-400/30',
  DOCUMENTATION_NEEDED: 'text-amber-200 border-amber-400/30',
  TRAINING_REQUIRED: 'text-amber-200 border-amber-400/30',
  LOCATION_CONSTRAINT: 'text-amber-200 border-amber-400/30',
  OPERATOR_INPUT_REQUIRED: 'text-cyan-200 border-cyan-400/30',
  ELIGIBILITY_UNCONFIRMED: 'text-cyan-200 border-cyan-400/30',
  NOT_CURRENTLY_ELIGIBLE: 'text-rose-200 border-rose-400/30',
  DEFERRED: 'text-slate-300 border-white/20',
  BLOCKED: 'text-rose-200 border-rose-400/30',
}

function tag(value: string): string {
  return value.replace(/_/g, ' ')
}

function money(value: MoneyEstimate): string {
  if (value.value === null) return `UNKNOWN${value.notes ? ` — ${value.notes}` : ''}`
  return `${value.basis === 'ESTIMATED' ? '~' : ''}${value.value.toFixed(2)} ${value.currency} (${value.basis})`
}

function num(value: NumberEstimate, unit: string): string {
  if (value.value === null) return `UNKNOWN${value.notes ? ` — ${value.notes}` : ''}`
  return `${value.basis === 'ESTIMATED' ? '~' : ''}${value.value} ${unit} (${value.basis})`
}

function Badge({ value, tone }: { value: string; tone?: string }) {
  return (
    <span className={`inline-flex rounded border bg-black/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${tone ?? 'text-slate-300 border-white/15'}`}>
      {tag(value)}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function ListOrEmpty({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-500">{empty}</p>
  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * Presentational only — reads a CommanderReadinessCard and renders it. Does not
 * fetch data, does not call the assess API, and is not wired into any existing
 * console. Where this surfaces is a later integration decision.
 */
export function CommanderReadinessCard({ card }: { card: CommanderReadinessCardData }) {
  return (
    <article className="mx-auto max-w-3xl rounded border border-white/10 bg-slate-950 p-5 text-slate-100">
      <header className="border-b border-cyan-400/20 pb-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300">Commander readiness card</p>
        <h2 className="mt-2 text-xl font-semibold text-white">{card.opportunityName}</h2>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
          {card.providerEmployer ?? 'Provider unknown'} · {tag(card.opportunityType)} · {card.source ?? 'source unknown'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge value={card.readinessState} tone={READINESS_TONE[card.readinessState]} />
          {card.readinessScore !== null ? <Badge value={`${card.readinessScore}% CONFIRMED MET`} /> : null}
        </div>
      </header>

      {card.risksBlockers.length ? (
        <Section title="Risks / blockers">
          <ListOrEmpty items={card.risksBlockers} empty="None identified." />
        </Section>
      ) : null}

      <Section title="Compensation">
        <p className="text-sm text-slate-200">{money(card.compensation)}</p>
        <p className="mt-1 text-xs text-slate-400">Effective hourly value: {money(card.estimatedEffectiveHourlyValue)}</p>
        <p className="mt-1 text-xs text-slate-400">Estimated time commitment: {num(card.estimatedTimeCommitment, 'hours')}</p>
      </Section>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Section title="Confirmed met">
          <ListOrEmpty items={card.confirmedMetQualifications} empty="None yet confirmed." />
        </Section>
        <Section title="Confirmed missing">
          <ListOrEmpty items={card.confirmedMissingQualifications} empty="None." />
        </Section>
        <Section title="Unknown requirements">
          <ListOrEmpty items={card.unknownRequirements} empty="None." />
        </Section>
        <Section title="Preparation needed">
          <ListOrEmpty items={card.preparationChecklist} empty="Nothing outstanding." />
        </Section>
        <Section title="Required documents">
          <ListOrEmpty items={card.requiredDocuments} empty="None identified." />
        </Section>
        <Section title="Required credentials / certifications">
          <ListOrEmpty items={[...card.requiredCredentials, ...card.requiredCertifications]} empty="None identified." />
        </Section>
        <Section title="Required equipment">
          <ListOrEmpty items={card.requiredEquipment} empty="None identified." />
        </Section>
        <Section title="Location / travel constraints">
          <ListOrEmpty items={card.travelLocationConstraints} empty="None identified." />
        </Section>
      </div>

      <Section title="Location & deadline">
        <p className="text-xs text-slate-300">Location: {card.location ?? 'Unknown'} ({tag(card.workMode)})</p>
        <p className="mt-1 text-xs text-slate-300">Deadline: {card.deadline ?? 'Unknown'}</p>
        <p className="mt-1 text-xs text-slate-300">Application/participation window: {card.applicationOrParticipationWindow ?? 'Unknown'}</p>
      </Section>

      <Section title="Commander questions">
        {card.commanderQuestions.length ? (
          <ul className="space-y-2">
            {card.commanderQuestions.map(question => (
              <li key={question.id} className="rounded border border-white/10 bg-black/20 p-3 text-xs">
                <p className="text-slate-100">{question.question}</p>
                <p className="mt-1 text-slate-500">{question.whyItMatters}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No outstanding Commander questions.</p>
        )}
      </Section>

      <Section title="Questions for the provider/employer">
        {card.providerQuestions.length ? (
          <ul className="space-y-1">
            {card.providerQuestions.map(question => (
              <li key={question.id} className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">
                {question.question}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No outstanding provider questions.</p>
        )}
      </Section>

      <Section title="Recommended next action">
        <p className="rounded border border-cyan-400/20 bg-cyan-400/5 p-3 text-sm text-cyan-100">{card.recommendedNextAction}</p>
      </Section>

      <footer className="mt-6 border-t border-white/10 pt-3 text-[9px] uppercase tracking-widest text-slate-600">
        Session-only analysis · No external action taken · No durable memory written
      </footer>
    </article>
  )
}
