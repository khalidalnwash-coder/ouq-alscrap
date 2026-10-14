// ---------- state ----------
let history_ = ['landing'];
let signupData = null; // collected on signup form submit, sent to API once OTP channel is chosen
let pendingUserId = null; // user id awaiting OTP verification
let chosenOtpMethod = 'whatsapp';
let chosenFpMethod = 'whatsapp';
let fpUserId = null;
let currentUser = null;
let meta = { countries: [], cities_by_country: {}, part_categories: [], vehicle_categories: {}, report_reasons: { listing: [], account: [] }, support_issue_types: [], commission_rate: 0.025, bank_account: null, contact: null };
const COUNTRY_KEY = 'alscrap_country';
// '' means "كل الدول" (browsing/searching across every GCC country) — an
// explicit, intentional choice, so a stored '' must NOT fall back to 'SA'
// the way a genuinely-missing key does (hence the !== null check, not ||).
const storedBrowsingCountry = localStorage.getItem(COUNTRY_KEY);
let browsingCountry = storedBrowsingCountry !== null ? storedBrowsingCountry : 'SA';
let selectedPartCategory = '';
let selectedSearchYear = '';
let selectedSearchCity = null; // null = not yet defaulted to the user's own city this session
let selectedVehicleCity = '';
let searchDebounceTimer = null;
let currentListingId = null;
let selectedImages = []; // File[] for create-listing

// "Vehicle sections" — motorcycles / full cars / trucks, all sharing the
// same screens (screen-vehicle-makes/browse), driven by vehicleCategory.
// screen-vehicle-browse has two tabs ("قطع غيار" | "[نوع] كاملة") that swap
// content in place — no separate choice screen or back-navigation between
// them. Unrelated to the plain, manufacturer-optional "قطع غيار" (spare_part)
// flow reachable from the home search bar, which stays exactly as it was.
let vehicleCategory = null; // 'motorcycle' | 'full_car' | 'truck'
let vehicleContext = { make: null };
let selectedVehiclePartCategory = '';
let vehiclePartsDebounceTimer = null;
let selectedVehiclePartsModel = '';
let selectedVehicleWholeModel = '';
let selectedVehiclePartsYear = '';
let selectedVehicleWholeYear = '';
let createMode = 'car_part'; // 'car_part' | 'vehicle_part' | 'vehicle_whole' — which shape screen-create renders
let createVehicleCategory = null;
let createVehicleMake = null;

const TOKEN_KEY = 'alscrap_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

// ---------- theme (light / dark / auto) ----------
const THEME_KEY = 'alscrap_theme';
let themePreference = localStorage.getItem(THEME_KEY) || 'auto';
const darkMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme() {
  const resolved = themePreference === 'auto'
    ? ((darkMediaQuery && darkMediaQuery.matches) ? 'dark' : 'light')
    : themePreference;
  document.documentElement.setAttribute('data-theme', resolved);
  const rows = document.querySelectorAll('#theme-toggle .toggle-opt');
  rows.forEach((el) => el.classList.toggle('selected', el.dataset.theme === themePreference));
}
function setThemePreference(value) {
  themePreference = value;
  localStorage.setItem(THEME_KEY, value);
  applyTheme();
}
if (darkMediaQuery) {
  darkMediaQuery.addEventListener('change', () => { if (themePreference === 'auto') applyTheme(); });
}
applyTheme();

// ---------- PWA: service worker registration + auto-update ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Browsers only re-check an installed service worker for changes
      // every so often on their own (roughly once a day) — asking directly
      // whenever the app regains focus gets a waiting update noticed, and
      // therefore installed, much sooner.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
  // clients.claim() in sw.js means controllerchange also fires the very
  // first time a worker ever activates for this page (no controller yet ->
  // now controlled) — that's not an update, just the normal first install,
  // and must NOT trigger a reload. Only a SECOND controllerchange (this
  // page already had a controller, and a newer worker just replaced it) is
  // a real update, and that's the one worth reloading for so the user
  // actually runs the new code instead of being stuck on the old one.
  let hadControllerOnLoad = !!navigator.serviceWorker.controller;
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerOnLoad) {
      hadControllerOnLoad = true;
      return;
    }
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
}

