"use strict";
/* ============================================================
   Hoop!.ver2 — 앱 로직
   ============================================================ */

/* ---------- 유틸 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const mondayOf = d => { const x = new Date(d.getFullYear(),d.getMonth(),d.getDate()); return addDays(x, -((x.getDay()+6)%7)); };
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const uid = p => p + Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-3);
const DOW = ["일","월","화","수","목","금","토"];
const TODAY = new Date(); const TODAY_S = ymd(TODAY);
const md = d => `${d.getMonth()+1}/${d.getDate()}`;
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- 상태 ---------- */
const KEY = "hoop2.v1";
function defaultState(){
  return {
    v:2, level:"b", days:4, onboarded:false,
    plan:null, drills:{}, logs:{}, tests:[], analyses:[],
    rewards:[
      {id:"r1", name:"좋아하는 음료 한 잔", cost:300},
      {id:"r2", name:"새 농구 양말", cost:1200},
      {id:"r3", name:"새 농구화 적립금", cost:6000}
    ],
    redeemed:[], seen:{rank:0, badges:[]},
    settings:{apiKey:"", model:"claude-sonnet-5-5"}
  };
}
let S;
try { S = Object.assign(defaultState(), JSON.parse(localStorage.getItem(KEY) || "null") || {}); } catch(e) { S = defaultState(); }
S.settings = Object.assign(defaultState().settings, S.settings || {});
S.seen = Object.assign({rank:0,badges:[]}, S.seen || {});
let saveT;
function save(){ clearTimeout(saveT); saveT = setTimeout(()=>{ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){ toast("저장 공간이 부족해요. 백업 후 오래된 기록을 지워 주세요."); } }, 150); }
function saveNow(){ clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }

/* v1 (HOOP 4×60) 기록 가져오기 — 같은 github.io 주소에서 쓰던 기록 */
(function migrateV1(){
  if(S.migratedV1) return;
  let old = null; try { old = JSON.parse(localStorage.getItem("hoop4x60.v1") || "null"); } catch(e){}
  S.migratedV1 = true;
  if(!old || typeof old !== "object") return;
  const V1MIN = {m1:5,m2:10,m3:15,m4:20,m5:10,w1:5,w2:10,w3:15,w4:25,w5:5,t1:5,t2:10,t3:10,t4:15,t5:15,t6:5,s1:5,s2:15,s3:20,s4:15,s5:5};
  let n = 0;
  for(const [date,r] of Object.entries(old)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || S.logs[date]) continue;
    const mins = Object.keys(r.done||{}).filter(k=>r.done[k]).reduce((a,k)=>a+(V1MIN[k]||0),0);
    let m=0,a=0; for(const lg of Object.values(r.logs||{})){ m += lg.m||0; a += lg.a||0; }
    S.logs[date] = {legacy:true, title:"ver1 기록", items:{}, mins:{}, legacyMins:mins, legacyShots:{m,a}, feel:r.feel??null, effort:r.effort??null, memo:r.memo||"", skipped:!!r.skipped};
    n++;
  }
  if(n) setTimeout(()=>toast(`ver1에서 ${n}일치 기록을 가져왔어요.`), 800);
})();

/* ---------- 훈련 / 플랜 ---------- */
function drill(id){
  const base = DRILLS[id], ov = S.drills[id];
  if(!base && !ov) return null;
  if(ov && ov.deleted) return null;
  return Object.assign({id, lv:"bia", log:"none", how:[], cues:"", mistakes:"", min:10, cat:"shoot"}, base||{}, ov||{});
}
function allDrills(){
  const ids = new Set([...Object.keys(DRILLS), ...Object.keys(S.drills)]);
  return [...ids].map(drill).filter(Boolean);
}
function buildPlan(level, days){
  const lay = WEEK_LAYOUT[days];
  return { level, days, sessions: lay.types.map((t,i)=>({
    id: uid("s"), type:t, title: SESSION_TYPES[t].title, why: SESSION_TYPES[t].why, dow: lay.dows[i],
    items: TEMPLATES[level][t].map(([d,min])=>({d, min, on:true}))
  }))};
}
if(!S.plan) S.plan = buildPlan(S.level, S.days);
function sessionFor(date){
  const dow = parse(date).getDay();
  return S.plan.sessions.find(s=>s.dow===dow) || null;
}
function sessMins(s){ return s.items.filter(i=>i.on && drill(i.d)).reduce((a,i)=>a+i.min,0); }
function plannedWeekMins(){ return S.plan.sessions.reduce((a,s)=>a+sessMins(s),0); }

/* ---------- 기록 계산 ---------- */
function logFor(date, create){
  if(!S.logs[date] && create){
    const s = sessionFor(date);
    S.logs[date] = {sid:s?.id||null, title:s?.title||"자유 훈련", items:{}, mins:{}, feel:null, effort:null, memo:"", skipped:false,
      snap: s ? s.items.filter(i=>i.on && drill(i.d)).map(i=>({d:i.d, min:i.min})) : []};
  }
  return S.logs[date] || null;
}
function dayStats(date){
  const L = S.logs[date];
  if(L && L.legacy){ return {mins:L.legacyMins||0, total:60, pct:clamp((L.legacyMins||0)/60,0,1), status:L.skipped?"skip":(L.legacyMins>=60?"done":L.legacyMins>0?"part":"none"), planned:true}; }
  const s = sessionFor(date);
  // 지난 날짜는 그날 시작할 때의 세션 구성(snap)으로 계산 → 나중에 플랜을 고쳐도 과거 완료 기록이 바뀌지 않음
  const past = date < TODAY_S && L && L.snap;
  if(!s && !L) return null;
  const items = past ? L.snap : (s ? s.items.filter(i=>i.on && drill(i.d)) : []);
  const total = items.reduce((a,i)=>a+i.min,0) || 0;
  if(!L) return {mins:0,total,pct:0,status:"none",planned:!!s};
  let mins = 0, allDone = items.length>0;
  for(const i of items){ const it = L.items[i.d]; if(it && it.done) mins += (L.mins[i.d] ?? i.min); else allDone = false; }
  // 플랜에서 빠진 훈련이라도 그날 완료했던 것은 시간에 포함
  for(const [d,it] of Object.entries(L.items)){ if(it.done && !items.find(i=>i.d===d)) mins += (L.mins[d] ?? 0); }
  const pct = total ? clamp(mins/total,0,1) : (mins>0?1:0);
  const status = L.skipped ? "skip" : (allDone ? "done" : mins>0 ? "part" : "none");
  return {mins,total,pct,status,planned:!!s || !!past};
}
function weekStats(mon){
  let mins=0, done=0, planned=0;
  for(let i=0;i<7;i++){ const st = dayStats(ymd(addDays(mon,i))); if(!st) continue; mins += st.mins; if(st.planned) planned++; if(st.status==="done") done++; }
  return {mins, done, planned};
}
function shotTotals(filterFn){
  let m=0,a=0;
  for(const [date,L] of Object.entries(S.logs)){
    if(filterFn && !filterFn(date)) continue;
    if(L.legacy){ m += L.legacyShots?.m||0; a += L.legacyShots?.a||0; continue; }
    for(const it of Object.values(L.items)){ if(it.a>0){ m += Math.min(it.m||0, it.a); a += it.a; } }
  }
  return {m,a};
}

/* ---------- XP · 배지 ---------- */
function computeXP(){
  let xp = 0, sessions = 0, memos = 0, minutes = 0;
  for(const [date,L] of Object.entries(S.logs)){
    const st = dayStats(date); if(!st) continue;
    xp += st.mins; minutes += st.mins;
    if(st.status==="done"){ xp += 20; sessions++; }
    if(L.memo && L.memo.trim().length>=5){ xp += 5; memos++; }
  }
  // 퍼펙트 위크
  const weeks = new Set(Object.keys(S.logs).map(d=>ymd(mondayOf(parse(d)))));
  let perfect = 0;
  for(const w of weeks){ const ws = weekStats(parse(w)); if(ws.planned>0 && ws.done>=ws.planned && parse(w) <= mondayOf(TODAY)){ xp += 50; perfect++; } }
  xp += S.tests.length*30 + S.analyses.length*15;
  return {xp, sessions, memos, minutes, perfect};
}
function spentCoins(){ return S.redeemed.reduce((a,r)=>a+r.cost,0); }
function rankOf(xp){ let i=0; RANKS.forEach((r,k)=>{ if(xp>=r[0]) i=k; }); return i; }
function perfectStreak(){
  let n=0, w=mondayOf(TODAY);
  const cur = weekStats(w); if(!(cur.planned && cur.done>=cur.planned)) w = addDays(w,-7);
  for(let k=0;k<104;k++){ const ws = weekStats(w); if(ws.planned && ws.done>=ws.planned){ n++; w = addDays(w,-7); } else break; }
  return n;
}
function badgeList(){
  const X = computeXP(), shots = shotTotals();
  let ft80 = false;
  for(const L of Object.values(S.logs)){ const it = L.items?.s_ft; if(it && it.a>=10 && it.m/it.a>=0.8) ft80 = true; }
  const lvIdx = {b:0,i:1,a:2};
  const tShoot = S.tests.filter(t=>t.type==="shoot"), tDrib = S.tests.filter(t=>t.type==="dribble");
  const up = arr => arr.length>1 && arr.some((t,k)=>k>0 && lvIdx[t.level]>lvIdx[arr[0].level]);
  return [
    {id:"first", n:"첫 훈련", d:"세션 하나를 끝까지 완료", got:X.sessions>=1, g:"1"},
    {id:"ten", n:"10세션", d:"완료한 세션 10개", got:X.sessions>=10, g:"10"},
    {id:"perfect", n:"퍼펙트 위크", d:"한 주 계획을 모두 완료", got:X.perfect>=1, g:"W"},
    {id:"streak3", n:"3주 연속", d:"퍼펙트 위크 3주 연속", got:perfectStreak()>=3, g:"3W"},
    {id:"hours10", n:"10시간", d:"누적 훈련 600분", got:X.minutes>=600, g:"10h"},
    {id:"hours50", n:"50시간", d:"누적 훈련 3000분", got:X.minutes>=3000, g:"50h"},
    {id:"shots500", n:"500슛", d:"기록한 슛 시도 500개", got:shots.a>=500, g:"500"},
    {id:"shots2000", n:"2000슛", d:"기록한 슛 시도 2000개", got:shots.a>=2000, g:"2K"},
    {id:"ft80", n:"자유투 80%", d:"한 세션 10개 이상 중 80%", got:ft80, g:"FT"},
    {id:"tester", n:"셀프 진단", d:"첫 셀프 테스트 완료", got:S.tests.length>=1, g:"T"},
    {id:"levelup", n:"레벨 업", d:"테스트에서 레벨 상승", got:up(tShoot)||up(tDrib), g:"↑"},
    {id:"coach5", n:"영상 분석가", d:"AI 코치 분석 5회", got:S.analyses.length>=5, g:"AI"},
    {id:"journal10", n:"훈련 일지", d:"피드백 메모 10개", got:X.memos>=10, g:"✎"}
  ];
}

/* ---------- 셀프 테스트 점수 ---------- */
const norm = (v,lo,hi) => clamp((v-lo)/(hi-lo),0,1)*100;
function scoreShoot(r){
  const p = (m,a)=> a>0 ? clamp(m/a,0,1)*100 : 0;
  const form = p(r.form,10), ft = p(r.ft,10), mid = p(r.mid,25), three = p(r.three,25);
  const score = Math.round(0.15*form + 0.30*ft + 0.30*mid + 0.25*three);
  return {score, level: score<45?"b":score<62?"i":"a", parts:{form,ft,mid,three}};
}
function scoreDribble(r){
  const pound = norm(((r.rp||0)+(r.lp||0))/2, 30, 80);
  const cross = norm(r.cross||0, 20, 60);
  const cone = r.cone>0 ? clamp((18-r.cone)/(18-8),0,1)*100 : 0;
  const weak = clamp((r.weak||0)*10,0,100);
  const moves = (r.moves||[]).length/6*100;
  const score = Math.round(0.25*pound + 0.2*cross + 0.2*cone + 0.15*weak + 0.2*moves);
  return {score, level: score<40?"b":score<65?"i":"a", parts:{pound,cross,cone,weak,moves}};
}
function recommendedLevel(){
  const ls = ["shoot","dribble"].map(t=>S.tests.filter(x=>x.type===t).slice(-1)[0]).filter(Boolean);
  if(!ls.length) return null;
  const idx = {b:0,i:1,a:2}, back = ["b","i","a"];
  return back[Math.floor(ls.reduce((a,t)=>a+idx[t.level],0)/ls.length + 0.0001)];
}

