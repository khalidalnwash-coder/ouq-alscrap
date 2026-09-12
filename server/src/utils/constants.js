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

// ---------------------------------------------------------------------------
// "Vehicle sections" — دراجات نارية / سيارات كاملة / شاحنات وتريلات.
// Each is the same pattern: pick a manufacturer (+ "أخرى" for a custom name)
// -> browse/post parts for that manufacturer (with an optional model filter)
// -> or browse/post a whole damaged vehicle (manufacturer + model + year +
// damage_severity required). All three reuse the listings/listing_media
// tables — category is 'motorcycle' | 'full_car' | 'truck', distinguished
// from a part by listing_type ('part' | 'whole'). This is unrelated to the
// original ungated "قطع غيار" (category='spare_part') flow, which stays a
// separate, simpler, manufacturer-optional flow as it always was.
//
// Model lists are a curated, practically-sized set of common GCC-market
// models per manufacturer — not an exhaustive catalog. 'أخرى' at the model
// level (present for every manufacturer) covers anything not listed, same
// pattern as the manufacturer-level 'أخرى'.

const VEHICLE_LABELS = {
  motorcycle: 'دراجة نارية',
  full_car: 'سيارة',
  truck: 'شاحنة',
};

const MOTORCYCLE_MAKES = [
  'ياماها', 'هوندا', 'كاواساكي', 'سوزوكي', 'BMW', 'دوكاتي',
  'هارلي ديفيدسون', 'KTM', 'تريومف', 'رويال إنفيلد', 'أخرى',
];
const MOTORCYCLE_MODELS_BY_MAKE = {
  'ياماها': ['R1', 'R6', 'MT-07', 'MT-09', 'YZF-R3', 'Tenere 700', 'XSR900', 'أخرى'],
  'هوندا': ['CBR500R', 'CBR600RR', 'CBR1000RR', 'CB650R', 'Africa Twin', 'Rebel 500', 'أخرى'],
  'كاواساكي': ['Ninja 300', 'Ninja 400', 'Ninja ZX-6R', 'Ninja ZX-10R', 'Z650', 'Z900', 'Versys 650', 'أخرى'],
  'سوزوكي': ['GSX-R600', 'GSX-R750', 'GSX-R1000', 'SV650', 'V-Strom 650', 'أخرى'],
  'BMW': ['S1000RR', 'R1250GS', 'F850GS', 'G310R', 'أخرى'],
  'دوكاتي': ['Panigale V2', 'Panigale V4', 'Monster', 'Multistrada', 'أخرى'],
  'هارلي ديفيدسون': ['Iron 883', 'Street Bob', 'Road King', 'Fat Boy', 'أخرى'],
  'KTM': ['Duke 390', 'Duke 790', 'RC 390', 'Adventure 390', 'أخرى'],
  'تريومف': ['Street Triple', 'Speed Triple', 'Tiger 900', 'Bonneville', 'أخرى'],
  'رويال إنفيلد': ['Classic 350', 'Meteor 350', 'Himalayan', 'Continental GT', 'أخرى'],
};

const CAR_MAKES = [
  'تويوتا', 'نيسان', 'هيونداي', 'كيا', 'مرسيدس-بنز', 'بي إم دبليو',
  'لكزس', 'فورد', 'شيفروليه', 'جي إم سي', 'هوندا', 'ميتسوبيشي', 'أخرى',
];
const CAR_MODELS_BY_MAKE = {
  'تويوتا': ['كامري', 'كورولا', 'لاند كروزر', 'هايلكس', 'برادو', 'يارس', 'راف 4', 'أفالون', 'أخرى'],
  'نيسان': ['التيما', 'صني', 'باترول', 'إكس تريل', 'نافارا', 'مكسيما', 'أخرى'],
  'هيونداي': ['سوناتا', 'النترا', 'توسان', 'سنتافي', 'أكسنت', 'أخرى'],
  'كيا': ['سيراتو', 'سبورتاج', 'أوبتيما', 'ريو', 'سورينتو', 'أخرى'],
  'مرسيدس-بنز': ['C200', 'E200', 'S500', 'GLE', 'GLC', 'أخرى'],
  'بي إم دبليو': ['320i', '520i', 'X5', 'X3', 'X6', 'أخرى'],
  'لكزس': ['ES350', 'LX570', 'RX350', 'GX460', 'أخرى'],
  'فورد': ['F150', 'إكسبلورر', 'فيوجن', 'موستنج', 'أخرى'],
  'شيفروليه': ['تاهو', 'كابرس', 'ماليبو', 'سلفرادو', 'أخرى'],
  'جي إم سي': ['يوكن', 'سييرا', 'أكاديا', 'أخرى'],
  'هوندا': ['أكورد', 'سيفيك', 'سي آر في', 'بايلوت', 'أخرى'],
  'ميتسوبيشي': ['لانسر', 'باجيرو', 'أوتلاندر', 'أخرى'],
};

const TRUCK_MAKES = [
  'مرسيدس-بنز', 'فولفو', 'سكانيا', 'MAN', 'إيسوزو', 'هينو',
  'إيفيكو', 'فوسو', 'داف', 'فريتلاينر', 'ماك', 'سينوتراك', 'أخرى',
];
const TRUCK_MODELS_BY_MAKE = {
  'مرسيدس-بنز': ['أكتروس', 'أروكس', 'أكسور', 'أتيغو', 'أخرى'],
  'فولفو': ['FH', 'FM', 'FMX', 'FH16', 'أخرى'],
  'سكانيا': ['R-Series', 'G-Series', 'P-Series', 'S-Series', 'أخرى'],
  'MAN': ['TGX', 'TGS', 'TGM', 'TGL', 'أخرى'],
  'إيسوزو': ['NPR', 'FVR', 'FRR', 'NQR', 'أخرى'],
  'هينو': ['300 Series', '500 Series', '700 Series', 'أخرى'],
  'إيفيكو': ['Eurocargo', 'Trakker', 'Stralis', 'أخرى'],
  'فوسو': ['Canter', 'Fighter', 'Super Great', 'أخرى'],
  'داف': ['XF', 'CF', 'LF', 'أخرى'],
  'فريتلاينر': ['Cascadia', 'Coronado', 'M2', 'أخرى'],
  'ماك': ['Anthem', 'Granite', 'Pinnacle', 'أخرى'],
  'سينوتراك': ['هاوو A7', 'هاوو T7', 'هاوو T5G', 'أخرى'],
};

const VEHICLE_CATEGORIES = ['motorcycle', 'full_car', 'truck'];
const VEHICLE_MAKES = { motorcycle: MOTORCYCLE_MAKES, full_car: CAR_MAKES, truck: TRUCK_MAKES };
const VEHICLE_MODELS_BY_MAKE = {
  motorcycle: MOTORCYCLE_MODELS_BY_MAKE,
  full_car: CAR_MODELS_BY_MAKE,
  truck: TRUCK_MODELS_BY_MAKE,
};

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
  VEHICLE_LABELS,
  VEHICLE_CATEGORIES,
  VEHICLE_MAKES,
  VEHICLE_MODELS_BY_MAKE,
  MOTORCYCLE_MAKES,
};
