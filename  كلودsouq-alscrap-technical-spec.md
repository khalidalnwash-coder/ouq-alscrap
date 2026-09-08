# سوق السكراب (Souq Al-Scrap) — Technical Specification

## Purpose of this document
This is a build-ready spec for an AI coding assistant (Claude Code) to scaffold and implement the application. It covers data models, screens, business logic, and constraints. All user-facing text must be in Arabic (RTL layout) as the primary language.

---

## 1. App overview

A regional (GCC-wide) marketplace app connecting:
- Individuals with damaged/wrecked/totaled vehicles (sellers of whole vehicles)
- Scrapyard/junkyard traders ("تشليح") who buy wrecks, dismantle them, and resell parts
- Buyers searching for vehicles, trucks, heavy equipment, and spare parts across ALL GCC countries (Saudi Arabia, UAE, Kuwait, Qatar, Bahrain, Oman)

**Core differentiator:** cross-border search — a user in Saudi Arabia can search for a part listed in the UAE, Kuwait, etc., and vice versa.

**Critical constraint:** The platform is an information/listing intermediary ONLY. It never touches, holds, or processes payment between buyer and seller for the underlying vehicle/part transaction. Payment between transacting parties happens entirely off-platform (bank transfer, cash, etc.), arranged directly between the two users via in-app chat.

**Recommended stack (suggest, not mandatory — confirm with user before committing):**
- Mobile-first responsive web app or React Native / Flutter for iOS+Android
- Backend: Node.js/Express or similar, REST or GraphQL API
- Database: PostgreSQL (relational data with strong category/attribute needs)
- Media storage: S3-compatible object storage / CDN (NOT local server disk) — see Section 7
- RTL Arabic UI throughout; English as secondary future locale (data model should support i18n from day one even if only Arabic ships first)

---

## 2. Core data models

### User
```
id, full_name, account_type (enum: trader | individual),
phone_country_code, phone_number (required),
email (required),
otp_verified_channel (enum: whatsapp | email),
password_hash, age, country (enum: SA|AE|KW|QA|BH|OM),
verified_at (timestamp, regardless of which channel was used),
pledge_accepted_at (timestamp — see Section 9 commitment text),
terms_accepted_at,
notifications_enabled (bool),
is_verified_trader (bool — badge, manually or criteria-based),
rating_avg (decimal), completed_deals_count (int),
status (enum: active | suspended),
created_at
```

### Listing
```
id, seller_id (FK User),
category (enum: full_car | truck | heavy_equipment | spare_part),
title, description (free text),
country, city (city options depend on selected country — see Section 6),
price, currency (enum: SAR|AED|KWD|QAR|BHD|OMR),
status (enum: active | archived | sold | removed),
last_updated_at (drives the 24h "bump" and archival timers — see Section 8),
created_at,

-- category-specific fields (store as JSON column or separate sub-tables):
-- full_car / truck: make, model, year, damage_severity (enum: light|medium|severe)
-- spare_part: part_category (enum — see Section 6), compatible_make, compatible_model, compatible_year_range
```

### ListingMedia
```
id, listing_id (FK), type (enum: image | video),
original_url, thumbnail_url (only for images — see Section 7),
duration_seconds (video only), order_index
```

### Contact (mutual connections)
```
id, requester_id (FK User), recipient_id (FK User),
status (enum: pending | accepted),
created_at
```
Constraint: a Contact only becomes usable/visible in both users' contact lists once status = accepted.

### Rating
```
id, listing_id or deal_id, rater_id, rated_user_id,
stars (1-5), is_confirmed_deal (bool — true only if linked to a confirmed transaction)
```

### Comment
```
id, listing_id, user_id, text, is_confirmed_buyer (bool badge), created_at
```

### Report
```
id, reporter_id, target_type (enum: listing | account),
target_id, reason (enum — see Section 10 for the exact reason list, differs by target_type),
details (free text, optional),
status (enum: pending | reviewed | resolved),
created_at
```

