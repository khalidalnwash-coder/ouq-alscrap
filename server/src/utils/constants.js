// GCC-wide country/currency data. Phase 1 originally launched Saudi-only;
// per explicit product direction this now opens up to all six GCC
// countries (signup, listing location, browsing/search) — the DB schema
// already supported this from day one (see schema.sql), so this widening
// is purely an API/UI change, no migration needed.

const COUNTRIES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];
const DEFAULT_COUNTRY = 'SA';

const COUNTRY_LABELS = {
  SA: 'السعودية',
  AE: 'الإمارات',
  KW: 'الكويت',
  QA: 'قطر',
  BH: 'البحرين',
  OM: 'عُمان',
};

// Flag emoji are a deliberate, explicit exception to the "no emoji in the
// UI" design rule — there is no icon-font equivalent for national flags,
// and a country selector without one reads as broken to users used to the
// convention. Used only for country pickers, nowhere else.
const COUNTRY_FLAGS = {
  SA: '🇸🇦',
  AE: '🇦🇪',
  KW: '🇰🇼',
  QA: '🇶🇦',
  BH: '🇧🇭',
  OM: '🇴🇲',
};

const COUNTRY_PHONE_CODE = {
  SA: '+966',
  AE: '+971',
  KW: '+965',
  QA: '+974',
  BH: '+973',
  OM: '+968',
};

// Each GCC country has one native currency, so a listing's currency is
// always derived server-side from its country — never taken from the
// client — to keep the two consistent.
const COUNTRY_CURRENCY = {
  SA: 'SAR',
  AE: 'AED',
  KW: 'KWD',
  QA: 'QAR',
  BH: 'BHD',
  OM: 'OMR',
};

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR'];
const DEFAULT_CURRENCY = 'SAR';

const CURRENCY_LABELS = {
  SAR: 'ريال سعودي',
  AED: 'درهم إماراتي',
  KWD: 'دينار كويتي',
  QAR: 'ريال قطري',
  BHD: 'دينار بحريني',
  OMR: 'ريال عماني',
};

const COUNTRY_CITIES = {
  SA: ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'الطائف', 'تبوك', 'الخبر'],
  AE: ['دبي', 'أبوظبي', 'الشارقة', 'عجمان', 'رأس الخيمة', 'الفجيرة', 'أم القيوين', 'العين'],
  KW: ['مدينة الكويت', 'حولي', 'الفروانية', 'الجهراء', 'الأحمدي', 'مبارك الكبير'],
  QA: ['الدوحة', 'الريان', 'الوكرة', 'الخور', 'أم صلال', 'الشمال'],
  BH: ['المنامة', 'المحرق', 'الرفاع', 'مدينة عيسى', 'مدينة حمد', 'سترة'],
  OM: ['مسقط', 'صلالة', 'صحار', 'نزوى', 'صور', 'البريمي'],
};

// Section 6 of the spec — spare-part category taxonomy.
// Reused as-is for motorcycle parts too (product decision: same taxonomy,
// no separate motorcycle-specific part categories).
const PART_CATEGORIES = [
  'مصابيح وإضاءة',
  'زجاج',
  'أبواب',
  'شاصي وهيكل',
  'محرك وقير',
  'داخلية ومقاعد',
  'جنط وإطارات',
  'فرامل وتعليق',
  'صدامات وأجزاء خارجية',
  'كهرباء وحساسات',
  'تكييف وتبريد',
  'أخرى',
];

// Motorcycle manufacturers — used both to scope the parts browser ("قطع غيار
// [ماركة]") and as the make of a whole damaged motorcycle listing.
// 'أخرى' is a catch-all: the client prompts for a custom name and, from
// that point on, just treats it as a normal free-text manufacturer name.
const MOTORCYCLE_MAKES = [
  'ياماها',
  'هوندا',
  'كاواساكي',
  'سوزوكي',
  'BMW',
  'دوكاتي',
  'هارلي ديفيدسون',
  'KTM',
  'تريومف',
  'رويال إنفيلد',
  'أخرى',
];

module.exports = {
  COUNTRIES,
  DEFAULT_COUNTRY,
  COUNTRY_LABELS,
  COUNTRY_FLAGS,
  COUNTRY_PHONE_CODE,
  COUNTRY_CURRENCY,
  CURRENCIES,
  DEFAULT_CURRENCY,
  CURRENCY_LABELS,
  COUNTRY_CITIES,
  PART_CATEGORIES,
  MOTORCYCLE_MAKES,
};
