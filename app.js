// 新しい受付スタッフ（GAS）のURL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBQemPSreyB3VoDLcNBYilt4VB-_7GSf5RmVfk-wVYWU-uQhR9wk8pjbXalCpH1QAy/exec';

// 状態管理
let coupons = [];
let couponLogs = [];
let editingCouponId = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDateStr = null;
let savingsPeriod = 'balance';
let currentUsingCoupon = null;

function formatDate(dateStr) {
  if (!dateStr) return '';
  if (typeof dateStr === 'string' && dateStr.length === 10) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchCoupons() {
  try {
    const res = await fetch(GAS_URL + '?action=getCoupons');
    const data = await res.json();
    coupons = data.map(c => {
      c.limit_date = formatDate(c.limit_date);
      c.amount = Number(c.amount) || 0;
      c.unit = Number(c.unit) || 500;
      c.is_point = (String(c.is_point).toLowerCase() === 'true');
      return c;
    });
  } catch (err) {
    console.error('通信エラー:', err);
  } finally {
    renderCalendar();
    renderList(selectedDateStr);
    renderSavingsCard();
  }
}

async function fetchLogs() {
  try {
    const res = await fetch(GAS_URL + '?action=getLogs');
    const data = await res.json();
    couponLogs = data.map(log => {
      log.used_date = formatDate(log.used_date);
      log.amount_used = Number(log.amount_used) || 0;
      return log;
    });
    renderSavingsCard();
  } catch (err) {
    console.error('通信エラー:', err);
  }
}

async function reloadData() {
  const btn = document.getElementById('reload-btn');
  if (btn) {
    btn.innerHTML = '⏳ 更新中...';
    btn.disabled = true;
  }
  await fetchCoupons();
  await fetchLogs();
  if (btn) {
    btn.innerHTML = '🔄 更新';
    btn.disabled = false;
  }
}

async function updateAmountInDB(id, newAmount) {
  const target = coupons.find(c => c.id == id);
  if (target) target.amount = newAmount;
  editingCouponId = null;
  renderList(selectedDateStr);
  renderSavingsCard();

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateAmount', id: id, amount: newAmount })
    });
  } catch (error) {
    console.error('更新エラー:', error);
  }
}

// ★追加：優待の削除機能
async function deleteCoupon(id) {
  if (!confirm('この優待を完全に削除しますか？\n（これまでの利用履歴は残ります）')) return;

  // 画面から先に消す
  coupons = coupons.filter(c => c.id != id);
  renderList(selectedDateStr);
  renderSavingsCard();

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteCoupon', id: id })
    });
  } catch (error) {
    console.error('削除エラー:', error);
    alert('削除に失敗しました');
  }
}

async function applyCouponUsage(coupon, amountUsed) {
  if (amountUsed <= 0 || amountUsed > coupon.amount) {
    alert('残高の範囲内で金額を入力してください');
    return;
  }
  const nextAmount = coupon.amount - amountUsed;
  const todayStr = formatDate(new Date());

  coupon.amount = nextAmount;
  couponLogs.unshift({
    coupon_id: coupon.id,
    coupon_name: coupon.name,
    icon: coupon.icon,
    amount_used: amountUsed,
    used_date: todayStr
  });
  renderList(selectedDateStr);
  renderSavingsCard();

  try {
    await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateAmount', id: coupon.id, amount: nextAmount }) });
    await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'insertLog', coupon_id: coupon.id, coupon_name: coupon.name, icon: coupon.icon, amount_used: amountUsed, used_date: todayStr }) });
  } catch (error) {
    console.error('履歴保存エラー:', error);
  }
}

async function saveNewCoupon() {
  const name = document.getElementById('m-name').value;
  const icon = document.getElementById('m-icon').value;
  const isPoint = document.getElementById('m-is-point').value === 'true';
  const amount = parseInt(document.getElementById('m-amount').value, 10);
  const unit = parseInt(document.getElementById('m-unit').value, 10) || 500;
  const limitDate = document.getElementById('m-limit-date').value;
  const holder = document.getElementById('m-holder').value;

  if (!name || isNaN(amount) || !limitDate) {
    alert('銘柄名、金額、期限は必須です');
    return;
  }
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'insertCoupon', name, icon, is_point: isPoint, amount, unit, limit_date: limitDate, holder })
    });
    closeModal();
    await fetchCoupons();
  } catch (error) {
    alert('保存エラー: 通信に失敗しました');
  }
}

