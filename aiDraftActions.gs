/**
 * aiDraftActions.gs — Gmail‑add‑on callbacks for AI follow‑up drafts
 * Depends on: bootGmail, createAiDraftForThread, deleteExistingDrafts
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

'use strict';

/* Safe alias — use var */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

/* ─────────────────────────────
 *  “Generate AI Draft” button
 * ───────────────────────────── */
function handleGenerateAiDraft(e) {
  bootGmail(e);

  const tid    = e.parameters.threadId;
  const thread = GmailApp.getThreadById(tid);
  if (!thread) {
    return CS.newActionResponseBuilder()
             .setNotification(CS.newNotification().setText('Thread not found.'))
             .build();
  }

  deleteExistingDrafts(tid);
  createAiDraftForThread(thread);

  return CS.newActionResponseBuilder()
           .setNotification(
             CS.newNotification().setText('AI draft created ✅ – check your Drafts folder')
           )
           .build();
}

/* ─────────────────────────────
 *  “Undo Draft” button
 * ───────────────────────────── */
function handleUndoAiDraft(e) {
  bootGmail(e);
  deleteExistingDrafts(e.parameters.threadId);

  return CS.newActionResponseBuilder()
           .setNotification(CS.newNotification().setText('AI draft removed'))
           .build();
}
