/*
  === 名單資料 ===
  這裡是最常需要改的地方。

  格式範例：
  {
    label: '分組名稱',
    people: [
      { name:'主要顯示名稱', sub:'小字備註，可留空' }
    ]
  }
*/
const sections = [
  { label: '2F・行政區', people: [
    { name:'簡榆晏', sub:'Evan · #27' },
    { name:'黃湘庭', sub:'小庭 · #27' },
    { name:'潘子傑', sub:'小傑 · #27' },
    { name:'吳家豪', sub:'#32' },
    { name:'楊翔志', sub:'Bruce · #36' },
    { name:'魏華楹', sub:'#23' },
  ]},
  { label: '2F・業務區', people: [
    { name:'伍家薰', sub:'薰兒 · #28' },
    { name:'郭項',   sub:'#25' },
    { name:'林怡晴', sub:'晴晴 · #37' },
    { name:'蔡依純', sub:'#10' },
    { name:'徐宗裕', sub:'#28' },
    { name:'謝宇童', sub:'#37' },
    { name:'鄭至均', sub:'#10' },
  ]},
  { label: '2F・主管區', people: [
    { name:'Alan',   sub:'#22' },
    { name:'黃之芸', sub:'#18' },
  ]},
  { label: '1F', people: [
    { name:'蔡欣妮',  sub:'' },
    { name:'林玟瑤',  sub:'' },
    { name:'林巧蓉',  sub:'' },
    { name:'黃小惠',  sub:'Alice' },
    { name:'吳思妤',  sub:'' },
    { name:'廖苡争',  sub:'' },
    { name:'賴瓊如',  sub:'' },
  ]}
];

// states 只記錄「有被改過」的人。沒有出現在 states 裡的人，預設就是 none。
// 結構：{ '人名': 'done' }，可用的狀態是 'none' | 'done' | 'skip' | 'leave'。
const states = {};   // name -> state

// 每天的點單狀態保存在瀏覽器中；日期不同時視為新的一天並自動清除。
const STORAGE_KEY = 'beverage-order-manager.daily-state.v1';
const VALID_STATES = new Set(['done', 'skip', 'leave']);
let activeDateKey = getLocalDateKey();
let midnightTimer = null;
let resetConfirmTimer = null;

// 使用瀏覽器所在時區產生 YYYY-MM-DD，避免 UTC 日期造成午夜判斷錯誤。
function getLocalDateKey(date = new Date()){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadSavedStates(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;

    const saved = JSON.parse(raw);
    if(!saved || saved.date !== activeDateKey || typeof saved.states !== 'object'){
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const knownPeople = new Set(sections.flatMap(section => section.people.map(person => person.name)));
    Object.entries(saved.states).forEach(([name, state]) => {
      if(knownPeople.has(name) && VALID_STATES.has(state)) states[name] = state;
    });
  } catch(error) {
    console.warn('無法讀取已儲存的點單狀態：', error);
    try { localStorage.removeItem(STORAGE_KEY); } catch(_) {}
  }
}

function saveStates(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: activeDateKey,
      states
    }));
  } catch(error) {
    console.warn('無法儲存點單狀態：', error);
    setStatus('瀏覽器無法儲存目前狀態，重新整理後可能會消失。', 'error');
  }
}

function clearSavedStates(){
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch(error) {
    console.warn('無法清除已儲存的點單狀態：', error);
  }
}

function clearAllStates(){
  Object.keys(states).forEach(name => delete states[name]);
  clearSavedStates();
}

// 跨日後清除狀態；也供計時器、視窗聚焦與分頁切換時再次確認。
function checkDateBoundary(showMessage = false){
  const today = getLocalDateKey();
  if(today === activeDateKey) return false;

  activeDateKey = today;
  clearAllStates();
  cancelResetConfirmation();
  render();
  if(showMessage) setStatus('已進入新的一天，點單狀態已自動重置。', 'success');
  return true;
}

function scheduleMidnightReset(){
  if(midnightTimer) window.clearTimeout(midnightTimer);

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 50);
  midnightTimer = window.setTimeout(() => {
    checkDateBoundary(true);
    scheduleMidnightReset();
  }, nextMidnight.getTime() - now.getTime());
}

// 卡片右側的圖示字串：done 用勾勾，skip 用叉叉，leave 用「假」。
const icon = `<svg class="check-icon" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>`;
const skipIcon = `<svg class="skip-icon" viewBox="0 0 10 10"><line x1="2.2" y1="2.2" x2="7.8" y2="7.8"/><line x1="7.8" y1="2.2" x2="2.2" y2="7.8"/></svg>`;
const leaveIcon = `<span class="leave-icon">假</span>`;

