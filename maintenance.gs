/**
 * 09_maintenance.gs — One‑off data‑cleanup helpers
 *   1. fixDateColumns()   → normalise *_date / *_iso columns → YYYY‑MM‑DD
 *   2. dedupeCrmRows()    → remove rows that share identical e‑mail sets or thread_id
 *
 * Depends on: CONFIG, SheetsIO, cleanIsoDate, canonicalEmail
 */
'use strict';
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

/* Common constants */
var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');
const SHEET_ID  = CONFIG.SHEET_ID;
const SHEET_NAME= CONFIG.CRM_SHEET_NAME;

/* ──────────────────────────────
 *  1. Normalise all date‑ish columns
 * ────────────────────────────── */
function fixDateColumns() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) { Logger.log('CRM sheet empty.'); return; }

  /* Detect *_date / *_iso columns dynamically (case‑insensitive) */
  const DATE_RE  = /(_date|_iso)$/i;
  const dateCols = head
    .map((h, i) => DATE_RE.test(h) ? i : -1)
    .filter(i => i !== -1);

  if (!dateCols.length) { Logger.log('No *_date / *_iso columns found.'); return; }

  let changed = false;
  rows.forEach(r => {
    dateCols.forEach(ci => {
      const cleaned = cleanIsoDate(r[ci]);
      if (cleaned && cleaned !== r[ci]) {
        r[ci] = cleaned;
        changed = true;
      }
    });
  });

  if (!changed) { Logger.log('All date cells already normalised.'); return; }

  /* Batch overwrite (data rows only) */
  SpreadsheetApp.openById(SHEET_ID)
    .getSheetByName(SHEET_NAME)
    .getRange(2, 1, rows.length, head.length)
    .setValues(rows);

  SheetsIO.flushCache();
  Logger.log('✅ Date columns normalised.');
}

/* ──────────────────────────────
 *  2. Remove exact‑duplicate rows
 * ────────────────────────────── */
function dedupeCrmRows() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) return;

  const iEmails = head.indexOf('emails') !== -1 ? head.indexOf('emails') : head.indexOf('email');
  const iId     = head.indexOf('thread_id');
  if (iEmails === -1 && iId === -1) {
    Logger.log('CRM sheet missing "emails" and "thread_id" columns — cannot dedupe.');
    return;
  }

  const seenEmails = new Map();     // canonical email set → row#
  const seenIds    = new Map();     // thread_id → row#
  const dupRows    = [];

  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // sheet rows are 1‑based

    /* E‑mail‑set key (sorted canonical list) */
    let emailKey = '';
    if (iEmails !== -1) {
      emailKey = r[iEmails]
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(canonicalEmail)
        .sort()
        .join(',');
    }

    /* Thread ID key */
    const idKey = iId !== -1 ? String(r[iId]).trim() : '';

    /* Duplicate detection */
    const dup = (emailKey && seenEmails.has(emailKey)) ||
                (idKey && seenIds.has(idKey));

    if (dup) {
      dupRows.push(rowNum);
    } else {
      if (emailKey) seenEmails.set(emailKey, rowNum);
      if (idKey)    seenIds.set(idKey, rowNum);
    }
  });

  if (!dupRows.length) { Logger.log('No duplicate rows found.'); return; }

  /* Delete bottom‑to‑top to retain indices */
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  dupRows.sort((a, b) => b - a).forEach(rn => sh.deleteRow(rn));

  SheetsIO.flushCache();
  Logger.log(`🗑️ Deleted ${dupRows.length} duplicate row(s).`);
}
/**
 * mergeRowsByArtist()  —  SAFE VERSION
 * ---------------------------------------------------------------
 * • Merges rows that share identical *Artist + Location* (case‑insensitive)
 * • Chooses the row with the FEWEST blank cells as the keeper
 * • Combines e‑mail sets (canonicalised) into that keeper row
 * • Never touches the header row — all sheet indices are ≥ 2
 * • Deletes redundant rows bottom‑to‑top
 *
 * Usage:  Run from the IDE or schedule as a trigger.
 */
