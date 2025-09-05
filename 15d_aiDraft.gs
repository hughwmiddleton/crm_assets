/**
 * 15d_aiDraft.gs — generate / replace AI follow‑up drafts
 * v2025‑07‑19 • signature‑free • label‑aware • idempotent
 */
;(() => {
  'use strict';
  if (globalThis.__OWTI_AI_DRAFT_LOADED__) return;
  globalThis.__OWTI_AI_DRAFT_LOADED__ = true;

  /* ───── dependencies (throws if missing) ───── */
  const _prompt   = globalThis.ai_buildPrompt;
  const _meta     = globalThis.ai_buildMetaAndTranscript;
  const _callOpen = globalThis.ai_callOpenAI;
  const _sanitize = globalThis.ai_sanitize;
  const _getLbl   = globalThis.ai_getLabel;

  if (![_prompt, _meta, _callOpen, _sanitize, _getLbl].every(f => typeof f === 'function')) {
    throw new Error('15d_aiDraft.gs ‑ required helpers (ai_* utilities) not loaded.');
  }

  /* ───── constants ───── */
  const C = globalThis.AI_CONST || {};
  const {
    MODEL_DRAFT  = 'gpt-4o',
    TEMP_BASE    = 0.8,
    MAX_TOKEN_IN = 3000,
    EMAIL_RE     = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    MY_ALIASES   = [],
    LABEL_NAME   = 'AI_DRAFT—Needs approval'
  } = C;

  /* ════════════════════════════════════════════════════════════════════════
   * 1. Helper functions
   * ═════════════════════════════════════════════════════════════════════ */

  /** Strip everything **after** the first signature‑like line */
  function stripSig(txt = '') {
    const stopRx = /(cheers[,!.\s]*$|regards[,!.\s]*$|hugh *middleton|0416 *443 *009|outwiththein\.com)/i;
    const lines  = String(txt).split(/\r?\n/);
    const cut    = lines.findIndex(l => stopRx.test(l.trim()));
    return (cut === -1 ? lines : lines.slice(0, cut + 1)).join('\n').trim();
  }

  /** Canonical, unique, non‑self recipient list */
  function cleanRecipients(rec, thread) {
    let csv = String(rec.emails || '').trim();

    if (!csv) {                                   // scrape thread if blank
      const pool = new Set();
      thread.getMessages().forEach(m => {
        ([m.getFrom(), m.getTo(), m.getCc(), m.getBcc()].join(',') || '')
          .match(EMAIL_RE)?.forEach(a => {
            a = a.toLowerCase();
            if (!MY_ALIASES.includes(a)) pool.add(a);
          });
      });
      csv = [...pool].join(', ');
    }

    return csv.split(/\s*,\s*/)
              .map(a => a.replace(/.*<([^>]+)>.*/, '$1').toLowerCase())
              .filter(a => EMAIL_RE.test(a) && !MY_ALIASES.includes(a))
              .filter((a, i, arr) => arr.indexOf(a) === i);
  }

  /** Delete all AI drafts + pipeline label from a thread */
  function purgeThread(tid) {
    try {
      GmailAdvanced.Users.Drafts.list('me', { maxResults: 100 }).drafts?.forEach(d => {
        if (d.message?.threadId === tid) {
          try { GmailAdvanced.Users.Drafts.remove('me', d.id); } catch {}
        }
      });
      const lbl = GmailApp.getUserLabelByName(LABEL_NAME);
      if (lbl) lbl.removeFromThread(GmailApp.getThreadById(tid));
    } catch (_) {/* ignore */}
  }
  // Export so UI modules can call it
  globalThis.ai_deleteExistingDrafts = purgeThread;
  globalThis.deleteExistingDrafts    = purgeThread;   // legacy alias

  /* ════════════════════════════════════════════════════════════════════════
   * 2. GPT draft generator
   * ═════════════════════════════════════════════════════════════════════ */

  /** Internal: request a draft from GPT (signature‑free) */
  function gptDraft(lead, summary, transcript, meta, extraMsg) {
    const messages = [
      { role:'system', content:'Rule 0: absolutely do **NOT** include any signature, name, phone or website.' },
      ..._prompt(lead, summary, transcript, meta)
    ];
    if (extraMsg) messages.push(extraMsg);

    const resp = _callOpen({
      model        : MODEL_DRAFT,
      temperature  : transcript.length > 3000 ? 0.5 : TEMP_BASE,
      max_tokens   : MAX_TOKEN_IN,
      messages,
      tools : [{
        type:'function',
        function:{
          name:'draft_follow_up',
          description:'Return a ≤ 250‑word e‑mail object.',
          parameters:{
            type:'object',
            properties:{
              subject       :{type:'string'},
              plainTextBody :{type:'string'},
              htmlBody      :{type:'string'}
            },
            required:['subject','plainTextBody','htmlBody']
          }
        }
      }],
      tool_choice  : { type:'function', function:{ name:'draft_follow_up' } }
    });

    const fn = resp.choices?.[0]?.message?.tool_calls?.[0]?.function;
    const d  = fn ? JSON.parse(fn.arguments) : { subject:'', plainTextBody:'', htmlBody:'' };

    return {
      subject      : _sanitize(d.subject),
      plainTextBody: stripSig(_sanitize(d.plainTextBody)),
      htmlBody     : stripSig(_sanitize(d.htmlBody))
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3. Write draft inside the thread (no footer)
   * ═════════════════════════════════════════════════════════════════════ */

  function writeDraft(thread, rec, draft) {
    purgeThread(thread.getId());                              // remove old AI drafts

    const toList = cleanRecipients(rec, thread);
    if (!toList.length) return;

    let subj = draft.subject || thread.getFirstMessageSubject() || '';
    if (!/^ *re:/i.test(subj)) subj = 'Re: ' + subj;

    const html = (draft.htmlBody || draft.plainTextBody)
      .split(/\n{2,}/)
      .map(p => `<p style="margin:0 0 1em 0">${p.replace(/\n+/g,' ').trim()}</p>`)
      .join('');

    thread.createDraftReply(
      draft.plainTextBody || '(blank)',
      { to: toList.join(', '), subject: subj, htmlBody: html || undefined }
    );

    _getLbl(LABEL_NAME).addToThread(thread);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4. Public API — createAiDraftForThread(thread)
   * ═════════════════════════════════════════════════════════════════════ */

  function createAiDraftForThread(thread) {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID)
                                .getSheetByName(CONFIG.CRM_SHEET_NAME);
    const head  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const ixSum = head.indexOf('thread_summary');

    const row  = sheet.createTextFinder(thread.getId()).findNext();
    const lead = row
      ? head.reduce((o, k, i) => (o[k] = row.offset(0, i).getValue(), o), {})
      : { thread_id: thread.getId() };

    let summary = row ? row.offset(0, ixSum).getValue() : '';
    if (!summary && typeof globalThis.ai_summariseThread === 'function') {
      summary = globalThis.ai_summariseThread(thread);
      if (row) row.offset(0, ixSum).setValue(summary);
    }

    const { meta, transcript } = _meta(thread);

    let draft = gptDraft(lead, summary, transcript, meta);
    if (/^\s*(hey|hi|hello)\s+hugh\b/i.test(draft.plainTextBody)) {
      draft = gptDraft(
        lead, summary, transcript, meta,
        { role:'system', content:'Extra rule: do **NOT** greet Hugh by name.' }
      );
    }

    writeDraft(thread, lead, draft);
  }

  /* Export */
  Object.assign(globalThis, { createAiDraftForThread });
})();