/* ---------- UI 상태 ---------- */
let tab = "today";
let weekMon = mondayOf(TODAY);
let sel = TODAY_S;
let planSub = "plan";
let libCat = "all", libQ = "";
let growthRange = 12;

/* ---------- 공통 컴포넌트 ---------- */
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(()=>t.hidden=true, 2200);
}
function catTag(c){ const k = CATS[c]||CATS.shoot; return `<span class="cat"><i style="background:${k.color}"></i>${esc(k.name)}</span>`; }
function lvTags(lv){ return [...(lv||"")].map(l=>LEVELS[l]).filter(Boolean).join("·"); }
function ringSVG(pct, done){
  const r=12, c=2*Math.PI*r;
  return `<svg class="ring${done?" done":""}" viewBox="0 0 30 30" aria-hidden="true"><circle class="t" cx="15" cy="15" r="${r}" fill="none" stroke-width="3"/><circle class="p" cx="15" cy="15" r="${r}" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-pct)}" transform="rotate(-90 15 15)"/></svg>`;
}
const YT_ICON = `<svg class="yt" viewBox="0 0 16 12" aria-label="영상 있음"><rect width="16" height="12" rx="3" fill="#E62117"/><path d="M6.3 3.4v5.2L10.6 6z" fill="#fff"/></svg>`;
const CHECK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.5"><path d="m3 8.5 3.2 3L13 4.5"/></svg>`;

function openSheet(title, html, onMount){
  closeSheet();
  const scrim = document.createElement("div");
  scrim.className = "scrim"; scrim.id = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-h"><h2>${esc(title)}</h2><button class="iconbtn" data-act="close-sheet" aria-label="닫기">✕</button></div><div class="sheet-b" id="sheetBody">${html}</div></div>`;
  scrim.addEventListener("click", e=>{ if(e.target===scrim) closeSheet(); });
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";
  onMount && onMount($("sheetBody"));
}
function closeSheet(){ const s = $("scrim"); if(s){ s.remove(); document.body.style.overflow = ""; } }

/* ---------- 헤더 ---------- */
function renderHeader(){
  const X = computeXP();
  $("lvPill").textContent = LEVELS[S.plan.level] + " · 주 " + S.plan.days + "일";
  $("xpPill").textContent = (X.xp).toLocaleString() + " XP";
}

/* ============================================================
   탭 1: 훈련 (오늘)
   ============================================================ */
