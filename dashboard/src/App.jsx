// dashboard/src/App.jsx
// Orchestrates the review desk: the pending_review queue and its detail, review
// decisions (approve publishes live immediately), on-demand generation, the
// auto-generation on/off toggle, a featured-image drop, and a Published view
// for post-publication review.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Queue } from './components/Queue.jsx';
import { Reader } from './components/Reader.jsx';
import { ReviewRail } from './components/ReviewRail.jsx';
import { JobWire } from './components/JobWire.jsx';
import { GeneratePanel } from './components/GeneratePanel.jsx';
import { SchedulerToggle } from './components/SchedulerToggle.jsx';
import { PublishedList } from './components/PublishedList.jsx';
import { ControlsPanel } from './components/ControlsPanel.jsx';
import { GenerationStatus } from './components/GenerationStatus.jsx';
import { LoginGate } from './components/LoginGate.jsx';

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
  const [profile, setProfile] = useState('balanced');
  const [profileOptions, setProfileOptions] = useState([]);
  const [windows, setWindows] = useState([]);
  const [schedule, setSchedule] = useState([]); // editorial weekly content-stream slots
  const [authed, setAuthed] = useState(null); // null = checking, false = gated, true = in
  const [genJobs, setGenJobs] = useState([]); // live generation progress
  const [dismissed, setDismissed] = useState(() => new Set()); // finished jobs hidden by the user
  const doneSeenRef = useRef(new Set()); // job ids we've already refreshed the queue for

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

  // Loads settings AND doubles as the auth probe: a 401 means the stored token
  // is missing/wrong → show the login gate; success → we're in.
  const loadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSchedulerEnabled(s.schedulerEnabled);
      setGenerationAvailable(s.generationAvailable);
      setModel(s.modelOverride ?? 'auto');
      setModelOptions(s.modelOptions ?? []);
      setProfile(s.costProfile ?? 'balanced');
      setProfileOptions(s.profileOptions ?? []);
      setWindows(s.publishWindows ?? []);
      setSchedule(s.editorialSchedule ?? []);
      setAuthed(true);
    } catch (e) {
      if (e.status === 401) { setAuthed(false); return; }
      setAuthed(true); // not an auth problem — let the desk render and flash the error
      flash(e.message, true);
    }
  }, [flash]);

  // Poll live generation progress. When a job newly finishes, pull its draft
  // into the queue (the queue itself isn't otherwise polled).
  const loadGenJobs = useCallback(async () => {
    try {
      const { jobs } = await api.listGenerationJobs();
      setGenJobs(jobs);
      let newlyDone = false;
      for (const j of jobs) {
        if (j.status === 'done' && !doneSeenRef.current.has(j.id)) {
          doneSeenRef.current.add(j.id);
          newlyDone = true;
        }
      }
      if (newlyDone) loadQueue();
    } catch { /* transient — keep last known state */ }
  }, [loadQueue]);

  // Initial load: probe settings/auth first, then the queue once authed, plus a clock.
  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { if (authed === true) { loadQueue(); loadGenJobs(); } }, [authed, loadQueue, loadGenJobs]);
  // While any draft is in flight, poll its progress every 2s (stops when none run).
  useEffect(() => {
    if (authed !== true || !genJobs.some((j) => j.status === 'running')) return;
    const t = setInterval(loadGenJobs, 2000);
    return () => clearInterval(t);
  }, [authed, genJobs, loadGenJobs]);
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

  const dismissJob = useCallback((id) => {
    setDismissed((cur) => new Set(cur).add(id));
  }, []);

  const content = detail?.content ?? null;
  const visibleJobs = genJobs.filter((j) => !dismissed.has(j.id));

  if (authed === false) {
    return <LoginGate onAuthed={() => { setAuthed(true); loadSettings(); loadQueue(); }} />;
  }
  if (authed === null) {
    return <div className="login-gate"><p>Connecting…</p></div>;
  }

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
              profile={profile}
              profileOptions={profileOptions}
              schedule={schedule}
              onModel={setModel}
              onProfile={setProfile}
              onSchedule={setSchedule}
              flash={flash}
            />
            <GeneratePanel onStarted={loadGenJobs} flash={flash} />
            <GenerationStatus jobs={visibleJobs} onDismiss={dismissJob} />
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
