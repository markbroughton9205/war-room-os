'use client'

import type { HvsCreativeSessionState } from '@/lib/media-command/creative-intelligence/types'

function providerLabel(state: HvsCreativeSessionState | null | undefined): { code: string; text: string } {
  const status = state?.providerStatus ?? state?.receipt?.providerStatus
  if (status === 'CONNECTED' || (state?.receipt?.providerKind === 'live' && !state?.receipt?.fallbackUsed)) {
    return { code: 'CONNECTED', text: 'LIVE CREATIVE MODEL CONNECTED' }
  }
  if (status === 'UNAVAILABLE' || state?.receipt?.providerKind === 'unavailable') {
    return { code: 'UNAVAILABLE', text: 'CREATIVE MODEL UNAVAILABLE' }
  }
  return { code: 'FALLBACK', text: 'FALLBACK CREATIVE MODE' }
}

function visualLabel(state: HvsCreativeSessionState | null | undefined): string {
  const status = state?.visualReview?.status ?? state?.receipt?.visualReviewStatus ?? 'NOT_RUN'
  if (status === 'ACTIVE' && state?.visualReview?.inspected) return 'VISUAL REVIEW: ACTIVE'
  if (status === 'STALE') return 'VISUAL REVIEW: STALE'
  if (status === 'NEEDS_AUTHORIZATION') return 'VISUAL REVIEW: NOT RUN'
  return 'VISUAL REVIEW: NOT RUN'
}

export function HvsCreativeDirectionPanel(props: {
  state: HvsCreativeSessionState | null | undefined
  busy?: boolean
  onSelectApproach: (approachId: string) => void
  onRequestAlternatives: () => void
  onRequestReview: () => void
  onForceReplan: () => void
}) {
  const state = props.state
  if (!state || state.skipped) return null
  const analysis = state.analysis?.intent
  const approaches = (state.approaches ?? []).slice(0, 4)
  const recommendedId = state.recommendation?.approachId
  const review = state.review
  const status = providerLabel(state)

  return (
    <article className="hvs-ai-panel" data-testid="hvs-creative-direction">
      <h2>Creative direction</h2>
      <p className="hvs-ai-sub" data-testid="hvs-creative-provider-status">{status.text}</p>
      <p className="hvs-ai-sub" data-testid="hvs-creative-visual-status">{visualLabel(state)}</p>

      {analysis ? (
        <div className="hvs-ci-block" data-testid="hvs-creative-intent">
          <h3>Intent</h3>
          <div className="hvs-ai-facts">
            <div className="hvs-ai-fact"><b>Objective</b>{analysis.objective}</div>
            <div className="hvs-ai-fact"><b>Audience</b>{analysis.audience ?? 'Unspecified'}</div>
            <div className="hvs-ai-fact"><b>Visual</b>{analysis.visualGoal ?? 'Unspecified'}</div>
            <div className="hvs-ai-fact"><b>Pacing</b>{analysis.pacingGoal ?? 'Unspecified'}</div>
            <div className="hvs-ai-fact"><b>Audio</b>{analysis.audioGoal ?? 'Unspecified'}</div>
            <div className="hvs-ai-fact"><b>Typography</b>{analysis.typographyGoal ?? 'Unspecified'}</div>
            <div className="hvs-ai-fact"><b>Color</b>{analysis.colorGoal ?? 'Unspecified'}</div>
          </div>
          {analysis.uncertainties.length ? (
            <ul className="hvs-ai-list">
              {analysis.uncertainties.map(item => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {approaches.length ? (
        <div className="hvs-ci-block" data-testid="hvs-creative-alternatives">
          <h3>Alternatives</h3>
          <div className="hvs-ci-cards">
            {approaches.map(approach => {
              const selected = state.selectedApproachId === approach.id
              const recommended = recommendedId === approach.id
              return (
                <div className="hvs-ci-card" key={approach.id} data-testid="hvs-creative-approach">
                  <p className="hvs-ci-card-title">{approach.title}</p>
                  {recommended ? <p className="hvs-ci-flag">Recommended</p> : null}
                  {selected ? <p className="hvs-ci-flag">Selected</p> : null}
                  <p>{approach.concept}</p>
                  <p className="hvs-ai-sub">{approach.pacingStrategy ?? approach.visualLanguage ?? approach.shotStrategy}</p>
                  {approach.strengths.length ? <p><b>Strengths.</b> {approach.strengths.join(' ')}</p> : null}
                  {approach.risks.length ? <p><b>Risks.</b> {approach.risks.join(' ')}</p> : null}
                  <button
                    type="button"
                    className="hvs-ai-btn"
                    data-testid="hvs-creative-select"
                    disabled={props.busy || selected}
                    onClick={() => props.onSelectApproach(approach.id)}
                  >
                    Select this direction
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {state.recommendation ? (
        <div className="hvs-ci-block" data-testid="hvs-creative-recommendation">
          <h3>Recommended approach</h3>
          <p>{state.recommendation.whyItFits}</p>
          {state.recommendation.tradeoffs.length ? <p><b>Tradeoffs.</b> {state.recommendation.tradeoffs.join(' ')}</p> : null}
          {state.recommendation.uncertainties.length ? <p><b>Uncertainties.</b> {state.recommendation.uncertainties.join(' ')}</p> : null}
          <p className="hvs-ai-sub">This is advisory. Commander chooses the direction.</p>
        </div>
      ) : null}

      {review ? (
        <div className="hvs-ci-block" data-testid="hvs-creative-review">
          <h3>Creative review</h3>
          <p><b>Verdict.</b> {review.verdict.replaceAll('_', ' ')}</p>
          {review.strengths.length ? <p><b>Strengths.</b> {review.strengths.join(' ')}</p> : null}
          <ul className="hvs-ai-list">
            {review.findings.map((finding, index) => (
              <li key={`${finding.class}-${index}`}>
                <b>{finding.class}</b> · {finding.honesty} · {finding.observation}
                {finding.evidence ? ` Evidence: ${finding.evidence}.` : ''}
                {finding.suggestedCorrection ? ` ${finding.suggestedCorrection}` : ''}
              </li>
            ))}
          </ul>
          {review.proposedRefinements.length ? (
            <p><b>Refinements.</b> {review.proposedRefinements.map(row => row.summary).join(' ')}</p>
          ) : null}
        </div>
      ) : null}

      {state.visualReview?.inspected && state.visualReview.frames.length ? (
        <ul className="hvs-ai-list" data-testid="hvs-creative-visual-frames">
          {state.visualReview.frames.map(frame => (
            <li key={frame.frameId}>{frame.frameId} · {frame.timestampSec.toFixed(2)}s · {frame.role}</li>
          ))}
        </ul>
      ) : null}

      <div className="hvs-ai-row">
        <button type="button" className="hvs-ai-btn" data-testid="hvs-creative-new-alternatives" disabled={props.busy} onClick={props.onRequestAlternatives}>Request new alternatives</button>
        <button type="button" className="hvs-ai-btn" data-testid="hvs-creative-request-review" disabled={props.busy} onClick={props.onRequestReview}>Request refinement</button>
        <button type="button" className="hvs-ai-btn" data-testid="hvs-creative-force-replan" disabled={props.busy} onClick={props.onForceReplan}>Force replan</button>
      </div>
    </article>
  )
}
