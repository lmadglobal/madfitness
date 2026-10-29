'use strict';
/* =====================================================================
   Health tab + online backup (Supabase). Loaded before the main script.
   Apple Health → (Apple Shortcut) → Supabase → this app.
   ===================================================================== */

/* ---------- connection ---------- */
function cloud(){ return data.settings.sb || {}; }
function cloudReady(){ const c = cloud(); return !!(c.url && c.key && data.settings.syncToken); }
function cleanUrl(u){
  u = String(u || '').trim().replace(/\/+$/, '');
  // Accept the dashboard address from the browser (supabase.com/dashboard/project/<id>/...) or just the project ID.
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})/i);
  if(dash) return 'https://' + dash[1].toLowerCase() + '.supabase.co';
  if(/^[a-z0-9]{15,40}$/i.test(u)) return 'https://' + u.toLowerCase() + '.supabase.co';
  if(u && !/^https?:\/\//.test(u)) u = 'https://' + u;
  return u.replace(/\/rest\/v1.*$/, '');
}
function ensureToken(){
  if(data.settings.syncToken) return data.settings.syncToken;
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  data.settings.syncToken = 'fit_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  save(); return data.settings.syncToken;
}
function cloudHeaders(){
  const k = cloud().key.trim();
  const h = {'Content-Type': 'application/json', 'apikey': k};
  if(k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;   // older "anon" keys also go here; new "publishable" keys must not
  return h;
}
async function rpc(fn, body, opts){
  const res = await fetch(cleanUrl(cloud().url) + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: cloudHeaders(), body: JSON.stringify({token: data.settings.syncToken, ...body}),
    keepalive: !!(opts && opts.keepalive)
  });
  const text = await res.text();
  let json = null; try{ json = text ? JSON.parse(text) : null; }catch(e){}
  if(!res.ok){
    const m = (json && (json.message || json.hint)) || text || ('HTTP ' + res.status);
    if(/Wrong sync token/.test(m)) throw new Error('The sync token doesn’t match. Copy the setup SQL again and re-run it in Supabase.');
    if(res.status === 404 || /Could not find the function/.test(m)) throw new Error('Setup not found. Run the setup SQL in Supabase’s SQL Editor first.');
    if(res.status === 401 || /Invalid API key|No API key/i.test(m)) throw new Error('Supabase rejected the API key. Check it in Settings.');
    throw new Error(m);
  }
  return json;
}

/* ---------- health data (cached on the phone for offline use) ---------- */
function H(){ if(!data.health) data.health = {days: {}, weights: [], fetchedAt: 0, syncedAt: null}; return data.health; }
const hs = {status: 'idle', error: ''};   // sync status, not saved
async function refreshHealth(force){
  if(!cloudReady() || hs.status === 'loading') return;
  if(!force && Date.now() - (H().fetchedAt || 0) < 5 * 60e3) return;
  hs.status = 'loading'; hs.error = ''; paintSyncPill();
  try{
    await pushPendingWeights();
    const r = await rpc('fit_get', {since: new Date().getFullYear() + '-01-01'});
    const h = H(), days = {};
    let latest = null;
    for(const d of (r.days || [])){ days[d.day] = d; if(!latest || d.updated_at > latest) latest = d.updated_at; }
    h.days = days;
    const local = h.weights.filter(w => w.pending);
    h.weights = (r.weights || []).map(w => ({at: w.at, lb: +w.lb, source: w.source})).concat(local);
    h.fetchedAt = Date.now(); h.syncedAt = latest;
    hs.status = 'ok';
    skipBackup = true; save(); skipBackup = false;
  }catch(e){ hs.status = 'error'; hs.error = e.message || 'Couldn’t reach Supabase'; }
  if(ui.tab === 'health' || ui.tab === 'diet') renderMain(); else paintSyncPill();
}
async function pushPendingWeights(){
  for(const w of H().weights.filter(x => x.pending)){
    await rpc('fit_add_weight', {at: w.at, lb: w.lb});
    w.pending = false;
  }
}
function everHas(field){ return Object.values((data.health && data.health.days) || {}).some(d => d[field] != null && +d[field] > 0); }
function activeFor(k){ const d = (data.health && data.health.days[k]) || null; return d && d.active_kcal ? +d.active_kcal : 0; }