function mergeRowsByArtist() {
  const { head, rows } = SheetsIO.getGrid();
  if (!rows.length) { Logger.log('CRM empty.'); return; }

  const idx = h => head.indexOf(h);
  const iName = idx('name');
  const iLoc    = idx('location');
  const iEmail = idx('emails') !== -1 ? idx('emails') : idx('email');

  if (iName === -1 || iEmail === -1) {
    Logger.log('Artist or emails column missing – aborting merge.');
    return;
  }

  const keyOf = r =>
    (String(r[iName]).trim().toLowerCase() || '¬') + '|' +
    (String(r[iLoc]).trim().toLowerCase()    || '¬');

  const keepMap   = new Map();   // key → { row:Array, sheetRow:Number }
  const deleteList= [];

  rows.forEach((row, idxData) => {
    const sheetRow = idxData + 2;                    // data rows start at 2
    const key = keyOf(row);

    if (!keepMap.has(key)) {
      keepMap.set(key, { row: row.slice(), sheetRow });
      return;
    }

    /* duplicate found */
    const keeper    = keepMap.get(key);
    const blanksCur = row.filter(c => !c).length;
    const blanksKeep= keeper.row.filter(c => !c).length;
    const target    = blanksCur < blanksKeep ? row : keeper.row;

    /* merge e‑mails */
    const set = new Set(
      String(keeper.row[iEmail]).split(/\s*,\s*/).concat(
      String(row[iEmail]).split(/\s*,\s*/))
      .filter(Boolean).map(canonicalEmail)
    );
    target[iEmail] = [...set].join(',');

    keepMap.set(key, { row: target, sheetRow: blanksCur < blanksKeep ? sheetRow
                                                                     : keeper.sheetRow });
    deleteList.push(sheetRow);
  });

  if (!deleteList.length) { Logger.log('No name/location duplicates found.'); return; }

  const sh = SpreadsheetApp.openById(CONFIG.SHEET_ID)
                           .getSheetByName(CONFIG.CRM_SHEET_NAME);

  keepMap.forEach(o =>
    sh.getRange(o.sheetRow, 1, 1, head.length).setValues([o.row])
  );

  deleteList.sort((a,b)=>b-a).forEach(rn => sh.deleteRow(rn));

  SheetsIO.flushCache();
  Logger.log(`mergeRowsByArtist – merged & removed ${deleteList.length} row(s).`);
}


function removeEmptyRows() {
  const { head, rows } = SheetsIO.getGrid();
  const idx = h => head.indexOf(h);
  const iEmail = idx('emails') !== -1 ? idx('emails') : idx('email');
  const iTid   = idx('thread_id');
  const iArt   = idx('name');
  if (iEmail === -1 || iTid === -1) return;

  const del = [];
  rows.forEach((r, i) => {
    const empty = !String(r[iEmail]).trim() &&
                  !String(r[iTid]).trim()   &&
                  !String(r[iArt]).trim();
    if (empty) del.push(i + 2);
  });

  if (!del.length) { Logger.log('No empty rows to delete.'); return; }

  const sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.CRM_SHEET_NAME);
  del.sort((a,b)=>b-a).forEach(rn => sh.deleteRow(rn));
  SheetsIO.flushCache();
  Logger.log(`removeEmptyRows – deleted ${del.length} row(s).`);
}
/**
 * mergeRowsByThread_v2()
 * – merges duplicate rows that share the same thread_id without
 *   loading the entire sheet into memory.
 * – never touches more than a few columns at once, so it works even
 *   on very large CRM sheets (> 50 k rows).
 */
