/**
 * 15e_aiTriggers.gs — one‑shot & daily trigger helpers
 * ----------------------------------------------------
 * • Quota‑safe: never creates more than ONE time‑based trigger
 *   with the same handler.
 * • Refuses to exceed Google’s 20‑trigger hard limit.
 * • Wrapped in an idempotent IIFE so hot‑reloads are safe.
 */

;(() => {
  'use strict';
  if (globalThis.__OWTI_AI_TRIGGERS_LOADED__) return;
  globalThis.__OWTI_AI_TRIGGERS_LOADED__ = true;

  /* ── constants ─────────────────────────────── */
  const MAX_GOOGLE_LIMIT = 20;                // per‑user CLOCK‑trigger limit
  const ONE_SHOT_NAME    = 'runQueuedFollowUps';
  const DAILY_NAME       = 'prepareTodaysFollowUps';
  const TIME_ZONE        = globalThis.__OWTI_TZ__ || 'Australia/Melbourne';

  /* ── one‑shot worker ───────────────────────── */
  function runQueuedFollowUps () {
    try {
      if (typeof prepareTodaysFollowUps === 'function') {
        prepareTodaysFollowUps();            // starts mini‑batches inside one run
      }
    } finally {
      // auto‑destruct so quota never builds up
      ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === ONE_SHOT_NAME)
        .forEach(t => ScriptApp.deleteTrigger(t));
    }
  }

  /* ── queue helper (UI button) ──────────────── */
  function queueFollowUpBatch () {
    const triggers = ScriptApp.getProjectTriggers();

    // already have a pending one‑shot?
    const has = triggers.some(
      t => t.getHandlerFunction() === ONE_SHOT_NAME &&
           t.getTriggerSource()   === ScriptApp.TriggerSource.CLOCK
    );
    if (has) return;

    // at Google’s 20‑trigger hard limit?
    const clockCount = triggers.filter(
      t => t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK
    ).length;
    if (clockCount >= MAX_GOOGLE_LIMIT) return;

    // safe to schedule in 5 s
    try {
      ScriptApp.newTrigger(ONE_SHOT_NAME)
               .timeBased().after(5 * 1000)
               .create();
    } catch (err) {
      if (!/too many time-based triggers/i.test(err.message)) throw err;
    }
  }

  /* ── daily 07:00 trigger installer ─────────── */
  function createAIDailyTrigger () {
    // remove any previous daily trigger first
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === DAILY_NAME)
      .forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger(DAILY_NAME)
             .timeBased()
             .everyDays(1)
             .atHour(7)                      // 07:00 in chosen TZ
             .inTimezone(TIME_ZONE)
             .create();
  }

  /* ── exports (available via globalThis) ────── */
  Object.assign(globalThis, {
    queueFollowUpBatch,
    runQueuedFollowUps,
    createAIDailyTrigger
  });
})();

/**
 * IDE helper so “Run”‑menu can create the daily trigger
 * ----------------------------------------------------
 * — Shows up as installDailyFollowUpTrigger in the dropdown
 * — Simply forwards to the real installer exported above
 */
function installDailyFollowUpTrigger () {
  if (typeof globalThis.createAIDailyTrigger === 'function') {
    globalThis.createAIDailyTrigger();
  } else {
    throw new Error('createAIDailyTrigger is not loaded ‑ check that files are saved.');
  }
}
