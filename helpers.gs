/**
 * 00_helpers_complete.gs — shared utility library
 * (idempotent; won’t redeclare if already loaded)
 *
 * Exports:
 *   parseSender, messageIsExternal, toTitleCase, extractPhone,
 *   cleanIsoDate, cleanFollowUpValue, rowToObj, makeFollowUpCountDropdown,
 *   canonicalEmail, syncPipelineLabel, getCrmSheet,
 *   upsertContact, addOrMergeLead, dedupeByEmail
 */
/* ── GLOBAL GUARDS ──────────────────────────────────────────── */
var CS = (typeof CS !== 'undefined') ? CS : CardService;   // CardService alias
var cs = (typeof cs !== 'undefined') ? cs : CS;            // ★ legacy alias


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

(() => {
  if (globalThis.__OWTI_HELPERS_LOADED__) return;
  globalThis.__OWTI_HELPERS_LOADED__ = true;

  /* ──────────────────────────────
   *  Constants & shorthand
   * ────────────────────────────── */
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

  /* ──────────────────────────────
   *  Sender / external helpers
   * ────────────────────────────── */
  globalThis.parseSender = function parseSender(from = '') {
    const email   = (from.match(EMAIL_RE) || [''])[0];
    const display = from.replace(/<.*?>/, '').trim();
    return { email: email.toLowerCase(), name: display.toLowerCase(), display };
  };

  globalThis.messageIsExternal = function messageIsExternal(msg) {
    const s = parseSender(msg.getFrom());
    if (!CONFIG.SELF_EMAILS.includes(s.email) &&
        !CONFIG.SELF_NAMES.includes(s.name)) return true;

    const allRecipients = [msg.getTo(), msg.getCc(), msg.getBcc()].join(',');
    return (allRecipients.match(EMAIL_RE) || [])
      .some(a => !CONFIG.SELF_EMAILS.includes(a.toLowerCase()));
  };

  /* ──────────────────────────────
   *  String helpers
   * ────────────────────────────── */
  globalThis.toTitleCase = str =>
    String(str).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  globalThis.extractPhone = function extractPhone(text = '') {
    const digits = s => String(s || '').replace(/\D+/g, '');
    const selfE164 = digits(CONFIG.SELF_MOBILE);

    const m = digits(text).match(/0\d{9}/); // AU local
    if (!m) return '';

    const candE164 = m[0].replace(/^0/, '61');
    if (candE164 === selfE164) return '';

    return m[0].replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
  };

  /* ──────────────────────────────
   *  Date helpers
   * ────────────────────────────── */
  globalThis.cleanIsoDate = function cleanIsoDate(v) {
    if (!v) return '';

    if (v instanceof Date)
      return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');

    if (typeof v === 'number') return cleanIsoDate(new Date(v));

    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const m = v.match(/^(\d{4}-\d{2}-\d{2})T/);
      if (m) return m[1];
      const d = new Date(v);
      return isNaN(d) ? '' : cleanIsoDate(d);
    }
    return '';
  };
  globalThis.cleanFollowUpValue = globalThis.cleanIsoDate;

  /* ──────────────────────────────
   *  Misc helpers
   * ────────────────────────────── */
  globalThis.rowToObj = (head, row) =>
    head.reduce((o, k, i) => ((o[k] = row[i] || ''), o), {});

  globalThis.makeFollowUpCountDropdown = function makeFollowUpCountDropdown(selected) {
    if (!cs) throw new Error('CardService not available.');
    const dd = cs.newSelectionInput()
      .setType(cs.SelectionInputType.DROPDOWN)
      .setTitle('Follow-up #')
      .setFieldName('follow_up_count');

    for (let i = 1; i <= CONFIG.MAX_FOLLOW_UPS; i++) {
      dd.addItem(`Follow-up #${i}`, String(i), String(i) === String(selected));
    }
    return dd;
  };

  globalThis.canonicalEmail = function canonicalEmail(addr) {
    if (!addr) return '';
    addr = addr.toLowerCase();
    const parts = addr.split('@');
    if (parts.length !== 2) return addr;
    if (['gmail.com', 'googlemail.com'].includes(parts[1])) {
      parts[0] = parts[0].replace(/\./g, '').replace(/\+.*/, '');
    }
    return parts.join('@');
  };

  /* ─── label cache to minimise Gmail calls ───────────────── */
  const getLabel = (() => {
    const cache = Object.create(null);
    return name => {
      if (cache[name]) return cache[name];
      const lbl = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
      cache[name] = lbl;
      return lbl;
    };
  })();

  globalThis.syncPipelineLabel = function syncPipelineLabel(thread, newStage) {
    if (!thread || !newStage) return;

    const isClient  = (newStage.toLowerCase() === 'won');
    const parent    = isClient ? 'Clients' : 'Leads';
    const fullLabel = `${parent}/${newStage}`;

    /* remove any previous pipeline labels in a single pass */
    CONFIG.PIPELINE_STAGES.forEach(stage => {
      getLabel(`Leads/${stage}`).removeFromThread(thread);
      getLabel(`Clients/${stage}`).removeFromThread(thread);
    });

    getLabel(fullLabel).addToThread(thread);
  };

  /* ──────────────────────────────
   *  CRM sheet helpers
   * ────────────────────────────── */
  const getCrmSheet = (() => {
    let sheet;
    return () => {
      if (sheet) return sheet;
      sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID)
                            .getSheetByName(CONFIG.CRM_SHEET_NAME);
      if (!sheet)
        throw new Error(`CRM sheet "${CONFIG.CRM_SHEET_NAME}" not found.`);
      return sheet;
    };
  })();
  globalThis.getCrmSheet = getCrmSheet;

  /** Core insert / merge */
  globalThis.upsertContact = function upsertContact(contact, sh = getCrmSheet()) {
    const rawEmail = contact.email || contact.emails || '';
    if (!rawEmail && !contact.thread_id)
      throw new Error('upsertContact: record has no email and no thread_id');

    const target = canonicalEmail(String(rawEmail).split(/[,;|\s\/]+/)[0] || '');

    /* header & index map (cached per function-call) */
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const hIdx = header.reduce((m, c, i) => ((m[c.toLowerCase()] = i), m), {});

    if (hIdx.emails === undefined && hIdx.email === undefined)
      throw new Error('CRM sheet must contain an "email" or "emails" column');

    /* ensure "emails" column exists */
    /* prefer existing 'emails' or fallback to 'email' without changing schema */
if (hIdx.emails === undefined && hIdx.email === undefined)
  throw new Error('CRM sheet must contain an "email" or "emails" column');


    const emailCol = (hIdx.emails !== undefined) ? hIdx.emails : hIdx.email;
    const idxTid   = hIdx.thread_id ?? null;

    /* fetch once, work in-memory */
    const data   = sh.getDataRange().getValues();
    const nRows  = data.length - 1;

    let rowNum = -1;
    for (let i = 1; i <= nRows; i++) {
      const rowEmails = String(data[i][emailCol]).split(/[,;|\s\/]+/).map(canonicalEmail);
      const rowTid    = idxTid !== null ? String(data[i][idxTid]).trim() : '';
      if ((target && rowEmails.includes(target)) ||
          (!rowEmails[0] && rowTid && rowTid === contact.thread_id)) {
        rowNum = i + 1; // sheet rows are 1-based
        break;
      }
    }

    var _emailsForSheet = (contact.emails || contact.email || '')
                       .split(/[,;|\s\/]+/)
                       .filter(Boolean)
                       .join(',');
if (hIdx.emails !== undefined) {
  contact.emails = _emailsForSheet;
} else {
  contact.email = _emailsForSheet.split(',')[0] || '';
}

    const rowVals = header.map(col => contact[col] ?? '');

    if (rowNum === -1) {
      sh.appendRow(rowVals);                       // new
    } else {
      const existing = data[rowNum - 1];
      const merged   = existing.map((v, i) => rowVals[i] || v || '');

      /* merge & dedupe */
      const set = new Set(
        String(merged[emailCol]).split(/[,;|\s\/]+/).filter(Boolean).map(canonicalEmail)
      );
      if (target) set.add(target);
      merged[emailCol] = [...set].join(',');

      sh.getRange(rowNum, 1, 1, header.length).setValues([merged]);
    }
  };

  globalThis.addOrMergeLead = leadObj => upsertContact(leadObj);

  /* ──────────────────────────────
   *  One-time deduplication sweep
   * ────────────────────────────── */
  globalThis.dedupeByEmail = function dedupeByEmail() {
    const sh     = getCrmSheet();
    const data   = sh.getDataRange().getValues();
    const header = data[0];

    const idxEm  = header.indexOf('emails') !== -1 ? header.indexOf('emails')
                   : header.indexOf('email');
    const idxTid = header.indexOf('thread_id');
    if (idxEm === -1) { Logger.log('No email column found.'); return; }

    const keep = Object.create(null);
    const del  = [];

    for (let i = 1; i < data.length; i++) {
      const row     = data[i];
      const rowNum  = i + 1;
      const emails  = String(row[idxEm]).split(/[,;|\s\/]+/).filter(Boolean).map(canonicalEmail);
      const key     = emails[0] || '';

      if (!key) {
        if (idxTid !== -1) {
          const tid = String(row[idxTid]).trim();
          if (tid && data.some((o, j) => j !== i && String(o[idxTid]).trim() === tid))
            del.push(rowNum);
        }
        continue;
      }

      if (!keep[key]) {
        keep[key] = { rowNum, data: row.slice() };
      } else {
        header.forEach((c, ci) => {
          if (!keep[key].data[ci] && row[ci]) keep[key].data[ci] = row[ci];
        });
        del.push(rowNum);
      }
    }

    Object.values(keep).forEach(o =>
      sh.getRange(o.rowNum, 1, 1, header.length).setValues([o.data])
    );
    del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));

    Logger.log(`dedupeByEmail → removed ${del.length} duplicate row(s).`);
  };
})();
