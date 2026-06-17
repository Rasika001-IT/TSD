// dashboard/src/App.jsx
// Orchestrates the review desk: the pending_review queue and its detail, review
// decisions (approve publishes live immediately), on-demand generation, the
// auto-generation on/off toggle, a featured-image drop, and a Published view
// for post-publication review.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Queue } from './components/Queue.jsx';
import { Reader } from './components/Reader.jsx';
import { ReviewRail } from './components/ReviewRail.jsx';
import { JobWire } from './components/JobWire.jsx';
import { GeneratePanel } from './components/GeneratePanel.jsx';
import { SchedulerToggle } from './components/SchedulerToggle.jsx';
import { PublishedList } from './components/PublishedList.jsx';
import { ControlsPanel } from './components/ControlsPanel.jsx';

export default function App() {
  const [view, setView] = useState('review'); // 'review' | 'published'
  const [items, setItems] = useState([]);
  const [published, setPublished] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null); // { content, mappings, jobs }
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [generationAvailable, setGenerationAvailable] = useState(false);
  const [model, setModel] = useState('auto');
  const [modelOptions, setModelOptions] = useState([]);
  const [windows, setWindows] = useState([]);

  const flash = useCallback((msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3600);
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const { items } = await api.listItems('pending_review');
      setItems(items);
      setActiveId((cur) => cur ?? items[0]?.id ?? null);
    } catch (e) { flash(e.message, true); }
  }, [flash]);

  const loadPublished = useCallback(async () => {
    try { setPublished((await api.listPublished()).items); }
    catch (e) { flash(e.message, true); }
  }, [flash]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try { setDetail(await api.getItem(id)); }
    catch (e) { flash(e.message, true); }
  }, [flash]);

  // Initial load: queue, settings, and a masthead clock.
  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setSchedulerEnabled(s.schedulerEnabled);
        setGenerationAvailable(s.generationAvailable);
        setModel(s.modelOverride ?? 'auto');
        setModelOptions(s.modelOptions ?? []);
        setWindows(s.publishWindows ?? []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (view === 'published') loadPublished(); }, [view, loadPublished]);
  useEffect(() => { loadDetail(activeId); }, [activeId, loadDetail]);

  // Poll the selected item's jobs so the wire stays live.
  useEffect(() => {
    if (!activeId || view !== 'review') return;
    const t = setInterval(() => loadDetail(activeId), 1500);
    return () => clearInterval(t);
  }, [activeId, view, loadDetail]);

  const onDecision = useCallback(async (decision, notes) => {
    if (!activeId) return;
    setBusy(true);
    try {
      const res = await api.review(activeId, decision, notes);
      if (decision === 'approved') {
        const live = (res.mappings ?? []).find((m) => m.remoteUrl);
        flash(live ? `Published live: ${live.remoteUrl}` : 'Approved — publishing…');
      } else {
        flash(`Recorded: ${decision.replace(/_/g, ' ')}`);
      }
      setItems((cur) => cur.filter((i) => i.id !== activeId));
      setActiveId((cur) => items.filter((i) => i.id !== cur)[0]?.id ?? null);
      loadQueue();
    } catch (e) { flash(e.message, true); }
    finally { setBusy(false); }
  }, [activeId, items, flash, loadQueue]);

  const onRegenerate = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    try { await api.regenerate(activeId); flash('Regenerating — the redo will replace this draft shortly.'); }
    catch (e) { flash(e.message, true); }
    finally { setBusy(false); }
  }, [activeId, flash]);

  const onImageUploaded = useCallback(() => loadDetail(activeId), [activeId, loadDetail]);

  const content = detail?.content ?? null;

  return (
    <>
      <header className="masthead">
        <span className="kicker">TSD Wire Desk</span>
        <h1>Editorial Review</h1>
        <nav className="views">
          <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>Review</button>
          <button className={view === 'published' ? 'active' : ''} onClick={() => setView('published')}>Published</button>
        </nav>
        <span className="spacer" />
        <SchedulerToggle
          enabled={schedulerEnabled}
          available={generationAvailable}
          onChange={setSchedulerEnabled}
          flash={flash}
        />
        <span className="clock">{clock.toTimeString().slice(0, 8)}</span>
      </header>

      {view === 'review' ? (
        <div className="desk">
          <div className="left-rail">
            <ControlsPanel
              model={model}
              modelOptions={modelOptions}
              windows={windows}
              onModel={setModel}
              onWindows={setWindows}
              flash={flash}
            />
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
            onImageUploaded={onImageUploaded}
            flash={flash}
          >
            <JobWire jobs={detail?.jobs ?? []} />
          </ReviewRail>
        </div>
      ) : (
        <div className="published-view">
          <PublishedList items={published} />
        </div>
      )}

      {toast && <div className={`toast${toast.isErr ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
