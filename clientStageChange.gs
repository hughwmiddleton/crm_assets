/* global CONFIG, SheetsIO */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

/**
 * Dropdown onChange → update pipeline_stage, sync label, save record
 */
function handleStageChange(e) {
  if (e.gmail?.accessToken) {
    GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  }

  const tid      = e.parameters.threadId;
  const newStage = e.commonEventObject.formInputs.pipeline_stage.stringInputs.value[0];

  const found = SheetsIO.getClientData(tid) || {};
  const rec   = found.rec ? { ...found.rec } : { thread_id: tid };
  rec.pipeline_stage = newStage;
  SheetsIO.saveClientRecord(rec, found.rowIndex);

  /* Optional Gmail label sync (helpers.gs) */
  if (typeof syncPipelineLabel === 'function') {
    syncPipelineLabel(GmailApp.getThreadById(tid), newStage);
  } else if (typeof applyPipelineLabel === 'function') {
    applyPipelineLabel(tid, newStage);
  }

  return CS.newActionResponseBuilder()
    .setNotification(CS.newNotification().setText(`Stage → ${newStage}`))
    .setStateChanged(true)      // forces card to re‑render
    .build();
}
