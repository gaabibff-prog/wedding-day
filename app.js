/* Gabi Wedding Day: a phone app that keeps your upcoming weddings on the phone.
   Weddings come from the main Claude app as a locked file; checkmarks and notes go back the same way.
   Everything is stored only on this phone. Files are locked (AES-GCM) with your pairing code. */
(function () {
  'use strict';

  /* ---------- small storage helper (IndexedDB, with a memory fallback) ---------- */
  var MEM = {};
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('gabi-day-app', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('kv', mode), st = t.objectStore('kv'), q = fn(st);
        t.oncomplete = function () { db.close(); res(q && q.result); };
        t.onerror = t.onabort = function () { db.close(); rej(t.error); };
      });
    });
  }
  function get(k) { return tx('readonly', function (s) { return s.get(k); }).catch(function () { return MEM[k]; }); }
  function put(k, v) { MEM[k] = v; return tx('readwrite', function (s) { return s.put(v, k); }).catch(function () {}); }
  function del(k) { delete MEM[k]; return tx('readwrite', function (s) { return s.delete(k); }).catch(function () {}); }

  /* ---------- lock and unlock files with the pairing code ---------- */
  var te = new TextEncoder(), td = new TextDecoder();
  function b64(u) { var s = ''; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function keyFrom(code, salt) {
    return crypto.subtle.importKey('raw', te.encode(normCode(code)), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function lock(obj, code, kind) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return keyFrom(code, salt).then(function (k) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode('gabiday:' + kind) }, k, te.encode(JSON.stringify(obj)));
    }).then(function (ct) { return JSON.stringify({ gabiday: 1, kind: kind, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }); });
  }
  function unlock(text, code) {
    var f; try { f = JSON.parse(text); } catch (e) { return Promise.reject(new Error('That is not a Wedding Day file.')); }
    if (!f || f.gabiday !== 1 || !f.ct) return Promise.reject(new Error('That is not a Wedding Day file.'));
    return keyFrom(code, unb64(f.salt)).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv), additionalData: te.encode('gabiday:' + f.kind) }, k, unb64(f.ct));
    }).then(function (pt) { return { kind: f.kind, data: JSON.parse(td.decode(pt)) }; },
      function () { throw new Error('This file was locked with a different pairing code. Check the code in your main app.'); });
  }


  /* ---------- state ---------- */
  var VERSION = 13, PHOTOS = {}, ALERT = 10, BEEP = null, EDIT = false, SHEET = false, CODE = null, WEDS = [], MADE = '', ST = {};
  var UI = { view: 'home', wid: null, tab: 'overview', page: '', group: null, famSeg: 'todo' };
  try { var u0 = JSON.parse(localStorage.getItem('gabi-day-ui') || 'null'); if (u0) { for (var k0 in u0) UI[k0] = u0[k0]; } } catch (e) {}
  if (['home', 'weddings', 'sync', 'settings', 'wedding'].indexOf(UI.view) < 0) UI.view = 'home';
  if (['overview', 'now', 'fam', 'shots', 'where', 'contacts', 'notes', 'big', 'prep'].indexOf(UI.tab) < 0) UI.tab = 'overview';
  try { var a0 = localStorage.getItem('gabi-day-alert'); if (a0 != null) ALERT = +a0 || 0; } catch (e) {}
  function saveUI() { try { localStorage.setItem('gabi-day-ui', JSON.stringify(UI)); } catch (e) {} }
  function stOf(wid) { var s = ST[wid]; if (!s) s = ST[wid] = {}; ['done', 'fam', 'later', 'open', 'y', 'gear', 'prep', 'alerted', 'miss'].forEach(function (k) { if (!s[k]) s[k] = {}; }); if (s.notes == null) s.notes = ''; if (!s.filter) s.filter = 'all'; return s; }
  var saveT = null;
  function saveST() { clearTimeout(saveT); saveT = setTimeout(function () { put('state', ST); }, 150); }

  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f12(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function dayIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function weddingDay() { var d = new Date(); if (d.getHours() < 6) d.setDate(d.getDate() - 1); return dayIso(d); }
  function isToday(D) { return D.date === weddingDay(); }
  function daysTo(iso) { var a = new Date(weddingDay() + 'T12:00:00'), b = new Date(iso + 'T12:00:00'); return Math.round((b - a) / 86400000); }
  function nowMin(D) { var d = new Date(), m = d.getHours() * 60 + d.getMinutes(), t = D.tl; if (!t.length) return m; var mid = (t[0].s + t[t.length - 1].s) / 2; while (m < mid - 720) m += 1440; while (m > mid + 720) m -= 1440; return m; }
  function cur() { for (var i = 0; i < WEDS.length; i++) if (WEDS[i].id === UI.wid) return WEDS[i]; return null; }
  function toast(t) { [].forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); }); var d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }
  function clockNow() { var d = new Date(); return f12(d.getHours() * 60 + d.getMinutes()); }
  function sorted() { return WEDS.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); }
  function people(D) { var seen = {}; D.fam.forEach(function (x) { (x.names || []).forEach(function (n) { seen[String(n).toLowerCase()] = 1; }); }); return Object.keys(seen).length; }
  function shortDate(D) { try { return new Date(D.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }); } catch (x) { return D.dateLabel; } }

  /* ---------- icons (simple line drawings) ---------- */
  var IC = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
    rings: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M13 5l2-2 2 2-2 2z"/>',
    sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    brief: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h3M13 13h3M8 17h3"/>',
    clock: '<rect x="3" y="5" width="15" height="15" rx="2"/><path d="M3 10h15M8 3v4M13 3v4"/><circle cx="18" cy="17" r="4.5" fill="var(--bg)"/><path d="M18 15v2.2l1.4 1"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    list: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8.5 12l1.5 1.5 2.5-3M14 12h2M8.5 17h7"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    pin: '<path d="M12 21s-6-6.1-6-11a6 6 0 0 1 12 0c0 4.9-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z"/>',
    sun: '<circle cx="12" cy="15" r="4"/><path d="M12 6v2M5 15H3M21 15h-2M6.3 9.3l1.4 1.4M17.7 9.3l-1.4 1.4M3 20h18"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3A5 5 0 0 1 21 19"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

  /* ---------- top bar and bottom tabs ---------- */
  var HOME_TABS = [['home', 'Home', 'home'], ['weddings', 'Weddings', 'rings'], ['sync', 'Sync', 'sync'], ['settings', 'Settings', 'gear']];
  var WED_TABS = [['overview', 'Overview', 'brief'], ['now', 'Timeline', 'clock'], ['fam', 'Family', 'camera'], ['shots', 'Shot list', 'list'], ['more', 'More', 'more']];
  function bars() {
    var hd = document.getElementById('hd'), tb = document.getElementById('tb'), D = cur();
    if (!CODE) { hd.innerHTML = '<div class="bar"><span class="ttl">Wedding Day</span></div>'; tb.innerHTML = ''; return; }
    if (UI.view === 'wedding' && D) {
      var title = UI.group ? D.couple : ({ overview: 'Wedding brief', now: D.couple, fam: D.couple, shots: D.couple, where: 'Places', contacts: 'Contacts', notes: 'Notes', big: 'Big view', prep: 'Packing & day before' }[UI.tab] || D.couple);
      hd.innerHTML = '<div class="bar"><button class="ib" data-back="1" aria-label="Back">' + svg('back') + '</button><span class="ttl">' + e(title) + '</span>' + (isToday(D) ? '<span class="clock" id="clock">' + clockNow() + '</span>' : '') + '<button class="ib" data-sheet="1" aria-label="More">' + svg('more') + '</button></div>';
      var t = ['where', 'contacts', 'notes', 'prep'].indexOf(UI.tab) >= 0 ? 'more' : UI.tab === 'big' ? 'now' : UI.tab;
      tb.innerHTML = WED_TABS.map(function (x) { return '<button class="tab" data-wtab="' + x[0] + '"' + (t === x[0] ? ' aria-current="page"' : '') + '><span class="ti">' + svg(x[2]) + '</span>' + x[1] + '</button>'; }).join('');
    } else {
      var name = { home: 'Home', weddings: 'Weddings', sync: 'Sync with main app', settings: 'Settings' }[UI.view] || 'Home';
      hd.innerHTML = '<div class="bar"><span class="ttl" style="padding-left:6px">' + name + '</span><span class="clock" id="clock">' + clockNow() + '</span></div>';
      tb.innerHTML = HOME_TABS.map(function (x) { return '<button class="tab" data-view="' + x[0] + '"' + (UI.view === x[0] ? ' aria-current="page"' : '') + '><span class="ti">' + svg(x[2]) + '</span>' + x[1] + '</button>'; }).join('');
    }
  }

  /* ---------- home level screens ---------- */
  function vSetup() {
    return '<h1 class="hello">Welcome!</h1><p class="sub">Pair this phone once with your main app.</p>' +
      '<div class="card"><p class="hint" style="margin-top:0">In your main app inside Claude, open <b>Weddings → 📲 Day-of phone app</b>, tap <b>Copy</b> next to your pairing code, and paste it here. It locks your wedding files so only you can open them.</p>' +
      '<input type="text" id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">' +
      '<div class="btns"><button class="btn dark" data-act="savecode">Save pairing code</button></div></div>' + installHint();
  }
  function installHint() {
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (standalone) return '';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return '<div class="card tint"><b>Add it to your home screen</b><p class="hint" style="margin:6px 0 0">' +
      (ios ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>.' : 'In Chrome, tap the ⋮ menu, then <b>Install app</b>.') +
      ' Always open it from the icon: it opens with no signal and stays where you left it.</p></div>';
  }
  function hello() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function wedRow(D, withEdit) {
    var s = stOf(D.id), n = D.shots.filter(function (x) { return s.done[x.id]; }).length + D.fam.filter(function (x) { return s.fam[x.id]; }).length, d = daysTo(D.date);
    var when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d > 1 ? 'In ' + d + ' days' : '';
    return '<div class="li" style="padding:0"><button class="li" data-wid="' + e(D.id) + '" style="border:0;flex:1"><span class="ico">' + svg('rings') + '</span><span class="t"><b>' + e(D.couple) + (d === 0 ? '<span class="badge">Today</span>' : '') + '</b><small>' + e(shortDate(D)) + (when && d !== 0 ? ' · ' + when : '') + (n ? ' · ' + n + ' checked' : '') + '</small></span>' + (withEdit ? '' : '<span class="chev">›</span>') + '</button>' +
      (withEdit ? '<button class="btn dg" data-rm="' + e(D.id) + '" style="width:auto;min-height:40px;margin-right:12px;font-size:15px">Remove</button>' : '') + '</div>';
  }
  function vHome() {
    var list = sorted(), today = weddingDay(), up = list.filter(function (D) { return D.date >= today; }), next = up[0];
    var h = '<div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><h1 class="hello">' + hello() + ', Gabi.</h1><div class="sub">' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + '</div></div><div class="av">G</div></div>';
    h += '<div style="height:18px"></div>';
    if (next) {
      var d = daysTo(next.date);
      h += '<div class="card"><div class="sub" style="margin-bottom:4px">' + (d === 0 ? 'Today’s wedding' : 'Next wedding · ' + (d === 1 ? 'tomorrow' : 'in ' + d + ' days')) + '</div><div style="font-size:24px;font-weight:700">' + e(next.couple) + '</div>' +
        '<div class="meta">' + svg('cal') + e(shortDate(next)) + '</div>' + (next.venue ? '<div class="meta">' + svg('pin') + e(next.venue) + '</div>' : '') +
        '<div class="btns"><button class="btn dark" data-wid="' + e(next.id) + '">Open wedding</button>' + (d <= 2 ? '<button class="btn" data-prepfor="' + e(next.id) + '">Packing & day before · ' + prepCount(next, stOf(next.id)).done + ' of ' + prepCount(next, stOf(next.id)).all + '</button>' : '') + '</div></div>';
    } else {
      h += '<div class="card"><p class="sub" style="margin-top:0;font-size:17px">Load your next wedding when you’re ready.</p><div class="btns"><button class="btn dark" data-act="load">Load weddings</button></div></div>';
    }
    var locs = [];
    up.slice(0, 6).forEach(function (D) { (D.stops || []).forEach(function (x) { if (x.addr && locs.length < 8) locs.push({ addr: x.addr, name: x.name, couple: D.couple }); }); });
    if (locs.length) {
      h += '<div class="h2"><span class="ico" style="width:auto;height:auto">' + svg('pin') + '</span>Wedding locations</div><div class="list">' +
        locs.map(function (x) { return '<a class="li" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.addr) + '"><span class="ico" style="color:var(--icon)">' + svg('pin') + '</span><span class="t"><b>' + e(x.addr.split(',')[0]) + '</b><small>' + e(x.name) + ' · ' + e(x.couple) + '</small></span><span class="chev">›</span></a>'; }).join('') + '</div>';
    }
    h += '<div class="h2">More weddings<button class="lk" data-view="weddings">All weddings ›</button></div>';
    var more = up.slice(next ? 1 : 0, 4);
    h += more.length ? '<div class="list">' + more.map(function (D) { return wedRow(D, false); }).join('') + '</div>' : '<p class="sub">No other upcoming weddings yet.</p>';
    var mo = today.slice(0, 7), thisMonth = up.filter(function (D) { return D.date.slice(0, 7) === mo; }).length;
    h += '<div class="stat"><div><b>' + up.length + '</b><small>Upcoming</small></div><div><b>' + thisMonth + '</b><small>This month</small></div></div>';
    h += '<button class="btn" data-act="sync" style="justify-content:space-between;background:var(--tint);border-color:transparent"><span>' + svg('sync').replace('<svg', '<svg style="width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8"') + ' &nbsp;' + (SYNCING ? 'Syncing\u2026' : 'Sync with my main app') + '</span><span>\u2192</span></button><p class="hint" style="text-align:center">Last synced: ' + e(lastSync()) + '</p>';
    return h + installHint();
  }
  function vWeddings() {
    var list = sorted(), today = weddingDay(), up = list.filter(function (D) { return D.date >= today; }), past = list.filter(function (D) { return D.date < today; }).reverse();
    var h = '<div style="display:flex;align-items:center"><h1 class="hello" style="flex:1">Weddings</h1>' + (list.length ? '<button class="btn link" data-act="edit" style="width:auto">' + (EDIT ? 'Done' : 'Edit') + '</button>' : '') + '</div>';
    if (!list.length) return h + '<p class="sub">No weddings on this phone yet.</p><div class="btns"><button class="btn dark" data-act="load">Load weddings</button></div>';
    h += '<div class="h2" style="margin-top:14px">Upcoming</div>' + (up.length ? '<div class="list">' + up.map(function (D) { return wedRow(D, EDIT); }).join('') + '</div>' : '<p class="sub">None.</p>');
    if (past.length) h += '<div class="h2">Past</div><div class="list">' + past.map(function (D) { return wedRow(D, EDIT); }).join('') + '</div>';
    return h;
  }
  function vSync() {
    return '<h1 class="hello">Sync</h1><p class="sub">Move weddings and checkmarks between this phone and your main app.</p>' + syncCard() + '<div class="h2" style="font-size:18px">Or use files</div>' +
      '<div class="card"><b>1. Get weddings</b><p class="hint">In your main app tap <b>📲 Send to my Day-of app</b>, then tap below and pick the file.</p><button class="btn dark" data-act="load">Load weddings</button>' + (MADE ? '<p class="hint" style="margin-bottom:0">Last file: sent ' + e(MADE) + '.</p>' : '') + '</div>' +
      '<div class="card"><b>2. After the wedding</b><p class="hint">Send your checkmarks and notes back. In your main app tap <b>Load Day-of app results</b> and pick the file.</p><button class="btn" data-act="sendback">Send checkmarks & notes back</button></div>';
  }
  function vSettings() {
    return '<h1 class="hello">Settings</h1><div class="list" style="margin-top:14px">' +
      ('wakeLock' in navigator ? '<button class="li" data-act="wake"><span class="ico">' + svg('sun') + '</span><span class="t"><b>Keep screen on</b><small>' + (WL ? 'On while the app is open' : 'Off') + '</small></span></button>' : '') +
      '<button class="li" data-act="changecode"><span class="ico">' + svg('gear') + '</span><span class="t"><b>Change pairing code</b><small>Your weddings stay on this phone</small></span></button>' +
      '<button class="li" data-act="wipe"><span class="ico" style="color:var(--warn)">' + svg('close') + '</span><span class="t"><b style="color:var(--warn)">Remove all weddings from this phone</b><small>Your main app keeps everything</small></span></button></div>' +
      '<p class="hint">Everything is stored only on this phone. App version ' + VERSION + '.</p>' + installHint();
  }


  /* ---------- running late: new times and what to shorten ---------- */
  var FIXED = /ceremony|entrance|introduc|sunset|golden|first dance|toast|speech|dinner|send.?off|exit|cake/i;
  var FLEX = /portrait|family|party|couple|cocktail|detail|getting ready|candid|free time|buffer|first look|bridesmaid|groomsm|creative/i;
  function sched(D, S) {
    var n = D.tl.length, out = D.tl.map(function (b) { return { s: b.s, d: b.d, cut: 0 }; });
    var sh = +S.shift || 0, from = +S.shiftFrom || 0; if (!sh || from >= n) return { t: out, plan: null };
    var j = -1; for (var k = from + 1; k < n; k++) { if (D.tl[k].cer || FIXED.test(D.tl[k].label)) { j = k; break; } }
    var end = j < 0 ? n : j, need = sh, flex = [];
    for (var k2 = from; k2 < end; k2++) if (FLEX.test(D.tl[k2].label) && D.tl[k2].d >= 10) flex.push(k2);
    flex.sort(function (a, b) { return D.tl[b].d - D.tl[a].d; });
    flex.forEach(function (k3) { if (need <= 0) return; var c = Math.min(need, Math.floor(D.tl[k3].d / 2 / 5) * 5); if (c > 0) { out[k3].cut = c; need -= c; } });
    var cursor = D.tl[from].s + sh;
    for (var i = from; i < n; i++) {
      var st = i < end ? cursor : Math.max(D.tl[i].s, cursor);
      out[i].s = st; out[i].d = D.tl[i].d - out[i].cut; cursor = st + out[i].d;
    }
    var cuts = flex.filter(function (k4) { return out[k4].cut; }).map(function (k4) { return { label: D.tl[k4].label, cut: out[k4].cut }; });
    return { t: out, plan: { anchor: j >= 0 ? D.tl[j] : null, cuts: cuts, short: Math.max(0, need), from: D.tl[from] } };
  }
  function lateHtml(D, S) {
    var P = sched(D, S).plan, h = '<div class="card" style="padding:14px 16px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="flex:1;min-width:120px">' + (P ? 'Running ' + S.shift + ' min late' : 'Running late?') + '</b>' +
      [5, 10, 15, 30].map(function (m) { return '<button class="btn" data-late="' + m + '" style="width:auto;min-height:40px;padding:0 12px;font-size:15px">+' + m + '</button>'; }).join('') +
      (P ? '<button class="btn link" data-late="0" style="width:auto;min-height:40px;padding:0 6px;font-size:15px">Back on time</button>' : '') + '</div>';
    if (P) {
      var a = P.anchor;
      h += '<p class="hint" style="margin:10px 0 0;color:var(--ink)">' + (a ? 'To stay on time for <b>' + e(a.label) + '</b> at ' + f12(a.s) + ': ' : 'To catch up: ') +
        (P.cuts.length ? P.cuts.map(function (c) { return 'shorten <b>' + e(c.label) + '</b> by ' + c.cut + ' min'; }).join(', ') + '.' : 'there is nothing easy to shorten.') +
        (P.short ? ' Still ' + P.short + ' min short: let the coordinator know.' : '') + '</p><p class="hint" style="margin:4px 0 0">New times are shown below from ' + e(P.from.label) + ' on.</p>';
    }
    return h + '</div>';
  }

  /* ---------- wedding screens ---------- */
  function curIdx(D) { if (!isToday(D)) return -1; var T = sched(D, stOf(D.id)).t, m = nowMin(D), c = -1; T.forEach(function (b, i) { if (m >= b.s && m < b.s + Math.max(b.d, 1)) c = i; }); if (c < 0) T.forEach(function (b, i) { if (c < 0 && b.s > m) c = i; }); return c; }
  function vOverview(D, S) {
    var h = '<h1 class="big">' + e(D.couple) + '</h1><div class="meta">' + svg('cal') + e(shortDate(D)) + '</div>' + (D.venue || (D.stops[0] && D.stops[0].addr) ? '<div class="meta">' + svg('pin') + e(D.venue || D.stops[0].addr.split(',')[0]) + '</div>' : '');
    var place = (D.stops.filter(function (x) { return x.addr; })[0] || {}).addr || D.venue || '';
    h += '<div class="two"><a target="_blank" rel="noopener" href="https://www.google.com/search?q=' + encodeURIComponent('weather ' + place + ' ' + D.dateLabel) + '"><span class="ico">' + svg('cloud') + '</span><span><b>Weather</b><small>View forecast</small></span></a>' +
      '<div><span class="ico">' + svg('sun') + '</span><span><b>' + (D.sunset != null ? f12(D.sunset - 60) : '—') + '</b><small>Golden hour' + (D.sunset != null ? ' · sunset ' + f12(D.sunset) : '') + '</small></span></div></div>';
    var c = curIdx(D), start = c >= 0 ? c : 0, g = D.tl.slice(start, start + 3);
    h += '<div class="card tint"><div style="display:flex;align-items:center;gap:12px"><span class="ico">' + svg('clock') + '</span><div style="flex:1"><div style="font-size:22px;font-weight:700">Timeline</div><div class="sub">' + D.tl.length + ' moments planned</div></div><button class="btn link" data-wtab="now" style="width:auto;color:var(--ink)">View →</button></div>' +
      (g.length ? '<div style="border-top:1px solid var(--line);margin:14px 0 0;padding-top:12px" class="sub">' + (c >= 0 ? 'Now and next' : 'Day at a glance') + '</div><div class="glance">' + g.map(function (b) { return '<span class="tm">' + f12(b.s) + '</span><span class="dot"></span><span class="lb">' + e(b.label) + '</span>'; }).join('') + '</div>' : '') + '</div>';
    if (isToday(D)) h += '<div class="btns" style="margin:-2px 0 12px"><button class="btn dark" data-page="big">Big view: now & next</button></div>';
    var phN = photosOf(D.id).length, famDone = D.fam.filter(function (x) { return S.fam[x.id]; }).length, shotDone = D.shots.filter(function (x) { return S.done[x.id]; }).length, notes = String(S.notes || '').split('\n').filter(function (x) { return x.trim(); }).length;
    h += '<div class="h2">Wedding details</div><div class="grid">' +
      '<button data-wtab="fam"><span class="ico">' + svg('people') + '</span><span><b>Family photos</b><small>' + famDone + ' of ' + D.fam.length + ' groups · ' + people(D) + ' people</small></span></button>' +
      '<button data-wtab="shots"><span class="ico">' + svg('list') + '</span><span><b>Shot list</b><small>' + shotDone + ' of ' + D.shots.length + ' captured</small></span></button>' +
      '<button data-page="contacts"><span class="ico">' + svg('phone') + '</span><span><b>Contacts</b><small>' + D.contacts.length + ' contact' + (D.contacts.length === 1 ? '' : 's') + '</small></span></button>' +
      '<button data-page="notes"><span class="ico">' + svg('note') + '</span><span><b>Notes</b><small>' + notes + ' note' + (notes === 1 ? '' : 's') + (phN ? ' \u00b7 ' + phN + ' photo' + (phN === 1 ? '' : 's') : '') + '</small></span></button>' +
      '<button data-page="prep"><span class="ico">' + svg('list') + '</span><span><b>Packing</b><small>' + prepCount(D, S).done + ' of ' + prepCount(D, S).all + ' checked</small></span></button>' +
      '<button data-page="where"><span class="ico">' + svg('pin') + '</span><span><b>Places</b><small>' + D.stops.length + ' stop' + (D.stops.length === 1 ? '' : 's') + '</small></span></button></div>';
    if (D.stops.length) h += '<div class="h2">Locations</div>' + locList(D);
    return h;
  }
  function locList(D) {
    return '<div class="list">' + D.stops.map(function (x, i) {
      var inner = '<span class="ico" style="color:var(--icon)">' + svg('pin') + '</span><span class="t"><b>' + e(x.addr ? x.addr.split(',')[0] : x.name) + '</b><small>' + e(x.name) + ' · be there by ' + f12(x.start) + (i < D.stops.length - 1 && x.drive ? ' · leave ' + f12(x.leave) : '') + '</small></span><span class="chev">›</span>';
      return x.addr ? '<a class="li" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.addr) + '">' + inner + '</a>' : '<div class="li">' + inner + '</div>';
    }).join('') + '</div>';
  }
  function vWhere(D) {
    if (!D.stops.length) return '<p class="sub">No places yet.</p>';
    return '<h1 class="hello">Where to be & when</h1><div style="height:12px"></div>' + D.stops.map(function (x, i) {
      var prev = i ? D.stops[i - 1].addr : '';
      return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + (i + 1) + '. ' + e(x.name) + '</b><b>' + f12(x.start) + '</b></div><div style="margin:4px 0">' + (x.addr ? e(x.addr) : '<span class="hint">No address</span>') + '</div><div class="hint">Be there by <b>' + f12(x.start) + '</b> for ' + e(x.first) + ' · until ' + f12(x.end) + (i < D.stops.length - 1 && x.drive ? ' · leave ' + f12(x.leave) + ' (' + x.drive + ' min drive)' : '') + '</div>' +
        (x.addr ? '<div class="row2" style="margin-top:12px"><a class="btn dark" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.addr) + '">Open in Maps</a>' + (prev ? '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(prev) + '&destination=' + encodeURIComponent(x.addr) + '&travelmode=driving">Directions</a>' : '') + '</div>' : '') + '</div>';
    }).join('');
  }
  function vTimeline(D, S) {
    var c = curIdx(D), T = sched(D, S).t, h = '<div style="display:flex;align-items:center"><h1 class="hello" style="flex:1">Timeline</h1><button class="btn" data-page="big" style="width:auto;min-height:40px;font-size:15px">Big view</button></div><p class="sub">' + (isToday(D) ? 'The current moment is highlighted.' : 'Planned times. On the wedding day the current moment is highlighted.') + '</p>';
    h += lateHtml(D, S);
    h += '<div class="list">' + D.tl.map(function (b, i) {
      var dn = !!S.done['t' + i], op = !!S.open['t' + i], moved = T[i].s !== b.s || T[i].d !== b.d;
      var tm = moved ? '<b style="display:inline;font-size:14px;color:var(--warn)">' + f12(T[i].s) + ' – ' + f12(T[i].s + T[i].d) + '</b> <s>' + f12(b.s) + '</s>' : f12(b.s) + ' – ' + f12(b.s + b.d);
      return '<div class="li' + (dn ? ' done' : '') + (i === c ? ' now' : '') + '"><button class="num" data-t="t' + i + '" aria-label="Mark done">' + (dn ? svg('check') : '') + '</button><button class="t" data-open="t' + i + '" style="border:0;background:none;text-align:left;padding:0"><small style="color:var(--mute)">' + tm + '</small><b style="white-space:normal">' + e(b.label) + (b.cer ? ' ♥' : '') + '</b>' + (b.note ? (op ? '<small style="white-space:normal;color:var(--ink)">' + e(b.note) + '</small>' : '<small>Tap for notes</small>') : '') + '</button></div>';
    }).join('') + '</div>';
    return h;
  }
  function vBig(D, S) {
    var T = sched(D, S).t, c = curIdx(D), today = isToday(D), m = nowMin(D);
    if (!today) c = 0;
    var b = D.tl[c], nx = D.tl[c + 1], af = D.tl[c + 2], h = '';
    h += '<div style="text-align:center;margin:6px 0 18px"><div style="font-size:64px;font-weight:700;letter-spacing:-.02em;line-height:1">' + clockNow().replace(/ (AM|PM)/, '<span style="font-size:24px;margin-left:6px">$1</span>') + '</div>' + (today ? '' : '<div class="sub">Preview: the wedding is ' + e(shortDate(D)) + '</div>') + '</div>';
    if (!b) return h + '<p class="sub" style="text-align:center">The timeline is over. Great job!</p>';
    var started = today && m >= T[c].s, left = Math.max(0, T[c].s + T[c].d - m), until = Math.max(0, T[c].s - m), pct = started && T[c].d ? Math.min(100, Math.round((m - T[c].s) / T[c].d * 100)) : 0;
    h += '<div class="card" style="border-color:var(--accent)"><div class="sub" style="text-transform:uppercase;letter-spacing:.08em;font-size:13px;font-weight:700">' + (started ? 'Now' : 'Up next') + '</div><div style="font-size:30px;font-weight:700;line-height:1.2;margin:4px 0">' + e(b.label) + '</div>' +
      '<div style="font-size:19px">' + (started ? '<b>' + left + ' min left</b> · until ' + f12(T[c].s + T[c].d) : (today ? 'Starts in <b>' + until + ' min</b> · ' : '') + f12(T[c].s)) + '</div>' + (started ? '<div class="bar2" style="margin:12px 0 0"><i style="width:' + pct + '%"></i></div>' : '') + (b.note ? '<p class="hint" style="margin:10px 0 0">' + e(b.note) + '</p>' : '') + '</div>';
    if (nx) h += '<div class="card"><div class="sub" style="text-transform:uppercase;letter-spacing:.08em;font-size:13px;font-weight:700">Next</div><div style="font-size:22px;font-weight:600;margin:2px 0">' + e(nx.label) + '</div><div style="font-size:17px">' + f12(T[c + 1].s) + (today ? ' · in ' + Math.max(0, T[c + 1].s - m) + ' min' : '') + '</div></div>';
    if (af) h += '<div class="card" style="opacity:.75"><div class="sub" style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">After that</div><div style="font-size:18px">' + f12(T[c + 2].s) + ' · ' + e(af.label) + '</div></div>';
    h += lateHtml(D, S);
    h += alertsHtml();
    return h;
  }
  function alertsHtml() {
    var perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    return '<div class="card" style="padding:14px 16px"><b>Alerts before each moment</b><p class="hint" style="margin:4px 0 10px">While the app is open: a sound, a vibration on Android, and a banner' + (perm === 'granted' ? ' plus a phone notification' : '') + '.</p><div class="chips" style="margin:0;padding:0;flex-wrap:wrap">' +
      [0, 5, 10, 15].map(function (n) { return '<button data-alert="' + n + '" aria-pressed="' + (ALERT === n) + '">' + (n ? n + ' min before' : 'Off') + '</button>'; }).join('') + '</div>' +
      (perm === 'default' && ALERT ? '<div class="btns"><button class="btn" data-act="notify">Also show phone notifications</button></div>' : '') + '</div>';
  }
  function famState(S, x) { return S.fam[x.id] ? 'done' : S.later[x.id] ? 'later' : 'todo'; }
  function vFam(D, S) {
    if (!D.fam.length) return '<h1 class="hello">Family photos</h1><p class="sub">No family photos on this list.</p>';
    if (UI.group) { var g = D.fam.filter(function (x) { return x.id === UI.group; })[0]; if (g) return vGroup(D, S, g); UI.group = null; }
    var segs = { todo: [], later: [], done: [] }; D.fam.forEach(function (x, i) { segs[famState(S, x)].push({ x: x, i: i }); });
    var seg = UI.famSeg || 'todo', L = segs[seg];
    var h = '<h1 class="hello">Family photos</h1><p class="sub">' + people(D) + ' people · ' + D.fam.length + ' groups</p>' +
      '<div class="seg">' + [['todo', 'To photograph'], ['later', 'Later'], ['done', 'Done']].map(function (s) { return '<button data-seg="' + s[0] + '"' + (seg === s[0] ? ' aria-current="page"' : '') + '>' + s[1] + '<small>' + segs[s[0]].length + '</small></button>'; }).join('') + '</div>';
    if (!L.length) return h + '<p class="sub" style="margin-top:18px">' + (seg === 'todo' ? 'All family photos are done. Thank everyone and send them to cocktail hour.' : 'Nothing here.') + '</p>';
    h += '<div>' + L.map(function (o) { var x = o.x, n = (x.names || []).length;
      var mc = Object.keys(S.miss[x.id] || {}).filter(function (k) { return S.miss[x.id][k]; }).length; return '<button class="li' + (seg === 'done' ? ' done' : '') + '" data-group="' + e(x.id) + '" style="padding:18px 0"><span class="num">' + (seg === 'done' ? svg('check') : (o.i + 1)) + '</span><span class="t wrap"><b>' + e(x.text) + '</b><small>' + (n ? n + (n === 1 ? ' person' : ' people') : e(x.who || '')) + (mc && seg !== 'done' ? ' \u00b7 <span style="color:var(--warn);font-weight:700">' + mc + ' missing</span>' : '') + '</small></span><span class="chev">\u203a</span></button>'; }).join('') + '</div>';
    return h;
  }
  function vGroup(D, S, g) {
    var st = famState(S, g), i = D.fam.indexOf(g), names = g.names && g.names.length ? g.names : (g.who ? String(g.who).split(/,\s*|\s+and\s+/) : []);
    var h = '<button class="btn link" data-group="" style="width:auto;padding:0;min-height:40px;justify-content:flex-start">‹ All groups</button>' +
      '<div class="sub" style="margin-top:6px">Group ' + (i + 1) + ' of ' + D.fam.length + (st === 'later' ? ' · Later' : st === 'done' ? ' · Done' : '') + '</div><h1 class="big" style="font-size:28px">' + e(g.text) + '</h1>';
    if (g.rel) h += '<div class="card tint" style="padding:14px"><span class="hint" style="color:var(--ink)">↳ ' + e(g.rel) + '</span></div>';
    var MS = S.miss[g.id] || {}, missing = names.filter(function (n) { return MS[n]; });
    if (missing.length && st !== 'done') h += '<div class="card" style="border-color:var(--warn);padding:14px 16px"><b style="color:var(--warn)">Missing: ' + e(missing.join(', ')) + '</b><p class="hint" style="margin:4px 0 10px">Ask the family helper to find them, or move this group to Later and keep going.</p><button class="btn" data-famset="later">Move to Later and keep going</button></div>';
    h += names.length ? '<div class="sub" style="margin:4px 0 8px">' + names.length + (names.length === 1 ? ' person' : ' people') + ' \u00b7 tap a name if they\u2019re missing</div><div class="list">' + names.map(function (n) { var mi = !!MS[n]; return '<button class="li" data-miss="' + e(n) + '"><span class="t"><b style="font-weight:500' + (mi ? ';color:var(--warn)' : '') + '">' + e(n) + '</b></span>' + (mi ? '<small style="color:var(--warn);font-weight:700">Missing</small>' : '') + '</button>'; }).join('') + '</div>' : '<p class="sub">No names on this group. Add them in your main app’s Family tab and send the wedding again.</p>';
    h += '<div class="btns">' + (st === 'done' ? '<button class="btn" data-famset="todo">Not photographed yet</button>' : '<button class="btn dark" data-famset="done">' + svg('check').replace('<svg', '<svg style="width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2"') + ' Photographed</button>' + (st === 'later' ? '<button class="btn link" data-famset="todo">Move back to To photograph</button>' : '<button class="btn link" data-famset="later">Come back to this group</button>')) + '</div>';
    return h;
  }
  function shotRow(x, n, S) {
    var dn = !!S.done[x.id], op = !!S.open[x.id], P = x.pics || [];
    return '<div class="li' + (dn ? ' done' : '') + '" style="align-items:flex-start"><button class="num" data-t="' + e(x.id) + '">' + (dn ? svg('check') : n) + '</button><button class="t" data-open="' + e(x.id) + '" style="border:0;background:none;text-align:left;padding:0"><b style="white-space:normal">' + (x.must ? '♥ ' : '') + e(x.text) + '</b>' + (x.say ? '<span class="say">' + e(x.say) + '</span>' : '') +
      (!op && P.length ? '<span class="thumbs">' + P.slice(0, 3).map(function (p) { return '<img src="' + p + '" alt="">'; }).join('') + '</span>' : '') +
      (op ? (x.how ? '<small style="white-space:normal;color:var(--ink);margin-top:6px">' + e(x.how) + '</small>' : '') + '<span class="bigimg">' + P.map(function (p) { return '<img src="' + p + '" alt="Inspiration">'; }).join('') + '</span>' : '') +
      ((P.length || x.how) ? '<small style="color:var(--accent);font-weight:600;margin-top:6px">' + (op ? 'Tap to close' : 'Tap for ' + (P.length ? 'photos' : 'how')) + '</small>' : '') + '</button></div>';
  }
  function vShots(D, S) {
    var cats = [], by = {};
    D.shots.forEach(function (x) { if (!by[x.cat]) { by[x.cat] = []; cats.push(x.cat); } by[x.cat].push(x); });
    var must = D.shots.filter(function (x) { return x.must; }), F = S.filter || 'all', done = D.shots.filter(function (x) { return S.done[x.id]; }).length, pct = D.shots.length ? Math.round(done / D.shots.length * 100) : 0;
    var h = '<h1 class="hello">Shot list</h1><input type="search" id="q" placeholder="Search shots, Say lines, family, timeline" value="' + e(UI.q || '') + '" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px 14px;font:inherit;background:var(--soft);color:var(--ink);margin:4px 0 12px"><div id="qres">' + (UI.q ? searchHtml(D, S, UI.q) : '') + '</div><div id="shotbody"' + (UI.q ? ' hidden' : '') + '><div class="progress"><span>' + done + ' of ' + D.shots.length + ' captured</span></div><div class="bar2"><i style="width:' + pct + '%"></i></div>' +
      '<div class="chips"><button data-flt="all" aria-pressed="' + (F === 'all') + '">Everything</button><button data-flt="must" aria-pressed="' + (F === 'must') + '">♥ Must-haves (' + must.length + ')</button>' + cats.map(function (c) { return '<button data-flt="' + e(c) + '" aria-pressed="' + (F === c) + '">' + e(c) + '</button>'; }).join('') + '</div>';
    if (F === 'must') return h + (must.length ? '<div class="list">' + must.map(function (x, i) { return shotRow(x, i + 1, S); }).join('') + '</div>' : '<p class="sub">No must-haves marked.</p>') + '</div>';
    (F === 'all' ? cats : [F]).forEach(function (c) { if (!by[c]) return; h += '<div class="h2" style="font-size:18px">' + e(c) + '</div><div class="list">' + by[c].map(function (x, i) { return shotRow(x, i + 1, S); }).join('') + '</div>'; });
    return h + '</div>';
  }

  function searchHtml(D, S, q) {
    q = String(q || '').trim().toLowerCase(); if (!q) return '';
    var has = function () { for (var i = 0; i < arguments.length; i++) if (String(arguments[i] || '').toLowerCase().indexOf(q) >= 0) return true; return false; };
    var sh = D.shots.filter(function (x) { return has(x.text, x.say, x.how, x.cat); }).slice(0, 40);
    var fm = D.fam.filter(function (x) { return has(x.text, x.who, (x.names || []).join(' ')); }).slice(0, 20);
    var tl = D.tl.map(function (b, i) { return { b: b, i: i }; }).filter(function (o) { return has(o.b.label, o.b.note); }).slice(0, 10);
    if (!sh.length && !fm.length && !tl.length) return '<p class="sub">Nothing found for “' + e(q) + '”.</p>';
    var h = '';
    if (fm.length) h += '<div class="h2" style="font-size:18px;margin-top:6px">Family photos</div><div class="list">' + fm.map(function (x) { return '<button class="li" data-gofam="' + e(x.id) + '"><span class="ico">' + svg('people') + '</span><span class="t wrap"><b>' + e(x.text) + '</b><small>' + e(x.who || '') + '</small></span><span class="chev">›</span></button>'; }).join('') + '</div>';
    if (sh.length) h += '<div class="h2" style="font-size:18px">Shots</div><div class="list">' + sh.map(function (x, i) { return shotRow(x, i + 1, S).replace('<b style="white-space:normal">', '<small>' + e(x.cat) + '</small><b style="white-space:normal">'); }).join('') + '</div>';
    if (tl.length) h += '<div class="h2" style="font-size:18px">Timeline</div><div class="list">' + tl.map(function (o) { return '<button class="li" data-wtab="now"><span class="ico">' + svg('clock') + '</span><span class="t wrap"><b>' + e(o.b.label) + '</b><small>' + f12(o.b.s) + '</small></span><span class="chev">›</span></button>'; }).join('') + '</div>';
    return h;
  }
  function vContacts(D) {
    var h = '<h1 class="hello">Contacts</h1><div style="height:12px"></div>';
    return h + (D.contacts.length ? D.contacts.map(function (c) {
      var t = String(c.phone || '').replace(/[^\d+]/g, '');
      return '<div class="card"><div class="sub">' + e(c.role) + '</div><div style="font-size:19px;font-weight:600">' + e(c.name || c.phone) + '</div>' + (t ? '<div class="row2" style="margin-top:12px"><a class="btn dark" href="tel:' + t + '">Call</a><a class="btn" href="sms:' + t + '">Text</a></div>' : '') + '</div>';
    }).join('') : '<p class="sub">No contacts on this wedding.</p>');
  }

  /* ---------- photo notes: quick photos saved with the wedding ---------- */
  function photosOf(wid) { return PHOTOS[wid] || []; }
  function loadPhotos(wid) { if (PHOTOS[wid]) return Promise.resolve(PHOTOS[wid]); return get('photos:' + wid).then(function (a) { PHOTOS[wid] = Array.isArray(a) ? a : []; return PHOTOS[wid]; }); }
  function savePhotos(wid) { return put('photos:' + wid, PHOTOS[wid] || []); }
  function shrink(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onerror = rej;
      r.onload = function () { var im = new Image(); im.onerror = rej; im.onload = function () { var mx = 1280, sc = Math.min(1, mx / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res({ data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height }); }; im.src = r.result; };
      r.readAsDataURL(file);
    });
  }
  function addPhoto() {
    var D = cur(); if (!D) return;
    var inp = document.getElementById('file'); inp.value = ''; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = function () {
      var fs = [].slice.call(inp.files || []); inp.accept = ''; inp.multiple = false; if (!fs.length) return;
      loadPhotos(D.id).then(function () { return Promise.all(fs.slice(0, 10).map(shrink)); }).then(function (list) {
        list.forEach(function (x) { PHOTOS[D.id].push({ id: 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), data: x.data, w: x.w, h: x.h, caption: '' }); });
        return savePhotos(D.id);
      }).then(function () { render(true); toast('Photo saved with this wedding'); }, function () { toast('Could not save that photo.'); });
    };
    inp.click();
  }
  function photosHtml(D) {
    var P = photosOf(D.id);
    return '<div class="h2" style="font-size:18px">Photo notes</div><p class="hint" style="margin-top:-4px">Seating chart, a name tag, a detail to remember. They go back to your main app with your notes.</p>' +
      '<button class="btn" data-act="addphoto">' + svg('camera') + ' Add a photo</button>' +
      (P.length ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">' + P.map(function (p) { return '<button data-photo="' + e(p.id) + '" style="border:0;padding:0;background:none;position:relative"><img src="' + p.data + '" alt="Photo note" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;display:block">' + (p.caption ? '<span style="position:absolute;left:4px;right:4px;bottom:4px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;border-radius:6px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e(p.caption) + '</span>' : '') + '</button>'; }).join('') + '</div>' : '');
  }
  function photoSheet(D, id) {
    var p = photosOf(D.id).filter(function (x) { return x.id === id; })[0]; if (!p) return '';
    return '<div class="sheet" data-sheetbg="1"><div><div style="display:flex;align-items:center;margin-bottom:10px"><h3 style="font-size:20px">Photo note</h3><button class="ib" data-photo="" aria-label="Close">' + svg('close') + '</button></div><img src="' + p.data + '" alt="Photo note" style="width:100%;border-radius:14px;display:block;margin-bottom:10px"><input type="text" id="cap" placeholder="Add a caption (optional)" value="' + e(p.caption || '') + '"><div class="row2" style="margin-top:10px"><button class="btn dark" data-capsave="' + e(p.id) + '">Save</button><button class="btn dg" data-photodel="' + e(p.id) + '">Delete</button></div></div></div>';
  }
  function vNotes(D, S) {
    return '<h1 class="hello">Notes</h1><p class="sub">They stay on this phone until you send them back from Sync.</p><div class="chips" style="flex-wrap:wrap;overflow:visible">' +
      ['Running late', 'Someone missing from family photos', 'Need more time for portraits', 'Rain plan in use', 'Great moment to blog'].map(function (t) { return '<button data-q="' + e(t) + '">' + e(t) + '</button>'; }).join('') +
      '</div><textarea id="nt" placeholder="Type a note">' + e(S.notes) + '</textarea>' + photosHtml(D) +
      '<div class="btns"><button class="btn" data-act="clear">Clear checkmarks for this wedding</button></div>' +
      '<p class="hint">Sent from your main app ' + e(D.made || MADE) + '. If the plan changed, send it again from the main app and load it here. Your checkmarks and notes are kept.</p>';
  }

  var DAY_BEFORE = ['Load this wedding on the phone (Sync)', 'Open the app once in airplane mode to test', 'Charge camera batteries', 'Charge flash batteries and spare AAs', 'Format memory cards', 'Charge phone and power bank', 'Check the weather and the rain plan', 'Check the sunset time', 'Confirm arrival time with the couple or coordinator', 'Save the addresses: tap Places and check each one', 'Pack snacks and water', 'Set out outfit and comfortable shoes', 'Fill up the gas tank'];
  var DEFAULT_GEAR = ['2 camera bodies', 'Lenses: 24-70, 85, 35, 70-200, macro', '2 flashes and diffusers', 'Batteries for everything, plus spares', 'Memory cards, formatted', 'Reflector', 'Ring box and flat lay props', 'Steamer and clips', 'Emergency kit: safety pins, tissues, stain pen', 'Business cards'];
  function prepCount(D, S) { var G = D.gear && D.gear.length ? D.gear : DEFAULT_GEAR, a = DAY_BEFORE.filter(function (x, i) { return S.prep['p' + i]; }).length, b = G.filter(function (x, i) { return S.gear['g' + i]; }).length; return { done: a + b, all: DAY_BEFORE.length + G.length }; }
  function vPrep(D, S) {
    var G = D.gear && D.gear.length ? D.gear : DEFAULT_GEAR, row = function (key, set, i, t) { var dn = !!S[set][key]; return '<button class="li' + (dn ? ' done' : '') + '" data-chk="' + set + ':' + key + '"><span class="num">' + (dn ? svg('check') : '') + '</span><span class="t wrap"><b style="font-weight:500">' + e(t) + '</b></span></button>'; };
    var a = DAY_BEFORE.filter(function (x, i) { return S.prep['p' + i]; }).length, b = G.filter(function (x, i) { return S.gear['g' + i]; }).length;
    return '<h1 class="hello">Packing & day before</h1><p class="sub">Checked off on this phone only.</p>' +
      '<div class="h2" style="font-size:18px">Day before · ' + a + ' of ' + DAY_BEFORE.length + '</div><div class="list">' + DAY_BEFORE.map(function (t, i) { return row('p' + i, 'prep', i, t); }).join('') + '</div>' +
      '<div class="h2" style="font-size:18px">Packing list · ' + b + ' of ' + G.length + '</div>' + (D.gear && D.gear.length ? '' : '<p class="hint">Your packing list from the main app shows here after you send this wedding again.</p>') + '<div class="list">' + G.map(function (t, i) { return row('g' + i, 'gear', i, t); }).join('') + '</div>' +
      '<div class="btns"><button class="btn link" data-act="prepclear">Uncheck all</button></div>';
  }
  function sheetHtml(D) {
    var items = [['big', 'clock', 'Big view & alerts', 'Now, next and minutes left'], ['where', 'pin', 'Places', 'Where to be & when, with Maps'], ['prep', 'list', 'Packing & day before', 'Gear and night-before checklist'], ['contacts', 'phone', 'Contacts', 'Call or text'], ['notes', 'note', 'Notes', 'Quick notes for later']];
    return '<div class="sheet" data-sheetbg="1"><div><div style="display:flex;align-items:center;margin-bottom:10px"><h3>Wedding tools</h3><button class="ib" data-sheet="0" aria-label="Close">' + svg('close') + '</button></div><div>' +
      items.map(function (x) { return '<button class="li" data-page="' + x[0] + '" style="padding:18px 0"><span class="ico">' + svg(x[1]) + '</span><span class="t"><b>' + x[2] + '</b><small>' + x[3] + '</small></span><span class="chev">›</span></button>'; }).join('') +
      '<button class="li" data-back="home" style="padding:18px 0"><span class="ico">' + svg('home') + '</span><span class="t"><b>Back to Home</b></span><span class="chev">›</span></button></div></div></div>';
  }

  function render(keep) {
    bars();
    var m = document.getElementById('m'), y = window.scrollY, D = cur(), h;
    if (!CODE) h = vSetup();
    else if (UI.view === 'wedding' && D) {
      var S = stOf(D.id);
      h = ({ overview: vOverview, now: vTimeline, where: vWhere, fam: vFam, shots: vShots, contacts: vContacts, notes: vNotes, big: vBig, prep: vPrep }[UI.tab] || vOverview)(D, S);
    } else {
      if (UI.view === 'wedding') UI.view = 'home';
      h = ({ home: vHome, weddings: vWeddings, sync: vSync, settings: vSettings }[UI.view] || vHome)();
    }
    m.innerHTML = h;
    document.getElementById('sh').innerHTML = UI.photo && D && UI.view === 'wedding' ? photoSheet(D, UI.photo) : (SHEET && D && UI.view === 'wedding' ? sheetHtml(D) : '');
    if (D && UI.view === 'wedding' && !PHOTOS[D.id]) loadPhotos(D.id).then(function (a) { if (a.length && (UI.tab === 'notes' || UI.tab === 'overview')) render(true); });
    var qi = document.getElementById('q');
    if (qi) qi.addEventListener('input', function () { UI.q = qi.value; var D2 = cur(); if (!D2) return; document.getElementById('qres').innerHTML = searchHtml(D2, stOf(D2.id), UI.q); document.getElementById('shotbody').hidden = !!String(UI.q).trim(); });
    var nt = document.getElementById('nt');
    if (nt) nt.addEventListener('input', function () { stOf(UI.wid).notes = nt.value; saveST(); });
    if (keep) window.scrollTo(0, y);
    else { var key = scrollKey(), sy = (UI.y && UI.y[key]) || 0; window.scrollTo(0, sy); setTimeout(function () { window.scrollTo(0, sy); }, 60); }
  }
  function scrollKey() { return UI.view === 'wedding' ? UI.wid + ':' + UI.tab + (UI.group ? ':g' : '') : UI.view; }
  function remember() { UI.y = UI.y || {}; UI.y[scrollKey()] = window.scrollY; }

  /* ---------- files in and out ---------- */
  function pickFile() {
    return new Promise(function (res) {
      var inp = document.getElementById('file'); inp.value = '';
      inp.onchange = function () { res(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  }
  function applyWeddingsText(t) {
    return unlock(t, CODE).then(function (r) {
      if (r.kind !== 'weddings' || !Array.isArray(r.data.weddings)) throw new Error('That file is not a weddings file from your main app.');
      var got = r.data.weddings, ids = got.map(function (x) { return x.id; }), PX = r.data.pics || null;
      if (PX) got.forEach(function (D) { (D.shots || []).forEach(function (x) { x.pics = (x.pics || []).map(function (k) { return k.charAt(0) === '#' ? (PX[k] || '') : k; }).filter(Boolean); }); });
      WEDS = WEDS.filter(function (x) { return ids.indexOf(x.id) < 0; }).concat(got); MADE = r.data.made || '';
      return Promise.all([put('weddings', WEDS), put('made', MADE)]).then(function () { return got.length; });
    });
  }
  function loadWeddings() {
    var inp = document.getElementById('file'); inp.value = ''; inp.multiple = true;
    new Promise(function (res) { inp.onchange = function () { inp.multiple = false; res([].slice.call(inp.files || [])); }; inp.click(); }).then(function (fs) {
      if (!fs.length) return;
      var n = 0; return fs.reduce(function (pr, f) { return pr.then(function () { return f.text().then(applyWeddingsText).then(function (k) { n += k; }); }); }, Promise.resolve()).then(function () { render(false); toast('\u2713 ' + n + ' wedding' + (n === 1 ? '' : 's') + ' saved on this phone'); });
    }).catch(function (err) { toast(err && err.message ? err.message : 'Could not open that file.'); });
  }
  function sendBack() {
    Promise.all(WEDS.map(function (D) { return loadPhotos(D.id); })).then(sendBack2);
  }
  function buildResults() {
    return Promise.all(WEDS.map(function (D) { return loadPhotos(D.id); })).then(function () {
    var out = { made: new Date().toLocaleString(), weddings: {} };
    WEDS.forEach(function (D) {
      var S = stOf(D.id), shots = {}, fam = {}, ph = photosOf(D.id);
      D.shots.forEach(function (x) { if (S.done[x.id]) shots[x.id] = true; });
      D.fam.forEach(function (x) { if (S.fam[x.id]) fam[x.id] = true; });
      if (Object.keys(shots).length || Object.keys(fam).length || String(S.notes || '').trim() || ph.length) out.weddings[D.id] = { couple: D.couple, shots: shots, fam: fam, notes: String(S.notes || ''), photos: ph };
    });
    if (!Object.keys(out.weddings).length) return null;
    return lock(out, CODE, 'results');
    });
  }
  function sendBack2() {
    buildResults().then(function (text) {
      if (!text) { toast('Nothing to send yet. Check off shots or add notes first.'); return; }
      var name = 'Wedding Day results ' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.gabiday';
      var file = new File([text], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Wedding Day results' }).then(function () { toast('Now open your main app and tap Load Day-of app results.'); }, function () {});
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('Saved. Now open your main app and tap Load Day-of app results.');
    });
  }

  /* ---------- Google Drive sync (both directions, one tap) ---------- */
  var CLIENT_ID = '973265022633-aadpqn0c7o6tjq5difdhngsvuj8ninhm.apps.googleusercontent.com';
  var SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
  var TOK = null, TOKEXP = 0, SYNCING = false;
  function gis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = function () { res(); }; sc.onerror = function () { rej(new Error('Could not reach Google. Check your signal and try again.')); }; document.head.appendChild(sc); });
  }
  function token() {
    if (TOK && Date.now() < TOKEXP - 60000) return Promise.resolve(TOK);
    return gis().then(function () {
      return new Promise(function (res, rej) {
        var tc = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: function (r) {
          if (r && r.access_token) { TOK = r.access_token; TOKEXP = Date.now() + (+r.expires_in || 3600) * 1000; res(TOK); }
          else rej(new Error('Google sign-in did not finish.'));
        }, error_callback: function (er) { rej(new Error(er && er.type === 'popup_closed' ? 'Sign-in was closed. Tap Sync again.' : 'Google sign-in did not finish. Tap Sync again.')); } });
        var picked = false; try { picked = sessionStorage.getItem('gabi-day-picked') === '1'; } catch (x) {}
        tc.requestAccessToken({ prompt: picked ? '' : 'select_account' }); try { sessionStorage.setItem('gabi-day-picked', '1'); } catch (x) {}
      });
    });
  }
  function gfetch(url, opt) {
    return token().then(function (t) { opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {}); return fetch(url, opt); })
      .then(function (r) {
        if (r.status === 401) { TOK = null; throw new Error('Google asked to sign in again. Tap Sync again.'); }
        if (!r.ok) return r.text().then(function (x) { throw new Error(/storageQuotaExceeded|quota/i.test(x) ? 'That Google Drive is full. Sign in with your other account.' : 'Google Drive said no (' + r.status + '). Try again.'); });
        return r;
      });
  }
  var API = 'https://www.googleapis.com/drive/v3/files';
  function listFiles(q) { return gfetch(API + '?q=' + encodeURIComponent(q + ' and trashed = false') + '&orderBy=modifiedTime%20desc&pageSize=50&spaces=drive&fields=files(id,name,modifiedTime)').then(function (r) { return r.json(); }).then(function (j) { return j.files || []; }); }
  function findFile(q) { return gfetch(API + '?q=' + encodeURIComponent(q + ' and trashed = false') + '&orderBy=modifiedTime%20desc&pageSize=1&spaces=drive&fields=files(id,name,modifiedTime)').then(function (r) { return r.json(); }).then(function (j) { return (j.files || [])[0] || null; }); }
  function syncNow() {
    if (SYNCING) return;
    if (!navigator.onLine) { toast('No signal right now. Sync when you have service.'); return; }
    SYNCING = true; render(true);
    var got = 0, sent = false;
    token().then(function () { return listFiles("name contains 'Gabi Wedding Day - to phone'"); }).then(function (fs) {
      if (!fs.length) return;
      var bOf = function (f) { var m = / - ([a-z0-9]+) - (\d+) of (\d+)\.txt$/.exec(f.name); return m ? { b: m[1], i: +m[2], n: +m[3] } : { b: f.id, i: 1, n: 1 }; };
      var top = bOf(fs[0]), parts = fs.filter(function (f) { return bOf(f).b === top.b; }).sort(function (a, b) { return bOf(a).i - bOf(b).i; });
      var seen = null; try { seen = localStorage.getItem('gabi-day-lastin'); } catch (x) {}
      if (seen === top.b + '@' + fs[0].modifiedTime) return;
      if (parts.length < top.n) throw new Error('Your main app is still sending (' + parts.length + ' of ' + top.n + '). Wait a minute and tap Sync again.');
      var texts = [];
      return parts.reduce(function (pr, f, k) { return pr.then(function () { var sb = document.querySelector('[data-act=sync]'); if (sb) sb.textContent = 'Downloading ' + (k + 1) + ' of ' + parts.length + '\u2026'; return gfetch(API + '/' + f.id + '?alt=media').then(function (r) { return r.text(); }).then(function (t) { texts.push(t); }); }); }, Promise.resolve())
        .then(function () { var joined = texts.join(''); try { JSON.parse(joined); } catch (x) { return texts.reduce(function (pr, t) { return pr.then(function () { return applyWeddingsText(t).then(function (n) { got += n; }); }); }, Promise.resolve()); } return applyWeddingsText(joined).then(function (n) { got += n; }); })
        .then(function () { try { localStorage.setItem('gabi-day-lastin', top.b + '@' + fs[0].modifiedTime); } catch (x) {} });
    }).then(buildResults).then(function (text) {
      if (!text) return;
      return findFile("name = 'Gabi Wedding Day - from phone.txt'").then(function (f) {
        if (f) return gfetch('https://www.googleapis.com/upload/drive/v3/files/' + f.id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: text });
        var bd = 'gabi' + Date.now(), body = '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: 'Gabi Wedding Day - from phone.txt', mimeType: 'text/plain' }) + '\r\n--' + bd + '\r\nContent-Type: text/plain\r\n\r\n' + text + '\r\n--' + bd + '--';
        return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bd }, body: body });
      }).then(function () { sent = true; });
    }).then(function () {
      try { localStorage.setItem('gabi-day-lastsync', String(Date.now())); } catch (x) {}
      SYNCING = false; render(false);
      toast('✓ Synced' + (got ? ' · ' + got + ' wedding' + (got === 1 ? '' : 's') + ' updated' : ' · weddings up to date') + (sent ? ' · checkmarks sent' : ''));
    }).catch(function (err) { SYNCING = false; render(true); toast(err && err.message ? err.message : 'Sync did not finish. Try again.'); });
  }
  function lastSync() { var t = 0; try { t = +localStorage.getItem('gabi-day-lastsync') || 0; } catch (x) {} return t ? new Date(t).toLocaleString() : 'never'; }
  function syncCard() {
    return '<div class="card"><div style="display:flex;align-items:center;gap:12px"><span class="ico">' + svg('sync') + '</span><div style="flex:1"><b style="font-size:18px">Sync with Google Drive</b><div class="sub">Last synced: ' + e(lastSync()) + '</div></div></div>' +
      '<p class="hint">Gets the weddings you sent from your main app, and sends your checkmarks, notes and photo notes back. When Google asks, pick the same account your main app uses (gaabibff).</p>' +
      '<button class="btn dark" data-act="sync"' + (SYNCING ? ' disabled' : '') + '>' + (SYNCING ? 'Syncing…' : 'Sync now') + '</button></div>';
  }

  /* ---------- keep the screen on ---------- */
  var WL = null;
  function wake(ask) {
    if (!('wakeLock' in navigator)) return;
    if (ask && WL) { WL.release(); WL = null; try { localStorage.setItem('gabi-day-wl', '0'); } catch (x) {} render(true); return; }
    navigator.wakeLock.request('screen').then(function (l) {
      WL = l; try { localStorage.setItem('gabi-day-wl', '1'); } catch (x) {}
      l.addEventListener('release', function () { WL = null; });
      if (ask) { toast('Screen stays on while the app is open'); render(true); }
    }, function () { if (ask) toast('This phone won’t allow it right now'); });
  }

  /* ---------- taps ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button,[data-sheetbg]'); if (!b) return;
    if (b.dataset.sheetbg && ev.target !== b) return;
    var D = cur(), S = D ? stOf(D.id) : null;
    if (b.dataset.sheetbg) { SHEET = false; UI.photo = null; render(true); return; }
    if (b.dataset.sheet != null) { SHEET = b.dataset.sheet === '1'; render(true); return; }
    if (b.dataset.view) { remember(); EDIT = false; UI.view = b.dataset.view; saveUI(); render(false); return; }
    if (b.dataset.back) {
      remember(); SHEET = false;
      if (b.dataset.back !== 'home' && UI.view === 'wedding' && UI.group) { UI.group = null; }
      else if (b.dataset.back !== 'home' && UI.view === 'wedding' && UI.tab === 'big') { UI.tab = 'now'; }
      else if (b.dataset.back !== 'home' && UI.view === 'wedding' && ['where', 'contacts', 'notes', 'prep'].indexOf(UI.tab) >= 0) { UI.tab = 'overview'; }
      else { UI.view = 'home'; UI.chose = weddingDay(); }
      saveUI(); saveST(); render(false); return;
    }
    if (b.dataset.wid) { remember(); EDIT = false; UI.view = 'wedding'; UI.wid = b.dataset.wid; UI.tab = 'overview'; UI.group = null; saveUI(); render(false); return; }
    if (b.dataset.wtab) { remember(); SHEET = false; if (b.dataset.wtab === 'more') { SHEET = true; render(true); return; } UI.tab = b.dataset.wtab; UI.group = null; saveUI(); render(false); return; }
    if (b.dataset.page) { remember(); SHEET = false; UI.tab = b.dataset.page; UI.group = null; saveUI(); render(false); return; }
    if (S && b.dataset.seg) { UI.famSeg = b.dataset.seg; saveUI(); render(true); return; }
    if (S && b.dataset.group != null) { remember(); UI.group = b.dataset.group || null; saveUI(); render(false); return; }
    if (b.dataset.photo != null) { UI.photo = b.dataset.photo || null; render(true); return; }
    if (D && b.dataset.capsave) { var pc = photosOf(D.id).filter(function (x) { return x.id === b.dataset.capsave; })[0]; if (pc) { pc.caption = (document.getElementById('cap').value || '').trim(); savePhotos(D.id); } UI.photo = null; render(true); toast('Saved'); return; }
    if (D && b.dataset.photodel) { if (confirm('Delete this photo from your phone app?')) { PHOTOS[D.id] = photosOf(D.id).filter(function (x) { return x.id !== b.dataset.photodel; }); savePhotos(D.id); UI.photo = null; render(true); } return; }
    if (S && b.dataset.miss && UI.group) { var gm = S.miss[UI.group] = S.miss[UI.group] || {}; gm[b.dataset.miss] = !gm[b.dataset.miss]; saveST(); render(true); return; }
    if (S && b.dataset.famset) {
      var id = UI.group, v = b.dataset.famset; if (!id) return;
      S.fam[id] = v === 'done'; S.later[id] = v === 'later'; saveST();
      if (v === 'done' || v === 'later') {
        var nx = D.fam.filter(function (x) { return x.id !== id && famState(S, x) === 'todo'; })[0];
        UI.group = nx ? nx.id : null; toast(v === 'done' ? (nx ? '✓ Done. Next: ' + nx.text : '✓ All family groups done') : 'Moved to Later');
      }
      saveUI(); render(false); return;
    }
    if (S && b.dataset.late != null) {
      var add = +b.dataset.late;
      if (!add) { S.shift = 0; S.shiftFrom = 0; toast('Back on time'); }
      else { if (!S.shift) { var ci = curIdx(D); S.shiftFrom = ci >= 0 ? ci : Math.max(0, D.tl.findIndex(function (x, i) { return !S.done['t' + i]; })); } S.shift = (S.shift || 0) + add; toast('Running ' + S.shift + ' min late. New times are shown.'); }
      saveST(); render(true); return;
    }
    if (b.dataset.alert != null) { ALERT = +b.dataset.alert; try { localStorage.setItem('gabi-day-alert', String(ALERT)); } catch (x) {} beepInit(); toast(ALERT ? 'You’ll get an alert ' + ALERT + ' min before each moment while the app is open' : 'Alerts off'); render(true); return; }
    if (b.dataset.chk) { var pr = b.dataset.chk.split(':'), D3 = cur(); if (!D3) return; var S3 = stOf(D3.id); S3[pr[0]][pr[1]] = !S3[pr[0]][pr[1]]; saveST(); render(true); return; }
    if (b.dataset.prepfor) { remember(); UI.view = 'wedding'; UI.wid = b.dataset.prepfor; UI.tab = 'prep'; UI.group = null; saveUI(); render(false); return; }
    if (S && b.dataset.gofam) { remember(); UI.tab = 'fam'; UI.group = b.dataset.gofam; UI.q = ''; saveUI(); render(false); return; }
    if (S && b.dataset.t) { S.done[b.dataset.t] = !S.done[b.dataset.t]; saveST(); render(true); return; }
    if (S && b.dataset.open) { S.open[b.dataset.open] = !S.open[b.dataset.open]; saveST(); render(true); return; }
    if (S && b.dataset.flt) { S.filter = b.dataset.flt; saveST(); render(false); return; }
    if (S && b.dataset.q) { var d = new Date(); S.notes = (S.notes ? S.notes + '\n' : '') + f12(d.getHours() * 60 + d.getMinutes()) + ' ' + b.dataset.q; saveST(); render(true); toast('Added'); return; }
    if (b.dataset.rm) {
      var R = WEDS.filter(function (x) { return x.id === b.dataset.rm; })[0]; if (R) del('photos:' + R.id);
      if (R && confirm('Remove ' + R.couple + ' from this phone? Send your checkmarks back first if you need them. Your main app keeps the wedding.')) {
        WEDS = WEDS.filter(function (x) { return x !== R; }); delete ST[R.id]; if (UI.wid === R.id) { UI.wid = null; }
        Promise.all([put('weddings', WEDS), put('state', ST)]).then(function () { render(true); toast('Removed from this phone'); });
      }
      return;
    }
    var act = b.dataset.act;
    if (act === 'savecode') {
      var c = normCode(document.getElementById('code').value);
      if (c.length < 12) { toast('That code looks too short. Copy it again from your main app.'); return; }
      CODE = c; put('code', c).then(function () { UI.view = 'home'; render(false); toast('Paired. Now load your weddings.'); }); return;
    }
    if (act === 'edit') { EDIT = !EDIT; render(true); return; }
    if (act === 'changecode') { if (confirm('Change the pairing code? Your weddings stay on this phone.')) { CODE = null; del('code'); render(false); } return; }
    if (act === 'wipe') { if (confirm('Remove all weddings, checkmarks and notes from this phone? Your main app keeps everything.')) { WEDS = []; ST = {}; MADE = ''; UI = { view: 'home', wid: null, tab: 'overview', page: '', group: null, famSeg: 'todo' }; saveUI(); Promise.all([del('weddings'), del('state'), del('made')]).then(function () { render(false); toast('Removed from this phone'); }); } return; }
    if (act === 'sync') { syncNow(); return; }
    if (act === 'addphoto') { addPhoto(); return; }
    if (act === 'notify') { try { Notification.requestPermission().then(function () { render(true); }); } catch (x) {} return; }
    if (act === 'prepclear' && S) { if (confirm('Uncheck the packing and day-before lists for this wedding?')) { S.gear = {}; S.prep = {}; saveST(); render(true); } return; }
    if (act === 'load') { loadWeddings(); return; }
    if (act === 'sendback') { sendBack(); return; }
    if (act === 'wake') { wake(true); return; }
    if (act === 'clear' && S) { if (confirm('Clear all checkmarks for this wedding? Your notes stay.')) { S.done = {}; S.fam = {}; S.later = {}; S.shift = 0; saveST(); render(true); toast('Cleared'); } return; }
  });

  /* remember where you were, and refresh the clock without jumping the page */
  var sT = null, lastTouch = 0;
  window.addEventListener('scroll', function () { clearTimeout(sT); sT = setTimeout(function () { remember(); saveUI(); }, 250); }, { passive: true });
  ['touchstart', 'pointerdown', 'scroll', 'keydown'].forEach(function (n) { window.addEventListener(n, function () { lastTouch = Date.now(); }, { passive: true, capture: true }); });
  setInterval(function () {
    var c = document.getElementById('clock'); if (c) c.textContent = clockNow();
    var D = cur(); if (UI.view === 'wedding' && UI.tab === 'big' && D && !SHEET && !document.hidden) render(true); else if (UI.view === 'wedding' && (UI.tab === 'now' || UI.tab === 'overview') && D && isToday(D) && !SHEET && Date.now() - lastTouch > 15000 && !document.hidden) render(true);
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { try { if (localStorage.getItem('gabi-day-wl') === '1') wake(false); } catch (x) {} var c = document.getElementById('clock'); if (c) c.textContent = clockNow(); }
    else { remember(); saveUI(); saveST(); }
  });


  /* ---------- alerts a few minutes before each moment (while the app is open) ---------- */
  function beepInit() { try { if (!BEEP) BEEP = new (window.AudioContext || window.webkitAudioContext)(); if (BEEP.state === 'suspended') BEEP.resume(); } catch (x) {} }
  function beep() { try { beepInit(); if (!BEEP) return; [0, 0.28].forEach(function (t) { var o = BEEP.createOscillator(), g = BEEP.createGain(); o.frequency.value = 880; o.connect(g); g.connect(BEEP.destination); g.gain.setValueAtTime(0.0001, BEEP.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, BEEP.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, BEEP.currentTime + t + 0.22); o.start(BEEP.currentTime + t); o.stop(BEEP.currentTime + t + 0.25); }); } catch (x) {} }
  function banner(t) {
    var old = document.getElementById('alertban'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'alertban'; d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 10px);z-index:40;background:var(--dark);color:var(--bg);border-radius:16px;padding:14px 16px;display:flex;gap:12px;align-items:center;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25)';
    d.innerHTML = '<span style="flex:1">' + e(t) + '</span><button style="border:0;background:var(--bg);color:var(--ink);border-radius:10px;padding:8px 14px;font-weight:700">OK</button>';
    d.querySelector('button').onclick = function () { d.remove(); };
    document.body.appendChild(d); setTimeout(function () { if (d.parentNode) d.remove(); }, 60000);
  }
  function checkAlerts() {
    if (!ALERT) return;
    WEDS.forEach(function (D) {
      if (!isToday(D)) return; var S = stOf(D.id), T = sched(D, S).t, m = nowMin(D);
      D.tl.forEach(function (b, i) {
        var t = T[i].s, key = i + '@' + t; if (S.alerted[key] || S.done['t' + i]) return;
        if (m >= t - ALERT && m < t) {
          S.alerted[key] = 1; saveST();
          var msg = 'In ' + (t - m) + ' min: ' + b.label + ' (' + f12(t) + ')';
          banner(msg); beep(); try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (x) {}
          try { if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.ready.then(function (r) { r.showNotification(D.couple, { body: msg, tag: 'gabi-' + key, icon: 'icons/icon-192.png' }); }); } catch (x) {}
        }
      });
    });
  }
  setInterval(checkAlerts, 20000);
  document.addEventListener('pointerdown', beepInit, { once: true, capture: true });

  /* ---------- start ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {}
  Promise.all([get('code'), get('weddings'), get('made'), get('state')]).then(function (r) {
    CODE = r[0] || null; WEDS = Array.isArray(r[1]) ? r[1] : []; MADE = r[2] || ''; ST = r[3] || {};
    if (UI.view === 'wedding' && !cur()) { UI.view = 'home'; UI.wid = null; }
    if (UI.view !== 'wedding') { var t = WEDS.filter(function (D) { return isToday(D); })[0]; if (t && UI.chose !== weddingDay()) { UI.view = 'wedding'; UI.wid = t.id; UI.tab = 'overview'; } }
    render(false); checkAlerts();
    try { if (localStorage.getItem('gabi-day-wl') === '1') wake(false); } catch (x) {}
  });
})();
