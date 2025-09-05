/**
 * 15a_aiConstants.gs — single source of truth
 * (idempotent, safe to load multiple times)
 */
;(() => {
  'use strict';
  if (globalThis.AI_CONST) return;      // already defined

  globalThis.AI_CONST = Object.freeze({
    /* OpenAI models & limits */
    MODEL_DRAFT   : 'gpt-4o',
    MODEL_SUMMARY : 'gpt-4o-mini',
    TEMP_BASE     : 0.8,
    MAX_TOKEN_IN  : 3000,
    CONTEXT_EMAILS: 6,
    SNIPPET_CHARS : 500,
    SUMMARY_WORDS : 120,

    /* Identity & labels */
    MY_ALIASES : ['hugh@outwiththein.com', 'owti@gmail.com'],
    LABEL_NAME : 'AI_DRAFT—Needs approval',

    /* RegEx */
    EMAIL_RE : /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  });
})();
