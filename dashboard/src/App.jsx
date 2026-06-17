// dashboard/src/App.jsx
// Orchestrates the review desk: loads the pending_review queue, the selected
// item's content + mappings + jobs, applies review decisions, and polls the
// job wire so adapter progress/errors appear live without a refresh.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Queue } from './components/Queue.jsx';
import { Reader } from './components/Reader.jsx';
import { ReviewRail } from './components/ReviewRail.jsx';
import { JobWire } from './components/JobWire.jsx';
import { GeneratePanel } from './components/GeneratePanel.jsx';

export default function App() {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null); // { content, mappings, jobs }
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState(new Date());

  const flash = useCallback((msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const { items } = await api.listItems('pending_review');
      setItems(items);
      setActiveId((cur) => cur ?? items[0]?.id ?? null);
    } catch (e) {
      flash(e.message, true);
    }
  }, [flash]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try {
      setDetail(await api.getItem(id));
    } catch (e) {
      flash(e.message, true);
    }
  }, [flash]);

  // Initial queue load + a live clock for the masthead.
  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Reload detail when selection changes.
  useEffect(() => { loadDetail(activeId); }, [activeId, loadDetail]);

  // Poll the selected item's jobs every 1.5s so the wire stays live.
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => loadDetail(activeId), 1500);
    return () => clearInterval(t);
  }, [activeId, loadDetail]);

  const onDecision = useCallback(async (decision, notes) => {
    if (!activeId) return;
    setBusy(true);
    try {
      await api.review(activeId, decision, notes);
      flash(`Recorded: ${decision.replace(/_/g, ' ')}`);
      // The item leaves pending_review; drop it and advance.
      setItems((cur) => cur.filter((i) => i.id !== activeId));
      setActiveId((cur) => {
        const remaining = items.filter((i) => i.id !== cur);
        return remaining[0]?.id ?? null;
      });
      loadQueue();
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  }, [activeId, items, flash, loadQueue]);

  const onRegenerate = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await api.regenerate(activeId);
      flash('Regenerating — the redo will replace this draft in the queue shortly.');
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  }, [activeId, flash]);

  const content = detail?.content ?? null;

  return (
    <>
      <header className="masthead">
        <span className="kicker">TSD Wire Desk</span>
        <h1>Editorial Review</h1>
        <span className="spacer" />
        <span className="clock">{clock.toTimeString().slice(0, 8)}</span>
      </header>

      <div className="desk">
        <div className="left-rail">
          <GeneratePanel onStarted={loadQueue} flash={flash} />
          <Queue items={items} activeId={activeId} onSelect={setActiveId} />
        </div>
        <Reader content={content} />
        <ReviewRail
          content={content}
          mappings={detail?.mappings ?? []}
          busy={busy}
          onDecision={onDecision}
          onRegenerate={onRegenerate}
        >
          <JobWire jobs={detail?.jobs ?? []} />
        </ReviewRail>
      </div>

      {toast && <div className={`toast${toast.isErr ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
