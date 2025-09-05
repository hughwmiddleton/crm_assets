// 08_heavyTasks.gs — batch row‑highlighting (rev 2025‑07‑15)
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

/* Safe timezone constant (hoisted) */
var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

/* global CONFIG, SheetsIO */
'use strict';

/* ──────────────────────────────
 *  Local ISO parser (AU timezone)
 * ────────────────────────────── */
function _isoToMidnightTs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
}

/* ──────────────────────────────
 *  Trigger target – runs hourly
 * ────────────────────────────── */
function runQueuedHighlighting() {
  const prop   = PropertiesService.getScriptProperties();
  const queued = JSON.parse(prop.getProperty('ROWS_TO_HIGHLIGHT') || '{}');
  prop.deleteProperty('ROWS_TO_HIGHLIGHT');
  if (!Object.keys(queued).length) return;

  colourRows_(queued);
}

/* ──────────────────────────────
 *  Private colour routine
 * ────────────────────────────── */
function colourRows_(set) {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) return;

  const iId    = head.indexOf('thread_id');
  const iIso   = head.indexOf('next_follow_up_iso');
  const iStage = head.indexOf('pipeline_stage');
  if (iId === -1 || iIso === -1 || iStage === -1) return;

  const sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.CRM_SHEET_NAME);

  /* today at midnight local */
  const todayTs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

  const bg    = rows.map(() => []);
  const nCols = head.length;

  rows.forEach((r, idx) => {
    if (!set[r[iId]]) { bg[idx] = Array(nCols).fill(null); return; }

    let colour = '';

    /* overdue follow‑up? */
    if (r[iIso] && _isoToMidnightTs(r[iIso]) < todayTs) colour = '#FFC7CE';

    /* stage‑based colour */
    const stage = String(r[iStage]).trim().toLowerCase();
    if (['hot','active'].includes(stage))              colour = '#00C853';
    else if (['warm','re-engage'].includes(stage))     colour = '#C6EFCE';
    else if (stage === 'cold')                         colour = '#DDEBF7';
    else if (CONFIG.FINAL_STAGES.map(s=>s.toLowerCase()).includes(stage))
                                                      colour = '#F2F2F2';

    bg[idx] = Array(nCols).fill(colour || null);
  });

  /* Apply backgrounds in bulk */
  if (bg.some(row => row.some(c => c !== null))) {
    sh.getRange(2, 1, rows.length, nCols).setBackgrounds(bg);
  }
}
