// 14_monthlyTracker.gs — KPI tracker sync + digest (rev 2025‑07‑18, p3)
/* global CONFIG */
'use strict';

/* ──────────────────────────────
 *  Workbook & tab names
 * ────────────────────────────── */
const TRACKER_SHEET_ID = '1Hpe5SbpVs9zQVGQA0v7vm3E5CSE7PHtYQuyztYCpsGk';
const TABS = {
  pipeline : 'Client Pipeline',
  bookings : 'Bookings & Revenue',
  outreach : 'Outreach & Growth'
};

/* ──────────────────────────────
 *  Helpers (duplicate‑safe)
 * ────────────────────────────── */

/* ISO | Date → local‑midnight TS */
if (!globalThis.__OWTI_localIso__) {
  globalThis.__OWTI_localIso__ = function _localIso(v) {
    if (!v) return NaN;
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate()).getTime();
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2]-1, +m[3]).getTime() : NaN;
  };
}
var _localIso = globalThis.__OWTI_localIso__;

/* Pad row so manual columns stay in place */
if (!globalThis.__OWTI_padRow__) {
  globalThis.__OWTI_padRow__ = (arr,n) => arr.concat(Array(Math.max(n-arr.length,0)).fill(''));
}
var _pad = globalThis.__OWTI_padRow__;

/* ──────────────────────────────
 *  Main entry‑point
 * ────────────────────────────── */
function updateMonthlyTracker() {

  /* open sheets */
  const crmSheet = SpreadsheetApp.openById(CONFIG.SHEET_ID)
                                 .getSheetByName(CONFIG.CRM_SHEET_NAME);
  const tracker  = SpreadsheetApp.openById(TRACKER_SHEET_ID);

  const tabPipeline = tracker.getSheetByName(TABS.pipeline);
  const tabBookings = tracker.getSheetByName(TABS.bookings);
  const tabOutreach = tracker.getSheetByName(TABS.outreach);

  if (!crmSheet || !tabPipeline || !tabBookings || !tabOutreach) {
    throw new Error('❌  One or more tracker sheets not found.');
  }

  /* ---------- pull CRM data ---------- */
  const data = crmSheet.getDataRange().getValues();
  if (!data.length) return;
  const head = data[0];

  const cAdd   = head.indexOf('date_added');
  const cStage = head.indexOf('pipeline_stage');
  const cCnt   = head.indexOf('follow_up_count');

  const stats = Object.create(null);            // month → aggregate object

  data.slice(1).forEach(r => {
    const ts = _localIso(r[cAdd]);
    if (isNaN(ts)) return;

    const monthKey = Utilities.formatDate(
      new Date(ts), TZ, 'MMM yyyy');

    /* create record if first encounter of this month */
    if (!stats[monthKey]) {
      stats[monthKey] = {
        leads:0, followUps:0, conversions:0,
        bookings:0, completions:0, reengagements:0
      };
    }
    const obj = stats[monthKey];

    const stage = String(r[cStage] || '');

    obj.leads++;
    obj.followUps += Number(r[cCnt]) || 0;

    if (CONFIG.CLIENT_STAGES.includes(stage)) {
      obj.conversions++;
      if (stage === 'Active') obj.bookings++;
    }
    if (CONFIG.FINAL_STAGES.includes(stage)) obj.completions++;
    if (stage === 'Hot' || stage === 'Re-engage') obj.reengagements++;
  });

  const months = Object.keys(stats).sort((a,b)=>
    Utilities.parseDate('1 '+a,'GMT','d MMM yyyy') -
    Utilities.parseDate('1 '+b,'GMT','d MMM yyyy'));

  /* ---------- helper: merge into tab ---------- */
  function mergeIntoTab(tab, headerLabels, colMap) {
    const existing = tab.getDataRange().getValues();
    const hdr      = existing[0] || headerLabels;
    if (!existing.length) tab.appendRow(hdr);

    const rowMap = existing.slice(1)
      .reduce((m,r,i)=>{ m[r[0]] = i+2; return m; }, {});

    months.forEach(mon => {
      const metric = stats[mon];
      const rowIdx = rowMap[mon];
      const row    = rowIdx
        ? tab.getRange(rowIdx,1,1,hdr.length).getValues()[0]
        : _pad([mon], hdr.length);

      Object.entries(colMap(metric)).forEach(([label,val])=>{
        const ci = hdr.indexOf(label);
        if (ci !== -1) row[ci] = val;
      });

      if (rowIdx) {
        tab.getRange(rowIdx,1,1,hdr.length).setValues([row]);
      } else {
        tab.appendRow(row);
      }
    });
  }

  /* ---------- update three tabs ---------- */
  mergeIntoTab(
    tabPipeline,
    ['Month','New Leads Added','Follow-ups Sent','Warm/Hot Leads','Clients Converted','Notes'],
    s => ({
      'New Leads Added'  : s.leads,
      'Follow-ups Sent'  : s.followUps,
      'Clients Converted': s.conversions
    })
  );

  mergeIntoTab(
    tabBookings,
    ['Month','Studio Days Booked','Projects Finished','Revenue ($)','Top Client/Project','Notes'],
    s => ({
      'Studio Days Booked': s.bookings,
      'Projects Finished' : s.completions
    })
  );

  mergeIntoTab(
    tabOutreach,
    ['Month','Campaigns Sent','Open Rate %','Reply Rate %','Re-engagements','Next Campaign Plan'],
    s => ({
      'Re-engagements': s.reengagements
    })
  );

  /* ---------- summary e‑mail ---------- */
  const latestMonth = months[months.length-1];
  const m = stats[latestMonth];

  const body =
`Hey Hugh,

Here’s your studio snapshot for ${latestMonth}:

• New Leads Added   : ${m.leads}
• Follow‑ups Sent   : ${m.followUps}
• Clients Converted : ${m.conversions}
• Studio Days Booked: ${m.bookings}
• Projects Finished : ${m.completions}
• Re‑engagements    : ${m.reengagements}

— OWTI · CRM Tracker`;

  GmailApp.sendEmail(
    CONFIG.SELF_EMAILS[0] || 'hugh@outwiththein.com',
    `🎧 Monthly Studio Tracker — ${latestMonth}`,
    body
  );

  Logger.log(`Monthly tracker updated for ${latestMonth}.`);
}

/* ──────────────────────────────
 *  Trigger helper (1st @ 09:00)
 * ────────────────────────────── */
function createMonthlyTrackerTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateMonthlyTracker')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('updateMonthlyTracker')
           .timeBased()
           .onMonthDay(1)
           .atHour(9)          // 09:00 AEST
           .inTimezone(TZ)
           .create();
}
