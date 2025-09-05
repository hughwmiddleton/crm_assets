/**
 * dev_tools.gs — Developer utilities (safe to leave deployed)
 *   • logDuplicateFunctionNames()  → lists any duplicated global functions
 *   • logTriggersByVersion()       → dumps project triggers + next run
 *   • nukeOldTriggers()            → deletes *all* project triggers
 * Wrapped in idempotent IIFE so hot‑reloads don’t redeclare.
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

  if (globalThis.__OWTI_DEV_TOOLS_LOADED__) return;
  globalThis.__OWTI_DEV_TOOLS_LOADED__ = true;

  /* ──────────────────────────────
   *  Duplicate global functions
   * ────────────────────────────── */
  function logDuplicateFunctionNames() {
    const names = Object.getOwnPropertyNames(globalThis)
      .filter(k => typeof globalThis[k] === 'function');

    const seen = new Set();
    const dup  = new Set();
    names.forEach(n => (seen.has(n) ? dup.add(n) : seen.add(n)));

    if (dup.size === 0) {
      Logger.log('✅  No duplicate global functions found!');
    } else {
      Logger.log('⚠️  Duplicate functions:\n' + [...dup].join('\n'));
    }
  }

  /* ──────────────────────────────
   *  Trigger inventory (REST)
   * ────────────────────────────── */
  function logTriggersByVersion() {
    try {
      const id   = ScriptApp.getScriptId();
      const resp = UrlFetchApp.fetch(
        `https://script.googleapis.com/v1/projects/${id}/triggers`,
        { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` } }
      );
      const list = JSON.parse(resp.getContentText()).triggers || [];
      list.forEach(tr => {
        const fn   = tr.triggerUid || tr.triggerId || '—';
        const when = tr.timeBasedTrigger
                     ? new Date(tr.timeBasedTrigger.nextRunTime).toLocaleString()
                     : '—';
        Logger.log(`${fn.padEnd(45)}  ver:${tr.deploymentId || '—'}  next:${when}`);
      });
    } catch (e) {
      Logger.log(`logTriggersByVersion error: ${e.message}`);
    }
  }

  /* ──────────────────────────────
   *  Delete *all* project triggers
   * ────────────────────────────── */
  function nukeOldTriggers() {
    ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
    Logger.log('🗑️  All project triggers deleted.');
  }

  /* Expose */
  Object.assign(globalThis, {
    logDuplicateFunctionNames,
    logTriggersByVersion,
    nukeOldTriggers
  });
})();
function logDuplicateGlobalNames() {
  const dups = Object.keys(this)
    .filter(k => typeof this[k] !== 'function')
    .filter((v, i, a) => a.indexOf(v) !== i);
  Logger.log(JSON.stringify(dups, null, 2));
}

