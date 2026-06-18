// dashboard/src/components/ControlsPanel.jsx
// Generation controls that sit above the on-demand "Generate" panel:
//  - Claude model dropdown ("Auto" = the built-in Sonnet / Opus-by-prominence
//    logic; or force a specific model).
//  - Editorial schedule: the weekly content-stream slots from the TSD standards
//    (Tue Rankings, Thu Industry Hubs, Sat Reports + daily news), each toggleable.
//    Streams not yet wired to the generation engine are flagged "soon".
import React, { useState } from 'react';
import { api } from '../api.js';

const MODEL_LABELS = {
  auto: 'Auto (Sonnet · Opus for big stories)',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-8': 'Opus 4.8 (highest quality, priciest)',
  'claude-haiku-4-5': 'Haiku 4.5 (cheapest)',
};

const PROFILE_LABELS = {
  balanced: 'Balanced (recommended)',
  'max-savings': 'Max savings (cheapest)',
  'quality-first': 'Quality-first',
};

export function ControlsPanel({ model, modelOptions, profile, profileOptions, schedule, onModel, onProfile, onSchedule, flash }) {
  const [savingSched, setSavingSched] = useState(false);

  const changeModel = async (value) => {
    try { await api.setModel(value); onModel(value); flash(`Model: ${MODEL_LABELS[value] ?? value}`); }
    catch (e) { flash(e.message, true); }
  };

  const changeProfile = async (value) => {
    try { await api.setProfile(value); onProfile(value); flash(`Cost profile: ${PROFILE_LABELS[value] ?? value}`); }
    catch (e) { flash(e.message, true); }
  };

  const toggleSlot = async (id) => {
    const next = (schedule ?? []).map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setSavingSched(true);
    try { const { editorialSchedule } = await api.setEditorialSchedule(next); onSchedule(editorialSchedule); }
    catch (e) { flash(e.message, true); }
    finally { setSavingSched(false); }
  };

  return (
    <div className="controls-panel">
      <label className="model-select">
        <span>Cost profile</span>
        <select value={profile} onChange={(e) => changeProfile(e.target.value)}>
          {(profileOptions ?? Object.keys(PROFILE_LABELS)).map((p) => (
            <option key={p} value={p}>{PROFILE_LABELS[p] ?? p}</option>
          ))}
        </select>
      </label>

      <label className="model-select">
        <span>Model</span>
        <select value={model} onChange={(e) => changeModel(e.target.value)}>
          {(modelOptions ?? Object.keys(MODEL_LABELS)).map((m) => (
            <option key={m} value={m}>{MODEL_LABELS[m] ?? m}</option>
          ))}
        </select>
      </label>

      <div className="schedule">
        <span className="windows-label">Editorial schedule</span>
        <ul className="schedule-list">
          {(schedule ?? []).map((s) => (
            <li key={s.id} className={`sched-slot ${s.enabled ? 'on' : 'off'}`}>
              <button
                className={`sched-row ${s.enabled ? 'on' : 'off'}`}
                disabled={savingSched}
                onClick={() => toggleSlot(s.id)}
                title={s.description}
              >
                <span className="sched-day">{s.day}</span>
                <span className="sched-label">
                  {s.label}
                  {!s.live && <span className="sched-soon" title="Scheduled — generator coming in a later build">soon</span>}
                </span>
                <span className={`sched-switch ${s.enabled ? 'on' : 'off'}`} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">The weekly content rhythm from the TSD editorial calendar. “Soon” streams are scheduled here but not yet auto-generated. News publishes ASAP on approval.</p>
      </div>
    </div>
  );
}