// ---------- PWA: "add to home screen" hint (iOS) / install banner (Android) ----------
const PWA_HINT_DISMISSED_KEY = 'alscrap_pwa_hint_dismissed';
let deferredInstallPrompt = null;

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ reports as a Mac
}
function isStandalonePwa() {
  return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function showPwaHint(kind) {
  if (localStorage.getItem(PWA_HINT_DISMISSED_KEY) || isStandalonePwa()) return;
  document.getElementById('pwa-hint-icon-ios').style.display = kind === 'ios' ? '' : 'none';
  document.getElementById('pwa-hint-icon-android').style.display = kind === 'android' ? '' : 'none';
  document.getElementById('pwa-hint-install-btn').style.display = kind === 'android' ? '' : 'none';
  document.getElementById('pwa-hint-text').textContent = kind === 'ios'
    ? 'لإضافة تشليح الخليج للشاشة الرئيسية: اضغط زر المشاركة، ثم "إضافة إلى الشاشة الرئيسية"'
    : 'ثبّت تشليح الخليج على جهازك لوصول أسرع';
  document.getElementById('pwa-hint').style.display = 'flex';
  document.getElementById('app').style.paddingTop = '54px';
  refreshIcons();
}
function dismissPwaHint() {
  localStorage.setItem(PWA_HINT_DISMISSED_KEY, '1');
  document.getElementById('pwa-hint').style.display = 'none';
  document.getElementById('app').style.paddingTop = '';
}
async function installPwa() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dismissPwaHint();
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showPwaHint('android');
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  dismissPwaHint();
});
if (isIosDevice() && !isStandalonePwa()) {
  showPwaHint('ios');
}

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
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload });
  } catch {
    // fetch() itself rejects (network drop, timeout, server unreachable)
    // before any HTTP response exists — the browser's own message here
    // (e.g. Safari's "Load failed") is not something a user can act on.
    throw new Error('تعذّر الاتصال بالخادم، تحقق من اتصال الإنترنت وحاول مرة أخرى');
  }
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

  const navScreens = ['home', 'search', 'create', 'profile', 'messages'];
  document.getElementById('navbar').style.display = navScreens.includes(id) ? 'flex' : 'none';
  document.querySelectorAll('.nav-item[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === id);
  });

  if (id === 'home') renderHome();
  if (id === 'search') renderSearch();
  if (id === 'create') prepareCreateScreen();
  if (id === 'profile') renderProfile();
  if (id === 'admin') renderAdmin();
  if (id === 'admin-user') renderAdminUserDetail(adminUserId);
  if (id === 'my-listings') renderMyListings();
  if (id === 'vehicle-makes') renderVehicleMakes();
  if (id === 'vehicle-browse') renderVehicleBrowse();
  if (id === 'messages') renderMessagesList();
  if (id === 'privacy') renderPrivacyPolicy();
  if (id === 'terms-view') renderTermsView();
  if (id === 'edit-profile') renderEditProfile();
  if (id === 'change-password') renderChangePassword();
  if (id === 'support') renderSupport();
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
    meta = { countries: [], cities_by_country: {}, part_categories: [], vehicle_categories: {}, report_reasons: { listing: [], account: [] }, support_issue_types: [], commission_rate: 0.025, bank_account: null, contact: null };
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
function countryByPhoneCode(phoneCode) {
  return meta.countries.find((c) => c.phone_code === phoneCode) || null;
}
// Shared by every city filter (search, vehicle sections): a "كل المدن"
// option followed by the given country's cities, with one pre-selected.
function cityFilterOptionsHtml(country, selectedCity) {
  const cities = meta.cities_by_country[country] || [];
  return '<option value="">كل المدن</option>' + cities.map((c) => `<option ${c === selectedCity ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
// The logged-in user's own city, if they have one set and it belongs to
// the given country's city list — used to pre-select a browse filter.
function userDefaultCity(country) {
  return currentUser && currentUser.city && (meta.cities_by_country[country] || []).includes(currentUser.city) ? currentUser.city : '';
}
// Shared empty-results state for every filterable results grid (search,
// vehicle sections). When a city and/or a specific country narrowed the
// search to zero results, offers one-click buttons to widen it; otherwise
// (already "كل الدول" with no narrower filter to drop) falls back to the
// screen's own plain empty message.
function noResultsHtml(hasCity, hasCountry, widenCityCall, widenCountryCall, fallbackMessage) {
  if (!hasCity && !hasCountry) return `<p class="muted" style="grid-column:1/-1;">${escapeHtml(fallbackMessage)}</p>`;
  const cityBtn = hasCity
    ? `<button class="btn-outline" style="width:auto; padding:9px 16px;" onclick="${widenCityCall}">ابحث في كل مدن الدولة</button>`
    : '';
  const countryBtn = hasCountry
    ? `<button class="btn-outline" style="width:auto; padding:9px 16px;" onclick="${widenCountryCall}">ابحث في كل الدول</button>`
    : '';
  return `<div class="muted" style="grid-column:1/-1; text-align:center; padding:20px 0;">
    <p style="margin-bottom:14px;">ما لقينا نتائج هنا</p>
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">${cityBtn}${countryBtn}</div>
  </div>`;
}
function countryOptionsHtml(selectedCode) {
  return meta.countries
    .map((c) => `<option value="${c.code}" ${c.code === selectedCode ? 'selected' : ''}>${c.flag} ${escapeHtml(c.label)}</option>`)
    .join('');
}
// Same list, but with a "كل الدول" option first — only for the browsing
// selectors (home/search), never for signup or create-listing, which must
// always have one specific real country.
function browsingCountryOptionsHtml(selectedCode) {
  return `<option value="" ${selectedCode === '' ? 'selected' : ''}>كل الدول</option>` + countryOptionsHtml(selectedCode);
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
  // Country changed, so a previously-picked (or auto-defaulted) city no
  // longer applies — clear it back to "كل المدن".
  selectedSearchCity = '';
  const activeId = document.querySelector('.screen.active').id;
  if (activeId === 'screen-home') renderHome();
  if (activeId === 'screen-search') renderSearch();
}
function onSignupCountryChange() {
  const country = document.getElementById('su-country').value;
  document.getElementById('su-code').value = countryInfo(country).phone_code;
  // Country changed, so any previously-picked city (belonging to the old
  // country) is no longer valid — clear it along with repopulating the list.
  const cities = meta.cities_by_country[country] || [];
  document.getElementById('su-city').innerHTML =
    '<option value="">— بدون تحديد —</option>' + cities.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
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

// Year-of-manufacture pickers (create-listing form) — a select, not free
// text, so the value is always a real valid year. Newest first; 1980 covers
// the oldest wrecks/parts realistically listed.
const CURRENT_YEAR = new Date().getFullYear();
const MIN_LISTING_YEAR = 1980;
function yearOptionsHtml(selectedValue, { required = false } = {}) {
  const placeholder = required
    ? '<option value="" disabled selected>اختر السنة</option>'
    : '<option value="">— اختياري —</option>';
  let html = placeholder;
  for (let y = CURRENT_YEAR + 1; y >= MIN_LISTING_YEAR; y--) {
    html += `<option value="${y}" ${String(y) === String(selectedValue) ? 'selected' : ''}>${y}</option>`;
  }
  return html;
}
// Same year range, but as a search/browse filter ("كل السنوات" instead of
// an "اختياري" placeholder) — used on the search and vehicle-section
// browse screens so customers can narrow results by year of manufacture.
function yearFilterOptionsHtml(selectedValue) {
  let html = `<option value="">كل السنوات</option>`;
  for (let y = CURRENT_YEAR + 1; y >= MIN_LISTING_YEAR; y--) {
    html += `<option value="${y}" ${String(y) === String(selectedValue) ? 'selected' : ''}>${y}</option>`;
  }
  return html;
}
function populateYearFilter(selectId, selectedValue) {
  document.getElementById(selectId).innerHTML = yearFilterOptionsHtml(selectedValue);
}

function populateMetaSelects() {
  document.getElementById('su-country').innerHTML = countryOptionsHtml(browsingCountry);
  document.getElementById('su-code').innerHTML = phoneCodeOptionsHtml(countryInfo(browsingCountry)?.phone_code);
  onSignupCountryChange();
  document.getElementById('cl-country').innerHTML = countryOptionsHtml(browsingCountry);
  document.getElementById('home-country').innerHTML = browsingCountryOptionsHtml(browsingCountry);
  document.getElementById('search-country').innerHTML = browsingCountryOptionsHtml(browsingCountry);
  onCreateCountryChange();

  const partCat = document.getElementById('cl-part-category');
  partCat.innerHTML = meta.part_categories.map((c) => `<option>${c}</option>`).join('');

  populateContactInfo();
}

// Official email/WhatsApp number — single source of truth is CONTACT in
// server/src/utils/constants.js (served via meta.contact); every place that
// shows or links to them (support screen, privacy policy) reads from here
// instead of hardcoding the values, so changing them means editing one place.
function populateContactInfo() {
  const c = meta.contact;
  if (!c) return;

  const supportEmailDisplay = document.getElementById('support-email-display');
  if (supportEmailDisplay) supportEmailDisplay.textContent = c.email;
  const supportWhatsappDisplay = document.getElementById('support-whatsapp-display');
  if (supportWhatsappDisplay) supportWhatsappDisplay.textContent = c.phone_display;
  const supportWhatsappBtn = document.getElementById('support-whatsapp-btn');
  if (supportWhatsappBtn) supportWhatsappBtn.href = `https://wa.me/${c.whatsapp_digits}`;
  const supportEmailBtn = document.getElementById('support-email-btn');
  if (supportEmailBtn) supportEmailBtn.href = `mailto:${c.email}`;

  const privacyDpoEmail = document.getElementById('privacy-dpo-email');
  if (privacyDpoEmail) privacyDpoEmail.textContent = c.email;
  const privacySupportEmail = document.getElementById('privacy-support-email');
  if (privacySupportEmail) privacySupportEmail.textContent = c.email;
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
  const city = document.getElementById('su-city').value;
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
  signupData = { full_name, account_type: accountType, country, city: city || undefined, phone_country_code, phone_number, email, age, password, pledge_accepted };
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
    toast('تم إرسال كود التحقق');
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
    await api('/auth/otp/resend', { method: 'POST', body: { user_id: pendingUserId } });
    toast('تم إعادة إرسال الكود');
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

// Privacy policy "آخر تحديث" date — today's date as a readable stand-in
// until this page gets real versioning; see the placeholder notes inside
// #screen-privacy itself for the other fields that still need filling in.
const PRIVACY_POLICY_LAST_UPDATED = new Date();
function renderPrivacyPolicy() {
  document.getElementById('privacy-updated-date').textContent = PRIVACY_POLICY_LAST_UPDATED.toLocaleDateString('ar');
}

// Terms & conditions "آخر تحديث" date — same reasoning as the privacy
// policy's date above.
const TERMS_LAST_UPDATED = new Date();
function renderTermsView() {
  document.getElementById('terms-updated-date').textContent = TERMS_LAST_UPDATED.toLocaleDateString('ar');
}

// Self-service account deletion (right to erasure) — irreversible, so it
// goes through two confirmations: a plain-language warning, then the
// current password as re-authentication (same reasoning a bank-grade
// destructive action would use), before the server deletes anything.
async function deleteAccount() {
  if (!confirm('هل أنت متأكد أنك تريد حذف حسابك نهائياً؟ سيُحذف حسابك وكل إعلاناتك وصورك ومقاطع الفيديو الخاصة بك بشكل نهائي، ولا يمكن التراجع عن هذا الإجراء.')) {
    return;
  }
  const password = prompt('لتأكيد الحذف، أدخل كلمة المرور الحالية:');
  if (!password) return;
  try {
    await api('/auth/me', { method: 'DELETE', body: { password } });
    setToken(null);
    currentUser = null;
    toast('تم حذف حسابك نهائياً');
    go('landing');
  } catch (err) {
    toast(err.message);
  }
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
    toast('تم إرسال الكود');
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

// Fallback for a listing photo that fails to load (e.g. an old Render-local
// upload from before Cloudinary was wired up, now gone) — swap it for the
// same "box" placeholder already used for a listing with no photo at all,
// instead of the browser's broken-image icon.
function handleImgError(imgEl) {
  const div = document.createElement('div');
  div.style.cssText = 'width:100%; height:100%; display:flex; align-items:center; justify-content:center;';
  div.innerHTML = icon('package', imgEl.dataset.fallbackSize || 'icon-lg');
  imgEl.replaceWith(div);
  refreshIcons();
}
function imgWithFallback(url, { style = '', fallbackSize = 'icon-lg' } = {}) {
  return `<img src="${escapeHtml(url)}" alt="" style="${style}" data-fallback-size="${fallbackSize}" onerror="handleImgError(this)">`;
}
// Same idea as handleImgError, for a <video> whose source fails to load —
// the browser's own broken-video box (a black rectangle with a "no video"
// icon) is replaced with the same "box" placeholder used everywhere else.
function handleVideoError(videoEl) {
  const div = document.createElement('div');
  div.style.cssText = 'width:100%; height:100%; display:flex; align-items:center; justify-content:center;';
  div.innerHTML = icon('package', videoEl.dataset.fallbackSize || 'icon-lg');
  videoEl.replaceWith(div);
  refreshIcons();
}

// ---------- listing cards ----------
const LISTING_STATUS_LABELS = { active: 'نشط', archived: 'مؤرشف', sold: 'مباع' };
const BUMP_COOLDOWN_HOURS = 24;
const ARCHIVE_WARNING_DAYS = 45;
const ARCHIVE_DAYS = 60;
function listingCard(l, opts = {}) {
  const thumb = l.thumbnail_url
    ? imgWithFallback(l.thumbnail_url)
    : icon('package', 'icon-lg');
  const statusBadge = opts.showStatus
    ? `<div class="badge ${l.status === 'active' ? 'badge-success' : 'badge-warning'}" style="margin-top:6px;">${escapeHtml(LISTING_STATUS_LABELS[l.status] || l.status)}</div>`
    : '';

  let actionsHtml = '';
  if (opts.showActions) {
    const ownerButtons = `
      <div style="display:flex; gap:6px; margin-top:4px;">
        <button class="btn-ghost card-action-btn" style="flex:1;" onclick="event.stopPropagation(); openEditListing('${l.id}')">${icon('pencil', 'icon-xs')} تعديل</button>
        <button class="btn-ghost card-action-btn" style="flex:1; color:var(--danger);" onclick="event.stopPropagation(); deleteListing('${l.id}')">${icon('trash-2', 'icon-xs')} حذف</button>
      </div>`;
    if (l.status === 'active') {
      const hoursSince = (Date.now() - new Date(l.last_updated_at).getTime()) / 3600000;
      const daysSince = Math.floor(hoursSince / 24);
      const canBump = hoursSince >= BUMP_COOLDOWN_HOURS;
      const warnHtml = daysSince >= ARCHIVE_WARNING_DAYS
        ? `<div class="muted" style="font-size:var(--fs-xs); color:var(--warning); margin-top:4px; display:flex; align-items:center; gap:3px;">${icon('alert-triangle', 'icon-xs')} سيُؤرشف خلال ${Math.max(ARCHIVE_DAYS - daysSince, 0)} يوم</div>`
        : '';
      actionsHtml = `${warnHtml}
        <button class="btn-ghost card-action-btn" ${canBump ? '' : 'disabled'} onclick="event.stopPropagation(); bumpListing('${l.id}')">
          ${canBump ? 'حدّث الآن' : `متاح بعد ${Math.max(Math.ceil(BUMP_COOLDOWN_HOURS - hoursSince), 0)} س`}
        </button>
        ${ownerButtons}`;
    } else if (l.status === 'archived') {
      actionsHtml = `<button class="btn-ghost card-action-btn" style="color:var(--blue);" onclick="event.stopPropagation(); restoreListing('${l.id}')">${icon('rotate-ccw', 'icon-xs')} استرجاع</button>${ownerButtons}`;
    } else {
      actionsHtml = ownerButtons;
    }
  }

  // Shown on every card — not just when browsing "كل الدول" — so a buyer
  // always knows which GCC country a listing is in, not only its city.
  const flag = countryInfo(l.country)?.flag || '';
  return `<div class="listing-card" onclick="openDetail('${l.id}')">
    <div class="listing-thumb">${thumb}</div>
    <div class="listing-info">
      <div class="title">${escapeHtml(l.title)}</div>
      <div class="price">${formatPrice(l.price, l.currency)}</div>
      <div class="loc">${icon('map-pin')} ${flag ? flag + ' ' : ''}${escapeHtml(l.city)}</div>
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
async function deleteListing(id) {
  if (!confirm('هل أنت متأكد من حذف الإعلان؟')) return;
  try {
    await api('/listings/' + id, { method: 'DELETE' });
    toast('تم حذف الإعلان');
    if (document.querySelector('.screen.active').id === 'screen-detail') {
      goBack();
    } else {
      renderMyListings();
    }
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
function widenHomeToAllCountries() {
  setBrowsingCountry('');
  renderHome();
}
async function renderHome() {
  document.getElementById('home-country').value = browsingCountry;
  const el = document.getElementById('home-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?country=' + encodeURIComponent(browsingCountry));
    el.innerHTML = listings.length
      ? listings.slice(0, 6).map(listingCard).join('')
      : noResultsHtml(false, !!browsingCountry, '', 'widenHomeToAllCountries()', 'لا توجد إعلانات بعد');
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
  selectedSearchYear = '';
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
function populateSearchCityFilter() {
  const citySelect = document.getElementById('search-city');
  if (!browsingCountry) {
    // "كل الدول" selected — a single city doesn't apply across multiple
    // countries, so the city filter is hidden entirely rather than shown
    // empty or disabled.
    selectedSearchCity = '';
    citySelect.style.display = 'none';
    citySelect.innerHTML = '';
    return;
  }
  citySelect.style.display = '';
  // Only the very first time this screen is populated in a session, default
  // to the user's own city (if it belongs to the current country) — after
  // that, whatever is selected (by the user, or cleared by a country
  // change) is left alone.
  if (selectedSearchCity === null) selectedSearchCity = userDefaultCity(browsingCountry);
  citySelect.innerHTML = cityFilterOptionsHtml(browsingCountry, selectedSearchCity);
}
function onSearchCityChange() {
  selectedSearchCity = document.getElementById('search-city').value;
  renderSearch();
}
function widenSearchCityToCountry() {
  selectedSearchCity = '';
  renderSearch();
}
function widenSearchToAllCountries() {
  setBrowsingCountry('');
  selectedSearchCity = '';
  renderSearch();
}
async function renderSearch() {
  document.getElementById('search-country').value = browsingCountry;
  populateSearchCityFilter();
  renderCatStrip();
  document.getElementById('cat-name').textContent = selectedPartCategory || 'الكل';
  const q = document.getElementById('search-q').value.trim();
  selectedSearchYear = document.getElementById('search-year-filter').value;
  populateYearFilter('search-year-filter', selectedSearchYear);
  const params = new URLSearchParams({ country: browsingCountry });
  if (q) params.set('q', q);
  if (selectedPartCategory) params.set('part_category', selectedPartCategory);
  if (selectedSearchYear) params.set('year', selectedSearchYear);
  if (selectedSearchCity) params.set('city', selectedSearchCity);

  const el = document.getElementById('search-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('cat-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length
      ? listings.map(listingCard).join('')
      : noResultsHtml(!!selectedSearchCity, !!browsingCountry, 'widenSearchCityToCountry()', 'widenSearchToAllCountries()', 'لا توجد نتائج بعد');
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
  vehicleTab = 'part';
  go('vehicle-browse');
}
// One screen, two tabs ("قطع غيار" | "[نوع] كاملة") — switching just toggles
// which content block is visible and (re)loads its listings; no navigation.
let vehicleTab = 'part'; // 'part' | 'whole'
function renderVehicleBrowse() {
  const plural = VEHICLE_PLURALS[vehicleCategory];
  const make = vehicleContext.make;
  document.getElementById('vehicle-browse-title').textContent = plural + ' ' + make;
  document.getElementById('vtab-btn-whole').textContent = plural + ' كاملة';
  document.getElementById('vehicle-whole-create-link').textContent = '+ نشر ' + currentVehicleMeta().label + ' للبيع';
  selectedVehiclePartCategory = '';
  selectedVehiclePartsModel = '';
  selectedVehicleWholeModel = '';
  selectedVehiclePartsYear = '';
  selectedVehicleWholeYear = '';
  // Starts from the user's own city every time a vehicle section/make is
  // (re)entered — same "fresh start" treatment as the other filters above.
  selectedVehicleCity = userDefaultCity(browsingCountry);
  document.getElementById('vehicle-parts-q').value = '';
  switchVehicleTab(vehicleTab);
}
function populateVehicleCityFilter() {
  const citySelect = document.getElementById('vehicle-city-filter');
  if (!browsingCountry) {
    // "كل الدول" selected — same reasoning as populateSearchCityFilter.
    selectedVehicleCity = '';
    citySelect.style.display = 'none';
    citySelect.innerHTML = '';
    return;
  }
  citySelect.style.display = '';
  citySelect.innerHTML = cityFilterOptionsHtml(browsingCountry, selectedVehicleCity);
}
function onVehicleCityChange() {
  selectedVehicleCity = document.getElementById('vehicle-city-filter').value;
  if (vehicleTab === 'part') renderVehicleParts(); else renderVehicleWhole();
}
function widenVehicleCityToCountry() {
  selectedVehicleCity = '';
  if (vehicleTab === 'part') renderVehicleParts(); else renderVehicleWhole();
}
function widenVehicleToAllCountries() {
  setBrowsingCountry('');
  selectedVehicleCity = '';
  if (vehicleTab === 'part') renderVehicleParts(); else renderVehicleWhole();
}
function switchVehicleTab(tab) {
  vehicleTab = tab;
  document.getElementById('vtab-btn-part').classList.toggle('active', tab === 'part');
  document.getElementById('vtab-btn-whole').classList.toggle('active', tab === 'whole');
  document.getElementById('vehicle-tab-part').style.display = tab === 'part' ? 'block' : 'none';
  document.getElementById('vehicle-tab-whole').style.display = tab === 'whole' ? 'block' : 'none';
  if (tab === 'part') renderVehicleParts(); else renderVehicleWhole();
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
  populateVehicleCityFilter();
  renderVehiclePartsCatStrip();
  selectedVehiclePartsModel = document.getElementById('vehicle-parts-model-filter').value;
  populateModelFilter('vehicle-parts-model-filter', selectedVehiclePartsModel);
  selectedVehiclePartsYear = document.getElementById('vehicle-parts-year-filter').value;
  populateYearFilter('vehicle-parts-year-filter', selectedVehiclePartsYear);
  const q = document.getElementById('vehicle-parts-q').value.trim();
  const params = new URLSearchParams({ category: vehicleCategory, listing_type: 'part', make: vehicleContext.make, country: browsingCountry });
  if (q) params.set('q', q);
  if (selectedVehiclePartCategory) params.set('part_category', selectedVehiclePartCategory);
  if (selectedVehiclePartsModel) params.set('model', selectedVehiclePartsModel);
  if (selectedVehiclePartsYear) params.set('year', selectedVehiclePartsYear);
  if (selectedVehicleCity) params.set('city', selectedVehicleCity);

  const el = document.getElementById('vehicle-parts-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('vehicle-parts-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length
      ? listings.map(listingCard).join('')
      : noResultsHtml(!!selectedVehicleCity, !!browsingCountry, 'widenVehicleCityToCountry()', 'widenVehicleToAllCountries()', 'لا توجد قطع بعد');
    refreshIcons();
  } catch {
    el.innerHTML = '<p class="muted" style="grid-column:1/-1;">تعذّر تحميل القطع</p>';
  }
}
async function renderVehicleWhole() {
  populateVehicleCityFilter();
  selectedVehicleWholeModel = document.getElementById('vehicle-whole-model-filter').value;
  populateModelFilter('vehicle-whole-model-filter', selectedVehicleWholeModel);
  selectedVehicleWholeYear = document.getElementById('vehicle-whole-year-filter').value;
  populateYearFilter('vehicle-whole-year-filter', selectedVehicleWholeYear);
  const params = new URLSearchParams({ category: vehicleCategory, listing_type: 'whole', make: vehicleContext.make, country: browsingCountry });
  if (selectedVehicleWholeModel) params.set('model', selectedVehicleWholeModel);
  if (selectedVehicleWholeYear) params.set('year', selectedVehicleWholeYear);
  if (selectedVehicleCity) params.set('city', selectedVehicleCity);

  const el = document.getElementById('vehicle-whole-listings');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listings } = await api('/listings?' + params.toString());
    document.getElementById('vehicle-whole-count').textContent = listings.length + ' نتيجة';
    el.innerHTML = listings.length
      ? listings.map(listingCard).join('')
      : noResultsHtml(!!selectedVehicleCity, !!browsingCountry, 'widenVehicleCityToCountry()', 'widenVehicleToAllCountries()', 'لا توجد مركبات معروضة بعد');
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
// Order (spec): العنوان -> المدينة + وقت النشر -> اسم البائع -> [سعر/تفاصيل] ->
// الوصف -> الصور ثم الفيديو (كلها ظاهرة معاً بالتمرير، بدون تبويبات تبديل)
// -> زر تواصل (اتصال / رسالة خاصة).
let currentListingDetail = null;
let currentSellerDetail = null;

function renderDetailMedia(media) {
  if (!media.length) {
    return `<div class="listing-thumb" style="height:220px; border-radius:var(--radius-sm); margin-bottom:8px;">${icon('image', 'icon-xl')}</div>`;
  }
  const images = media.filter((m) => m.type === 'image');
  const video = media.find((m) => m.type === 'video');
  let html = images
    .map((m) => `<div class="listing-thumb" style="height:220px; border-radius:var(--radius-sm); margin-bottom:8px;">${imgWithFallback(m.url, { style: 'width:100%; height:100%; object-fit:cover;', fallbackSize: 'icon-xl' })}</div>`)
    .join('');
  if (video) {
    html += `<div class="listing-thumb" style="height:220px; border-radius:var(--radius-sm); margin-bottom:8px;"><video src="${escapeHtml(video.url)}" controls data-fallback-size="icon-xl" onerror="handleVideoError(this)" style="width:100%; height:100%; object-fit:cover;"></video></div>`;
  }
  return html;
}
function callSeller() {
  if (currentSellerDetail && currentSellerDetail.phone) {
    window.location.href = 'tel:' + currentSellerDetail.phone;
  }
}

async function openDetail(id) {
  currentListingId = id;
  go('detail');
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { listing, seller, similar_listings } = await api('/listings/' + id);
    currentListingDetail = listing;
    currentSellerDetail = seller;
    const isOwnListing = currentUser && seller && currentUser.id === seller.id;
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

    const contactRow = isOwnListing ? `
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <button class="btn-outline" style="flex:1;" onclick="openEditListing('${listing.id}')">${icon('pencil', 'icon-sm')} تعديل الإعلان</button>
        <button class="btn-outline" style="flex:1; color:var(--danger); border-color:var(--danger);" onclick="deleteListing('${listing.id}')">${icon('trash-2', 'icon-sm')} حذف</button>
      </div>` : `
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        ${seller.phone ? `<button class="btn-primary" style="flex:1;" onclick="callSeller()">${icon('phone', 'icon-sm')} اتصال</button>` : ''}
        <button class="btn-${seller.phone ? 'outline' : 'primary'}" style="flex:1;" onclick="openConversationFromListing()">${icon('message-circle', 'icon-sm')} رسالة خاصة</button>
        <button class="btn-ghost" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:11px; flex-shrink:0;" title="إبلاغ عن الإعلان" onclick="openReportListing()">${icon('flag', 'icon-sm')}</button>
      </div>`;

    // Two reusable column classes (detail-info-col appears twice, in its
    // exact original positions either side of the media block) — on mobile
    // #detail-body stays display:block, so this wrapping changes nothing
    // visually there; only the ≥1024px CSS Grid rule (styles.css) places
    // every .detail-info-col into one column and .detail-media-col into the
    // other, for the side-by-side layout on tablets/laptops.
    body.innerHTML = `
      <div class="detail-info-col">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
        <h3 style="font-size:var(--fs-md); font-weight:700;">${escapeHtml(listing.title)}</h3>
        ${topBadge}
      </div>
      <p class="muted" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">${icon('map-pin', 'icon-xs')} ${escapeHtml(listing.city)}${countryInfo(listing.country) ? `، ${countryInfo(listing.country).flag} ${escapeHtml(countryInfo(listing.country).label)}` : ''} • ${timeAgoFull(listing.created_at)}</p>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; cursor:pointer;" onclick="openSeller('${seller.id}')">
        <div class="avatar" style="width:32px; height:32px; font-size:var(--fs-xs);">${initials(seller.full_name)}</div>
        <span style="font-size:var(--fs-sm); font-weight:500;">${escapeHtml(seller.full_name)}</span>
        <span class="muted" style="font-size:var(--fs-xs); display:flex; align-items:center; gap:3px;">${icon('star', 'icon-xs icon-star-filled')} ${seller.rating_avg.toFixed(1)} (${seller.reviews_count})</span>
        ${seller.is_verified_trader ? `<span class="badge badge-success">${icon('badge-check')} موثّق</span>` : ''}
      </div>
      ${identityLine}

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:12px 0; margin-bottom:12px;">
        <span style="font-size:var(--fs-xl); font-weight:700; color:var(--blue);">${formatPrice(listing.price, listing.currency)}</span>
      </div>

      ${listing.description ? `<p style="font-size:var(--fs-base); line-height:1.7; margin-bottom:14px;">${escapeHtml(listing.description)}</p>` : ''}
      </div>

      <div class="detail-media-col">
      ${renderDetailMedia(listing.media)}
      <div style="margin-bottom:6px;"></div>
      </div>

      <div class="detail-info-col">
      ${contactRow}

      <div style="background:var(--bg); border-radius:var(--radius-sm); padding:12px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:var(--fs-base); font-weight:600; display:flex; align-items:center; gap:5px;">${icon('star', 'icon-sm icon-star-filled')} ${seller.rating_avg.toFixed(1)}</span>
        <span class="muted">${seller.reviews_count} تقييم</span>
      </div>

      <button class="btn-outline" style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:12px;" onclick="openDealConfirm()">${icon('handshake', 'icon-sm')} تأكيد الصفقة وتسديد حصتك من العمولة</button>
      </div>
    `;
    refreshIcons();
    renderComments();
    renderSimilarListings(similar_listings);
  } catch (err) {
    body.innerHTML = `<p class="muted">تعذّر تحميل الإعلان: ${escapeHtml(err.message)}</p>`;
    document.getElementById('similar-listings-section').style.display = 'none';
  }
}

// ---------- comments (public Q&A thread under a listing) ----------
let currentListingComments = [];
async function renderComments() {
  const listEl = document.getElementById('detail-comments-list');
  listEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  document.getElementById('detail-comment-form-box').style.display = currentUser ? 'block' : 'none';
  document.getElementById('detail-comment-login-hint').style.display = currentUser ? 'none' : 'block';
  document.getElementById('detail-comment-input').value = '';
  try {
    const { comments } = await api('/listings/' + currentListingId + '/comments');
    currentListingComments = comments;
    listEl.innerHTML = comments.length
      ? comments.map(commentRow).join('')
      : '<p class="muted">لا توجد تعليقات بعد</p>';
    refreshIcons();
  } catch {
    listEl.innerHTML = '<p class="muted">تعذّر تحميل التعليقات</p>';
  }
}
function commentRow(c) {
  const isSeller = currentSellerDetail && c.author_id === currentSellerDetail.id;
  return `<div style="border-bottom:1px solid var(--border); padding:10px 0;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:6px;">
      <span style="font-weight:600; font-size:var(--fs-sm); display:flex; align-items:center; gap:5px;">
        ${escapeHtml(c.author_name)} ${isSeller ? '<span class="badge badge-success">البائع</span>' : ''}
      </span>
      <span class="muted" style="font-size:var(--fs-xs); flex-shrink:0;">${timeAgoFull(c.created_at)}</span>
    </div>
    <p style="font-size:var(--fs-sm); line-height:1.6; margin-bottom:4px;">${escapeHtml(c.body)}</p>
    ${currentUser ? `<span class="link" style="font-size:var(--fs-xs);" onclick="openReportComment('${c.id}')">إبلاغ</span>` : ''}
    ${currentUser && currentUser.is_admin ? `<span class="link" style="font-size:var(--fs-xs); color:var(--danger); margin-right:10px;" onclick="adminDeleteComment('${c.id}')">حذف (مشرف)</span>` : ''}
  </div>`;
}
async function submitComment() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  const input = document.getElementById('detail-comment-input');
  const body = input.value.trim();
  if (!body) return toast('اكتب تعليقاً');
  const btn = document.querySelector('#detail-comment-form-box button');
  btn.disabled = true;
  try {
    await api('/listings/' + currentListingId + '/comments', { method: 'POST', body: { body } });
    renderComments();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}
function openReportComment(commentId) {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  openReport('comment', commentId, 'تعليق');
}

// ---------- similar listings ----------
function renderSimilarListings(listings) {
  const section = document.getElementById('similar-listings-section');
  if (!listings || !listings.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  document.getElementById('similar-listings').innerHTML = listings.map(listingCard).join('');
  refreshIcons();
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
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
const REPORT_TITLES = { listing: 'الإبلاغ عن إعلان', account: 'الإبلاغ عن حساب', comment: 'الإبلاغ عن تعليق' };
function openReport(type, id, label) {
  reportTarget = { type, id, label, reason: null };
  document.getElementById('report-title').textContent = REPORT_TITLES[type] || 'الإبلاغ';
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
// Reachable three ways: the "تأكيد الصفقة" button on a listing (tied to
// that listing/seller, dealContext.listingId set), or directly from the
// home screen / account settings with no listing context at all — a deal
// made entirely outside the app can still be confirmed here (product
// decision: no mandatory listing link). The screen itself is identical
// either way; only what gets sent to the API on submit differs.
let dealContext = null;
function openDealConfirm() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  if (!currentListingDetail || !currentSellerDetail) return;
  const isOwnListing = currentUser.id === currentSellerDetail.id;
  dealContext = { listingId: currentListingDetail.id, currency: currentListingDetail.currency, role: isOwnListing ? 'seller' : 'buyer' };
  prepareDealConfirmScreen(dealContext.currency);
}
function openDealConfirmStandalone() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  dealContext = { listingId: null, currency: (countryInfo(browsingCountry) && countryInfo(browsingCountry).currency) || 'SAR', role: null };
  prepareDealConfirmScreen(dealContext.currency);
}
function prepareDealConfirmScreen(defaultCurrency) {
  document.getElementById('dc-currency').innerHTML = Object.keys(CURRENCY_LABELS_AR)
    .map((c) => `<option value="${c}" ${c === defaultCurrency ? 'selected' : ''}>${CURRENCY_LABELS_AR[c]} (${c})</option>`)
    .join('');
  document.getElementById('dc-amount').value = '';
  document.getElementById('dc-rate-display').textContent = ((meta.commission_rate || 0.025) * 100).toFixed(1) + '%';
  document.getElementById('dc-bank-name').textContent = (meta.bank_account && meta.bank_account.bank_name) || '—';
  document.getElementById('dc-bank-iban').textContent = (meta.bank_account && meta.bank_account.iban) || '—';
  const ratePct = ((meta.commission_rate || 0.025) * 100).toFixed(1) + '%';
  const roleNote = document.getElementById('dc-role-note');
  if (dealContext.role === 'seller') {
    roleNote.textContent = `بصفتك البائع في هذا الإعلان، هذه حصتك من العمولة (${ratePct}) فقط. المشتري يؤكد ويسدد حصته (${ratePct}) بشكل منفصل من حسابه.`;
  } else if (dealContext.role === 'buyer') {
    roleNote.textContent = `بصفتك المشتري في هذا الإعلان، هذه حصتك من العمولة (${ratePct}) فقط. البائع يؤكد ويسدد حصته (${ratePct}) بشكل منفصل من حسابه.`;
  } else {
    roleNote.textContent = `هذه حصتك من العمولة (${ratePct}) عن هذه الصفقة فقط. الطرف الآخر يؤكد ويسدد حصته (${ratePct}) بشكل منفصل من حسابه.`;
  }
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
    const body = { deal_amount: amount, currency };
    if (dealContext.listingId) body.listing_id = dealContext.listingId;
    await api('/transactions', { method: 'POST', body });
    toast('تم تأكيد تسديد العمولة، شكراً لأمانتك');
    goBack();
  } catch (err) {
    showError('dc-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'تم التحويل، تأكيد التسديد';
  }
}

// ---------- messaging (simple in-app chat, no real-time / images / delete) ----------
let currentChatId = null;
let currentChatListingId = null;

async function openConversationFromListing() {
  if (!currentUser) { toast('سجّل الدخول للتواصل مع البائع'); return go('login'); }
  if (!currentListingDetail) return;
  try {
    const res = await api('/conversations', { method: 'POST', body: { listing_id: currentListingDetail.id } });
    openChat(res.conversation_id);
  } catch (err) {
    toast(err.message);
  }
}

function timeAgoShort(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} يوم`;
  return new Date(iso).toLocaleDateString('ar');
}

// Full "قبل ساعة" / "قبل يومين" style relative time for the listing detail
// screen — same idea as timeAgoShort but with proper Arabic singular/dual/
// plural wording instead of a bare number, matching how a marketplace
// listing's post time is normally phrased.
function timeAgoFull(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  const phrase = (n, singular, dual, plural) => {
    if (n === 1) return `قبل ${singular}`;
    if (n === 2) return `قبل ${dual}`;
    if (n <= 10) return `قبل ${n} ${plural}`;
    return `قبل ${n} ${singular}`;
  };
  if (mins < 60) return phrase(mins, 'دقيقة', 'دقيقتين', 'دقائق');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return phrase(hours, 'ساعة', 'ساعتين', 'ساعات');
  const days = Math.floor(hours / 24);
  if (days < 30) return phrase(days, 'يوم', 'يومين', 'أيام');
  return new Date(iso).toLocaleDateString('ar');
}

async function renderMessagesList() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  const el = document.getElementById('messages-list');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { conversations } = await api('/conversations');
    el.innerHTML = conversations.length
      ? conversations.map((c) => `
        <div class="convo-row" onclick="openChat('${c.id}')">
          <div class="avatar">${initials(c.peer_name)}</div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:6px;">
              <span style="font-weight:700; font-size:var(--fs-base); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.peer_name)}</span>
              <span class="muted" style="font-size:var(--fs-xs); flex-shrink:0;">${timeAgoShort(c.last_message_at)}</span>
            </div>
            <p class="muted" style="font-size:var(--fs-xs); margin:2px 0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.listing_title)}</p>
            <p style="font-size:var(--fs-sm); color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${c.last_message_body ? (c.last_message_is_mine ? 'أنت: ' : '') + escapeHtml(c.last_message_body) : '<span class="muted">لا توجد رسائل بعد</span>'}
            </p>
          </div>
        </div>`).join('')
      : '<p class="muted center" style="padding:32px 0;">لا توجد محادثات بعد — ابدأ من زر "تواصل مع البائع" في أي إعلان</p>';
    refreshIcons();
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل الرسائل: ${escapeHtml(err.message)}</p>`;
  }
}

async function openChat(conversationId) {
  currentChatId = conversationId;
  go('chat');
  const el = document.getElementById('chat-messages');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  document.getElementById('chat-peer-name').textContent = '';
  document.getElementById('chat-listing-title').textContent = '';
  try {
    const { conversation, messages } = await api('/conversations/' + conversationId + '/messages');
    currentChatListingId = conversation.listing_id;
    document.getElementById('chat-peer-name').textContent = conversation.peer_name;
    document.getElementById('chat-listing-title').textContent = conversation.listing_title;
    renderChatMessages(messages);
    document.getElementById('chat-input').value = '';
    document.getElementById('chat-input').focus();
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل المحادثة: ${escapeHtml(err.message)}</p>`;
  }
}

function renderChatMessages(messages) {
  const el = document.getElementById('chat-messages');
  el.innerHTML = messages.length
    ? messages.map((m) => {
        const mine = m.sender_id === currentUser.id;
        return `<div class="msg-bubble ${mine ? 'msg-mine' : 'msg-theirs'}">
          ${escapeHtml(m.body)}
          <span class="msg-time">${new Date(m.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>`;
      }).join('')
    : '<p class="muted center" style="padding:24px 0;">ابدأ المحادثة بكتابة أول رسالة</p>';
  refreshIcons();
  window.scrollTo(0, document.body.scrollHeight);
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const body = input.value.trim();
  if (!body || !currentChatId) return;
  input.disabled = true;
  try {
    await api('/conversations/' + currentChatId + '/messages', { method: 'POST', body: { body } });
    input.value = '';
    const { messages } = await api('/conversations/' + currentChatId + '/messages');
    renderChatMessages(messages);
  } catch (err) {
    toast(err.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.id === 'chat-input') {
    e.preventDefault();
    sendChatMessage();
  }
});

// ---------- create listing ----------
// Manufacturer/model pickers for the generic "قطع غيار" flow (createMode ===
// 'car_part'): unlike the dedicated vehicle sections, this flow has no
// vehicle category pre-selected, so a "نوع المركبة" select decides which of
// meta.vehicle_categories' make lists to show — same lists as the section
// filters, with the same "أخرى" free-text fallback pattern used elsewhere.
// The chosen type is a client-side-only convenience; the listing's category
// stays 'spare_part' either way.
function compatTypeMeta() {
  const type = document.getElementById('cl-compat-type').value;
  return (meta.vehicle_categories && meta.vehicle_categories[type]) || { makes: [], models_by_make: {} };
}
function populateCompatTypeSelect() {
  const cats = meta.vehicle_categories || {};
  const order = ['full_car', 'motorcycle', 'truck'].filter((k) => cats[k]);
  document.getElementById('cl-compat-type').innerHTML = order
    .map((key) => `<option value="${key}">${escapeHtml(cats[key].label)}</option>`)
    .join('');
}
function onCompatTypeChange() {
  populateCompatMakeSelect();
}
function populateCompatMakeSelect() {
  const makes = compatTypeMeta().makes || [];
  const select = document.getElementById('cl-compat-make');
  select.innerHTML = '<option value="">— بدون تحديد —</option>' + makes.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  select.value = '';
  onCompatMakeChange();
}
function onCompatMakeChange() {
  const select = document.getElementById('cl-compat-make');
  const other = document.getElementById('cl-compat-make-other');
  other.style.display = select.value === 'أخرى' ? 'block' : 'none';
  other.value = '';
  populateCompatModelSelect();
}
function populateCompatModelSelect() {
  const make = getCompatMakeValue();
  const models = make ? (compatTypeMeta().models_by_make[make] || []).filter((m) => m !== 'أخرى') : [];
  const select = document.getElementById('cl-compat-model');
  const other = document.getElementById('cl-compat-model-other');
  other.value = '';
  if (models.length) {
    select.style.display = 'block';
    select.innerHTML = '<option value="">— بدون تحديد —</option>' + models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    other.style.display = 'none';
  } else {
    select.style.display = 'none';
    select.innerHTML = '';
    other.style.display = 'block';
  }
}
function onCompatModelChange() {
  const select = document.getElementById('cl-compat-model');
  const other = document.getElementById('cl-compat-model-other');
  other.style.display = select.value === 'أخرى' ? 'block' : 'none';
}
function getCompatMakeValue() {
  const select = document.getElementById('cl-compat-make');
  const other = document.getElementById('cl-compat-make-other');
  return select.value === 'أخرى' ? other.value.trim() : select.value;
}
function getCompatModelValue() {
  const select = document.getElementById('cl-compat-model');
  const other = document.getElementById('cl-compat-model-other');
  if (select.style.display === 'none' || select.value === 'أخرى') return other.value.trim();
  return select.value;
}

function prepareCreateScreen() {
  if (!currentUser) { toast('سجّل الدخول أولاً'); return go('login'); }
  document.getElementById('cl-title').value = '';
  document.getElementById('cl-desc').value = '';
  document.getElementById('cl-price').value = '';
  populateCompatTypeSelect();
  populateCompatMakeSelect();
  document.getElementById('cl-compat-year').innerHTML = yearOptionsHtml();
  document.getElementById('cl-vehicle-part-year').innerHTML = yearOptionsHtml();
  document.getElementById('cl-vehicle-part-model-other').value = '';
  document.getElementById('cl-vehicle-whole-year').innerHTML = yearOptionsHtml(null, { required: true });
  document.getElementById('cl-vehicle-whole-damage').value = 'light';
  document.getElementById('cl-vehicle-whole-model-other').value = '';
  document.getElementById('cl-country').value = browsingCountry;
  onCreateCountryChange();
  selectedImages = [];
  renderThumbs();
  selectedVideo = null;
  renderVideoPreview();
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
    backBtn.onclick = () => { vehicleTab = isWhole ? 'whole' : 'part'; go('vehicle-browse'); };
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
const MAX_IMAGE_MB = 8; // matches the server's safety-net limit; compressed photos land far below this
const MAX_ORIGINAL_IMAGE_MB = 40; // reject absurdly large originals before even trying to decode them
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_JPEG_QUALITY = 0.82;

// Phone/tablet camera photos are often huge (10-20+ MB) and were causing
// uploads to fail outright (raw multipart payload too large / too slow over
// mobile data). Resize + re-encode in the browser before ever sending the
// file, using the canvas API (no library needed) — createImageBitmap also
// auto-corrects EXIF orientation in modern browsers, so no manual rotation.
async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
    const scale = IMAGE_MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY));
  if (!blob) throw new Error('compression produced no blob');
  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

