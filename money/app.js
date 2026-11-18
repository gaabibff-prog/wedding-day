/* Gabi Money: a phone app that keeps your upcoming weddings on the phone.
   Weddings come from the main Claude app as a locked file; checkmarks and notes go back the same way.
   Everything is stored only on this phone. Files are locked (AES-GCM) with your pairing code. */
(function () {
  'use strict';

  /* ---------- small storage helper (IndexedDB, with a memory fallback) ---------- */
  var MEM = {};
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('gabi-money-app', 1);
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
  var VERSION = 2, TRK = null, WATCH = null, WL = null, CODE = null, MONEY = { trips: [], receipts: [], odo: {} }, MSHEET = null, VIEW = 'drives';
  try { VIEW = localStorage.getItem('gabi-money-view') || 'drives'; } catch (x) {}
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f12(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function dayIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function toast(t) { [].forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); }); var d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2800); }
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
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    car: '<path d="M5 16v-3.5L7 8h10l2 4.5V16z"/><path d="M5 12.5h14"/><circle cx="8" cy="16.5" r="1.8"/><circle cx="16" cy="16.5" r="1.8"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

  /* ---------- Money: drives and receipts for taxes ---------- */
  function saveMoney() { return put('money', MONEY); }
  function yr() { return String(new Date().getFullYear()); }
  function tripsYear(y) { return MONEY.trips.filter(function (t) { return String(t.date).slice(0, 4) === y; }).sort(function (a, b) { return (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')); }); }
  function hm(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : f12(d.getHours() * 60 + d.getMinutes()); }
  function parseDrives(text) {
    var n = 0, have = {}; MONEY.trips.forEach(function (t) { have[t.id] = 1; });
    String(text).split(/\r?\n/).forEach(function (line) {
      var p = line.split('|').map(function (x) { return x.trim(); });
      if (p[0] !== 'TRIP' || p.length < 6) return;
      var st = new Date(p[1]), en = new Date(p[2]), mi = parseFloat(String(p[5]).replace(/[^\d.]/g, ''));
      if (isNaN(st) || !(mi > 0.2)) return;
      if (/km/i.test(p[5])) mi = mi * 0.621371;
      var id = 'd' + st.getTime(); if (have[id]) return; have[id] = 1;
      MONEY.trips.push({ id: id, date: dayIso(st), start: st.toISOString(), end: isNaN(en) ? '' : en.toISOString(), from: p[3] || '', to: p[4] || '', miles: Math.round(mi * 10) / 10, purpose: '', business: null, wid: '', auto: true });
      n++;
    });
    return n;
  }
  function importDrives() {
    var inp = document.getElementById('file'); inp.value = ''; inp.accept = '.txt,text/plain';
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.accept = ''; if (!f) return; f.text().then(function (t) { var n = parseDrives(t); return saveMoney().then(function () { render(true); toast(n ? '✓ ' + n + ' new drive' + (n === 1 ? '' : 's') + '. Mark each one Business or Personal.' : 'No new drives in that file.'); }); }); };
    inp.click();
  }
  function addReceipt() {
    var inp = document.getElementById('file'); inp.value = ''; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
    inp.onchange = function () {
      var fs = [].slice.call(inp.files || []); inp.accept = ''; inp.multiple = false; if (!fs.length) return;
      Promise.all(fs.slice(0, 10).map(function (f) {
        if (f.type === 'application/pdf') return new Promise(function (res, rej) { if (f.size > 3.5e6) return rej(new Error('That PDF is over 3.5 MB.')); var r = new FileReader(); r.onload = function () { res({ data: r.result, type: 'application/pdf', name: f.name }); }; r.onerror = rej; r.readAsDataURL(f); });
        return new Promise(function (res, rej) { var r = new FileReader(); r.onerror = rej; r.onload = function () { var im = new Image(); im.onerror = rej; im.onload = function () { var mx = 1800, sc = Math.min(1, mx / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); res({ data: c.toDataURL('image/jpeg', 0.8), type: 'image/jpeg', name: (f.name || 'receipt').replace(/\.\w+$/, '') + '.jpg' }); }; im.src = r.result; }; r.readAsDataURL(f); });
      })).then(function (list) {
        list.forEach(function (x) { MONEY.receipts.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), name: x.name, type: x.type, data: x.data, note: '', sent: 0 }); });
        return saveMoney();
      }).then(function () { render(true); toast('Receipt saved. It goes to your main app next time you Sync.'); }, function (er) { toast(er && er.message ? er.message : 'Could not save that receipt.'); });
    };
    inp.click();
  }
  function milesCSV(y) {
    var T = tripsYear(y).filter(function (t) { return t.business === true; }).reverse(), q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var wn = function (t) { return t.wedding || ''; };
    var rows = [['Date', 'Start time', 'End time', 'From', 'To', 'Business purpose', 'Miles', 'Odometer start', 'Odometer end', 'Wedding']];
    T.forEach(function (t) { rows.push([t.date, hm(t.start), hm(t.end), t.from, t.to, t.purpose, t.miles, t.odoStart || '', t.odoEnd || '', wn(t)]); });
    var o = MONEY.odo[y] || {}, tot = T.reduce(function (a, t) { return a + (+t.miles || 0); }, 0);
    rows.push([]); rows.push(['Total business miles', '', '', '', '', '', Math.round(tot * 10) / 10]);
    rows.push(['Odometer Jan 1', o.start || '']); rows.push(['Odometer Dec 31', o.end || '']);
    return rows.map(function (r) { return r.map(q).join(','); }).join('\n');
  }
  function exportMiles() {
    var y = yr(), text = milesCSV(y), name = 'Mileage log ' + y + '.csv', file = new File([text], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(function () {}); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function vMoney() {
    var y = yr(), T = tripsYear(y), todo = T.filter(function (t) { return t.business == null; }), biz = T.filter(function (t) { return t.business === true; }), pers = T.filter(function (t) { return t.business === false; });
    var bm = Math.round(biz.reduce(function (a, t) { return a + (+t.miles || 0); }, 0) * 10) / 10, unsentR = MONEY.receipts.filter(function (r) { return !r.sent; }).length, unsentT = biz.filter(function (t) { return !t.sent; }).length, o = MONEY.odo[y] || {};
    var h = '<h1 class="hello">Money</h1><p class="sub">Drives and receipts for your taxes. They go to your main app when you Sync.</p>';
    h += '<div class="stat"><div><b>' + bm + '</b><small>Business miles ' + y + '</small></div><div><b>' + MONEY.receipts.length + '</b><small>Receipts</small></div></div>';
    if (unsentR || unsentT) h += '<div class="card tint" style="padding:14px 16px"><b>' + [unsentT ? unsentT + ' drive' + (unsentT === 1 ? '' : 's') : '', unsentR ? unsentR + ' receipt' + (unsentR === 1 ? '' : 's') : ''].filter(Boolean).join(' and ') + ' waiting to send</b><div class="btns" style="margin-top:10px"><button class="btn dark" data-act="sync">Sync now</button></div></div>';
    h += '<div class="h2">Receipts</div><button class="btn dark" data-act="addreceipt">' + svg('camera') + ' Snap or upload a receipt</button><p class="hint">Photo, screenshot or PDF. Claude reads it in your main app.</p>';
    if (MONEY.receipts.length) h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + MONEY.receipts.slice().reverse().slice(0, 30).map(function (r) { return '<button data-rcpt="' + e(r.id) + '" style="border:1px solid var(--line);border-radius:12px;padding:0;background:var(--card);overflow:hidden;position:relative;aspect-ratio:1">' + (r.type === 'application/pdf' ? '<span style="display:flex;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:var(--mute)">' + svg('receipt') + '<small>PDF</small></span>' : '<img src="' + r.data + '" alt="Receipt" style="width:100%;height:100%;object-fit:cover;display:block">') + '<span style="position:absolute;left:4px;bottom:4px;background:' + (r.sent ? 'var(--ok)' : 'var(--dark)') + ';color:#fff;font-size:11px;border-radius:6px;padding:1px 6px">' + (r.sent ? 'Sent' : 'Not sent') + '</span></button>'; }).join('') + '</div>';
    h += '<div class="h2">Drives</div><div class="row2"><button class="btn" data-act="adddrive">+ Add a drive</button><button class="btn" data-act="importdrives">Import drives</button></div>';
    if (todo.length) h += '<div class="h2" style="font-size:17px">Business or personal? <small class="sub" style="font-weight:500">' + todo.length + '</small></div><div class="list">' + todo.map(function (t) { return '<div class="li" style="flex-wrap:wrap"><span class="t"><b>' + e(t.miles) + ' mi · ' + e(t.date) + '</b><small>' + e([hm(t.start), t.from && t.to ? t.from + ' → ' + t.to : (t.from || t.to)].filter(Boolean).join(' · ')) + '</small></span><span class="row2" style="flex:0 0 auto;gap:6px"><button class="btn" data-bizset="' + e(t.id) + ':1" style="width:auto;min-height:40px;font-size:15px">Business</button><button class="btn link" data-bizset="' + e(t.id) + ':0" style="width:auto;min-height:40px;font-size:15px">Personal</button></span></div>'; }).join('') + '</div>';
    h += '<div class="h2" style="font-size:17px">Business drives ' + y + '</div>' + (biz.length ? '<div class="list">' + biz.map(function (t) { return '<button class="li" data-trip="' + e(t.id) + '"><span class="ico" style="color:var(--icon)">' + svg('car') + '</span><span class="t"><b>' + e(t.miles) + ' mi · ' + e(t.purpose || 'Add the purpose') + '</b><small>' + e(t.date) + (t.from || t.to ? ' · ' + e([t.from, t.to].filter(Boolean).join(' → ')) : '') + (t.sent ? ' · sent' : '') + '</small></span><span class="chev">›</span></button>'; }).join('') + '</div>' : '<p class="sub">None yet.</p>');
    if (pers.length) h += '<details class="card" style="padding:12px 16px"><summary><b>Personal drives</b> <span class="sub">' + pers.length + ' · not counted</span></summary><div class="list" style="margin-top:10px">' + pers.map(function (t) { return '<button class="li" data-trip="' + e(t.id) + '"><span class="t"><b style="font-weight:500">' + e(t.miles) + ' mi · ' + e(t.date) + '</b></span><span class="chev">›</span></button>'; }).join('') + '</div></details>';
    h += '<div class="h2" style="font-size:17px">Odometer ' + y + '</div><p class="hint" style="margin-top:-4px">The IRS asks for your car’s odometer at the start and end of the year.</p><div class="row2"><label style="flex:1"><span class="sub">January 1</span><input type="text" inputmode="numeric" data-odo="start" value="' + e(o.start || '') + '" placeholder="e.g. 42150"></label><label style="flex:1"><span class="sub">December 31</span><input type="text" inputmode="numeric" data-odo="end" value="' + e(o.end || '') + '" placeholder="e.g. 51320"></label></div>';
    h += '<div class="btns"><button class="btn" data-act="exportmiles">Download IRS mileage log (CSV)</button></div>';
    h += '<details class="card" style="margin-top:16px"><summary><b>Log drives automatically with CarPlay</b></summary><div class="hint" style="color:var(--ink)">' + SHORTCUT_HELP + '</div></details>';
    return h;
  }
  var SHORTCUT_HELP = '<p>Your iPhone’s Shortcuts app logs each drive when CarPlay connects and disconnects, even with this app closed. It saves only the city, never your street address.</p>' +
    '<p><b>1. When CarPlay connects</b><br>Shortcuts → Automation → + → <b>CarPlay</b> → <b>Connects</b> → <b>Run Immediately</b> → New Blank Automation. Add these actions:<br>• <b>Get Current Location</b><br>• <b>Text</b>: type <code>START|</code>, insert <b>Current Date</b> (tap it, choose Format → ISO 8601, Include time), type <code>|</code>, insert <b>Current Location</b><br>• <b>Save File</b>: save the Text to <b>Shortcuts</b> folder, name it <code>wd-start.txt</code>, turn <b>Overwrite If File Exists</b> on, and turn Ask Where to Save off.</p>' +
    '<p><b>2. When CarPlay disconnects</b><br>New automation → CarPlay → <b>Disconnects</b> → Run Immediately. Add:<br>• <b>Get File</b> from Shortcuts folder: <code>wd-start.txt</code> (Show Document Picker off)<br>• <b>Split Text</b> by Custom <code>|</code><br>• <b>Get Item from List</b>: Item at Index <b>2</b> (rename the result Start time)<br>• <b>Get Item from List</b> (from Split Text): Item at Index <b>3</b> (rename Start place)<br>• <b>Get Current Location</b><br>• <b>Get Travel Time</b>: Driving, from <b>Start place</b> to <b>Current Location</b><br>• <b>Get Details of Travel Time</b>: <b>Distance</b><br>• <b>Get Details of Locations</b>: <b>City</b> of Start place, and again for Current Location<br>• <b>Text</b>: <code>TRIP|</code>Start time<code>|</code>Current Date (ISO 8601)<code>|</code>Start city<code>|</code>End city<code>|</code>Distance<br>• <b>Append to Text File</b>: Shortcuts folder, file <code>Wedding Day drives.txt</code>, Make New Line on.</p>' +
    '<p><b>3. In this app</b>: tap <b>Import drives</b> and pick <code>Wedding Day drives.txt</code> from Files → iCloud Drive → Shortcuts. Only new drives are added, so import as often as you like.</p>' +
    '<p>If a step looks different on your iPhone, send Claude a screenshot.</p>';
  function tripSheet(t) {
    return '<div class="sheet" data-sheetbg="1"><div><div style="display:flex;align-items:center;margin-bottom:10px"><h3 style="font-size:22px">' + (t.isNew ? 'Add a drive' : 'Drive') + '</h3><button class="ib" data-msheet="" aria-label="Close">' + svg('close') + '</button></div>' +
      '<div class="row2"><label><span class="sub">Date</span><input type="text" id="t-date" value="' + e(t.date) + '" placeholder="2026-11-18"></label><label><span class="sub">Miles</span><input type="text" inputmode="decimal" id="t-miles" value="' + e(t.miles || '') + '"></label></div>' +
      '<label><span class="sub">Business purpose</span><input type="text" id="t-purpose" value="' + e(t.purpose || '') + '" placeholder="Wedding: getting ready to ceremony to reception"></label>' +
      '<div class="row2"><label><span class="sub">From</span><input type="text" id="t-from" value="' + e(t.from || '') + '" placeholder="Town"></label><label><span class="sub">To</span><input type="text" id="t-to" value="' + e(t.to || '') + '" placeholder="Town"></label></div>' +
      '<div class="row2"><label><span class="sub">Odometer start</span><input type="text" inputmode="numeric" id="t-os" value="' + e(t.odoStart || '') + '"></label><label><span class="sub">Odometer end</span><input type="text" inputmode="numeric" id="t-oe" value="' + e(t.odoEnd || '') + '"></label></div>' +
      '<label><span class="sub">Client or wedding (optional)</span><input type="text" id="t-wed" value="' + e(t.wedding || '') + '" placeholder="Emma & Dalton"></label>' +
      '<div class="row2" style="margin-top:12px"><button class="btn' + (t.business === false ? '' : ' dark') + '" data-tsave="1">Save as business</button><button class="btn" data-tsave="0">Personal</button></div>' +
      (t.isNew ? '' : '<div class="btns"><button class="btn dg" data-tdel="' + e(t.id) + '">Delete this drive</button></div>') + '</div></div>';
  }
  function rcptSheet(r) {
    return '<div class="sheet" data-sheetbg="1"><div><div style="display:flex;align-items:center;margin-bottom:10px"><h3 style="font-size:20px">Receipt</h3><button class="ib" data-msheet="" aria-label="Close">' + svg('close') + '</button></div>' +
      (r.type === 'application/pdf' ? '<p class="sub">' + e(r.name) + ' (PDF)</p>' : '<img src="' + r.data + '" alt="Receipt" style="width:100%;border-radius:14px;display:block;margin-bottom:10px">') +
      '<input type="text" id="r-note" placeholder="Note (optional): what it was for" value="' + e(r.note || '') + '"><p class="hint">' + (r.sent ? 'Sent to your main app ' + e(new Date(r.sent).toLocaleString()) + '.' : 'Not sent yet. It goes with your next Sync.') + '</p>' +
      '<div class="row2"><button class="btn dark" data-rsave="' + e(r.id) + '">Save</button><button class="btn dg" data-rdel="' + e(r.id) + '">Delete</button></div></div></div>';
  }



  /* ---------- live GPS drive tracking (app open on screen) ---------- */
  function trkSave() { try { localStorage.setItem('gabi-money-trk', TRK ? JSON.stringify(TRK) : ''); } catch (x) {} }
  function hav(a, b) { var R = 3958.8, r = Math.PI / 180, dLa = (b.la - a.la) * r, dLo = (b.lo - a.lo) * r, x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); }
  function wakeOn() { try { if ('wakeLock' in navigator && !WL) navigator.wakeLock.request('screen').then(function (l) { WL = l; l.addEventListener('release', function () { WL = null; }); }, function () {}); } catch (x) {} }
  function onPos(pos) {
    if (!TRK) return; var c = pos.coords, pt = { la: c.latitude, lo: c.longitude, t: pos.timestamp || Date.now() };
    TRK.acc = Math.round(c.accuracy || 0);
    if (c.accuracy && c.accuracy > 60) { paintTrk(); return; }
    if (TRK.last) {
      var d = hav(TRK.last, pt), dt = Math.max(1, (pt.t - TRK.last.t) / 1000), mph = d / (dt / 3600);
      if (dt > 45) { if (d > 0.05) { TRK.miles += d * 1.25; TRK.est = (TRK.est || 0) + d * 1.25; } TRK.last = pt; }
      else if (d * 1609 >= 12 && mph < 110) { TRK.miles += d; TRK.last = pt; }
    } else TRK.last = pt;
    trkSave(); paintTrk();
  }
  function startWatch() {
    if (!('geolocation' in navigator)) { toast('This phone can’t share its location with the app.'); return false; }
    if (WATCH != null) navigator.geolocation.clearWatch(WATCH);
    WATCH = navigator.geolocation.watchPosition(onPos, function (er) { toast(er && er.code === 1 ? 'Location is off for Gabi Money. Allow it in Settings → Privacy → Location Services → Safari Websites (While Using).' : 'Waiting for GPS…'); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    wakeOn(); return true;
  }
  function trkStart() { TRK = { start: new Date().toISOString(), miles: 0, last: null, est: 0 }; trkSave(); if (startWatch()) { render(false); toast('Tracking. Keep Gabi Money open on screen while you drive.'); } }
  function trkStop(save) {
    if (WATCH != null) { navigator.geolocation.clearWatch(WATCH); WATCH = null; } if (WL) { try { WL.release(); } catch (x) {} WL = null; }
    var t = TRK; TRK = null; trkSave(); if (!t) return;
    var mi = Math.round(t.miles * 10) / 10;
    if (save && mi >= 0.2) { var st = new Date(t.start); MONEY.trips.push({ id: 'g' + st.getTime(), date: dayIso(st), start: t.start, end: new Date().toISOString(), from: '', to: '', miles: mi, purpose: '', business: null, wedding: '', auto: true, tracked: true, estimated: Math.round((t.est || 0) * 10) / 10 }); saveMoney(); toast('✓ Saved ' + mi + ' miles. Mark it Business or Personal below.'); }
    else if (save) toast('Under 0.2 miles, so it wasn’t saved.');
    render(false);
  }
  function trkMins() { return TRK ? Math.max(0, Math.round((Date.now() - new Date(TRK.start).getTime()) / 60000)) : 0; }
  function trkCard() {
    if (!TRK) return '<div class="card" style="display:flex;align-items:center;gap:12px"><span class="ico">' + svg('car') + '</span><div style="flex:1"><b style="font-size:18px">Track a drive</b><div class="sub">Keep the app open on screen while you drive</div></div><button class="btn dark" data-act="trkstart" style="width:auto">Start</button></div>';
    return '<div class="card" id="trkcard" style="border-color:var(--ok);text-align:center"><div class="sub" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:13px;color:var(--ok)">● Tracking</div><div id="trkmi" style="font-size:56px;font-weight:700;line-height:1.1;margin:6px 0">' + (Math.round(TRK.miles * 10) / 10).toFixed(1) + '</div><div class="sub">miles · <span id="trkmin">' + trkMins() + '</span> min' + (TRK.acc ? ' · GPS ±' + TRK.acc + ' m' : ' · finding GPS…') + '</div>' + (TRK.est ? '<p class="hint" style="margin:8px 0 0">' + (Math.round(TRK.est * 10) / 10) + ' mi estimated while the app was in the background.</p>' : '') + '<p class="hint" style="margin:8px 0 0">Keep this screen open. If you switch apps, it fills in the gap when you come back.</p><div class="row2" style="margin-top:12px"><button class="btn dark" data-act="trkstop">Stop & save</button><button class="btn" data-act="trkcancel">Cancel</button></div></div>';
  }
  function paintTrk() { var a = document.getElementById('trkmi'); if (!a || !TRK) return; a.textContent = (Math.round(TRK.miles * 10) / 10).toFixed(1); var b = document.getElementById('trkmin'); if (b) b.textContent = trkMins(); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && TRK) { wakeOn(); startWatch(); paintTrk(); } });
  setInterval(paintTrk, 15000);

  /* ---------- screens ---------- */
  var TABS = [['drives', 'Drives', 'car'], ['receipts', 'Receipts', 'receipt'], ['sync', 'Sync', 'sync'], ['settings', 'Settings', 'gear']];
  function vSetup() {
    return '<h1 class="hello">Welcome!</h1><p class="sub">Pair this phone once with your main app.</p><div class="card"><p class="hint" style="margin-top:0">In your main app inside Claude, open <b>Weddings → 📲 Day-of phone app</b> and tap <b>Copy</b> next to your pairing code. It’s the same code as your Wedding Day app.</p><input type="text" id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"><div class="btns"><button class="btn dark" data-act="savecode">Save pairing code</button></div></div>' + installHint();
  }
  function installHint() {
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone; if (standalone) return '';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return '<div class="card tint"><b>Add it to your home screen</b><p class="hint" style="margin:6px 0 0">' + (ios ? 'In Safari, tap Share, then <b>Add to Home Screen</b>.' : 'In Chrome, tap ⋮, then <b>Install app</b>.') + ' Always open it from the icon.</p></div>';
  }
  var RH = '<div class="h2">Receipts</div>', DH = '<div class="h2">Drives</div>';
  function vDrivesOnly() { var h = vMoney(), i = h.indexOf(RH), j = h.indexOf(DH); h = i >= 0 && j > i ? h.slice(0, i) + h.slice(j) : h; var k = h.indexOf(DH); return k >= 0 ? h.slice(0, k + DH.length) + trkCard() + h.slice(k + DH.length) : trkCard() + h; }
  function vReceiptsOnly() { var h = vMoney(), i = h.indexOf(RH), j = h.indexOf(DH); return '<h1 class="hello">Receipts</h1><p class="sub">Photo, screenshot or PDF. Claude reads them in your main app after you Sync.</p>' + (i >= 0 && j > i ? h.slice(i + RH.length, j).replace(/<p class="hint">Photo, screenshot or PDF\. Claude reads it in your main app\.<\/p>/, '') : ''); }
  function vSyncTab() {
    var unsentR = MONEY.receipts.filter(function (r) { return !r.sent; }).length, unsentT = MONEY.trips.filter(function (t) { return t.business === true && !t.sent; }).length;
    return '<h1 class="hello">Sync</h1><p class="sub">Sends business drives and receipts to your main app. Personal drives stay on this phone.</p>' +
      '<div class="card"><div style="display:flex;align-items:center;gap:12px"><span class="ico">' + svg('sync') + '</span><div style="flex:1"><b style="font-size:18px">Sync with Google Drive</b><div class="sub">Last synced: ' + e(lastSync()) + '</div></div></div><p class="hint">' + (unsentR || unsentT ? 'Waiting to send: ' + [unsentT ? unsentT + ' drive' + (unsentT === 1 ? '' : 's') : '', unsentR ? unsentR + ' receipt' + (unsentR === 1 ? '' : 's') : ''].filter(Boolean).join(' and ') + '.' : 'Everything is sent.') + ' When Google asks, pick the account your main app uses (gaabibff).</p><button class="btn dark" data-act="sync"' + (SYNCING ? ' disabled' : '') + '>' + (SYNCING ? 'Syncing…' : 'Sync now') + '</button></div>' +
      '<div class="h2" style="font-size:18px">Or use a file</div><div class="card"><p class="hint" style="margin-top:0">Saves a locked file. In your main app open <b>Money → Books → From your phone → Load a file</b>.</p><button class="btn" data-act="sendfile">Save a file for my main app</button></div>' +
      '<div class="card tint"><b>Then in your main app</b><p class="hint" style="margin:6px 0 0">Open <b>Money → Books</b>. In the <b>📲 From your phone</b> card, tap <b>Get from Drive</b>, then review the drives and receipts.</p></div>';
  }
  function vSettings() {
    return '<h1 class="hello">Settings</h1><div class="list" style="margin-top:14px"><button class="li" data-act="changecode"><span class="ico">' + svg('gear') + '</span><span class="t"><b>Change pairing code</b><small>Your drives and receipts stay on this phone</small></span></button><button class="li" data-act="wipe"><span class="ico" style="color:var(--warn)">' + svg('close') + '</span><span class="t"><b style="color:var(--warn)">Remove everything from this phone</b><small>Only what you already synced is in your main app</small></span></button></div><p class="hint">Everything is stored only on this phone until you sync. Gabi Money version ' + VERSION + '.</p>' + installHint();
  }
  function render(keep) {
    var y = window.scrollY;
    document.getElementById('hd').innerHTML = '<div class="bar"><span class="ttl" style="padding-left:6px">Gabi Money</span></div>';
    document.getElementById('tb').innerHTML = CODE ? TABS.map(function (x) { return '<button class="tab" data-view="' + x[0] + '"' + (VIEW === x[0] ? ' aria-current="page"' : '') + '><span class="ti">' + svg(x[2]) + '</span>' + x[1] + '</button>'; }).join('') : '';
    document.getElementById('m').innerHTML = !CODE ? vSetup() : ({ drives: vDrivesOnly, receipts: vReceiptsOnly, sync: vSyncTab, settings: vSettings }[VIEW] || vDrivesOnly)();
    var MS0 = null; if (MSHEET) { if (MSHEET.trip) MS0 = tripSheet(MSHEET.trip); else if (MSHEET.rcpt) { var rr = MONEY.receipts.filter(function (x) { return x.id === MSHEET.rcpt; })[0]; if (rr) MS0 = rcptSheet(rr); } }
    document.getElementById('sh').innerHTML = MS0 || '';
    [].forEach.call(document.querySelectorAll('[data-odo]'), function (inp) { inp.addEventListener('change', function () { var yy = yr(); MONEY.odo[yy] = MONEY.odo[yy] || {}; MONEY.odo[yy][inp.dataset.odo] = inp.value.replace(/[^\d]/g, ''); saveMoney(); }); });
    window.scrollTo(0, keep ? y : 0);
  }

  /* ---------- sending ---------- */
  var PENDING = null;
  function buildOut() {
    var mt = MONEY.trips.filter(function (t) { return t.business === true && !t.sent; }), mr = MONEY.receipts.filter(function (r) { return !r.sent; });
    if (!mt.length && !mr.length) return Promise.resolve(null);
    PENDING = { trips: mt.map(function (t) { return t.id; }), receipts: mr.map(function (r) { return r.id; }) };
    return lock({ made: new Date().toLocaleString(), app: 'money', weddings: {}, money: { trips: mt, receipts: mr } }, CODE, 'results');
  }
  function markSent() { if (!PENDING) return; var now = Date.now(); MONEY.trips.forEach(function (t) { if (PENDING.trips.indexOf(t.id) >= 0) t.sent = now; }); MONEY.receipts.forEach(function (r) { if (PENDING.receipts.indexOf(r.id) >= 0) r.sent = now; }); PENDING = null; saveMoney(); }
  function sendFile() {
    buildOut().then(function (text) {
      if (!text) { toast('Nothing new to send.'); return; }
      var name = 'Gabi Money ' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.gabiday', file = new File([text], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: name }).then(function () { markSent(); render(true); toast('Now load it in your main app: Money → From your phone.'); }, function () { PENDING = null; });
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); markSent(); render(true);
    });
  }
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
        var picked = false; try { picked = sessionStorage.getItem('gabi-money-picked') === '1'; } catch (x) {}
        tc.requestAccessToken({ prompt: picked ? '' : 'select_account' }); try { sessionStorage.setItem('gabi-money-picked', '1'); } catch (x) {}
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
    if (SYNCING) return; if (!navigator.onLine) { toast('No signal right now. Sync when you have service.'); return; }
    var sent = false; SYNCING = true; render(true);
    token().then(buildOut).then(function (text) {
      if (!text) return;
      return findFile("name = 'Gabi Money - from phone.txt'").then(function (f) {
        if (f) return gfetch('https://www.googleapis.com/upload/drive/v3/files/' + f.id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: text });
        var bd = 'gabi' + Date.now(), body = '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: 'Gabi Money - from phone.txt', mimeType: 'text/plain' }) + '\r\n--' + bd + '\r\nContent-Type: text/plain\r\n\r\n' + text + '\r\n--' + bd + '--';
        return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bd }, body: body });
      }).then(function () { sent = true; markSent(); });
    }).then(function () {
      try { localStorage.setItem('gabi-money-lastsync', String(Date.now())); } catch (x) {}
      SYNCING = false; render(true); toast(sent ? '✓ Sent. In your main app: Money → From your phone → Get from Drive.' : '✓ Nothing new to send.');
    }).catch(function (err) { SYNCING = false; PENDING = null; render(true); toast(err && err.message ? err.message : 'Sync did not finish. Try again.'); });
  }
  function lastSync() { var t = 0; try { t = +localStorage.getItem('gabi-money-lastsync') || 0; } catch (x) {} return t ? new Date(t).toLocaleString() : 'never'; }

  /* ---------- taps ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button,[data-sheetbg]'); if (!b) return;
    if (b.dataset.sheetbg && ev.target !== b) return;
    if (b.dataset.sheetbg) { MSHEET = null; render(true); return; }
    if (b.dataset.view) { VIEW = b.dataset.view; MSHEET = null; try { localStorage.setItem('gabi-money-view', VIEW); } catch (x) {} render(false); return; }
    if (b.dataset.msheet != null) { MSHEET = null; render(true); return; }
    if (b.dataset.bizset) { var bp = b.dataset.bizset.split(':'), tb = MONEY.trips.filter(function (x) { return x.id === bp[0]; })[0]; if (tb) { tb.business = bp[1] === '1'; saveMoney(); if (tb.business && !tb.purpose) MSHEET = { trip: Object.assign({}, tb) }; } render(true); return; }
    if (b.dataset.trip) { var tt = MONEY.trips.filter(function (x) { return x.id === b.dataset.trip; })[0]; if (tt) MSHEET = { trip: Object.assign({}, tt) }; render(true); return; }
    if (b.dataset.tsave != null && MSHEET && MSHEET.trip) {
      var tv = MSHEET.trip, gv = function (id) { var x = document.getElementById(id); return x ? x.value.trim() : ''; };
      var os = parseFloat(gv('t-os')), oe = parseFloat(gv('t-oe')), mi = parseFloat(gv('t-miles'));
      if (!(mi > 0) && oe > os) mi = oe - os;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(gv('t-date'))) { toast('Use a date like 2026-11-18'); return; }
      if (!(mi > 0)) { toast('Add the miles, or the odometer start and end'); return; }
      var rec = { id: tv.id || ('m' + Date.now().toString(36)), date: gv('t-date'), start: tv.start || '', end: tv.end || '', from: gv('t-from'), to: gv('t-to'), miles: Math.round(mi * 10) / 10, purpose: gv('t-purpose'), business: b.dataset.tsave === '1', wedding: gv('t-wed'), odoStart: gv('t-os'), odoEnd: gv('t-oe'), auto: !!tv.auto, sent: 0 };
      if (rec.business && !rec.purpose) { toast('Add the business purpose. The IRS asks for it.'); return; }
      MONEY.trips = MONEY.trips.filter(function (x) { return x.id !== rec.id; }).concat([rec]); MSHEET = null; saveMoney(); render(true); toast('Saved'); return;
    }
    if (b.dataset.tdel) { if (confirm('Delete this drive?')) { MONEY.trips = MONEY.trips.filter(function (x) { return x.id !== b.dataset.tdel; }); MSHEET = null; saveMoney(); render(true); } return; }
    if (b.dataset.rcpt) { MSHEET = { rcpt: b.dataset.rcpt }; render(true); return; }
    if (b.dataset.rsave) { var rs = MONEY.receipts.filter(function (x) { return x.id === b.dataset.rsave; })[0]; if (rs) { var nn = (document.getElementById('r-note').value || '').trim(); if (nn !== rs.note) { rs.note = nn; rs.sent = 0; } saveMoney(); } MSHEET = null; render(true); return; }
    if (b.dataset.rdel) { if (confirm('Delete this receipt from your phone?')) { MONEY.receipts = MONEY.receipts.filter(function (x) { return x.id !== b.dataset.rdel; }); MSHEET = null; saveMoney(); render(true); } return; }
    var act = b.dataset.act;
    if (act === 'savecode') { var c = normCode(document.getElementById('code').value); if (c.length < 12) { toast('That code looks too short. Copy it again from your main app.'); return; } CODE = c; put('code', c).then(function () { render(false); toast('Paired.'); }); return; }
    if (act === 'changecode') { if (confirm('Change the pairing code? Your drives and receipts stay on this phone.')) { CODE = null; del('code'); render(false); } return; }
    if (act === 'wipe') { if (confirm('Remove all drives, receipts and odometer readings from this phone?')) { MONEY = { trips: [], receipts: [], odo: {} }; saveMoney().then(function () { render(false); toast('Removed from this phone'); }); } return; }
    if (act === 'sync') { syncNow(); return; }
    if (act === 'sendfile') { sendFile(); return; }
    if (act === 'addreceipt') { addReceipt(); return; }
    if (act === 'importdrives') { importDrives(); return; }
    if (act === 'exportmiles') { exportMiles(); return; }
    if (act === 'trkstart') { trkStart(); return; }
    if (act === 'trkstop') { trkStop(true); return; }
    if (act === 'trkcancel') { if (confirm('Cancel this drive? The miles won’t be saved.')) trkStop(false); return; }
    if (act === 'adddrive') { MSHEET = { trip: { isNew: true, date: dayIso(new Date()), miles: '', business: true } }; render(true); return; }
  });

  /* ---------- start ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (x) {}
  Promise.all([get('code'), get('money')]).then(function (r) {
    try { var t0 = localStorage.getItem('gabi-money-trk'); if (t0) { TRK = JSON.parse(t0); VIEW = 'drives'; setTimeout(function () { if (TRK) { startWatch(); toast('Your drive is still being tracked.'); } }, 600); } } catch (x) {}
    CODE = r[0] || null;
    if (r[1] && typeof r[1] === 'object') { MONEY = r[1]; MONEY.trips = MONEY.trips || []; MONEY.receipts = MONEY.receipts || []; MONEY.odo = MONEY.odo || {}; }
    render(false);
  });
})();
