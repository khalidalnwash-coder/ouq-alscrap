// ---------- state ----------
let history_ = ['landing'];
let signupData = null; // collected on signup form submit, sent to API once OTP channel is chosen
let pendingUserId = null; // user id awaiting OTP verification
let chosenOtpMethod = 'whatsapp';
let chosenFpMethod = 'whatsapp';
let fpUserId = null;
let currentUser = null;
let meta = { countries: [], cities_by_country: {}, part_categories: [], vehicle_categories: {}, report_reasons: { listing: [], account: [] }, commission_rate: 0.025, bank_account: null };
const COUNTRY_KEY = 'alscrap_country';
let browsingCountry = localStorage.getItem(COUNTRY_KEY) || 'SA';
let selectedPartCategory = '';
let searchDebounceTimer = null;
let currentListingId = null;
let selectedImages = []; // File[] for create-listing

// "Vehicle sections" — motorcycles / full cars / trucks, all sharing the
// same screens (screen-vehicle-makes/choice/parts/whole), driven by
// vehicleCategory. Unrelated to the plain, manufacturer-optional "قطع غيار"
// (spare_part) flow, which stays exactly as it was.
let vehicleCategory = null; // 'motorcycle' | 'full_car' | 'truck'
let vehicleContext = { make: null };
let selectedVehiclePartCategory = '';
let vehiclePartsDebounceTimer = null;
let selectedVehiclePartsModel = '';
let selectedVehicleWholeModel = '';
let createMode = 'car_part'; // 'car_part' | 'vehicle_part' | 'vehicle_whole' — which shape screen-create renders
let createVehicleCategory = null;
let createVehicleMake = null;

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
  if (id === 'vehicle-makes') renderVehicleMakes();
  if (id === 'vehicle-parts') renderVehicleParts();
  if (id === 'vehicle-whole') renderVehicleWhole();
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
    meta = { countries: [], cities_by_country: {}, part_categories: [], vehicle_categories: {}, report_reasons: { listing: [], account: [] }, commission_rate: 0.025, bank_account: null };
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

// ---------- countries ----------
function countryInfo(code) {
  return meta.countries.find((c) => c.code === code) || null;
}
function countryOptionsHtml(selectedCode) {
  return meta.countries
    .map((c) => `<option value="${c.code}" ${c.code === selectedCode ? 'selected' : ''}>${c.flag} ${escapeHtml(c.label)}</option>`)
    .join('');
}
function phoneCodeOptionsHtml(selectedCode) {
  return meta.countries
    .map((c) => `<option value="${c.phone_code}" ${c.phone_code === selectedCode ? 'selected' : ''}>${c.flag} ${c.phone_code}</option>`)
    .join('');
}
function setBrowsingCountry(code) {
  browsingCountry = code;
  localStorage.setItem(COUNTRY_KEY, code);
  document.getElementById('home-country').value = code;
  document.getElementById('search-country').value = code;
}
function onBrowsingCountryChange(code) {
  setBrowsingCountry(code);
  const activeId = document.querySelector('.screen.active').id;
  if (activeId === 'screen-home') renderHome();
  if (activeId === 'screen-search') renderSearch();
}
function onSignupCountryChange() {
  const country = document.getElementById('su-country').value;
  document.getElementById('su-code').value = countryInfo(country).phone_code;
}
function onCreateCountryChange() {
  const country = document.getElementById('cl-country').value;
  const cities = meta.cities_by_country[country] || [];
  document.getElementById('cl-city').innerHTML = cities.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  document.getElementById('cl-price-label').textContent = 'السعر (' + (countryInfo(country)?.currency ? CURRENCY_LABELS_AR[countryInfo(country).currency] : '') + ')';
}
const CURRENCY_LABELS_AR = {
  SAR: 'ريال سعودي', AED: 'درهم إماراتي', KWD: 'دينار كويتي',
  QAR: 'ريال قطري', BHD: 'دينار بحريني', OMR: 'ريال عماني',
};