/* ---------- online backup of diet + workouts ---------- */
let backupTimer = null, skipBackup = false, lastSent = '';
function backupPayload(){ const d = {...data}; delete d.health; return d; }
function cloudAfterSave(){
  if(skipBackup || !cloudReady()) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => backupNow(false), 15000);
}
async function backupNow(manual, keepalive){
  clearTimeout(backupTimer);
  if(!cloudReady()) return;
  const payload = backupPayload(), s = JSON.stringify(payload);
  if(!manual && s === lastSent) return;
  try{
    const t = await rpc('fit_save_backup', {data: payload}, {keepalive: keepalive && s.length < 60000});   // iOS caps keep-alive requests at 64 KB
    lastSent = s;
    data.settings.lastBackup = t || new Date().toISOString();
    skipBackup = true; save(); skipBackup = false;
    if(manual){ toast('Backed up'); if(ui.tab === 'settings' || ui.tab === 'health') renderMain(); }
  }catch(e){ if(manual) toast(e.message); }
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden' && backupTimer) backupNow(false, true);   // leaving the app: send now
  if(document.visibilityState === 'visible') refreshHealth(false);
});
async function restoreBackup(){
  try{
    const r = await rpc('fit_load_backup', {});
    if(!r || !r.data){ toast('No online backup yet'); return; }
    const when = new Date(r.updated_at).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    if(!confirm(`Replace everything on this phone with the online backup from ${when}?`)) return;
    const keep = {sb: data.settings.sb, syncToken: data.settings.syncToken};
    const health = data.health;
    localStorage.setItem(STORE_KEY, JSON.stringify(r.data));
    data = loadData();
    data.settings.sb = keep.sb; data.settings.syncToken = keep.syncToken; data.health = health;
    save(); toast('Restored'); renderAll();
  }catch(e){ toast(e.message); }
}

/* ---------- formatting ---------- */
function hm(min){ if(min == null) return '—'; const m = Math.round(min); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; }
function tFmt(iso){ return iso ? new Date(iso).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : ''; }
function lastNDays(n){ const out = []; for(let i = n - 1; i >= 0; i--){ const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); out.push(keyOf(d)); } return out; }
function weightsSorted(){ return H().weights.slice().sort((a, b) => new Date(a.at) - new Date(b.at)); }

