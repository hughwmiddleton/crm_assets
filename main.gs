/**
 * 06_main.gs — Core entry-points & actions
 * (v 2025-07-21, trigger-safe UI batch)
 *
 * Exports:
 *   buildAddOn, saveClient, clearFollowUp, completeFollowUp,
 *   handleStageChange, uiRunBatch
 *
 * Depends on helpers & cards defined elsewhere.
 */

/* ── GLOBAL GUARDS ──────────────────────────────────────────── */
var CS = (typeof CS !== 'undefined') ? CS : CardService;      // CardService alias
var cs = (typeof cs !== 'undefined') ? cs : CS;               // lowercase alias

/* global CONFIG, SheetsIO, cleanIsoDate, canonicalEmail,
          syncPipelineLabel, applyPipelineLabel,
          buildOverviewCard, buildPipelineSummaryCard,
          buildUnresponsiveCard, buildDueTodayCard,
          queueFollowUpBatch */

/* We intentionally do **not** call prepareTodaysFollowUps directly here
   from the UI — that heavy batch runs via a background trigger queued by
   queueFollowUpBatch() (see 15e_aiTriggers.gs). */

'use strict';

/* ────────────────────────── scoped helpers (no globals) ───────────────── */
(() => {
  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  }
  function gVal(inputs, key) {
    return inputs?.[key]?.stringInputs?.value?.[0] || '';
  }
  function bootGmail(e) {
    if (e.gmail?.accessToken) {
      GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    }
  }
  Object.assign(globalThis, { __main_utils: { parseIso, gVal, bootGmail } });
})();
const { parseIso, gVal, bootGmail } = globalThis.__main_utils;

/* ────────────────────────── follow-up cadence helper ─────────────────── */
function scheduleNextFollowUp(rec) {
  const n     = (Number(rec.follow_up_count) || 0) + 1;
  const delay = CONFIG.FOLLOW_UP_DELAYS[n] || 21;          // default 3 weeks
  const d     = new Date(); d.setDate(d.getDate() + delay);

  rec.follow_up_count    = String(n);
  rec.next_follow_up     = d.getTime();
  rec.next_follow_up_iso = Utilities.formatDate(
    d, 'Australia/Melbourne', 'yyyy-MM-dd'
  );
}

/* ────────────────────────── main router (sidebar views) ──────────────── */
function buildAddOn(e) {
  const p = e.commonEventObject?.parameters;
  switch (p?.view) {
    case 'summary':      return buildPipelineSummaryCard();
    case 'unresponsive': return buildUnresponsiveCard();
    case 'dueToday':     return (typeof buildDueTodayCard === 'function')
                            ? buildDueTodayCard()
                            : buildOverviewCard(e);
    default:             return buildOverviewCard(e);
  }
}

/* ========================= SAVE / UPDATE ========================= */
function saveClient(e) {
  bootGmail(e);

  const fm     = e.commonEventObject.formInputs || {};
  const prm    = e.commonEventObject.parameters || {};
  const tid    = prm.threadId;
  const thread = GmailApp.getThreadById(tid);

  const found  = SheetsIO.getClientData(tid, gVal(fm,'email'));
  const rec    = found ? { ...found.rec } : { thread_id: tid };
  const rowIdx = found?.rowIndex || null;

  rec.date_added        = cleanIsoDate(rec.date_added || prm.date_added);
  rec.last_contact_date = cleanIsoDate(rec.last_contact_date || prm.last_contact_date);

  [
    'name','location','sounds_like','email','pipeline_stage','follow_up_count'
  ].forEach(k => {
    const v = gVal(fm,k).trim();
    if (v !== '') rec[k] = v;
  });

  /* canonicalise emails */
  rec.emails = (rec.emails || '').split(/\s*,\s*/)
                .map(a => a.toLowerCase().trim())
                .filter(a => a && !CONFIG.SELF_EMAILS.includes(a))
                .map(canonicalEmail)
                .join(', ');

  /* note */
  const note = gVal(fm,'new_note').trim();
  if (note) {
    const ts = Utilities.formatDate(new Date(), 'Australia/Melbourne', 'yyyy-MM-dd HH:mm');
    rec.notes = (rec.notes ? rec.notes + '\n' : '') + `[${ts}] ${note}`;
  }

  /* next FU / snooze */
  const nextIso = cleanIsoDate(gVal(fm,'next_follow_up_iso'));
  if (nextIso) { rec.next_follow_up_iso = nextIso; rec.next_follow_up = parseIso(nextIso); }
  const snoozeIso = cleanIsoDate(gVal(fm,'snoozed_until'));
  if (snoozeIso) rec.snoozed_until = snoozeIso;

  SheetsIO.saveClientRecord(rec,rowIdx);

  /* label sync */
  if (rec.pipeline_stage) {
    if (typeof syncPipelineLabel === 'function')   syncPipelineLabel(thread, rec.pipeline_stage);
    else if (typeof applyPipelineLabel === 'function') applyPipelineLabel(tid, rec.pipeline_stage);
  }

  return CS.newActionResponseBuilder()
           .setNotification(CS.newNotification().setText('Client saved ✅'))
           .build();
}