function populateMetaSelects() {
  document.getElementById('su-country').innerHTML = countryOptionsHtml(browsingCountry);
  document.getElementById('su-code').innerHTML = phoneCodeOptionsHtml(countryInfo(browsingCountry)?.phone_code);
  document.getElementById('cl-country').innerHTML = countryOptionsHtml(browsingCountry);
  document.getElementById('home-country').innerHTML = countryOptionsHtml(browsingCountry);
  document.getElementById('search-country').innerHTML = countryOptionsHtml(browsingCountry);
  onCreateCountryChange();

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
  const country = document.getElementById('su-country').value;
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
  signupData = { full_name, account_type: accountType, country, phone_country_code, phone_number, email, age, password, pledge_accepted };
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
const BUMP_COOLDOWN_HOURS = 24;
const ARCHIVE_WARNING_DAYS = 45;
const ARCHIVE_DAYS = 60;
function listingCard(l, opts = {}) {
  const thumb = l.thumbnail_url
    ? `<img src="${l.thumbnail_url}" alt="">`
    : icon('package', 'icon-lg');
  const statusBadge = opts.showStatus
    ? `<div class="badge ${l.status === 'active' ? 'badge-success' : 'badge-warning'}" style="margin-top:6px;">${escapeHtml(LISTING_STATUS_LABELS[l.status] || l.status)}</div>`
    : '';

  let actionsHtml = '';
  if (opts.showActions && l.status === 'active') {
    const hoursSince = (Date.now() - new Date(l.last_updated_at).getTime()) / 3600000;
    const daysSince = Math.floor(hoursSince / 24);
    const canBump = hoursSince >= BUMP_COOLDOWN_HOURS;
    const warnHtml = daysSince >= ARCHIVE_WARNING_DAYS
      ? `<div class="muted" style="font-size:var(--fs-xs); color:var(--warning); margin-top:4px; display:flex; align-items:center; gap:3px;">${icon('alert-triangle', 'icon-xs')} سيُؤرشف خلال ${Math.max(ARCHIVE_DAYS - daysSince, 0)} يوم</div>`
      : '';
    actionsHtml = `${warnHtml}
      <button class="btn-ghost card-action-btn" ${canBump ? '' : 'disabled'} onclick="event.stopPropagation(); bumpListing('${l.id}')">
        ${canBump ? 'حدّث الآن' : `متاح بعد ${Math.max(Math.ceil(BUMP_COOLDOWN_HOURS - hoursSince), 0)} س`}
      </button>`;
  } else if (opts.showActions && l.status === 'archived') {
    actionsHtml = `<button class="btn-ghost card-action-btn" style="color:var(--blue);" onclick="event.stopPropagation(); restoreListing('${l.id}')">${icon('rotate-ccw', 'icon-xs')} استرجاع</button>`;
  }

  return `<div class="listing-card" onclick="openDetail('${l.id}')">
    <div class="listing-thumb">${thumb}</div>
    <div class="listing-info">
      <div class="title">${escapeHtml(l.title)}</div>
      <div class="price">${formatPrice(l.price, l.currency)}</div>
      <div class="loc">${icon('map-pin')} ${escapeHtml(l.city)}</div>
      ${statusBadge}
      ${actionsHtml}
    </div>
  </div>`;
}
async function bumpListing(id) {
  try {
    await api('/listings/' + id + '/bump', { method: 'PATCH' });
    toast('تم تحديث الإعلان وإعادته لأعلى النتائج');
    renderMyListings();
  } catch (err) {
    toast(err.message);
  }
}
async function restoreListing(id) {
  try {
    await api('/listings/' + id + '/restore', { method: 'PATCH' });
    toast('تم استرجاع الإعلان');
    renderMyListings();
  } catch (err) {
    toast(err.message);
  }
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
  document.getElementById('home-country').value = browsingCountry;
  const el = document.getElementById('home-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?country=' + encodeURIComponent(browsingCountry));
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
  document.getElementById('search-country').value = browsingCountry;
  renderCatStrip();
  document.getElementById('cat-name').textContent = selectedPartCategory || 'الكل';
  const q = document.getElementById('search-q').value.trim();
  const params = new URLSearchParams({ country: browsingCountry });
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

// ---------- vehicle sections (motorcycles / full cars / trucks) ----------
const VEHICLE_ICONS = { motorcycle: 'bike', full_car: 'car', truck: 'truck' };
const VEHICLE_PLURALS = { motorcycle: 'دراجات', full_car: 'سيارات', truck: 'شاحنات' };
const VEHICLE_SECTION_TITLES = { motorcycle: 'الدراجات النارية', full_car: 'السيارات الكاملة', truck: 'الشاحنات والتريلات' };

function currentVehicleMeta() {
  return (meta.vehicle_categories && meta.vehicle_categories[vehicleCategory]) || { label: '', makes: [], models_by_make: {} };
}
function openVehicleSection(category) {
  vehicleCategory = category;
  vehicleContext = { make: null };
  go('vehicle-makes');
}
function renderVehicleMakes() {
  document.getElementById('vehicle-makes-title').textContent = VEHICLE_SECTION_TITLES[vehicleCategory];
  const grid = document.getElementById('vehicle-makes-grid');
  grid.innerHTML = currentVehicleMeta().makes
    .map((m) => `<div class="cat-card" onclick="selectVehicleMake('${escapeHtml(m)}')">${icon(VEHICLE_ICONS[vehicleCategory])}${escapeHtml(m)}</div>`)
    .join('');
  refreshIcons();
  document.getElementById('vehicle-other-make-box').style.display = 'none';
}
function selectVehicleMake(make) {
  if (make === 'أخرى') {
    const box = document.getElementById('vehicle-other-make-box');
    box.style.display = 'block';
    document.getElementById('vehicle-other-make-input').value = '';
    document.getElementById('vehicle-other-make-input').focus();
    return;
  }
  proceedWithVehicleMake(make);
}
function confirmVehicleOtherMake() {
  const name = document.getElementById('vehicle-other-make-input').value.trim();
  if (!name) return toast('اكتب اسم الشركة المصنّعة');
  proceedWithVehicleMake(name);
}
function proceedWithVehicleMake(make) {
  vehicleContext.make = make;
  const plural = VEHICLE_PLURALS[vehicleCategory];
  document.getElementById('vehicle-choice-title').textContent = plural + ' ' + make;
  document.getElementById('vehicle-choice-make-1').textContent = make;
  document.getElementById('vehicle-choice-whole-icon').innerHTML = icon(VEHICLE_ICONS[vehicleCategory]);
  document.getElementById('vehicle-choice-whole-label').innerHTML =
    `${plural} <span id="vehicle-choice-make-2">${escapeHtml(make)}</span> كاملة تالفة`;
  refreshIcons();
  go('vehicle-choice');
}
function openVehicleParts() {
  document.getElementById('vehicle-parts-make').textContent = vehicleContext.make;
  selectedVehiclePartCategory = '';
  selectedVehiclePartsModel = '';
  document.getElementById('vehicle-parts-q').value = '';
  go('vehicle-parts');
}
function openVehicleWhole() {
  const plural = VEHICLE_PLURALS[vehicleCategory];
  document.getElementById('vehicle-whole-heading').innerHTML =
    `${plural} <span id="vehicle-whole-make">${escapeHtml(vehicleContext.make)}</span> تالفة`;
  document.getElementById('vehicle-whole-create-link').textContent = '+ نشر ' + currentVehicleMeta().label + ' للبيع';
  selectedVehicleWholeModel = '';
  go('vehicle-whole');
}
function populateModelFilter(selectId, selectedValue) {
  const models = (currentVehicleMeta().models_by_make[vehicleContext.make] || []).filter((m) => m !== 'أخرى');
  document.getElementById(selectId).innerHTML =
    '<option value="">كل الموديلات</option>' +
    models.map((m) => `<option value="${escapeHtml(m)}" ${m === selectedValue ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
}
function renderVehiclePartsCatStrip() {
  const strip = document.getElementById('vehicle-parts-cat-strip');
  const all = `<div class="cat-chip ${selectedVehiclePartCategory === '' ? 'selected' : ''}" onclick="selectVehiclePartCategory('')">الكل</div>`;
  strip.innerHTML = all + meta.part_categories
    .map((c) => `<div class="cat-chip ${c === selectedVehiclePartCategory ? 'selected' : ''}" onclick="selectVehiclePartCategory('${escapeHtml(c)}')">${escapeHtml(c)}</div>`)
    .join('');
}
function selectVehiclePartCategory(c) {
  selectedVehiclePartCategory = c;
  renderVehicleParts();
}
function debouncedVehiclePartsSearch() {
  clearTimeout(vehiclePartsDebounceTimer);
  vehiclePartsDebounceTimer = setTimeout(renderVehicleParts, 300);
}
async function renderVehicleParts() {
  renderVehiclePartsCatStrip();
  selectedVehiclePartsModel = document.getElementById('vehicle-parts-model-filter').value;
  populateModelFilter('vehicle-parts-model-filter', selectedVehiclePartsModel);
  const q = document.getElementById('vehicle-parts-q').value.trim();
  const params = new URLSearchParams({ category: vehicleCategory, listing_type: 'part', make: vehicleContext.make, country: browsingCountry });
  if (q) params.set('q', q);
  if (selectedVehiclePartCategory) params.set('part_category', selectedVehiclePartCategory);
  if (selectedVehiclePartsModel) params.set('model', selectedVehiclePartsModel);

  const el = document.getElementById('vehicle-parts-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('vehicle-parts-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length ? listings.map(listingCard).join('') : '<p class="muted" style="grid-column:1/-1;">لا توجد قطع بعد</p>';
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر تحميل القطع</p>';
  }
}
async function renderVehicleWhole() {
  selectedVehicleWholeModel = document.getElementById('vehicle-whole-model-filter').value;
  populateModelFilter('vehicle-whole-model-filter', selectedVehicleWholeModel);
  const params = new URLSearchParams({ category: vehicleCategory, listing_type: 'whole', make: vehicleContext.make, country: browsingCountry });
  if (selectedVehicleWholeModel) params.set('model', selectedVehicleWholeModel);

  const el = document.getElementById('vehicle-whole-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('vehicle-whole-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length ? listings.map(listingCard).join('') : '<p class="muted" style="grid-column:1/-1;">لا توجد مركبات معروضة بعد</p>';
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر التحميل</p>';
  }
}
function openVehicleCreatePart() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  createMode = 'vehicle_part';
  createVehicleCategory = vehicleCategory;
  createVehicleMake = vehicleContext.make;
  go('create');
}
function openVehicleCreateWhole() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  createMode = 'vehicle_whole';
  createVehicleCategory = vehicleCategory;
  createVehicleMake = vehicleContext.make;
  go('create');
}

// ---------- listing detail ----------
let currentListingDetail = null;
let currentSellerDetail = null;
async function openDetail(id) {
  currentListingId = id;
  go('detail');
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listing, seller } = await api('/listings/' + id);
    currentListingDetail = listing;
    currentSellerDetail = seller;
    const isOwnListing = currentUser && seller && currentUser.id === seller.id;
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
      <p class="muted" style="display:flex; align-items:center; gap:6px; margin-bottom:12px;">${icon('map-pin', 'icon-xs')} ${escapeHtml(listing.city)}${countryInfo(listing.country) ? `، ${countryInfo(listing.country).flag} ${escapeHtml(countryInfo(listing.country).label)}` : ''}</p>
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

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:14px; margin-bottom:12px; gap:8px;">
        <span style="font-size:var(--fs-xl); font-weight:700; color:var(--blue);">${formatPrice(listing.price, listing.currency)}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn-primary" style="width:auto; padding:11px 20px;" onclick="contactSeller('${seller.id}')">تواصل مع البائع</button>
          <button class="btn-ghost" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:11px;" title="إبلاغ عن الإعلان" onclick="openReportListing()">${icon('flag', 'icon-sm')}</button>
        </div>
      </div>
      ${!isOwnListing ? `<button class="btn-outline" style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:12px;" onclick="openDealConfirm()">${icon('handshake', 'icon-sm')} تأكيد الصفقة وتسديد العمولة</button>` : ''}
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

// ---------- reporting (listings & accounts) — spec Section 10 ----------
let reportTarget = { type: null, id: null, label: '', reason: null };
function openReportListing() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  if (!currentListingDetail) return;
  openReport('listing', currentListingDetail.id, currentListingDetail.title);
}
function openReportAccount() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  if (!currentSellerProfile) return;
  openReport('account', currentSellerProfile.id, currentSellerProfile.full_name);
}
function openReport(type, id, label) {
  reportTarget = { type, id, label, reason: null };
  document.getElementById('report-title').textContent = type === 'listing' ? 'الإبلاغ عن إعلان' : 'الإبلاغ عن حساب';
  document.getElementById('report-subtitle').textContent = label ? `الجهة: ${label}` : '';
  document.getElementById('report-details').value = '';
  document.getElementById('report-other-box').style.display = 'none';
  hideError('report-error');
  renderReportReasons();
  go('report');
}
function renderReportReasons() {
  const reasons = (meta.report_reasons && meta.report_reasons[reportTarget.type]) || [];
  document.getElementById('report-reasons').innerHTML = reasons.map((r) => `
    <div class="reason-row ${reportTarget.reason === r.value ? 'selected' : ''}" onclick="selectReportReason('${r.value}')">
      <span>${escapeHtml(r.label)}</span>
      <div class="reason-radio"></div>
    </div>`).join('');
}
function selectReportReason(value) {
  reportTarget.reason = value;
  renderReportReasons();
  document.getElementById('report-other-box').style.display = value === 'other' ? 'block' : 'none';
}
async function submitReport() {
  hideError('report-error');
  if (!reportTarget.reason) return showError('report-error', 'اختر سبب البلاغ');
  const details = document.getElementById('report-details').value.trim();
  if (reportTarget.reason === 'other' && !details) return showError('report-error', 'اكتب تفاصيل السبب');
  const btn = document.getElementById('report-submit');
  btn.disabled = true;
  try {
    await api('/reports', {
      method: 'POST',
      body: { target_type: reportTarget.type, target_id: reportTarget.id, reason: reportTarget.reason, details },
    });
    toast('تم إرسال البلاغ، شكراً لك');
    goBack();
  } catch (err) {
    showError('report-error', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- deal confirmation & commission settlement — spec Section 11 ----------
let dealContext = null;
function openDealConfirm() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  if (!currentListingDetail || !currentSellerDetail) return;
  dealContext = { listingId: currentListingDetail.id, currency: currentListingDetail.currency };
  document.getElementById('dc-currency').innerHTML = Object.keys(CURRENCY_LABELS_AR)
    .map((c) => `<option value="${c}" ${c === dealContext.currency ? 'selected' : ''}>${CURRENCY_LABELS_AR[c]} (${c})</option>`)
    .join('');
  document.getElementById('dc-amount').value = '';
  document.getElementById('dc-rate-display').textContent = ((meta.commission_rate || 0.025) * 100).toFixed(1) + '%';
  document.getElementById('dc-bank-name').textContent = (meta.bank_account && meta.bank_account.bank_name) || '—';
  document.getElementById('dc-bank-iban').textContent = (meta.bank_account && meta.bank_account.iban) || '—';
  hideError('dc-error');
  recalcCommission();
  go('deal-confirm');
}
function recalcCommission() {
  const amount = Number(document.getElementById('dc-amount').value) || 0;
  const currency = document.getElementById('dc-currency').value;
  const rate = meta.commission_rate || 0.025;
  document.getElementById('dc-amount-display').textContent = amount ? formatPrice(amount, currency) : '—';
  document.getElementById('dc-commission-display').textContent = amount ? formatPrice(amount * rate, currency) : '—';
}
async function copyIban() {
  const iban = ((meta.bank_account && meta.bank_account.iban) || '').replace(/\s/g, '');
  try {
    await navigator.clipboard.writeText(iban);
    toast('تم نسخ رقم الآيبان');
  } catch {
    toast('تعذّر نسخ الآيبان');
  }
}
async function confirmDeal() {
  hideError('dc-error');
  const amount = document.getElementById('dc-amount').value;
  const currency = document.getElementById('dc-currency').value;
  if (!amount || Number(amount) <= 0) return showError('dc-error', 'أدخل مبلغ صفقة صحيح');
  const btn = document.getElementById('dc-submit');
  btn.disabled = true;
  btn.textContent = 'جارِ التأكيد...';
  try {
    await api('/transactions', { method: 'POST', body: { listing_id: dealContext.listingId, deal_amount: amount, currency } });
    toast('تم تأكيد تسديد العمولة، شكراً لأمانتك');
    goBack();
  } catch (err) {
    showError('dc-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'تم التحويل، تأكيد التسديد';
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
  document.getElementById('cl-vehicle-part-year-from').value = '';
  document.getElementById('cl-vehicle-part-year-to').value = '';
  document.getElementById('cl-vehicle-part-model-other').value = '';
  document.getElementById('cl-vehicle-whole-year').value = '';
  document.getElementById('cl-vehicle-whole-damage').value = 'light';
  document.getElementById('cl-vehicle-whole-model-other').value = '';
  document.getElementById('cl-country').value = browsingCountry;
  onCreateCountryChange();
  selectedImages = [];
  renderThumbs();
  hideError('cl-error');

  const heading = document.getElementById('cl-heading');
  const backBtn = document.getElementById('cl-back');
  document.getElementById('cl-block-part-category').style.display = createMode === 'vehicle_whole' ? 'none' : 'block';
  document.getElementById('cl-block-car-compat').style.display = createMode === 'car_part' ? 'block' : 'none';
  document.getElementById('cl-block-vehicle-part-compat').style.display = createMode === 'vehicle_part' ? 'block' : 'none';
  document.getElementById('cl-block-vehicle-whole').style.display = createMode === 'vehicle_whole' ? 'block' : 'none';

  if (createMode === 'vehicle_part' || createMode === 'vehicle_whole') {
    const isWhole = createMode === 'vehicle_whole';
    const label = (meta.vehicle_categories[createVehicleCategory] || {}).label || '';
    heading.textContent = isWhole ? `إضافة ${label} تالفة للبيع` : `إضافة قطعة غيار ${label}`;
    backBtn.onclick = () => go(isWhole ? 'vehicle-whole' : 'vehicle-parts');
    const makeDisplayId = isWhole ? 'cl-vehicle-whole-make-display' : 'cl-vehicle-part-make-display';
    document.getElementById(makeDisplayId).innerHTML = icon(VEHICLE_ICONS[createVehicleCategory], 'icon-sm icon-muted') + ' ' + escapeHtml(createVehicleMake);
    refreshIcons();

    const models = ((meta.vehicle_categories[createVehicleCategory] || {}).models_by_make || {})[createVehicleMake] || [];
    const selectId = isWhole ? 'cl-vehicle-whole-model' : 'cl-vehicle-part-model';
    const select = document.getElementById(selectId);
    const otherInputId = isWhole ? 'cl-vehicle-whole-model-other' : 'cl-vehicle-part-model-other';
    if (models.length) {
      select.style.display = 'block';
      select.innerHTML = (isWhole ? '' : '<option value="">— بدون تحديد —</option>') +
        models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
      document.getElementById(otherInputId).style.display = 'none';
    } else {
      // custom manufacturer -> no known model list, just a free-text field
      select.style.display = 'none';
      select.innerHTML = '';
      document.getElementById(otherInputId).style.display = 'block';
    }
  } else {
    heading.textContent = 'إضافة إعلان قطعة غيار';
    backBtn.onclick = () => go('home');
  }
}
function onVehicleModelChange(mode) {
  const select = document.getElementById(mode === 'part' ? 'cl-vehicle-part-model' : 'cl-vehicle-whole-model');
  const other = document.getElementById(mode === 'part' ? 'cl-vehicle-part-model-other' : 'cl-vehicle-whole-model-other');
  other.style.display = select.value === 'أخرى' ? 'block' : 'none';
}
function getVehicleModelValue(mode) {
  const select = document.getElementById(mode === 'part' ? 'cl-vehicle-part-model' : 'cl-vehicle-whole-model');
  const other = document.getElementById(mode === 'part' ? 'cl-vehicle-part-model-other' : 'cl-vehicle-whole-model-other');
  if (select.style.display === 'none' || select.value === 'أخرى') return other.value.trim();
  return select.value;
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
  const country = document.getElementById('cl-country').value;
  const city = document.getElementById('cl-city').value;

  const fd = new FormData();
  fd.append('title', title);
  fd.append('price', price);
  fd.append('country', country);
  fd.append('city', city);
  fd.append('description', document.getElementById('cl-desc').value.trim());

  if (createMode === 'vehicle_part' || createMode === 'vehicle_whole') {
    const isWhole = createMode === 'vehicle_whole';
    const model = getVehicleModelValue(isWhole ? 'whole' : 'part');
    fd.append('category', createVehicleCategory);
    fd.append('listing_type', isWhole ? 'whole' : 'part');
    fd.append('compatible_make', createVehicleMake);
    fd.append('compatible_model', model);

    if (isWhole) {
      const year = document.getElementById('cl-vehicle-whole-year').value;
      if (!title || !price || !city || !model || !year) {
        return showError('cl-error', 'عنوان الإعلان والسعر والمدينة والموديل وسنة الصنع مطلوبة');
      }
      fd.append('compatible_year_from', year);
      fd.append('damage_severity', document.getElementById('cl-vehicle-whole-damage').value);
    } else {
      const part_category = document.getElementById('cl-part-category').value;
      if (!title || !price || !city || !part_category) {
        return showError('cl-error', 'عنوان الإعلان والسعر والمدينة وفئة القطعة مطلوبة');
      }
      fd.append('part_category', part_category);
      fd.append('compatible_year_from', document.getElementById('cl-vehicle-part-year-from').value);
      fd.append('compatible_year_to', document.getElementById('cl-vehicle-part-year-to').value);
    }
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
    if (createMode === 'vehicle_part') go('vehicle-parts');
    else if (createMode === 'vehicle_whole') go('vehicle-whole');
    else go('home');
  } catch (err) {
    showError('cl-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'نشر الإعلان';
  }
}

// ---------- seller profile ----------
let currentSellerProfile = null;
async function openSeller(id) {
  go('seller');
  const body = document.getElementById('seller-body');
  const listingsEl = document.getElementById('seller-listings');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  listingsEl.innerHTML = '';
  try {
    const { seller, listings } = await api('/users/' + id + '/public');
    currentSellerProfile = seller;
    body.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="avatar" style="width:48px; height:48px; font-size:var(--fs-base);">${initials(seller.full_name)}</div>
          <div>
            <p style="font-size:var(--fs-base); font-weight:700; display:flex; align-items:center; gap:6px;">${escapeHtml(seller.full_name)} ${seller.is_verified_trader ? `<span class="badge badge-success">${icon('badge-check')} موثّق</span>` : ''}</p>
            <p class="muted">${seller.account_type === 'trader' ? 'تشليح / تاجر' : 'فرد / مشتري'}</p>
          </div>
        </div>
        <button class="btn-ghost" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px;" title="إبلاغ عن الحساب" onclick="openReportAccount()">${icon('flag', 'icon-sm')}</button>
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
      ? listings.map((l) => listingCard(l, { showStatus: true, showActions: true })).join('')
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
const REPORT_STATUS_LABELS = { pending: 'قيد المراجعة', reviewed: 'تمت المراجعة', resolved: 'تم الحل' };
const REPORT_REASON_LABEL_MAP = {}; // filled lazily from meta.report_reasons on first admin render
function reportReasonLabel(reason) {
  if (!Object.keys(REPORT_REASON_LABEL_MAP).length) {
    [...(meta.report_reasons.listing || []), ...(meta.report_reasons.account || [])]
      .forEach((r) => { REPORT_REASON_LABEL_MAP[r.value] = r.label; });
  }
  return REPORT_REASON_LABEL_MAP[reason] || reason;
}
async function renderAdmin() {
  if (!currentUser || !currentUser.is_admin) { toast('صلاحية مسؤول مطلوبة'); return go('profile'); }
  const statsEl = document.getElementById('admin-stats');
  const reportsEl = document.getElementById('admin-reports');
  const usersEl = document.getElementById('admin-users');
  statsEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  reportsEl.innerHTML = '';
  usersEl.innerHTML = '';
  try {
    const stats = await api('/admin/stats');
    statsEl.innerHTML = `
      <h3 style="font-size:var(--fs-base); font-weight:700; margin-bottom:12px;">إحصائيات سريعة</h3>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:8px;"><span class="muted">مستخدمون نشطون</span><span style="font-weight:600;">${stats.active_users_count}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:8px;"><span class="muted">إعلانات اليوم</span><span style="font-weight:600;">${stats.listings_posted_today}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm);"><span class="muted">إجمالي الإعلانات النشطة</span><span style="font-weight:600;">${stats.active_listings_count}</span></div>
    `;

    const { reports } = await api('/admin/reports?status=pending');
    reportsEl.innerHTML = '<h3 style="font-size:var(--fs-base); font-weight:700; margin-bottom:12px;">بلاغات قيد المراجعة</h3>' + (reports.length
      ? reports.map((r) => `
        <div class="settings-row" style="align-items:flex-start;">
          <span class="badge ${r.target_type === 'listing' ? 'badge-warning' : 'badge-danger'}" style="margin-top:2px;">${r.target_type === 'listing' ? 'إعلان' : 'حساب'}</span>
          <span>
            <b>${escapeHtml(r.target_label || '—')}</b><br>
            <span class="muted">${escapeHtml(reportReasonLabel(r.reason))}${r.details ? ' — ' + escapeHtml(r.details) : ''}</span><br>
            <span class="muted" style="font-size:var(--fs-xs);">بلّغ عنه: ${escapeHtml(r.reporter_name)}</span>
          </span>
          <button class="btn-ghost" style="border:1px solid var(--border);" onclick="resolveReport('${r.id}')">حل البلاغ</button>
        </div>
      `).join('')
      : '<p class="muted">لا توجد بلاغات قيد المراجعة</p>');

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
async function resolveReport(id) {
  try {
    await api('/admin/reports/' + id + '/status', { method: 'PATCH', body: { status: 'resolved' } });
    toast('تم تحديث حالة البلاغ');
    renderAdmin();
  } catch (err) {
    toast(err.message);
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
