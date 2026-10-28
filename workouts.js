'use strict';
/* =====================================================================
   Workouts tab. Loaded before the main script; everything here is called
   later, so it can use the shared helpers (data, ui, esc, save, toast…).
   ===================================================================== */

const MUSCLES = ['Chest','Back','Shoulders','Legs','Arms','Core'];
const EQUIP = ['Barbell','Dumbbell','Machine','Cable','Bodyweight','Kettlebell','Other'];
const CARDIO_TYPES = ['Treadmill','Bike','Stairmaster','Elliptical','Rower','Outdoor run','Walk','Jump rope','Other cardio'];
const LIB = [
  ['bench','Bench press','Barbell','Chest'],['incline-bench','Incline bench press','Barbell','Chest'],
  ['db-bench','Dumbbell bench press','Dumbbell','Chest'],['incline-db','Incline dumbbell press','Dumbbell','Chest'],
  ['chest-press','Chest press','Machine','Chest'],['chest-fly','Cable fly','Cable','Chest'],['pec-deck','Pec deck','Machine','Chest'],
  ['pushup','Push-up','Bodyweight','Chest'],['dips','Dips','Bodyweight','Chest'],
  ['deadlift','Deadlift','Barbell','Back'],['bb-row','Barbell row','Barbell','Back'],['db-row','Dumbbell row','Dumbbell','Back'],
  ['tbar-row','T-bar row','Barbell','Back'],['lat-pulldown','Lat pulldown','Cable','Back'],['seated-row','Seated cable row','Cable','Back'],
  ['pullup','Pull-up','Bodyweight','Back'],['chinup','Chin-up','Bodyweight','Back'],['face-pull','Face pull','Cable','Back'],
  ['ohp','Overhead press','Barbell','Shoulders'],['db-shoulder','Dumbbell shoulder press','Dumbbell','Shoulders'],
  ['lateral-raise','Lateral raise','Dumbbell','Shoulders'],['rear-delt','Rear delt fly','Dumbbell','Shoulders'],
  ['front-raise','Front raise','Dumbbell','Shoulders'],['shrug','Shrug','Dumbbell','Shoulders'],
  ['squat','Back squat','Barbell','Legs'],['front-squat','Front squat','Barbell','Legs'],['rdl','Romanian deadlift','Barbell','Legs'],
  ['leg-press','Leg press','Machine','Legs'],['hack-squat','Hack squat','Machine','Legs'],['goblet','Goblet squat','Dumbbell','Legs'],
  ['lunge','Walking lunge','Dumbbell','Legs'],['bulgarian','Bulgarian split squat','Dumbbell','Legs'],
  ['leg-ext','Leg extension','Machine','Legs'],['leg-curl','Leg curl','Machine','Legs'],['hip-thrust','Hip thrust','Barbell','Legs'],
  ['calf-raise','Calf raise','Machine','Legs'],
  ['bb-curl','Barbell curl','Barbell','Arms'],['db-curl','Dumbbell curl','Dumbbell','Arms'],['hammer-curl','Hammer curl','Dumbbell','Arms'],
  ['preacher','Preacher curl','Machine','Arms'],['pushdown','Triceps pushdown','Cable','Arms'],['skull','Skull crusher','Barbell','Arms'],
  ['oh-ext','Overhead triceps extension','Dumbbell','Arms'],['cgbp','Close-grip bench press','Barbell','Arms'],
  ['cable-crunch','Cable crunch','Cable','Core'],['leg-raise','Hanging leg raise','Bodyweight','Core'],['situp','Sit-up','Bodyweight','Core'],
  ['russian','Russian twist','Bodyweight','Core'],['ab-wheel','Ab wheel rollout','Bodyweight','Core']
].map(([id, name, equip, muscle]) => ({id, name, equip, muscle}));