/* ---------- Health page ---------- */
function syncLabel(){
  if(!cloudReady()) return ['Not connected', 'var(--muted)'];
  if(hs.status === 'loading') return ['Syncing…', 'var(--carbs)'];
  if(hs.status === 'error') return ['Sync problem', 'var(--danger)'];
  const s = H().syncedAt;
  if(!s) return ['Waiting for Shortcut', 'var(--carbs)'];
  const d = new Date(s), today = keyOf(new Date()) === keyOf(d);
  return ['Synced ' + (today ? tFmt(s) : d.toLocaleDateString('en-US', {month:'short', day:'numeric'})), 'var(--accent)'];
}
function paintSyncPill(){
  const el = document.getElementById('syncpill'); if(!el) return;
  const [t, c] = syncLabel(); el.innerHTML = `<span style="width:8px;height:8px;border-radius:4px;background:${c}"></span>${esc(t)}`;
}
function stepsRing(steps, goal){
  const r = 52, c = 2 * Math.PI * r, frac = goal > 0 ? Math.min((steps || 0) / goal, 1) : 0;
  return `<svg role="img" aria-label="${fmt(steps || 0)} of ${fmt(goal)} steps" width="128" height="128" viewBox="0 0 128 128" style="flex:none">
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/>
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 64 64)"/>
    <text x="64" y="62" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${steps == null ? '—' : fmt(steps)}</text>
    <text x="64" y="82" text-anchor="middle" font-size="12" font-weight="500" fill="var(--muted)">of ${fmt(goal)}</text></svg>`;
}
function trendChart(metric, keys){
  const days = H().days, today = keyOf(new Date()), goal = data.goals.steps || 10000;
  const val = k => { const d = days[k]; if(!d) return null;
    return metric === 'steps' ? (d.steps != null ? +d.steps : null) : metric === 'sleep' ? (d.sleep_min != null ? d.sleep_min / 60 : null) : (d.resting_hr != null ? +d.resting_hr : null); };
  const vals = keys.map(val);
  const W = 358, Hh = 170, L = 10, R = 10, T = 18, B = 34, n = keys.length;
  const present = vals.filter(v => v != null);
  if(!present.length) return `<div class="msg" style="padding:24px 8px">${metric === 'hr' && !everHas('resting_hr')
    ? 'Resting heart rate comes from an Apple Watch or another heart-rate wearable, so there’s nothing to chart from an iPhone alone.'
    : `No ${metric === 'hr' ? 'heart rate' : metric} data in this range yet.`}</div>`;
  let max = Math.max(...present, metric === 'steps' ? goal * 1.1 : 0), min = 0;
  if(metric === 'hr'){ min = Math.floor(Math.min(...present) - 4); max = Math.ceil(Math.max(...present) + 4); }
  if(metric === 'sleep') max = Math.max(max, 9);
  const slot = (W - L - R) / n, bw = Math.max(4, Math.min(32, slot * 0.7));
  const X = i => L + slot * i + slot / 2, Y = v => T + (1 - (v - min) / (max - min || 1)) * (Hh - T - B);
  let g = `<line x1="${L}" x2="${W - R}" y1="${Hh - B}" y2="${Hh - B}" stroke="var(--line)"/>`;
  // reference lines are drawn after the bars (below) so they stay visible; their labels live in the legend
  let ref = '';
  if(metric === 'steps') ref = `<line x1="${L}" x2="${W - R}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  if(metric === 'sleep') ref = `<line x1="${L}" x2="${W - R}" y1="${Y(8).toFixed(1)}" y2="${Y(8).toFixed(1)}" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  if(metric === 'hr'){
    const pts = vals.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
    g += `<polyline fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    vals.forEach((v, i) => { if(v != null) g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${n > 10 ? 2.5 : 4}" fill="var(--danger)"/>`; });
    g += `<text x="${L}" y="${T - 4}" font-size="11" fill="var(--muted)">${max} bpm</text>`;
  } else {
    vals.forEach((v, i) => {
      if(v == null) return;
      const y = Y(v), h = Hh - B - y, isToday = keys[i] === today && metric === 'steps';   // last night's sleep is already complete
      const hit = metric === 'steps' ? v >= goal : v >= 7;
      const fill = isToday ? 'var(--card)' : hit ? (metric === 'sleep' ? 'var(--protein)' : 'var(--accent)') : (metric === 'sleep' ? 'var(--protein-soft)' : 'var(--accent-mid)');
      g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="${Math.min(6, bw / 3).toFixed(1)}" fill="${fill}" ${isToday ? `stroke="${metric === 'sleep' ? 'var(--protein)' : 'var(--accent)'}" stroke-width="2" stroke-dasharray="4 3"` : ''}/>`;
    });
  }
  g += ref;
  keys.forEach((k, i) => {
    if(n > 10 && i % 5 !== (n - 1) % 5) return;
    const d = dateFromKey(k), lbl = k === today ? 'Today' : n > 10 ? (d.getMonth() + 1) + '/' + d.getDate() : ['Su','M','Tu','W','Th','F','Sa'][d.getDay()];
    g += `<text x="${X(i).toFixed(1)}" y="${Hh - 14}" text-anchor="middle" font-size="11" ${k === today ? 'font-weight="700" fill="var(--ink)"' : 'fill="var(--muted)"'}>${lbl}</text>`;
  });
  const dash = '<span class="lg-dash"></span>';
  const legend = metric === 'steps' ? `<div class="legend"><span><i style="background:var(--accent)"></i>Goal hit</span><span><i style="background:var(--accent-mid)"></i>Under</span><span>${dash}Goal ${fmt(goal)}</span></div>`
    : metric === 'sleep' ? `<div class="legend"><span><i style="background:var(--protein)"></i>7h or more</span><span><i style="background:var(--protein-soft)"></i>Under 7h</span><span>${dash}8 hours</span></div>${
        keys.some(k => days[k] && days[k].sleep_kind === 'inbed') ? '<div class="note" style="margin-top:6px">Without a watch, this is time in bed from your iPhone’s Sleep schedule, so it includes time spent falling asleep.</div>' : ''}`
    : `<div class="legend"><span><i style="background:var(--danger)"></i>Resting heart rate (bpm)</span></div>`;
  return `<svg role="img" aria-label="${metric} per day, last ${n} days" width="100%" viewBox="0 0 ${W} ${Hh}" style="display:block">${g}</svg>${legend}`;
}
function renderHealth(){
  const h = H(), today = keyOf(new Date()), d = h.days[today] || {};
  const goal = data.goals.steps || 10000, steps = d.steps != null ? +d.steps : null;
  const [sl, sc] = syncLabel();
  const rhr7 = lastNDays(7).map(k => h.days[k] && h.days[k].resting_hr).filter(v => v != null).map(Number);
  const metric = ui.hMetric || 'steps', range = ui.hRange || 7, keys = lastNDays(range);
  const vals = keys.filter(k => k !== today || metric === 'hr' || metric === 'sleep').map(k => h.days[k]).filter(Boolean)
    .map(x => metric === 'steps' ? x.steps : metric === 'sleep' ? x.sleep_min : x.resting_hr).filter(v => v != null).map(Number);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const hit = metric === 'steps' ? keys.filter(k => k !== today && h.days[k] && +h.days[k].steps >= goal).length : 0;
  const avgTxt = avg == null ? '—' : metric === 'steps' ? `${fmt(avg)} <small class="sm">steps · goal hit ${hit} of ${range - 1} days</small>`
    : metric === 'sleep' ? `${hm(avg)} <small class="sm">a night</small>` : `${Math.round(avg)} <small class="sm">bpm resting</small>`;

  const ws = weightsSorted(), latest = ws[ws.length - 1];
  const monthAgo = Date.now() - 30 * 864e5;
  const recent = ws.filter(w => new Date(w.at) >= monthAgo);
  const base = recent[0];
  const change = latest && base && latest !== base ? Math.round((latest.lb - base.lb) * 10) / 10 : null;
  let spark = '';
  if(recent.length > 1){
    const W = 358, Hh = 80, ys = recent.map(w => w.lb), lo = Math.min(...ys) - 0.5, hi = Math.max(...ys) + 0.5;
    const t0 = new Date(recent[0].at).getTime(), t1 = new Date(latest.at).getTime();
    const X = t => 8 + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - 16), Y = v => 8 + (1 - (v - lo) / (hi - lo)) * (Hh - 16);
    const pts = recent.map(w => `${X(new Date(w.at).getTime()).toFixed(1)},${Y(w.lb).toFixed(1)}`).join(' ');
    spark = `<svg role="img" aria-label="Weight over the last 30 days, ${recent[0].lb} to ${latest.lb} lb" width="100%" viewBox="0 0 ${W} ${Hh}" style="display:block">
      <polyline fill="none" stroke="var(--protein)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
      <circle cx="${X(t1).toFixed(1)}" cy="${Y(latest.lb).toFixed(1)}" r="5" fill="var(--card)" stroke="var(--protein)" stroke-width="3"/></svg>
      <div class="hs-axis"><span>${new Date(recent[0].at).toLocaleDateString('en-US', {month:'short', day:'numeric'})}</span><span>${dateLabel(keyOf(new Date(latest.at)))}</span></div>`;
  }
  const wlist = ws.slice(-5).reverse().map(w => `<div class="item"><span class="t"><span>${w.lb} lb</span><span class="s">${new Date(w.at).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})} · ${w.source === 'manual' ? 'logged here' : 'Apple Health'}${w.pending ? ' · not synced yet' : ''}</span></span>
    ${w.source === 'manual' ? `<button class="icon-btn plain" data-act="h-del-weight" data-at="${esc(w.at)}" aria-label="Delete ${w.lb} lb entry">${I.x}</button>` : ''}</div>`).join('');

  const lastB = data.settings.lastBackup;
  document.getElementById('app').innerHTML = `<div class="wrap">
    <div class="hdr"><h1>Health</h1><button class="syncpill" id="syncpill" data-act="h-refresh" aria-label="Sync now"><span style="width:8px;height:8px;border-radius:4px;background:${sc}"></span>${esc(sl)}</button></div>
    ${hs.status === 'error' ? `<div class="empty-box" style="margin:0 0 14px;border-color:var(--danger);color:var(--ink)"><b>Couldn’t sync.</b> ${esc(hs.error)}</div>` : ''}
    ${cloudReady() ? '' : `<section class="card" style="padding:18px"><h2 style="font-size:18px;margin-bottom:6px">Connect Apple Health</h2>
      <div class="note" style="margin-bottom:12px">Steps, sleep, heart rate and weight arrive through an Apple Shortcut and a free Supabase database, which also backs up your diet and workouts. Setup takes about 15 minutes, once.</div>
      <button class="btn dark" style="width:100%" data-act="h-goto-setup">Start setup in Settings</button></section>`}
    <section class="card" aria-label="Today">
      <div class="ring-row">${stepsRing(steps, goal)}
        <div style="display:flex;flex-direction:column;gap:10px">
          <div><div class="label">To go</div><div class="big">${steps == null ? '—' : fmt(Math.max(0, goal - steps))} <small>steps</small></div></div>
          <div><div class="label">Distance</div><div class="big">${d.distance_mi != null ? r1(d.distance_mi) : '—'} <small>mi</small></div></div>
        </div></div>
      <div class="tiles">
        <div class="tile sleep"><span>${d.sleep_kind === 'inbed' ? 'In bed' : 'Sleep'}</span><b>${hm(d.sleep_min)}</b><i>${d.bed_at ? tFmt(d.bed_at) + ' – ' + tFmt(d.wake_at) : 'Last night · syncs in the morning'}</i></div>
        <div class="tile heart"><span>Resting HR</span>${everHas('resting_hr')
          ? `<b>${d.resting_hr != null ? Math.round(d.resting_hr) : '—'} <small>bpm</small></b><i>${rhr7.length ? 'Avg ' + Math.round(rhr7.reduce((a, b) => a + b, 0) / rhr7.length) + ' this week' : '7-day average'}</i>`
          : `<b>—</b><i>Needs a watch or heart-rate band</i>`}</div>
        <div class="tile burn"><span>Burned</span>${everHas('active_kcal')
          ? `<b>${d.active_kcal != null ? fmt(d.active_kcal) : '—'} <small>kcal</small></b><i>Active calories</i>`
          : `<b>—</b><i>Usually needs a watch</i>`}</div>
      </div>
    </section>
    <section class="card" aria-label="Trends" style="padding:16px">
      <div class="sec-hd" style="margin-bottom:12px"><h2 style="font-size:18px">Trends</h2>
        <div class="seg" role="group" aria-label="Range" style="padding:3px">${[[7,'7 days'],[30,'30 days']].map(([v, l]) => `<button type="button" data-act="h-range" data-v="${v}" aria-pressed="${range === v}" style="min-height:32px">${l}</button>`).join('')}</div></div>
      <div class="pills" role="group" aria-label="Metric" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:12px">${[['steps','Steps'],['sleep','Sleep'],['hr','Heart rate']].map(([v, l]) => `<button type="button" data-act="h-metric" data-v="${v}" aria-pressed="${metric === v}" style="font-size:14px">${l}</button>`).join('')}</div>
      <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:6px"><span class="note">Daily average</span><b style="font-size:20px">${avgTxt}</b></div>
      ${trendChart(metric, keys)}
    </section>
    <section class="card" aria-label="Weight" style="padding:16px">
      <div class="sec-hd" style="align-items:flex-start"><div><h2 style="font-size:18px">Weight</h2><span class="note">${latest ? (latest.source === 'manual' ? 'Logged here' : 'From Apple Health') + ' · ' + esc(dateLabel(keyOf(new Date(latest.at)))) : 'No entries yet'}</span></div>
        <button class="btn dark" style="height:40px;border-radius:20px" data-act="h-log-weight">+ Log weight</button></div>
      ${latest ? `<div style="display:flex;align-items:baseline;gap:10px;margin:4px 0 8px"><b style="font-size:30px">${latest.lb} <small style="font-size:15px;font-weight:500;color:var(--muted)">lb</small></b>
        ${change != null ? `<b style="font-size:14px;color:${change <= 0 ? 'var(--accent)' : 'var(--over)'}">${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)} lb in 30 days</b>` : ''}</div>` : ''}
      ${spark}
      ${wlist ? `<details style="margin-top:6px"><summary style="min-height:44px;font-size:15px">Recent entries <span style="color:var(--muted);display:flex">${I.chev}</span></summary>${wlist}</details>` : ''}
    </section>
    <section class="card" aria-label="Backup" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
      <span class="okdot" style="${cloudReady() && lastB ? '' : 'background:var(--chip);color:var(--muted)'}">${I.check}</span>
      <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">${cloudReady() ? (lastB ? 'Diet and workouts backed up' : 'Backup turns on after your next change') : 'Not backed up online yet'}</b>
        <span class="note">${cloudReady() ? (lastB ? 'Last backup ' + new Date(lastB).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : 'Backups happen automatically') : 'Connect Supabase in Settings to turn on automatic backups.'}</span></div>
    </section>
  </div>`;
}

/* ---------- Settings section ---------- */
let setupSqlText = null;
function loadSetupSql(){
  if(setupSqlText) return;
  fetch('setup.sql').then(r => r.ok ? r.text() : Promise.reject()).then(t => { setupSqlText = t; }).catch(() => {});
}
function copyText(text, what){
  const done = () => toast(what + ' copied');
  if(navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, what)); }
  else fallbackCopy(text, what);
}
function fallbackCopy(text, what){
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try{ ok = document.execCommand('copy'); }catch(e){}
  ta.remove(); toast(ok ? what + ' copied' : 'Couldn’t copy — long-press to select instead');
}
function healthSettingsHTML(){
  const c = cloud(), tok = ensureToken(), url = cleanUrl(c.url);
  const endpoint = url ? url + '/rest/v1/rpc/fit_push' : 'https://YOUR-PROJECT.supabase.co/rest/v1/rpc/fit_push';
  const legacy = (c.key || '').trim().startsWith('eyJ');
  const lastB = data.settings.lastBackup;
  const copyRow = (label, value, what) => `<div class="copyrow"><div><span class="sublabel">${label}</span><code>${esc(value)}</code></div><button class="btn" data-act="h-copy" data-v="${esc(value)}" data-what="${esc(what)}">Copy</button></div>`;
  loadSetupSql();
  return `<section class="card"><h2 style="margin-bottom:8px">Health & online backup</h2>
    <div class="note" style="margin-bottom:12px">Apple Health data reaches the app through a free Supabase database, which also backs up your diet and workouts automatically.</div>
    <label class="sublabel" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">Daily step goal<input class="inp" id="stepgoal" inputmode="numeric" value="${esc(data.goals.steps || 10000)}"></label>
    <details class="setup" data-keep="conn" ${(ui.open && ui.open.conn != null ? ui.open.conn : !cloudReady()) ? 'open' : ''}>
      <summary>Connection ${cloudReady() ? '<span class="badge ok">Connected</span>' : '<span class="badge">Not set up</span>'} <span style="color:var(--muted);display:flex;margin-left:auto">${I.chev}</span></summary>
      <ol class="steps">
        <li><b>Create the database.</b> At supabase.com, sign in (GitHub works) and create a new project on the free plan. Save the database password it asks for; the app doesn’t need it.</li>
        <li><b>Run the setup.</b> Copy the setup script, then in Supabase open <b>SQL Editor</b>, paste it, and tap <b>Run</b>. It already contains your private sync token.
          <button class="btn dark" style="width:100%;margin-top:8px" data-act="h-copy-sql">Copy setup script</button></li>
        <li><b>Connect the app.</b> In Supabase, open <b>Project Settings → API Keys</b> (or the <b>Connect</b> button) and copy the <b>Project URL</b> and the <b>publishable</b> key (an older project may show an “anon public” key instead; either works). Paste both here:
          <div class="note" style="margin-top:8px">Can’t find the URL? Just copy the address from your browser while you’re in the project (it looks like supabase.com/dashboard/project/abcd…) and paste it here; the app works out the rest.</div>
          <label class="sublabel" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">Project URL<input class="inp" id="sb-url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://abcd1234.supabase.co" value="${esc(c.url || '')}"></label>
          <label class="sublabel" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">Publishable (or anon) key<input class="inp" id="sb-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sb_publishable_…" value="${esc(c.key || '')}"></label>
          <button class="btn" style="width:100%;margin-top:10px" data-act="h-test">Test connection</button></li>
        <li><b>Build the Apple Shortcut.</b> Steps are below under “Apple Shortcut”. You’ll need these values:
          ${copyRow('URL', endpoint, 'URL')}
          ${copyRow('Header: apikey', c.key || '(paste your key above first)', 'Key')}
          ${legacy ? copyRow('Header: Authorization', 'Bearer ' + c.key, 'Authorization header') : ''}
          ${copyRow('Body field: token', tok, 'Token')}</li>
      </ol>
    </details>
    <details class="setup" data-keep="shortcut" ${ui.open && ui.open.shortcut ? 'open' : ''}>
      <summary>Apple Shortcut <span style="color:var(--muted);display:flex;margin-left:auto">${I.chev}</span></summary>
      <div class="note" style="margin:0 0 8px">In the Shortcuts app, tap <b>+</b>, name it <b>Fitness Sync</b>, and add these actions in order. Tap a blue variable to rename it (long-press → Rename) so the names match.</div>
      <ol class="steps">
        <li><b>Find Health Samples</b> → Type <b>Steps</b>, add filter <b>Start Date is Today</b>, <b>Group By: Day</b>. Rename the result <b>Steps</b>.</li>
        <li>Same for <b>Active Energy</b> → rename <b>Active</b>.</li>
        <li>Same for <b>Walking + Running Distance</b> → rename <b>Distance</b>.</li>
        <li><b>Find Health Samples</b> → Type <b>Resting Heart Rate</b>, Sort by <b>Start Date</b>, Order <b>Latest First</b>, <b>Limit 1</b>. Rename <b>RHR</b>.</li>
        <li>Same for <b>Weight</b> (Latest First, Limit 1). Rename <b>Weight</b>.</li>
        <li><b>Find Health Samples</b> → Type <b>Sleep Analysis</b>, filter <b>Start Date is in the last 1 days</b>.</li>
        <li><b>Repeat with Each</b> item in those sleep samples. Inside it, add a <b>Text</b> action:
          <code class="blk">Value;Start Date;End Date</code> using the Repeat Item’s <b>Value</b>, <b>Start Date</b> and <b>End Date</b> (tap each date → Date Format <b>ISO 8601</b>, include time), with semicolons between.</li>
        <li>After <b>End Repeat</b>: <b>Combine Text</b> → Repeat Results, separator <b>Custom</b>: <code>|</code>. Rename <b>Sleep</b>.</li>
        <li><b>Format Date</b> → Current Date, Custom format <code>yyyy-MM-dd</code>. Rename <b>Day</b>.</li>
        <li><b>Get Contents of URL</b> → paste the URL above. Tap <b>Show More</b>: Method <b>POST</b>; Headers: <b>apikey</b> = your key${legacy ? ', <b>Authorization</b> = the value above' : ''}; Request Body <b>JSON</b> with these Text fields:
          <code class="blk">token = (your token)
