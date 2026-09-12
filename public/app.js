// ---------- state ----------
let history_ = ['landing'];
let signupData = null; // collected on signup form submit, sent to API once OTP channel is chosen
let pendingUserId = null; // user id awaiting OTP verification
let chosenOtpMethod = 'whatsapp';
let chosenFpMethod = 'whatsapp';
let fpUserId = null;
let currentUser = null;
let meta = { part_categories: [], cities: [], motorcycle_makes: [] };
let selectedPartCategory = '';
let searchDebounceTimer = null;
let currentListingId = null;
let selectedImages = []; // File[] for create-listing

let motoContext = { make: null };
let selectedMotoPartCategory = '';
let motoPartsDebounceTimer = null;
let createMode = 'car_part'; // 'car_part' | 'moto_part' | 'moto_whole' — which shape screen-create renders
let createMotoMake = null;

const TOKEN_KEY = 'alscrap_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

// ---------- api helper ----------
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data.error || 'حدث خطأ غير متوقع');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- navigation ----------
function go(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  history_.push(id);

  const navScreens = ['home', 'search', 'create', 'profile'];
  document.getElementById('navbar').style.display = navScreens.includes(id) ? 'flex' : 'none';
  document.querySelectorAll('.nav-item[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === id);
  });

  if (id === 'home') renderHome();
  if (id === 'search') renderSearch();
  if (id === 'create') prepareCreateScreen();
  if (id === 'profile') renderProfile();
  if (id === 'admin') renderAdmin();
  if (id === 'my-listings') renderMyListings();
  if (id === 'moto-makes') renderMotoMakes();
  if (id === 'moto-parts') renderMotoParts();
  if (id === 'moto-whole') renderMotoWhole();
  window.scrollTo(0, 0);
}
function goBack() {
  history_.pop();
  const prev = history_.pop() || 'home';
  go(prev);
}
function requireAuthThen(id) {
  if (!currentUser) {
    toast('سجّل الدخول أولاً');
    go('login');
    return;
  }
  go(id);
}
function openCarPartCreate() {
  createMode = 'car_part';
  requireAuthThen('create');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError(elId) {
  document.getElementById(elId).style.display = 'none';
}

// ---------- icons ----------
function icon(name, cls = '') {
  return `<i data-lucide="${name}" class="icon ${cls}"></i>`;
}
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}
refreshIcons();

// ---------- bootstrap ----------
async function bootstrap() {
  try {
    meta = await api('/listings/meta');
  } catch {
    meta = { part_categories: [], cities: [], motorcycle_makes: [] };
  }
  populateMetaSelects();

  if (getToken()) {
    try {
      const { user } = await api('/auth/me');
      currentUser = user;
    } catch {
      setToken(null);
    }
  }
  go('landing');
}

function populateMetaSelects() {
  const cityCreate = document.getElementById('cl-city');
  cityCreate.innerHTML = meta.cities.map((c) => `<option>${c}</option>`).join('');
  const partCat = document.getElementById('cl-part-category');
  partCat.innerHTML = meta.part_categories.map((c) => `<option>${c}</option>`).join('');
}