async function onImagesSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) {
    if (selectedImages.length >= MAX_IMAGES) { toast(`الحد الأقصى ${MAX_IMAGES} صور`); break; }
    if (!['image/jpeg', 'image/png'].includes(f.type)) { toast('الصور يجب أن تكون JPG أو PNG'); continue; }
    if (f.size > MAX_ORIGINAL_IMAGE_MB * 1024 * 1024) { toast(`الصورة "${f.name}" كبيرة جداً`); continue; }
    let compressed;
    try {
      compressed = await compressImageFile(f);
    } catch {
      toast(`تعذّر معالجة الصورة "${f.name}"، جرّب صورة أخرى`);
      continue;
    }
    if (compressed.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast(`الصورة "${f.name}" كبيرة جداً حتى بعد الضغط`);
      continue;
    }
    selectedImages.push(compressed);
    renderThumbs();
  }
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

// ---------- video (create listing) ----------
let selectedVideo = null; // File | null — one video per listing
const MAX_VIDEO_MB = 50;
const MAX_VIDEO_DURATION_SECONDS = 60;
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(videoEl.src);
      resolve(videoEl.duration);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(videoEl.src);
      reject(new Error('cannot read video metadata'));
    };
    videoEl.src = URL.createObjectURL(file);
  });
}
async function onVideoSelected(e) {
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file) return;
  if (!VIDEO_MIME_TYPES.includes(file.type)) {
    return toast('صيغة الفيديو غير مدعومة (MP4 أو MOV أو WebM فقط)');
  }
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
    return toast(`حجم الفيديو أكبر من ${MAX_VIDEO_MB} ميجا`);
  }
  let duration;
  try {
    duration = await readVideoDuration(file);
  } catch {
    return toast('تعذّر قراءة الفيديو، جرّب ملفاً آخر');
  }
  // +1s tolerance for container/rounding differences between what the
  // browser reports here and what the server measures after upload.
  if (duration > MAX_VIDEO_DURATION_SECONDS + 1) {
    return toast('مدة الفيديو يجب ألا تتجاوز دقيقة واحدة');
  }
  selectedVideo = file;
  renderVideoPreview();
}
function renderVideoPreview() {
  const el = document.getElementById('cl-video-preview');
  el.innerHTML = selectedVideo
    ? `<div class="thumb"><video src="${URL.createObjectURL(selectedVideo)}" muted style="width:100%; height:100%; object-fit:cover;"></video><span class="rm" onclick="removeVideo()">${icon('x')}</span></div>`
    : '';
  refreshIcons();
}
function removeVideo() {
  selectedVideo = null;
  renderVideoPreview();
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
      // Single year field (اختياري) — sent as both bounds of the existing
      // compatible_year_from/to range so a part with no year set still
      // matches "any year" in search, same as before this change.
      const year = document.getElementById('cl-vehicle-part-year').value;
      fd.append('compatible_year_from', year);
      fd.append('compatible_year_to', year);
    }
  } else {
    const part_category = document.getElementById('cl-part-category').value;
    if (!title || !price || !city || !part_category) {
      return showError('cl-error', 'عنوان الإعلان والسعر والمدينة وفئة القطعة مطلوبة');
    }
    fd.append('part_category', part_category);
    fd.append('compatible_make', getCompatMakeValue());
    fd.append('compatible_model', getCompatModelValue());
    const year = document.getElementById('cl-compat-year').value;
    fd.append('compatible_year_from', year);
    fd.append('compatible_year_to', year);
  }
  selectedImages.forEach((f) => fd.append('images', f));
  if (selectedVideo) fd.append('video', selectedVideo);

  const btn = document.getElementById('cl-submit');
  btn.disabled = true;
  btn.textContent = 'جارِ النشر...';
  try {
    await api('/listings', { method: 'POST', body: fd, isForm: true });
    toast('تم نشر الإعلان بنجاح');
    if (createMode === 'vehicle_part') { vehicleTab = 'part'; go('vehicle-browse'); }
    else if (createMode === 'vehicle_whole') { vehicleTab = 'whole'; go('vehicle-browse'); }
    else go('home');
  } catch (err) {
    showError('cl-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'نشر الإعلان';
  }
}

