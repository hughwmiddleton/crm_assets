// ========================= unresponsiveCard.gs =========================
/* global CONFIG, SheetsIO */
'use strict';

/* Safe CardService alias (hoisted var so re‑declaration is harmless) */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

/**
 * “Unresponsive” card – lists records whose follow‑up is due or overdue.
 * Uses the original rule‑set that worked for you before.
 */
function buildUnresponsiveCard() {
  const cs = CS;                                   // legacy lowercase alias
  const g  = SheetsIO.getGrid();                   // { head, rows }

  if (!g.rows.length) {
    return cs.newCardBuilder()
      .setHeader(cs.newCardHeader().setTitle('Unresponsive'))
      .addSection(cs.newCardSection().addWidget(
        cs.newTextParagraph().setText('CRM sheet is empty')
      ))
      .build();
  }

  /* ---- helpers ---- */
  const ix        = n => g.head.indexOf(n);
  const toLocalMid= iso => iso
      ? new Date(`${iso}T00:00:00+10:00`).getTime()   // AU‑east (AEDT/AEST)
      : NaN;

  /* column indexes */
  const iId     = ix('thread_id');
  const iArt    = ix('name');
  const iLoc    = ix('location');
  const iLast   = ix('last_contact_date');
  const iCnt    = ix('follow_up_count');
  const iStage  = ix('pipeline_stage');
  const iNext   = ix('next_follow_up_iso');
  const iSnooze = ix('snoozed_until');

  /* if any required index == -1, return “missing columns” notice */
  if ([iId,iArt,iStage,iCnt,iNext].some(i => i === -1)) {
    return cs.newCardBuilder()
      .setHeader(cs.newCardHeader().setTitle('Unresponsive'))
      .addSection(cs.newCardSection().addWidget(
        cs.newTextParagraph().setText('⚠️ Required columns missing in CRM sheet.')
      ))
      .build();
  }

  const todayMid = (() => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

  const leads   = [];
  const clients = [];

  g.rows.forEach(r => {
    const stage = r[iStage] || '';

    if (CONFIG.FINAL_STAGES.includes(stage)) return;       // skip dead/dormant

    /* snoozed? */
    if (toLocalMid(r[iSnooze]) > todayMid) return;

    /* due or overdue? */
    if (toLocalMid(r[iNext]) > todayMid) return;           // future date → skip
    if (!r[iNext] && !(Number(r[iCnt]) > 0)) return;       // never contacted

    /* build row object */
    const last   = (iLast !== -1) ? toLocalMid(r[iLast]) : 0;
    const since  = last ? Math.round((todayMid - last) / 864e5) : '–';

    const record = {
      threadId: r[iId],
      name    : r[iArt] || '(Unknown)',
      location: r[iLoc] || '',
      since,
      count   : r[iCnt] || '–',
      stage
    };

    (CONFIG.LEAD_STAGES.includes(stage) ? leads : clients).push(record);
  });

  /* order oldest first */
  const bySince = (a, b) =>
    (a.since === '–' ? 1e9 : a.since) -
    (b.since === '–' ? 1e9 : b.since);

  leads.sort(bySince);
  clients.sort(bySince);

  /* ---- card builder ---- */
  const makeSection = (title, list) => {
    const sec = cs.newCardSection().setHeader(title);
    if (!list.length) {
      sec.addWidget(cs.newTextParagraph().setText('✅ None'));
    } else {
      list.forEach(r => {
        const url = `https://mail.google.com/mail/u/0/#inbox/${r.threadId}`;
        sec.addWidget(
          cs.newDecoratedText()
            .setText(`${r.artist}${r.location ? ` (${r.location})` : ''}`)
            .setBottomLabel(`${r.since} d · FU ${r.count} · ${r.stage}`)
            .setOpenLink(cs.newOpenLink().setUrl(url))
        );
      });
    }
    return sec;
  };

  return cs.newCardBuilder()
    .setHeader(cs.newCardHeader().setTitle('Unresponsive'))
    .addSection(makeSection('Leads',   leads))
    .addSection(makeSection('Clients', clients))
    .build();
}
