// agent/editorial-calendar.js
// The TSD editorial rhythm, encoded from the guideline documents. Decides WHAT
// to generate on a given weekday and WHEN it should publish. Editorial policy,
// so it lives in /agent. Pure data + date math — no CMS, no Claude.
//
// Times are anchored to America/New_York (EST/EDT), the basis the guidelines use
// ("US East Coast morning"). publishHour/publishMinute are ET wall-clock.

import { NEWS_CATEGORIES, BLOG_CATEGORIES } from './tsd-guidelines.js';

// Daily news mix per weekday (from "Daily News"). Each entry is a category that
// should get one story; categories may repeat when the day calls for two.
const NEWS_PLAN = {
  1: { anchor: 'Markets Open', categories: ['Markets & Economy', 'Markets & Economy', 'Leadership & C-Suite Moves', 'Industries', 'Tech & Innovation', 'Deals & M&A'] },
  2: { anchor: 'Deals Day', categories: ['Deals & M&A', 'Deals & M&A', 'Markets & Economy', 'Tech & Innovation', 'Policy & Regulation', 'Industries'] },
  3: { anchor: 'Mid-Week Pulse', categories: ['Markets & Economy', 'Tech & Innovation', 'Leadership & C-Suite Moves', 'Global & Geopolitics', 'Industries', 'ESG & Sustainability'] },
  4: { anchor: 'Policy & Power', categories: ['Policy & Regulation', 'Policy & Regulation', 'Markets & Economy', 'Deals & M&A', 'Leadership & C-Suite Moves', 'Tech & Innovation'] },
  5: { anchor: 'Week Wrap', categories: ['Markets & Economy', 'Industries', 'Global & Geopolitics', 'Tech & Innovation', 'ESG & Sustainability'] },
};

// Weekly blog cadence (from "Blogs"). Monday / Wednesday / Friday.
const BLOG_PLAN = {
  1: { category: 'Leadership & Strategy', topicHint: 'Executive frameworks, decision-making, scaling, management lessons' },
  3: { category: 'Explainers & Deep Dives', topicHint: 'Industry trends unpacked, jargon decoded, market mechanics' },
  5: { category: 'Career & Executive Growth', topicHint: 'Rotating: Career & Growth, Money & Investing, Tech for Leaders, or Executive Lifestyle' },
};

// Publish windows (ET wall-clock), from "Publishing Times".
// News: freshness wins — publish ASAP (no fixed slot); blogs hit the 9am ET window.
export const PUBLISH_TIMES = Object.freeze({
  blog: { hour: 9, minute: 0 },   // 9:00 AM ET = 2:00 PM UK (default)
});

// Editor-configurable publish windows (ET wall-clock). The dashboard toggles
// these on/off; the blog is scheduled to the earliest ENABLED window. Stored in
// app_settings under "publish_windows"; this is the default seed.
export const DEFAULT_PUBLISH_WINDOWS = Object.freeze([
  { id: 'w-0900', label: '9:00 AM ET', time: '09:00', enabled: true },
  { id: 'w-1400', label: '2:00 PM ET', time: '14:00', enabled: false },
  { id: 'w-1800', label: '6:00 PM ET', time: '18:00', enabled: false },
]);

// News publishes ASAP on approval; the agent drafts it early in the weekday
// morning so editors have it before the workday. Slots are staggered to spread
// out the API calls (and so a reviewer sees them trickle in, not all at once).
export const NEWS_GENERATION = Object.freeze({ hour: 6, minute: 30, staggerMinutes: 4 });

// Generate this many minutes before the target publish time, leaving room for
// human review (the spec example: generate ~1:30pm for a 2:00pm publish).
export const REVIEW_LEAD_MINUTES = 30;

/** Deterministic idempotency key for a planned item on a given date. */
export function sourceIdFor(date, item) {
  const day = date.toISOString().slice(0, 10);
  const cat = item.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `tsd-${item.stream}-${day}-${cat}-${item.slotIndex ?? 0}`;
}

/** Compute the UTC Date for a given America/New_York wall-clock time on `date`. */
export function etWallClockToUtc(date, hour, minute) {
  // Find New York's UTC offset on this date by formatting a probe instant and
  // reading back the parts — handles EST/EDT without a tz library.
  const probe = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(probe).map((p) => [p.type, p.value]));
  // Offset (minutes) = local-wall-clock-of-probe minus the UTC hour we fed in (12:00).
  const localMinutesAtProbe = Number(parts.hour) * 60 + Number(parts.minute);
  const offsetMinutes = localMinutesAtProbe - 12 * 60; // negative for ET (behind UTC)
  // Desired wall-clock minutes since midnight ET, converted back to UTC.
  const utcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0)
    - offsetMinutes * 60 * 1000;
  return new Date(utcMs);
}

/**
 * Build the generation plan for a given date. News items carry no scheduledFor
 * (publish ASAP on approval); blogs carry a scheduledFor at the 9am ET window.
 *
 * @param {Date} [date] defaults to now
 * @returns {{ weekday: number, isWeekday: boolean, items: object[] }}
 */
export function planForDate(date = new Date(), opts = {}) {
  // Enabled publish windows as "HH:MM" ET strings; blog uses the earliest.
  const windows = (opts.publishWindows && opts.publishWindows.length)
    ? [...opts.publishWindows].sort()
    : ['09:00'];
  const weekday = date.getUTCDay(); // 0=Sun..6=Sat (ET vs UTC day rarely differs at gen time)
  const isWeekday = weekday >= 1 && weekday <= 5;
  const items = [];

  if (!isWeekday) {
    // No weekend news (operating principle). Blogs are weekday-anchored too.
    return { weekday, isWeekday, items };
  }

  const news = NEWS_PLAN[weekday];
  const newsBase = etWallClockToUtc(date, NEWS_GENERATION.hour, NEWS_GENERATION.minute);
  news.categories.forEach((category, i) => {
    items.push({
      stream: 'news',
      type: 'news',
      category,
      anchor: news.anchor,
      slotIndex: i,
      scheduledFor: null, // news publishes ASAP once a human approves
      generateBy: new Date(newsBase.getTime() + i * NEWS_GENERATION.staggerMinutes * 60 * 1000).toISOString(),
    });
  });

  const blog = BLOG_PLAN[weekday];
  if (blog) {
    const [bh, bm] = windows[0].split(':').map(Number);
    const publishAt = etWallClockToUtc(date, bh, bm);
    items.push({
      stream: 'blog',
      type: 'blog',
      category: blog.category,
      topicHint: blog.topicHint,
      scheduledFor: publishAt.toISOString(),
      generateBy: new Date(publishAt.getTime() - REVIEW_LEAD_MINUTES * 60 * 1000).toISOString(),
    });
  }

  return { weekday, isWeekday, items };
}

export { NEWS_CATEGORIES, BLOG_CATEGORIES };
