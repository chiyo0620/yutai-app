const SUPABASE_URL = 'https://wfqgitxkhywzormlpite.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmcWdpdHhraHl3em9ybWxwaXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzODM2NTgsImV4cCI6MjEwNDk1OTY1OH0.Q-J6x26fZoIjiPOHfTABdJXVoVbG0tvOyFNU_DW1P_o';

let supabaseClient;
try {
  if (!window.supabase) {
    throw new Error("Supabaseの通信部品が読み込めませんでした。");
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  alert("初期設定エラー: " + e.message);
}

// 状態管理
let coupons = [];
let couponLogs = [];
let editingCouponId = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDateStr = null;
let savingsPeriod = 'year'; // 'year' または 'month'
let currentUsingCoupon = null; // ポイント利用対象の優待

// 優待一覧を取得
async function fetchCoupons() {
  if (!supabaseClient) {
    renderCalendar();
    renderList(selectedDateStr);
    return;
  }
  try {
    const { data, error } = await supabaseClient.from('coupons').select('*').order('limit_date', { ascending: true });
    if (error) {
      alert('優待データの取得エラー: ' + error.message);
      return;
    }
    coupons = data || [];
  } catch (err) {
    alert('通信エラー: ' + err.message);
  } finally {
    renderCalendar();
    renderList(selectedDateStr);
  }
}

// 利用履歴を取得
async function fetchLogs() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('coupon_logs').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('利用履歴の取得エラー:', error.message);
      return;
    }
    couponLogs = data || [];
    renderSavingsCard();
  } catch (err) {
    console.error('通信エラー:', err.message);
  }
}

// リアルタイム同期の設定
function setupRealtime() {
  if (!supabaseClient) return;
  supabaseClient.channel('public:coupons').on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, () => {
    fetchCoupons();
  }).subscribe();

  supabaseClient.channel('public:coupon_logs').on('postgres_changes', { event: '*', schema: 'public', table: 'coupon_logs' }, () => {
    fetchLogs();
  }).subscribe();
}

// 残高の直接更新（手動修正用）
async function updateAmountInDB(id, newAmount) {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from('coupons').update({ amount: newAmount }).eq('id', id);
  if (error) alert('更新に失敗しました: ' + error.message);
}

// 優待を利用して履歴に記録する（共通処理）
async function applyCouponUsage(coupon, amountUsed) {
  if (!supabaseClient) return;
  if (amountUsed <= 0 || amountUsed > coupon.amount) {
    alert('残高の範囲内で金額を入力してください');
    return;
  }

  const nextAmount = coupon.amount - amountUsed;
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. 残高を減らす
  const { error: err1 } = await supabaseClient.from('coupons').update({ amount: nextAmount }).eq('id', coupon.id);
  if (err1) {
    alert('残高更新エラー: ' + err1.message);
    return;
  }

  // 2. 利用履歴を保存する
  const { error: err2 } = await supabaseClient.from('coupon_logs').insert([{
    coupon_id: coupon.id,
    coupon_name: coupon.name,
    icon: coupon.icon,
    amount_used: amountUsed,
    used_date: todayStr
  }]);

  if (err2) {
    alert('履歴保存エラー: ' + err2.message);
  }

  fetchCoupons();
  fetchLogs();
}

// 紙券の「−¥500」ボタン処理
async function usePaperCoupon(id) {
  const target = coupons.find(c => c.id === id);
  if (target && target.amount >= target.unit) {
    await applyCouponUsage(target, target.unit);
  }
}

// 新規優待の保存
async function saveNewCoupon() {
  if (!supabaseClient) return;
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

  const { error } = await supabaseClient.from('coupons').insert([{ name, icon, is_point: isPoint, amount, unit, limit_date: limitDate, holder }]);
  if (error) {
    alert('保存エラー: ' + error.message);
  } else {
    closeModal();
    fetchCoupons();
  }
}

// ★浮いた外食費の集計と表示
function renderSavingsCard() {
  const now = new Date();
  const currentYearNum = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;

  let total = 0;
  couponLogs.forEach(log => {
    if (!log.used_date) return;
    const parts = log.used_date.split('-');
    const logYear = parseInt(parts[0], 10);
    const logMonth = parseInt(parts[1], 10);

    if (savingsPeriod === 'year') {
      if (logYear === currentYearNum) total += log.amount_used;
    } else {
      if (logYear === currentYearNum && logMonth === currentMonthNum) total += log.amount_used;
    }
  });

  const cardEl = document.querySelector('.savings-card');
  const titleEl = document.getElementById('savings-title');
  const toggleBtn = document.getElementById('savings-toggle-btn');
  const amountEl = document.getElementById('savings-amount');

  if (savingsPeriod === 'year') {
    // 今年モードの目印をつける
    cardEl.classList.add('period-year');
    cardEl.classList.remove('period-month');

    titleEl.textContent = '今年浮いた外食費（累計）';
    toggleBtn.textContent = '今月に切替';
  } else {
    // 今月モードの目印をつける
    cardEl.classList.add('period-month');
    cardEl.classList.remove('period-year');

    titleEl.textContent = '今月浮いた外食費（累計）';
    toggleBtn.textContent = '今年に切替';
  }

  amountEl.textContent = `¥${total.toLocaleString()}`;
}