function renderToday(){
  const v = $("v-today");
  const end = addDays(weekMon,6);
  const thisWeek = ymd(weekMon)===ymd(mondayOf(TODAY));
  let days = "";
  for(let i=0;i<7;i++){
    const d = addDays(weekMon,i), s = ymd(d), st = dayStats(s);
    const cls = ["day"]; if(s===sel) cls.push("sel"); if(s===TODAY_S) cls.push("today");
    const mark = st && st.planned ? ringSVG(st.status==="skip"?0:st.pct, st.status==="done") : (st && st.mins>0 ? ringSVG(1,true) : `<span class="restdot" aria-hidden="true">–</span>`);
    days += `<button class="${cls.join(" ")}" data-act="sel-day" data-date="${s}" aria-label="${d.getMonth()+1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일"><span class="dn">${DOW[d.getDay()]}</span>${mark}<span class="dd num">${d.getDate()}</span></button>`;
  }
  const ws = weekStats(weekMon), target = plannedWeekMins();
  v.innerHTML = `
    <div class="weekbar">
      <div class="weeknav">
        <button class="iconbtn" data-act="week" data-n="-1" aria-label="이전 주">‹</button>
        <div class="weeklabel">${weekMon.getMonth()+1}월 ${weekMon.getDate()}일 – ${end.getMonth()+1}월 ${end.getDate()}일<small>${thisWeek?"이번 주":"&nbsp;"}</small></div>
        <button class="iconbtn" data-act="week" data-n="1" aria-label="다음 주">›</button>
      </div>
      <div class="days">${days}</div>
      <div class="weeksum"><span class="num">${ws.mins}/${target}분</span><div class="bar${ws.done>=ws.planned&&ws.planned?" good":""}"><span style="width:${target?Math.min(100,ws.mins/target*100):0}%"></span></div><span class="num">${ws.done}/${ws.planned}일</span></div>
    </div>
    <div class="view" id="dayView">${dayHTML()}</div>`;
}
function dayHTML(){
  const d = parse(sel), s = sessionFor(sel), L = S.logs[sel];
  const dateTxt = `${d.getMonth()+1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
  let welcome = "";
  if(!S.onboarded){
    welcome = `<div class="welcome"><div class="eyebrow">Hoop!.ver2에 오신 걸 환영해요</div><h2>내 수준에 맞는 플랜부터 정해요</h2><p class="why" style="color:var(--ink)">셀프 테스트로 초급·중급·고급을 확인하거나, 바로 레벨과 주당 훈련 일수를 골라 시작할 수 있어요. 지금은 <b>${LEVELS[S.plan.level]} · 주 ${S.plan.days}일</b> 플랜이에요.</p><div class="row"><button class="btn primary" data-act="goto" data-tab="growth">셀프 테스트 하기</button><button class="btn" data-act="open-setup">레벨·일수 고르기</button><button class="btn ghost" data-act="dismiss-welcome">나중에</button></div></div>`;
  }
  if(L && L.legacy){
    return welcome + `<div class="dayhead"><div class="eyebrow">${dateTxt}</div><h1>ver1 기록</h1><p class="why">이전 앱에서 가져온 기록이에요 · ${L.legacyMins}분${L.memo?` · 메모: ${esc(L.memo)}`:""}</p></div>`;
  }
  if(!s){
    return welcome + `<div class="restcard"><div class="eyebrow">${dateTxt}</div><h1>쉬는 날</h1><p class="why">회복도 훈련이에요. 가벼운 스트레칭, 산책, 물 충분히, 잘 자기.</p><button class="btn sm" data-act="goto" data-tab="plan">이 요일에 세션 추가하기</button></div>`;
  }
  const st = dayStats(sel);
  const items = s.items.filter(i=>drill(i.d));
  const chip = st.status==="done" ? `<span class="chip done">완료 · ${st.mins}분 · +${st.mins+20} XP</span>` : st.status==="part" ? `<span class="chip part">진행 중 · ${st.mins}/${st.total}분</span>` : st.status==="skip" ? `<span class="chip skip">못 함</span>` : `<span class="chip">시작 전 · ${st.total}분</span>`;
  return welcome + `
    <div class="dayhead" style="display:flex;flex-direction:column;gap:5px">
      <div class="eyebrow">${dateTxt} · ${LEVELS[S.plan.level]}</div>
      <h1>${esc(s.title)}</h1>
      <p class="why">${esc(s.why||"")}</p>
      <div class="row">${chip}<button class="btn ghost sm" data-act="edit-session" data-sid="${s.id}">세션 편집</button></div>
    </div>
    <ul class="drills">${items.map(i=>drillRowHTML(i, L)).join("")}</ul>
    <div class="panel">
      <h2>오늘의 피드백</h2>
      <div class="q" style="display:flex;flex-direction:column;gap:6px"><span class="small muted" style="font-weight:600">몸 상태 · 집중도</span>${scaleHTML("feel",[["1","최악"],["2","별로"],["3","보통"],["4","좋음"],["5","최고"]],L?.feel)}</div>
      <div class="q" style="display:flex;flex-direction:column;gap:6px"><span class="small muted" style="font-weight:600">운동 강도</span>${scaleHTML("effort",[["1","가볍게"],["2",""],["3","적당"],["4",""],["5","최대"]],L?.effort)}</div>
      <label class="f" for="memo">메모 · 잘된 점, 고칠 점 (+5 XP)<textarea id="memo" placeholder="예) 3점 왼쪽 45도에서 팔로스루가 짧았음. 다음엔 무릎 더 쓰기.">${esc(L?.memo||"")}</textarea></label>
      <div class="row"><button class="btn dark grow" data-act="all-done">전부 완료로 표시</button><button class="btn ghost" data-act="skip">${L?.skipped?"‘못 함’ 취소":"오늘은 못 함"}</button></div>
    </div>`;
}
function drillRowHTML(i, L){
  const dr = drill(i.d), it = L?.items[i.d] || {};
  const on = !!it.done;
  let log = "";
  if(dr.log==="ma"){
    const pct = it.a>0 ? Math.round(Math.min(it.m||0,it.a)/it.a*100)+"%" : "–";
    log = `<div class="log"><label for="m-${i.d}">성공</label><input id="m-${i.d}" type="number" inputmode="numeric" min="0" data-log="${i.d}" data-k="m" value="${it.m??""}"><label for="a-${i.d}">/ 시도</label><input id="a-${i.d}" type="number" inputmode="numeric" min="0" data-log="${i.d}" data-k="a" value="${it.a??""}"><span class="pct" id="pct-${i.d}">${pct}</span></div>`;
  } else if(dr.log==="count"){
    log = `<div class="log"><label for="c-${i.d}">횟수</label><input id="c-${i.d}" type="number" inputmode="numeric" min="0" data-log="${i.d}" data-k="c" value="${it.c??""}"></div>`;
  } else if(dr.log==="time"){
    log = `<div class="log"><label for="t-${i.d}">기록(초)</label><input id="t-${i.d}" type="number" inputmode="decimal" min="0" step="0.1" data-log="${i.d}" data-k="t" value="${it.t??""}"></div>`;
  }
  return `<li class="drill${on?" on":""}${i.on?"":" off"}">
    <button class="check" data-act="toggle-drill" data-d="${i.d}" aria-pressed="${on}" aria-label="${esc(dr.name)} 완료">${CHECK_SVG}</button>
    <div class="body"><button class="nm" data-act="drill-info" data-d="${i.d}">${esc(dr.name)}${dr.yt?YT_ICON:""}</button><div class="cue">${i.on?esc(dr.cues):"오늘 세션에서 해제됨"}</div>${i.on?log:""}</div>
    <div class="side"><span class="min">${i.min}분</span>${i.on?`<button class="tbtn" data-act="timer" data-d="${i.d}" data-min="${i.min}">▶ 타이머</button>`:""}</div></li>`;
}
function scaleHTML(name, opts, val){
  return `<div class="scale" role="radiogroup">${opts.map(([v,l])=>`<button type="button" role="radio" aria-checked="${String(val)===v}" class="${String(val)===v?"on":""}" data-act="scale" data-scale="${name}" data-v="${v}">${v}<small>${l||"&nbsp;"}</small></button>`).join("")}</div>`;
}
function touchLog(){ const L = logFor(sel,true); L.updatedAt = Date.now(); save(); }
function afterLogChange(){
  const y = window.scrollY; renderToday(); window.scrollTo(0, y);
  renderHeader(); checkCelebrate();
}

/* ============================================================
   타이머
   ============================================================ */
let timer = null;
function startTimer(d, min){
  stopTimer(true);
  const dr = drill(d);
  timer = {d, name:dr.name, end:Date.now()+min*60000, total:min*60000, paused:null};
  $("timer").hidden = false;
  tick();
  timer.iv = setInterval(tick, 250);
  try { navigator.wakeLock?.request("screen").then(l=>timer && (timer.lock=l)).catch(()=>{}); } catch(e){}
}
function tick(){
  if(!timer) return;
  const left = timer.paused!=null ? timer.paused : Math.max(0, timer.end - Date.now());
  const s = Math.ceil(left/1000);
  $("timerT").textContent = `${Math.floor(s/60)}:${pad(s%60)}`;
  $("timerN").textContent = timer.name;
  $("timerP").textContent = timer.paused!=null ? "계속" : "일시정지";
  if(left<=0 && timer.paused==null){
    const d = timer.d; stopTimer(); beep();
    try { navigator.vibrate?.([300,120,300]); } catch(e){}
    const L = logFor(sel,true); L.items[d] = Object.assign(L.items[d]||{}, {done:true}); L.skipped=false;
    const s = sessionFor(sel); const it = s?.items.find(i=>i.d===d); if(it) L.mins[d] = it.min;
    touchLog(); toast(`${drill(d)?.name||"훈련"} 끝! 완료로 표시했어요.`);
    if(tab==="today") afterLogChange();
  }
}
function stopTimer(silent){ if(!timer) return; clearInterval(timer.iv); try{ timer.lock?.release(); }catch(e){} timer = null; $("timer").hidden = true; }
function beep(){
  try{ const ac = new (window.AudioContext||window.webkitAudioContext)(); [0,0.35,0.7].forEach(t=>{ const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.25, ac.currentTime+t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+t+0.3); o.start(ac.currentTime+t); o.stop(ac.currentTime+t+0.3); }); }catch(e){}
}

/* ============================================================
   훈련 상세 (설명 + 영상)
   ============================================================ */
function ytId(s){
  if(!s) return "";
  s = String(s).trim();
  if(/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : "";
}
function ytSearchURL(dr){ return "https://www.youtube.com/results?search_query=" + encodeURIComponent(dr.q || (dr.name + " 농구 연습")); }
function drillInfo(id, ctx){
  const dr = drill(id); if(!dr) return;
  const vid = ytId(dr.yt);
  const inPlan = S.plan.sessions.filter(s=>s.items.some(i=>i.d===id)).map(s=>DOW[s.dow]).join("·");
  openSheet(dr.name, `
    <div class="row">${catTag(dr.cat)}<span class="chip lv">${lvTags(dr.lv)||"전체"}</span><span class="chip">${dr.min}분 기본</span>${dr.custom?`<span class="chip part">직접 추가</span>`:""}</div>
    ${vid ? `<div class="ytbox" id="ytbox"><button class="ytthumb" data-act="play-yt" data-v="${vid}" style="background-image:url('https://i.ytimg.com/vi/${vid}/hqdefault.jpg')" aria-label="영상 재생"><span><svg width="20" height="20" viewBox="0 0 20 20"><path d="M6 4v12l10-6z" fill="#fff"/></svg></span></button></div>${dr.src?`<div class="src">영상: ${esc(dr.src)}</div>`:""}` : `<div class="empty">연결된 영상이 없어요. 아래 버튼으로 유튜브에서 찾아보거나, 편집에서 영상 링크를 넣을 수 있어요.</div>`}
    <div class="row"><a class="btn sm" href="${ytSearchURL(dr)}" target="_blank" rel="noopener">유튜브에서 비슷한 영상 찾기 ↗</a>${vid?`<a class="btn sm ghost" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">유튜브 앱으로 열기 ↗</a>`:""}</div>
    <div><h3 style="margin-bottom:6px">하는 방법</h3>${(dr.how||[]).length?`<ol class="howlist">${dr.how.map(h=>`<li>${esc(h)}</li>`).join("")}</ol>`:`<p class="why">설명이 아직 없어요. 편집에서 추가해 보세요.</p>`}</div>
    ${dr.cues?`<div class="callout"><b>핵심 포인트</b><br>${esc(dr.cues)}</div>`:""}
    ${dr.mistakes?`<div class="callout warn"><b>자주 하는 실수</b><br>${esc(dr.mistakes)}</div>`:""}
    <p class="small muted">기록 방식: ${LOGS[dr.log]||"기록 없음"}${inPlan?` · 플랜 포함: ${inPlan}`:" · 지금 플랜에는 없어요"}</p>
    <div class="row"><button class="btn" data-act="edit-drill" data-d="${id}">이 훈련 편집</button><button class="btn" data-act="add-to-session-pick" data-d="${id}">세션에 추가</button></div>`);
}

/* ============================================================
   탭 2: 플랜 (주간 플랜 편집 + 라이브러리)
   ============================================================ */
function renderPlan(){
  const v = $("v-plan");
  v.innerHTML = `<div class="view">
    <div class="seg" role="tablist"><button class="${planSub==="plan"?"on":""}" data-act="plan-sub" data-s="plan">주간 플랜</button><button class="${planSub==="lib"?"on":""}" data-act="plan-sub" data-s="lib">훈련 라이브러리</button></div>
    <div id="planBody">${planSub==="plan"?planHTML():libHTML()}</div></div>`;
}
function planHTML(){
  const P = S.plan;
  const sorted = [...P.sessions].sort((a,b)=>((a.dow+6)%7)-((b.dow+6)%7));
  const rest = [1,2,3,4,5,6,0].filter(d=>!P.sessions.some(s=>s.dow===d)).map(d=>DOW[d]).join("·");
  return `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="panel">
      <div class="panel-h"><div><div class="eyebrow">기본 플랜</div><h2>${LEVELS[P.level]} · 주 ${P.days}일 · 주 ${plannedWeekMins()}분</h2></div><button class="btn sm" data-act="open-setup">레벨·일수 바꾸기</button></div>
      <p class="why">휴식: ${rest||"없음"} · 세션 이름, 요일, 훈련, 시간 모두 직접 바꿀 수 있어요. 스위치로 훈련을 잠시 해제할 수도 있어요.</p>
    </div>
    ${sorted.map(sessHTML).join("")}
    <button class="btn block" data-act="add-session">+ 세션 추가</button>
    <p class="src">세션 구조: The Hoop Sage 주간 루틴 · 드릴과 영상: BALLKICKZ 채널 외</p></div>`;
}
function sessHTML(s){
  const used = S.plan.sessions.map(x=>x.dow);
  return `<article class="sess" id="sess-${s.id}">
    <div class="sess-h">
      <select class="dow" data-act="sess-dow" data-sid="${s.id}" aria-label="요일" style="appearance:none;-webkit-appearance:none;text-align:center;padding:0;font-family:var(--f-display);font-size:18px;color:var(--rim);background:var(--rim-soft);border:0;width:40px;height:36px;border-radius:10px">${[1,2,3,4,5,6,0].map(d=>`<option value="${d}" ${d===s.dow?"selected":""}>${DOW[d]}${used.includes(d)&&d!==s.dow?"*":""}</option>`).join("")}</select>
      <div class="tt"><b>${esc(s.title)}</b><span>${sessMins(s)}분 · 훈련 ${s.items.filter(i=>i.on).length}개</span></div>
      <button class="btn sm ghost" data-act="sess-rename" data-sid="${s.id}">이름</button>
    </div>
    <ul class="items">${s.items.map((it,k)=>itemHTML(s,it,k)).join("") || `<li class="item"><span class="muted small">훈련이 없어요. 아래에서 추가하세요.</span></li>`}</ul>
    <div class="sess-f"><button class="btn sm" data-act="add-item" data-sid="${s.id}">+ 훈련 추가</button><button class="btn sm ghost" data-act="sess-del" data-sid="${s.id}">세션 삭제</button></div>
  </article>`;
}
function itemHTML(s,it,k){
  const dr = drill(it.d);
  if(!dr) return "";
  return `<li class="item${it.on?"":" off"}">
    <button class="sw${it.on?" on":""}" data-act="item-on" data-sid="${s.id}" data-k="${k}" role="switch" aria-checked="${it.on}" aria-label="${esc(dr.name)} 사용"></button>
    <button class="inm" data-act="drill-info" data-d="${it.d}"><b>${esc(dr.name)} ${dr.yt?YT_ICON:""}</b>${catTag(dr.cat)}</button>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
      <div class="stepper"><button data-act="item-min" data-sid="${s.id}" data-k="${k}" data-n="-5" aria-label="5분 줄이기">−</button><span>${it.min}분</span><button data-act="item-min" data-sid="${s.id}" data-k="${k}" data-n="5" aria-label="5분 늘리기">+</button></div>
      <div class="stepper"><button data-act="item-move" data-sid="${s.id}" data-k="${k}" data-n="-1" aria-label="위로">↑</button><button data-act="item-move" data-sid="${s.id}" data-k="${k}" data-n="1" aria-label="아래로">↓</button><button data-act="item-del" data-sid="${s.id}" data-k="${k}" aria-label="빼기">✕</button></div>
    </div></li>`;
}
function libHTML(){
  const list = allDrills().filter(d => (libCat==="all" || d.cat===libCat) && (!libQ || (d.name+d.cues+(d.how||[]).join(" ")).toLowerCase().includes(libQ.toLowerCase())));
  return `<div style="display:flex;flex-direction:column;gap:12px">
    <div class="libsearch"><input type="text" id="libQ" placeholder="훈련 검색" value="${esc(libQ)}" aria-label="훈련 검색"><button class="btn primary" data-act="new-drill">+ 새 훈련</button></div>
    <div class="libfilter"><button class="${libCat==="all"?"on":""}" data-act="lib-cat" data-c="all">전체</button>${Object.entries(CATS).map(([k,c])=>`<button class="${libCat===k?"on":""}" data-act="lib-cat" data-c="${k}">${esc(c.name)}</button>`).join("")}</div>
    <div class="lib">${list.map(d=>{
      const used = S.plan.sessions.filter(s=>s.items.some(i=>i.d===d.id)).map(s=>DOW[s.dow]).join("");
      return `<button class="libitem${d.hidden?" hid":""}" data-act="drill-info" data-d="${d.id}"><div style="min-width:0"><b>${esc(d.name)} ${d.yt?YT_ICON:""}</b><div class="meta">${catTag(d.cat)}<span class="small muted">${lvTags(d.lv)} · ${d.min}분</span>${d.custom?`<span class="chip part">직접 추가</span>`:""}</div></div><span class="small muted">${used?used:"—"}</span></button>`;
    }).join("") || `<div class="empty">검색 결과가 없어요. ‘+ 새 훈련’으로 직접 만들어 보세요.</div>`}</div>
    <p class="src">오른쪽 글자는 이 훈련이 들어 있는 요일이에요. 빨간 아이콘은 영상이 연결된 훈련이에요.</p></div>`;
}
function findSess(id){ return S.plan.sessions.find(s=>s.id===id); }
function rerenderPlan(){ const y = window.scrollY; renderPlan(); window.scrollTo(0,y); renderHeader(); }

function openSetup(){
  let lv = S.plan.level, dy = S.plan.days;
  const rec = recommendedLevel();
  const body = () => `
    <p class="why">레벨과 주당 일수를 고르면 그에 맞는 기본 플랜으로 바뀌어요. 지금 플랜에서 직접 고친 내용은 새 플랜으로 덮어써져요(훈련 기록은 그대로 남아요).</p>
    <div><h3 style="margin-bottom:8px">레벨${rec?` <span class="chip lv">테스트 추천: ${LEVELS[rec]}</span>`:""}</h3>
    <div class="seg">${["b","i","a"].map(l=>`<button class="${lv===l?"on":""}" data-pick-lv="${l}">${LEVELS[l]}</button>`).join("")}</div>
    <p class="small muted" style="margin-top:6px">${{b:"기본 슛 폼·양손 레이업·기초 핸들링 위주",i:"3점·풀업·콤보 드리블·투맨게임 입문",a:"코너3·스텝백·투볼·컨택 피니시·고급 투맨게임"}[lv]}</p></div>
    <div><h3 style="margin-bottom:8px">주당 훈련 일수</h3>
    <div class="seg">${[3,4,5,6].map(n=>`<button class="${dy===n?"on":""}" data-pick-dy="${n}">주 ${n}일</button>`).join("")}</div>
    <p class="small muted" style="margin-top:6px">기본 요일: ${WEEK_LAYOUT[dy].dows.map(d=>DOW[d]).join("·")} (나중에 세션별로 바꿀 수 있어요)<br>세션: ${WEEK_LAYOUT[dy].types.map(t=>SESSION_TYPES[t].title).join(" / ")}</p></div>
    <button class="btn primary block" data-pick-apply>이 플랜으로 시작</button>`;
  openSheet("레벨 · 주당 일수", body(), el=>{
    el.addEventListener("click", e=>{
      const b = e.target.closest("button"); if(!b) return;
      if(b.dataset.pickLv){ lv = b.dataset.pickLv; el.innerHTML = body(); }
      else if(b.dataset.pickDy){ dy = +b.dataset.pickDy; el.innerHTML = body(); }
      else if(b.hasAttribute("data-pick-apply")){
        S.plan = buildPlan(lv, dy); S.level = lv; S.days = dy; S.onboarded = true; save();
        closeSheet(); toast(`${LEVELS[lv]} · 주 ${dy}일 플랜으로 바꿨어요.`); renderAll();
      }
    });
  });
}
function pickDrillFor(sid){
  const s = findSess(sid); let q = "", cat = "all";
  const body = () => {
    const list = allDrills().filter(d=>!d.hidden && (cat==="all"||d.cat===cat) && (!q || d.name.toLowerCase().includes(q.toLowerCase())));
    return `<input type="text" id="pickQ" placeholder="훈련 검색" value="${esc(q)}" aria-label="훈련 검색">
      <div class="libfilter"><button class="${cat==="all"?"on":""}" data-pc="all">전체</button>${Object.entries(CATS).map(([k,c])=>`<button class="${cat===k?"on":""}" data-pc="${k}">${esc(c.name)}</button>`).join("")}</div>
      <div class="lib">${list.map(d=>{ const has = s.items.some(i=>i.d===d.id); return `<button class="libitem" data-pick="${d.id}" ${has?"disabled":""}><div style="min-width:0"><b>${esc(d.name)}</b><div class="meta">${catTag(d.cat)}<span class="small muted">${lvTags(d.lv)} · ${d.min}분</span></div></div><span class="small ${has?"muted":""}" style="color:${has?"":"var(--rim)"};font-weight:700">${has?"추가됨":"+ 추가"}</span></button>`; }).join("")}</div>
      <button class="btn block" data-pick-new>+ 목록에 없는 새 훈련 만들기</button>`;
  };
  openSheet(`${DOW[s.dow]}요일 세션에 훈련 추가`, body(), el=>{
    el.addEventListener("click", e=>{
      const b = e.target.closest("button"); if(!b) return;
      if(b.dataset.pc){ cat = b.dataset.pc; el.innerHTML = body(); }
      else if(b.dataset.pick){ const d = drill(b.dataset.pick); s.items.push({d:d.id, min:d.min, on:true}); save(); toast(`‘${d.name}’ 추가`); el.innerHTML = body(); rerenderAfterPlanChange(); }
      else if(b.hasAttribute("data-pick-new")){ editDrill(null, sid); }
    });
    el.addEventListener("input", e=>{ if(e.target.id==="pickQ"){ q = e.target.value; const pos = e.target.selectionStart; el.innerHTML = body(); const i = $("pickQ"); i.focus(); i.setSelectionRange(pos,pos); } });
  });
}
function rerenderAfterPlanChange(){ if(tab==="plan") rerenderPlan(); else if(tab==="today") renderToday(); renderHeader(); }

function editDrill(id, addToSid){
  const isNew = !id;
  const dr = isNew ? {id:uid("c_"), name:"", cat:"shoot", lv:"bia", min:10, log:"none", how:[], cues:"", mistakes:"", yt:"", q:"", custom:true} : drill(id);
  openSheet(isNew ? "새 훈련 만들기" : "훈련 편집", `
    <form id="drillForm" style="display:flex;flex-direction:column;gap:12px">
      <label class="f">이름<input type="text" id="df-name" required maxlength="40" value="${esc(dr.name)}" placeholder="예) 엘보 풀업 20개"></label>
      <div class="row" style="align-items:stretch">
        <label class="f grow">종류<select id="df-cat">${Object.entries(CATS).map(([k,c])=>`<option value="${k}" ${dr.cat===k?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="f" style="width:96px">기본 시간(분)<input type="number" id="df-min" min="1" max="120" value="${dr.min}"></label>
      </div>
      <div><span class="small muted" style="font-weight:600">레벨</span><div class="row" style="margin-top:6px">${["b","i","a"].map(l=>`<label class="chip" style="cursor:pointer"><input type="checkbox" data-lv="${l}" ${dr.lv.includes(l)?"checked":""}> ${LEVELS[l]}</label>`).join("")}</div></div>
      <label class="f">기록 방식<select id="df-log">${Object.entries(LOGS).map(([k,n])=>`<option value="${k}" ${dr.log===k?"selected":""}>${n}</option>`).join("")}</select></label>
      <label class="f">하는 방법 (한 줄에 한 단계)<textarea id="df-how" rows="5" placeholder="1단계&#10;2단계">${esc((dr.how||[]).join("\n"))}</textarea></label>
      <label class="f">핵심 포인트<textarea id="df-cues" rows="2">${esc(dr.cues)}</textarea></label>
      <label class="f">자주 하는 실수<textarea id="df-mis" rows="2">${esc(dr.mistakes)}</textarea></label>
      <label class="f">유튜브 영상 링크 (선택)<input type="url" id="df-yt" value="${dr.yt?esc("https://youtu.be/"+ytId(dr.yt)):""}" placeholder="https://youtu.be/..."></label>
      <label class="f">유튜브 검색어 (영상이 없을 때 찾기 버튼에 사용)<input type="text" id="df-q" value="${esc(dr.q||"")}" placeholder="${esc((dr.name||"훈련 이름")+" 농구 연습")}"></label>
      <div class="row"><button class="btn primary grow" type="submit">${isNew?"만들기":"저장"}</button>${!isNew && !dr.custom && S.drills[id] ? `<button class="btn ghost" type="button" data-df-reset>기본값으로</button>`:""}${!isNew && dr.custom?`<button class="btn danger" type="button" data-df-del>삭제</button>`:""}${!isNew?`<button class="btn ghost" type="button" data-df-hide>${dr.hidden?"추가 목록에 다시 보이기":"추가 목록에서 숨기기"}</button>`:""}</div>
      <p class="small muted" id="df-msg" aria-live="polite"></p>
    </form>`, el=>{
    const f = $("drillForm");
    f.addEventListener("submit", e=>{
      e.preventDefault();
      const name = $("df-name").value.trim(); if(!name){ $("df-msg").textContent = "이름을 입력해 주세요."; return; }
      const lv = [...f.querySelectorAll("[data-lv]")].filter(x=>x.checked).map(x=>x.dataset.lv).join("") || "bia";
      const ytRaw = $("df-yt").value.trim(); const yt = ytId(ytRaw);
      if(ytRaw && !yt){ $("df-msg").textContent = "유튜브 링크를 알아볼 수 없어요. 영상 주소를 그대로 붙여 넣어 주세요."; return; }
      const data = {name, cat:$("df-cat").value, min:clamp(parseInt($("df-min").value)||10,1,120), lv, log:$("df-log").value,
        how:$("df-how").value.split("\n").map(x=>x.trim()).filter(Boolean), cues:$("df-cues").value.trim(), mistakes:$("df-mis").value.trim(), yt, q:$("df-q").value.trim()};
      if(yt && DRILLS[dr.id]?.yt !== yt) data.src = "직접 연결한 영상";
      if(isNew){ S.drills[dr.id] = Object.assign({custom:true}, data); }
      else S.drills[dr.id] = Object.assign({}, S.drills[dr.id]||{}, data);
      if(isNew && addToSid){ const s = findSess(addToSid); s && s.items.push({d:dr.id, min:data.min, on:true}); }
      save(); closeSheet(); toast(isNew ? `‘${name}’ 훈련을 만들었어요.` : "저장했어요."); rerenderAfterPlanChange();
    });
    el.addEventListener("click", e=>{
      const b = e.target.closest("button"); if(!b) return;
      if(b.hasAttribute("data-df-reset")){ delete S.drills[dr.id]; save(); closeSheet(); toast("기본 설명으로 되돌렸어요."); rerenderAfterPlanChange(); }
      if(b.hasAttribute("data-df-hide")){ S.drills[dr.id] = Object.assign({}, S.drills[dr.id]||{}, {hidden:!dr.hidden}); save(); closeSheet(); toast(dr.hidden?"다시 보이게 했어요.":"추가 목록에서 숨겼어요. 라이브러리에는 흐리게 남아요."); rerenderAfterPlanChange(); }
      if(b.hasAttribute("data-df-del")){
        if(b.dataset.confirm){ S.drills[dr.id] = {deleted:true}; S.plan.sessions.forEach(s=>s.items = s.items.filter(i=>i.d!==dr.id)); save(); closeSheet(); toast("삭제했어요."); rerenderAfterPlanChange(); }
        else { b.dataset.confirm = "1"; b.textContent = "정말 삭제(다시 누르기)"; }
      }
    });
  });
}
function addToSessionPick(d){
  const dr = drill(d);
  openSheet(`‘${dr.name}’ 추가할 세션`, `<div class="lib">${[...S.plan.sessions].sort((a,b)=>((a.dow+6)%7)-((b.dow+6)%7)).map(s=>{ const has = s.items.some(i=>i.d===d); return `<button class="libitem" data-addto="${s.id}" ${has?"disabled":""}><div><b>${DOW[s.dow]} · ${esc(s.title)}</b><div class="meta small muted">${sessMins(s)}분</div></div><span class="small" style="font-weight:700;color:${has?"var(--muted)":"var(--rim)"}">${has?"이미 있음":"+ 추가"}</span></button>`; }).join("")}</div>`, el=>{
    el.addEventListener("click", e=>{ const b = e.target.closest("[data-addto]"); if(!b) return; const s = findSess(b.dataset.addto); s.items.push({d, min:dr.min, on:true}); save(); closeSheet(); toast(`${DOW[s.dow]}요일 세션에 추가했어요.`); rerenderAfterPlanChange(); });
  });
}

/* ============================================================
   탭 3: 성장 (셀프 테스트 + 차트)
   ============================================================ */
function renderGrowth(){
  const v = $("v-growth");
  const lastS = S.tests.filter(t=>t.type==="shoot").slice(-1)[0];
  const lastD = S.tests.filter(t=>t.type==="dribble").slice(-1)[0];
  const rec = recommendedLevel();
  const meter = l => `<div class="lvmeter">${["b","i","a"].map(x=>`<span class="${l && "bia".indexOf(x)<="bia".indexOf(l)?"on":""}"></span>`).join("")}</div>`;
  v.innerHTML = `<div class="view">
    <div><div class="eyebrow">셀프 테스트 · 성장 기록</div><h1>내 실력은 지금 어디쯤?</h1></div>
    ${rec ? `<div class="panel" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="small muted">테스트 기준 추천 레벨</span><h2>${LEVELS[rec]}${rec!==S.plan.level?` <span class="chip part">지금 플랜: ${LEVELS[S.plan.level]}</span>`:` <span class="chip done">플랜과 일치</span>`}</h2></div>${rec!==S.plan.level?`<button class="btn primary sm" data-act="apply-rec" data-l="${rec}">${LEVELS[rec]} 플랜으로 바꾸기</button>`:""}</div>`:""}
    <div class="tests">
      <button class="tcard" data-act="test" data-t="shoot"><span class="eyebrow">슈팅 테스트</span>${lastS?`<div class="big">${lastS.score}<small>/100</small></div>${meter(lastS.level)}<span class="small muted">${LEVELS[lastS.level]} · ${md(parse(lastS.date))}</span>`:`<div class="big muted">—</div>${meter(null)}<span class="small muted">골밑·자유투·미드·3점 70개</span>`}<span class="btn sm primary" style="margin-top:4px">${lastS?"다시 테스트":"테스트 시작"}</span></button>
      <button class="tcard" data-act="test" data-t="dribble"><span class="eyebrow">드리블 테스트</span>${lastD?`<div class="big">${lastD.score}<small>/100</small></div>${meter(lastD.level)}<span class="small muted">${LEVELS[lastD.level]} · ${md(parse(lastD.date))}</span>`:`<div class="big muted">—</div>${meter(null)}<span class="small muted">파운드·크로스·콘·약손·기술</span>`}<span class="btn sm primary" style="margin-top:4px">${lastD?"다시 테스트":"테스트 시작"}</span></button>
    </div>
    <div class="panel"><div class="panel-h"><h2>테스트 점수 추이</h2><div class="legend"><span><i style="background:var(--c-shoot)"></i>슈팅</span><span><i style="background:var(--c-handle)"></i>드리블</span></div></div>${testChart()}</div>
    <div class="panel"><div class="panel-h"><h2>훈련 중 슛 성공률</h2><div class="seg" style="width:160px">${[8,12,26].map(n=>`<button class="${growthRange===n?"on":""}" data-act="range" data-n="${n}">${n}주</button>`).join("")}</div></div>${shotChart()}</div>
    <div class="panel"><h2>주간 훈련 시간</h2>${minutesChart()}</div>
    ${S.tests.length?`<div class="panel"><h2>테스트 기록</h2>${[...S.tests].reverse().slice(0,12).map((t,k)=>`<div class="rewardrow"><div><b>${t.type==="shoot"?"슈팅":"드리블"} ${t.score}점</b> <span class="chip lv">${LEVELS[t.level]}</span><div class="small muted">${t.date}</div></div><span></span><button class="btn sm ghost" data-act="del-test" data-i="${S.tests.length-1-k}">삭제</button></div>`).join("")}</div>`:""}
    <p class="src">레벨 기준은 동호인 기준의 대략적인 값이에요. 같은 장소·같은 방법으로 4~6주마다 다시 재면 추세가 정확해져요.</p>
  </div>`;
}
function lineChart(series, opt){
  // series: [{name,color,pts:[{x:Date|index,label,y}]}]
  const W = 340, H = opt.h||170, L = 30, R = 10, T = 12, B = 24;
  const xs = opt.xs; // array of labels (categorical)
  const n = xs.length; if(n===0) return "";
  const ymin = opt.ymin ?? 0, ymax = opt.ymax ?? 100;
  const X = i => L + (n===1 ? (W-L-R)/2 : i*(W-L-R)/(n-1));
  const Y = v => T + (1-(v-ymin)/(ymax-ymin))*(H-T-B);
  let g = "";
  const ticks = opt.ticks || [0,25,50,75,100];
  ticks.forEach(t=>{ g += `<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L-6}" y="${Y(t)+3}" text-anchor="end">${t}${opt.unit||""}</text>`; });
  (opt.bands||[]).forEach(b=>{ g += `<line x1="${L}" x2="${W-R}" y1="${Y(b.y)}" y2="${Y(b.y)}" stroke="${b.color}" stroke-dasharray="3 3" stroke-width="1"/><text x="${W-R}" y="${Y(b.y)-3}" text-anchor="end" style="fill:${b.color}">${b.label}</text>`; });
  const step = Math.ceil(n/6);
  xs.forEach((lb,i)=>{ if(i%step===0 || i===n-1) g += `<text x="${X(i)}" y="${H-8}" text-anchor="middle">${esc(lb)}</text>`; });
  series.forEach(s=>{
    const pts = s.pts.filter(p=>p.y!=null);
    if(!pts.length) return;
    const d = pts.map((p,k)=>`${k?"L":"M"}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    if(opt.area && pts.length>1) g += `<path d="${d}L${X(pts[pts.length-1].i)},${Y(ymin)}L${X(pts[0].i)},${Y(ymin)}Z" fill="${s.color}" opacity=".12"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p,k)=>{ const last = k===pts.length-1; g += `<circle cx="${X(p.i)}" cy="${Y(p.y)}" r="${last?4.5:3}" fill="${last?s.color:"var(--surface)"}" stroke="${s.color}" stroke-width="2"/>`; if(last) g += `<text x="${Math.min(X(p.i), W-R-4)}" y="${Y(p.y)-9}" text-anchor="middle" style="fill:${s.color};font-weight:600">${Math.round(p.y)}${opt.unit||""}</text>`; });
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label||"차트")}">${g}</svg></div>`;
}
function testChart(){
  if(!S.tests.length) return `<div class="empty">테스트를 하면 여기에 점수 변화가 그려져요.</div>`;
  const dates = [...new Set(S.tests.map(t=>t.date))].sort();
  const mk = (type,color,name) => ({name,color,pts:dates.map((d,i)=>{ const t = S.tests.filter(x=>x.type===type && x.date===d).slice(-1)[0]; return {i, y:t?t.score:null}; })});
  return lineChart([mk("shoot","var(--c-shoot)","슈팅"), mk("dribble","var(--c-handle)","드리블")], {xs:dates.map(d=>md(parse(d))), label:"셀프 테스트 점수 추이", bands:[{y:45,label:"중급",color:"var(--muted)"},{y:62,label:"고급",color:"var(--muted)"}]});
}
function weeksBack(n){ const out=[]; const m = mondayOf(TODAY); for(let k=n-1;k>=0;k--) out.push(addDays(m,-7*k)); return out; }
function shotChart(){
  const ws = weeksBack(growthRange);
  const pts = ws.map((w,i)=>{ const end = addDays(w,7); const t = shotTotals(d=>{ const x = parse(d); return x>=w && x<end; }); return {i, y: t.a>=5 ? t.m/t.a*100 : null, a:t.a}; });
  if(!pts.some(p=>p.y!=null)) return `<div class="empty">훈련 탭에서 슛 ‘성공 / 시도’를 적으면 주별 성공률이 그려져요.</div>`;
  const tot = shotTotals();
  return lineChart([{name:"성공률",color:"var(--c-shoot)",pts}], {xs:ws.map(md), area:true, unit:"%", label:"주별 슛 성공률"}) + `<p class="small muted">누적 ${tot.m.toLocaleString()} / ${tot.a.toLocaleString()} 성공 · 평균 ${tot.a?Math.round(tot.m/tot.a*100):0}%</p>`;
}
function minutesChart(){
  const ws = weeksBack(12);
  const vals = ws.map(w=>weekStats(w).mins);
  const target = plannedWeekMins();
  const W=340,H=150,L=30,R=10,T=12,B=24; const max = Math.max(target, ...vals, 60);
  const bw = (W-L-R)/ws.length;
  const Y = v => T + (1-v/max)*(H-T-B);
  let g = "";
  [0, Math.round(max/2), max].forEach(t=>{ g += `<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L-6}" y="${Y(t)+3}" text-anchor="end">${t}</text>`; });
  vals.forEach((v,i)=>{ const x = L+i*bw+bw*0.18, w = bw*0.64; const full = v>=target && target>0; g += `<rect x="${x}" y="${Y(v)}" width="${w}" height="${Math.max(0,Y(0)-Y(v))}" rx="3" fill="${full?"var(--good)":"var(--rim)"}" opacity="${i===vals.length-1?1:.75}"/>`; if(i%2===1 || i===vals.length-1) g += `<text x="${x+w/2}" y="${H-8}" text-anchor="middle">${md(ws[i])}</text>`; });
  g += `<line x1="${L}" x2="${W-R}" y1="${Y(target)}" y2="${Y(target)}" stroke="var(--court)" stroke-dasharray="4 3"/><text x="${W-R}" y="${Y(target)-4}" text-anchor="end" style="fill:var(--court)">목표 ${target}분</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주간 훈련 시간">${g}</svg></div><div class="legend"><span><i style="background:var(--good)"></i>목표 달성</span><span><i style="background:var(--rim)"></i>미달</span></div>`;
}
function openTest(type){
  if(type==="shoot"){
    openSheet("슈팅 셀프 테스트", `
      <p class="why">워밍업 후 같은 순서로 던지고 성공 개수만 적어요. 총 70개, 15~20분.</p>
      <form id="testForm" class="testform">
        ${[["form","골밑 폼 슈팅","림 앞 1~2m, 한 손 슛 10개",10],["ft","자유투","루틴대로 10개",10],["mid","미드레인지","5스팟 × 5개 = 25개",25],["three","3점","5스팟 × 5개 = 25개 (초급은 한 발 안에서도 OK)",25]].map(([k,n,h,max])=>`<div class="q"><div><b>${n}</b><span>${h}</span></div><input type="number" inputmode="numeric" min="0" max="${max}" id="t-${k}" placeholder="0~${max}" aria-label="${n} 성공 개수" required></div>`).join("")}
        <button class="btn primary block" type="submit" style="margin-top:12px">결과 보기</button>
      </form><div id="testRes"></div>`, el=>{
      $("testForm").addEventListener("submit", e=>{
        e.preventDefault();
        const g = k => clamp(parseInt($("t-"+k).value)||0, 0, k==="mid"||k==="three"?25:10);
        const raw = {form:g("form"), ft:g("ft"), mid:g("mid"), three:g("three")};
        const r = scoreShoot(raw); finishTest("shoot", raw, r);
      });
    });
  } else {
    openSheet("드리블 셀프 테스트", `
      <p class="why">휴대폰 스톱워치로 재요. 각 항목 1번씩, 10~15분.</p>
      <form id="testForm" class="testform">
        ${[["rp","오른손 파운드","30초 동안 무릎 높이 드리블 횟수"],["lp","왼손 파운드","30초 동안 무릎 높이 드리블 횟수"],["cross","크로스오버","30초 동안 좌우 크로스오버 횟수"],["cone","콘 지그재그 왕복(초)","콘 5개 2m 간격, 크로스오버로 왕복한 시간"],["weak","약한 손 레이업","약한 손 쪽 레이업 10개 중 성공"]].map(([k,n,h])=>`<div class="q"><div><b>${n}</b><span>${h}</span></div><input type="number" inputmode="decimal" min="0" step="${k==="cone"?"0.1":"1"}" id="t-${k}" aria-label="${n}" required></div>`).join("")}
        <div style="padding-top:10px"><b style="font-size:14px">고개 들고 실전 속도로 할 수 있는 기술</b><div class="checks" style="margin-top:8px">${["크로스오버","비트윈 더 레그","비하인드 백","인앤아웃","헤지테이션","스핀 무브"].map(m=>`<label class="checkrow"><input type="checkbox" data-move="${m}"> <span>${m}</span></label>`).join("")}</div></div>
        <button class="btn primary block" type="submit" style="margin-top:12px">결과 보기</button>
      </form><div id="testRes"></div>`, el=>{
      $("testForm").addEventListener("submit", e=>{
        e.preventDefault();
        const g = k => Math.max(0, parseFloat($("t-"+k).value)||0);
        const raw = {rp:g("rp"), lp:g("lp"), cross:g("cross"), cone:g("cone"), weak:clamp(g("weak"),0,10), moves:[...el.querySelectorAll("[data-move]")].filter(x=>x.checked).map(x=>x.dataset.move)};
        const r = scoreDribble(raw); finishTest("dribble", raw, r);
      });
    });
  }
}
function finishTest(type, raw, r){
  const prev = S.tests.filter(t=>t.type===type).slice(-1)[0];
  S.tests.push({date:TODAY_S, type, raw, score:r.score, level:r.level, at:Date.now()});
  save();
  const names = type==="shoot" ? {form:"골밑",ft:"자유투",mid:"미드",three:"3점"} : {pound:"파운드",cross:"크로스",cone:"콘",weak:"약손",moves:"기술"};
  const weakest = Object.entries(r.parts).sort((a,b)=>a[1]-b[1])[0];
  const tipDrill = type==="shoot" ? {form:"s_form",ft:"s_ft",mid:"s_mid",three:"s_3pt"}[weakest[0]] : {pound:"h_pound",cross:"h_basic",cone:"h_cone",weak:"f_layup",moves:"h_combo"}[weakest[0]];
  $("testRes").innerHTML = `<div class="panel" style="margin-top:12px">
    <div class="eyebrow">결과 · +30 XP</div>
    <div class="row" style="align-items:baseline"><span class="num" style="font-size:40px;font-weight:600">${r.score}</span><span class="muted">/100</span><span class="chip lv" style="font-size:14px">${LEVELS[r.level]}</span>${prev?`<span class="chip ${r.score>=prev.score?"done":"part"}">지난번 대비 ${r.score>=prev.score?"+":""}${r.score-prev.score}</span>`:""}</div>
    ${Object.entries(r.parts).map(([k,v])=>`<div class="row small"><span style="width:56px">${names[k]}</span><div class="bar"><span style="width:${Math.round(v)}%"></span></div><span class="num" style="width:36px;text-align:right">${Math.round(v)}</span></div>`).join("")}
    <p class="why">가장 약한 항목은 <b>${names[weakest[0]]}</b>이에요. 추천 훈련: <button class="btn sm" data-act="drill-info-close" data-d="${tipDrill}">${esc(drill(tipDrill)?.name||"")}</button></p>
    ${r.level!==S.plan.level?`<button class="btn primary block" data-act="apply-rec" data-l="${r.level}">${LEVELS[r.level]} 플랜으로 바꾸기</button>`:`<p class="small muted">지금 플랜(${LEVELS[S.plan.level]})과 같은 레벨이에요.</p>`}
  </div>`;
  $("testForm").hidden = true;
  if(tab==="growth") renderGrowth(); renderHeader(); checkCelebrate();
}

