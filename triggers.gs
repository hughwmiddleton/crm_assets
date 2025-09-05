/**
 * 11_triggers.gs — Automation scheduler
 * Disabled by default (flip `TRIGGERS_ACTIVE` → true to re‑enable).
 *
 * Depends on: CONFIG
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

  /* Prevent duplicate load on hot‑reloads */
  if (globalThis.__OWTI_TRIGGERS_LOADED__) return;
  globalThis.__OWTI_TRIGGERS_LOADED__ = true;

  /* ──────────────────────────────
   *  Master switch
   * ────────────────────────────── */
  const TRIGGERS_ACTIVE = false;     // ⬅️  Set true to activate all triggers
  var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

  /* Chainable NO‑OP proxy so stubbed calls never break fluent chains */
  const noopChain = new Proxy(() => {}, { get: () => noopChain, apply: () => noopChain });

  /** Choose real ScriptApp.newTrigger or inert stub */
  const WHEN = TRIGGERS_ACTIVE ? ScriptApp.newTrigger : () => noopChain;

  /** Helper → start a time‑based trigger in local tz */
  const timeTrigger = fn =>
    WHEN(fn).timeBased().inTimezone(TZ);

  /* ──────────────────────────────
   *  Public entry
   * ────────────────────────────── */
  globalThis.createAllCrmTriggers = function createAllCrmTriggers() {
    if (!TRIGGERS_ACTIVE) {
      Logger.log('🔕  Triggers disabled — set TRIGGERS_ACTIVE = true to enable.');
      return;
    }

    const SHEET = SpreadsheetApp.openById(CONFIG.SHEET_ID);

    /* Job specification: [handlerName, builderCallback] */
    const JOBS = [
      ['prepareTodaysFollowUps',  () => timeTrigger('prepareTodaysFollowUps').everyDays(1).atHour(7)],
      ['bumpOverdueFollowUps',    () => timeTrigger('bumpOverdueFollowUps').everyDays(1).atHour(2).nearMinute(30)],
      ['sendWeeklyFollowUpDigest',() => timeTrigger('sendWeeklyFollowUpDigest')
                                          .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).nearMinute(15)],
      ['runQueuedHighlighting',   () => timeTrigger('runQueuedHighlighting').everyHours(1)],
      ['highlightOverdueAndWonRows', () => ScriptApp.newTrigger('highlightOverdueAndWonRows')
                                                    .forSpreadsheet(SHEET).onOpen()],
      ['highlightOverdueAndWonRows', () => ScriptApp.newTrigger('highlightOverdueAndWonRows')
                                                    .forSpreadsheet(SHEET).onEdit()],
      ['monthlyDigest',           () => timeTrigger('monthlyDigest').onMonthDay(1).atHour(8)],
      ['updateMonthlyTracker',    () => timeTrigger('updateMonthlyTracker').onMonthDay(1).atHour(8).nearMinute(5)]
    ];

    /* 1️⃣  Purge existing matching triggers */
    const keep = new Set(JOBS.map(([h]) => h));
    ScriptApp.getProjectTriggers()
      .filter(t => keep.has(t.getHandlerFunction()))
      .forEach(t => ScriptApp.deleteTrigger(t));

    /* 2️⃣  Re‑create */
    JOBS.forEach(([name, builder]) => {
      if (typeof globalThis[name] !== 'function') {
        Logger.log(`↩︎  Skipped ${name} (handler not defined)`);
        return;
      }
      try {
        builder().create();
      } catch (err) {
        Logger.log(`⚠️  Failed to create ${name}: ${err}`);
      }
    });

    Logger.log('✅  All CRM triggers refreshed.');
  };
})();

function nukeFollowUpBatchTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runQueuedFollowUps')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Deleted leftover runQueuedFollowUps triggers.');
}

function purgeOldBatchTriggers() {
  const n = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runQueuedFollowUps')
    .reduce((c,t)=>(ScriptApp.deleteTrigger(t),c+1),0);
  Logger.log(`Deleted ${n} stale runQueuedFollowUps trigger(s).`);
}
function nukeAllAIDrafts() {
  const LABEL = 'AI_DRAFT—Needs approval';

  // 1. Ensure the label exists
  const lbl = GmailApp.getUserLabelByName(LABEL);
  if (!lbl) {
    Logger.log('No AI_DRAFT label in account – nothing to delete.');
    return;
  }

  // 2. Get every thread carrying the label (no 500‑thread page limit)
  const threads = lbl.getThreads();
  if (!threads.length) {
    Logger.log('AI_DRAFT label exists but no threads found.');
    return;
  }

  // 3. Remove every draft message found inside those threads
  const svc = GmailAdvanced.Users;
  let removed = 0;

  threads.forEach(th => {
    const msgs = th.getMessages();
    msgs.forEach(m => {
      if (m.isDraft()) {
        try {
          svc.Drafts.remove('me', m.getId());   // delete via REST
          removed++;
        } catch (err) {
          console.warn(`Couldn’t delete draft ${m.getId()}: ${err.message}`);
        }
      }
    });
    // Finally strip the label so it doesn’t re‑surface
    try { lbl.removeFromThread(th); } catch(_) {}
  });

  Logger.log(`nukeAllAIDrafts – deleted ${removed} draft(s).`);
}
function createMonthlyDedupeTrigger() {
  ScriptApp.newTrigger('mergeRowsByArtist')
           .timeBased().onMonthDay(1).atHour(3)
           .inTimezone(globalThis.__OWTI_TZ__).create();
}