// 期間の切替（今年 ⇄ 今月）
function toggleSavingsPeriod(e) {
  e.stopPropagation(); // モーダルが開くのを防止
  savingsPeriod = (savingsPeriod === 'year') ? 'month' : 'year';
  renderSavingsCard();
}

// 累計カードをクリックしたら履歴モーダルを開く
function handleSavingsCardClick(e) {
  openHistoryModal();
}

// ★使った履歴モーダルの描画と開閉
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

function closeHistoryModal() {
  document.getElementById('history-modal-overlay').classList.remove('is-open');
}
function closeHistoryModalOnBackdrop(e) {
  if (e.target.id === 'history-modal-overlay') closeHistoryModal();
}

// ★ポイント利用モーダルの開閉と実行
function openUseModal(id) {
  const coupon = coupons.find(c => c.id === id);
  if (!coupon) return;
  currentUsingCoupon = coupon;

  document.getElementById('use-modal-title').textContent = `${coupon.icon} ${coupon.name} を使う`;
  document.getElementById('use-current-balance').textContent = `現在の残高: ¥${coupon.amount.toLocaleString()}`;
  document.getElementById('use-amount-input').value = '';
  document.getElementById('use-modal-overlay').classList.add('is-open');

  setTimeout(() => {
    document.getElementById('use-amount-input').focus();
  }, 200);
}

function closeUseModal() {
  document.getElementById('use-modal-overlay').classList.remove('is-open');
  currentUsingCoupon = null;
}
function closeUseModalOnBackdrop(e) {
  if (e.target.id === 'use-modal-overlay') closeUseModal();
}

async function confirmUseAmount() {
  if (!currentUsingCoupon) return;
  const inputEl = document.getElementById('use-amount-input');
  const amountToUse = parseInt(inputEl.value, 10);

  if (isNaN(amountToUse) || amountToUse <= 0) {
    alert('有効な金額を入力してください');
    return;
  }
  if (amountToUse > currentUsingCoupon.amount) {
    alert(`残高（¥${currentUsingCoupon.amount.toLocaleString()}）を超える金額は使えません`);
    return;
  }

  await applyCouponUsage(currentUsingCoupon, amountToUse);
  closeUseModal();
}

// カレンダー描画
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
    const matching = coupons.filter(c => c.limit_date === dateStr);
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

// 優待リスト描画
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

    const isEditing = (editingCouponId === item.id);
    const card = document.createElement('div');
    card.className = `yutai-card ${filterDate ? 'highlight' : ''}`;

    const subLabel = item.is_point ? `<small>(1円単位pt)</small>` : `<small>(${item.unit}円券 × ${Math.floor(item.amount / item.unit)}枚)</small>`;

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
          ${item.is_point ? `
            <button class="use-btn primary" onclick="openUseModal(${item.id})">使った</button>
          ` : `
            <button class="use-btn" onclick="usePaperCoupon(${item.id})">−¥${item.unit}</button>
          `}
          <button class="use-btn" onclick="startEditing(${item.id})">残高上書き</button>
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
}

// 残高上書きの開始と保存
function startEditing(id) {
  editingCouponId = id;
  renderList(selectedDateStr);
}

async function saveDirectBalance(id) {
  const inputEl = document.getElementById(`input-${id}`);
  if (!inputEl) return;
  const newAmount = parseInt(inputEl.value, 10);
  if (!isNaN(newAmount) && newAmount >= 0) await updateAmountInDB(id, newAmount);
  editingCouponId = null;
}

// 絞り込みリセット
function resetFilter() {
  selectedDateStr = null;
  renderCalendar();
  renderList();
  // 今あるクーポンの残高(amount)を全部足し算する
  const totalBalance = coupons.reduce((sum, item) => sum + item.amount, 0);
  // さきほどHTMLに作った場所に文字として書き込む
  document.getElementById('total-balance-display').textContent = `未使用の総残高: ¥${totalBalance.toLocaleString()}`;
}

// 新規モーダルの開閉
function openModal() { document.getElementById('modal-overlay').classList.add('is-open'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('is-open'); }
function closeModalOnBackdrop(e) { if (e.target.id === 'modal-overlay') closeModal(); }

// カレンダーの月移動
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

// 初期読み込み
fetchCoupons();
fetchLogs();
setupRealtime();