function renderSavingsCard() {
  const now = new Date();
  const currentYearNum = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  let totalYear = 0, totalMonth = 0;

  couponLogs.forEach(log => {
    if (!log.used_date) return;
    const parts = String(log.used_date).split('-');
    if (parts.length < 2) return;
    const logYear = parseInt(parts[0], 10);
    const logMonth = parseInt(parts[1], 10);
    if (logYear === currentYearNum) {
      totalYear += log.amount_used;
      if (logMonth === currentMonthNum) totalMonth += log.amount_used;
    }
  });

  const totalBalance = coupons.reduce((sum, item) => sum + Number(item.amount), 0);
  const cardEl = document.querySelector('.savings-card');
  const titleEl = document.getElementById('savings-title');
  const amountEl = document.getElementById('savings-amount');
  const subEl = document.getElementById('savings-sub');

  if (!cardEl) return;
  cardEl.classList.remove('period-year', 'period-month', 'period-balance');

  if (savingsPeriod === 'year') {
    cardEl.classList.add('period-year');
    titleEl.textContent = '今年浮いた外食費（累計）';
    amountEl.textContent = `¥${totalYear.toLocaleString()}`;
    subEl.textContent = 'タップして利用履歴を見る 📖';
  } else if (savingsPeriod === 'month') {
    cardEl.classList.add('period-month');
    titleEl.textContent = '今月浮いた外食費（累計）';
    amountEl.textContent = `¥${totalMonth.toLocaleString()}`;
    subEl.textContent = 'タップして利用履歴を見る 📖';
  } else if (savingsPeriod === 'balance') {
    cardEl.classList.add('period-balance');
    titleEl.textContent = '未使用の優待総残高';
    amountEl.textContent = `¥${totalBalance.toLocaleString()}`;
    subEl.textContent = 'これから外食で使える金額です 🍽️';
  }
}

function toggleSavingsPeriod(e) {
  e.stopPropagation();
  if (savingsPeriod === 'year') savingsPeriod = 'month';
  else if (savingsPeriod === 'month') savingsPeriod = 'balance';
  else savingsPeriod = 'year';
  renderSavingsCard();
}

function handleSavingsCardClick(e) {
  if (savingsPeriod === 'balance') return;
  openHistoryModal();
}

function openHistoryModal() {
  const listEl = document.getElementById('history-list');
  listEl.innerHTML = '';
  if (couponLogs.length === 0) {
    listEl.innerHTML = '<div class="history-empty">まだ利用履歴がありません<br>優待を使うとここに記録されます 🍽️</div>';
  } else {
    couponLogs.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.innerHTML = `
        <div class="history-item-left">
          <span style="font-size:1.3rem;">${item.icon || '🍽️'}</span>
          <div>
            <strong>${item.coupon_name}</strong>
            <div class="history-date">${item.used_date}</div>
          </div>
        </div>
        <div class="history-amount">−¥${item.amount_used.toLocaleString()}</div>
      `;
      listEl.appendChild(row);
    });
  }
  document.getElementById('history-modal-overlay').classList.add('is-open');
}

function closeHistoryModal() { document.getElementById('history-modal-overlay').classList.remove('is-open'); }
function closeHistoryModalOnBackdrop(e) { if (e.target.id === 'history-modal-overlay') closeHistoryModal(); }

// ★修正：使うモーダルをタイプに合わせて動的に切り替える
function openUseModal(id) {
  const coupon = coupons.find(c => c.id == id);
  if (!coupon) return;
  currentUsingCoupon = coupon;

  document.getElementById('use-modal-title').textContent = `${coupon.icon} ${coupon.name} を使う`;
  document.getElementById('use-current-balance').textContent = `現在の残高: ¥${coupon.amount.toLocaleString()}`;
  
  const labelEl = document.getElementById('use-modal-label');
  const inputEl = document.getElementById('use-amount-input');

  // ポイントか紙券かで入力画面の文字を変える
  if (coupon.is_point) {
    labelEl.textContent = 'お会計で使った金額（円）';
    inputEl.placeholder = '例: 1420';
  } else {
    labelEl.textContent = `使った枚数（1枚 = ${coupon.unit}円）`;
    inputEl.placeholder = '例: 2';
  }

  inputEl.value = '';
  document.getElementById('use-modal-overlay').classList.add('is-open');

  setTimeout(() => { document.getElementById('use-amount-input').focus(); }, 200);
}

function closeUseModal() {
  document.getElementById('use-modal-overlay').classList.remove('is-open');
  currentUsingCoupon = null;
}
function closeUseModalOnBackdrop(e) {
  if (e.target.id === 'use-modal-overlay') closeUseModal();
}

// ★修正：入力された枚数（または金額）から最終金額を計算する
async function confirmUseAmount() {
  if (!currentUsingCoupon) return;
  const inputEl = document.getElementById('use-amount-input');
  const inputValue = parseInt(inputEl.value, 10);

  if (isNaN(inputValue) || inputValue <= 0) {
    alert('有効な数字を入力してください');
    return;
  }

  // 金額を計算（紙券なら 枚数×単価）
  let amountToUse = 0;
  if (currentUsingCoupon.is_point) {
    amountToUse = inputValue;
  } else {
    amountToUse = inputValue * currentUsingCoupon.unit;
  }

  if (amountToUse > currentUsingCoupon.amount) {
    alert(`残高（¥${currentUsingCoupon.amount.toLocaleString()}）を超える利用はできません`);
    return;
  }

  await applyCouponUsage(currentUsingCoupon, amountToUse);
  closeUseModal();
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const label = document.getElementById('month-label');
  label.textContent = `${currentYear}年 ${currentMonth + 1}月`;
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-cell empty';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const matching = coupons.filter(c => c.limit_date === dateStr && c.amount > 0);
    cell.innerHTML = `<span>${day}</span>`;

    if (matching.length > 0) {
      cell.classList.add('has-item');
      const dots = document.createElement('div');
      dots.className = 'item-dots';
      dots.innerHTML = matching.map(c => c.icon).join('');
      cell.appendChild(dots);
    }

    if (selectedDateStr === dateStr) cell.classList.add('is-selected');

    cell.onclick = () => {
      if (matching.length > 0) {
        selectedDateStr = dateStr;
        renderCalendar();
        renderList(dateStr);
      } else {
        resetFilter();
      }
    };
    grid.appendChild(cell);
  }
}