/* ============================================================
   탭 4: AI 코치 (영상 분석)
   ============================================================ */
const coach = {kind:"shot", url:null, frames:[], busy:false, result:null, checks:new Set(), error:""};
function renderCoach(){
  const v = $("v-coach");
  const K = ANALYSIS_KINDS[coach.kind];
  const hasKey = !!S.settings.apiKey;
  v.innerHTML = `<div class="view">
    <div><div class="eyebrow">AI 코치 · 영상 분석</div><h1>오늘 훈련, 찍어서 점검해요</h1><p class="why">영상을 찍고 중요한 장면을 캡처하면 ${hasKey?"AI가 문제점과 고칠 방법, 맞는 훈련을 알려줘요.":"체크리스트로 스스로 문제를 찾고 맞는 훈련을 추천받아요. 설정에서 API 키를 넣으면 AI 분석이 켜져요."}</p></div>
    <div class="panel"><h2>1. 무엇을 분석할까요?</h2>
      <div class="kinds">${Object.entries(ANALYSIS_KINDS).map(([k,x])=>`<button class="${coach.kind===k?"on":""}" data-act="kind" data-k="${k}">${esc(x.name)}<small>${esc(x.tip.split(",")[0])}</small></button>`).join("")}</div>
      <p class="small muted">촬영 팁: ${esc(K.tip)}</p></div>
    <div class="panel"><h2>2. 영상 찍기 · 고르기</h2>
      <div class="row"><label class="btn primary filebtn grow">영상 찍기<input type="file" accept="video/*" capture="environment" data-act="video-file" aria-label="영상 찍기"></label><label class="btn filebtn grow">앨범에서 고르기<input type="file" accept="video/*" data-act="video-file" aria-label="앨범에서 영상 고르기"></label></div>
      ${coach.url?`<div class="vidwrap"><video id="vid" src="${coach.url}" playsinline controls muted preload="auto"></video></div>
      <div class="row"><span class="small muted">속도</span>${[0.25,0.5,1].map(r=>`<button class="btn sm" data-act="rate" data-r="${r}">${r}×</button>`).join("")}<button class="btn sm" data-act="frame-step" data-n="-1" aria-label="한 프레임 뒤로">◀︎</button><button class="btn sm" data-act="frame-step" data-n="1" aria-label="한 프레임 앞으로">▶︎</button></div>
      <div class="row"><button class="btn dark grow" data-act="capture">이 장면 캡처 (${coach.frames.length}/8)</button><button class="btn grow" data-act="auto-capture">자동 6장 캡처</button></div>`:`<p class="small muted">영상은 이 폰 밖으로 저장되지 않아요. 캡처한 장면만 분석에 쓰여요.</p>`}
      ${coach.frames.length?`<div class="frames">${coach.frames.map((f,k)=>`<div class="frame"><img src="${f.url}" alt="${k+1}번째 캡처"><em>${f.t.toFixed(1)}s</em><button data-act="del-frame" data-k="${k}" aria-label="캡처 지우기">✕</button></div>`).join("")}</div>`:""}
    </div>
    <div class="panel"><h2>3. 분석</h2>
      ${hasKey?`<button class="btn primary block" data-act="analyze" ${coach.frames.length&&!coach.busy?"":"disabled"}>${coach.busy?`<span class="spinner"></span> AI가 보는 중…`:`AI로 분석하기 (${coach.frames.length}장)`}</button>`:`<button class="btn dark block" data-act="open-settings">AI 분석 켜기 (API 키 설정)</button>`}
      <details ${hasKey?"":"open"}><summary class="small" style="cursor:pointer;font-weight:600">셀프 체크로 분석하기</summary>
        <p class="small muted" style="margin:8px 0">캡처한 장면을 보며 해당하는 것을 고르세요.</p>
        <div class="checks">${K.checks.map((c,k)=>`<button class="checkrow${coach.checks.has(k)?" on":""}" data-act="chk" data-k="${k}"><span class="bx">${coach.checks.has(k)?CHECK_SVG:""}</span><span>${esc(c.t)}</span></button>`).join("")}</div>
        <button class="btn block" style="margin-top:8px" data-act="self-analyze" ${coach.checks.size?"":"disabled"}>체크 결과 보기</button>
      </details>
      ${coach.error?`<div class="callout warn">${esc(coach.error)}</div>`:""}
      ${coach.result?resultHTML(coach.result):""}
    </div>
    ${S.analyses.length?`<div class="panel"><h2>분석 기록</h2>${[...S.analyses].reverse().slice(0,10).map((a,k)=>`<button class="libitem" data-act="show-analysis" data-i="${S.analyses.length-1-k}"><div style="min-width:0"><b>${esc(ANALYSIS_KINDS[a.kind]?.name||a.kind)}${a.score!=null?` · ${a.score}점`:""}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.date} · ${a.source==="ai"?"AI":"셀프 체크"} · ${esc(a.summary||"")}</div></div>${a.thumb?`<img src="${a.thumb}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px">`:""}</button>`).join("")}</div>`:""}
  </div>`;
}
function resultHTML(r){
  const sevColor = {high:"var(--bad)",mid:"var(--warn)",low:"var(--court)"};
  const sevName = {high:"꼭 고치기",mid:"고치면 좋음",low:"참고"};
  return `<div class="result">
    <div class="row" style="align-items:baseline">${r.score!=null?`<span class="num" style="font-size:32px;font-weight:600">${r.score}</span><span class="muted">/100</span>`:""}<span class="chip ${r.source==="ai"?"lv":""}">${r.source==="ai"?"AI 분석":"셀프 체크"}</span></div>
    ${r.summary?`<p style="margin:0">${esc(r.summary)}</p>`:""}
    ${(r.strengths||[]).length?`<div class="callout" style="border-color:var(--good)"><b>잘하고 있는 점</b><br>${r.strengths.map(esc).join("<br>")}</div>`:""}
    ${(r.issues||[]).map(is=>`<div class="issue"><span class="sev" style="color:${sevColor[is.severity]||"var(--warn)"}">${sevName[is.severity]||"고치면 좋음"}</span><b>${esc(is.title)}</b>${is.evidence?`<span class="small muted">${esc(is.evidence)}</span>`:""}<span class="small">${esc(is.fix||"")}</span>${is.drill && drill(is.drill)?`<div class="row"><button class="btn sm" data-act="drill-info" data-d="${is.drill}">추천: ${esc(drill(is.drill).name)}</button><button class="btn sm ghost" data-act="add-to-session-pick" data-d="${is.drill}">플랜에 추가</button></div>`:""}</div>`).join("")}
    ${r.next?`<div class="callout"><b>다음 촬영 때 볼 것</b><br>${esc(r.next)}</div>`:""}
  </div>`;
}
async function grabFrame(video){
  const w = 480, h = Math.round(video.videoHeight/video.videoWidth*w) || 640;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(video,0,0,w,h);
  return {url:c.toDataURL("image/jpeg",0.72), t:video.currentTime};
}
function seekTo(video,t){ return new Promise(res=>{ const on = ()=>{ video.removeEventListener("seeked",on); setTimeout(res,60); }; video.addEventListener("seeked",on); video.currentTime = t; }); }
async function autoCapture(){
  const v = $("vid"); if(!v || !v.duration || !isFinite(v.duration)){ toast("영상을 불러오는 중이에요. 잠시 후 다시 눌러 주세요."); return; }
  v.pause(); coach.frames = [];
  const n = 6; for(let k=0;k<n;k++){ await seekTo(v, v.duration*(k+0.5)/n); coach.frames.push(await grabFrame(v)); }
  renderCoach();
}
async function analyzeAI(){
  if(!coach.frames.length) return;
  coach.busy = true; coach.error = ""; coach.result = null; renderCoach();
  const K = ANALYSIS_KINDS[coach.kind];
  const drillIds = allDrills().map(d=>`${d.id}: ${d.name} (${CATS[d.cat]?.name})`).join("\n");
  const prompt = `당신은 친절하지만 정확한 농구 스킬 트레이너입니다. 아래 ${coach.frames.length}장의 사진은 사용자가 '${K.name}' 연습을 찍은 영상에서 시간 순서대로 캡처한 장면입니다(각 장면의 초 표시: ${coach.frames.map((f,k)=>`${k+1}번=${f.t.toFixed(1)}s`).join(", ")}).
사용자 레벨: ${LEVELS[S.plan.level]}.
점검 기준 예시: ${K.checks.map(c=>c.t).join(" / ")}.
사진에서 실제로 보이는 것만 근거로 판단하고, 보이지 않으면 추측하지 말고 그렇다고 말하세요.
반드시 아래 JSON 하나만 출력하세요(설명 문장 금지):
{"score": 0~100 정수(자세 완성도), "summary": "한두 문장 총평", "strengths": ["잘하는 점"], "issues": [{"title":"문제", "severity":"high|mid|low", "evidence":"몇 번 장면에서 무엇이 보이는지", "fix":"구체적인 교정 방법", "drill":"아래 목록의 훈련 id 중 하나"}], "next":"다음 촬영 때 확인할 점"}
issues는 중요한 순서로 최대 4개. 훈련 id 목록:
${drillIds}`;
  const content = coach.frames.map(f=>({type:"image", source:{type:"base64", media_type:"image/jpeg", data:f.url.split(",")[1]}}));
  content.push({type:"text", text:prompt});
  try{
    const res = await fetch("https://api.anthropic.com/v1/messages", {method:"POST", headers:{"content-type":"application/json","x-api-key":S.settings.apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:S.settings.model||"claude-sonnet-5-5", max_tokens:1800, messages:[{role:"user", content}]})});
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      const msg = data?.error?.message || "";
      if(res.status===401) throw new Error("API 키가 맞지 않아요. 설정에서 키를 다시 확인해 주세요.");
      if(res.status===404 || /model/i.test(msg)) throw new Error(`모델 이름(${S.settings.model})을 찾을 수 없어요. 설정에서 모델 이름을 확인해 주세요.`);
      if(res.status===429) throw new Error("요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.");
      if(res.status===400 && /credit|billing/i.test(msg)) throw new Error("API 크레딧이 부족해요. console.anthropic.com에서 결제 정보를 확인해 주세요.");
      throw new Error("분석 요청이 실패했어요: " + (msg || res.status));
    }
    const text = (data.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("");
    const m = text.match(/\{[\s\S]*\}/); if(!m) throw new Error("AI 답을 읽지 못했어요. 다시 시도해 주세요.");
    const r = JSON.parse(m[0]);
    r.source = "ai"; r.score = Number.isFinite(+r.score) ? Math.round(+r.score) : null;
    r.issues = (r.issues||[]).slice(0,4).map(i=>({...i, drill: drill(i.drill) ? i.drill : null}));
    storeAnalysis(r);
  }catch(e){
    coach.error = e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : "인터넷 연결을 확인해 주세요. AI 분석은 온라인에서만 돼요.";
  }
  coach.busy = false; renderCoach();
}
function selfAnalyze(){
  const K = ANALYSIS_KINDS[coach.kind];
  const picked = [...coach.checks].map(k=>K.checks[k]);
  const r = {source:"self", score: Math.round(100 - picked.length/K.checks.length*60), summary:`체크한 문제 ${picked.length}개. 가장 위의 것부터 하나씩 고쳐요.`,
    issues: picked.map((c,k)=>({title:c.t, severity:k===0?"high":"mid", fix:c.fix, drill:c.d})), next:"같은 각도로 다시 찍어 같은 항목이 사라졌는지 확인하세요."};
  storeAnalysis(r);
  renderCoach();
}
function storeAnalysis(r){
  coach.result = r;
  S.analyses.push({date:TODAY_S, kind:coach.kind, source:r.source, score:r.score, summary:r.summary, strengths:r.strengths||[], issues:r.issues, next:r.next, thumb: coach.frames[0] ? shrink(coach.frames[0].url) : null});
  if(S.analyses.length>40) S.analyses.shift();
  save(); renderHeader(); checkCelebrate();
}
function shrink(url){ return url; }
async function makeThumb(url){ return new Promise(res=>{ const im = new Image(); im.onload = ()=>{ const c = document.createElement("canvas"); c.width = 96; c.height = Math.round(im.height/im.width*96); c.getContext("2d").drawImage(im,0,0,c.width,c.height); res(c.toDataURL("image/jpeg",0.6)); }; im.onerror = ()=>res(null); im.src = url; }); }

