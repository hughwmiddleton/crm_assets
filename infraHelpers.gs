/**
 * 00_infraHelpers.gs — Infrastructure‑level helpers
 *   • Robust withRetry()
 *   • Structured logging
 *   • refreshAllCrmTriggers() — master trigger installer
 *   • setAIDailyTrigger()
 *   • onInstall()
 *
 * The helpers live inside an idempotent IIFE.  A single wrapper
 * function (run_RefreshAllCrmTriggers) sits *outside* the IIFE so the
 * IDE’s Run menu can find it.
 */
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

;(() => {
  'use strict';
  if (globalThis.__OWTI_INFRA_LOADED__) return;
  globalThis.__OWTI_INFRA_LOADED__ = true;

  var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

  /* ─────────── retry wrapper ─────────── */
  if (!globalThis.withRetry) {
    globalThis.withRetry = function withRetry(fn, max = 3, delay = 500) {
      let lastErr;
      for (let i = 0; i < max; i++) {
        try { return fn(); }
        catch (e) {
          lastErr = e;
          if (i < max - 1) { Utilities.sleep(delay); delay *= 2; }
        }
      }
      throw lastErr;
    };
  }

  /* ─────────── logging helpers ───────── */
  const logInfo  = msg => { try { console.log(msg); } catch { Logger.log(msg); } };
  const logError = err => { try { console.error(err); } catch { Logger.log(err); } };

  /* ─────────── trigger bootstrap ─────── */
  function refreshAllCrmTriggers() {
    const SHEET    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const HANDLERS = [
      // daily
      'prepareTodaysFollowUps',
      'bumpOverdueFollowUps',
      'sendDailyFollowUpDigest',
      // hourly
      'runQueuedHighlighting',
      // monthly
      'monthlyDigest',
      'updateMonthlyTracker',
      // sheet events
      'highlightOverdueAndWonRows'
    ];

    /* Purge */
    ScriptApp.getProjectTriggers()
      .filter(t => HANDLERS.includes(t.getHandlerFunction()))
      .forEach(t => ScriptApp.deleteTrigger(t));

    /* DAILY */
    ScriptApp.newTrigger('prepareTodaysFollowUps')
             .timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
    ScriptApp.newTrigger('bumpOverdueFollowUps')
             .timeBased().everyDays(1).atHour(2).nearMinute(30).inTimezone(TZ).create();
    ScriptApp.newTrigger('sendDailyFollowUpDigest')
             .timeBased().everyDays(1).atHour(7).nearMinute(5).inTimezone(TZ).create();

    /* HOURLY */
    ScriptApp.newTrigger('runQueuedHighlighting')
             .timeBased().everyHours(1).inTimezone(TZ).create();

    /* SHEET EVENTS */
    ScriptApp.newTrigger('highlightOverdueAndWonRows').forSpreadsheet(SHEET).onOpen().create();
    ScriptApp.newTrigger('highlightOverdueAndWonRows').forSpreadsheet(SHEET).onEdit().create();

    /* MONTHLY (1st) */
    ScriptApp.newTrigger('monthlyDigest')
             .timeBased().onMonthDay(1).atHour(8).inTimezone(TZ).create();
    ScriptApp.newTrigger('updateMonthlyTracker')
             .timeBased().onMonthDay(1).atHour(9).inTimezone(TZ).create();

    logInfo('✅  All CRM triggers refreshed.');
  }

  /* ─────────── single AI‑draft trigger ────────── */
  function setAIDailyTrigger(hour = 7) {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === 'prepareTodaysFollowUps')
      .forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger('prepareTodaysFollowUps')
             .timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
    logInfo(`🔄  AI daily trigger set for ${hour}:00 ${TZ}.`);
  }

  /* ─────────── onInstall hook ─────────── */
  function onInstall(e) { refreshAllCrmTriggers(); }

  /* ─────────── exports ─────────── */
  Object.assign(globalThis, {
    logInfo,
    logError,
    refreshAllCrmTriggers,
    setAIDailyTrigger,
    onInstall
  });
})();

/* --------------------------------------------------------------------
 *  TOP‑LEVEL WRAPPER so the IDE’s Run menu can execute the refresh.
 *  You may delete this helper after running it once.
 * ------------------------------------------------------------------*/
function run_RefreshAllCrmTriggers() {
  refreshAllCrmTriggers();
}