// ---------- signup flow ----------
let accountType = 'trader';
function selectType(type) {
  accountType = type;
  document.getElementById('type-trader').classList.toggle('selected', type === 'trader');
  document.getElementById('type-buyer').classList.toggle('selected', type === 'individual');
}
function checkSignupValid() {
  document.getElementById('su-submit').disabled = !document.getElementById('su-pledge').checked;
}
function submitSignup() {
  hideError('su-error');
  const full_name = document.getElementById('su-name').value.trim();
  const phone_country_code = document.getElementById('su-code').value;
  const phone_number = document.getElementById('su-phone').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const age = document.getElementById('su-age').value;
  const password = document.getElementById('su-pass').value;
  const pledge_accepted = document.getElementById('su-pledge').checked;

  if (!full_name || !phone_number || !email || !password) {
    return showError('su-error', 'الرجاء تعبئة كل الحقول المطلوبة');
  }
  if (password.length < 8) {
    return showError('su-error', 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  }
  signupData = { full_name, account_type: accountType, phone_country_code, phone_number, email, age, password, pledge_accepted };
  go('otp-choice');
}
function selectOtpMethod(method) {
  chosenOtpMethod = method;
  document.getElementById('method-whatsapp').style.borderColor = method === 'whatsapp' ? 'var(--blue)' : 'var(--border)';
  document.getElementById('method-email').style.borderColor = method === 'email' ? 'var(--blue)' : 'var(--border)';
  document.querySelector('#method-whatsapp .otp-radio').style.background = method === 'whatsapp' ? 'var(--blue)' : 'transparent';
  document.querySelector('#method-whatsapp .otp-radio').style.borderColor = method === 'whatsapp' ? 'var(--blue)' : '#C9CDD3';
  document.querySelector('#method-email .otp-radio').style.background = method === 'email' ? 'var(--blue)' : 'transparent';
  document.querySelector('#method-email .otp-radio').style.borderColor = method === 'email' ? 'var(--blue)' : '#C9CDD3';
}
async function sendOtpChosen() {
  try {
    const res = await api('/auth/signup', { method: 'POST', body: { ...signupData, otp_channel: chosenOtpMethod } });
    pendingUserId = res.user_id;
    document.querySelectorAll('#otp-icon [data-otp-icon]').forEach((el) => {
      el.hidden = el.dataset.otpIcon !== chosenOtpMethod;
    });
    if (chosenOtpMethod === 'whatsapp') {
      document.getElementById('otp-title').textContent = 'تأكيد رقم الجوال';
      document.getElementById('otp-email-display').textContent = res.otp_destination;
      document.getElementById('otp-footnote-text').textContent = 'بريدك الإلكتروني محفوظ لتسهيل التواصل، بدون الحاجة لتأكيده الآن';
    } else {
      document.getElementById('otp-title').textContent = 'تأكيد البريد الإلكتروني';
      document.getElementById('otp-email-display').textContent = res.otp_destination;
      document.getElementById('otp-footnote-text').textContent = 'رقم جوالك محفوظ لتسهيل التواصل، بدون الحاجة لتأكيده الآن';
    }
    toast(`تم إرسال كود التحقق (تجريبي: ${res.dev_otp_code})`);
    startOtpResendCountdown();
    go('otp');
  } catch (err) {
    toast(err.message);
  }
}
let resendTimer = null;
function startOtpResendCountdown() {
  let seconds = 45;
  const el = document.getElementById('otp-resend');
  clearInterval(resendTimer);
  const render = () => {
    if (seconds <= 0) {
      el.innerHTML = 'لم يصلك الكود؟ <span class="link" onclick="resendOtp()">إعادة الإرسال</span>';
      clearInterval(resendTimer);
    } else {
      el.innerHTML = `يمكنك إعادة الإرسال خلال ${seconds} ثانية`;
      seconds--;
    }
  };
  render();
  resendTimer = setInterval(render, 1000);
}
async function resendOtp() {
  try {
    const res = await api('/auth/otp/resend', { method: 'POST', body: { user_id: pendingUserId } });
    toast(`تم إعادة إرسال الكود (تجريبي: ${res.dev_otp_code})`);
    startOtpResendCountdown();
  } catch (err) {
    toast(err.message);
  }
}
async function verifyOtp() {
  hideError('otp-error');
  const inputs = document.querySelectorAll('#screen-otp .otp-row input');
  const code = Array.from(inputs).map((i) => i.value).join('');
  if (code.length !== 4) return showError('otp-error', 'أدخل الكود المكوّن من 4 أرقام');
  try {
    const res = await api('/auth/otp/verify', { method: 'POST', body: { user_id: pendingUserId, code } });
    setToken(res.token);
    currentUser = res.user;
    toast('تم تأكيد الحساب');
    go('notif');
  } catch (err) {
    showError('otp-error', err.message);
  }
}
async function enableNotifications(enabled) {
  try {
    if (enabled && 'Notification' in window) {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    const res = await api('/auth/notifications', { method: 'PATCH', body: { enabled } });
    currentUser = res.user;
  } catch { /* non-blocking */ }
  go('terms');
}
async function finishSignup() {
  try {
    const res = await api('/auth/accept-terms', { method: 'PATCH' });
    currentUser = res.user;
    toast('تم إنشاء الحساب بنجاح');
    go('home');
  } catch (err) {
    toast(err.message);
  }
}

// otp input auto-advance (applies to both signup OTP and forgot-password OTP rows)
document.addEventListener('input', (e) => {
  if (e.target.matches('.otp-row input')) {
    if (e.target.value && e.target.nextElementSibling) e.target.nextElementSibling.focus();
  }
});

// ---------- login ----------
async function submitLogin() {
  hideError('li-error');
  const identifier = document.getElementById('li-identifier').value.trim();
  const password = document.getElementById('li-pass').value;
  if (!identifier || !password) return showError('li-error', 'أدخل البريد/الجوال وكلمة المرور');
  try {
    const res = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setToken(res.token);
    currentUser = res.user;
    toast(`أهلاً ${res.user.full_name.split(' ')[0]}`);
    go('home');
  } catch (err) {
    showError('li-error', err.message);
  }
}
function logout() {
  setToken(null);
  currentUser = null;
  toast('تم تسجيل الخروج');
  go('landing');
}

// ---------- forgot password ----------
function selectFpMethod(method) {
  chosenFpMethod = method;
  document.getElementById('fp-method-whatsapp').classList.toggle('selected', method === 'whatsapp');
  document.getElementById('fp-method-email').classList.toggle('selected', method === 'email');
}
async function requestForgotOtp() {
  hideError('fp-error1');
  const identifier = document.getElementById('fp-identifier').value.trim();
  if (!identifier) return showError('fp-error1', 'أدخل البريد أو رقم الجوال');
  try {
    const res = await api('/auth/forgot-password/request', { method: 'POST', body: { identifier, otp_channel: chosenFpMethod } });
    fpUserId = res.user_id;
    toast(`تم إرسال الكود (تجريبي: ${res.dev_otp_code})`);
    document.getElementById('forgot-step1').style.display = 'none';
    document.getElementById('forgot-step2').style.display = 'block';
  } catch (err) {
    showError('fp-error1', err.message);
  }
}
async function confirmForgotOtp() {
  hideError('fp-error2');
  const inputs = document.querySelectorAll('#forgot-step2 .otp-row input');
  const code = Array.from(inputs).map((i) => i.value).join('');
  const new_password = document.getElementById('fp-newpass').value;
  if (code.length !== 4) return showError('fp-error2', 'أدخل الكود المكوّن من 4 أرقام');
  try {
    await api('/auth/forgot-password/confirm', { method: 'POST', body: { user_id: fpUserId, code, new_password } });
    toast('تم تغيير كلمة المرور');
    document.getElementById('forgot-step1').style.display = 'block';
    document.getElementById('forgot-step2').style.display = 'none';
    go('login');
  } catch (err) {
    showError('fp-error2', err.message);
  }
}

// ---------- listing cards ----------
const LISTING_STATUS_LABELS = { active: 'نشط', archived: 'مؤرشف', sold: 'مباع' };
function listingCard(l, opts = {}) {
  const thumb = l.thumbnail_url
    ? `<img src="${l.thumbnail_url}" alt="">`
    : icon('package', 'icon-lg');
  const statusBadge = opts.showStatus
    ? `<div class="badge ${l.status === 'active' ? 'badge-success' : 'badge-warning'}" style="margin-top:6px;">${escapeHtml(LISTING_STATUS_LABELS[l.status] || l.status)}</div>`
    : '';
  return `<div class="listing-card" onclick="openDetail('${l.id}')">
    <div class="listing-thumb">${thumb}</div>
    <div class="listing-info">
      <div class="title">${escapeHtml(l.title)}</div>
      <div class="price">${formatPrice(l.price, l.currency)}</div>
      <div class="loc">${icon('map-pin')} ${escapeHtml(l.city)}</div>
      ${statusBadge}
    </div>
  </div>`;
}
function formatPrice(price, currency) {
  const cur = { SAR: 'ر.س', AED: 'د.إ', KWD: 'د.ك', QAR: 'ر.ق', BHD: 'د.ب', OMR: 'ر.ع' }[currency] || currency;
  return Number(price).toLocaleString('ar') + ' ' + cur;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- home ----------
async function renderHome() {
  const el = document.getElementById('home-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings');
    el.innerHTML = listings.length
      ? listings.slice(0, 6).map(listingCard).join('')
      : '<p class="muted" style="grid-column:1/-1;">لا توجد إعلانات بعد</p>';
    refreshIcons();
  } catch (err) {
    el.innerHTML = `<p class="muted" style="grid-column:1/-1;">تعذّر تحميل الإعلانات</p>`;
  }
}
function homeSearch() {
  const q = document.getElementById('home-search').value.trim();
  go('search');
  document.getElementById('search-q').value = q;
  selectedPartCategory = '';
  renderSearch();
}

// ---------- search ----------
function renderCatStrip() {
  const strip = document.getElementById('cat-strip');
  const all = `<div class="cat-chip ${selectedPartCategory === '' ? 'selected' : ''}" onclick="selectPartCategory('')">الكل</div>`;
  strip.innerHTML = all + meta.part_categories
    .map((c) => `<div class="cat-chip ${c === selectedPartCategory ? 'selected' : ''}" onclick="selectPartCategory('${c}')">${c}</div>`)
    .join('');
}
function selectPartCategory(c) {
  selectedPartCategory = c;
  renderSearch();
}
function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderSearch, 300);
}
async function renderSearch() {
  renderCatStrip();
  document.getElementById('cat-name').textContent = selectedPartCategory || 'الكل';
  const q = document.getElementById('search-q').value.trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (selectedPartCategory) params.set('part_category', selectedPartCategory);

  const el = document.getElementById('search-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('cat-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length ? listings.map(listingCard).join('') : '<p class="muted" style="grid-column:1/-1;">لا توجد نتائج بعد</p>';
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر تحميل النتائج</p>';
  }
}

