/* ── GLOBAL GUARDS ──────────────────────────────────────────── */
var CS = (typeof CS !== 'undefined') ? CS : CardService;          // CardService alias

if (typeof globalThis.__OWTI_TZ__ === 'undefined') {
  globalThis.__OWTI_TZ__ = 'Australia/Melbourne';
}
var TZ = globalThis.__OWTI_TZ__;

if (typeof globalThis.isoMid === 'undefined') {
  globalThis.isoMid = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  };
}
var isoMid = globalThis.isoMid;
/* ───────────────────────────────────────────────────────────── */


/* 00_config.gs — loads once per runtime */
;(() => {
  'use strict';
  if (globalThis.CONFIG) return;                // idempotent guard

  const props = PropertiesService.getScriptProperties();
  const get   = (k, d='') => props.getProperty(k) || d;

  const SHEET_ID       = get('SHEET_ID',       'REPLACE_WITH_SHEET_ID');
  const CRM_SHEET_NAME = get('CRM_SHEET_NAME', 'CRM');
  if (SHEET_ID === 'REPLACE_WITH_SHEET_ID')
    throw new Error('CONFIG ✗  Set SHEET_ID in Script Properties.');

  /* ── identity ────────────────────────────────────────────── */
  const json = (k, def) => {
    try { return JSON.parse(get(k, def)); }
    catch { return JSON.parse(def); }
  };
  const SELF_EMAILS = json('SELF_EMAILS', '["hugh@outwiththein.com"]').map(e => e.toLowerCase());
  const SELF_NAMES  = json('SELF_NAMES',  '["Hugh Middleton"]').map(n => n.toLowerCase());
  const SELF_DOMAIN = get('SELF_DOMAIN', 'outwiththein.com').toLowerCase();
  const SELF_MOBILE = get('SELF_MOBILE_E164', '+61416443009');

  /* ── pipeline stages (single source of truth) ─────────────── */
  const LEAD_STAGES   = Object.freeze(['Dead', 'Cold', 'Warm', 'Hot']);
  const CLIENT_STAGES = Object.freeze(['Dormant', 'Re‑engage', 'Active']);
  const PIPELINE_STAGES = Object.freeze([...LEAD_STAGES, ...CLIENT_STAGES]);
  const FINAL_STAGES    = Object.freeze(['Dead', 'Dormant']);           // no more follow‑ups

  const STAGE_INDEX = (() => {
    const m = {};
    PIPELINE_STAGES.forEach((s, i) => { m[s.toLowerCase()] = i; });
    return Object.freeze(m);
  })();

  /* ── follow‑up cadence & caps ─────────────────────────────── */
  const FOLLOW_UP_DELAYS = Object.freeze({ 1:7, 2:7, 3:7, 4:7, 5:7 });
  const MAX_FOLLOW_UPS   = Number(get('MAX_FOLLOW_UPS',   '10')) || 10;
  const DAILY_DRAFT_LIMIT= Number(get('DAILY_DRAFT_LIMIT','10')) || 10;
  const CRM_CACHE_SECONDS= Number(get('CRM_CACHE_SECONDS','300'))|| 300;

  /* ── export immutable CONFIG ──────────────────────────────── */
  globalThis.CONFIG = Object.freeze({
    /* sheets */
    SHEET_ID,
    CRM_SHEET_NAME,
    TRACKER_SHEET_ID : get('TRACKER_SHEET_ID',''),

    /* identity */
    SELF_EMAILS,
    SELF_NAMES,
    SELF_DOMAIN,
    SELF_MOBILE,

    /* pipeline */
    PIPELINE_STAGES,
    LEAD_STAGES,
    CLIENT_STAGES,
    FINAL_STAGES,
    STAGE_INDEX,

    /* follow‑ups & limits */
    FOLLOW_UP_DELAYS,
    MAX_FOLLOW_UPS,
    DAILY_DRAFT_LIMIT,
    CRM_CACHE_SECONDS,

    /* misc */
    DEBUG : get('DEBUG','false') === 'true'
  });
})();
