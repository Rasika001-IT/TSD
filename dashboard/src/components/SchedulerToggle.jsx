// dashboard/src/components/SchedulerToggle.jsx
// Masthead on/off switch for automatic generation. ON = the scheduler drafts
// the day's posts ~30 min before their slot (per the editorial calendar). OFF =
// no auto-generation; the team posts manually. Backed by a DB-stored flag, so
// it governs the scheduler process wherever it runs.
import React from 'react';
import { api } from '../api.js';

export function SchedulerToggle({ enabled, available, onChange, flash }) {
  const toggle = async () => {
    try {
      const { schedulerEnabled } = await api.setScheduler(!enabled);
      onChange(schedulerEnabled);
      flash(`Auto-generation ${schedulerEnabled ? 'ON' : 'OFF'}`);
    } catch (e) {
      flash(e.message, true);
    }
  };
  return (
    <button
      className={`sched-toggle ${enabled ? 'on' : 'off'}`}
      onClick={toggle}
      disabled={!available && !enabled}
      title={available ? 'Toggle automatic post generation' : 'Set ANTHROPIC_API_KEY to enable generation'}
    >
      <span className="dot" /> Auto-gen: {enabled ? 'ON' : 'OFF'}
    </button>
  );
}