// ★修正：UIの描画処理（削除ボタンの追加と、使うボタンの共通化）
function renderList(filterDate = null) {
  const list = document.getElementById('yutai-list');
  const title = document.getElementById('list-title');
  const resetBtn = document.getElementById('reset-filter');
  list.innerHTML = '';

  let display = [...coupons];
  if (filterDate) {
    display = display.filter(c => c.limit_date === filterDate);
    title.textContent = `${filterDate} 期限 (${display.length}件)`;
    resetBtn.style.display = 'block';
  } else {
    title.textContent = '有効期限が近い順';
    resetBtn.style.display = 'none';
    display.sort((a, b) => new Date(a.limit_date) - new Date(b.limit_date));
  }

  const today = new Date();
  display.forEach(item => {
    const diffDays = Math.ceil((new Date(item.limit_date) - today) / (1000 * 60 * 60 * 24));
    let badgeClass = diffDays <= 7 ? 'expire-soon' : (diffDays <= 30 ? 'expire-warn' : 'expire-normal');
    let badgeText = diffDays < 0 ? '期限切れ' : `あと${diffDays}日`;

    const isEditing = (editingCouponId == item.id);
    const card = document.createElement('div');
    card.className = `yutai-card ${filterDate ? 'highlight' : ''}`;

    const subLabel = item.is_point ? `<small>(1円単位pt)</small>` : `<small>(${item.unit}円券 × ${Math.floor(item.amount / item.unit)}枚)</small>`;

    // ボタンの振り分け（残高0円なら削除ボタン、それ以外は通常）
    let actionButtonsHtml = '';
    if (item.amount === 0) {
      actionButtonsHtml = `
        <button class="use-btn" onclick="deleteCoupon(${item.id})" style="background: #fff5f5; color: #e53e3e; border-color: #feb2b2; width: 100%;">🗑️ 使い切ったので削除</button>
      `;
    } else {
      actionButtonsHtml = `
        <button class="use-btn primary" onclick="openUseModal(${item.id})">使う</button>
        <button class="use-btn" onclick="startEditing(${item.id})">残高上書き</button>
      `;
    }

    card.innerHTML = `
      <div class="card-top">
        <div class="brand-info">
          <span class="genre-icon">${item.icon}</span>
          <span class="brand-name">${item.name}</span>
        </div>
        <span class="wallet-badge badge-${item.holder}">${item.holder}</span>
      </div>
      <div class="card-mid">
        ${isEditing ? `
          <div class="edit-inline-form">
            ¥<input type="number" class="edit-input" id="input-${item.id}" value="${item.amount}" inputmode="numeric" />
            <button class="edit-save-btn" onclick="saveDirectBalance(${item.id})">保存</button>
            <button class="edit-save-btn" onclick="deleteCoupon(${item.id})" style="background: #e53e3e;">削除</button>
          </div>
        ` : `
          <div class="balance-wrapper" onclick="startEditing(${item.id})">
            <div class="balance-info">¥${item.amount.toLocaleString()}<span class="edit-hint">✎</span></div>
            ${subLabel}
          </div>
        `}
        <span class="expire-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="card-bottom">
        <span class="expire-date-text">期限: ${item.limit_date}</span>
        <div class="action-btns">
          ${actionButtonsHtml}
        </div>
      </div>
    `;
    list.appendChild(card);

    if (isEditing) {
      const inputEl = document.getElementById(`input-${item.id}`);
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveDirectBalance(item.id);
        });
      }
    }
  });
  renderSavingsCard();
}

function startEditing(id) {
  editingCouponId = id;
  renderList(selectedDateStr);
}

async function saveDirectBalance(id) {
  const inputEl = document.getElementById(`input-${id}`);
  if (!inputEl) return;
  const newAmount = parseInt(inputEl.value, 10);
  if (!isNaN(newAmount) && newAmount >= 0) await updateAmountInDB(id, newAmount);
}

function resetFilter() {
  selectedDateStr = null;
  renderCalendar();
  renderList();
}

function openModal() { document.getElementById('modal-overlay').classList.add('is-open'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('is-open'); }
function closeModalOnBackdrop(e) { if (e.target.id === 'modal-overlay') closeModal(); }

document.getElementById('prev-month').onclick = () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
};
document.getElementById('next-month').onclick = () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
};

fetchCoupons();
fetchLogs();
