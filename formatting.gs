// 10_formatting.gs — row‑highlighting run‑on‑demand (rev 2025‑07‑15)
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

/* Safe timezone constant (shared) */
var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

/* global CONFIG */
'use strict';

/* ──────────────────────────────
 *  Local ISO → midnight TS
 * ────────────────────────────── */
var isoMid = function (iso) {               // switched to var
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
};

/** Highlight rows (overdue FU, stage colours). */
function highlightOverdueAndWonRows() {
  const sh   = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.CRM_SHEET_NAME);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;                     // headers only

  const hdr    = data[0];
  const iStage = hdr.indexOf('pipeline_stage');
  const iNext  = hdr.indexOf('next_follow_up_iso');
  if (iStage === -1 || iNext === -1) return;

  const todayTs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

  const COL = {
    overdue : '#FFC7CE',
    hot     : '#00C853',
    warm    : '#C6EFCE',
    cold    : '#DDEBF7',
    dead    : '#F2F2F2'
  };

  const stageMap = {
    hot        : COL.hot,
    active     : COL.hot,
    warm       : COL.warm,
    're-engage': COL.warm,
    cold       : COL.cold
  };
  CONFIG.FINAL_STAGES.forEach(s => (stageMap[s.toLowerCase()] = COL.dead));

  const bg = data.slice(1).map(row => {
    let fill = '';
    const nxtTs = isoMid(row[iNext]);
    if (!isNaN(nxtTs) && nxtTs < todayTs) fill = COL.overdue;
    else {
      const st = String(row[iStage]).trim().toLowerCase();
      fill = stageMap[st] || '';
    }
    return Array(hdr.length).fill(fill);
  });

  if (bg.some(r => r.some(Boolean))) {
    sh.getRange(2, 1, bg.length, hdr.length).setBackgrounds(bg);
  }
}
