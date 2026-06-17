// dashboard/src/components/ControlsPanel.jsx
// Generation controls that sit above the on-demand "Generate" panel:
//  - Claude model dropdown ("Auto" = the built-in Sonnet / Opus-by-prominence
//    logic; or force a specific model).
//  - Publish-window calendar: toggle the times of day the auto-scheduler may
//    use (the blog is scheduled to the earliest enabled window).
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

export function ControlsPanel({ model, modelOptions, profile, profileOptions, windows, onModel, onProfile, onWindows, flash }) {
  const [savingWin, setSavingWin] = useState(false);

  const changeModel = async (value) => {
    try { await api.setModel(value); onModel(value); flash(`Model: ${MODEL_LABELS[value] ?? value}`); }
    catch (e) { flash(e.message, true); }
  };

  const changeProfile = async (value) => {
    try { await api.setProfile(value); onProfile(value); flash(`Cost profile: ${PROFILE_LABELS[value] ?? value}`); }
    catch (e) { flash(e.message, true); }
  };

  const toggleWindow = async (id) => {
    const next = windows.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w));
    setSavingWin(true);
    try { const { publishWindows } = await api.setWindows(next); onWindows(publishWindows); }
    catch (e) { flash(e.message, true); }
    finally { setSavingWin(false); }
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

      <div className="windows">
        <span className="windows-label">Publish windows (ET)</span>
        <div className="window-grid">
          {(windows ?? []).map((w) => (
            <button
              key={w.id}
              className={`window-chip ${w.enabled ? 'on' : 'off'}`}
              disabled={savingWin}
              onClick={() => toggleWindow(w.id)}
              title={w.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
            >
              {w.label}
            </button>
          ))}
        </div>
        <p className="hint">Auto-scheduled blogs publish at the earliest enabled window. News publishes ASAP on approval.</p>
      </div>
    </div>
  );
}