// ---------- motorcycles ----------
function renderMotoMakes() {
  const grid = document.getElementById('moto-makes-grid');
  grid.innerHTML = meta.motorcycle_makes
    .map((m) => `<div class="cat-card" onclick="selectMotoMake('${escapeHtml(m)}')">${icon('bike')}${escapeHtml(m)}</div>`)
    .join('');
  refreshIcons();
  document.getElementById('moto-other-make-box').style.display = 'none';
}
function selectMotoMake(make) {
  if (make === 'أخرى') {
    const box = document.getElementById('moto-other-make-box');
    box.style.display = 'block';
    document.getElementById('moto-other-make-input').value = '';
    document.getElementById('moto-other-make-input').focus();
    return;
  }
  proceedWithMotoMake(make);
}
function confirmMotoOtherMake() {
  const name = document.getElementById('moto-other-make-input').value.trim();
  if (!name) return toast('اكتب اسم الشركة المصنّعة');
  proceedWithMotoMake(name);
}
function proceedWithMotoMake(make) {
  motoContext.make = make;
  document.getElementById('moto-choice-title').textContent = 'دراجات ' + make;
  document.getElementById('moto-choice-make-1').textContent = make;
  document.getElementById('moto-choice-make-2').textContent = make;
  go('moto-choice');
}
function openMotoParts() {
  document.getElementById('moto-parts-make').textContent = motoContext.make;
  selectedMotoPartCategory = '';
  document.getElementById('moto-parts-q').value = '';
  go('moto-parts');
}
function openMotoWhole() {
  document.getElementById('moto-whole-make').textContent = motoContext.make;
  go('moto-whole');
}
function renderMotoPartsCatStrip() {
  const strip = document.getElementById('moto-parts-cat-strip');
  const all = `<div class="cat-chip ${selectedMotoPartCategory === '' ? 'selected' : ''}" onclick="selectMotoPartCategory('')">الكل</div>`;
  strip.innerHTML = all + meta.part_categories
    .map((c) => `<div class="cat-chip ${c === selectedMotoPartCategory ? 'selected' : ''}" onclick="selectMotoPartCategory('${escapeHtml(c)}')">${escapeHtml(c)}</div>`)
    .join('');
}
function selectMotoPartCategory(c) {
  selectedMotoPartCategory = c;
  renderMotoParts();
}
function debouncedMotoPartsSearch() {
  clearTimeout(motoPartsDebounceTimer);
  motoPartsDebounceTimer = setTimeout(renderMotoParts, 300);
}
async function renderMotoParts() {
  renderMotoPartsCatStrip();
  const q = document.getElementById('moto-parts-q').value.trim();
  const params = new URLSearchParams({ category: 'motorcycle', listing_type: 'part', make: motoContext.make });
  if (q) params.set('q', q);
  if (selectedMotoPartCategory) params.set('part_category', selectedMotoPartCategory);

  const el = document.getElementById('moto-parts-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('moto-parts-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length ? listings.map(listingCard).join('') : '<p class="muted" style="grid-column:1/-1;">لا توجد قطع بعد</p>';
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر تحميل القطع</p>';
  }
}
async function renderMotoWhole() {
  const params = new URLSearchParams({ category: 'motorcycle', listing_type: 'whole', make: motoContext.make });
  const el = document.getElementById('moto-whole-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('moto-whole-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length ? listings.map(listingCard).join('') : '<p class="muted" style="grid-column:1/-1;">لا توجد دراجات معروضة بعد</p>';
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر التحميل</p>';
  }
}
function openMotoCreatePart() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  createMode = 'moto_part';
  createMotoMake = motoContext.make;
  go('create');
}
function openMotoCreateWhole() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  createMode = 'moto_whole';
  createMotoMake = motoContext.make;
  go('create');
}

