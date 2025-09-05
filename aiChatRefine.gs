/**
 * aiChatRefine.gs — Chat with GPT panel
 * shows plain text draft instead of raw JSON
 */
;(() => {
  'use strict';
  if (globalThis.__OWTI_CHAT_LOADED__) return;
  globalThis.__OWTI_CHAT_LOADED__ = true;

  /* CardService alias */
  const CS = (typeof globalThis.CS !== 'undefined') ? globalThis.CS : CardService;

  const CACHE = CacheService.getUserCache();
  const TTL   = 600;                                           // 10 min
  const key   = t => `chat_${t}`;

  const hist  = tid => JSON.parse(CACHE.get(key(tid)) || '[]');
  const save  = (tid,h)=>CACHE.put(key(tid),JSON.stringify(h),TTL);

  /* ---------- UI ---------- */
  function card(tid){
    const c = CS.newCardBuilder()
      .setHeader(CS.newCardHeader().setTitle('Chat with GPT').setSubtitle(`Thread ID ${tid}`));

    const h = hist(tid);
    if (h.length){
      const s = CS.newCardSection();
      h.slice(-10).forEach(m=>
        s.addWidget(
          CS.newDecoratedText()
            .setText(`${m.from==='user'?'🟢 You':'🤖 GPT'}: ${m.text}`)
            .setWrapText(true)
        )
      );
      c.addSection(s);
    }

    const input = CS.newTextInput().setFieldName('chatInput').setMultiline(true);
    const btn   = CS.newTextButton().setText('Send')
      .setOnClickAction(
        CS.newAction().setFunctionName('handleSendChat').setParameters({threadId:tid})
      );

    c.addSection(CS.newCardSection().addWidget(input).addWidget(btn));
    return c.build();
  }

  /* ---------- open ---------- */
  function handleOpenChat(e){
    const tid = e?.parameters?.threadId || e?.gmail?.threadId || '';
    return tid ? card(tid) :
      CS.newActionResponseBuilder()
        .setNotification(CS.newNotification().setText('Open the chat from inside a thread.'))
        .build();
  }

  /* ---------- send ---------- */
  function handleSendChat(e){
    const tid  = e?.parameters?.threadId || '';
    const user = (e?.formInput?.chatInput||'').trim();
    if(!tid||!user) return card(tid);

    const h = hist(tid); h.push({from:'user',text:user});

    try{
      const th = GmailApp.getThreadById(tid);
      if(!th) throw new Error('Thread deleted');

      /* ▸ NEW — pass user prompt so draft reflects it */
      createAiDraftForThread(th, user);

      /* ▸ NEW — fetch the *latest* draft body so user can copy‑paste */
      const draft = th.getMessages().filter(m=>m.isDraft()).pop();
      const body  = draft ? draft.getPlainBody().trim() : '(draft updated)';

      h.push({from:'gpt', text: body});
    }catch(err){
      h.push({from:'gpt',text:`(error: ${err.message})`});
    }
    save(tid,h);
    return card(tid);
  }

  Object.assign(globalThis,{handleOpenChat,handleSendChat});
})();