function mergeRowsByThread_v2() {
  const sh   = SpreadsheetApp.openById(CONFIG.SHEET_ID)
                             .getSheetByName(CONFIG.CRM_SHEET_NAME);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  /* --- column indexes we MUST have --- */
  const idx = n => head.indexOf(n);
  const iTid   = idx('thread_id');
  const iEmail = idx('emails') !== -1 ? idx('emails') : idx('email');
  if (iTid === -1) { Logger.log('No thread_id column – aborting.'); return; }

  /* --- fetch just thread_id + emails for the whole sheet --- */
  const nRows   = sh.getLastRow() - 1;                 // exclude header
  const tidCol  = sh.getRange(2, iTid + 1, nRows).getValues().flat();
  const emailCol= iEmail !== -1
                ? sh.getRange(2, iEmail + 1, nRows).getValues().flat()
                : Array(nRows).fill('');

  /* --- pass 1: detect duplicates --- */
  const firstRowOfTid = new Map();      // tid →  sheet row#
  const dupRows       = [];             // rows we will delete
  const mergeMap      = new Map();      // keeperRow# → Set<emails>

  tidCol.forEach((tid, idx) => {
    tid = String(tid).trim();
    if (!tid) return;                   // skip blank tid

    const rowNum = idx + 2;             // 1‑based
    if (!firstRowOfTid.has(tid)) {
      firstRowOfTid.set(tid, rowNum);
      mergeMap.set(rowNum, new Set(
        String(emailCol[idx]).split(/\s*,\s*/).filter(Boolean).map(canonicalEmail)
      ));
    } else {
      // duplicate – merge e‑mails into keeper
      const keeper = firstRowOfTid.get(tid);
      const set    = mergeMap.get(keeper);
      String(emailCol[idx]).split(/\s*,\s*/).forEach(e => {
        if (e) set.add(canonicalEmail(e));
      });
      dupRows.push(rowNum);
    }
  });

  if (!dupRows.length) { Logger.log('No thread_id duplicates found.'); return; }

  /* --- batch‑write merged e‑mail sets --- */
  if (iEmail !== -1) {
    const upd = [];
    const rows = [];
    mergeMap.forEach((set, rowNum) => {
      upd.push([ [...set].join(',') ]);
      rows.push(rowNum);
    });
    rows.forEach((r, i) =>
      sh.getRange(r, iEmail + 1).setValue(upd[i][0])
    );
  }

  /* --- delete duplicate rows (bottom‑to‑top) --- */
  dupRows.sort((a,b)=>b-a).forEach(r => sh.deleteRow(r));

  SheetsIO.flushCache();
  Logger.log(`mergeRowsByThread – merged & removed ${dupRows.length} row(s).`);
}
/**
 * oneOff_relabelAllThreads()
 * Walks every CRM row and refreshes its Gmail label so
 * everything is consistent after changing stage names.
 */
function oneOff_relabelAllThreads() {
  const { head, rows } = SheetsIO.getGrid();
  const idxTid   = head.indexOf('thread_id');
  const idxStage = head.indexOf('pipeline_stage');

  rows.forEach(r => {
    try {
      const tid   = r[idxTid];
      const stage = r[idxStage];
      applyPipelineLabel(tid, stage);
    } catch (e) {
      console.warn(`Label sync failed for row with threadId ${r[idxTid]}: ${e}`);
    }
  });
  Logger.log(`✔︎ Relabelled ${rows.length} thread(s).`);
}
/**
 * purgeUnusedPipelineLabels()
 * ───────────────────────────
 * Deletes any Gmail label that starts with “Leads/” or “Clients/”
 * but is **not** present in CONFIG.LEAD_STAGES or CONFIG.CLIENT_STAGES.
 * Threads keep their correct labels; only the unused label names vanish
 * from your Gmail sidebar.
 */
function purgeUnusedPipelineLabels() {
  // Build the canonical whitelist
  const allowed = new Set(
    CONFIG.LEAD_STAGES.map(s => `Leads/${s}`)
      .concat(CONFIG.CLIENT_STAGES.map(s => `Clients/${s}`))
  );

  // Scan every user‑created label
  GmailApp.getUserLabels().forEach(lbl => {
    const name = lbl.getName();

    const isPipeline =
      name.startsWith('Leads/')   ||
      name.startsWith('Clients/');

    if (isPipeline && !allowed.has(name)) {
      Logger.log(`Deleting unused label: ${name}`);
      lbl.deleteLabel();
    }
  });

  Logger.log('purgeUnusedPipelineLabels ✔︎ finished');
}

