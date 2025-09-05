/**
 * 01_sheetsIO.gs — centralised Spreadsheet I/O layer
 * (memoised sheet handle, header self‑healing, race‑safe writes)
 *
 * Exports: SheetsIO (singleton)
 *
 * Depends on global CONFIG, canonicalEmail, rowToObj, upsertContact
 */
'use strict';
/* ── GLOBAL GUARDS ──────────────────────────────────────────── */
var CS = (typeof CS !== 'undefined') ? CS : CardService; // CardService alias

if (typeof globalThis.__OWTI_TZ__ === 'undefined') {
  globalThis.__OWTI_TZ__ = 'Australia/Melbourne';
}
var TZ = globalThis.__OWTI_TZ__;

if (typeof globalThis.isoMid === 'undefined') {
  globalThis.isoMid = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  };
}
var isoMid = globalThis.isoMid;
/* ───────────────────────────────────────────────────────────── */

const SheetsIO = (() => {
  const { SHEET_ID, CRM_SHEET_NAME } = CONFIG;

  // Memoised sheet handle
  const getSheet = (() => {
    let sheet;
    return () => {
      if (sheet) return sheet;
      sheet = SpreadsheetApp.openById(SHEET_ID)
                            .getSheetByName(CRM_SHEET_NAME);
      if (!sheet) {
        throw new Error(`SheetsIO ✗  Sheet "${CRM_SHEET_NAME}" not found`);
      }
      return sheet;
    };
  })();

  let headerCache = null;

  function ensureHeaders() {
  if (headerCache) return headerCache;
  const sh  = getSheet();
  const cur = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idx = cur.reduce((m,c,i)=>((m[String(c).toLowerCase()]=i),m),{});
  headerCache = { head: cur, idx };
  return headerCache;
}

    headerCache = head;
    return head;
  }

  // Simplified getGrid: always fetch fresh sheet data
  function getGrid() {
  const sh = getSheet();
  const data = sh.getDataRange().getValues();
  const head = data[0];
  const rows = data.slice(1);
  return { head, rows };
}


  function getClientData(threadId = '', emailCsv = '') {
  const { head, rows } = getGrid();
  const iId = head.indexOf('thread_id');
  const iEmPlural = head.indexOf('emails');
  const iEmSingle = head.indexOf('email');
  const iEm = iEmPlural !== -1 ? iEmPlural : iEmSingle;
  if (iId === -1 && iEm === -1) return null;
  const targets = String(emailCsv || '').split(/[,;|\s\/]+/).map(e=>e.toLowerCase()).filter(Boolean);
  for (let r = 0; r < rows.length; r++) {
    const idMatch = (iId !== -1) && (String(rows[r][iId]).trim() === threadId);
    const emV = iEm !== -1 ? String(rows[r][iEm]).toLowerCase() : '';
    const emSet = new Set(emV.split(/[,;|\s\/]+/).filter(Boolean));
    const emMatch = targets.some(t => emSet.has(t));
    if ((threadId && idMatch) || (targets.length && emMatch)) {
      return { rec: rowToObj(head, rows[r]), rowIndex: r + 2 };
    }
  }
  return null;
}

      }
    }
    // fallback match by thread_id
    if (threadId && iId !== -1) {
      for (let r = 0; r < rows.length; r++) {
        if (rows[r][iId] === threadId) {
          return { rec: rowToObj(head, rows[r]), rowIndex: r + 2 };
        }
      }
    }
    return null;

    function _backfillTid(rowIdx0, idxTid, tid) {
      if (!tid || idxTid === -1) return;
      const sh = getSheet();
      if (!rows[rowIdx0][idxTid]) {
        sh.getRange(rowIdx0 + 2, idxTid + 1).setValue(tid);
        rows[rowIdx0][idxTid] = tid;
        headerCache = null; // clear so ensureHeaders can re-run if needed
      }
    }
  }

  function saveClientRecord(rec, explicitRowIdx = null) {
    const lock = LockService.getScriptLock();
    lock.tryLock(15000);
    try {
      const sh   = getSheet();
      const head = ensureHeaders();
      if (explicitRowIdx) {
        const vals = head.map(h => rec[h] ?? '');
        sh.getRange(explicitRowIdx, 1, 1, head.length).setValues([vals]);
      }
      upsertContact(rec, sh);
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({
    getGrid,
    getClientData,
    saveClientRecord
  });
})();
