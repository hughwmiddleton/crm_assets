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

/* global CONFIG, SheetsIO, parseSender, messageIsExternal, toTitleCase,
          cleanIsoDate, extractPhone, makeFollowUpCountDropdown,
          syncPipelineLabel, applyPipelineLabel,
          prepareTodaysFollowUps, queueFollowUpBatch,
          handleOpenChat */

/* Safe CardService alias — `var`, not `const` */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

'use strict';

/** Format ISO date → YYYY‑MM‑DD */
const fmtDate = v => cleanIsoDate(v);

/** Handy text‑button builder */
function btn(label, fn, params = {}, style = CS.TextButtonStyle.TEXT) {
  return CS.newTextButton()
    .setText(label)
    .setTextButtonStyle(style)
    .setOnClickAction(
      CS.newAction()
        .setFunctionName(fn)
        .setParameters(params)
    );
}

/** Fallback when no thread selected */
function buildHome() {
  return CS.newCardBuilder()
    .setHeader(CS.newCardHeader().setTitle('OWTI CRM'))
    .addSection(
      CS.newCardSection().addWidget(
        CS.newTextParagraph().setText('Open an e‑mail thread to view client details.')
      )
    )
    .build();
}

/** Main client‑overview card */
function buildOverviewCard(e) {
  if (!e.gmail || !e.gmail.messageId) return buildHome();

  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const msg      = GmailApp.getMessageById(e.gmail.messageId);
  const thread   = msg.getThread();
  const tid      = thread.getId();
  const messages = thread.getMessages().slice(-10);

  /* Collect external addresses */
  const extSet = {};
  messages.forEach(m => {
    ([m.getFrom(), m.getTo(), m.getCc(), m.getBcc()].join(',') || '')
      .match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)
      ?.forEach(a => {
        a = a.toLowerCase();
        if (!CONFIG.SELF_EMAILS.includes(a)) extSet[a] = true;
      });
  });
  const emailCsv = Object.keys(extSet).join(', ');

  /* Load or seed CRM record */
  const found = SheetsIO.getClientData(tid, emailCsv);
  const rec   = found ? { ...found.rec } : { thread_id: tid };

  if (!found) {
    const externals = messages.filter(messageIsExternal);
    const oldest    = (externals[0] || messages[0]).getDate();
    const newest    = (externals.slice().reverse().find(messageIsExternal)
                       || messages[messages.length - 1]).getDate();
    rec.date_added        = fmtDate(oldest);
    rec.last_contact_date = fmtDate(newest);
  }

  /* Ensure ISO strings */
  rec.date_added         = fmtDate(rec.date_added);
  rec.last_contact_date  = fmtDate(rec.last_contact_date);
  rec.next_follow_up_iso = fmtDate(rec.next_follow_up_iso);
  rec.snoozed_until      = fmtDate(rec.snoozed_until);

  /* Lightweight autofill */
  if (!rec.artist) {
    const s = parseSender(msg.getFrom());
    if (!CONFIG.SELF_EMAILS.includes(s.email) &&
        !CONFIG.SELF_NAMES.includes(s.name)) {
      rec.artist = toTitleCase(s.display);
    }
  }
  if (!rec.location) {
    const mLoc = msg.getPlainBody().match(/([A-Z][a-z]+,\s*[A-Z]{2,3})/);
    rec.location = mLoc ? mLoc[1] : '';
  }
  if (!rec.song_title) {
    const subj = thread.getFirstMessageSubject();
    const r1   = subj.match(/new\s+track[:\-]\s*(.+)$/i);
    const r2   = msg.getPlainBody().match(/(?:track|song)[:\-]\s*["\u201c]?(.+?)["\u201d]?/i);
    rec.song_title = r1 ? r1[1] : (r2 ? r2[1] : '');
  }
  if (!rec.url) {
    const urls = msg.getPlainBody().match(/https?:\/\/\S+/g) || [];
    rec.url = urls.find(u => !u.includes(CONFIG.SELF_DOMAIN)) || '';
  }
  if (!rec.email) rec.email = (emailCsv.split(',')[0] || '');
  rec.email = rec.email
    .split(/\s*,\s*/)
    .map(a => a.toLowerCase().trim())
    .filter(a => a && !CONFIG.SELF_EMAILS.includes(a))
    .join(', ');
  if (!rec.contact_number) rec.contact_number = extractPhone(msg.getPlainBody());

  /* Build form section */
  const sec = CS.newCardSection()
    .addWidget(CS.newTextInput().setFieldName('name')         .setTitle('Name')      .setValue(rec.artist        || ''))
    .addWidget(CS.newTextInput().setFieldName('location')       .setTitle('Location')    .setValue(rec.location      || ''))
    .addWidget(CS.newTextInput().setFieldName('sounds_like')    .setTitle('Sounds Like') .setValue(rec.sounds_like   || ''))
    .addWidget(CS.newTextInput().setFieldName('email')         .setTitle('Email')      .setValue(rec.emails        || ''))
    .addWidget(CS.newTextInput().setFieldName('new_note')       .setTitle('Add Note')    .setMultiline(true))
    .addWidget(CS.newDecoratedText().setTopLabel('Date Added')   .setText(rec.date_added        || '–'))
    .addWidget(CS.newDecoratedText().setTopLabel('Last Contact') .setText(rec.last_contact_date || '–'));

  /* Pipeline dropdown */
  const stageDD = CS.newSelectionInput()
    .setType(CS.SelectionInputType.DROPDOWN)
    .setFieldName('pipeline_stage')
    .setTitle('Pipeline Stage')
    .setOnChangeAction(
      CS.newAction()
        .setFunctionName('handleStageChange')
        .setParameters({ threadId: tid })
    );
  CONFIG.PIPELINE_STAGES.forEach(s =>
    stageDD.addItem(s, s, rec.pipeline_stage === s)
  );

  sec
    .addWidget(stageDD)
    .addWidget(CS.newDecoratedText()
      .setTopLabel('Last Follow‑Up #')
      .setText(String(rec.follow_up_count || '–')))
    .addWidget(makeFollowUpCountDropdown(rec.follow_up_count))
    .addWidget(CS.newTextInput()
      .setFieldName('next_follow_up_iso')
      .setTitle('Next Follow‑Up (YYYY‑MM‑DD)')
      .setValue(rec.next_follow_up_iso))
    .addWidget(CS.newTextInput()
      .setFieldName('snoozed_until')
      .setTitle('Snooze Until (YYYY‑MM‑DD)')
      .setValue(rec.snoozed_until))
    .addWidget(btn('Pipeline Summary',     'buildAddOn', { view: 'summary' }))
    .addWidget(btn('Unresponsive',         'buildAddOn', { view: 'unresponsive' }))
    .addWidget(btn('Follow‑Ups Due Today', 'buildAddOn', { view: 'dueToday' }))
    .addWidget(btn('Clear Follow‑Up',      'clearFollowUp',   { threadId: tid }))
    .addWidget(btn('Complete Follow‑Up',   'completeFollowUp',{ threadId: tid }))
    .addWidget(btn('Save Client',          'saveClient', {
        threadId: tid,
        date_added: rec.date_added,
        last_contact_date: rec.last_contact_date
      },
      CS.TextButtonStyle.FILLED))
    .addWidget(
      CS.newTextButton()
        .setText('Open Full CRM')
        .setOpenLink(
          CS.newOpenLink()
            .setUrl(`https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}`)
        )
    );

  /* AI Draft & chat section */
  const draftSec = CS.newCardSection().setHeader('AI Draft')
    .addWidget(btn('Generate AI Draft', 'handleGenerateAiDraft',  { threadId: tid }, CS.TextButtonStyle.FILLED))
    .addWidget(btn('Undo Draft',        'handleUndoAiDraft',       { threadId: tid }))
    .addWidget(btn('Run Today’s Batch', 'uiRunBatch'))
    .addWidget(btn('Chat with GPT',     'handleOpenChat',          { threadId: tid }));

  const notesSec = CS.newCardSection()
    .setHeader('Notes History')
    .setCollapsible(true)
    .addWidget(CS.newTextParagraph().setText(rec.notes || 'No notes yet'));

  return CS.newCardBuilder()
    .setHeader(CS.newCardHeader().setTitle('Client Overview'))
    .addSection(sec)
    .addSection(draftSec)
    .addSection(notesSec)
    .build();
}