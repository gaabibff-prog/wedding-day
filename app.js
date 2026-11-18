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
  var CODE = null, WEDS = [], MADE = '', ST = {}, UI = { view: 'home', wid: null, tab: 'now' };
  try { var u0 = JSON.parse(localStorage.getItem('gabi-day-ui') || 'null'); if (u0) UI = u0; } catch (e) {}
  function saveUI() { try { localStorage.setItem('gabi-day-ui', JSON.stringify(UI)); } catch (e) {} }
  function stOf(wid) { if (!ST[wid]) ST[wid] = { done: {}, fam: {}, open: {}, notes: '', filter: 'all', y: {} }; return ST[wid]; }
  var saveT = null;
  function saveST() { clearTimeout(saveT); saveT = setTimeout(function () { put('state', ST); }, 150); }

  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f12(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function dayIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function weddingDay() { var d = new Date(); if (d.getHours() < 6) d.setDate(d.getDate() - 1); return dayIso(d); }
  function isToday(D) { return D.date === weddingDay(); }
  function nowMin(D) { var d = new Date(), m = d.getHours() * 60 + d.getMinutes(), t = D.tl; if (!t.length) return m; var mid = (t[0].s + t[t.length - 1].s) / 2; while (m < mid - 720) m += 1440; while (m > mid + 720) m -= 1440; return m; }
  function cur() { for (var i = 0; i < WEDS.length; i++) if (WEDS[i].id === UI.wid) return WEDS[i]; return null; }
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2400); }

  /* ---------- screens ---------- */
  var TABS = [['now', 'Timeline'], ['where', '📍 Places'], ['fam', 'Family'], ['shots', 'Shots'], ['contacts', 'Contacts'], ['notes', 'Notes']];
  function clockNow() { var d = new Date(); return f12(d.getHours() * 60 + d.getMinutes()); }

  function header() {
    var h = document.getElementById('hd'), D = cur();
    if (UI.view === 'wedding' && D) {
      h.innerHTML = '<div class="top"><button class="back" data-go="home">‹ Weddings</button><span class="clock" id="clock">' + clockNow() + '</span></div>' +
        '<div class="top"><h1>' + e(D.couple) + '</h1></div><p class="sub">' + e([D.dateLabel, D.coverage, D.venue].filter(Boolean).join(' · ')) + '</p>' +
        '<nav>' + TABS.map(function (t) { return '<button type="button" data-tab="' + t[0] + '"' + (UI.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('') + '</nav>';
    } else {
      h.innerHTML = '<div class="top"><h1>Wedding Day</h1><span class="clock" id="clock">' + clockNow() + '</span></div><p class="sub">Gabi Vacc Photography · works with no signal</p>';
    }
  }

  function vSetup() {
    return '<div class="card"><h2 style="margin-top:0">Welcome! Pair this phone once</h2>' +
      '<p class="hint">In your main app inside Claude, go to <b>Settings → Day-of app</b> and copy your pairing code. Paste it here. It locks your wedding files so only your app can open them.</p>' +
      '<input type="text" id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">' +
      '<div class="btns"><button class="btn ok full" data-act="savecode">Save pairing code</button></div></div>' +
      installHint();
  }

  function installHint() {
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (standalone) return '';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return '<div class="card"><b>Add it to your home screen</b><p class="hint" style="margin:6px 0 0">' +
      (ios ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>.' : 'In Chrome, tap the ⋮ menu, then <b>Install app</b> or <b>Add to Home screen</b>.') +
      ' Then open it from the icon. It opens with no signal and stays where you left it.</p></div>';
  }

  function vHome() {
    var h = '', list = WEDS.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var today = weddingDay();
    if (!list.length) h += '<div class="card"><b>No weddings on this phone yet</b><p class="hint" style="margin:6px 0 0">In your main app, tap <b>📲 Send to my Day-of app</b>. Save the file, then tap <b>Load weddings</b> below and pick it.</p></div>';
    var up = list.filter(function (D) { return D.date >= today; }), past = list.filter(function (D) { return D.date < today; }).reverse();
    function card(D) {
      var s = stOf(D.id), n = Object.keys(s.done).filter(function (k) { return s.done[k] && k.charAt(0) !== 't'; }).length + Object.keys(s.fam).filter(function (k) { return s.fam[k]; }).length;
      return '<div style="position:relative"><button class="card wed" data-wid="' + e(D.id) + '" style="padding-right:84px"><b>' + e(D.couple) + '</b>' + (D.date === today ? '<span class="badge">Today</span>' : '') +
        '<div class="hint">' + e(D.dateLabel) + (D.venue ? ' \u00b7 ' + e(D.venue) : '') + '</div>' +
        '<div class="hint">' + D.shots.length + ' shots \u00b7 ' + D.fam.length + ' family groups' + (n ? ' \u00b7 ' + n + ' checked' : '') + '</div></button>' +
        '<button class="btn dg" data-rm="' + e(D.id) + '" style="position:absolute;right:10px;top:12px;min-height:38px;padding:0 10px;font-size:14px">Remove</button></div>';
    }
    up.forEach(function (D) { h += card(D); });
    if (past.length) h += '<h2>Past weddings</h2>' + past.map(card).join('');
    h += '<div class="btns"><button class="btn ok full" data-act="load">Load weddings from my main app</button></div>';
    if (MADE) h += '<p class="hint">Last loaded: weddings sent ' + e(MADE) + '.</p>';
    if (list.length) h += '<div class="btns"><button class="btn full" data-act="sendback">Send checkmarks & notes back to my main app</button></div>';
    h += installHint();
    h += '<details class="card" style="margin-top:16px"><summary><b>Settings</b></summary>' +
      '<p class="hint">Everything is stored only on this phone.</p>' +
      '<div class="btns"><button class="btn" data-act="changecode">Change pairing code</button><button class="btn dg" data-act="wipe">Remove all weddings from this phone</button></div></details>';
    return h;
  }

  function curIdx(D) { if (!isToday(D)) return -1; var m = nowMin(D), c = -1; D.tl.forEach(function (b, i) { if (m >= b.s && m < b.s + Math.max(b.d, 1)) c = i; }); if (c < 0) D.tl.forEach(function (b, i) { if (c < 0 && b.s > m) c = i; }); return c; }

  function vTimeline(D, S) {
    var c = curIdx(D), h = '';
    if (!isToday(D)) h += '<p class="hint">Planned times. On the wedding day the current moment is highlighted.</p>';
    else if (c >= 0) { var b = D.tl[c]; h += '<div class="card"><span class="k">Now / next</span><b style="display:block;font-size:18px;margin-top:2px">' + e(b.label) + '</b><span class="hint">' + f12(b.s) + ' to ' + f12(b.s + b.d) + (D.tl[c + 1] ? ' · then ' + e(D.tl[c + 1].label) + ' at ' + f12(D.tl[c + 1].s) : '') + '</span>' + (b.note ? '<p class="hint" style="margin:6px 0 0">' + e(b.note) + '</p>' : '') + '</div>'; }
    h += D.tl.map(function (b, i) {
      var dn = !!S.done['t' + i];
      return '<div class="row' + (dn ? ' done' : '') + (i === c ? ' now' : '') + '"><button type="button" class="chk" data-t="t' + i + '" aria-label="Mark done">' + (dn ? '✓' : '') + '</button><span class="time">' + f12(b.s) + '</span><button type="button" class="tx" data-open="t' + i + '"><b>' + e(b.label) + (b.cer ? ' ♥' : '') + '</b>' + (S.open['t' + i] && b.note ? '<small>' + e(b.note) + '</small>' : (b.note ? '<small>Tap for notes</small>' : '')) + '</button></div>';
    }).join('');
    return h;
  }
  function vWhere(D) {
    if (!D.stops.length) return '<p class="hint">No places yet.</p>';
    return D.stops.map(function (x, i) {
      var prev = i ? D.stops[i - 1].addr : '';
      return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + (i + 1) + '. ' + e(x.name) + '</b><b>' + f12(x.start) + '</b></div><div style="margin:4px 0">' + (x.addr ? e(x.addr) : '<span class="hint">No address</span>') + '</div><div class="hint">Be there by <b>' + f12(x.start) + '</b> for ' + e(x.first) + ' · until ' + f12(x.end) + (i < D.stops.length - 1 && x.drive ? ' · leave ' + f12(x.leave) + ' (' + x.drive + ' min drive)' : '') + '</div>' +
        (x.addr ? '<div class="btns"><a class="btn ok" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.addr) + '">Open in Maps</a>' + (prev ? '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(prev) + '&destination=' + encodeURIComponent(x.addr) + '&travelmode=driving">Directions</a>' : '') + '</div>' : '') + '</div>';
    }).join('');
  }
  function vFam(D, S) {
    if (!D.fam.length) return '<p class="hint">No family photos on this list.</p>';
    var nxt = -1; D.fam.forEach(function (x, i) { if (nxt < 0 && !S.fam[x.id]) nxt = i; });
    var h = '';
    if (nxt >= 0) { var x = D.fam[nxt]; h += '<div class="card" style="border-color:var(--brass)"><span class="k">Calling now · ' + (nxt + 1) + ' of ' + D.fam.length + '</span><b style="display:block;font-size:18px;margin-top:2px">' + e(x.text) + '</b>' + (x.who ? '<p style="margin:4px 0">' + e(x.who) + '</p>' : '') + (x.rel ? '<p class="hint" style="margin:4px 0">↳ ' + e(x.rel) + '</p>' : '') + '<div class="btns"><button type="button" class="btn ok" data-f="' + e(x.id) + '">✓ Done, next group</button></div></div>'; }
    else h += '<div class="card"><b>All family photos are done.</b><p class="hint" style="margin:4px 0 0">Thank everyone and send them to cocktail hour.</p></div>';
    h += D.fam.map(function (x, i) { var dn = !!S.fam[x.id]; return '<div class="row' + (dn ? ' done' : '') + '"><button type="button" class="chk" data-f="' + e(x.id) + '">' + (dn ? '✓' : (i + 1)) + '</button><div class="tx"><b>' + e(x.text) + '</b>' + (x.who ? '<small>' + e(x.who) + '</small>' : '') + '</div></div>'; }).join('');
    return h;
  }
  function shotRow(x, n, S) {
    var dn = !!S.done[x.id], op = !!S.open[x.id], P = x.pics || [];
    return '<div class="row' + (dn ? ' done' : '') + '"><button type="button" class="chk" data-t="' + e(x.id) + '">' + (dn ? '✓' : n) + '</button><button type="button" class="tx" data-open="' + e(x.id) + '"><b>' + (x.must ? '♥ ' : '') + e(x.text) + '</b>' + (x.say ? '<span class="say">' + e(x.say) + '</span>' : '') +
      (!op && P.length ? '<span class="thumbs">' + P.slice(0, 3).map(function (p) { return '<img src="' + p + '" alt="">'; }).join('') + '</span>' : '') +
      (op ? (x.how ? '<small style="color:var(--ink)">' + e(x.how) + '</small>' : '') + '<span class="big">' + P.map(function (p) { return '<img src="' + p + '" alt="Inspiration">'; }).join('') + '</span>' : '') +
      ((P.length || x.how) ? '<small style="color:var(--brass);font-weight:600">' + (op ? 'Tap to close' : 'Tap for ' + (P.length ? 'photos' : 'how')) + '</small>' : '') + '</button></div>';
  }
  function vShots(D, S) {
    var cats = [], by = {};
    D.shots.forEach(function (x) { if (!by[x.cat]) { by[x.cat] = []; cats.push(x.cat); } by[x.cat].push(x); });
    var must = D.shots.filter(function (x) { return x.must; }), F = S.filter || 'all';
    var h = '<div class="chips"><button type="button" data-flt="all" aria-pressed="' + (F === 'all') + '">Everything</button><button type="button" data-flt="must" aria-pressed="' + (F === 'must') + '">♥ Must-haves (' + must.length + ')</button>' + cats.map(function (c) { return '<button type="button" data-flt="' + e(c) + '" aria-pressed="' + (F === c) + '">' + e(c) + '</button>'; }).join('') + '</div>';
    if (F === 'must') return h + (must.length ? must.map(function (x, i) { return shotRow(x, i + 1, S); }).join('') : '<p class="hint">No must-haves marked.</p>');
    (F === 'all' ? cats : [F]).forEach(function (c) { if (!by[c]) return; h += '<h2>' + e(c) + '</h2>' + by[c].map(function (x, i) { return shotRow(x, i + 1, S); }).join(''); });
    return h;
  }
  function vContacts(D) {
    return D.contacts.length ? D.contacts.map(function (c) {
      var t = String(c.phone || '').replace(/[^\d+]/g, '');
      return '<div class="card"><span class="k">' + e(c.role) + '</span><b style="display:block">' + e(c.name || c.phone) + '</b>' + (t ? '<div class="btns"><a class="btn ok" href="tel:' + t + '">Call</a><a class="btn" href="sms:' + t + '">Text</a></div>' : '') + '</div>';
    }).join('') : '<p class="hint">No contacts on this wedding.</p>';
  }
  function vNotes(D, S) {
    return '<p class="hint">Notes stay on this phone until you tap <b>Send checkmarks & notes back</b> on the Weddings screen.</p><div class="btns" style="margin:0 0 10px">' +
      ['Running late', 'Someone missing from family photos', 'Need more time for portraits', 'Rain plan in use', 'Great moment to blog'].map(function (t) { return '<button type="button" class="btn" data-q="' + e(t) + '">' + e(t) + '</button>'; }).join('') +
      '</div><textarea id="nt" placeholder="Type a note">' + e(S.notes) + '</textarea>' +
      '<div class="btns"><button type="button" class="btn" data-act="wake" id="wl"' + ('wakeLock' in navigator ? '' : ' hidden') + '>' + (WL ? 'Screen stays on ✓' : 'Keep screen on') + '</button><button type="button" class="btn" data-act="clear">Clear checkmarks for this wedding</button></div>' +
      '<p class="hint" style="margin-top:14px">Sent from your main app ' + e(D.made || MADE) + '. If the plan changed, send it again from the main app and load it here. Your checkmarks and notes are kept.</p>';
  }

  function render(keep) {
    header();
    var m = document.getElementById('m'), y = window.scrollY, D = cur(), h;
    if (!CODE) h = vSetup();
    else if (UI.view === 'wedding' && D) {
      var S = stOf(D.id);
      h = ({ now: vTimeline, where: vWhere, fam: vFam, shots: vShots, contacts: vContacts, notes: vNotes }[UI.tab] || vTimeline)(D, S);
    } else { UI.view = 'home'; h = vHome(); }
    m.innerHTML = h;
    var nt = document.getElementById('nt');
    if (nt) nt.addEventListener('input', function () { stOf(UI.wid).notes = nt.value; saveST(); });
    if (keep) window.scrollTo(0, y);
    else { var sy = UI.view === 'wedding' && D ? (stOf(D.id).y[UI.tab] || 0) : (UI.homeY || 0); window.scrollTo(0, sy); setTimeout(function () { window.scrollTo(0, sy); }, 60); }
  }

  /* ---------- files in and out ---------- */
  function pickFile() {
    return new Promise(function (res) {
      var inp = document.getElementById('file'); inp.value = '';
      inp.onchange = function () { res(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  }
  function loadWeddings() {
    pickFile().then(function (f) {
      if (!f) return;
      return f.text().then(function (t) { return unlock(t, CODE); }).then(function (r) {
        if (r.kind !== 'weddings' || !Array.isArray(r.data.weddings)) throw new Error('That file is not a weddings file from your main app.');
        var got = r.data.weddings, ids = got.map(function (x) { return x.id; });
        WEDS = WEDS.filter(function (x) { return ids.indexOf(x.id) < 0; }).concat(got); MADE = r.data.made || '';
        return Promise.all([put('weddings', WEDS), put('made', MADE)]).then(function () {
          if (UI.wid && !cur()) { UI.view = 'home'; UI.wid = null; saveUI(); }
          render(false); toast('✓ ' + got.length + ' wedding' + (got.length === 1 ? '' : 's') + ' saved on this phone');
        });
      });
    }).catch(function (err) { toast(err && err.message ? err.message : 'Could not open that file.'); });
  }
  function sendBack() {
    var out = { made: new Date().toLocaleString(), weddings: {} };
    WEDS.forEach(function (D) {
      var S = stOf(D.id), shots = {}, fam = {};
      D.shots.forEach(function (x) { if (S.done[x.id]) shots[x.id] = true; });
      D.fam.forEach(function (x) { if (S.fam[x.id]) fam[x.id] = true; });
      if (Object.keys(shots).length || Object.keys(fam).length || String(S.notes || '').trim()) out.weddings[D.id] = { couple: D.couple, shots: shots, fam: fam, notes: String(S.notes || '') };
    });
    if (!Object.keys(out.weddings).length) { toast('Nothing to send yet. Check off shots or add notes first.'); return; }
    lock(out, CODE, 'results').then(function (text) {
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

  /* ---------- keep the screen on ---------- */
  var WL = null;
  function wake(ask) {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) {
      WL = l; try { localStorage.setItem('gabi-day-wl', '1'); } catch (x) {}
      l.addEventListener('release', function () { WL = null; });
      if (ask) { toast('Screen stays on while the app is open'); render(true); }
    }, function () { if (ask) toast('This phone won’t allow it right now'); });
  }

  /* ---------- taps ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var D = cur(), S = D ? stOf(D.id) : null;
    if (b.dataset.go === 'home') { if (D) S.y[UI.tab] = window.scrollY; UI.view = 'home'; UI.chose = weddingDay(); saveUI(); saveST(); render(false); return; }
    if (b.dataset.wid) { UI.homeY = window.scrollY; UI.view = 'wedding'; UI.wid = b.dataset.wid; if (!UI.tab) UI.tab = 'now'; saveUI(); render(false); return; }
    if (b.dataset.tab) { if (S) S.y[UI.tab] = window.scrollY; UI.tab = b.dataset.tab; saveUI(); saveST(); render(false); return; }
    if (S && b.dataset.t) { S.done[b.dataset.t] = !S.done[b.dataset.t]; saveST(); render(true); return; }
    if (S && b.dataset.f) { S.fam[b.dataset.f] = !S.fam[b.dataset.f]; saveST(); render(true); return; }
    if (S && b.dataset.open) { S.open[b.dataset.open] = !S.open[b.dataset.open]; saveST(); render(true); return; }
    if (S && b.dataset.flt) { S.filter = b.dataset.flt; saveST(); render(false); return; }
    if (S && b.dataset.q) { var d = new Date(); S.notes = (S.notes ? S.notes + '\n' : '') + f12(d.getHours() * 60 + d.getMinutes()) + ' ' + b.dataset.q; saveST(); render(true); toast('Added'); return; }
    if (b.dataset.rm) {
      var R = WEDS.filter(function (x) { return x.id === b.dataset.rm; })[0];
      if (R && confirm('Remove ' + R.couple + ' from this phone? Send your checkmarks back first if you need them. Your main app keeps the wedding.')) {
        WEDS = WEDS.filter(function (x) { return x !== R; }); delete ST[R.id]; if (UI.wid === R.id) { UI.wid = null; UI.view = 'home'; saveUI(); }
        Promise.all([put('weddings', WEDS), put('state', ST)]).then(function () { render(true); toast('Removed from this phone'); });
      }
      return;
    }
    var act = b.dataset.act;
    if (act === 'savecode') {
      var c = normCode(document.getElementById('code').value);
      if (c.length < 12) { toast('That code looks too short. Copy it again from your main app.'); return; }
      CODE = c; put('code', c).then(function () { render(false); toast('Paired. Now load your weddings.'); }); return;
    }
    if (act === 'changecode') { if (confirm('Change the pairing code? Your weddings stay on this phone.')) { CODE = null; del('code'); render(false); } return; }
    if (act === 'wipe') { if (confirm('Remove all weddings, checkmarks and notes from this phone? Your main app keeps everything.')) { WEDS = []; ST = {}; MADE = ''; UI = { view: 'home', wid: null, tab: 'now' }; saveUI(); Promise.all([del('weddings'), del('state'), del('made')]).then(function () { render(false); toast('Removed from this phone'); }); } return; }
    if (act === 'load') { loadWeddings(); return; }
    if (act === 'sendback') { sendBack(); return; }
    if (act === 'wake') { wake(true); return; }
    if (act === 'clear' && S) { if (confirm('Clear all checkmarks for this wedding? Your notes stay.')) { S.done = {}; S.fam = {}; saveST(); render(true); toast('Cleared'); } return; }
  });

  /* remember where you were, and refresh the clock without jumping the page */
  var sT = null, lastTouch = 0;
  window.addEventListener('scroll', function () {
    clearTimeout(sT);
    sT = setTimeout(function () { var D = cur(); if (UI.view === 'wedding' && D) { stOf(D.id).y[UI.tab] = window.scrollY; saveST(); } else { UI.homeY = window.scrollY; saveUI(); } }, 250);
  }, { passive: true });
  ['touchstart', 'pointerdown', 'scroll', 'keydown'].forEach(function (n) { window.addEventListener(n, function () { lastTouch = Date.now(); }, { passive: true, capture: true }); });
  setInterval(function () {
    var c = document.getElementById('clock'); if (c) c.textContent = clockNow();
    var D = cur(); if (UI.view === 'wedding' && UI.tab === 'now' && D && isToday(D) && Date.now() - lastTouch > 15000 && !document.hidden) render(true);
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { try { if (localStorage.getItem('gabi-day-wl') === '1') wake(false); } catch (x) {} var c = document.getElementById('clock'); if (c) c.textContent = clockNow(); }
    else saveST();
  });

  /* ---------- start ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {}
  Promise.all([get('code'), get('weddings'), get('made'), get('state')]).then(function (r) {
    CODE = r[0] || null; WEDS = Array.isArray(r[1]) ? r[1] : []; MADE = r[2] || ''; ST = r[3] || {};
    if (!cur()) { UI.view = 'home'; UI.wid = null; }
    if (UI.view === 'home') { var t = WEDS.filter(function (D) { return isToday(D); })[0]; if (t && UI.chose !== weddingDay()) { /* wedding today: open it */ UI.view = 'wedding'; UI.wid = t.id; } }
    render(false);
    try { if (localStorage.getItem('gabi-day-wl') === '1') wake(false); } catch (x) {}
  });
})();