/* ---------- helpers ---------- */
function allEx(){ return LIB.concat(data.customEx || []); }
function exById(id){ return allEx().find(e => e.id === id) || {id, name:'Removed exercise', equip:'Other', muscle:''}; }
function isBW(id){ return exById(id).equip === 'Bodyweight'; }
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
function e1rm(w, r){ if(!(r > 0)) return 0; w = w || 0; return r === 1 ? w : w * (1 + r / 30); }
function setMetric(exId, s){ return isBW(exId) ? (s.r || 0) + (s.w || 0) / 1000 : e1rm(s.w, s.r); }
function setText(exId, s){
  if(s.w == null && s.r == null) return '—';
  if(isBW(exId)) return (s.w ? '+' + s.w + ' × ' : '') + s.r + ' reps';
  return s.w + ' × ' + s.r;
}
function durText(ms){
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min';
}
function clock(ms){
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function dateLabel(k){
  const t = keyOf(new Date());
  if(k === t) return 'Today';
  if(k === keyOf(new Date(Date.now() - 864e5))) return 'Yesterday';
  return dateFromKey(k).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
}
function wkVolume(w){ return w.exercises.reduce((v, x) => v + (isBW(x.exId) ? 0 : x.sets.reduce((a, s) => a + (s.w || 0) * (s.r || 0), 0)), 0); }
function wkCardioMin(w){ return (w.cardio || []).reduce((a, c) => a + (c.min || 0), 0); }
function wkSummary(w){
  const parts = (w.cardio || []).map(c => c.type + (c.min ? ' ' + c.min + ' min' : '') + (c.dist ? ' · ' + c.dist + ' mi' : ''));
  const n = w.exercises.length;
  if(n) parts.push(n + ' lift' + (n === 1 ? '' : 's'));
  const vol = wkVolume(w);
  if(vol) parts.push(fmt(vol) + ' lb volume');
  return parts.join(' · ') || 'No sets logged';
}
function wTop(){ return ui.wstack[ui.wstack.length - 1]; }
function wPush(s){ ui.wstack.push(s); renderLayer(); }
function wPop(){ ui.wstack.pop(); renderAll(); }

/* ---------- sound for the rest timer (iOS allows it after a tap) ---------- */
let audioCtx = null;
function ensureAudio(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){}
}
function beep(){
  try{
    if(!audioCtx) return;
    [0, 0.25, 0.5].forEach(t => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.3, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.start(s); o.stop(s + 0.2);
    });
  }catch(e){}
  if(navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

/* ---------- main Workouts page ---------- */
function weekRange(){
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const start = new Date(t); start.setDate(t.getDate() - t.getDay());
  const days = [];
  for(let i = 0; i < 7; i++){ const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  return days;
}
function wCalendar(){
  const now = new Date(), Y = now.getFullYear(), m = ui.wCalMonth ?? now.getMonth(), todayK = keyOf(now);
  const start = new Date(Y, m, 1).getDay(), dim = new Date(Y, m + 1, 0).getDate();
  const has = new Set(data.workouts.map(w => w.date));
  let cells = ['S','M','T','W','T','F','S'].map(x => `<div class="cal-dow" aria-hidden="true">${x}</div>`).join('');
  for(let i = 0; i < start; i++) cells += '<div></div>';
  for(let d = 1; d <= dim; d++){
    const k = keyOf(new Date(Y, m, d));
    const cls = ['cal-day', k === ui.wDay ? 'sel' : '', k === todayK ? 'today' : ''].join(' ');
    cells += `<button class="${cls}" data-act="w-pick-day" data-k="${k}" ${k > todayK ? 'disabled' : ''} aria-label="${dateFromKey(k).toLocaleDateString('en-US', {month:'long', day:'numeric'})}${has.has(k) ? ', workout logged' : ''}">${d}${has.has(k) ? '<span class="dot"></span>' : ''}</button>`;
  }
  return `<div class="cal" role="group" aria-label="Pick a day">
    <div class="cal-hd">
      <button class="icon-btn plain" data-act="w-cal-prev" aria-label="Previous month" ${m === 0 ? 'disabled style="opacity:.3"' : ''}>${I.left}</button>
      <b>${MONTHS[m]} ${Y}</b>
      <button class="icon-btn plain" data-act="w-cal-next" aria-label="Next month" ${m === 11 ? 'disabled style="opacity:.3"' : ''}>${I.right}</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend"><span><span style="width:6px;height:6px;border-radius:3px;background:var(--accent)"></span>Workout</span>
      ${ui.wDay ? '<button class="link" style="min-height:0;margin-left:auto" data-act="w-all">Show all</button>' : ''}</div>
  </div>`;
}
function renderWorkouts(){
  const todayK = keyOf(new Date());
  const days = weekRange(), wkKeys = days.map(keyOf);
  const thisWeek = data.workouts.filter(w => wkKeys.includes(w.date));
  const dayHas = new Set(thisWeek.map(w => w.date));
  const wkTime = thisWeek.reduce((a, w) => a + (w.end - w.start), 0);
  const wkCardio = thisWeek.reduce((a, w) => a + wkCardioMin(w), 0);
  const fmtD = d => d.toLocaleDateString('en-US', {month:'short', day:'numeric'});

  const routines = data.routines.map((r, i) => {
    const names = (r.cardio || []).map(c => c.type).concat(r.exercises.map(x => exById(x.exId).name));
    return `<button class="rcard" data-act="w-routine" data-i="${i}">
      <span class="rn">${esc(r.name)}</span>
      <span class="rs">${esc(names.join(' · ') || 'Empty routine')}</span>
      <span class="rl">${r.lastUsed ? 'Last: ' + esc(dateLabel(r.lastUsed)) : 'Not used yet'}</span></button>`;
  }).join('');

  let hist = data.workouts.slice().sort((a, b) => b.start - a.start);
  if(ui.wDay) hist = hist.filter(w => w.date === ui.wDay);
  const shown = ui.wDay ? hist : hist.slice(0, ui.wHistN || 10);
  const histHTML = shown.map(w => {
    const prs = w.exercises.reduce((a, x) => a + x.sets.filter(s => s.pr).length, 0);
    return `<button class="hcard" data-act="w-detail" data-id="${w.id}">
      <span class="hrow"><b>${esc(w.name)}</b><span>${esc(dateLabel(w.date))} · ${durText(w.end - w.start)}</span></span>
      <span class="hs">${esc(wkSummary(w))}</span>
      ${prs ? `<span class="pr-badge">${prs} new PR${prs === 1 ? '' : 's'}</span>` : ''}</button>`;
  }).join('');

  const a = data.active;
  document.getElementById('app').innerHTML = `<div class="wrap">
    <div class="hdr"><h1>Workouts</h1><button class="icon-btn" data-act="w-library" aria-label="Exercise library">${I.book}</button></div>
    ${a ? `<button class="resume" data-act="w-resume"><span><b>${esc(a.name)}</b> in progress</span><span class="rt" id="resume-time2">${clock(Date.now() - a.start)}</span><span class="rgo">Resume</span></button>`
        : `<button class="btn primary" style="height:60px;font-size:18px;margin-bottom:14px" data-act="w-start">${I.play} Start empty workout</button>`}
    <section aria-label="Routines" style="margin-bottom:14px">
      <div class="sec-hd"><h2>Routines</h2><button class="link" data-act="w-new-routine">+ New routine</button></div>
      <div class="rgrid">${routines}<button class="rcard dashed" data-act="w-new-routine">+ New routine</button></div>
    </section>
    <section class="card" aria-label="This week" style="padding:18px">
      <div class="sec-hd" style="margin:0 0 12px"><h2 style="font-size:18px">This week</h2><span class="note">${fmtD(days[0])} – ${fmtD(days[6])}</span></div>
      <div class="stat3">
        <div><span class="label">Workouts</span><b>${thisWeek.length}</b></div>
        <div><span class="label">Time</span><b>${thisWeek.length ? durText(wkTime) : '0 min'}</b></div>
        <div><span class="label">Cardio</span><b>${wkCardio} min</b></div>
      </div>
      <div class="weekdots">${days.map(d => { const k = keyOf(d); return `<div><span>${'SMTWTFS'[d.getDay()]}</span><i class="${dayHas.has(k) ? 'on' : k > todayK ? 'future' : ''} ${k === todayK ? 'today' : ''}">${d.getDate()}</i></div>`; }).join('')}</div>
    </section>
    <section aria-label="History">
      <div class="sec-hd"><h2>${ui.wDay ? esc(dateLabel(ui.wDay)) : 'History'}</h2>
        <button class="link" data-act="w-cal" aria-expanded="${!!ui.wCalOpen}" style="display:flex;align-items:center;gap:6px">${I.cal} Calendar</button></div>
      ${ui.wCalOpen ? wCalendar() : ''}
      ${histHTML || `<div class="empty-box" style="margin:0 0 12px">${ui.wDay ? 'No workout on this day.' : 'Finished workouts show up here.'}</div>`}
      ${!ui.wDay && hist.length > shown.length ? '<button class="btn" style="width:100%" data-act="w-more">Show more</button>' : ''}
    </section>
  </div>`;
}

/* ---------- active workout ---------- */
function newActive(name, routine){
  const a = {id: uid(), name: name || 'Workout', routineId: routine ? routine.id : null, start: Date.now(), cardio: [], exercises: [], rest: null};
  if(routine){
    a.cardio = (routine.cardio || []).map(c => ({id: uid(), type: c.type, min: '', dist: '', kcal: '', goalMin: c.min || null}));
    a.exercises = routine.exercises.map(x => ({exId: x.exId, sets: Array.from({length: Math.max(1, x.sets || 3)}, () => ({w:'', r:'', done:false}))}));
  }
  return a;
}
function prevFor(exId, i){
  const ls = (data.lastSets || {})[exId];
  if(!ls || !ls.length) return null;
  return ls[Math.min(i, ls.length - 1)];
}
function cardioBlock(c, i){
  const last = (data.lastCardio || {})[c.type];
  const lastTxt = last ? 'Last time: ' + [last.min ? last.min + ' min' : '', last.dist ? last.dist + ' mi' : '', last.kcal ? last.kcal + ' kcal' : ''].filter(Boolean).join(' · ') : '';
  const f = (k, lbl, ph) => `<label>${lbl}<input class="cin" data-cardio="${i}" data-field="${k}" inputmode="decimal" placeholder="${esc(ph || '—')}" value="${esc(c[k])}"></label>`;
  return `<section class="wcard" aria-label="${esc(c.type)}">
    <div class="wc-hd"><div><span class="kicker">${i === 0 && !data.active.exercises.length ? 'Cardio' : 'Cardio warmup'}</span><b>${esc(c.type)}</b></div>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="done-pill ${c.done ? 'on' : ''}" data-act="w-cardio-done" data-i="${i}" aria-pressed="${!!c.done}">${I.check} ${c.done ? 'Done' : 'Mark done'}</button>
        <button class="icon-btn plain" data-act="w-cardio-rm" data-i="${i}" aria-label="Remove ${esc(c.type)}">${I.x}</button></div></div>
    <div class="c3">${f('min', 'Time (min)', c.goalMin || (last && last.min) || '')}${f('dist', 'Distance (mi)', (last && last.dist) || '')}${f('kcal', 'Calories', '')}</div>
    ${lastTxt ? `<div class="note">${esc(lastTxt)}</div>` : ''}
  </section>`;
}
function exBlock(x, ei){
  const ex = exById(x.exId), bw = ex.equip === 'Bodyweight';
  const rows = x.sets.map((s, si) => {
    const p = prevFor(x.exId, si);
    const pw = p ? (p.w || '') : '', pr = p ? p.r : '';
    return `<div class="setrow ${s.done ? 'done' : ''}">
      <span class="sn">${si + 1}</span>
      <span class="sp">${p ? esc(setText(x.exId, p)) : '—'}</span>
      <input class="sin" data-ex="${ei}" data-set="${si}" data-field="w" inputmode="decimal" aria-label="Set ${si + 1} ${bw ? 'added weight' : 'weight'}" placeholder="${esc(pw)}" value="${esc(s.w)}">
      <span class="rwrap"><input class="sin" data-ex="${ei}" data-set="${si}" data-field="r" inputmode="numeric" aria-label="Set ${si + 1} reps" placeholder="${esc(pr)}" value="${esc(s.r)}">${s.pr ? '<span class="prt">PR</span>' : ''}</span>
      <button class="chk ${s.done ? 'on' : ''}" data-act="w-set-done" data-ex="${ei}" data-set="${si}" aria-pressed="${!!s.done}" aria-label="Set ${si + 1} done">${I.check}</button>
    </div>`;
  }).join('');
  return `<section class="wcard" aria-label="${esc(ex.name)}">
    <div class="wc-hd"><button class="exname" data-act="w-ex-open" data-id="${ex.id}"><b>${esc(ex.name)}</b><span>${esc(ex.equip)}${ex.muscle ? ' · ' + esc(ex.muscle) : ''}</span></button>
      <button class="icon-btn plain" data-act="w-ex-menu" data-ex="${ei}" aria-label="Options for ${esc(ex.name)}">${I.dots}</button></div>
    <div class="sethd"><span>Set</span><span>Previous</span><span>${bw ? '+lb' : 'lb'}</span><span>Reps</span><span></span></div>
    ${rows}
    <div class="grid2" style="margin:4px 0 0"><button class="btn soft" data-act="w-set-add" data-ex="${ei}">+ Add set</button><button class="btn soft" data-act="w-set-rm" data-ex="${ei}" ${x.sets.length ? '' : 'disabled'}>− Remove set</button></div>
  </section>`;
}
function activeScreen(){
  const a = data.active;
  if(!a) return '';
  const rest = a.rest && a.rest.end > Date.now() ? a.rest : null;
  return `<div class="screen" role="dialog" aria-label="Active workout">
    <div class="screen-hd">
      <div class="top">
        <button class="icon-btn plain" data-act="w-minimize" aria-label="Minimize workout">${I.chev}</button>
        <button class="wtitle" data-act="w-rename"><b>${esc(a.name)}</b><span id="elapsed">${clock(Date.now() - a.start)}</span></button>
        <button class="btn" style="background:var(--accent);color:var(--on-accent);border-color:var(--accent);height:40px;border-radius:20px" data-act="w-finish">Finish</button>
      </div>
      <div class="restbar" id="restbar" role="timer" aria-label="Rest timer" ${rest ? '' : 'hidden'}>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:600">Rest</span><b id="rest-left" style="font-variant-numeric:tabular-nums;font-size:15px">${rest ? clock(rest.end - Date.now()) + ' / ' + clock(rest.total * 1000) : ''}</b></div>
          <div class="rtrack"><div id="rest-fill" style="width:${rest ? Math.max(0, (rest.end - Date.now()) / (rest.total * 10)) : 0}%"></div></div>
        </div>
        <button data-act="w-rest-add">+15s</button><button data-act="w-rest-skip">Skip</button>
      </div>
    </div>
    <div style="padding:4px 16px calc(32px + env(safe-area-inset-bottom));max-width:520px;margin:0 auto">
      ${a.cardio.map(cardioBlock).join('')}
      ${a.exercises.map(exBlock).join('')}
      ${!a.cardio.length && !a.exercises.length ? '<div class="empty-box" style="margin:0 0 12px">Add your cardio warmup, then your lifts.</div>' : ''}
      <div class="grid2"><button class="btn" style="height:48px" data-act="w-add-ex" data-target="active">+ Add exercise</button><button class="btn" style="height:48px" data-act="w-add-cardio" data-target="active">+ Add cardio</button></div>
      <button class="link" style="width:100%;color:var(--danger)" data-act="w-discard">Discard workout</button>
    </div>
  </div>`;
}

/* ---------- exercise picker & library ---------- */
function pickerScreen(s){
  return `<div class="screen" role="dialog" aria-label="${s.target ? 'Add exercise' : 'Exercise library'}">
    <div class="screen-hd">
      <div class="top"><div><button class="icon-btn plain" data-act="w-back" aria-label="Back">${I.left}</button><h1>${s.target === 'replace' ? 'Replace with…' : s.target ? 'Add exercise' : 'Exercises'}</h1></div>
        <button class="btn dark" style="height:40px;border-radius:20px" data-act="w-custom-ex">+ Custom</button></div>
      <div class="field"><span style="display:flex">${I.search}</span><label class="sr" for="pq">Filter exercises</label>
        <input id="pq" type="search" autocomplete="off" placeholder="Filter, e.g. press" value="${esc(s.q || '')}"></div>
    </div>
    <div id="plist" style="padding:0 16px 24px;max-width:520px;margin:0 auto"></div>
  </div>`;
}
function renderPickList(){
  const box = document.getElementById('plist'), s = wTop();
  if(!box || !s || s.type !== 'picker') return;
  const q = (s.q || '').trim().toLowerCase();
  const list = allEx().filter(e => !q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q) || e.equip.toLowerCase().includes(q));
  const groups = MUSCLES.concat(['Other']).map(m => {
    const items = list.filter(e => (MUSCLES.includes(e.muscle) ? e.muscle : 'Other') === m).sort((a, b) => a.name.localeCompare(b.name));
    if(!items.length) return '';
    return `<div class="label" style="padding:12px 4px 6px">${m}</div><div class="meal">${items.map(e =>
      `<button class="row" data-act="w-pick-ex" data-id="${e.id}"><span class="t"><span class="n">${esc(e.name)}</span><span class="s">${esc(e.equip)}${e.custom ? ' · Custom' : ''}</span></span>${(data.bests || {})[e.id] ? '<span class="k" style="color:var(--muted);font-size:13px">' + esc(bestLine(e.id)) + '</span>' : ''}</button>`).join('')}</div>`;
  }).join('');
  box.innerHTML = groups || `<div class="msg">No exercises match. Tap “+ Custom” to create “${esc(s.q)}”.</div>`;
}
function bestLine(id){ const b = data.bests[id]; if(!b || !b.bestSet) return ''; return 'Best ' + setText(id, b.bestSet); }

/* ---------- routine editor ---------- */
function routineScreen(s){
  const d = s.draft;
  const cardio = d.cardio.map((c, i) => `<div class="item"><span class="t"><span>${esc(c.type)}</span><span class="s">Cardio warmup</span></span>
      <label class="sr" for="rc${i}">Target minutes</label><input id="rc${i}" class="inp" style="width:84px;text-align:center" data-rcardio="${i}" inputmode="numeric" placeholder="min" value="${esc(c.min || '')}">
      <button class="icon-btn plain" data-act="w-r-rmc" data-i="${i}" aria-label="Remove ${esc(c.type)}">${I.x}</button></div>`).join('');
  const ex = d.exercises.map((x, i) => `<div class="item"><span class="t"><span>${esc(exById(x.exId).name)}</span><span class="s">${esc(exById(x.exId).equip)}</span></span>
      <div class="stepper" style="flex:none"><button type="button" data-act="w-r-sets-" data-i="${i}" aria-label="Fewer sets">−</button><span style="min-width:52px;text-align:center;font-weight:700;font-size:15px">${x.sets} sets</span><button type="button" data-act="w-r-sets+" data-i="${i}" aria-label="More sets">+</button></div>
      <div style="display:flex;flex-direction:column"><button class="mini" data-act="w-r-up" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button class="mini" data-act="w-r-down" data-i="${i}" aria-label="Move down" ${i < d.exercises.length - 1 ? '' : 'disabled'}>▼</button></div>
      <button class="icon-btn plain" data-act="w-r-rmx" data-i="${i}" aria-label="Remove ${esc(exById(x.exId).name)}">${I.x}</button></div>`).join('');
  return `<div class="screen" role="dialog" aria-label="Routine">
    <div class="screen-hd"><div class="top"><div><button class="icon-btn plain" data-act="w-back" aria-label="Cancel">${I.left}</button><h1>${s.isNew ? 'New routine' : 'Edit routine'}</h1></div>
      <button class="btn" style="background:var(--accent);color:var(--on-accent);border-color:var(--accent);height:40px;border-radius:20px" data-act="w-r-save">Save</button></div></div>
    <div class="wrap">
      <section class="card" style="padding:16px"><label class="sublabel" style="display:flex;flex-direction:column;gap:6px">Name<input class="inp" id="rname" placeholder="e.g. Push day" value="${esc(d.name)}"></label></section>
      <section class="card" style="padding:16px"><h2 style="font-size:17px;margin-bottom:4px">Cardio warmup</h2>${cardio || '<div class="note" style="padding:6px 0">None — add one below.</div>'}
        <button class="btn soft" style="width:100%;margin-top:8px" data-act="w-add-cardio" data-target="routine">+ Add cardio</button></section>
      <section class="card" style="padding:16px"><h2 style="font-size:17px;margin-bottom:4px">Lifts</h2>${ex || '<div class="note" style="padding:6px 0">No exercises yet.</div>'}
        <button class="btn soft" style="width:100%;margin-top:8px" data-act="w-add-ex" data-target="routine">+ Add exercise</button></section>
      ${s.isNew ? '' : '<button class="link" style="width:100%;color:var(--danger)" data-act="w-r-delete">Delete routine</button>'}
    </div>
  </div>`;
}

/* ---------- exercise detail ---------- */
function sessionsFor(exId){
  return data.workouts.filter(w => w.exercises.some(x => x.exId === exId)).sort((a, b) => a.start - b.start).map(w => {
    const sets = w.exercises.filter(x => x.exId === exId).flatMap(x => x.sets);
    const best = sets.reduce((b, s) => setMetric(exId, s) > setMetric(exId, b || {}) ? s : b, null);
    return {w, sets, best, metric: best ? (isBW(exId) ? best.r : e1rm(best.w, best.r)) : 0};
  });
}
function chartSVG(points, bw){
  if(points.length < 2) return `<div class="msg" style="padding:16px 0">${points.length ? 'One session so far — the chart appears after your second.' : 'No sessions in this range.'}</div>`;
  const W = 326, H = 170, L = 38, R = 14, T = 22, B = 30;
  const xs = points.map(p => p.t), ys = points.map(p => p.v);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(2, (y1 - y0) * 0.15); y0 = Math.floor(y0 - pad); y1 = Math.ceil(y1 + pad);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => L + (x1 === x0 ? (W - L - R) / 2 : (t - x0) / (x1 - x0) * (W - L - R));
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const grid = [y1, (y0 + y1) / 2, y0].map(v => `<line x1="${L}" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)"/><text x="0" y="${(Y(v) + 4).toFixed(1)}" font-size="11" fill="var(--muted)">${Math.round(v)}</text>`).join('');
  const pts = points.map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const dl = t => new Date(t).toLocaleDateString('en-US', {month:'short', day:'numeric'});
  return `<svg role="img" aria-label="${bw ? 'Best reps' : 'Estimated 1-rep max'} from ${Math.round(points[0].v)} to ${Math.round(last.v)}" width="100%" viewBox="0 0 ${W} ${H}" style="display:block">
    ${grid}<polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
    ${points.map((p, i) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${i === points.length - 1 ? 5.5 : 3.5}" fill="${i === points.length - 1 ? 'var(--card)' : 'var(--accent)'}" stroke="var(--accent)" stroke-width="${i === points.length - 1 ? 3 : 0}"/>`).join('')}
    <text x="${X(last.t).toFixed(1)}" y="${(Y(last.v) - 11).toFixed(1)}" text-anchor="${points.length > 1 ? 'end' : 'middle'}" font-size="12" font-weight="700" fill="var(--ink)">${Math.round(last.v)}</text>
    <text x="${L}" y="${H - 8}" font-size="11" fill="var(--muted)">${dl(points[0].t)}</text>
    <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="var(--muted)">${dl(last.t)}</text>
  </svg>`;
}
function exerciseScreen(s){
  const ex = exById(s.exId), bw = ex.equip === 'Bodyweight', b = (data.bests || {})[s.exId];
  const sess = sessionsFor(s.exId);
  const range = s.range || '3m';
  const cutoff = range === '1m' ? Date.now() - 31 * 864e5 : range === '3m' ? Date.now() - 92 * 864e5 : 0;
  const pts = sess.filter(x => x.w.start >= cutoff && x.metric > 0).map(x => ({t: x.w.start, v: x.metric}));
  const change = pts.length > 1 ? Math.round(pts[pts.length - 1].v - pts[0].v) : null;
  const stat = (l, v, u) => `<div class="stat"><span>${l}</span><b>${v}${u ? ` <small>${u}</small>` : ''}</b></div>`;
  const stats = bw
    ? stat('Most reps', b ? b.reps : '—') + stat('Best set', b && b.bestSet ? esc(setText(s.exId, b.bestSet)) : '—') + stat('Sessions', sess.length)
    : stat('Est. 1-rep max', b ? Math.round(b.e1rm) : '—', b ? 'lb' : '') + stat('Best set', b && b.bestSet ? b.bestSet.w + ` <small>× ${b.bestSet.r}</small>` : '—') + stat('Heaviest', b ? b.heavy : '—', b ? 'lb' : '');
  const hist = sess.slice().reverse().map(x => `<div class="hcard" style="cursor:default">
      <span class="hrow"><b>${esc(dateLabel(x.w.date))}</b><span>${esc(x.w.name)}</span></span>
      <span class="hs" style="color:var(--ink)">${x.sets.map(st => esc(setText(s.exId, st)) + (st.pr ? ' <span class="prt">PR</span>' : '')).join(' · ')}</span></div>`).join('');
  return `<div class="screen" role="dialog" aria-label="${esc(ex.name)}">
    <div class="screen-hd"><div class="top"><div><button class="icon-btn plain" data-act="w-back" aria-label="Back">${I.left}</button>
      <div style="display:flex;flex-direction:column"><h1>${esc(ex.name)}</h1><span class="note">${esc(ex.equip)}${ex.muscle ? ' · ' + esc(ex.muscle) : ''} · ${sess.length} session${sess.length === 1 ? '' : 's'} this year</span></div></div>
      ${ex.custom ? `<button class="btn" style="height:40px;border-radius:20px" data-act="w-edit-custom" data-id="${ex.id}">Edit</button>` : ''}</div></div>
    <div class="wrap">
      <div class="stats3">${stats}</div>
      <section class="card" style="padding:16px">
        <div class="sec-hd" style="margin:0 0 10px"><h2 style="font-size:17px">${bw ? 'Best reps per session' : 'Estimated 1-rep max'}</h2>${change != null ? `<b style="font-size:13px;color:${change >= 0 ? 'var(--accent)' : 'var(--over)'}">${change >= 0 ? '+' : ''}${change}${bw ? '' : ' lb'}</b>` : ''}</div>
        <div class="seg" role="group" aria-label="Time range" style="margin-bottom:12px">${[['1m','1 month'],['3m','3 months'],['yr','This year']].map(([k, l]) => `<button type="button" data-act="w-range" data-v="${k}" aria-pressed="${range === k}">${l}</button>`).join('')}</div>
        ${chartSVG(pts, bw)}
      </section>
      <h2 style="margin:6px 0 10px">History</h2>
      ${hist || '<div class="empty-box" style="margin:0 0 12px">No sessions logged this year yet.</div>'}
      ${bw ? '' : '<div class="note" style="margin-top:4px">Estimated 1-rep max uses the Epley formula on your best set each session. Records are kept across years.</div>'}
      ${ex.custom ? '<div class="grid2"><button class="btn" data-act="w-edit-custom" data-id="' + ex.id + '">Edit exercise</button><button class="btn danger" data-act="w-del-custom" data-id="' + ex.id + '">Delete</button></div>' : ''}
    </div>
  </div>`;
}

function wScreenHTML(s){
  if(s.type === 'active') return activeScreen();
  if(s.type === 'picker') return pickerScreen(s);
  if(s.type === 'routine') return routineScreen(s);
  if(s.type === 'exercise') return exerciseScreen(s);
  return '';
}

/* ---------- sheets ---------- */
function wSheetHTML(s){
  if(s.type === 'cardioPick') return `<div class="grab"></div><div class="sec"><h2>Add cardio</h2></div>
    <div style="margin:0 -16px">${CARDIO_TYPES.map(t => `<button class="row" data-act="w-cardio-pick" data-v="${esc(t)}"><span class="n">${esc(t)}</span></button>`).join('')}</div>`;
  if(s.type === 'customEx'){
    const ed = s.editId ? exById(s.editId) : null;
    const opt = (list, cur) => list.map(v => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    return `<div class="grab"></div><div class="sec" style="gap:2px"><h2>${ed ? 'Edit exercise' : 'Custom exercise'}</h2><div class="note">${ed ? 'Changes show everywhere this exercise appears, including past workouts.' : 'It’s added to your library for future workouts too.'}</div></div>
    <div class="sec"><label>Name<input class="inp" id="cx-name" value="${esc(ed ? ed.name : (s.name || ''))}" placeholder="e.g. Smith machine incline"></label></div>
    <div class="form-grid" style="margin-bottom:16px">
      <label>Equipment<select class="inp" id="cx-equip">${opt(EQUIP, ed ? ed.equip : 'Barbell')}</select></label>
      <label>Muscle group<select class="inp" id="cx-muscle">${opt(MUSCLES.concat(['Other']), ed ? ed.muscle : 'Chest')}</select></label></div>
    <button class="btn primary" data-act="w-custom-save">${ed ? 'Save changes' : 'Create' + (s.target ? ' & add' : '')}</button>`;
  }
  if(s.type === 'exMenu'){
    const a = data.active, x = a.exercises[s.ei], n = exById(x.exId).name;
    return `<div class="grab"></div><div class="sec"><h2>${esc(n)}</h2></div>
      <div class="grid2"><button class="btn" data-act="w-ex-move" data-d="-1" ${s.ei ? '' : 'disabled'}>Move up</button><button class="btn" data-act="w-ex-move" data-d="1" ${s.ei < a.exercises.length - 1 ? '' : 'disabled'}>Move down</button></div>
      <button class="btn" style="width:100%;margin-bottom:10px" data-act="w-ex-replace">Replace exercise</button>
      <button class="btn" style="width:100%;margin-bottom:10px" data-act="w-ex-history" data-id="${x.exId}">View history & progress</button>
      <button class="btn danger" style="width:100%" data-act="w-ex-remove">Remove from workout</button>`;
  }
  if(s.type === 'routineMenu'){
    const r = data.routines[s.i];
    if(!r) return '';
    const lines = (r.cardio || []).map(c => `<div class="item"><span class="t"><span>${esc(c.type)}</span><span class="s">Cardio${c.min ? ' · ' + c.min + ' min' : ''}</span></span></div>`).join('') +
      r.exercises.map(x => { const p = prevFor(x.exId, 0); return `<div class="item"><span class="t"><span>${esc(exById(x.exId).name)}</span><span class="s">${x.sets} sets${p ? ' · last ' + esc(setText(x.exId, p)) : ''}</span></span></div>`; }).join('');
    return `<div class="grab"></div><div class="sec" style="gap:2px"><h2>${esc(r.name)}</h2><div class="note">${r.lastUsed ? 'Last done ' + esc(dateLabel(r.lastUsed)) : 'Not done yet'}</div></div>
      <div style="margin-bottom:16px">${lines || '<div class="note">This routine is empty.</div>'}</div>
      <button class="btn primary" data-act="w-r-start">${data.active ? 'Workout already in progress' : 'Start workout'}</button>
      <div class="grid2"><button class="btn" data-act="w-r-edit">Edit</button><button class="btn" data-act="w-r-dup">Duplicate</button></div>`;
  }
  if(s.type === 'finish'){
    const w = s.w, prs = w.exercises.reduce((a, x) => a + x.sets.filter(st => st.pr).length, 0);
    const sets = w.exercises.reduce((a, x) => a + x.sets.length, 0);
    return `<div class="grab"></div><div class="sec" style="gap:2px"><h2>Workout saved</h2><div class="note">${esc(w.name)} · ${esc(dateLabel(w.date))}</div></div>
      <div class="stats3" style="margin-bottom:16px">
        <div class="stat"><span>Time</span><b>${durText(w.end - w.start)}</b></div>
        <div class="stat"><span>Sets</span><b>${sets}</b></div>
        <div class="stat"><span>Volume</span><b>${fmt(wkVolume(w))} <small>lb</small></b></div></div>
      ${wkCardioMin(w) ? `<div class="note" style="margin-bottom:10px">Cardio: ${esc((w.cardio || []).map(c => c.type + (c.min ? ' ' + c.min + ' min' : '') + (c.dist ? ' · ' + c.dist + ' mi' : '')).join(', '))}</div>` : ''}
      ${prs ? `<div class="pr-box"><b>${prs} new personal record${prs === 1 ? '' : 's'}</b>${w.exercises.flatMap(x => x.sets.filter(st => st.pr).map(st => `<div>${esc(exById(x.exId).name)}: ${esc(setText(x.exId, st))}</div>`)).join('')}</div>` : ''}
      ${w.routineId ? '' : '<button class="btn" style="width:100%;margin-bottom:10px" data-act="w-save-as-routine" data-id="' + w.id + '">' + I.bookmark + ' Save as routine</button>'}
      <button class="btn primary" data-act="w-finish-done">Done</button>`;
  }
  if(s.type === 'wdetail'){
    const w = data.workouts.find(x => x.id === s.id);
    if(!w) return '';
    const cardio = (w.cardio || []).map(c => `<div class="item"><span class="t"><span>${esc(c.type)}</span><span class="s">${esc([c.min ? c.min + ' min' : '', c.dist ? c.dist + ' mi' : '', c.kcal ? c.kcal + ' kcal' : ''].filter(Boolean).join(' · ') || '—')}</span></span></div>`).join('');
    const ex = w.exercises.map(x => `<div class="item"><button class="item-edit" data-act="w-ex-history" data-id="${x.exId}"><span>${esc(exById(x.exId).name)}</span>
      <span class="s">${x.sets.map(st => esc(setText(x.exId, st)) + (st.pr ? ' <span class="prt">PR</span>' : '')).join(' · ')}</span></button></div>`).join('');
    return `<div class="grab"></div><div class="sec" style="gap:2px"><h2>${esc(w.name)}</h2>
      <div class="note">${esc(dateLabel(w.date))} · ${new Date(w.start).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})} · ${durText(w.end - w.start)} · ${fmt(wkVolume(w))} lb volume</div></div>
      <div style="margin-bottom:16px">${cardio}${ex}</div>
      <div class="grid2"><button class="btn" data-act="w-save-as-routine" data-id="${w.id}">${I.bookmark} Save as routine</button><button class="btn danger" data-act="w-del-workout" data-id="${w.id}">Delete</button></div>`;
  }
  return null;
}

/* ---------- finishing ---------- */
function finishWorkout(){
  const a = data.active;
  const cardio = a.cardio.map(c => ({type: c.type, min: num(c.min), dist: num(c.dist), kcal: num(c.kcal)})).filter(c => c.min || c.dist || c.kcal);
  const exercises = a.exercises.map(x => ({exId: x.exId, sets: x.sets.filter(s => s.done).map(s => ({w: num(s.w) || 0, r: num(s.r) || 0, pr: !!s.pr}))})).filter(x => x.sets.length);
  if(!cardio.length && !exercises.length){
    if(confirm('Nothing is filled in yet. Discard this workout?')){ data.active = null; save(); ui.wstack = []; renderAll(); }
    return;
  }
  const w = {id: a.id, date: keyOf(new Date(a.start)), name: a.name, routineId: a.routineId, start: a.start, end: Date.now(), cardio, exercises};
  data.bests = data.bests || {}; data.lastSets = data.lastSets || {}; data.lastCardio = data.lastCardio || {};
  for(const x of exercises){
    data.lastSets[x.exId] = x.sets.map(s => ({w: s.w, r: s.r}));
    const b = data.bests[x.exId] || {e1rm: 0, heavy: 0, reps: 0, bestSet: null};
    for(const s of x.sets){
      const e = e1rm(s.w, s.r);
      if(e > b.e1rm) b.e1rm = e;
      if(s.w > b.heavy) b.heavy = s.w;
      if(s.r > b.reps) b.reps = s.r;
      if(!b.bestSet || setMetric(x.exId, s) > setMetric(x.exId, b.bestSet)) b.bestSet = {w: s.w, r: s.r};
    }
    data.bests[x.exId] = b;
  }
  for(const c of cardio) data.lastCardio[c.type] = {min: c.min, dist: c.dist, kcal: c.kcal};
  const r = data.routines.find(x => x.id === a.routineId);
  if(r) r.lastUsed = w.date;
  data.workouts.push(w);
  data.active = null; save();
  ui.wstack = []; ui.sheet = {type:'finish', w};
  renderAll();
}
function routineFromWorkout(w){
  return {id: uid(), name: w.name === 'Workout' ? '' : w.name, cardio: (w.cardio || []).map(c => ({type: c.type, min: c.min || null})),
    exercises: w.exercises.map(x => ({exId: x.exId, sets: x.sets.length})), lastUsed: null};
}
function addExerciseTo(target, exId){
  if(target === 'replace'){
    const a = data.active, i = ui.replaceEi, old = a.exercises[i];
    if(!old) return;
    const keep = JSON.parse(JSON.stringify(old));
    // Same number of sets, fresh values: the new exercise's "Previous" numbers fill in as hints.
    a.exercises[i] = {exId, sets: old.sets.map(() => ({w:'', r:'', done:false}))};
    save();
    setTimeout(() => undoToast(`Replaced ${exById(keep.exId).name} with ${exById(exId).name}`, () => { a.exercises[i] = keep; save(); renderLayer(); }), 0);
    return;
  }
  if(target === 'active'){ data.active.exercises.push({exId, sets: [{w:'', r:'', done:false}, {w:'', r:'', done:false}, {w:'', r:'', done:false}]}); save(); }
  else { const rs = ui.wstack.find(s => s.type === 'routine'); if(rs) rs.draft.exercises.push({exId, sets: 3}); }
}

/* ---------- timer tick (updates text only, so typing isn't interrupted) ---------- */
function wTick(){
  const a = data.active;
  if(!a) return;
  const el = document.getElementById('elapsed'); if(el) el.textContent = clock(Date.now() - a.start);
  ['resume-time', 'resume-time2'].forEach(id => { const r = document.getElementById(id); if(r) r.textContent = clock(Date.now() - a.start); });
  const bar = document.getElementById('restbar');
  if(a.rest){
    const left = a.rest.end - Date.now();
    if(left <= 0){
      a.rest = null; save(); beep(); toast('Rest over — next set');
      if(bar) bar.hidden = true;
    } else if(bar){
      bar.hidden = false;
      document.getElementById('rest-left').textContent = clock(left + 999) + ' / ' + clock(a.rest.total * 1000);
      document.getElementById('rest-fill').style.width = Math.max(0, left / (a.rest.total * 10)) + '%';
    }
  }
}
setInterval(wTick, 1000);

/* ---------- input handling ---------- */
function wOnInput(ev){
  const t = ev.target, a = data.active;
  if(t.dataset.ex != null && t.dataset.set != null && a){
    const s = a.exercises[+t.dataset.ex].sets[+t.dataset.set];
    s[t.dataset.field] = t.value;
    if(s.done && (num(s.w) == null && !isBW(a.exercises[+t.dataset.ex].exId) || num(s.r) == null)) s.done = false;
    save(); return true;
  }
  if(t.dataset.cardio != null && a){ a.cardio[+t.dataset.cardio][t.dataset.field] = t.value; save(); return true; }
  if(t.id === 'pq'){ wTop().q = t.value; renderPickList(); return true; }
  if(t.id === 'rname'){ ui.wstack.find(s => s.type === 'routine').draft.name = t.value; return true; }
  if(t.dataset.rcardio != null){ ui.wstack.find(s => s.type === 'routine').draft.cardio[+t.dataset.rcardio].min = num(t.value); return true; }
  return false;
}

/* ---------- actions ---------- */
const W_ACTIONS = {
  'tab'(el){ ui.tab = el.dataset.tab; data.settings.tab = ui.tab; save(); window.scrollTo(0, 0); renderAll(); if(ui.tab === 'health') refreshHealth(false); },
  'w-start'(){ if(!data.active){ data.active = newActive('Workout'); save(); } ui.wstack = [{type:'active'}]; renderLayer(); },
  'w-resume'(){ ui.tab = 'workouts'; ui.wstack = [{type:'active'}]; renderAll(); },
  'w-minimize'(){ ui.wstack = []; renderAll(); },
  'w-rename'(){ const n = prompt('Workout name', data.active.name); if(n && n.trim()){ data.active.name = n.trim(); save(); renderLayer(); } },
  'w-discard'(){ if(confirm('Discard this workout? Nothing from it will be saved.')){ data.active = null; save(); ui.wstack = []; renderAll(); } },
  'w-finish'(){
    const a = data.active;
    const open = a.exercises.reduce((n, x) => n + x.sets.filter(s => !s.done && (s.w !== '' || s.r !== '')).length, 0);
    if(open && !confirm(`${open} set${open === 1 ? ' has' : 's have'} numbers but ${open === 1 ? 'isn’t' : 'aren’t'} checked off. Only checked sets are saved. Finish anyway?`)) return;
    finishWorkout();
  },
  'w-finish-done'(){ ui.sheet = null; renderAll(); },
  'w-set-done'(el){
    ensureAudio();
    const a = data.active, ei = +el.dataset.ex, si = +el.dataset.set, x = a.exercises[ei], s = x.sets[si];
    if(s.done){ s.done = false; s.pr = false; save(); renderLayer(); return; }
    const p = prevFor(x.exId, si), bw = isBW(x.exId);
    if(s.w === '' && p) s.w = String(p.w ?? '');
    if(s.r === '' && p) s.r = String(p.r ?? '');
    const w = num(s.w), r = num(s.r);
    if(!(r > 0) || (!bw && !(w > 0))){ toast(bw ? 'Enter reps first' : 'Enter weight and reps first'); renderLayer(); return; }
    s.done = true;
    const b = (data.bests || {})[x.exId];
    const metric = setMetric(x.exId, {w: w || 0, r});
    const priorToday = Math.max(0, ...x.sets.filter((o, j) => j !== si && o.done).map(o => setMetric(x.exId, {w: num(o.w) || 0, r: num(o.r) || 0})));
    s.pr = !!(b && b.bestSet && metric > setMetric(x.exId, b.bestSet) && metric > priorToday);
    if(s.pr) x.sets.forEach((o, j) => { if(j !== si && o.pr && setMetric(x.exId, {w: num(o.w) || 0, r: num(o.r) || 0}) < metric) o.pr = false; });
    const total = data.settings.rest || 90;
    a.rest = {end: Date.now() + total * 1000, total};
    save(); renderLayer();
    if(s.pr) toast('New personal record!');
  },
  'w-set-add'(el){ const x = data.active.exercises[+el.dataset.ex]; x.sets.push({w:'', r:'', done:false}); save(); renderLayer(); },
  'w-set-rm'(el){ const x = data.active.exercises[+el.dataset.ex]; const s = x.sets.pop(); save(); renderLayer();
    if(s && (s.done || s.w !== '' || s.r !== '')) undoToast('Set removed', () => { x.sets.push(s); save(); renderLayer(); }); },
  'w-rest-add'(){ const r = data.active.rest; if(r){ r.end += 15000; r.total += 15; save(); wTick(); } },
  'w-rest-skip'(){ data.active.rest = null; save(); document.getElementById('restbar').hidden = true; },
  'w-cardio-done'(el){ const c = data.active.cardio[+el.dataset.i]; c.done = !c.done; save(); renderLayer(); },
  'w-cardio-rm'(el){ const i = +el.dataset.i, c = data.active.cardio.splice(i, 1)[0]; save(); renderLayer(); undoToast('Removed ' + c.type, () => { data.active.cardio.splice(i, 0, c); save(); renderLayer(); }); },
  'w-add-cardio'(el){ ui.sheet = {type:'cardioPick', target: el.dataset.target}; renderLayer(); },
  'w-cardio-pick'(el){
    const t = el.dataset.v;
    if(ui.sheet.target === 'active') { data.active.cardio.push({id: uid(), type: t, min:'', dist:'', kcal:''}); save(); }
    else { const rs = ui.wstack.find(s => s.type === 'routine'); rs.draft.cardio.push({type: t, min: null}); }
    ui.sheet = null; renderLayer();
  },
  'w-add-ex'(el){ wPush({type:'picker', target: el.dataset.target, q:''}); },
  'w-library'(){ ui.wstack = [{type:'picker', target: null, q:''}]; renderLayer(); },
  'w-pick-ex'(el){
    const s = wTop();
    if(s.target){ addExerciseTo(s.target, el.dataset.id); ui.wstack.pop(); renderLayer(); if(s.target !== 'replace') toast('Added ' + exById(el.dataset.id).name); }
    else wPush({type:'exercise', exId: el.dataset.id, range:'3m'});
  },
  'w-custom-ex'(){ const s = wTop(); ui.sheet = {type:'customEx', target: s && s.target, name: (s && s.q) || ''}; renderLayer(); },
  'w-custom-save'(){
    const name = document.getElementById('cx-name').value.trim();
    if(!name){ toast('Give it a name'); return; }
    if(ui.sheet.editId){
      const ex = data.customEx.find(e => e.id === ui.sheet.editId);
      if(ex){ ex.name = name; ex.equip = document.getElementById('cx-equip').value; ex.muscle = document.getElementById('cx-muscle').value; save(); toast('Exercise updated'); }
      ui.sheet = null; renderLayer(); return;
    }
    const ex = {id: 'c-' + uid(), name, equip: document.getElementById('cx-equip').value, muscle: document.getElementById('cx-muscle').value, custom: true};
    data.customEx = data.customEx || []; data.customEx.push(ex); save();
    const target = ui.sheet.target; ui.sheet = null;
    if(target){ addExerciseTo(target, ex.id); ui.wstack.pop(); if(target !== 'replace') toast('Added ' + name); } else toast('Exercise created');
    renderLayer();
  },
  'w-edit-custom'(el){ ui.sheet = {type:'customEx', editId: el.dataset.id}; renderLayer(); },
  'w-del-custom'(el){
    const id = el.dataset.id, used = data.workouts.some(w => w.exercises.some(x => x.exId === id)) || data.routines.some(r => r.exercises.some(x => x.exId === id));
    if(!confirm(used ? 'This exercise is used in your history or routines. Delete it anyway? Past entries will show as “Removed exercise”.' : 'Delete this custom exercise?')) return;
    data.customEx = data.customEx.filter(e => e.id !== id); save(); ui.wstack.pop(); renderLayer();
  },
  'w-back'(){ wPop(); },
  'w-ex-open'(el){ wPush({type:'exercise', exId: el.dataset.id, range:'3m'}); },
  'w-ex-history'(el){ ui.sheet = null; if(!ui.wstack.length && ui.tab !== 'workouts') ui.tab = 'workouts'; wPush({type:'exercise', exId: el.dataset.id, range:'3m'}); },
  'w-range'(el){ wTop().range = el.dataset.v; renderLayer(); },
  'w-ex-menu'(el){ ui.sheet = {type:'exMenu', ei: +el.dataset.ex}; renderLayer(); },
  'w-ex-move'(el){ const a = data.active, i = ui.sheet.ei, j = i + (+el.dataset.d); [a.exercises[i], a.exercises[j]] = [a.exercises[j], a.exercises[i]]; save(); ui.sheet = null; renderLayer(); },
  'w-ex-replace'(){ ui.replaceEi = ui.sheet.ei; ui.sheet = null; wPush({type:'picker', target:'replace', q:''}); },
  'w-ex-remove'(){ const a = data.active, i = ui.sheet.ei, x = a.exercises.splice(i, 1)[0]; save(); ui.sheet = null; renderLayer();
    undoToast('Removed ' + exById(x.exId).name, () => { a.exercises.splice(i, 0, x); save(); renderLayer(); }); },
  // routines
  'w-new-routine'(){ ui.wstack = [{type:'routine', isNew: true, draft: {id: uid(), name:'', cardio:[], exercises:[], lastUsed: null}}]; renderLayer(); },
  'w-routine'(el){ ui.sheet = {type:'routineMenu', i: +el.dataset.i}; renderLayer(); },
  'w-r-start'(){
    if(data.active){ ui.sheet = null; ui.wstack = [{type:'active'}]; renderLayer(); toast('Finish or discard the current workout first'); return; }
    const r = data.routines[ui.sheet.i]; data.active = newActive(r.name, r); save(); ui.sheet = null; ui.wstack = [{type:'active'}]; renderLayer();
  },
  'w-r-edit'(){ const r = data.routines[ui.sheet.i]; ui.sheet = null; ui.wstack = [{type:'routine', isNew: false, draft: JSON.parse(JSON.stringify(r))}]; renderLayer(); },
  'w-r-dup'(){ const r = JSON.parse(JSON.stringify(data.routines[ui.sheet.i])); r.id = uid(); r.name += ' (copy)'; r.lastUsed = null; ui.sheet = null; ui.wstack = [{type:'routine', isNew: true, draft: r}]; renderLayer(); },
  'w-r-save'(){
    const s = wTop(), d = s.draft;
    const n = document.getElementById('rname'); if(n) d.name = n.value;
    d.name = (d.name || '').trim();
    if(!d.name){ toast('Give the routine a name'); return; }
    const i = data.routines.findIndex(r => r.id === d.id);
    if(i >= 0) data.routines[i] = d; else data.routines.push(d);
    save(); ui.wstack = []; toast('Routine saved'); renderAll();
  },
  'w-r-delete'(){ const d = wTop().draft; if(!confirm('Delete “' + d.name + '”? Past workouts stay in your history.')) return;
    data.routines = data.routines.filter(r => r.id !== d.id); save(); ui.wstack = []; renderAll(); },
  'w-r-rmc'(el){ wTop().draft.cardio.splice(+el.dataset.i, 1); renderLayer(); },
  'w-r-rmx'(el){ wTop().draft.exercises.splice(+el.dataset.i, 1); renderLayer(); },
  'w-r-sets+'(el){ const x = wTop().draft.exercises[+el.dataset.i]; x.sets = Math.min(12, x.sets + 1); renderLayer(); },
  'w-r-sets-'(el){ const x = wTop().draft.exercises[+el.dataset.i]; x.sets = Math.max(1, x.sets - 1); renderLayer(); },
  'w-r-up'(el){ const e = wTop().draft.exercises, i = +el.dataset.i; [e[i - 1], e[i]] = [e[i], e[i - 1]]; renderLayer(); },
  'w-r-down'(el){ const e = wTop().draft.exercises, i = +el.dataset.i; [e[i + 1], e[i]] = [e[i], e[i + 1]]; renderLayer(); },
  'w-save-as-routine'(el){
    const w = data.workouts.find(x => x.id === el.dataset.id); if(!w) return;
    ui.sheet = null; ui.wstack = [{type:'routine', isNew: true, draft: routineFromWorkout(w)}]; renderAll();
  },
  // history
  'w-detail'(el){ ui.sheet = {type:'wdetail', id: el.dataset.id}; renderLayer(); },
  'w-del-workout'(el){
    const i = data.workouts.findIndex(w => w.id === el.dataset.id), w = data.workouts[i];
    data.workouts.splice(i, 1); save(); ui.sheet = null; renderAll();
    undoToast('Workout deleted', () => { data.workouts.splice(i, 0, w); save(); renderAll(); });
  },
  'w-more'(){ ui.wHistN = (ui.wHistN || 10) + 20; renderMain(); },
  'w-cal'(){ ui.wCalOpen = !ui.wCalOpen; if(ui.wCalMonth == null) ui.wCalMonth = new Date().getMonth(); renderMain(); },
  'w-cal-prev'(){ if(ui.wCalMonth > 0){ ui.wCalMonth--; renderMain(); } },
  'w-cal-next'(){ if(ui.wCalMonth < 11){ ui.wCalMonth++; renderMain(); } },
  'w-pick-day'(el){ ui.wDay = ui.wDay === el.dataset.k ? null : el.dataset.k; renderMain(); },
  'w-all'(){ ui.wDay = null; renderMain(); }
};
