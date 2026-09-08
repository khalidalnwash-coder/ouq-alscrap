// Phase 1 scope: single country (Saudi Arabia), single listing category (spare parts).
// Full GCC country/currency lists are kept here (not just SA) so Phase 2 can widen
// scope by relaxing the API-layer checks below, without touching the DB schema.

const COUNTRIES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];
const PHASE1_COUNTRY = 'SA';

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR'];
const PHASE1_CURRENCY = 'SAR';

const CITIES_SA = ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'الطائف', 'تبوك', 'الخبر'];

// Section 6 of the spec — spare-part category taxonomy.
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

module.exports = {
  COUNTRIES,
  PHASE1_COUNTRY,
  CURRENCIES,
  PHASE1_CURRENCY,
  CITIES_SA,
  PART_CATEGORIES,
};
