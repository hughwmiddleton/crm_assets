/* 02_labels.gs — Gmail pipeline‑label helpers (idempotent) */
;(() => {
  'use strict';
  if (globalThis.__OWTI_LABELS_LOADED__) return;
  globalThis.__OWTI_LABELS_LOADED__ = true;

  // memoised GmailLabel getter
  const lblCache = Object.create(null);
  function getLabel(name) {
    if (!lblCache[name]) {
      lblCache[name] = GmailApp.getUserLabelByName(name)
                        || GmailApp.createLabel(name);
    }
    return lblCache[name];
  }

  // build full list of every pipeline label
  const ALL_PIPE_LABELS = [
    ...CONFIG.LEAD_STAGES.map(s => `Leads/${s}`),
    'Leads',
    ...CONFIG.CLIENT_STAGES.map(s => `Clients/${s}`),
    'Clients'
  ].map(getLabel);

  /**
   * Remove all pipeline labels from the given thread, then apply
   * exactly one new label under either Leads/... or Clients/... .
   */
  function applyPipelineLabel(threadId, newStage) {
    if (!threadId) return;
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) return;

    // strip every old pipeline label
    ALL_PIPE_LABELS.forEach(label => {
      try { thread.removeLabel(label); }
      catch (e) { /* ignore */ }
    });

    // choose & apply the correct one
    let path = null;
    if (CONFIG.LEAD_STAGES.includes(newStage)) {
      path = `Leads/${newStage}`;
    } else if (CONFIG.CLIENT_STAGES.includes(newStage)) {
      path = `Clients/${newStage}`;
    }

    if (path) {
      getLabel(path).addToThread(thread);
    }
  }

  globalThis.applyPipelineLabel = applyPipelineLabel;
})();
