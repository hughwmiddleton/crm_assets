/**
 * 15f_prepareBatch.gs — prepareTodaysFollowUps (dynamic batch size)
 * ───────────────────────────────────────────────────────────────────
 * • “Due” logic
 *     – next_follow_up_iso blank  → due
 *     – OR next_follow_up_iso ≤ today → due
 *     – rows in FINAL_STAGES or with future snooze are ignored
 * • Drafts created       : up to 15 per run (hard‑cap)
 * • Ordering             : oldest since last_contact_date first
 * • 5‑minute hard stop   : exits gracefully if quota is hit early
 * • Counts a draft only  if thread message‑count really increases
 * • No temp triggers     : runs entirely in one invocation
 * • Idempotent guard     : safe on hot‑reload
 */
;(() => {
  'use strict';
  if (globalThis.__OWTI_PREP_BATCH_LOADED__) return;
  globalThis.__OWTI_PREP_BATCH_LOADED__ = true;

  const DAILY_CAP  = 15;                    // ← fixed daily cap
  const MAX_MILLIS = 5 * 60 * 1000;         // 5‑minute safety cut‑off

  /**
   * Scans the CRM sheet for all “due” rows, sorts oldest‑first by last_contact_date,
   * then creates up to DAILY_CAP AI drafts in‑thread. Returns the number of drafts made.
   */
  function prepareTodaysFollowUps() {
    const { head, rows } = SheetsIO.getGrid();
    if (!rows.length) return 0;

    // build column lookup
    const col = h => head.indexOf(h);
    const ix = {
      tid    : col('thread_id'),
      stage  : col('pipeline_stage'),
      next   : col('next_follow_up_iso'),
      last   : col('last_contact_date'),
      snooze : col('snoozed_until')
    };
    if (Object.values(ix).some(i => i < 0)) {
      Logger.log('prepareTodaysFollowUps – required columns missing.');
      return 0;
    }

    const FINAL = new Set(CONFIG.FINAL_STAGES.map(s => s.toLowerCase()));
    const today = new Date(); today.setHours(0,0,0,0);

    // predicate: is this row due?
    const isDue = r => !r[ix.next] || new Date(r[ix.next]) <= today;

    // 1) collect every due row
    const dueRows = rows.filter(r => {
      if (FINAL.has(String(r[ix.stage]||'').toLowerCase()))    return false;
      if (r[ix.snooze] && new Date(r[ix.snooze]) > today)     return false;
      return isDue(r);
    });
    if (!dueRows.length) {
      Logger.log('prepareTodaysFollowUps – no follow‑ups due today.');
      return 0;
    }

    // 2) oldest first by last_contact_date
    const toTS = v => { const d = new Date(v||''); return isNaN(d)?0:d.getTime(); };
    dueRows.sort((a,b) => toTS(a[ix.last]) - toTS(b[ix.last]));

    // 3) cap at DAILY_CAP
    const batch    = dueRows.slice(0, DAILY_CAP);
    const deadline = Date.now() + MAX_MILLIS;
    let made = 0;

    // 4) create drafts, count only if message‑count increases
    for (const r of batch) {
      if (Date.now() >= deadline) break;  // safety exit

      try {
        const thread = GmailApp.getThreadById(r[ix.tid]);
        if (!thread) continue;
        const before = thread.getMessageCount();
        createAiDraftForThread(thread);
        if (thread.getMessageCount() > before) made++;
      } catch (e) {
        console.warn(`prepareTodaysFollowUps error: ${e.message}`);
      }
    }

    Logger.log(
      `prepareTodaysFollowUps – ${made} draft(s) created ` +
      `(of ${batch.length} attempted; ${dueRows.length} due today)`
    );
    return made;
  }

  // export for sidebar UI, time‑based triggers, and IDE
  globalThis.prepareTodaysFollowUps = prepareTodaysFollowUps;
})();

/**
 * IDE helper so you can Run → runPrepareTodaysFollowUps() from the editor.
 */
function runPrepareTodaysFollowUps() {
  const n = prepareTodaysFollowUps();
  Logger.log(`runPrepareTodaysFollowUps → ${n} draft(s)`);
}
