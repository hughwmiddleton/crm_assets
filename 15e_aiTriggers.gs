/**
 * 15e_aiTriggers.gs — one-shot & daily trigger helpers
 * ----------------------------------------------------
 * • Quota-safe: never creates more than ONE time-based trigger
 *   with the same handler.
 * • Refuses to exceed Google’s 20-trigger hard limit.
 * • Wrapped in an idempotent IIFE so hot-reloads are safe.
 */

;(function () {
  'use strict';
  if (globalThis.__OWTI_AI_TRIGGERS_LOADED__) return;
  globalThis.__OWTI_AI_TRIGGERS_LOADED__ = true;

  /* ── constants ─────────────────────────────── */
  var MAX_GOOGLE_LIMIT = 20;                // per-user CLOCK-trigger limit
  var ONE_SHOT_NAME    = 'runQueuedFollowUps';
  var DAILY_NAME       = 'prepareTodaysFollowUps';
  var TIME_ZONE        = globalThis.__OWTI_TZ__ || 'Australia/Melbourne';

  /* ── one-shot worker ───────────────────────── */
  function runQueuedFollowUps () {
    try {
      if (typeof prepareTodaysFollowUps === 'function') {
        // starts mini-batches inside one run
        prepareTodaysFollowUps();
      }
    } finally {
      // auto-destruct so quota never builds up
      ScriptApp.getProjectTriggers()
        .filter(function(t){ return t.getHandlerFunction() === ONE_SHOT_NAME; })
        .forEach(function(t){ ScriptApp.deleteTrigger(t); });
    }
  }

  /* ── queue helper (UI button) ──────────────── */
  function queueFollowUpBatch () {
    var triggers = ScriptApp.getProjectTriggers();

    // already have a pending one-shot?
    var has = triggers.some(function(t){
      return t.getHandlerFunction() === ONE_SHOT_NAME &&
             t.getTriggerSource()   === ScriptApp.TriggerSource.CLOCK;
    });
    if (has) return;

    // at Google’s 20-trigger hard limit?
    var clockCount = triggers.filter(function(t){
      return t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK;
    }).length;
    if (clockCount >= MAX_GOOGLE_LIMIT) return;

    // safe to schedule in 5 s
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
      .filter(function(t){ return t.getHandlerFunction() === DAILY_NAME; })
      .forEach(function(t){ ScriptApp.deleteTrigger(t); });

    ScriptApp.newTrigger(DAILY_NAME)
             .timeBased()
             .everyDays(1)
             .atHour(7)                      // 07:00 in chosen TZ
             .inTimezone(TIME_ZONE)
             .create();
  }

  /* ── exports (attach to globalThis) ────────── */
  globalThis.queueFollowUpBatch   = queueFollowUpBatch;
  globalThis.runQueuedFollowUps   = runQueuedFollowUps;
  globalThis.createAIDailyTrigger = createAIDailyTrigger;
})();

/**
 * IDE helper so “Run”-menu can create the daily trigger
 * ----------------------------------------------------
 * — Shows up as installDailyFollowUpTrigger in the dropdown
 * — Simply forwards to the real installer exported above
 */
function installDailyFollowUpTrigger () {
  if (typeof globalThis.createAIDailyTrigger === 'function') {
    globalThis.createAIDailyTrigger();
  } else {
    throw new Error('createAIDailyTrigger is not loaded - check that files are saved.');
  }
}
