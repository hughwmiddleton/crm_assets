// ========================= dueTodayCard.gs =========================
/* global CONFIG, SheetsIO */
'use strict';

/* Safe CardService aliases */
var CS = (typeof CS !== 'undefined') ? CS : CardService;
var cs = (typeof cs !== 'undefined') ? cs : CS;      // legacy alias used below

/**
 * “Follow‑Ups Due / Overdue” card
 * (restored original logic; no duplicate‑identifier conflicts)
 */
function buildDueTodayCard() {
  const g = SheetsIO.getGrid();

  const card = cs.newCardBuilder()
    .setHeader(cs.newCardHeader().setTitle('Follow‑Ups Due / Overdue'));

  if (!g.rows.length) {
    card.addSection(cs.newCardSection().addWidget(
      cs.newTextParagraph().setText('CRM sheet is empty')
    ));
    return card.build();
  }

  /* column indexes */
  const h = g.head, ix = n => h.indexOf(n);
  const iId   = ix('thread_id');
  const iArt  = ix('name');
  const iLoc  = ix('location');
  const iStage= ix('pipeline_stage');
  const iNext = ix('next_follow_up_iso');
  const iCnt  = ix('follow_up_count');
  const iLast = ix('last_contact_date');
  const iSnooz= ix('snoozed_until');

  const today = new Date(); today.setHours(0,0,0,0);

  const buckets = { Leads:{}, Clients:{} };

  g.rows.forEach(r => {
    const stage = r[iStage] || '';

    if (CONFIG.FINAL_STAGES.includes(stage)) return;
    if (r[iSnooz] && new Date(r[iSnooz]) > today) return;

    const followUps = Number(r[iCnt]) || 0;
    const due = !r[iNext]
                  ? followUps >= 1
                  : new Date(r[iNext]) <= today;
    if (!due) return;

    const last = (iLast !== -1 && r[iLast]) ? new Date(r[iLast]) : null;
    const days = last ? Math.floor((today - last) / 864e5) : '-';
    const rec  = {
      threadId : r[iId],
      name     : r[iArt] || '(Unknown)',
      location : r[iLoc] || '',
      days,
      fuCount  : r[iCnt] || '-'
    };

    const bucket = CONFIG.LEAD_STAGES.includes(stage) ? 'Leads' : 'Clients';
    (buckets[bucket][stage] = buckets[bucket][stage] || []).push(rec);
  });

  /* sort each stage list by oldest first */
  const sortBy = a => (a.days === '-' ? 1e9 : a.days);
  ['Leads','Clients'].forEach(cat =>
    Object.keys(buckets[cat]).forEach(st =>
      buckets[cat][st].sort((a,b)=>sortBy(a)-sortBy(b))
    )
  );

  /* section factory */
  function makeBucketSection(title, bucketObj) {
    const sec = cs.newCardSection().setHeader(title);
    const stages = Object.keys(bucketObj);
    if (!stages.length) {
      sec.addWidget(cs.newTextParagraph().setText('✅ None'));
      return sec;
    }
    stages.forEach(stg => {
      sec.addWidget(cs.newDecoratedText().setText(`► ${stg}`).setWrapText(true));
      bucketObj[stg].forEach(rec => {
        const url = `https://mail.google.com/mail/u/0/#inbox/${rec.threadId}`;
        sec.addWidget(
          cs.newDecoratedText()
            .setText(`${rec.artist}${rec.location ? ` (${rec.location})` : ''}`)
            .setBottomLabel(`${rec.days} d · FU #${rec.fuCount}`)
            .setOpenLink(cs.newOpenLink().setUrl(url))
        );
      });
    });
    return sec;
  }

  card.addSection(makeBucketSection('Leads',   buckets.Leads));
  card.addSection(makeBucketSection('Clients', buckets.Clients));
  return card.build();
}