day = Day
steps = Steps
active = Active
distance = Distance
resting_hr = RHR
weight = Weight
weight_at = Weight › Start Date (ISO 8601)
sleep = Sleep</code></li>
        <li>Run it once: Shortcuts asks to allow Health access (allow all) and the result should be <b>ok</b>.</li>
        <li><b>Make it automatic:</b> Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → 8:00 AM, Daily, <b>Run Immediately</b> → Fitness Sync. Add a second one at <b>11:45 PM</b> so the day’s full step count gets in.</li>
      </ol>
    </details>
    <div class="grid2" style="margin:12px 0 0">
      <button class="btn" data-act="h-backup" ${cloudReady() ? '' : 'disabled'}>Back up now</button>
      <button class="btn" data-act="h-restore" ${cloudReady() ? '' : 'disabled'}>Restore online backup</button></div>
    <div class="note" style="margin-top:8px">${cloudReady() ? (lastB ? 'Last online backup: ' + new Date(lastB).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) + '. Backups run automatically after changes.' : 'Backups run automatically after your next change.') : 'Online backup turns on once the connection is set up.'}</div>
  </section>`;
}
function saveCloudInputs(){
  const u = document.getElementById('sb-url'), k = document.getElementById('sb-key'), g = document.getElementById('stepgoal');
  data.settings.sb = {url: u ? cleanUrl(u.value) : cloud().url, key: k ? k.value.trim() : cloud().key};
  if(g){ const v = parseInt(g.value, 10); if(v >= 100 && v <= 100000) data.goals.steps = v; }
  save();
}

/* ---------- burned calories on the Diet page ---------- */
function burnToggleHTML(){
  const on = !!data.settings.countBurn;
  return `<div class="switchrow"><div><label for="burnsw">Count calories burned</label><span>Adds the day’s active calories from Apple Health to your calorie goal.${on && !everHas('active_kcal') ? ' Apple Health hasn’t sent any yet; without a watch there may be none.' : ''}</span></div>
    <button id="burnsw" class="switch" role="switch" aria-checked="${on}" data-act="burn-toggle"><i></i></button></div>`;
}

/* ---------- sheets ---------- */
function hSheetHTML(s){
  if(s.type !== 'logWeight') return null;
  const ws = weightsSorted(), last = ws[ws.length - 1];
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return `<div class="grab"></div><div class="sec" style="gap:2px"><h2>Log weight</h2><div class="note">${cloudReady() ? 'Saved here and in your online database.' : 'Saved on this phone. It syncs once Supabase is connected.'}</div></div>
    <div class="form-grid" style="margin-bottom:16px">
      <label>Weight (lb)<input class="inp" id="w-lb" inputmode="decimal" placeholder="${last ? last.lb : 'e.g. 170'}"></label>
      <label>When<input class="inp" id="w-at" type="datetime-local" value="${now.toISOString().slice(0, 16)}"></label></div>
    <button class="btn primary" data-act="h-save-weight">Save</button>`;
}

/* ---------- actions ---------- */
const H_ACTIONS = {
  'h-refresh'(){ if(!cloudReady()){ ui.tab = 'settings'; data.settings.tab = 'settings'; renderAll(); return; } refreshHealth(true); },
  'h-goto-setup'(){ ui.tab = 'settings'; data.settings.tab = 'settings'; save(); window.scrollTo(0, 0); renderAll(); },
  'h-range'(el){ ui.hRange = +el.dataset.v; renderMain(); },
  'h-metric'(el){ ui.hMetric = el.dataset.v; renderMain(); },
  'h-log-weight'(){ ui.sheet = {type:'logWeight'}; renderLayer(); },
  async 'h-save-weight'(){
    const lb = parseFloat(String(document.getElementById('w-lb').value).replace(',', '.'));
    const atv = document.getElementById('w-at').value;
    if(!(lb > 30 && lb < 1000)){ toast('Enter your weight in pounds'); return; }
    const at = (atv ? new Date(atv) : new Date()).toISOString();
    const entry = {at, lb: Math.round(lb * 10) / 10, source: 'manual', pending: true};
    H().weights.push(entry); save(); ui.sheet = null; renderAll(); toast('Weight saved');
    if(cloudReady()){ try{ await rpc('fit_add_weight', {at, lb: entry.lb}); entry.pending = false; save(); renderMain(); }catch(e){ toast(e.message); } }
  },
  async 'h-del-weight'(el){
    const at = el.dataset.at, h = H(), i = h.weights.findIndex(w => w.at === at);
    if(i < 0) return;
    const w = h.weights.splice(i, 1)[0]; save(); renderMain();
    if(cloudReady() && !w.pending){ try{ await rpc('fit_del_weight', {at}); }catch(e){ toast(e.message); } }
  },
  'h-copy'(el){ copyText(el.dataset.v, el.dataset.what); },
  'h-copy-sql'(){
    if(!setupSqlText){ toast('Still loading — try again in a second'); loadSetupSql(); return; }
    copyText(setupSqlText.replace('__TOKEN__', ensureToken()), 'Setup script');
  },
  async 'h-test'(){
    saveCloudInputs();
    if(!cloudReady()){ toast('Paste the Project URL and key first'); return; }
    try{ await rpc('fit_ping', {}); toast('Connected!'); H().fetchedAt = 0; refreshHealth(true); backupNow(true); renderMain(); }
    catch(e){ toast(e.message || 'Couldn’t connect'); }
  },
  'h-backup'(){ backupNow(true); },
  'h-restore'(){ restoreBackup(); },
  'burn-toggle'(){ data.settings.countBurn = !data.settings.countBurn; save(); renderMain(); }
};

// remember which setup sections are open across re-renders
document.addEventListener('toggle', ev => {
  const k = ev.target.dataset && ev.target.dataset.keep;
  if(k){ ui.open = ui.open || {}; ui.open[k] = ev.target.open; }
}, true);
