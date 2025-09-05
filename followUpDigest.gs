/* global CONFIG, SheetsIO, rowToObj */
'use strict';

/* Helpers that don’t rely on CONFIG at load time */
const fmtAU = d => Utilities.formatDate(d, 'Australia/Melbourne', 'yyyy-MM-dd');
const midAU = d => { d.setHours(0,0,0,0); return d; };
const asIso = v => {
  if (!v) return '';
  if (v instanceof Date) return fmtAU(new Date(v));
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
const htmlEsc = s => String(s).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

/* ---------- rows due today (uses CONFIG inside function) ---------- */
function getRowsDueToday() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) return [];

  const iIso    = head.indexOf('next_follow_up_iso');
  const iCnt    = head.indexOf('follow_up_count');
  const iStage  = head.indexOf('pipeline_stage');
  const iSnooze = head.indexOf('snoozed_until');
  if (iIso === -1 || iCnt === -1 || iStage === -1) return [];

  /* Build stage sets at runtime */
  const FINAL_SET = new Set(CONFIG.FINAL_STAGES.map(s => s.toLowerCase()));

  const today = midAU(new Date());

  return rows.filter(r => {
      const stage = (r[iStage] || '').toLowerCase();
      if (FINAL_SET.has(stage)) return false;

      const snoozeIso = asIso(r[iSnooze]);
      if (snoozeIso && new Date(`${snoozeIso}T00:00:00${TZ}`).getTime() > today) return false;

      const iso = asIso(r[iIso]);
      const cnt = Number(r[iCnt]) || 0;

      return (iso && new Date(`${iso}T00:00:00${TZ}`).getTime() <= today) || (!iso && cnt >= 1);
    })
    .map(r => rowToObj(head, r));
}

/* ---------- daily digest ---------- */
function sendDailyFollowUpDigest() {
  const due = getRowsDueToday();
  if (!due.length) { Logger.log('Daily digest: none due'); return; }

  /* Stage buckets (built now) */
  const STAGE_BUCKETS = [
    { label:'Hot / Active',     keys:['Hot','Active'] },
    { label:'Warm / Re‑engage', keys:['Warm','Re-engage'] },
    { label:'Cold',             keys:['Cold'] },
    { label:'Dormant',          keys:['Dormant'] },
    { label:'Other',            keys:['*'] }
  ];

  /* distribute rows */
  const buckets = STAGE_BUCKETS.map(b => ({ ...b, rows: [] }));
  due.forEach(o => {
    const idx = buckets.findIndex(b => b.keys.includes(o.pipeline_stage));
    const bucket = idx >= 0 ? buckets[idx] : buckets[buckets.length-1];
    bucket.rows.push(o);
  });

  buckets.forEach(b => b.rows.sort((a,b)=>(a.name||'').localeCompare(b.name||'')));

  const todayIso = fmtAU(new Date());
  let plain = `Follow‑ups due / overdue (${todayIso})\n\n`;
  let html  = `<p><strong>Follow‑ups due / overdue (${todayIso})</strong></p>\n`;

  buckets.forEach(b => {
    if (!b.rows.length) return;
    plain += `${b.label}  —  ${b.rows.length}\n`;
    html  += `<h4 style="margin:8px 0 4px;">${htmlEsc(b.label)} (${b.rows.length})</h4>\n<ul style="margin:0 0 12px 20px;">`;

    b.rows.forEach(o => {
      const url  = `https://mail.google.com/mail/u/0/#inbox/${o.thread_id}`;
      const name = o.name || '(Unknown)';
      plain += `   • ${name}\n      ${url}\n`;
      html  += `<li><a href="${url}">${htmlEsc(name)}</a></li>`;
    });

    plain += '\n';
    html  += '</ul>\n';
  });

  GmailApp.sendEmail(
    CONFIG.SELF_EMAILS[0],
    `Follow‑Ups Due Today – ${todayIso}`,
    plain,
    { htmlBody: html }
  );
}
