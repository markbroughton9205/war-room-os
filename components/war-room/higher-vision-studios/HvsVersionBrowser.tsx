'use client'

import { useEffect, useMemo, useState } from 'react'
import { newCommandId, type EditCommand } from '@/lib/media-command/edit-commands'
import {
  HVS_VERSION_RESTORE_POLICY,
  VERSION_NAME_PRESETS,
  versionLineage,
  type VersionCompare,
  type VersionSummary,
} from '@/lib/media-command/versions'
import type { HvsProject } from '@/lib/media-command/types'

type BrowserProps = {
  project: HvsProject
  onProject: (project: HvsProject) => void
  pendingRestoreId?: string | null
  compareIds?: [string, string] | null
}

function command(kind: EditCommand['kind'], extra: Record<string, unknown> = {}): EditCommand {
  return {
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: 'human',
    kind,
    ...extra,
  } as EditCommand
}

export function HvsVersionBrowser({
  project,
  onProject,
  pendingRestoreId: restoreHint,
  compareIds,
}: BrowserProps) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [inspectedId, setInspectedId] = useState<string | null>(project.currentVersionId)
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(restoreHint ?? null)
  const [compareA, setCompareA] = useState<string | null>(compareIds?.[0] ?? null)
  const [compareB, setCompareB] = useState<string | null>(compareIds?.[1] ?? null)
  const [summaries, setSummaries] = useState<VersionSummary[]>([])
  const [compare, setCompare] = useState<VersionCompare | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (restoreHint) setPendingRestoreId(restoreHint)
  }, [restoreHint])

  useEffect(() => {
    if (compareIds?.[0]) setCompareA(compareIds[0])
    if (compareIds?.[1]) setCompareB(compareIds[1])
  }, [compareIds?.[0], compareIds?.[1]])

  useEffect(() => {
    const params = compareA && compareB ? `?a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}` : ''
    void fetch(`/api/media-command/projects/${project.id}/versions${params}`)
      .then(async res => {
        const data = await res.json() as {
          summaries?: VersionSummary[]
          compare?: VersionCompare
          error?: string
        }
        if (data.summaries) setSummaries(data.summaries)
        setCompare(data.compare ?? null)
        if (data.error) setStatus(data.error)
      })
      .catch(err => setStatus(err instanceof Error ? err.message : 'Version catalog failed.'))
  }, [project.id, project.currentVersionId, project.versions.length, project.updatedAt, compareA, compareB])

  const rows = summaries.length
    ? summaries
    : project.versions.map(version => ({
      id: version.id,
      index: version.index,
      name: version.label,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      parentVersionId: version.parentVersionId,
      description: version.description ?? '',
      durationSec: version.durationSec ?? 0,
      aspect: version.aspect ?? project.timeline.aspect,
      clipCount: version.clipCount ?? 0,
      trackCount: 0,
      captionCount: 0,
      titleCount: 0,
      logoCount: 0,
      transitionCount: 0,
      renderCount: project.renderJobs.filter(job => job.versionId === version.id).length,
      assetCount: 0,
      thumbnailPath: version.thumbnailPath ?? null,
      hasSnapshot: Boolean(version.snapshotPath),
      isCurrent: version.id === project.currentVersionId,
      restoredFromVersionId: version.restoredFromVersionId ?? null,
    }))

  const lineage = useMemo(() => versionLineage(project), [project])
  const inspected = rows.find(row => row.id === inspectedId) ?? rows.find(row => row.isCurrent) ?? null
  const pending = rows.find(row => row.id === pendingRestoreId) ?? null
  const selectedSource = inspected && !inspected.isCurrent ? inspected : rows.find(row => !row.isCurrent) ?? null
  const nextLabel = label.trim() || `Version ${project.versions.length + 1}`

  async function commit(commands: EditCommand[]) {
    setBusy(true)
    setStatus('Saving…')
    try {
      const res = await fetch(`/api/media-command/projects/${project.id}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands }),
      })
      const data = await res.json() as { project?: HvsProject; errors?: string[] }
      if (data.project) onProject(data.project)
      setStatus(data.errors?.join('; ') || 'Committed.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Version command failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="hvs-v3-version-browser foundry-glass rounded-lg border border-amber-900/40 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)]" data-testid="hvs-version-browser">
      <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-amber-300">Version Browser</p>
      <p className="text-[10px] leading-snug text-slate-400" data-testid="hvs-version-policy">{HVS_VERSION_RESTORE_POLICY}</p>

      <div className="flex flex-wrap gap-1">
        {VERSION_NAME_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            className="hvs-v3-chip"
            data-testid={`hvs-version-preset-${preset.replace(/\s+/g, '-').toLowerCase()}`}
            onClick={() => setLabel(preset)}
          >{preset}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="AI FIRST CUT / VERTICAL CUT / ALTERNATE CUT"
          data-testid="hvs-version-label"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-amber-50"
        />
        <button
          type="button"
          data-testid="hvs-create-version"
          disabled={busy}
          className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100"
          onClick={() => void commit([command('createVersion', { versionLabel: nextLabel, createdBy: 'human', description: description.trim() || undefined })])}
        >Create version</button>
      </div>
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Optional description"
        className="rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-200"
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          data-testid="hvs-version-create-from"
          disabled={busy || !selectedSource}
          className="hvs-v3-chip"
          onClick={() => selectedSource && void commit([command('createVersionFrom', {
            sourceVersionId: selectedSource.id,
            versionLabel: `${selectedSource.name} — branch`,
            createdBy: 'human',
          })])}
        >Create version from this</button>
        <button
          type="button"
          data-testid="hvs-version-derive-vertical"
          disabled={busy}
          className="hvs-v3-chip"
          onClick={() => void commit([command('deriveVerticalVersion', { versionLabel: `${project.name} — 9:16 VERTICAL` })])}
        >Derive 9:16</button>
      </div>

      <ul className="hvs-v3-version-list" data-testid="hvs-version-list">
        {rows.map(row => {
          const current = row.isCurrent
          const inspecting = inspectedId === row.id
          return (
            <li
              key={row.id}
              className="hvs-v3-version-row"
              data-testid="hvs-version-row"
              data-current={current ? 'true' : 'false'}
              data-version-id={row.id}
              style={{
                borderColor: current ? 'rgba(61,255,138,0.45)' : inspecting ? 'rgba(92,225,255,0.45)' : undefined,
                cursor: 'pointer',
              }}
              onClick={() => setInspectedId(row.id)}
            >
              <div>
                <p className="text-[11px] text-amber-50">
                  v{row.index} {row.name}
                  {current ? <span className="ml-2 text-[9px] uppercase tracking-widest text-emerald-300" data-testid="hvs-version-current-badge">Current</span> : null}
                  {inspecting && !current ? <span className="ml-2 text-[9px] uppercase tracking-widest text-cyan-300">Inspect</span> : null}
                </p>
                <p className="text-[10px] text-slate-400">
                  {row.createdBy} · {row.aspect} · {row.durationSec.toFixed(2)}s · {row.clipCount} clips
                  {row.hasSnapshot ? '' : ' · no snapshot'}
                  {row.description ? ` · ${row.description}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1" onClick={event => event.stopPropagation()}>
                <button type="button" className="hvs-v3-chip" data-compare="a" data-testid="hvs-version-compare-a" onClick={() => setCompareA(row.id)}>A</button>
                <button type="button" className="hvs-v3-chip" data-compare="b" data-testid="hvs-version-compare-b" onClick={() => setCompareB(row.id)}>B</button>
                {current ? null : (
                  <button
                    type="button"
                    data-testid="hvs-version-restore"
                    className="hvs-v3-chip"
                    disabled={!row.hasSnapshot}
                    onClick={() => { setInspectedId(row.id); setPendingRestoreId(row.id) }}
                  >Restore</button>
                )}
              </div>
            </li>
          )
        })}
        {rows.length === 0 ? <li className="text-[11px] text-slate-500">No versions yet.</li> : null}
      </ul>

      {inspected ? (
        <p className="text-[11px] text-slate-300" data-testid="hvs-version-inspect">
          Inspecting {inspected.name} · {inspected.clipCount} clips · {inspected.durationSec.toFixed(2)}s · {inspected.aspect}. Inspect does not change the live timeline.
        </p>
      ) : null}

      {pending ? (
        <div className="rounded border border-amber-400/40 bg-black/30 p-2" data-testid="hvs-restore-confirm">
          <p className="text-[11px] text-amber-100">Restore {pending.name}?</p>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">Current project state will first be preserved as a PRE-RESTORE safety version. Undo will not cross this restore.</p>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              data-testid="hvs-version-confirm-restore"
              className="rounded border border-amber-400/50 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-100"
              disabled={busy || !pending.hasSnapshot}
              onClick={() => {
                void commit([command('restoreVersion', { versionId: pending.id, confirmed: true })])
                setPendingRestoreId(null)
              }}
            >Confirm restore</button>
            <button type="button" className="hvs-v3-chip" onClick={() => setPendingRestoreId(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <section className="hvs-v3-version-facts" data-testid="hvs-version-compare">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">METADATA / TIMELINE COMPARISON</p>
        {compareA && compareB && compare ? (
          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300">
            <li>{compare.a.name} → {compare.b.name}</li>
            <li>Duration Δ {compare.durationDeltaSec.toFixed(2)}s</li>
            <li>Clip count Δ {compare.clipCountDelta}</li>
            <li>Added {compare.addedClipIds.length} · Removed {compare.removedClipIds.length} · Moved {compare.movedClipIds.length} · Changed {compare.changedClipIds.length}</li>
            <li>Aspect {compare.a.aspect} → {compare.b.aspect}</li>
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">Select A and B. Clip counts, duration, aspect, added/removed/moved clips — not a dual-video dashboard.</p>
        )}
        {status ? <p className="mt-1 text-[11px] text-cyan-200" data-testid="hvs-version-status">{status}</p> : null}
      </section>

      {lineage.length > 0 ? (
        <ol className="space-y-0.5 text-[10px] text-slate-500" data-testid="hvs-version-lineage">
          {lineage.map(node => (
            <li key={node.id} style={{ paddingLeft: `${node.depth * 10}px` }}>
              {node.depth > 0 ? '↳ ' : ''}{node.name}{node.isCurrent ? ' · current' : ''}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
