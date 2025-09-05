/**
 * 15c_aiPrompt.gs — prompt builder / summariser
 * (idempotent; safe to hot‑reload)
 *
 * 2025‑07‑21 fix → ai_openai → ai_callOpenAI (with fallback)
 */
;(() => {
  'use strict';
  if (globalThis.__OWTI_AI_PROMPT_LOADED__) return;
  globalThis.__OWTI_AI_PROMPT_LOADED__ = true;

  // ── helpers & constants ─────────────────────────────────────────
  const ai_sanitize = globalThis.ai_sanitize;

  // robust handle for the OpenAI caller (new + old names)
  const callOpenAI =
        globalThis.ai_callOpenAI
     || globalThis.ai_openai    // legacy
     || globalThis.callOpenAI;  // very old
  if (typeof callOpenAI !== 'function')
    throw new Error('ai_callOpenAI helper not loaded — check 15b_aiUtils.gs');

  const {
    MODEL_SUMMARY   = 'gpt-4o-mini',
    SUMMARY_WORDS   = 120,
    SNIPPET_CHARS   = 500,
    MY_ALIASES      = [],
    EMAIL_RE        = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    TZ              = globalThis.__OWTI_TZ__ || 'Australia/Melbourne'
  } = globalThis.AI_CONST || {};

  // ── tone samples ────────────────────────────────────────────────
  const STYLE_EXAMPLES = `
Hey Grace
How are ya? Hope your time away was well spent :)

Just wanted to see if you would like to jump on a call and chat through some music plans soon. Excited to work on something together.

Let me know if you have a spare moment over the next few days and we can tee something up.

Cheers
Hugh

—

Hey team
Thanks for getting back to me :)

Sounds like you have a good thing going on. If any Melbourne shows pop up it would be great to meet and talk recording or mixing plans. Hope the recent gigs have been smashing.

Chat soon
Hugh

—

Hey Chris
Appreciate you getting back to me :)

That is very kind of you. Let me know if you stumble upon any artists looking for production. Would love to help.

Thanks again
Hugh

—

Hey Grace
So nice chatting yesterday and cheers for sending the demos. I am a huge fan of the Harvest Moon vibe. Would love to lean into that feel especially from the rhythm section.

I will have a listen over the weekend and get back to you with thoughts.

Talk soon
Hugh

—

Hey Toah
Hope you are having a great week. Apologies for the slight delay. Been a busy couple of days.

As we discussed I would love to help with mixing and mastering the next releases. Rates are four hundred fifty per mix and master and that includes up to three revisions.

Let me know if you would like to give a song a go and we will go from there :)

Have an amazing weekend.

Cheers
Hugh
`.trim();

  // ── meta & transcript (now uses **every** message) ───────────────
  function ai_buildMetaAndTranscript(thread) {
    const msgs = thread.getMessages();
    const last = msgs[msgs.length - 1];

    const meta = {
      lastFromMe: MY_ALIASES.some(a =>
        last.getFrom().toLowerCase().includes(a)
      ),
      daysSinceLast: Math.round(
        (Date.now() - last.getDate().getTime()) / 864e5
      ),
      lastHughTxt: '',
      lastLeadTxt: ''
    };

    const safe = m => {
      try { return m.getPlainBody().slice(0, SNIPPET_CHARS); }
      catch { return ''; }
    };

    for (let i = msgs.length - 1; i >= 0; i--) {
      const mine = MY_ALIASES.some(a =>
        msgs[i].getFrom().toLowerCase().includes(a)
      );
      if (mine && !meta.lastHughTxt) meta.lastHughTxt = safe(msgs[i]);
      if (!mine && !meta.lastLeadTxt) meta.lastLeadTxt = safe(msgs[i]);
      if (meta.lastHughTxt && meta.lastLeadTxt) break;
    }

    // **INCLUDE ALL MESSAGES**, in chronological order
    const transcript = msgs
      .map(m => {
        const ts = Utilities.formatDate(m.getDate(), TZ, 'yyyy-MM-dd HH:mm');
        return `${ts}\n${safe(m)}`;
      })
      .join('\n---\n');

    return { meta, transcript };
  }

  // ── main prompt builder ─────────────────────────────────────────
  function ai_buildPrompt(lead, summary, transcript, meta) {
    return [
      {
        role: 'system',
        content: `
You are Hugh, producer at Out With The In studio in Northcote Melbourne.

Match the friendly tone in the examples below. Avoid hyphens or long dashes.
End with "Cheers" and your first name only.

${STYLE_EXAMPLES}

Return the reply using the draft_follow_up function only.
        `.trim()
      },
      {
        role: 'user',
        content: `
Thread summary (≈${SUMMARY_WORDS} words):
${summary}

Full thread messages:
${transcript}

Meta JSON:
${JSON.stringify(meta)}

Lead JSON:
${JSON.stringify(lead)}

Task: respond via draft_follow_up.
        `.trim()
      }
    ];
  }

  // ── optional summariser ─────────────────────────────────────────
  function ai_summariseThread(thread) {
    const messages = [
      {
        role: 'system',
        content: `Summarise this thread in no more than ${SUMMARY_WORDS} words.`
      },
      {
        role: 'user',
        content: thread
          .getMessages()
          .map(m => m.getPlainBody().slice(0, 1200))
          .join('\n---\n')
      }
    ];

    const OPENAI_KEY = PropertiesService.getScriptProperties()
      .getProperty('OPENAI_API_KEY');

    return callOpenAI(
      { model: MODEL_SUMMARY, messages },
      OPENAI_KEY
    ).choices[0].message.content.trim();
  }

  // ── exports ─────────────────────────────────────────────────────
  Object.assign(globalThis, {
    ai_buildMetaAndTranscript,
    ai_buildPrompt,
    ai_summariseThread
  });
})();