// ---------- listing detail ----------
async function openDetail(id) {
  currentListingId = id;
  go('detail');
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listing, seller } = await api('/listings/' + id);
    const img = listing.media[0]
      ? `<img src="${listing.media[0].url}" style="width:100%; height:100%; object-fit:cover;">`
      : icon('image', 'icon-xl');
    const isWhole = listing.listing_type === 'whole';
    const compatBits = [listing.compatible_make, listing.compatible_model].filter(Boolean).join(' ');
    const yearRange = listing.compatible_year_from || listing.compatible_year_to
      ? `${listing.compatible_year_from || ''}${listing.compatible_year_from && listing.compatible_year_to ? '–' : ''}${listing.compatible_year_to || ''}`
      : '';

    const damageLabels = { light: 'تلف خفيف', medium: 'تلف متوسط', severe: 'تلف شديد' };
    const damageBadgeClass = { light: 'badge-success', medium: 'badge-warning', severe: 'badge-danger' };
    const topBadge = isWhole
      ? `<span class="badge ${damageBadgeClass[listing.damage_severity] || 'badge-warning'}">${escapeHtml(damageLabels[listing.damage_severity] || '')}</span>`
      : `<span class="badge badge-warning">${escapeHtml(listing.part_category || '')}</span>`;
    const identityLine = isWhole
      ? `<p class="muted" style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">${icon('bike', 'icon-xs')} ${escapeHtml(compatBits)} ${escapeHtml(yearRange)}</p>`
      : (compatBits || yearRange ? `<p class="muted" style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">${icon('wrench', 'icon-xs')} ${escapeHtml(compatBits)} ${escapeHtml(yearRange)}</p>` : '');

    body.innerHTML = `
      <div class="listing-thumb" style="height:190px; border-radius:var(--radius-sm); margin-bottom:12px;">${img}</div>
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px;">
        <h3 style="font-size:var(--fs-md); font-weight:700;">${escapeHtml(listing.title)}</h3>
        ${topBadge}
      </div>
      ${identityLine}
      <p class="muted" style="display:flex; align-items:center; gap:6px; margin-bottom:12px;">${icon('map-pin', 'icon-xs')} ${escapeHtml(listing.city)}</p>
      ${listing.description ? `<p style="font-size:var(--fs-base); line-height:1.7; margin-bottom:14px;">${escapeHtml(listing.description)}</p>` : ''}

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; cursor:pointer;" onclick="openSeller('${seller.id}')">
        <div class="avatar" style="width:32px; height:32px; font-size:var(--fs-xs);">${initials(seller.full_name)}</div>
        <span style="font-size:var(--fs-sm); font-weight:500;">${escapeHtml(seller.full_name)}</span>
        ${seller.is_verified_trader ? `<span class="badge badge-success">${icon('badge-check')} موثّق</span>` : ''}
      </div>

      <div style="background:var(--bg); border-radius:var(--radius-sm); padding:12px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:var(--fs-base); font-weight:600; display:flex; align-items:center; gap:5px;">${icon('star', 'icon-sm icon-star-filled')} ${seller.rating_avg.toFixed(1)}</span>
        <span class="muted">${seller.completed_deals_count} صفقة</span>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:14px; margin-bottom:12px; gap:10px;">
        <span style="font-size:var(--fs-xl); font-weight:700; color:var(--blue);">${formatPrice(listing.price, listing.currency)}</span>
        <button class="btn-primary" style="width:auto; padding:11px 20px;" onclick="contactSeller('${seller.id}')">تواصل مع البائع</button>
      </div>
      <div id="contact-reveal"></div>
    `;
    refreshIcons();
  } catch (err) {
    body.innerHTML = `<p class="muted">تعذّر تحميل الإعلان: ${escapeHtml(err.message)}</p>`;
  }
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}
async function contactSeller(sellerId) {
  if (!currentUser) {
    toast('سجّل الدخول للتواصل مع البائع');
    return go('login');
  }
  try {
    const res = await api('/users/' + sellerId + '/contact');
    const waLink = `https://wa.me/${res.phone.replace('+', '')}`;
    document.getElementById('contact-reveal').innerHTML = `
      <div class="pledge-box" style="margin-top:10px;">
        ${icon('phone', 'icon-sm icon-top-align')}
        <p style="font-size:var(--fs-base); line-height:1.9;">
          <b>${res.phone}</b><br>
          ${res.whatsapp_verified ? `<a href="${waLink}" target="_blank" class="link">تواصل عبر واتساب</a>` : 'راسل البائع أو اتصل به مباشرة'}
        </p>
      </div>`;
    refreshIcons();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- create listing ----------
function prepareCreateScreen() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  document.getElementById('cl-title').value = '';
  document.getElementById('cl-desc').value = '';
  document.getElementById('cl-price').value = '';
  document.getElementById('cl-make').value = '';
  document.getElementById('cl-model').value = '';
  document.getElementById('cl-year-from').value = '';
  document.getElementById('cl-year-to').value = '';
  document.getElementById('cl-moto-part-model').value = '';
  document.getElementById('cl-moto-part-year-from').value = '';
  document.getElementById('cl-moto-part-year-to').value = '';
  document.getElementById('cl-moto-whole-model').value = '';
  document.getElementById('cl-moto-whole-year').value = '';
  document.getElementById('cl-moto-whole-damage').value = 'light';
  selectedImages = [];
  renderThumbs();
  hideError('cl-error');

  const heading = document.getElementById('cl-heading');
  const backBtn = document.getElementById('cl-back');
  document.getElementById('cl-block-part-category').style.display = createMode === 'moto_whole' ? 'none' : 'block';
  document.getElementById('cl-block-car-compat').style.display = createMode === 'car_part' ? 'block' : 'none';
  document.getElementById('cl-block-moto-part-compat').style.display = createMode === 'moto_part' ? 'block' : 'none';
  document.getElementById('cl-block-moto-whole').style.display = createMode === 'moto_whole' ? 'block' : 'none';

  if (createMode === 'moto_part') {
    heading.textContent = 'إضافة قطعة غيار دراجة';
    backBtn.onclick = () => go('moto-parts');
    document.getElementById('cl-moto-part-make-display').innerHTML = icon('bike', 'icon-sm icon-muted') + ' ' + escapeHtml(createMotoMake);
    refreshIcons();
  } else if (createMode === 'moto_whole') {
    heading.textContent = 'إضافة دراجة تالفة للبيع';
    backBtn.onclick = () => go('moto-whole');
    document.getElementById('cl-moto-whole-make-display').innerHTML = icon('bike', 'icon-sm icon-muted') + ' ' + escapeHtml(createMotoMake);
    refreshIcons();
  } else {
    heading.textContent = 'إضافة إعلان قطعة غيار';
    backBtn.onclick = () => go('home');
  }
}
const MAX_IMAGES = 10;
const MAX_IMAGE_MB = 5;
function onImagesSelected(e) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (selectedImages.length >= MAX_IMAGES) { toast(`الحد الأقصى ${MAX_IMAGES} صور`); break; }
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) { toast(`الصورة "${f.name}" أكبر من 5 ميجا`); continue; }
    if (!['image/jpeg', 'image/png'].includes(f.type)) { toast('الصور يجب أن تكون JPG أو PNG'); continue; }
    selectedImages.push(f);
  }
  e.target.value = '';
  renderThumbs();
}
function renderThumbs() {
  const el = document.getElementById('cl-thumbs');
  el.innerHTML = selectedImages
    .map((f, i) => `<div class="thumb"><img src="${URL.createObjectURL(f)}"><span class="rm" onclick="removeImage(${i})">${icon('x')}</span></div>`)
    .join('');
  refreshIcons();
}
function removeImage(i) {
  selectedImages.splice(i, 1);
  renderThumbs();
}
async function publishListing() {
  hideError('cl-error');
  const title = document.getElementById('cl-title').value.trim();
  const price = document.getElementById('cl-price').value;
  const city = document.getElementById('cl-city').value;

  const fd = new FormData();
  fd.append('title', title);
  fd.append('price', price);
  fd.append('city', city);
  fd.append('description', document.getElementById('cl-desc').value.trim());

  if (createMode === 'moto_part') {
    const part_category = document.getElementById('cl-part-category').value;
    if (!title || !price || !city || !part_category) {
      return showError('cl-error', 'عنوان الإعلان والسعر والمدينة وفئة القطعة مطلوبة');
    }
    fd.append('category', 'motorcycle');
    fd.append('listing_type', 'part');
    fd.append('part_category', part_category);
    fd.append('compatible_make', createMotoMake);
    fd.append('compatible_model', document.getElementById('cl-moto-part-model').value.trim());
    fd.append('compatible_year_from', document.getElementById('cl-moto-part-year-from').value);
    fd.append('compatible_year_to', document.getElementById('cl-moto-part-year-to').value);
  } else if (createMode === 'moto_whole') {
    const model = document.getElementById('cl-moto-whole-model').value.trim();
    const year = document.getElementById('cl-moto-whole-year').value;
    if (!title || !price || !city || !model || !year) {
      return showError('cl-error', 'عنوان الإعلان والسعر والمدينة وموديل الدراجة وسنة الصنع مطلوبة');
    }
    fd.append('category', 'motorcycle');
    fd.append('listing_type', 'whole');
    fd.append('compatible_make', createMotoMake);
    fd.append('compatible_model', model);
    fd.append('compatible_year_from', year);
    fd.append('damage_severity', document.getElementById('cl-moto-whole-damage').value);
  } else {
    const part_category = document.getElementById('cl-part-category').value;
    if (!title || !price || !city || !part_category) {
      return showError('cl-error', 'عنوان الإعلان والسعر والمدينة وفئة القطعة مطلوبة');
    }
    fd.append('part_category', part_category);
    fd.append('compatible_make', document.getElementById('cl-make').value.trim());
    fd.append('compatible_model', document.getElementById('cl-model').value.trim());
    fd.append('compatible_year_from', document.getElementById('cl-year-from').value);
    fd.append('compatible_year_to', document.getElementById('cl-year-to').value);
  }
  selectedImages.forEach((f) => fd.append('images', f));

  const btn = document.getElementById('cl-submit');
  btn.disabled = true;
  btn.textContent = 'جارِ النشر...';
  try {
    await api('/listings', { method: 'POST', body: fd, isForm: true });
    toast('تم نشر الإعلان بنجاح');
    if (createMode === 'moto_part') go('moto-parts');
    else if (createMode === 'moto_whole') go('moto-whole');
    else go('home');
  } catch (err) {
    showError('cl-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'نشر الإعلان';
  }
}

// ---------- seller profile ----------
async function openSeller(id) {
  go('seller');
  const body = document.getElementById('seller-body');
  const listingsEl = document.getElementById('seller-listings');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  listingsEl.innerHTML = '';
  try {
    const { seller, listings } = await api('/users/' + id + '/public');
    body.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
        <div class="avatar" style="width:48px; height:48px; font-size:var(--fs-base);">${initials(seller.full_name)}</div>
        <div>
          <p style="font-size:var(--fs-base); font-weight:700; display:flex; align-items:center; gap:6px;">${escapeHtml(seller.full_name)} ${seller.is_verified_trader ? `<span class="badge badge-success">${icon('badge-check')} موثّق</span>` : ''}</p>
          <p class="muted">${seller.account_type === 'trader' ? 'تشليح / تاجر' : 'فرد / مشتري'}</p>
        </div>
      </div>
      <div style="background:var(--bg); border-radius:var(--radius-sm); padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:var(--fs-base); font-weight:600; display:flex; align-items:center; gap:5px;">${icon('star', 'icon-sm icon-star-filled')} ${seller.rating_avg.toFixed(1)}</span>
        <span class="muted">${seller.completed_deals_count} صفقة مكتملة</span>
      </div>
    `;
    listingsEl.innerHTML = listings.length
      ? listings.map(listingCard).join('')
      : '<p class="muted" style="grid-column:1/-1;">لا توجد إعلانات نشطة</p>';
    refreshIcons();
  } catch (err) {
    body.innerHTML = `<p class="muted">تعذّر تحميل البروفايل</p>`;
  }
}

// ---------- my listings ----------
async function renderMyListings() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  const el = document.getElementById('my-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings/mine');
    el.innerHTML = listings.length
      ? listings.map((l) => listingCard(l, { showStatus: true })).join('')
      : '<p class="muted" style="grid-column:1/-1;">ما نشرت أي إعلان بعد</p>';
    refreshIcons();
  } catch (err) {
    el.innerHTML = `<p class="muted" style="grid-column:1/-1;">تعذّر تحميل إعلاناتك</p>`;
  }
}

// ---------- profile ----------
async function renderProfile() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  try {
    const { user } = await api('/auth/me');
    currentUser = user;
  } catch { /* keep cached */ }
  document.getElementById('profile-avatar').textContent = initials(currentUser.full_name);
  document.getElementById('profile-name').textContent = currentUser.full_name;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('notif-state').textContent = currentUser.notifications_enabled ? 'مفعّلة' : 'معطّلة';
  document.getElementById('admin-row').style.display = currentUser.is_admin ? 'flex' : 'none';
}
async function toggleNotifRow() {
  try {
    const res = await api('/auth/notifications', { method: 'PATCH', body: { enabled: !currentUser.notifications_enabled } });
    currentUser = res.user;
    document.getElementById('notif-state').textContent = currentUser.notifications_enabled ? 'مفعّلة' : 'معطّلة';
    toast(currentUser.notifications_enabled ? 'تم تفعيل الإشعارات' : 'تم إيقاف الإشعارات');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- admin ----------
async function renderAdmin() {
  if (!currentUser || !currentUser.is_admin) { toast('صلاحية مسؤول مطلوبة'); return go('profile'); }
  const statsEl = document.getElementById('admin-stats');
  const usersEl = document.getElementById('admin-users');
  statsEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  usersEl.innerHTML = '';
  try {
    const stats = await api('/admin/stats');
    statsEl.innerHTML = `
      <h3 style="font-size:var(--fs-base); font-weight:700; margin-bottom:12px;">إحصائيات سريعة</h3>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:8px;"><span class="muted">مستخدمون نشطون</span><span style="font-weight:600;">${stats.active_users_count}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:8px;"><span class="muted">إعلانات اليوم</span><span style="font-weight:600;">${stats.listings_posted_today}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm);"><span class="muted">إجمالي الإعلانات النشطة</span><span style="font-weight:600;">${stats.active_listings_count}</span></div>
    `;
    const { users } = await api('/admin/users');
    usersEl.innerHTML = '<h3 style="font-size:var(--fs-base); font-weight:700; margin-bottom:12px;">إدارة الحسابات</h3>' + users.map((u) => `
      <div class="settings-row">
        <span class="status-dot ${u.status === 'active' ? 'status-dot-success' : 'status-dot-danger'}"></span>
        <span>${escapeHtml(u.full_name)}<br><span class="muted">${escapeHtml(u.email)}</span></span>
        <button class="btn-ghost" style="border:1px solid var(--border);" onclick="toggleUserStatus('${u.id}','${u.status}')">${u.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
      </div>
    `).join('');
  } catch (err) {
    statsEl.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
async function toggleUserStatus(id, currentStatus) {
  const status = currentStatus === 'active' ? 'suspended' : 'active';
  try {
    await api('/admin/users/' + id + '/status', { method: 'PATCH', body: { status } });
    toast('تم التحديث');
    renderAdmin();
  } catch (err) {
    toast(err.message);
  }
}

bootstrap();