/* ========================= CLEAR FOLLOW-UP ========================= */
function clearFollowUp(e) {
  bootGmail(e);
  const tid    = e.commonEventObject.parameters.threadId;
  const thread = GmailApp.getThreadById(tid);
  const found  = SheetsIO.getClientData(tid);

  if (!found) {
    return CS.newActionResponseBuilder()
             .setNotification(CS.newNotification().setText('No record to clear.'))
             .build();
  }

  const rec = { ...found.rec, next_follow_up:'', next_follow_up_iso:'', snoozed_until:'' };
  SheetsIO.saveClientRecord(rec,found.rowIndex);
  if (typeof syncPipelineLabel === 'function') syncPipelineLabel(thread, rec.pipeline_stage);

  return CS.newActionResponseBuilder()
           .setNotification(CS.newNotification().setText('Follow-up cleared'))
           .setNavigation(CS.newNavigation().popToRoot())
           .build();
}

/* ========================= COMPLETE FOLLOW-UP ========================= */
function completeFollowUp(e) {
  bootGmail(e);
  const tid    = e.commonEventObject.parameters.threadId;
  const thread = GmailApp.getThreadById(tid);
  const found  = SheetsIO.getClientData(tid);

  if (!found) {
    return CS.newActionResponseBuilder()
             .setNotification(CS.newNotification().setText('No record found.'))
             .build();
  }

  const rec = {
    ...found.rec,
    last_contact_date: cleanIsoDate(new Date()),
    next_follow_up:'', next_follow_up_iso:'', snoozed_until:''
  };
  scheduleNextFollowUp(rec);
  SheetsIO.saveClientRecord(rec, found.rowIndex);
  if (typeof syncPipelineLabel === 'function') syncPipelineLabel(thread, rec.pipeline_stage);

  return CS.newActionResponseBuilder()
           .setNotification(
             CS.newNotification()
               .setText(`Follow-up #${rec.follow_up_count} completed & rescheduled`)
           )
           .setNavigation(CS.newNavigation().popToRoot())
           .build();
}

/* ========================= UI HANDLERS ========================= */
function handleStageChange(e) {
  bootGmail(e);
  const tid      = e.parameters.threadId;
  const newStage = e.commonEventObject.formInputs.pipeline_stage.stringInputs.value[0];

  const found = SheetsIO.getClientData(tid) || {};
  const rec   = found.rec ? { ...found.rec } : { thread_id: tid };
  rec.pipeline_stage = newStage;
  SheetsIO.saveClientRecord(rec, found.rowIndex);

  if (typeof syncPipelineLabel === 'function')   syncPipelineLabel(GmailApp.getThreadById(tid), newStage);
  else if (typeof applyPipelineLabel === 'function') applyPipelineLabel(tid, newStage);

  return CS.newActionResponseBuilder()
           .setNotification(CS.newNotification().setText(`Stage → ${newStage}`))
           .setStateChanged(true)
           .build();
}

/**
 * “Run Today’s Batch” button (CRM overview card).
 * Queues the background worker (runQueuedPrepareBatch) and returns immediately,
 * so the Gmail add-on UI never times out.
 */
/** “Run Today’s Batch” button — run **immediately** (no queue) */
function uiRunBatch() {
  let made = 0, errorTxt = '';

  try {
    if (typeof prepareTodaysFollowUps === 'function') {
      made = prepareTodaysFollowUps();      // ← runs the worker synchronously
    } else {
      errorTxt = 'Worker not found – save & reload?';
    }
  } catch (err) {
    errorTxt = err.message;
  }

  const note = errorTxt
    ? `⚠️  ${errorTxt}`
    : made
        ? `${made} draft${made === 1 ? '' : 's'} created ✅`
        : 'No follow‑ups were due today 💤';

  return CS.newActionResponseBuilder()
           .setNotification(CS.newNotification().setText(note))
           .setNavigation(CS.newNavigation().popToRoot())   // go back to main card
           .build();
}
/**
 * Alias for backwards compatibility
 */
function installDailyFollowUpTrigger() {
  return createAIDailyTrigger();
}

