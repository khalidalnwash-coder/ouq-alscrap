// Phase 1 scope: single country (Saudi Arabia), single listing category (spare parts).
// Full GCC country/currency lists are kept here (not just SA) so Phase 2 can widen
// scope by relaxing the API-layer checks below, without touching the DB schema.

const COUNTRIES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];
const PHASE1_COUNTRY = 'SA';

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR'];
const PHASE1_CURRENCY = 'SAR';

const CITIES_SA = ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'الطائف', 'تبوك', 'الخبر'];

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
// 'أخرى' is a catch-all: the client collects a free-text name for it via
// compatible_make_other, which the server stores as the real compatible_make.
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
  PHASE1_COUNTRY,
  CURRENCIES,
  PHASE1_CURRENCY,
  CITIES_SA,
  PART_CATEGORIES,
  MOTORCYCLE_MAKES,
};