### Transaction (self-reported, non-monetary)
```
id, listing_id, buyer_id, seller_id,
deal_amount, currency,
commission_amount (computed: deal_amount * 0.025),
commission_status (enum: pending | user_confirmed_paid),
confirmed_at
```
Note: `commission_status` is a self-attestation only. The platform never verifies or processes the transfer — no proof-of-payment upload is required (explicit product decision, see Section 11).

---

## 3. Authentication & onboarding flow (exact sequence)

**Screen 1 — Landing (on app open):**
- "إنشاء حساب جديد" (Create account)
- "تسجيل الدخول" (Log in)
- "تصفّح بدون تسجيل" (Browse without an account) — allows unauthenticated browsing of listings; login is required only to message a seller, post a listing, or use account features

**Screen 2 — Sign-up form** (all fields required unless noted):
- Full name
- Account type toggle: "تشليح / تاجر" (trader) or "فرد / مشتري" (individual)
- Phone: country-code dropdown (SA +966, AE +971, KW +965, QA +974, BH +973, OM +968) + number
- Email
- Age
- Country (dropdown, GCC countries only)
- Password
- Commitment checkbox (mandatory, cannot submit without checking) — exact text in Section 9
- Submit → proceed to Screen 2b (OTP delivery choice), does NOT create an active account yet

