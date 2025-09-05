// 12_autoBumpFollowUps.gs — nightly cadence bump (rev 2025‑07‑15)

/* global CONFIG, SheetsIO, rowToObj, scheduleNextFollowUp */

/* The file now relies on the global `isoMid` helper defined in the guard. */
'use strict';

/**
 * Nightly:
 *   • for each row where next_follow_up_iso < today (and not snoozed)
 *   • increment follow_up_count & set next FU date via CONFIG.FOLLOW_UP_DELAYS
 *   • skips FINAL_STAGES and rows already at MAX_FOLLOW_UPS
 */
function bumpOverdueFollowUps() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) {
    Logger.log('CRM sheet empty — nothing to bump.');
    return;
  }

  const col = n => head.indexOf(n);
  const iStage  = col('pipeline_stage');
  const iNext   = col('next_follow_up_iso');
  const iCnt    = col('follow_up_count');
  const iSnooze = col('snoozed_until');

  if (iStage === -1 || iNext === -1 || iCnt === -1) {
    Logger.log('Required columns missing — aborting bump.');
    return;
  }

  /* today midnight */
  const todayTs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  let changed = false;

  rows.forEach((r, idx) => {

    /* final stage? */
    const stage = String(r[iStage]).trim();
    if (CONFIG.FINAL_STAGES.includes(stage)) return;

    /* next FU date due? */
    if (isNaN(isoMid(r[iNext])) || isoMid(r[iNext]) >= todayTs) return;

    /* snoozed into the future? */
    if (iSnooze !== -1 && isoMid(r[iSnooze]) > todayTs) return;

    /* max FU count reached? */
    const cnt = Number(r[iCnt]) || 0;
    if (cnt >= CONFIG.MAX_FOLLOW_UPS) return;

    /* ---- bump record ---- */
    const rec = rowToObj(head, r);
    scheduleNextFollowUp(rec);                // updates count & next dates

    /* overwrite in-memory row */
    head.forEach((h, c) => { rows[idx][c] = rec[h] ?? ''; });
    changed = true;
  });

  /* batch‑write only if any row changed */
  if (changed) {
    SpreadsheetApp.openById(CONFIG.SHEET_ID)
      .getSheetByName(CONFIG.CRM_SHEET_NAME)
      .getRange(2, 1, rows.length, head.length)
      .setValues(rows);

    SheetsIO.flushCache();
    Logger.log('Overdue follow‑ups bumped to next cadence.');
  } else {
    Logger.log('No overdue follow‑ups found.');
  }
}
