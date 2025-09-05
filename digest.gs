/**
 * 07_digest.gs — Monthly CRM digest e‑mail + CSV attachment
 * Runs on the 1st of each month at 08:00 AEST (helper below sets trigger).
 *
 * Depends on: CONFIG, SheetsIO
 */
'use strict';
/* ── GLOBAL GUARDS ──────────────────────────────────────────── */
var CS = (typeof CS !== 'undefined') ? CS : CardService;                 // CardService alias

if (typeof globalThis.__OWTI_TZ__ === 'undefined') {                     // timezone const
  globalThis.__OWTI_TZ__ = 'Australia/Melbourne';
}
var TZ = globalThis.__OWTI_TZ__;

if (typeof globalThis.isoMid === 'undefined') {                          // ISO→midnight helper
  globalThis.isoMid = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  };
}
var isoMid = globalThis.isoMid;
/* ───────────────────────────────────────────────────────────── */

/* ──────────────────────────────
 *  Constants & helpers
 * ────────────────────────────── */
var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');
const EMAIL_TO = CONFIG.SELF_EMAILS[0] || Session.getActiveUser().getEmail();

/** ISO / Date / anything → epoch ms (local date @ midnight) */
function tsMid(v) {
  if (!v) return NaN;
  if (v instanceof Date) {
    const d = new Date(v); d.setHours(0, 0, 0, 0); return d.getTime();
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);          // tolerate full timestamp
  return m ? tsMid(new Date(+m[1], +m[2] - 1, +m[3])) : NaN;
}

/* ──────────────────────────────
 *  Main digest
 * ────────────────────────────── */
function monthlyDigest() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) return;

  const ix = name => head.indexOf(name);
  const col = {
    add  : ix('date_added'),
    last : ix('last_contact_date'),
    stage: ix('pipeline_stage')
  };
  if (col.add === -1 || col.stage === -1) return;     // sheet mis‑configured

  /* Previous calendar month window */
  const today     = new Date();
  const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstPrev = new Date(firstThis); firstPrev.setMonth(firstPrev.getMonth() - 1);

  const startTs = firstPrev.getTime();                // inclusive
  const endTs   = firstThis.getTime();                // exclusive

  /* Counters */
  let newLeads = 0,
      conversions = 0,
      losses = 0,
      bookings = 0,
      completions = 0,
      respDays = [];

  rows.forEach(r => {
    const addTs  = tsMid(r[col.add]);
    const lastTs = tsMid(r[col.last]);
    const stage  = String(r[col.stage] || '').trim();

    /* new lead if added inside month */
    if (addTs >= startTs && addTs < endTs) newLeads++;

    /* conversion / booking if record is in client stage */
    if (CONFIG.CLIENT_STAGES.includes(stage)) {
      conversions++;
      if (stage === 'Active') bookings++;
      /* completion sample */
      if (lastTs >= startTs && lastTs < endTs) completions++;
    }

    /* losses (Dead/Dormant) whose last contact inside month */
    if (CONFIG.FINAL_STAGES.includes(stage) &&
        lastTs >= startTs && lastTs < endTs) losses++;

    /* response‑time sample */
    if (addTs >= startTs && addTs < endTs &&
        lastTs >= startTs && lastTs < endTs) {
      respDays.push((lastTs - addTs) / 864e5);
    }
  });

  const convRate = (conversions + losses)
      ? `${Math.round((conversions / (conversions + losses)) * 100)}%`
      : '–';

  const avgResp  = respDays.length
      ? (respDays.reduce((a,b)=>a+b,0) / respDays.length).toFixed(1)
      : '–';

  const monthName = firstPrev.toLocaleString('en-AU', { month:'long', year:'numeric' });

  /* Plain‑text body */
  const body =
`CRM Digest — ${monthName}

New Leads Added       : ${newLeads}
Clients Converted     : ${conversions}
Studio Days Booked    : ${bookings}
Projects Finished     : ${completions}
Losses / Dead Leads   : ${losses}
Conversion Rate       : ${convRate}
Avg Response Time     : ${avgResp} days
`;


  GmailApp.sendEmail(
    EMAIL_TO,
    `OWTI CRM — Digest (${monthName})`,
    body,
    { attachments:[csvBlob] }
  );
}

/* ──────────────────────────────
 *  Trigger helper
 *  Schedules monthlyDigest() for 1st @ 08:00 AEST
 * ────────────────────────────── */
function createMonthlyDigestTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'monthlyDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('monthlyDigest')
           .timeBased()
           .onMonthDay(1)
           .atHour(8)
           .inTimezone(TZ)
           .create();
}