// ---------- edit listing ----------
// Narrow scope on purpose: title/description/price and images/video only —
// never category, compat fields, or country/city (see the PATCH route).
let editListingId = null;
let editExistingImages = [];
let editExistingVideo = null;
let editRemoveMediaIds = [];
let editNewImages = [];
let editNewVideo = null;

async function openEditListing(id) {
  editListingId = id;
  editRemoveMediaIds = [];
  editNewImages = [];
  editNewVideo = null;
  go('edit-listing');
  document.getElementById('el-title').value = '';
  document.getElementById('el-desc').value = '';
  document.getElementById('el-price').value = '';
  document.getElementById('el-new-images').innerHTML = '';
  document.getElementById('el-new-video').innerHTML = '';
  hideError('el-error');
  try {
    const { listing } = await api('/listings/' + id);
    document.getElementById('el-title').value = listing.title;
    document.getElementById('el-desc').value = listing.description || '';
    document.getElementById('el-price').value = listing.price;
    editExistingImages = listing.media.filter((m) => m.type === 'image');
    editExistingVideo = listing.media.find((m) => m.type === 'video') || null;
    renderEditExistingMedia();
  } catch (err) {
    toast(err.message);
    goBack();
  }
}
function renderEditExistingMedia() {
  document.getElementById('el-existing-images').innerHTML = editExistingImages
    .map((m) => `<div class="thumb">${imgWithFallback(m.thumbnail_url || m.url, { style: 'width:100%; height:100%; object-fit:cover;' })}<span class="rm" onclick="removeExistingMedia('${m.id}')">${icon('x')}</span></div>`)
    .join('');
  document.getElementById('el-existing-video').innerHTML = editExistingVideo
    ? `<div class="thumb"><video src="${editExistingVideo.url}" muted onerror="handleVideoError(this)" style="width:100%; height:100%; object-fit:cover;"></video><span class="rm" onclick="removeExistingMedia('${editExistingVideo.id}')">${icon('x')}</span></div>`
    : '<p class="muted">لا يوجد فيديو حالياً</p>';
  refreshIcons();
}
function removeExistingMedia(mediaId) {
  editRemoveMediaIds.push(mediaId);
  editExistingImages = editExistingImages.filter((m) => m.id !== mediaId);
  if (editExistingVideo && editExistingVideo.id === mediaId) editExistingVideo = null;
  renderEditExistingMedia();
}
async function onEditImagesSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) {
    if (editExistingImages.length + editNewImages.length >= MAX_IMAGES) { toast(`الحد الأقصى ${MAX_IMAGES} صور`); break; }
    if (!['image/jpeg', 'image/png'].includes(f.type)) { toast('الصور يجب أن تكون JPG أو PNG'); continue; }
    if (f.size > MAX_ORIGINAL_IMAGE_MB * 1024 * 1024) { toast(`الصورة "${f.name}" كبيرة جداً`); continue; }
    let compressed;
    try {
      compressed = await compressImageFile(f);
    } catch {
      toast(`تعذّر معالجة الصورة "${f.name}"، جرّب صورة أخرى`);
      continue;
    }
    if (compressed.size > MAX_IMAGE_MB * 1024 * 1024) { toast(`الصورة "${f.name}" كبيرة جداً حتى بعد الضغط`); continue; }
    editNewImages.push(compressed);
    renderEditNewImages();
  }
}
function renderEditNewImages() {
  document.getElementById('el-new-images').innerHTML = editNewImages
    .map((f, i) => `<div class="thumb"><img src="${URL.createObjectURL(f)}"><span class="rm" onclick="removeEditNewImage(${i})">${icon('x')}</span></div>`)
    .join('');
  refreshIcons();
}
function removeEditNewImage(i) {
  editNewImages.splice(i, 1);
  renderEditNewImages();
}
async function onEditVideoSelected(e) {
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file) return;
  if (!VIDEO_MIME_TYPES.includes(file.type)) return toast('صيغة الفيديو غير مدعومة (MP4 أو MOV أو WebM فقط)');
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) return toast(`حجم الفيديو أكبر من ${MAX_VIDEO_MB} ميجا`);
  let duration;
  try {
    duration = await readVideoDuration(file);
  } catch {
    return toast('تعذّر قراءة الفيديو، جرّب ملفاً آخر');
  }
  if (duration > MAX_VIDEO_DURATION_SECONDS + 1) return toast('مدة الفيديو يجب ألا تتجاوز دقيقة واحدة');
  editNewVideo = file;
  renderEditNewVideo();
}
function renderEditNewVideo() {
  document.getElementById('el-new-video').innerHTML = editNewVideo
    ? `<div class="thumb"><video src="${URL.createObjectURL(editNewVideo)}" muted style="width:100%; height:100%; object-fit:cover;"></video><span class="rm" onclick="removeEditNewVideo()">${icon('x')}</span></div>`
    : '';
  refreshIcons();
}
function removeEditNewVideo() {
  editNewVideo = null;
  renderEditNewVideo();
}
async function submitEditListing() {
  hideError('el-error');
  const title = document.getElementById('el-title').value.trim();
  const price = document.getElementById('el-price').value;
  if (!title) return showError('el-error', 'عنوان الإعلان مطلوب');
  if (!price || Number(price) <= 0) return showError('el-error', 'سعر غير صالح');

  const fd = new FormData();
  fd.append('title', title);
  fd.append('description', document.getElementById('el-desc').value.trim());
  fd.append('price', price);
  fd.append('remove_media_ids', JSON.stringify(editRemoveMediaIds));
  editNewImages.forEach((f) => fd.append('images', f));
  if (editNewVideo) fd.append('video', editNewVideo);

  const btn = document.getElementById('el-submit');
  btn.disabled = true;
  btn.textContent = 'جارِ الحفظ...';
  try {
    await api('/listings/' + editListingId, { method: 'PATCH', body: fd, isForm: true });
    toast('تم حفظ التعديلات');
    openDetail(editListingId);
  } catch (err) {
    showError('el-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ التعديلات';
  }
}

// ---------- seller profile ----------
let currentSellerProfile = null;
async function openSeller(id) {
  go('seller');
  const body = document.getElementById('seller-body');
  const listingsEl = document.getElementById('seller-listings');
  const reviewsEl = document.getElementById('seller-reviews');
  const reviewFormCard = document.getElementById('seller-review-form-card');
  body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  listingsEl.innerHTML = '';
  reviewsEl.innerHTML = '';
  reviewFormCard.style.display = 'none';
  try {
    const { seller, listings, reviews } = await api('/users/' + id + '/public');
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
        <span class="muted">${seller.reviews_count} تقييم</span>
      </div>
    `;
    listingsEl.innerHTML = listings.length
      ? listings.map(listingCard).join('')
      : '<p class="muted" style="grid-column:1/-1;">لا توجد إعلانات نشطة</p>';
    reviewsEl.innerHTML = reviews.length
      ? reviews.map(reviewRow).join('')
      : '<p class="muted">لا توجد تقييمات بعد</p>';
    if (seller.can_review) {
      selectedReviewRating = 0;
      document.getElementById('seller-review-comment').value = '';
      hideError('seller-review-error');
      renderStarPicker();
      reviewFormCard.style.display = 'block';
    }
    refreshIcons();
  } catch (err) {
    body.innerHTML = `<p class="muted">تعذّر تحميل البروفايل</p>`;
  }
}
function starsHtml(rating, size) {
  return [1, 2, 3, 4, 5].map((n) => icon('star', `${size} ${n <= rating ? 'icon-star-filled' : ''}`)).join('');
}
function reviewRow(r) {
  return `<div style="border-bottom:1px solid var(--border); padding:10px 0;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:6px;">
      <span style="font-weight:600; font-size:var(--fs-sm);">${escapeHtml(r.reviewer_name)}</span>
      <span class="muted" style="font-size:var(--fs-xs); flex-shrink:0;">${timeAgoFull(r.created_at)}</span>
    </div>
    <div style="display:flex; gap:2px; margin-bottom:4px;">${starsHtml(r.rating, 'icon-xs')}</div>
    ${r.comment ? `<p style="font-size:var(--fs-sm); line-height:1.6;">${escapeHtml(r.comment)}</p>` : ''}
  </div>`;
}

// ---------- rate seller (star picker) ----------
let selectedReviewRating = 0;
function renderStarPicker() {
  const el = document.getElementById('seller-star-picker');
  el.innerHTML = [1, 2, 3, 4, 5]
    .map((n) => `<span style="cursor:pointer;" onclick="selectReviewRating(${n})">${icon('star', `icon-lg ${n <= selectedReviewRating ? 'icon-star-filled' : ''}`)}</span>`)
    .join('');
  refreshIcons();
}
function selectReviewRating(n) {
  selectedReviewRating = n;
  renderStarPicker();
}
async function submitSellerReview() {
  hideError('seller-review-error');
  if (!selectedReviewRating) return showError('seller-review-error', 'اختر عدد النجوم');
  const comment = document.getElementById('seller-review-comment').value.trim();
  const btn = document.getElementById('seller-review-submit');
  btn.disabled = true;
  try {
    await api('/users/' + currentSellerProfile.id + '/reviews', {
      method: 'POST',
      body: { rating: selectedReviewRating, comment },
    });
    toast('تم إرسال تقييمك، شكراً لك');
    openSeller(currentSellerProfile.id);
  } catch (err) {
    showError('seller-review-error', err.message);
  } finally {
    btn.disabled = false;
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
  document.getElementById('phone-visible-state').textContent = currentUser.phone_visible ? 'ظاهر' : 'مخفي';
  document.getElementById('admin-row').style.display = currentUser.is_admin ? 'flex' : 'none';
  applyTheme();
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
async function togglePhoneVisibility() {
  try {
    const res = await api('/auth/phone-visibility', { method: 'PATCH', body: { visible: !currentUser.phone_visible } });
    currentUser = res.user;
    document.getElementById('phone-visible-state').textContent = currentUser.phone_visible ? 'ظاهر' : 'مخفي';
    toast(currentUser.phone_visible ? 'تم إظهار رقم جوالك للمشترين' : 'تم إخفاء رقم جوالك — يظهر لهم "رسالة خاصة" فقط');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- edit account profile (name/phone/city/email, OTP-gated for phone+email) ----------
let epOriginal = null;
let epOtpChannel = 'whatsapp';
let epPendingHasPhone = false;
let epPendingHasEmail = false;
function renderEditProfile() {
  epOriginal = { full_name: currentUser.full_name, phone_country_code: currentUser.phone_country_code, phone_number: currentUser.phone_number, email: currentUser.email, city: currentUser.city || '' };
  document.getElementById('ep-name').value = currentUser.full_name;
  document.getElementById('ep-code').innerHTML = phoneCodeOptionsHtml(currentUser.phone_country_code);
  document.getElementById('ep-phone').value = currentUser.phone_number;
  document.getElementById('ep-email').value = currentUser.email;
  populateEpCities(currentUser.city || '');
  selectEpOtpChannel('whatsapp');
  hideError('ep-error1');
  hideError('ep-error2');
  document.getElementById('ep-step1').style.display = 'block';
  document.getElementById('ep-step2').style.display = 'none';
}
// City list here follows the selected phone country code (#ep-code) — the
// only "which GCC country" control on this screen — not the account's
// fixed country, which this screen never lets the user change.
function populateEpCities(selectedCity) {
  const country = countryByPhoneCode(document.getElementById('ep-code').value);
  const cities = (country && meta.cities_by_country[country.code]) || [];
  document.getElementById('ep-city').innerHTML =
    '<option value="">— بدون تحديد —</option>' + cities.map((c) => `<option ${c === selectedCity ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
function onEpCodeChange() {
  // Phone country code changed, so any previously-picked city (belonging
  // to the old country) is no longer valid — clear it.
  populateEpCities('');
}
function selectEpOtpChannel(channel) {
  epOtpChannel = channel;
  document.getElementById('ep-channel-whatsapp').classList.toggle('selected', channel === 'whatsapp');
  document.getElementById('ep-channel-email').classList.toggle('selected', channel === 'email');
}
async function submitEditProfile() {
  hideError('ep-error1');
  const name = document.getElementById('ep-name').value.trim();
  const code = document.getElementById('ep-code').value;
  const phone = document.getElementById('ep-phone').value.trim();
  const email = document.getElementById('ep-email').value.trim();
  const city = document.getElementById('ep-city').value;
  if (!name) return showError('ep-error1', 'الاسم مطلوب');
  if (!phone) return showError('ep-error1', 'رقم الجوال مطلوب');
  if (!email) return showError('ep-error1', 'البريد الإلكتروني مطلوب');

  const nameChanged = name !== epOriginal.full_name;
  const cityChanged = city !== epOriginal.city;
  const phoneChanged = phone !== epOriginal.phone_number || code !== epOriginal.phone_country_code;
  const emailChanged = email.toLowerCase() !== epOriginal.email.toLowerCase();

  if (!nameChanged && !cityChanged && !phoneChanged && !emailChanged) {
    toast('لا يوجد تعديل');
    return go('profile');
  }

  const btn = document.getElementById('ep-submit');
  btn.disabled = true;
  try {
    if (nameChanged || cityChanged) {
      const body = {};
      if (nameChanged) body.full_name = name;
      if (cityChanged) body.city = city;
      const res = await api('/auth/profile', { method: 'PATCH', body });
      currentUser = res.user;
    }
    if (phoneChanged || emailChanged) {
      const body = { otp_channel: epOtpChannel };
      if (phoneChanged) { body.phone_country_code = code; body.phone_number = phone; }
      if (emailChanged) body.email = email;
      epPendingHasPhone = phoneChanged;
      epPendingHasEmail = emailChanged;
      const res = await api('/auth/profile/verify-request', { method: 'POST', body });
      document.getElementById('ep-otp-destination').textContent = res.otp_destination;
      document.getElementById('ep-step1').style.display = 'none';
      document.getElementById('ep-step2').style.display = 'block';
      document.querySelectorAll('#ep-step2 .otp-row input').forEach((inp) => (inp.value = ''));
      document.querySelector('#ep-step2 .otp-row input').focus();
      if (nameChanged || cityChanged) toast('تم حفظ الاسم/المدينة، أكمل تأكيد الجوال/البريد');
    } else {
      toast('تم حفظ التغييرات');
      go('profile');
    }
  } catch (err) {
    showError('ep-error1', err.message);
  } finally {
    btn.disabled = false;
  }
}
async function confirmEditProfileOtp() {
  hideError('ep-error2');
  const code = Array.from(document.querySelectorAll('#ep-step2 .otp-row input')).map((i) => i.value).join('');
  if (code.length !== 4) return showError('ep-error2', 'أدخل الكود كاملاً');
  try {
    const res = await api('/auth/profile/verify-confirm', { method: 'POST', body: { code } });
    currentUser = res.user;
    toast('تم تأكيد وتحديث بياناتك');
    go('profile');
  } catch (err) {
    showError('ep-error2', err.message);
  }
}

// ---------- change password ----------
function renderChangePassword() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  hideError('cp-error');
}
async function submitChangePassword() {
  hideError('cp-error');
  const current = document.getElementById('cp-current').value;
  const next = document.getElementById('cp-new').value;
  const confirm_ = document.getElementById('cp-confirm').value;
  if (!current || !next || !confirm_) return showError('cp-error', 'الرجاء تعبئة كل الحقول');
  if (next.length < 8) return showError('cp-error', 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
  if (next !== confirm_) return showError('cp-error', 'كلمة المرور الجديدة وتأكيدها غير متطابقين');
  try {
    await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
    toast('تم تغيير كلمة المرور');
    go('profile');
  } catch (err) {
    showError('cp-error', err.message);
  }
}

// ---------- support (self-service tickets, reaches admin's "رسائل الدعم" tab) ----------
const SUPPORT_STATUS_LABELS = { open: 'بانتظار الرد', answered: 'تم الرد' };
let supportImageFile = null;
async function renderSupport() {
  document.getElementById('sup-issue-type').innerHTML = (meta.support_issue_types || [])
    .map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`)
    .join('');
  document.getElementById('sup-description').value = '';
  supportImageFile = null;
  document.getElementById('sup-thumb').innerHTML = '';
  hideError('sup-error');
  await renderSupportMine();
}
async function onSupportImageSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) return toast('الصورة يجب أن تكون JPG أو PNG');
  if (file.size > MAX_ORIGINAL_IMAGE_MB * 1024 * 1024) return toast('الصورة كبيرة جداً');
  try {
    supportImageFile = await compressImageFile(file);
    document.getElementById('sup-thumb').innerHTML = `<div class="thumb"><img src="${URL.createObjectURL(supportImageFile)}"><span class="rm" onclick="removeSupportImage()">${icon('x')}</span></div>`;
    refreshIcons();
  } catch {
    toast('تعذّر معالجة الصورة');
  }
}
function removeSupportImage() {
  supportImageFile = null;
  document.getElementById('sup-thumb').innerHTML = '';
}
async function submitSupportMessage() {
  hideError('sup-error');
  const issue_type = document.getElementById('sup-issue-type').value;
  const description = document.getElementById('sup-description').value.trim();
  if (!description) return showError('sup-error', 'اكتب وصف المشكلة');
  const fd = new FormData();
  fd.append('issue_type', issue_type);
  fd.append('description', description);
  if (supportImageFile) fd.append('image', supportImageFile);
  try {
    await api('/support', { method: 'POST', isForm: true, body: fd });
    toast('تم إرسال رسالتك، سنرد عليك قريباً');
    document.getElementById('sup-description').value = '';
    removeSupportImage();
    await renderSupportMine();
  } catch (err) {
    showError('sup-error', err.message);
  }
}
async function renderSupportMine() {
  const el = document.getElementById('sup-my-messages');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  try {
    const { messages } = await api('/support/mine');
    el.innerHTML = messages.length ? messages.map((m) => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
          <span class="badge ${m.status === 'answered' ? 'badge-success' : 'badge-warning'}">${SUPPORT_STATUS_LABELS[m.status]}</span>
          <span class="muted" style="font-size:var(--fs-xs);">${timeAgoFull(m.created_at)}</span>
        </div>
        <p style="font-size:var(--fs-sm); line-height:1.6; margin-bottom:6px;">${escapeHtml(m.description)}</p>
        ${m.image_url ? `<img src="${m.image_url}" style="max-width:100%; border-radius:var(--radius-sm); margin-bottom:8px;">` : ''}
        ${m.admin_reply ? `<div style="background:var(--blue-light); border-radius:var(--radius-sm); padding:10px 12px;"><p class="muted" style="font-size:var(--fs-xs); margin-bottom:3px;">رد الدعم الفني</p><p style="font-size:var(--fs-sm); color:var(--blue);">${escapeHtml(m.admin_reply)}</p></div>` : ''}
      </div>
    `).join('') : '<p class="muted center">ما أرسلت أي رسالة دعم بعد</p>';
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- admin ----------
const REPORT_REASON_LABEL_MAP = {}; // filled lazily from meta.report_reasons on first admin render
function reportReasonLabel(reason) {
  if (!Object.keys(REPORT_REASON_LABEL_MAP).length) {
    [...(meta.report_reasons.listing || []), ...(meta.report_reasons.account || []), ...(meta.report_reasons.comment || [])]
      .forEach((r) => { REPORT_REASON_LABEL_MAP[r.value] = r.label; });
  }
  return REPORT_REASON_LABEL_MAP[reason] || reason;
}
const PAYMENT_STATUS_LABELS = { awaiting_review: 'بانتظار التحقق', received: 'تم الاستلام', not_received: 'لم يصل' };
const PAYMENT_STATUS_BADGE_CLASS = { awaiting_review: 'badge-warning', received: 'badge-success', not_received: 'badge-danger' };
const ADMIN_ACTION_LABELS = {
  suspend_user: 'إيقاف حساب', activate_user: 'تفعيل حساب', dismiss_report: 'تجاهل بلاغ',
  delete_reported_content: 'حذف محتوى مبلّغ عنه', delete_listing: 'حذف إعلان', delete_comment: 'حذف تعليق',
  hide_review: 'إخفاء تقييم', unhide_review: 'إظهار تقييم', update_payment_status: 'تحديث حالة دفعة',
  reply_support_message: 'الرد على رسالة دعم',
};
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ar', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const _debounceTimers = {};
function debounce(key, fn, delay = 300) {
  clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(fn, delay);
}

let adminTab = 'overview';
function switchAdminTab(tab) {
  adminTab = tab;
  ['overview', 'commissions', 'reports', 'users', 'support', 'log'].forEach((t) => {
    document.getElementById('atab-btn-' + t).classList.toggle('active', t === tab);
    document.getElementById('admin-tab-' + t).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'overview') renderAdminStats();
  if (tab === 'commissions') renderAdminTransactions();
  if (tab === 'reports') renderAdminReports();
  if (tab === 'users') renderAdminUsers();
  if (tab === 'support') renderAdminSupport();
  if (tab === 'log') renderAdminLog();
}
function renderAdmin() {
  if (!currentUser || !currentUser.is_admin) { toast('صلاحية مسؤول مطلوبة'); return go('profile'); }
  switchAdminTab(adminTab);
}

function commissionTotalsHtml(rows) {
  if (!rows.length) return '0';
  return rows.map((r) => formatPrice(r.total, r.currency)).join('<br>');
}
async function renderAdminStats() {
  const el = document.getElementById('admin-stats');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const stats = await api('/admin/stats');
    el.innerHTML = `
      <h3 style="font-size:var(--fs-base); font-weight:700; margin-bottom:12px;">أرقام سريعة</h3>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:10px;"><span class="muted">عدد المستخدمين</span><span style="font-weight:700;">${stats.users_count}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:10px;"><span class="muted">الإعلانات النشطة</span><span style="font-weight:700;">${stats.active_listings_count}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:10px; border-top:1px solid var(--border); padding-top:10px;"><span class="muted">الصفقات المؤكدة</span><span style="font-weight:700;">${stats.confirmed_deals_count}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:10px;"><span class="muted">مجموع العمولات المستحقة</span><span style="font-weight:700; color:var(--blue); text-align:left;">${commissionTotalsHtml(stats.commission_due)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm);"><span class="muted">مجموع العمولات المستلمة</span><span style="font-weight:700; color:var(--success); text-align:left;">${commissionTotalsHtml(stats.commission_received)}</span></div>
    `;
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- admin: commissions ----------
async function renderAdminTransactions() {
  const el = document.getElementById('admin-transactions');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  const status = document.getElementById('admin-tx-status').value;
  const search = document.getElementById('admin-tx-search').value.trim();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  try {
    const { transactions } = await api('/admin/transactions?' + params.toString());
    el.innerHTML = transactions.length ? transactions.map((t) => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px;">
          <div>
            <p style="font-weight:700; font-size:var(--fs-sm);">${escapeHtml(t.user_name)} <span class="badge ${t.role === 'buyer' ? 'badge-warning' : 'badge-success'}">${t.role === 'buyer' ? 'مشترٍ' : 'بائع'}</span></p>
            <p class="muted" style="font-size:var(--fs-xs);">${escapeHtml(t.user_email)}</p>
          </div>
          <span class="badge ${PAYMENT_STATUS_BADGE_CLASS[t.admin_payment_status]}">${PAYMENT_STATUS_LABELS[t.admin_payment_status]}</span>
        </div>
        ${t.listing_title ? `<p class="link" style="font-size:var(--fs-sm); margin-bottom:6px;" onclick="openDetail('${t.listing_id}')">${escapeHtml(t.listing_title)}</p>` : '<p class="muted" style="font-size:var(--fs-sm); margin-bottom:6px;">بدون إعلان مرتبط</p>'}
        <div style="display:flex; justify-content:space-between; font-size:var(--fs-sm); margin-bottom:10px;">
          <span class="muted">${formatDateTime(t.created_at)}</span>
          <span>قيمة الصفقة: <b>${formatPrice(t.deal_amount, t.currency)}</b> — حصته: <b style="color:var(--blue);">${formatPrice(t.commission_amount, t.currency)}</b></span>
        </div>
        <select onchange="setTransactionPaymentStatus('${t.id}', this.value)" style="margin-bottom:0;">
          <option value="awaiting_review" ${t.admin_payment_status === 'awaiting_review' ? 'selected' : ''}>بانتظار التحقق</option>
          <option value="received" ${t.admin_payment_status === 'received' ? 'selected' : ''}>تم الاستلام</option>
          <option value="not_received" ${t.admin_payment_status === 'not_received' ? 'selected' : ''}>لم يصل</option>
        </select>
      </div>
    `).join('') : '<p class="muted center">لا توجد دفعات مطابقة</p>';
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
async function setTransactionPaymentStatus(id, status) {
  try {
    await api('/admin/transactions/' + id + '/payment-status', { method: 'PATCH', body: { status } });
    toast('تم تحديث حالة الدفعة');
    renderAdminTransactions();
  } catch (err) {
    toast(err.message);
    renderAdminTransactions();
  }
}

// ---------- admin: reports ----------
async function renderAdminReports() {
  const el = document.getElementById('admin-reports');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  const status = document.getElementById('admin-reports-status').value;
  try {
    const { reports } = await api('/admin/reports' + (status ? '?status=' + status : ''));
    el.innerHTML = reports.length ? reports.map((r) => {
      const targetTypeLabel = { listing: 'إعلان', account: 'حساب', comment: 'تعليق' }[r.target_type];
      const contentGone = !r.target_label;
      const viewAction = r.target_type === 'account'
        ? (r.offender_user_id ? `onclick="openSeller('${r.offender_user_id}')"` : '')
        : (r.related_listing_id ? `onclick="openDetail('${r.related_listing_id}')"` : '');
      return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px;">
          <span class="badge ${r.target_type === 'listing' ? 'badge-warning' : r.target_type === 'account' ? 'badge-danger' : 'badge-success'}">${targetTypeLabel}</span>
          <span class="muted" style="font-size:var(--fs-xs);">${formatDateTime(r.created_at)}</span>
        </div>
        ${contentGone
          ? '<p class="muted" style="font-size:var(--fs-sm); margin-bottom:6px;">المحتوى المبلّغ عنه محذوف</p>'
          : `<p ${viewAction ? 'class="link"' : ''} style="font-size:var(--fs-sm); font-weight:600; margin-bottom:6px;" ${viewAction}>${escapeHtml(r.target_label)}</p>`}
        <p class="muted" style="font-size:var(--fs-sm); margin-bottom:4px;">${escapeHtml(reportReasonLabel(r.reason))}${r.details ? ' — ' + escapeHtml(r.details) : ''}</p>
        <p class="muted" style="font-size:var(--fs-xs); margin-bottom:12px;">بلّغ عنه: ${escapeHtml(r.reporter_name)} · الحالة: ${r.status === 'pending' ? 'قيد المراجعة' : r.status === 'reviewed' ? 'تمت المراجعة' : 'تم الحل'}</p>
        ${r.status === 'pending' ? `
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn-outline card-action-btn" style="flex:1;" onclick="dismissReport('${r.id}')">تجاهل</button>
          ${!contentGone && r.target_type !== 'account' ? `<button class="btn-outline card-action-btn" style="flex:1; color:var(--danger); border-color:var(--danger);" onclick="deleteReportedContent('${r.id}')">حذف المحتوى</button>` : ''}
          ${r.offender_user_id ? `<button class="btn-outline card-action-btn" style="flex:1; color:var(--danger); border-color:var(--danger);" onclick="suspendReportOffender('${r.id}')">إيقاف الحساب</button>` : ''}
        </div>` : ''}
      </div>
    `; }).join('') : '<p class="muted center">لا توجد بلاغات</p>';
    refreshIcons();
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
async function dismissReport(id) {
  try {
    await api('/admin/reports/' + id + '/status', { method: 'PATCH', body: { status: 'resolved' } });
    toast('تم تجاهل البلاغ');
    renderAdminReports();
  } catch (err) {
    toast(err.message);
  }
}
async function deleteReportedContent(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المحتوى نهائياً؟')) return;
  try {
    await api('/admin/reports/' + id + '/delete-content', { method: 'POST' });
    toast('تم حذف المحتوى');
    renderAdminReports();
  } catch (err) {
    toast(err.message);
  }
}
async function suspendReportOffender(id) {
  if (!confirm('هل أنت متأكد من إيقاف هذا الحساب؟')) return;
  try {
    await api('/admin/reports/' + id + '/suspend-offender', { method: 'POST' });
    toast('تم إيقاف الحساب');
    renderAdminReports();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- admin: users ----------
let lastAdminUsersList = [];
async function renderAdminUsers() {
  const el = document.getElementById('admin-users');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  const search = document.getElementById('admin-users-search').value.trim();
  try {
    const { users } = await api('/admin/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
    lastAdminUsersList = users;
    el.innerHTML = users.length ? users.map((u) => `
      <div class="settings-row" onclick="openAdminUser('${u.id}')">
        <span class="status-dot ${u.status === 'active' ? 'status-dot-success' : 'status-dot-danger'}"></span>
        <span>${escapeHtml(u.full_name)}${u.is_admin ? ' <span class="badge badge-success">مشرف</span>' : ''}<br><span class="muted">${escapeHtml(u.email)}</span></span>
        <i data-lucide="chevron-left" class="icon chev"></i>
      </div>
    `).join('') : '<p class="muted center">لا يوجد مستخدمون مطابقون</p>';
    refreshIcons();
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
let adminUserId = null;
function openAdminUser(id) {
  adminUserId = id;
  go('admin-user');
}
async function renderAdminUserDetail(id) {
  const infoEl = document.getElementById('admin-user-info');
  const listingsEl = document.getElementById('admin-user-listings');
  const reviewsEl = document.getElementById('admin-user-reviews');
  document.getElementById('admin-user-title').textContent = 'جارِ التحميل...';
  infoEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  listingsEl.innerHTML = '';
  reviewsEl.innerHTML = '';
  try {
    const [{ listings }, { reviews }] = await Promise.all([
      api('/admin/users/' + id + '/listings'),
      api('/admin/users/' + id + '/reviews'),
    ]);
    // Display fields (name/email/status/is_admin) come from the already-
    // fetched users list (renderAdminUsers) rather than a second lookup —
    // /admin/users only supports name/email search, not lookup by id.
    let full_name = '—', email = '', status = 'active', is_admin = false;
    const matched = lastAdminUsersList.find((u) => u.id === id);
    if (matched) ({ full_name, email, status, is_admin } = matched);

    document.getElementById('admin-user-title').textContent = full_name;
    infoEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div><p style="font-weight:700;">${escapeHtml(full_name)}${is_admin ? ' <span class="badge badge-success">مشرف</span>' : ''}</p><p class="muted" style="font-size:var(--fs-sm);">${escapeHtml(email)}</p></div>
        <span class="status-dot ${status === 'active' ? 'status-dot-success' : 'status-dot-danger'}"></span>
      </div>
      <button class="btn-outline" ${is_admin ? 'disabled title="لا يمكن إيقاف حساب المشرف"' : ''} onclick="toggleAdminUserStatus('${id}','${status}')">${status === 'active' ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button>
    `;

    listingsEl.innerHTML = listings.length ? listings.map((l) => `
      <div class="listing-card">
        <div class="listing-thumb" onclick="openDetail('${l.id}')">${l.thumbnail_url ? `<img src="${l.thumbnail_url}" onerror="handleImgError(this)">` : icon('package', 'icon-lg')}</div>
        <div class="listing-info">
          <div class="title" onclick="openDetail('${l.id}')">${escapeHtml(l.title)}</div>
          <div class="price">${formatPrice(l.price, l.currency)}</div>
          <span class="badge ${l.status === 'active' ? 'badge-success' : l.status === 'archived' ? 'badge-warning' : 'badge-danger'}" style="margin-top:4px;">${l.status === 'active' ? 'نشط' : l.status === 'archived' ? 'مؤرشف' : l.status === 'sold' ? 'مباع' : 'محذوف'}</span>
          <button class="btn-ghost card-action-btn" style="color:var(--danger);" onclick="adminDeleteListing('${l.id}')">${icon('trash-2', 'icon-xs')} حذف</button>
        </div>
      </div>
    `).join('') : '<p class="muted">لا توجد إعلانات</p>';

    reviewsEl.innerHTML = reviews.length ? reviews.map((rv) => `
      <div class="settings-row" style="align-items:flex-start;">
        <span>
          <span style="display:flex; align-items:center; gap:5px; margin-bottom:2px;">${icon('star', 'icon-sm icon-star-filled')} <b>${rv.rating}</b> ${rv.hidden ? '<span class="badge badge-danger">مخفي</span>' : ''}</span>
          <span style="font-size:var(--fs-sm);">${escapeHtml(rv.comment || '—')}</span><br>
          <span class="muted" style="font-size:var(--fs-xs);">${escapeHtml(rv.reviewer_name)} · ${formatDateTime(rv.created_at)}</span>
        </span>
        <button class="btn-ghost" style="border:1px solid var(--border); flex-shrink:0;" onclick="toggleReviewHidden('${rv.id}', ${!rv.hidden}, '${id}')">${rv.hidden ? 'إظهار' : 'إخفاء'}</button>
      </div>
    `).join('') : '<p class="muted">لا توجد تقييمات</p>';
    refreshIcons();
  } catch (err) {
    infoEl.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
async function toggleAdminUserStatus(id, currentStatus) {
  const status = currentStatus === 'active' ? 'suspended' : 'active';
  try {
    await api('/admin/users/' + id + '/status', { method: 'PATCH', body: { status } });
    // Keep the cached users list (renderAdminUserDetail's only source for
    // name/email/status/is_admin, see its own comment) in sync — otherwise
    // the re-render below still shows the pre-toggle status/button label
    // until the admin goes back and reopens this user from the list.
    const cached = lastAdminUsersList.find((u) => u.id === id);
    if (cached) cached.status = status;
    toast('تم التحديث');
    renderAdminUserDetail(id);
  } catch (err) {
    toast(err.message);
  }
}
async function adminDeleteListing(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الإعلان نهائياً؟')) return;
  try {
    await api('/admin/listings/' + id, { method: 'DELETE' });
    toast('تم حذف الإعلان');
    renderAdminUserDetail(adminUserId);
  } catch (err) {
    toast(err.message);
  }
}
async function toggleReviewHidden(id, hidden, userId) {
  try {
    await api('/admin/reviews/' + id + '/hidden', { method: 'PATCH', body: { hidden } });
    toast(hidden ? 'تم إخفاء التقييم' : 'تم إظهار التقييم');
    renderAdminUserDetail(userId);
  } catch (err) {
    toast(err.message);
  }
}
async function adminDeleteComment(id) {
  if (!confirm('هل أنت متأكد من حذف هذا التعليق؟')) return;
  try {
    await api('/admin/comments/' + id, { method: 'DELETE' });
    toast('تم حذف التعليق');
    renderComments();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- admin: support messages ----------
async function renderAdminSupport() {
  const el = document.getElementById('admin-support');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  const status = document.getElementById('admin-support-status').value;
  try {
    const { messages } = await api('/admin/support' + (status ? '?status=' + status : ''));
    el.innerHTML = messages.length ? messages.map((m) => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
          <div><p style="font-weight:700; font-size:var(--fs-sm);">${escapeHtml(m.user_name)}</p><p class="muted" style="font-size:var(--fs-xs);">${escapeHtml(m.user_email)}</p></div>
          <span class="badge ${m.status === 'answered' ? 'badge-success' : 'badge-warning'}">${SUPPORT_STATUS_LABELS[m.status]}</span>
        </div>
        <p class="muted" style="font-size:var(--fs-xs); margin-bottom:4px;">${escapeHtml((meta.support_issue_types.find((t) => t.value === m.issue_type) || {}).label || m.issue_type)} · ${formatDateTime(m.created_at)}</p>
        <p style="font-size:var(--fs-sm); line-height:1.6; margin-bottom:8px;">${escapeHtml(m.description)}</p>
        ${m.image_url ? `<img src="${m.image_url}" style="max-width:100%; border-radius:var(--radius-sm); margin-bottom:8px;">` : ''}
        ${m.admin_reply ? `<div style="background:var(--blue-light); border-radius:var(--radius-sm); padding:10px 12px; margin-bottom:8px;"><p class="muted" style="font-size:var(--fs-xs); margin-bottom:3px;">ردّك</p><p style="font-size:var(--fs-sm); color:var(--blue);">${escapeHtml(m.admin_reply)}</p></div>` : ''}
        <textarea id="support-reply-${m.id}" placeholder="اكتب ردك هنا..." style="min-height:60px;"></textarea>
        <button class="btn-outline" onclick="replySupportMessage('${m.id}')">${m.admin_reply ? 'تحديث الرد' : 'إرسال الرد'}</button>
      </div>
    `).join('') : '<p class="muted center">لا توجد رسائل دعم</p>';
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}
async function replySupportMessage(id) {
  const textarea = document.getElementById('support-reply-' + id);
  const reply = textarea.value.trim();
  if (!reply) return toast('اكتب نص الرد');
  try {
    await api('/admin/support/' + id + '/reply', { method: 'POST', body: { reply } });
    toast('تم إرسال الرد');
    renderAdminSupport();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- admin: audit log ----------
async function renderAdminLog() {
  const el = document.getElementById('admin-log');
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>جارِ التحميل...</div>';
  try {
    const { actions } = await api('/admin/actions');
    el.innerHTML = actions.length ? actions.map((a) => `
      <div class="settings-row" style="cursor:default;">
        <span>
          <b>${ADMIN_ACTION_LABELS[a.action] || a.action}</b><br>
          <span class="muted" style="font-size:var(--fs-sm);">${escapeHtml(a.details)}</span><br>
          <span class="muted" style="font-size:var(--fs-xs);">${escapeHtml(a.admin_name)} · ${formatDateTime(a.created_at)}</span>
        </span>
      </div>
    `).join('') : '<p class="muted center">لا توجد إجراءات مسجّلة بعد</p>';
  } catch (err) {
    el.innerHTML = `<p class="muted">تعذّر تحميل البيانات: ${escapeHtml(err.message)}</p>`;
  }
}

bootstrap();
