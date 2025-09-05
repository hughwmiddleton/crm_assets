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

/* global CONFIG, SheetsIO, rowToObj */

/* Safe global alias (hoisted `var` avoids duplicate‑declaration errors) */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

'use strict';

/** Build the sidebar card summarising leads & client counts. */
function buildPipelineSummaryCard() {
  const card = CS.newCardBuilder()
                 .setHeader(CS.newCardHeader().setTitle('Pipeline Summary'));

  const { head, rows } = SheetsIO.getGrid();

  if (!rows.length) {
    card.addSection(
      CS.newCardSection().addWidget(
        CS.newTextParagraph().setText('No records found in CRM.')
      )
    );
    return card.build();
  }

  const iStage = head.indexOf('pipeline_stage');
  if (iStage === -1) {
    card.addSection(
      CS.newCardSection().addWidget(
        CS.newTextParagraph().setText('⚠️ Column “pipeline_stage” not found.')
      )
    );
    return card.build();
  }

  /* --------------- tally counts --------------- */
  const counts = {};
  rows.forEach(r => {
    const stage = String(r[iStage] || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^./, c => c.toUpperCase());
    if (!stage) return;
    counts[stage] = (counts[stage] || 0) + 1;
  });

  /* --------------- helper to build each section --------------- */
  const makeSection = (title, stages) => {
    const sec = CS.newCardSection().setHeader(title);
    stages.forEach(s => {
      sec.addWidget(
        CS.newDecoratedText()
          .setTopLabel(s)
          .setText(String(counts[s] || 0))
      );
    });
    return sec;
  };

  card
    .addSection(makeSection('📥 Leads',   CONFIG.LEAD_STAGES))
    .addSection(makeSection('🤝 Clients', CONFIG.CLIENT_STAGES));

  return card.build();
}
