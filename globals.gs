/**
 * 00_globals.gs — loads first; defines universal helpers once.
 * Drop‑in: no other file must declare CS, TZ, isoMid with const/let.
 */

/* CardService alias — hoisted var is duplicate‑safe */
var CS = (typeof CS !== 'undefined') ? CS : CardService;

/* Time‑zone constant */
var TZ = globalThis.__OWTI_TZ__ || (globalThis.__OWTI_TZ__ = 'Australia/Melbourne');

/* ISO‑date → midnight timestamp helper, created once */
if (typeof globalThis.isoMid === 'undefined') {
  globalThis.isoMid = function isoMid(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  };
}
/* Today @ midnight timestamp (shared, duplicate‑safe) */
if (typeof globalThis.todayMid === 'undefined') {
  globalThis.todayMid = (function () {
    const d = new Date(); d.setHours(0,0,0,0);
    return d.getTime();
  })();
}
var todayMid = globalThis.todayMid;          // local alias, re‑declaration safe
/* Today @ midnight timestamp (duplicate‑safe) */
if (typeof globalThis.todayMid === 'undefined') {
  globalThis.todayMid = (function () {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
}
/* Local alias; re‑declaration with var is harmless */
var todayMid = globalThis.todayMid;

/* Local alias (var makes duplicate declarations harmless) */
var isoMid = globalThis.isoMid;