function getState(name){ return states[name] || 'none'; }

// 算有效人數：休假與不點的人不列入「應該要點飲料」的人數。
function activePeople(){
  return sections.flatMap(s=>s.people).filter(p => getState(p.name) !== 'leave' && getState(p.name) !== 'skip');
}

/*
  render()
  重新產生畫面與統計資料。

  每次點擊卡片、重設狀態後都會呼叫它。
  它會做三件事：
  1. 把 sections 轉成卡片 HTML。
  2. 計算已點單人數、有效總人數、未點名單。
  3. 更新進度條與未點提示。
*/
function render(){
  document.getElementById('root').innerHTML = sections.map(sec=>{
    const cards = sec.people.map(p=>{
      const st = getState(p.name);
      const safe = p.name.replace(/'/g,"\\'");
      let cls = 'card';
      if(st === 'done')  cls += ' done';
      if(st === 'skip')  cls += ' skip';
      if(st === 'leave') cls += ' leave';
      return `<div class="${cls}" data-name="${p.name}" onclick="handleClick('${safe}')">
        <div class="card-text">
          <div class="name">${p.name}</div>
          <div class="sub">${p.sub || '&nbsp;'}</div>
        </div>
        <div class="check">${icon}${skipIcon}${leaveIcon}</div>
      </div>`;
    }).join('');
    return `<div class="section">
      <div class="section-title">${sec.label}</div>
      <div class="grid">${cards}</div>
    </div>`;
  }).join('');

  // 統計：只算 active（非 leave、非 skip）的人。
  const active = activePeople();
  const activeTotal = active.length;
  const doneCount = active.filter(p => getState(p.name) === 'done').length;
  const pending = active.filter(p => getState(p.name) === 'none').map(p=>p.name);

  document.getElementById('count').innerHTML =
    `${doneCount}<span id="count-sub"> / ${activeTotal} 人</span>`;
  document.getElementById('bar').style.width = activeTotal > 0 ? (doneCount/activeTotal*100)+'%' : '0%';

  const pEl = document.getElementById('pending');
  if(doneCount === 0 && pending.length === activeTotal){
    pEl.style.display = 'none'; pEl.className = 'pending';
  } else if(pending.length === 0){
    pEl.style.display = 'block'; pEl.className = 'pending all-done';
    pEl.innerHTML = '🎉 <b>全部都點了！</b>';
  } else {
    pEl.style.display = 'block'; pEl.className = 'pending';
    pEl.innerHTML = `<div class="pending-inner">
      <span><b>未點：</b>${pending.join('、')}</span>
      <button class="copy-btn" id="copy-btn" data-no-capture="true" onclick="copyPending()">複製</button>
    </div>`;
  }
  // copyPending() 會讀這份暫存名單，用來一鍵複製「未點」清單。
  window._pendingList = pending;
}

/* === 點擊狀態循環 ===
   點一次：未點 -> 已點單
   點兩次：已點單 -> 不點
   點三次：不點 -> 休假
   點四次：休假 -> 回到未點 */
const CYCLE = ['none', 'done', 'skip', 'leave'];

function handleClick(name){
  checkDateBoundary(true);
  const cur = getState(name);
  const idx = CYCLE.indexOf(cur);
  const next = CYCLE[(idx + 1) % CYCLE.length];
  if(next === 'none') delete states[name];
  else states[name] = next;
  saveStates();
  render();
}

function setResetConfirmation(confirming){
  const button = document.getElementById('reset-btn');
  if(!button) return;

  button.dataset.confirming = confirming ? 'true' : 'false';
  button.classList.toggle('confirming', confirming);
  button.querySelector('.reset-label').textContent = confirming ? '確定重置？' : '重置今日';
}

function cancelResetConfirmation(){
  if(resetConfirmTimer){
    window.clearTimeout(resetConfirmTimer);
    resetConfirmTimer = null;
  }
  setResetConfirmation(false);
}

// 第一次點擊進入確認狀態，再次點擊才清除今天的所有狀態。
function resetAll(){
  if(Object.keys(states).length === 0){
    cancelResetConfirmation();
    setStatus('目前沒有需要重置的點單狀態。');
    return;
  }

  const button = document.getElementById('reset-btn');
  if(button.dataset.confirming !== 'true'){
    setResetConfirmation(true);
    resetConfirmTimer = window.setTimeout(cancelResetConfirmation, 3500);
    return;
  }

  cancelResetConfirmation();
  clearAllStates();
  render();
  setStatus('今日點單狀態已重置。', 'success');
}

// 顯示上方提示訊息。type 可用 success / error，空字串代表一般訊息。
function setStatus(message, type){
  const el = document.getElementById('status');
  el.className = 'status-text';
  if(!message){ el.textContent = ''; return; }
  el.textContent = message;
  el.classList.add('show');
  if(type) el.classList.add(type);
}

// 複製目前未點名單。需要瀏覽器允許 clipboard API。
function copyPending(){
  const text = (window._pendingList||[]).join('、');
  navigator.clipboard.writeText(text).then(()=>{
    const btn = document.getElementById('copy-btn');
    if(!btn) return;
    btn.textContent = '已複製 ✓';
    btn.classList.add('copied');
    setTimeout(()=>{ btn.textContent='複製'; btn.classList.remove('copied'); }, 1800);
  });
}

/* === PNG 下載 ===
   這一段沒有直接把網頁截圖，而是用 canvas 重新畫一張圖片。
   好處是輸出的 PNG 尺寸、字體、排版比較穩定，也可以避開按鈕被截進去。 */

// canvas 沒有內建圓角矩形，所以用這個小工具函式畫圓角框。
function roundRect(ctx, x, y, width, height, radius){
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// 畫單行文字；如果文字為空就略過。
function drawTextLine(ctx, text, x, y, maxWidth){
  if(!text) return;
  ctx.fillText(text, x, y, maxWidth);
}

// 把過長的中文文字切成多行，主要用在 PNG 裡的「未點」名單。
function wrapLines(ctx, text, maxWidth){
  const lines = [];
  let current = '';
  for(const char of text){
    const next = current + char;
    if(ctx.measureText(next).width > maxWidth && current){
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if(current) lines.push(current);
  return lines;
}

/*
  renderPngCanvas()
  產生要下載的 PNG 畫布。

  注意：
  - ratio 會提高解析度，讓 PNG 在高 DPI 螢幕上也清楚。
  - windowWidth / contentPad / cardHeight 這些數字控制輸出圖尺寸與排版。
  - 畫面上的 HTML/CSS 和 PNG canvas 是兩套排版；如果改了卡片外觀，
    可能也要同步調整這裡的 canvas 畫法。
*/
function renderPngCanvas(){
  const ratio = Math.max(window.devicePixelRatio || 1, 2);
  const windowWidth = 720;
  const outerPad = 24;
  const contentPad = 22;
  const titlebarHeight = 50;
  const progressHeight = 52;
  const progressGap = 22;
  const sectionGap = 18;
  const titleGap = 9;
  const gridGap = 7;
  const cardHeight = 58;
  const minCardWidth = 108;
  const gridWidth = windowWidth - contentPad * 2;
  const columns = Math.max(1, Math.floor((gridWidth + gridGap) / (minCardWidth + gridGap)));
  const cardWidth = (gridWidth - gridGap * (columns - 1)) / columns;

  const active = activePeople();
  const activeTotal = active.length;
  const doneCount  = active.filter(p => getState(p.name) === 'done').length;
  const pendingList = active.filter(p => getState(p.name) === 'none').map(p=>p.name);

  let pendingHeight = 0;
  if(doneCount > 0 || pendingList.length < activeTotal){
    pendingHeight = pendingList.length === 0 ? 46 : 64;
  }

  // 圖例高度。canvas 需要先算總高度，才能建立正確大小的圖片。
  const legendHeight = 28;
  const legendGap    = 18;

  let sectionsHeight = 0;
  for(const sec of sections){
    const rows = Math.ceil(sec.people.length / columns);
    sectionsHeight += 21 + titleGap + rows * cardHeight + Math.max(0, rows - 1) * gridGap + sectionGap;
  }
  if(sectionsHeight > 0) sectionsHeight -= sectionGap;

  const contentHeight = legendHeight + legendGap + progressHeight + progressGap + pendingHeight + (pendingHeight ? 20 : 0) + sectionsHeight + 30;
  const windowHeight = titlebarHeight + contentHeight;
  const canvasWidth = windowWidth + outerPad * 2;
  const canvasHeight = windowHeight + outerPad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(canvasWidth * ratio);
  canvas.height = Math.ceil(canvasHeight * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.textBaseline = 'alphabetic';

  const bg = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  bg.addColorStop(0, '#E3E6EA');
  bg.addColorStop(1, '#D5D8DC');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.fillStyle = 'rgba(210,225,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(120, 130, 170, 95, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,210,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(canvasWidth - 140, canvasHeight - 130, 180, 100, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const winX = outerPad;
  const winY = outerPad;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(248,248,248,0.96)';
  roundRect(ctx, winX, winY, windowWidth, windowHeight, 16);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, winX, winY, windowWidth, windowHeight, 16);
  ctx.clip();

  // titlebar：畫出上方灰色標題列與三顆圓點。
  ctx.fillStyle = 'rgba(236,236,236,0.96)';
  ctx.fillRect(winX, winY, windowWidth, titlebarHeight);
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.moveTo(winX, winY + titlebarHeight + 0.5);
  ctx.lineTo(winX + windowWidth, winY + titlebarHeight + 0.5);
  ctx.stroke();

  const dots = ['#FF5F57', '#FEBC2E', '#28C840'];
  dots.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(winX + 26 + index * 20, winY + 25, 6.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#555';
  ctx.font = '500 13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('訂飲料清單', winX + windowWidth / 2, winY + 29);
  ctx.textAlign = 'left';

  let y = winY + titlebarHeight + contentPad;

  // 圖例：在 PNG 裡也畫出三種狀態顏色說明。
  const legendItems = [
    { color: '#34C759', label: '已點單' },
    { color: '#8E8E93', label: '不點' },
    { color: '#FF9F0A', label: '休假' },
  ];
  let lx = winX + contentPad;
  ctx.font = '11px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  legendItems.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx + 5, y + 9, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#888';
    ctx.fillText(item.label, lx + 13, y + 13);
    lx += 13 + ctx.measureText(item.label).width + 16;
  });
  y += legendHeight + legendGap;

  // 待點 / 全完成 banner：依照 pendingList 是否為空切換樣式。
  if(doneCount > 0 || pendingList.length < activeTotal){
    if(pendingList.length === 0){
      ctx.fillStyle = 'rgba(52,199,89,0.1)';
      ctx.strokeStyle = 'rgba(52,199,89,0.22)';
      roundRect(ctx, winX + contentPad, y, gridWidth, 46, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#23643a';
      ctx.font = '600 13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      ctx.fillText('🎉 全部都點了！', winX + contentPad + 14, y + 28);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      roundRect(ctx, winX + contentPad, y, gridWidth, 64, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#333';
      ctx.font = '500 13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      const pendingText = `未點：${pendingList.join('、')}`;
      const lines = wrapLines(ctx, pendingText, gridWidth - 28);
      lines.slice(0, 2).forEach((line, index) => {
        ctx.fillText(line, winX + contentPad + 14, y + 22 + index * 20);
      });
    }
    y += pendingHeight + 20;
  }

  // 進度：畫出已點單數字與綠色進度條。
  ctx.fillStyle = '#999';
  ctx.font = '12px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText('已點單', winX + contentPad, y + 11);
  ctx.fillStyle = '#111';
  ctx.font = '700 24px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText(String(doneCount), winX + contentPad, y + 40);
  ctx.fillStyle = '#AAA';
  ctx.font = '13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText(` / ${activeTotal} 人`, winX + contentPad + ctx.measureText(String(doneCount)).width + 4, y + 40);

  const trackY = y + 47;
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  roundRect(ctx, winX + contentPad, trackY, gridWidth, 5, 99);
  ctx.fill();
  if(activeTotal > 0){
    ctx.fillStyle = '#34C759';
    roundRect(ctx, winX + contentPad, trackY, gridWidth * (doneCount / activeTotal), 5, 99);
    ctx.fill();
  }
  y += progressHeight + progressGap;

  // 人員卡片：逐組、逐張卡片畫進 PNG。
  for(const sec of sections){
    ctx.fillStyle = '#BBB';
    ctx.font = '700 10px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText(sec.label, winX + contentPad, y + 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(winX + contentPad + ctx.measureText(sec.label).width + 14, y + 5);
    ctx.lineTo(winX + contentPad + gridWidth, y + 5);
    ctx.stroke();
    y += 21 + titleGap;

    sec.people.forEach((person, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = winX + contentPad + col * (cardWidth + gridGap);
      const cardY = y + row * (cardHeight + gridGap);
      const st = getState(person.name);

      // 卡片底色會依狀態改變，對應頁面上的 done / skip / leave 樣式。
      if(st === 'done')       ctx.fillStyle = 'rgba(52,199,89,0.1)';
      else if(st === 'skip')  ctx.fillStyle = 'rgba(120,120,128,0.2)';
      else if(st === 'leave') ctx.fillStyle = 'rgba(255,159,10,0.14)';
      else                    ctx.fillStyle = 'rgba(255,255,255,0.86)';

      if(st === 'done')       ctx.strokeStyle = 'rgba(52,199,89,0.24)';
      else if(st === 'skip')  ctx.strokeStyle = 'rgba(120,120,128,0.24)';
      else if(st === 'leave') ctx.strokeStyle = 'rgba(255,159,10,0.34)';
      else                    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      roundRect(ctx, x, cardY, cardWidth, cardHeight, 10);
      ctx.fill(); ctx.stroke();

      // 名字與小字備註。
      if(st === 'leave')     ctx.fillStyle = '#9a5d00';
      else if(st === 'done')  ctx.fillStyle = '#23643a';
      else if(st === 'skip')  ctx.fillStyle = '#888';
      else                   ctx.fillStyle = '#1A1A1A';
      ctx.font = '500 13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      drawTextLine(ctx, person.name, x + 12, cardY + 24, cardWidth - 40);

      if(st === 'skip'){
        const nameWidth = Math.min(ctx.measureText(person.name).width, cardWidth - 40);
        ctx.strokeStyle = '#9A9A9A';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 12, cardY + 18);
        ctx.lineTo(x + 12 + nameWidth, cardY + 18);
        ctx.stroke();
      }

      if(st === 'done')      ctx.fillStyle = '#5f9b70';
      else if(st === 'skip') ctx.fillStyle = '#AAA';
      else                   ctx.fillStyle = '#AAA';
      ctx.font = '11px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      drawTextLine(ctx, person.sub || ' ', x + 12, cardY + 41, cardWidth - 40);

      // 圓圈指示：已點是勾勾，不點是叉叉，休假是「假」，未點是空圈。
      const cx = x + cardWidth - 20;
      const cy = cardY + 29;
      ctx.lineWidth = 1.5;
      if(st === 'done'){
        ctx.fillStyle = '#34C759';
        ctx.strokeStyle = '#34C759';
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy); ctx.lineTo(cx - 1, cy + 3); ctx.lineTo(cx + 4.5, cy - 3.5);
        ctx.stroke();
      } else if(st === 'skip'){
        ctx.fillStyle = '#8E8E93';
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - 3.5, cy - 3.5); ctx.lineTo(cx + 3.5, cy + 3.5);
        ctx.moveTo(cx + 3.5, cy - 3.5); ctx.lineTo(cx - 3.5, cy + 3.5);
        ctx.stroke();
      } else if(st === 'leave'){
        ctx.fillStyle = '#FF9F0A';
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFF';
        ctx.font = '700 8px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('假', cx, cy + 3);
        ctx.textAlign = 'left';
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.lineWidth = 1;
    });

    const rows = Math.ceil(sec.people.length / columns);
    y += rows * cardHeight + Math.max(0, rows - 1) * gridGap + sectionGap;
  }

  ctx.restore();
  return canvas;
}

// 按下「下載 PNG」時執行：產生 canvas、轉成 data URL、建立下載連結。
async function downloadPng(){
  const button = document.getElementById('capture-btn');
  if(!button) return;
  button.disabled = true;
  setStatus('正在產生 PNG 截圖...', '');
  try {
    const canvas = renderPngCanvas();
    const dataUrl = canvas.toDataURL('image/png');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `訂飲料清單-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus('PNG 已下載！', 'success');
  } catch (error) {
    console.error(error);
    setStatus(`PNG 下載失敗：${error && error.message ? error.message : '未知錯誤'}`, 'error');
  } finally {
    button.disabled = false;
  }
}

// 初次載入時還原今天的狀態，並安排午夜自動重置。
loadSavedStates();
scheduleMidnightReset();
window.addEventListener('focus', () => checkDateBoundary(true));
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') checkDateBoundary(true);
});

// 同一網站開啟多個分頁時，同步其他分頁更新的狀態。
window.addEventListener('storage', event => {
  if(event.key !== STORAGE_KEY) return;
  Object.keys(states).forEach(name => delete states[name]);
  activeDateKey = getLocalDateKey();
  loadSavedStates();
  render();
});

render();