/* ============================================================
   탭 5: 보상
   ============================================================ */
function renderRewards(){
  const v = $("v-rewards");
  const X = computeXP(), coins = X.xp - spentCoins();
  const ri = rankOf(X.xp), cur = RANKS[ri], nxt = RANKS[ri+1];
  const prog = nxt ? (X.xp-cur[0])/(nxt[0]-cur[0]) : 1;
  const badges = badgeList();
  v.innerHTML = `<div class="view">
    <div><div class="eyebrow">보상</div><h1>쌓은 만큼 보여요</h1></div>
    <div class="rank"><div class="medal">${ri+1}</div><div style="min-width:0"><span class="small muted">현재 등급</span><b>${cur[1]}</b><div class="bar" style="margin:8px 0 4px"><span style="width:${Math.round(prog*100)}%"></span></div><span class="small muted num">${X.xp.toLocaleString()} XP${nxt?` · ${nxt[1]}까지 ${(nxt[0]-X.xp).toLocaleString()} XP`:" · 최고 등급"}</span></div></div>
    <div class="stats"><div class="stat"><b>${coins.toLocaleString()}</b><span>쓸 수 있는 코인</span></div><div class="stat"><b>${perfectStreak()}</b><span>퍼펙트 위크 연속</span></div><div class="stat"><b>${badges.filter(b=>b.got).length}/${badges.length}</b><span>배지</span></div></div>
    <div class="panel"><div class="panel-h"><h2>나만의 보상</h2><span class="small muted">코인 = 모은 XP − 쓴 코인</span></div>
      ${S.rewards.map(r=>`<div class="rewardrow"><div style="min-width:0"><b>${esc(r.name)}</b><div class="small muted num">${r.cost.toLocaleString()} 코인</div></div><button class="btn sm ${coins>=r.cost?"primary":""}" data-act="redeem" data-id="${r.id}" ${coins>=r.cost?"":"disabled"}>${coins>=r.cost?"받기":`${(r.cost-coins).toLocaleString()} 남음`}</button><button class="btn sm ghost" data-act="del-reward" data-id="${r.id}" aria-label="보상 삭제">✕</button></div>`).join("") || `<p class="why">보상을 추가해 보세요.</p>`}
      <form id="rewardForm" class="row"><input type="text" id="rw-name" placeholder="보상 이름 (예: 치킨)" class="grow" style="flex:1 1 150px" maxlength="40" required aria-label="보상 이름"><input type="number" id="rw-cost" placeholder="코인" min="10" step="10" style="width:90px" required aria-label="필요 코인"><button class="btn" type="submit">추가</button></form>
      ${S.redeemed.length?`<details><summary class="small" style="cursor:pointer">받은 보상 ${S.redeemed.length}개</summary>${[...S.redeemed].reverse().map(r=>`<div class="small muted" style="padding:4px 0">${r.date} · ${esc(r.name)} (−${r.cost})</div>`).join("")}</details>`:""}
    </div>
    <div class="panel"><h2>배지</h2><div class="badges">${badges.map(b=>`<div class="badge${b.got?" got":""}"><div class="bi">${esc(b.g)}</div><b>${esc(b.n)}</b><span>${esc(b.d)}</span></div>`).join("")}</div></div>
    <div class="panel"><h2>XP 얻는 법</h2><ul class="xprules"><li>훈련 1분 = 1 XP</li><li>세션 전부 완료 +20</li><li>한 주 계획 전부 완료(퍼펙트 위크) +50</li><li>피드백 메모 +5</li><li>셀프 테스트 +30 · 영상 분석 +15</li></ul>
    <p class="small muted">등급: ${RANKS.map(r=>`${r[1]} ${r[0]}`).join(" · ")}</p></div>
  </div>`;
}
function checkCelebrate(){
  const X = computeXP(); const ri = rankOf(X.xp);
  const got = badgeList().filter(b=>b.got).map(b=>b.id);
  const newB = got.filter(id=>!S.seen.badges.includes(id));
  const rankUp = ri > (S.seen.rank||0);
  if(!S._celebInit){ S._celebInit = true; }
  if(!newB.length && !rankUp) return;
  S.seen.badges = got; S.seen.rank = ri; save();
  const bl = badgeList().filter(b=>newB.includes(b.id));
  const el = document.createElement("div"); el.className = "celebrate";
  el.innerHTML = `<canvas id="confetti"></canvas><div class="card"><div class="medal">${rankUp?ri+1:esc(bl[0]?.g||"★")}</div><div class="eyebrow">${rankUp?"등급 상승":"새 배지"}</div><h1>${rankUp?esc(RANKS[ri][1]):esc(bl.map(b=>b.n).join(", "))}</h1><p class="why">${rankUp?`${X.xp.toLocaleString()} XP 달성!`:esc(bl.map(b=>b.d).join(" · "))}</p><button class="btn primary" data-act="close-celebrate">좋아요</button></div>`;
  document.body.appendChild(el);
  confetti($("confetti"));
}
function confetti(c){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const cols = ["#FF7A2E","#F2C14E","#7FB2E5","#4CC27E","#C792EA"];
  const ps = Array.from({length:120},()=>({x:Math.random()*c.width, y:-20-Math.random()*c.height*0.5, vx:(Math.random()-.5)*3, vy:2+Math.random()*3, r:Math.random()*6.28, s:4+Math.random()*5, c:cols[Math.floor(Math.random()*cols.length)]}));
  let f = 0; (function loop(){ if(!c.isConnected || f++>240) return; ctx.clearRect(0,0,c.width,c.height); ps.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.r+=0.1; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.fillStyle=p.c; ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); ctx.restore(); }); requestAnimationFrame(loop); })();
}

