'use client';

import { useEffect, useState } from 'react';
import type { McView } from '@/lib/native-builder/foundryMissionControlTypes';

type MissionListItem = { missionId: string; title: string; status: string };

const REFRESH_MS = 5000;

export function FoundryMissionControlPanel() {
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [view, setView] = useState<McView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/foundry/mission-control', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        const list: MissionListItem[] = Array.isArray(data.missions) ? data.missions : [];
        setMissions(list);
        if (list.length > 0) {
          setSelectedMissionId(list[0].missionId);
        }
      })
      .catch(() => setError('Could not load the mission list.'));
  }, []);

  useEffect(() => {
    if (!selectedMissionId) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/foundry/mission-control?missionId=${encodeURIComponent(selectedMissionId)}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          if (cancelled) return;
          if (data.view) {
            setView(data.view as McView);
            setError(null);
          } else {
            setError(typeof data.error === 'string' ? data.error : 'Mission Control view is unavailable.');
          }
        })
        .catch(() => {
          if (!cancelled) setError('Could not load Mission Control.');
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedMissionId]);

  return (
    <div className="bg-gray-900 text-white p-4">
      {missions.length > 1 && (
        <select
          data-testid="foundry-mc-picker"
          className="mb-4 bg-gray-800 text-white p-1"
          value={selectedMissionId}
          onChange={event => setSelectedMissionId(event.target.value)}
        >
          {missions.map(mission => (
            <option key={mission.missionId} value={mission.missionId}>
              {mission.title || mission.missionId} ({mission.status})
            </option>
          ))}
        </select>
      )}

      {error && <p data-testid="foundry-mc-error" className="p-2 mb-4 bg-red-500">{error}</p>}

      {/* No mission selected message */}
      {missions.length === 0 && !error && <p>No mission selected</p>}

      {!view && missions.length > 0 && !error && <p>Loading Mission Control...</p>}

      {view && (
        <>
          {/* Header section */}
          <section data-testid="foundry-mc-header" className="mb-4">
            <h1>Foundry Mission Control Panel</h1>
            <p>Objective: {view.header.objective}</p>
            <p>State: {view.attention.kind}</p>
            <p>Elapsed: {view.header.elapsed}</p>
            <p>Phase: {view.header.phase}</p>
            <p>Last progress: {view.header.lastProgress}</p>
            <p>Next action: {view.attention.message}</p>
            <p>Restarts: {view.header.restarts}</p>
          </section>

          {/* Banner section */}
          <div
            data-testid="foundry-mc-attention"
            className={`p-2 mb-4 ${view.attention.kind === 'WAITING' ? 'bg-yellow-500' : view.attention.needsCommander ? 'bg-red-500' : 'bg-green-500'}`}
            data-kind={view.attention.kind}
          >
            {view.attention.message}
          </div>

          {/* Task groups section */}
          <section data-testid="foundry-mc-task-group" className="mb-4">
            {view.taskGroups.map((group, index) => (
              <div key={index} data-state={group.state}>
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((item, i) => (
                    <li key={i}>{item.detail}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {/* Jobs list */}
          <section data-testid="foundry-mc-job" className="mb-4">
            {view.jobs.map((job, index) => (
              <div key={index}>
                <p>{job.name}</p>
                <p>State: {job.stateLabel}</p>
                <p>Elapsed: {job.elapsed}</p>
                <p>Result: {job.result}</p>
                <p>Claims: {job.claims}</p>
              </div>
            ))}
          </section>

          {/* Resources list */}
          <section data-testid="foundry-mc-resource" className="mb-4">
            {view.resources.map((resource, index: number) => (
              <div key={index}>
                <p>{resource}</p>
              </div>
            ))}
          </section>

          {/* Evidence list */}
          <section data-testid="foundry-mc-evidence" className="mb-4">
            {view.evidence.map((evidence, index: number) => (
              <div key={index} data-status={evidence.status}>
                <p>Criterion: {evidence.criterion}</p>
                <p>Proof: {evidence.proof}</p>
                <p>Label: {evidence.label}</p>
                {evidence.status === 'STALE' && <span className="text-red-500">Stale</span>}
              </div>
            ))}
          </section>

          {/* Failures list */}
          <section data-testid="foundry-mc-failures" className="mb-4">
            {view.failures.map((failure, index) => (
              <div key={index}>
                <p>{failure}</p>
              </div>
            ))}
          </section>

          {/* Timeline list */}
          <section data-testid="foundry-mc-timeline" className="mb-4">
            {view.timeline.map((event, index) => (
              <div key={index}>
                <p>At: {event.at}</p>
                <p>{event.text}</p>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