**Screen 2b — OTP delivery method choice:**
- Two selectable options (radio-style cards), WhatsApp pre-selected as default:
  - "عبر واتساب" (via WhatsApp) — subtitle: "أسرع وأكثر شيوعاً" (faster, more common)
  - "عبر البريد الإلكتروني" (via email) — subtitle: "إذا ما كان واتسابك مفعّل بهذا الرقم" (if WhatsApp isn't active on this number)
- Single button "إرسال الكود" (send code) sends the OTP via whichever channel is selected

**Screen 3 — OTP verification:**
- 4-digit OTP code input, sent via the channel chosen in Screen 2b (WhatsApp message or email)
- Screen heading and the "sent to" display line adapt to the chosen channel (show the phone number if WhatsApp was chosen, the email address if email was chosen)
- Resend button disabled for 45 seconds (countdown), then re-enabled
- On correct code: account becomes active, proceed to Screen 4
- Footnote line also adapts: if verified via WhatsApp, note that the email is stored for contact purposes only (not verified); if verified via email, note the same for the phone number

**Implementation note:** WhatsApp delivery requires a Meta-approved WhatsApp Business API account plus a provider such as Twilio, and carries a small per-message cost (cheaper than SMS but not free). This must be set up and the business WhatsApp number registered before this flow can go live — treat the WhatsApp branch as gated on that setup being complete; email delivery has no such dependency and can ship first if needed.

**Screen 4 — Notification permission:**
- Native push permission prompt with explanatory copy
- "تفعيل الإشعارات" primary button, "لاحقاً" (later) secondary/skip — must not block progress

**Screen 5 — Terms & Conditions:**
- Scrollable T&C text (must state platform is an information/listing intermediary only, not a party to payment — see Section 1)
- Mandatory checkbox: "قرأت ووافقت على الشروط والأحكام وسياسة الخصوصية"
- Submit → user lands on home feed

**Forgot password flow** (separate entry point from login screen):
1. Enter phone or email
2. Send OTP via the same WhatsApp-or-email choice pattern as Screen 2b/3 above
3. Same screen: enter OTP + new password field
4. Submit → password updated, redirect to login

**Explicit product decisions to respect:**
- SMS-based OTP is NOT used anywhere (cost reasons). Verification is via WhatsApp OR email, user's choice (Screen 2b above) — never both required, never SMS.
- Whichever channel (phone or email) is NOT used for verification in a given signup remains an unverified, informational-only field for that user.

---

## 4. Home screen

- Top bar: country selector + currency selector (persisted as user preference, changeable anytime)
- Search bar (searches listings by keyword)
- Category grid (4 tappable cards): سيارات كاملة (full cars), شاحنات وتريلات (trucks), قطع غيار (spare parts), معدات ثقيلة/دبابات (heavy equipment)
- Bottom navigation: Home, Search, **+ (floating, prominent — create listing)**, Messages, Profile

---

## 5. Listing detail screen

Elements, top to bottom:
- Media gallery (images + video, swipeable)
- Title, damage-severity badge (for vehicles)
- Location (city, country) with pin icon
- Seller mini-card: avatar/initials, name, "موثّق" (verified) badge if applicable — tappable to open full seller profile
- Rating summary: star average + review count + completed deals count
- Price + "تواصل مع البائع" (contact seller) button — opens in-app chat, does NOT initiate any payment flow
- "إبلاغ" (report) button next to contact button — opens Report modal (see Section 10, listing reasons)
- Comments section: list of comments, "صفقة موثقة" (verified deal) badge on comments from users with a confirmed Transaction tied to this listing; free-text comment input at the bottom

---

## 6. Category taxonomy (spare parts)

Horizontal scrollable filter strip (RTL — starts from the right), tapping a category instantly filters the results below without navigating to a new page:

1. مصابيح وإضاءة (Lights)
2. زجاج (Glass)
3. أبواب (Doors)
4. شاصي وهيكل (Chassis/body)
5. محرك وقير (Engine/transmission)
6. داخلية ومقاعد (Interior/seats)
7. جنط وإطارات (Wheels/tires)
8. فرامل وتعليق (Brakes/suspension)
9. صدامات وأجزاء خارجية (Bumpers/exterior)
10. كهرباء وحساسات (Electrical/sensors)
11. تكييف وتبريد (AC/cooling)
12. أخرى (Other)

Additional filter row: compatibility (Make / Model / Year) — cascading dropdowns.

---

## 7. Media upload pipeline (critical for cost control)

**Upload limits (enforce client-side AND server-side):**
- Images: max 10 per listing, 5 MB each, JPG/PNG only
- Video: max 1 per listing, max 60 seconds, max 50 MB, MP4 only

**Processing pipeline (must happen server-side immediately on upload, before the listing is published):**
1. Client uploads raw file
2. Server compresses immediately (lossy compression tuned for negligible visible quality loss)
3. Server generates a separate lightweight thumbnail (~150x150px) for EVERY image
4. Store two versions per image:
   - Thumbnail → used in ALL list/grid/search views (this is what loads by default everywhere except the detail screen)
   - Full compressed version → loaded ONLY when the user opens the individual listing detail screen
5. Use external object storage / CDN (e.g. S3-compatible), never store media on the same server/disk running the application

**Why this matters:** search result screens are the highest-traffic screens in the app; loading full-size images there would be slow and data-expensive for users on weaker GCC mobile networks. This is a hard requirement, not an optimization to defer.

---

## 8. Listing "daily bump" mechanic (no paid promotion at launch)

- Each listing has an "حدّث الآن" (update now) button
- Button is enabled only if `last_updated_at` is more than 24 hours in the past; otherwise disabled and shows "متاح بعد 24 س" (available in 24h)
- Tapping it: sets `last_updated_at = now()`, and search ranking sorts primarily by `last_updated_at` descending — this pushes the listing back to the top of results with a "محدّث" (updated) badge
- No monetary charge for this action. This is the sole ranking-boost mechanic at launch (explicitly replaces any pay-to-promote feature for now).

---

## 9. Commitment ("تعهد") text — exact final copy

This exact Arabic text must appear as a mandatory checkbox item during sign-up (Section 3, Screen 2). Do not alter, translate, or paraphrase it — reproduce verbatim:

```
أتعهد بالله، واستحضاراً لقول الله تعالى "وَقُل اعمَلوا فَسَيَرَى اللَّهُ عَمَلَكُم"، أن أكون أميناً في سعيي وأدفع عمولة التطبيق (2.5%) عند إتمام أي صفقة عن طريق المنصة، وإن لم أفعل فأتصدق بمثل هذا المبلغ
```

Store `pledge_accepted_at` timestamp on the User record when this checkbox is checked and the form is submitted. **Product owner note (surface this to the user, do not silently skip it): this text combines a Quranic verse with a binding commercial commitment and should be reviewed by a qualified Islamic scholar before public launch. Flag this as an open item, do not treat it as final from a religious-compliance standpoint even though the wording itself is finalized product-side.**

---

## 10. Reporting system

**Two distinct report targets, each with its own reason list:**

**Report a listing** (button on listing detail screen):
- Reasons: description doesn't match reality / suspected fraud / inappropriate content / other (free text)

**Report an account** (accessible from the "⋮" menu on any seller's profile page):
- حساب وهمي / نصب واحتيال (fake account / fraud)
- وصف الإعلانات مخالف للواقع بشكل متكرر (repeatedly inaccurate listing descriptions)
- صور غير حقيقية أو منسوخة من مصدر آخر (fake/stolen images)
- استلام مبلغ دون تسليم القطعة أو السيارة (took payment without delivering)
- تعامل مسيء أو غير لائق (abusive/inappropriate conduct)
- سبب آخر (other, free text)

**Explicitly excluded reason:** "commission evasion" / failure to pay the platform's 2.5% commission is NOT a reportable reason on either list. This is an intentional product decision — commission compliance is left entirely to the user's personal commitment (the pledge in Section 9), not policed by the platform or its users.

All reports feed into the Admin Panel report queue (Section 13) regardless of target type, with a `target_type` field to distinguish listing reports from account reports for filtering.

---

## 11. Transaction confirmation & commission settlement screen

Reachable after a deal is arranged between two users (manual trigger, e.g. a "تأكيد الصفقة" action from the chat or listing screen):

1. User enters the deal amount and selects currency (SAR/AED/KWD/QAR/BHD/OMR)
2. Screen live-calculates: deal amount, 2.5% commission rate, and the resulting commission amount owed — update in real time as the user types (no page reload/submit needed for the calculation itself)
3. Display the platform's bank account details (bank name + IBAN) with a one-tap copy icon next to the IBAN
4. Single button: "تم التحويل، تأكيد التسديد" (transfer done, confirm payment) — marks `commission_status = user_confirmed_paid` on the Transaction record
5. **Explicitly do NOT require or offer a proof-of-transfer upload (no attachment/receipt field).** This is an intentional, confirmed product decision — the platform relies entirely on the user's self-attestation and the religious pledge from Section 9, prioritizing a frictionless flow over verification.

**Deferred, not in initial build:** QR code for the IBAN, and mentioning instant-transfer network names (e.g. "سريع" in Saudi Arabia, "Aani" in the UAE) — both are blocked on the business first obtaining a bank account registered in the project's official name rather than a personal account. Leave a clear TODO/placeholder for this in the code rather than building it now.

---

## 12. Trust & relationship features

**Ratings:** star average (1-5) + completed-deal count, shown on seller profile and listing cards. A rating can only be left by a user with a `Transaction` record linking them to that seller (`is_confirmed_deal = true` badge distinguishes these from any other reviews the schema might later support).

**Comments:** open to any logged-in user on any listing. Comments from users with a confirmed Transaction on that specific listing get a "صفقة موثقة" badge.

**Mutual contacts:** one user sends a request (by phone number or user ID) to another; request sits in `pending` status until the recipient accepts, at which point both users see each other in a "جهات اتصال" (contacts) list with a quick-message shortcut. This is a bilateral opt-in — never auto-add.

---

## 13. Trader dashboard

Authenticated traders see, on their own dashboard:
- Count of active listings
- Weekly view count
- New/unread message count
- Confirmed transaction count
- A reminder banner for any unconfirmed transactions (nudges the user to confirm, since confirmation is required for their rating to update)
- Per-listing status: active / nearing archival (with a days-remaining countdown per Section 15) / archived (with a "استرجاع" restore action)

---

## 14. Admin panel (internal, not user-facing)

Restrict to internal/admin roles only. Includes:
- Top-line stats: active user count, listings posted today, deals this month, most active country
- Report queue: all `Report` records (both listing and account types), sorted newest first, with a review/resolve action
- Account management: list of users with a suspend/reactivate toggle per account

---

## 15. Auto-archival policy (storage cost control)

Applies per-listing, driven by `last_updated_at`:

| Time since last update | Action |
|---|---|
| 0–45 days | Listing active, appears normally in search |
| Day 45 | Push notification to the trader: "حدّث خلال 15 يوم وإلا يُؤرشف" (update within 15 days or it will be archived) |
| Day 60 | Listing hidden from search; media compressed further and moved to a cheaper storage tier; listing status set to `archived` |
| Day 60 + 90 more days with no restore action | Hard-delete the listing and all associated media permanently |

Also implement: a per-account cap on total active listings (prevents storage abuse by any single account), and immediate deletion of any uploaded-but-never-published media (e.g. user uploads a photo then abandons/cancels the listing draft — that file should not persist).

---

## 16. Explicit non-requirements (do not build these — confirmed product decisions)

- No in-app payment processing of any kind (no Apple Pay, no payment gateway integration, no wallet). All money movement between buyer/seller AND for commission settlement happens via manual bank transfer, arranged outside the app's payment rails.
- No SMS-based OTP anywhere — OTP is delivered via WhatsApp or email only, user's choice at signup/password-reset time (requires WhatsApp Business API setup before that channel can be enabled — see Section 3 implementation note).
- No monthly/annual subscription fee for traders.
- No pay-per-listing or pay-to-promote fee at launch (replaced by the free 24-hour "bump" mechanic in Section 8).
- No proof-of-payment upload requirement for commission settlement (Section 11).
- No phone-number verification (phone is collected but never OTP-verified).
- "Commission evasion" is never a selectable report reason (Section 10).
- No support phone/call-in line — support is WhatsApp + email only (see Section 17).

---

## 17. Support screen

Two contact methods only:
- **WhatsApp** — primary, fastest channel
- **Email** — for detailed inquiries

Display expected response hours (e.g. daily 9am–9pm) below both options.

---

## 18. Suggested build order (MVP-first)

Per product owner's explicit direction: do not build the full GCC-wide, all-category version first. Recommended phased build:

**Phase 1 (MVP):**
- Single country, single category (spare parts recommended — highest expected repeat demand)
- Core flows: sign-up/login (Sections 3), listing CRUD (Sections 6-7), listing detail + contact seller (Section 5), basic seller profile + ratings (Section 12)
- Admin panel basics (Section 14) — needed from day one for moderation even at small scale

**Phase 2:**
- Expand to remaining GCC countries
- Add remaining categories (full cars, trucks, heavy equipment)
- Transaction confirmation + commission calculator (Section 11)
- Reporting system (Section 10)
- Daily bump mechanic (Section 8)
- Auto-archival (Section 15)

**Phase 3 (post-launch, based on traction):**
- VIN-based part search
- "Notify me when available" alerts
- Cross-border shipping cost estimator
- In-chat auto-translation
- Public shareable trader storefront pages
- English localization
- QR/instant-transfer payment UX (pending official business bank account)

---

## 19. Branding reference (not a build task, informational only)

- App name: سوق السكراب ("Souq Al-Scrap")
- Primary color: blue
- Icon concept: half sports-car silhouette, half mechanical gear, on a blue rounded-square background
- **Status: concept only, not production-ready.** A professional graphic designer should be commissioned (e.g. via Fiverr/Khamsat) to produce the final app icon and logo — do not treat any auto-generated SVG version of this concept as final asset.
