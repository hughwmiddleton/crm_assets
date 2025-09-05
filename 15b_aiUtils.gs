/**
 * 15b_aiUtils.gs — shared GPT utility helpers
 * --------------------------------------------------------
 * Exports (globals):
 *   ai_sanitize, ai_withRetry, ai_callOpenAI, ai_getLabel
 *   callOpenAI  (legacy alias)
 *
 * • Idempotent — safe to hot‑reload.
 * • Never re‑defines constants if another file already set them.
 */
;(() => {
  'use strict';
  if (globalThis.__OWTI_AI_UTILS_LOADED__) return;
  globalThis.__OWTI_AI_UTILS_LOADED__ = true;

  /* ── 1.  Guarantee core constants once (NOT read‑only) ───────── */
  const DEFAULT_CONSTS = [
    ['MODEL_DRAFT',   'gpt-4o'     ],
    ['MODEL_SUMMARY', 'gpt-4o-mini'],
    ['TEMP_BASE',     0.8          ],
    ['MAX_TOKEN_IN',  3000         ]
  ];
  DEFAULT_CONSTS.forEach(([k, v]) => {
    if (globalThis[k] === undefined) globalThis[k] = v;
  });

  /* ── 2.  Text cleaner ─────────────────────────────────────────── */
  function ai_sanitize(txt = '') {
    return String(txt)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[^\x00-\x7F]/g, '')     // strip non‑ASCII (emoji etc.)
      .replace(/\s+,/g, ',')
      .trim();
  }

  /* ── 3.  Retry wrapper ────────────────────────────────────────── */
  function ai_withRetry(fn, max = 4, delay = 500) {
    let lastErr;
    for (let i = 0; i < max; i++) {
      try { return fn(); }
      catch (e) { lastErr = e; }
      if (i < max - 1) Utilities.sleep(delay), delay *= 2;
    }
    throw lastErr;
  }

  /* ── 4.  OpenAI caller ────────────────────────────────────────── */
  const OPENAI_KEY = PropertiesService.getScriptProperties()
                     .getProperty('OPENAI_API_KEY');
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY missing in Script Properties.');

  function ai_callOpenAI(body) {
    return ai_withRetry(() =>
      JSON.parse(
        UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
          method : 'post',
          headers: {
            Authorization : `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json'
          },
          payload: JSON.stringify(body),
          muteHttpExceptions: true
        }).getContentText()
      )
    );
  }

  /* ── 5.  Gmail label helper (returns GmailLabel) ──────────────── */
  const _lblCache = Object.create(null);
  function ai_getLabel(name) {
    if (_lblCache[name]) return _lblCache[name];
    const lbl = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
    _lblCache[name] = lbl;
    return lbl;
  }

  /* ── 6.  Export helpers (+ legacy alias) ─────────────────────── */
  Object.assign(globalThis, {
    ai_sanitize,
    ai_withRetry,
    ai_callOpenAI,
    ai_getLabel,
    callOpenAI: ai_callOpenAI          // legacy alias for older code
  });
})();