/* ============================================================
   설정
   ============================================================ */
function openSettings(){
  openSheet("설정", `
    <div class="panel"><h2>AI 코치 (영상 분석)</h2>
      <p class="why">Anthropic API 키를 넣으면 캡처한 장면을 Claude가 분석해요. 키는 이 폰에만 저장되고, 분석할 때 Anthropic 서버로만 보내져요. 사용량만큼 요금이 나가요.</p>
      <p class="small muted">키 발급: console.anthropic.com → API Keys</p>
      <label class="f">API 키<input type="password" id="set-key" value="${esc(S.settings.apiKey)}" placeholder="sk-ant-..." autocomplete="off"></label>
      <label class="f">모델<input type="text" id="set-model" value="${esc(S.settings.model)}"></label>
      <div class="row"><button class="btn primary grow" data-set="save-key">저장</button>${S.settings.apiKey?`<button class="btn ghost" data-set="clear-key">키 지우기</button>`:""}</div>
    </div>
    <div class="panel"><h2>백업</h2>
      <p class="why">모든 기록은 이 폰 안에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 파일로 내보내 두세요.</p>
      <div class="row"><button class="btn grow" data-set="export">백업 파일 내보내기</button><label class="btn grow filebtn">백업 불러오기<input type="file" accept="application/json,.json" id="importFile"></label></div>
    </div>
    <div class="panel"><h2>출처</h2><p class="small muted">드릴과 영상: BALLKICKZ(youtube.com/@BALLKICKZofficial) — 필 핸디 시리즈, 더 워크아웃, 원 드리블 풀업, 플로터, 코너 3점 드릴 등. 주간 구조: The Hoop Sage “Most Hoopers Train Wrong Every Week”. 영상은 유튜브에서 재생되며 저작권은 각 채널에 있어요.</p></div>
    <div class="panel"><h2>초기화</h2><p class="why">모든 기록·플랜·보상을 지워요. 되돌릴 수 없어요.</p><button class="btn danger" data-set="reset">모든 데이터 지우기</button></div>
    <p class="small muted" id="set-msg" aria-live="polite"></p>`, el=>{
    el.addEventListener("click", e=>{
      const b = e.target.closest("[data-set]"); if(!b) return;
      const a = b.dataset.set;
      if(a==="save-key"){ S.settings.apiKey = $("set-key").value.trim(); S.settings.model = $("set-model").value.trim() || "claude-sonnet-5-5"; saveNow(); $("set-msg").textContent = "저장했어요."; if(tab==="coach") renderCoach(); }
      if(a==="clear-key"){ S.settings.apiKey = ""; saveNow(); closeSheet(); toast("API 키를 지웠어요."); if(tab==="coach") renderCoach(); }
      if(a==="export"){
        const blob = new Blob([JSON.stringify({app:"hoop2", exportedAt:new Date().toISOString(), state:{...S, settings:{...S.settings, apiKey:""}}},null,2)],{type:"application/json"});
        const u = URL.createObjectURL(blob); const ln = document.createElement("a"); ln.href = u; ln.download = `hoop2-backup-${TODAY_S}.json`; document.body.appendChild(ln); ln.click(); ln.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000);
        $("set-msg").textContent = "백업 파일을 저장했어요. (API 키는 백업에 넣지 않아요)";
      }
      if(a==="reset"){
        if(b.dataset.confirm){ const key = S.settings.apiKey; S = defaultState(); S.settings.apiKey = key; S.migratedV1 = true; S.plan = buildPlan("b",4); saveNow(); closeSheet(); toast("초기화했어요."); renderAll(); }
        else { b.dataset.confirm = "1"; b.textContent = "정말 지우기 (다시 누르기)"; }
      }
    });
    $("importFile").addEventListener("change", async e=>{
      const f = e.target.files[0]; if(!f) return;
      try{
        const data = JSON.parse(await f.text());
        if(data.app==="hoop2" && data.state){ const key = S.settings.apiKey; S = Object.assign(defaultState(), data.state); S.settings.apiKey = key; }
        else if(data.app==="hoop4x60" && data.records){ localStorage.setItem("hoop4x60.v1", JSON.stringify(data.records)); S.migratedV1 = false; saveNow(); location.reload(); return; }
        else throw 0;
        saveNow(); closeSheet(); toast("백업을 불러왔어요."); renderAll();
      }catch(err){ $("set-msg").textContent = "이 파일은 읽을 수 없어요. Hoop 앱에서 내보낸 .json 파일을 골라 주세요."; }
      e.target.value = "";
    });
  });
}

