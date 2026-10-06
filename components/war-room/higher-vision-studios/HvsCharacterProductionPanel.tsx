'use client'

import { useEffect, useState } from 'react'
import { HVS_CHARACTER_PRODUCTION_STAGES, type HvsCharacterProductionSnapshot } from '@/lib/media-command/character-production/types'
import {
  LIKENESS_APPROVAL_COPY,
  LIKENESS_PROGRESS_STEPS,
  STAGE_LABEL,
  STATE_LABEL,
  blockedHeadline,
  likenessProgressStatus,
} from '@/lib/media-command/character-production/view'
import {
  HVS_OPERATOR_STEP_FAILED,
  HVS_OPERATOR_STEP_OPEN_LABEL,
  HVS_OPERATOR_STEP_OPENING,
  HVS_OPERATOR_STEP_OPENING_MHC,
  HVS_OPERATOR_STEP_READY,
  HVS_OPERATOR_STEP_RETRY,
  HVS_OPERATOR_STEP_WAITING,
} from '@/lib/media-command/character-production/types'

type Payload = HvsCharacterProductionSnapshot & {
  error?: string
  message?: string
  appearance?: { options: string[]; future: boolean }
  director?: { characterId: string }
}

async function post(body: Record<string, unknown>): Promise<Payload> {
  const res = await fetch('/api/media-command/character-production', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Payload
  if (!res.ok) throw new Error(data.message ?? data.error ?? 'Build could not finish.')
  return data
}

function mark(status: string | undefined): string {
  if (status === 'COMPLETE' || status === 'SKIPPED') return '✓'
  if (status === 'RUNNING' || status === 'BLOCKED') return '●'
  return '○'
}

export function HvsCharacterProductionPanel({ projectId }: { projectId: string | null }) {
  const [snapshot, setSnapshot] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [appearance, setAppearance] = useState<string[] | null>(null)
  const [openingStep, setOpeningStep] = useState(false)

  useEffect(() => {
    const id = projectId ?? 'hvs-mud545ez-8w3a'
    let cancelled = false
    fetch(`/api/media-command/character-production?projectId=${encodeURIComponent(id)}`)
      .then(res => res.json())
      .then((data: Payload) => { if (!cancelled) setSnapshot(data) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load character production.') })
    return () => { cancelled = true }
  }, [projectId])

  const stepStatus = snapshot?.operatorStepUi?.status
  const stepBusy = openingStep
    || stepStatus === 'OPENING'
    || stepStatus === 'WAITING'
    || stepStatus === 'OPENING_MHC'
  const stepMessage = snapshot?.operatorStepUi?.message
    ?? (stepStatus === 'WAITING' ? HVS_OPERATOR_STEP_WAITING
      : stepStatus === 'OPENING_MHC' ? HVS_OPERATOR_STEP_OPENING_MHC
        : stepStatus === 'READY' ? HVS_OPERATOR_STEP_READY
          : stepStatus === 'FAILED' ? HVS_OPERATOR_STEP_FAILED
            : HVS_OPERATOR_STEP_OPENING)

  useEffect(() => {
    const opening = openingStep
      || snapshot?.operatorStepUi?.status === 'OPENING'
      || snapshot?.operatorStepUi?.status === 'WAITING'
      || snapshot?.operatorStepUi?.status === 'OPENING_MHC'
    if (snapshot?.operation?.status !== 'RUNNING' && !opening) return
    const id = projectId ?? snapshot?.projectId
    if (!id) return
    const timer = window.setInterval(() => {
      fetch(`/api/media-command/character-production?projectId=${encodeURIComponent(id)}`)
        .then(res => res.json())
        .then((data: Payload) => {
          setSnapshot(data)
          if (data.operatorStepUi?.status === 'READY' || data.operatorStepUi?.status === 'FAILED') {
            setOpeningStep(false)
          }
        })
        .catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [projectId, snapshot?.operation?.status, snapshot?.projectId, snapshot?.operatorStepUi?.status, openingStep])

  async function build() {
    setError('')
    const data = await post({ action: 'build', projectId: projectId ?? snapshot?.projectId })
    setSnapshot(data)
  }

  async function resume() {
    setError('')
    const data = await post({ action: 'resume', projectId: projectId ?? snapshot?.projectId })
    setSnapshot(data)
  }

  async function openRequiredStep() {
    setError('')
    setOpeningStep(true)
    try {
      const data = await post({ action: 'open-required-step', projectId: projectId ?? snapshot?.projectId })
      setSnapshot(data)
      if (data.operatorStepUi?.status === 'FAILED' || data.operatorStepUi?.status === 'READY') setOpeningStep(false)
    } catch (err) {
      setOpeningStep(false)
      setError(err instanceof Error ? err.message : HVS_OPERATOR_STEP_FAILED)
    }
  }

  const state = snapshot?.productionState ?? 'REFERENCES_REQUIRED'
  const blocked = snapshot ? blockedHeadline(snapshot) : null
  const running = snapshot?.operation?.status === 'RUNNING'
  const ready = state === 'CHARACTER_READY'
  const receipts = snapshot?.operation?.receipts ?? []
  const approvalRequired = state === 'LIKELINESS_APPROVAL_REQUIRED'
  const approvalOpen = Boolean(snapshot?.approvalGateOpen)
  const foundationReady = receipts.find(item => item.stage === 'METAHUMAN_FOUNDATION')?.status === 'COMPLETE'
  const preview = snapshot?.highFidelityPreview
  const previewSrc = preview
    ? `/api/media-command/character-production?projectId=${encodeURIComponent(projectId ?? snapshot?.projectId ?? '')}&preview=1&t=${encodeURIComponent(preview.generatedAt)}`
    : null
  const showLikenessProgress = running && Boolean(snapshot?.authority || snapshot?.likenessState && snapshot.likenessState !== 'LIKELINESS_APPROVAL_REQUIRED')

  return (
    <section className="hvs-actors-panel hvs-character-production" data-testid="hvs-character-production">
      <h2>High-fidelity Ra&apos;el</h2>
      <div className="hvs-production-flow" data-testid="hvs-production-flow">
        <p data-testid="hvs-identity-refs">
          Identity references {snapshot?.faceReferences.complete ? `✓ Complete — ${snapshot.faceReferences.accepted}/${snapshot.faceReferences.required}` : `${snapshot?.faceReferences.accepted ?? 0}/${snapshot?.faceReferences.required ?? 5}`}
        </p>
        <p data-testid="hvs-hf-foundation">MetaHuman foundation {foundationReady || ready ? '✓ Created' : STATE_LABEL[state]}</p>
        <p data-testid="hvs-hf-likeness">Likeness {ready || snapshot?.likenessState === 'LIKELINESS_COMPLETE' ? '✓ Conformed' : approvalRequired ? 'Approval required' : STATE_LABEL[state]}</p>
        <p data-testid="hvs-hf-character">High-fidelity character {STATE_LABEL[state]}</p>
        <p data-testid="hvs-body-performance">Body performance {snapshot?.bodyPerformance.connected ? '✓ TAKE 3 ready' : snapshot?.bodyPerformance.label ?? '—'}</p>
        <p data-testid="hvs-face-performance">Face performance Not captured yet</p>
        <p data-testid="hvs-cinema-integration">Cinema {ready ? '✓ Connected' : approvalRequired || snapshot?.likenessState !== 'LIKELINESS_COMPLETE' ? 'Waiting for likeness' : snapshot?.cinema.connected ? '✓ Connected' : 'Waiting for character'}</p>
      </div>

      {blocked ? (
        <div className="hvs-production-blocked" data-testid="hvs-production-blocked">
          <p>{blocked}</p>
          {snapshot?.operatorGate?.kind === 'CREATOR_LANDMARK' ? (
            <p data-testid="hvs-required-step">MetaHuman Creator needs one confirmation in Unreal.</p>
          ) : snapshot?.operation?.blocked?.operatorStep ? <p data-testid="hvs-required-step">{snapshot.operation.blocked.operatorStep}</p> : null}
          {snapshot?.epicSignInRequired ? (
            <button type="button" data-testid="hvs-epic-signin" onClick={() => post({ action: 'epic-signin', projectId }).then(setSnapshot).catch(err => setError(err.message))}>SIGN IN</button>
          ) : null}
          {snapshot?.operatorGate?.kind === 'CREATOR_LANDMARK' ? (
            <div className="hvs-actor-actions" data-testid="hvs-open-required-step-actions">
              {stepBusy ? (
                <p data-testid="hvs-operator-step-status">{stepMessage}</p>
              ) : snapshot.operatorStepUi?.status === 'READY' ? (
                <p data-testid="hvs-operator-step-status">{HVS_OPERATOR_STEP_READY}</p>
              ) : snapshot.operatorStepUi?.status === 'FAILED' ? (
                <p data-testid="hvs-operator-step-status">{HVS_OPERATOR_STEP_FAILED}</p>
              ) : null}
              {snapshot.operatorStepUi?.status === 'FAILED' ? (
                <button type="button" data-testid="hvs-open-required-step-retry" onClick={() => openRequiredStep().catch(err => setError(err instanceof Error ? err.message : HVS_OPERATOR_STEP_FAILED))}>{HVS_OPERATOR_STEP_RETRY}</button>
              ) : (
                <button
                  type="button"
                  data-testid="hvs-open-required-step"
                  disabled={stepBusy}
                  onClick={() => openRequiredStep().catch(err => setError(err instanceof Error ? err.message : HVS_OPERATOR_STEP_FAILED))}
                >
                  {stepBusy ? stepMessage : HVS_OPERATOR_STEP_OPEN_LABEL}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {showLikenessProgress ? (
        <div className="hvs-production-progress" data-testid="hvs-production-progress">
          <p>Building Ra&apos;el</p>
          <ul>
            {LIKENESS_PROGRESS_STEPS.map(step => (
              <li key={step.id}>{mark(snapshot ? likenessProgressStatus(snapshot, step.id) : 'PENDING')} {step.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {running && !showLikenessProgress ? (
        <div className="hvs-production-progress" data-testid="hvs-production-progress">
          <p>Building Ra&apos;el</p>
          <ul>
            {HVS_CHARACTER_PRODUCTION_STAGES.filter(stage => stage !== 'FACE_REFERENCES').map(stage => {
              const receipt = receipts.find(item => item.stage === stage)
              const label = STAGE_LABEL[stage]
              if (stage === 'PREREQUISITES') {
                const face = receipts.find(item => item.stage === 'FACE_REFERENCES')
                const status = receipt?.status === 'COMPLETE' && face?.status === 'COMPLETE' ? 'COMPLETE' : receipt?.status
                return <li key={stage}>{mark(status)} {label}</li>
              }
              return <li key={stage}>{mark(receipt?.status)} {label}</li>
            })}
          </ul>
        </div>
      ) : null}

      {approvalOpen && approvalRequired ? (
        <div className="hvs-likeness-approval" data-testid="hvs-likeness-approval">
          <p>{LIKENESS_APPROVAL_COPY.headline}</p>
          {LIKENESS_APPROVAL_COPY.body.map(line => <p key={line}>{line}</p>)}
          <div className="hvs-actor-actions">
            <button type="button" data-testid="hvs-authorize-likeness" onClick={() => post({ action: 'authorize-likeness', projectId }).then(setSnapshot).catch(err => setError(err instanceof Error ? err.message : 'Build could not finish.'))}>{LIKENESS_APPROVAL_COPY.authorize}</button>
            <button type="button" data-testid="hvs-keep-local" onClick={() => post({ action: 'keep-local', projectId }).then(setSnapshot).catch(err => setError(err instanceof Error ? err.message : 'Build could not finish.'))}>{LIKENESS_APPROVAL_COPY.keepLocal}</button>
          </div>
        </div>
      ) : null}

      {ready ? (
        <div className="hvs-production-ready" data-testid="hvs-production-ready">
          <p>Ra&apos;el ready</p>
          {previewSrc ? (
            <img className="hvs-unreal-preview" data-testid="hvs-unreal-preview" src={previewSrc} alt="Unreal preview of Ra'el" />
          ) : (
            <div data-testid="hvs-preview-unavailable">
              <p>HIGH-FIDELITY PREVIEW UNAVAILABLE</p>
              <p>Fast Preview: Three.js available</p>
            </div>
          )}
          <div className="hvs-actor-actions">
            <button type="button" data-testid="hvs-preview-rael" onClick={() => post({ action: 'refresh-preview', projectId }).then(setSnapshot).catch(err => setError(err.message))}>PREVIEW RA&apos;EL</button>
            <button type="button" data-testid="hvs-use-in-scene" onClick={() => post({ action: 'use-in-scene', projectId }).then(setSnapshot).catch(err => setError(err.message))}>USE IN SCENE</button>
            <button type="button" data-testid="hvs-change-appearance" onClick={() => post({ action: 'change-appearance', projectId }).then(data => {
              setSnapshot(data)
              setAppearance(data.appearance?.options ?? ['Hair', 'Skin', 'Body', 'Wardrobe', 'Style'])
            }).catch(err => setError(err.message))}>CHANGE APPEARANCE</button>
            <button type="button" data-testid="hvs-capture-face-performance" onClick={() => undefined}>CAPTURE FACIAL PERFORMANCE</button>
            <button type="button" data-testid="hvs-refresh-preview" onClick={() => post({ action: 'refresh-preview', projectId }).then(setSnapshot).catch(err => setError(err.message))}>REFRESH PREVIEW</button>
          </div>
          {appearance ? (
            <p className="hvs-actor-meta" data-testid="hvs-appearance-options">{appearance.join(' · ')}</p>
          ) : null}
          <p className="hvs-actor-meta">Next: Capture facial performance. The camera stays off until you start it.</p>
        </div>
      ) : null}

      {!ready && snapshot?.operation && !previewSrc && snapshot.previewUnavailable ? (
        <div data-testid="hvs-preview-unavailable">
          <p>HIGH-FIDELITY PREVIEW UNAVAILABLE</p>
          <p>Fast Preview: Three.js available</p>
        </div>
      ) : null}

      <div className="hvs-actor-actions">
        {state === 'CHARACTER_READY_TO_BUILD' && !running ? (
          <button type="button" data-testid="hvs-build-rael" onClick={() => build().catch(err => setError(err instanceof Error ? err.message : 'Build could not finish.'))}>BUILD RA&apos;EL</button>
        ) : null}
        {approvalRequired && !approvalOpen && !running ? (
          <button type="button" data-testid="hvs-continue-rael-build" onClick={() => post({ action: 'continue-rael-build', projectId: projectId ?? snapshot?.projectId }).then(setSnapshot).catch(err => setError(err instanceof Error ? err.message : 'Build could not finish.'))}>CONTINUE RA&apos;EL BUILD</button>
        ) : null}
        {(state === 'CHARACTER_BLOCKED' || state === 'CHARACTER_ERROR' || state === 'LIKELINESS_BLOCKED') && !running ? (
          <button type="button" data-testid="hvs-resume-build" onClick={() => resume().catch(err => setError(err instanceof Error ? err.message : 'Build could not finish.'))}>RESUME BUILD</button>
        ) : null}
      </div>

      {error ? <p data-testid="hvs-production-error">{/stack|TypeError|at Object/i.test(error) ? 'Build could not finish.' : error}</p> : null}

      <details className="hvs-tech-details" data-testid="hvs-tech-details" open={detailsOpen} onToggle={event => setDetailsOpen((event.target as HTMLDetailsElement).open)}>
        <summary>TECHNICAL DETAILS</summary>
        <div className="hvs-actor-meta">
          <span>Original references: {snapshot?.privacyDisclosure.originalReferences ?? 'LOCAL'}</span>
          <span>Epic cloud step: {snapshot?.privacyDisclosure.epicCloudStep ?? 'NOT_AUTHORIZED'}</span>
          <span>Purpose: {snapshot?.privacyDisclosure.purpose ?? 'MetaHuman likeness creation'}</span>
          <span>Training: {snapshot?.privacyDisclosure.training ?? 'NOT AUTHORIZED'}</span>
          <span>Face recognition: {snapshot?.privacyDisclosure.faceRecognition ?? 'NOT AUTHORIZED'}</span>
          <span>Voice: {snapshot?.privacyDisclosure.voice ?? 'NOT AUTHORIZED'}</span>
          <span>Operation {snapshot?.operation?.operationId ?? 'none'}</span>
          <span>State {snapshot?.productionState}</span>
          <span>Likeness {snapshot?.likenessState ?? 'none'}</span>
          <span>Authority {snapshot?.authority?.authorizationId ?? 'none'}</span>
          <span>Provider {snapshot?.authority?.provider ?? 'none'}</span>
          <span>Unreal {snapshot?.unrealProcess.status} {snapshot?.unrealProcess.version ?? ''}</span>
          <span>MHC {snapshot?.operation?.metahumanCharacterPath ?? 'reserved'}</span>
          <span>DNA {snapshot?.operation?.dna.present ? (snapshot.operation.dna.assetPath ?? 'internal') : 'not present'}</span>
          <span>RigLogic {snapshot?.operation?.dna.rigLogic ?? 'UNRIGGED'}</span>
          <span>TAKE {snapshot?.bodyPerformance.takeId}</span>
          <span>Preview {snapshot?.highFidelityPreview?.assetPath ?? 'none'}</span>
          {(snapshot?.operation?.receipts ?? []).map(receipt => (
            <span key={receipt.stage}>{receipt.stage}: {receipt.status}{receipt.errorCode ? ` ${receipt.errorCode}` : ''}</span>
          ))}
          {(snapshot?.operation?.likenessReceipts ?? []).map(receipt => (
            <span key={receipt.stage}>{receipt.stage}: {receipt.status}</span>
          ))}
          {snapshot?.operation?.lastError ? <span data-testid="hvs-advanced-error">{snapshot.operation.lastError}</span> : null}
        </div>
      </details>

      <details className="hvs-tech-details" data-testid="hvs-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen((event.target as HTMLDetailsElement).open)}>
        <summary>ADVANCED</summary>
        <div className="hvs-actor-actions">
          <button type="button" data-testid="hvs-open-in-unreal" onClick={() => post({ action: 'open-required-step', projectId }).then(setSnapshot).catch(() => undefined)}>OPEN IN UNREAL</button>
          <button type="button">Open asset</button>
          <button type="button">Inspect binding</button>
          <button type="button">View receipts</button>
          <button type="button">View validation</button>
          <button type="button">Open logs</button>
          <button type="button">Rebuild stage</button>
        </div>
      </details>
    </section>
  )
}
