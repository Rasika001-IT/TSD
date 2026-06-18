// dashboard/src/components/GeneratePanel.jsx
// Top-of-queue control to kick off a new AI draft on demand. Generation runs in
// the background on the API server; the new item appears in the queue when done
// (the desk already polls). This is the manual trigger / "something broke, run
// it again" button the team asked for.
import React, { useState } from 'react';
import { api } from '../api.js';

const NEWS_CATEGORIES = [
  'Markets & Economy', 'Deals & M&A', 'Leadership & C-Suite Moves',
  'Tech & Innovation', 'Industries', 'Policy & Regulation',
  'Global & Geopolitics', 'ESG & Sustainability',
];
const BLOG_CATEGORIES = [
  'Explainers & Deep Dives', 'Leadership & Strategy', 'Career & Executive Growth',
  'Money & Investing', 'Tech for Business Leaders', 'Executive Lifestyle', 'Events & Summits',
];
const RANKINGS_CATEGORIES = [
  'Industry Leaders', 'Emerging Voices', 'Regional Spotlights', 'Themed Lists', 'Annual Power Lists',
];
const CATEGORIES_BY_STREAM = { news: NEWS_CATEGORIES, blog: BLOG_CATEGORIES, rankings: RANKINGS_CATEGORIES };

export function GeneratePanel({ onStarted, flash }) {
  const [stream, setStream] = useState('news');
  const [category, setCategory] = useState(NEWS_CATEGORIES[0]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = CATEGORIES_BY_STREAM[stream] ?? NEWS_CATEGORIES;

  const onStream = (s) => {
    setStream(s);
    setCategory((CATEGORIES_BY_STREAM[s] ?? NEWS_CATEGORIES)[0]);
  };

  const run = async () => {
    setBusy(true);
    try {
      await api.generate(stream, category, topic || null);
      flash('Generation started — the draft will appear in the queue shortly.');
      setTopic('');
      onStarted?.();
    } catch (e) {
      flash(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="generate-panel">
      <h2>Generate now (override)</h2>
      <p className="gen-hint">Draft a post immediately — no waiting for a scheduled window.</p>
      <div className="row">
        <select value={stream} onChange={(e) => onStream(e.target.value)} disabled={busy}>
          <option value="news">News</option>
          <option value="blog">Blog</option>
          <option value="rankings">Rankings</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <input
        type="text"
        placeholder="Optional topic / angle hint"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        disabled={busy}
      />
      <button onClick={run} disabled={busy}>{busy ? 'Starting…' : 'Generate'}</button>
    </div>
  );
}