/* ============================================================
   렌더 / 이벤트
   ============================================================ */
function renderAll(){
  renderHeader();
  ["today","plan","growth","coach","rewards"].forEach(t=>$("v-"+t).hidden = t!==tab);
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
  ({today:renderToday, plan:renderPlan, growth:renderGrowth, coach:renderCoach, rewards:renderRewards})[tab]();
}
function goTab(t){ tab = t; window.scrollTo(0,0); renderAll(); try{ history.replaceState(null,"","#"+t); }catch(e){} }

document.addEventListener("click", async e=>{
  const b = e.target.closest("[data-act]"); if(!b) return;
  const a = b.dataset.act, d = b.dataset;
  switch(a){
    case "close-sheet": closeSheet(); break;
    case "close-celebrate": b.closest(".celebrate").remove(); break;
    case "goto": closeSheet(); goTab(d.tab); break;
    case "open-setup": openSetup(); break;
    case "open-settings": openSettings(); break;
    case "dismiss-welcome": S.onboarded = true; save(); renderToday(); break;
    case "sel-day": sel = d.date; renderToday(); break;
    case "week": weekMon = addDays(weekMon, 7*(+d.n)); sel = ymd(weekMon); if(ymd(mondayOf(TODAY))===ymd(weekMon)) sel = TODAY_S; renderToday(); break;
    case "toggle-drill": {
      const L = logFor(sel,true); const it = L.items[d.d] = L.items[d.d]||{}; it.done = !it.done; if(it.done){ L.skipped = false; const s = sessionFor(sel); const x = s?.items.find(i=>i.d===d.d); if(x) L.mins[d.d] = x.min; }
      touchLog(); afterLogChange();
      const st = dayStats(sel); if(st.status==="done" && it.done) toast(`세션 완료! +${st.mins+20} XP`); break; }
    case "scale": { const L = logFor(sel,true); const k = d.scale; L[k] = String(L[k])===d.v ? null : +d.v; b.parentElement.querySelectorAll("button").forEach(x=>{ const on = String(L[k])===x.dataset.v; x.classList.toggle("on",on); x.setAttribute("aria-checked",on); }); touchLog(); break; }
    case "all-done": { const s = sessionFor(sel); if(!s) break; const L = logFor(sel,true); s.items.filter(i=>i.on).forEach(i=>{ L.items[i.d] = Object.assign(L.items[i.d]||{}, {done:true}); L.mins[i.d] = i.min; }); L.skipped = false; touchLog(); afterLogChange(); toast(`세션 완료! +${dayStats(sel).mins+20} XP`); break; }
    case "skip": { const L = logFor(sel,true); L.skipped = !L.skipped; if(L.skipped) Object.values(L.items).forEach(it=>it.done=false); touchLog(); afterLogChange(); break; }
    case "timer": startTimer(d.d, +d.min); break;
    case "timer-stop": stopTimer(); break;
    case "timer-pause": if(timer){ if(timer.paused!=null){ timer.end = Date.now()+timer.paused; timer.paused = null; } else timer.paused = Math.max(0,timer.end-Date.now()); tick(); } break;
    case "drill-info": drillInfo(d.d); break;
    case "drill-info-close": drillInfo(d.d); break;
    case "play-yt": { const box = $("ytbox"); box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${d.v}?autoplay=1&playsinline=1&rel=0" title="훈련 영상" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; break; }
    case "edit-drill": editDrill(d.d); break;
    case "new-drill": editDrill(null); break;
    case "add-to-session-pick": addToSessionPick(d.d); break;
    case "edit-session": tab = "plan"; planSub = "plan"; renderAll(); setTimeout(()=>$("sess-"+d.sid)?.scrollIntoView({behavior:"smooth",block:"start"}),50); break;
    case "plan-sub": planSub = d.s; renderPlan(); break;
    case "lib-cat": libCat = d.c; renderPlan(); break;
    case "add-item": pickDrillFor(d.sid); break;
    case "item-on": { const s = findSess(d.sid); const it = s.items[+d.k]; it.on = !it.on; save(); rerenderPlan(); break; }
    case "item-min": { const s = findSess(d.sid); const it = s.items[+d.k]; it.min = clamp(it.min + (+d.n), 5, 120); save(); rerenderPlan(); break; }
    case "item-move": { const s = findSess(d.sid); const k = +d.k, j = k + (+d.n); if(j<0||j>=s.items.length) break; [s.items[k], s.items[j]] = [s.items[j], s.items[k]]; save(); rerenderPlan(); break; }
    case "item-del": { const s = findSess(d.sid); const it = s.items.splice(+d.k,1)[0]; save(); rerenderPlan(); toast(`‘${drill(it.d)?.name||"훈련"}’을 뺐어요.`); break; }
    case "sess-rename": {
      const s = findSess(d.sid);
      openSheet("세션 편집", `<form id="sessForm" style="display:flex;flex-direction:column;gap:12px"><label class="f">세션 이름<input type="text" id="sf-title" maxlength="30" value="${esc(s.title)}" required></label><label class="f">설명<textarea id="sf-why" rows="3">${esc(s.why||"")}</textarea></label><button class="btn primary" type="submit">저장</button></form>`, ()=>{
        $("sessForm").addEventListener("submit", ev=>{ ev.preventDefault(); s.title = $("sf-title").value.trim()||s.title; s.why = $("sf-why").value.trim(); save(); closeSheet(); rerenderPlan(); });
      }); break; }
    case "sess-del": {
      if(!b.dataset.confirm){ b.dataset.confirm = "1"; b.textContent = "정말 삭제(다시 누르기)"; b.classList.add("danger"); break; }
      S.plan.sessions = S.plan.sessions.filter(s=>s.id!==d.sid); S.plan.days = S.plan.sessions.length; save(); rerenderPlan(); toast("세션을 지웠어요."); break; }
    case "add-session": {
      const free = [1,2,3,4,5,6,0].find(x=>!S.plan.sessions.some(s=>s.dow===x));
      if(free==null){ toast("모든 요일에 세션이 있어요."); break; }
      S.plan.sessions.push({id:uid("s"), type:"X", title:"새 세션", why:"직접 만든 세션이에요.", dow:free, items:[]}); S.plan.days = S.plan.sessions.length; save(); rerenderPlan(); toast(`${DOW[free]}요일에 새 세션을 만들었어요.`); break; }
    case "apply-rec": { closeSheet(); S.plan = buildPlan(d.l, S.plan.days); S.level = d.l; S.onboarded = true; save(); toast(`${LEVELS[d.l]} 플랜으로 바꿨어요.`); renderAll(); break; }
    case "test": openTest(d.t); break;
    case "del-test": S.tests.splice(+d.i,1); save(); renderGrowth(); renderHeader(); break;
    case "range": growthRange = +d.n; renderGrowth(); break;
    case "kind": coach.kind = d.k; coach.checks = new Set(); coach.result = null; renderCoach(); break;
    case "rate": { const v = $("vid"); if(v){ v.playbackRate = +d.r; v.play().catch(()=>{}); } break; }
    case "frame-step": { const v = $("vid"); if(v){ v.pause(); v.currentTime = clamp(v.currentTime + (+d.n)/30, 0, v.duration||0); } break; }
    case "capture": { const v = $("vid"); if(!v || !v.videoWidth){ toast("영상이 아직 준비되지 않았어요."); break; } if(coach.frames.length>=8){ toast("최대 8장까지 캡처할 수 있어요."); break; } v.pause(); coach.frames.push(await grabFrame(v)); const t = v.currentTime; renderCoach(); const nv = $("vid"); if(nv) nv.addEventListener("loadeddata", ()=>{ nv.currentTime = t; }, {once:true}); break; }
    case "auto-capture": autoCapture(); break;
    case "del-frame": coach.frames.splice(+d.k,1); renderCoach(); break;
    case "chk": { const k = +d.k; coach.checks.has(k) ? coach.checks.delete(k) : coach.checks.add(k); renderCoach(); break; }
    case "analyze": analyzeAI(); break;
    case "self-analyze": selfAnalyze(); break;
    case "show-analysis": { const r = S.analyses[+d.i]; openSheet(`${ANALYSIS_KINDS[r.kind]?.name||""} 분석 · ${r.date}`, (r.thumb?`<img src="${r.thumb}" alt="" style="border-radius:12px;max-height:240px;object-fit:contain">`:"") + resultHTML(r)); break; }
    case "redeem": {
      const r = S.rewards.find(x=>x.id===d.id); const coins = computeXP().xp - spentCoins();
      if(r && coins>=r.cost){ S.redeemed.push({id:r.id, name:r.name, cost:r.cost, date:TODAY_S}); save(); renderRewards(); toast(`🎉 ‘${r.name}’ 받기! 스스로에게 선물하세요.`); }
      break; }
    case "del-reward": S.rewards = S.rewards.filter(x=>x.id!==d.id); save(); renderRewards(); break;
  }
});
document.addEventListener("input", e=>{
  const t = e.target;
  if(t.id==="memo"){ logFor(sel,true).memo = t.value.slice(0,1000); touchLog(); return; }
  if(t.id==="libQ"){ libQ = t.value; const pos = t.selectionStart; renderPlan(); const i = $("libQ"); i.focus(); i.setSelectionRange(pos,pos); return; }
  if(t.dataset.log){
    const L = logFor(sel,true); const it = L.items[t.dataset.log] = L.items[t.dataset.log]||{};
    const k = t.dataset.k; const n = k==="t" ? parseFloat(t.value) : parseInt(t.value,10);
    it[k] = isNaN(n) ? null : Math.max(0,n);
    if(k==="m"||k==="a"){ $("pct-"+t.dataset.log).textContent = it.a>0 ? Math.round(Math.min(it.m||0,it.a)/it.a*100)+"%" : "–"; }
    touchLog();
  }
});
document.addEventListener("change", e=>{
  const t = e.target;
  if(t.dataset.act==="sess-dow"){
    const s = findSess(t.dataset.sid); const nd = +t.value;
    const other = S.plan.sessions.find(x=>x.dow===nd && x.id!==s.id);
    if(other) other.dow = s.dow; // 요일 맞바꾸기
    s.dow = nd; save(); rerenderPlan(); toast(other?`${DOW[nd]}요일 세션과 맞바꿨어요.`:`${DOW[nd]}요일로 옮겼어요.`);
  }
  if(t.dataset.act==="video-file"){
    const f = t.files[0]; if(!f) return;
    if(coach.url) URL.revokeObjectURL(coach.url);
    coach.url = URL.createObjectURL(f); coach.frames = []; coach.result = null; coach.error = "";
    renderCoach();
  }
  if(t.id==="memo"){ renderHeader(); checkCelebrate(); }
});
document.addEventListener("submit", e=>{
  if(e.target.id==="rewardForm"){
    e.preventDefault();
    const name = $("rw-name").value.trim(), cost = parseInt($("rw-cost").value,10);
    if(!name || !(cost>0)) return;
    S.rewards.push({id:uid("r"), name, cost}); save(); renderRewards();
  }
});
document.querySelector("nav.tabs").addEventListener("click", e=>{ const b = e.target.closest("[data-tab]"); if(b) goTab(b.dataset.tab); });
$("lvPill").addEventListener("click", openSetup);
$("xpPill").addEventListener("click", ()=>goTab("rewards"));
$("setBtn").addEventListener("click", openSettings);
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeSheet(); });

/* 저장된 썸네일 크기 줄이기 */
storeAnalysis = (orig => function(r){ orig(r); const last = S.analyses[S.analyses.length-1]; if(last && last.thumb) makeThumb(last.thumb).then(t=>{ last.thumb = t; save(); }); })(storeAnalysis);

/* 시작 */
const h = (location.hash||"").slice(1);
if(["today","plan","growth","coach","rewards"].includes(h)) tab = h;
S.seen.rank = Math.max(S.seen.rank||0, 0);
if(!S.seen.badges.length && !S._init){ S.seen.badges = badgeList().filter(b=>b.got).map(b=>b.id); S.seen.rank = rankOf(computeXP().xp); }
renderAll();
saveNow();

if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }
