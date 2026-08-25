/**
 * =============================================================================
 * BUILT BY SHAH — Standalone DAILY Negatives Sweeper (Search + PMax)
 * Version: 1.3.0 (final)
 * File: built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js
 * =============================================================================
 *
 * THIS IS THE DAILY SCRIPT (rolling 7 completed days). Schedule it after
 * 7:00 AM Pacific so Google has time to finish the prior day’s Search terms.
 * It is NOT the 90-day backfill. Backfill file:
 *   built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js
 *
 * WHO THIS IS FOR
 * ---------------
 * Anyone who wants junk search queries blocked automatically, without using
 * Hub or Spoke Google Sheets. You paste this once in the manager account (MCC),
 * list the shops you care about, and schedule it to run every morning.
 *
 *
 * WHAT THIS SCRIPT IS
 * -------------------
 * This is a Google Ads Script you paste into your **manager account (MCC)**.
 * It does **not** use a Hub spreadsheet or a Spoke spreadsheet. Everything you
 * set is inside this file (see CONFIG below).
 *
 * You pick which client accounts it may touch by listing their Account IDs in
 * CONFIG.ACCOUNT_ALLOWLIST. Accounts that are not on that list are left alone.
 *
 * This is a **different** tool from the Hub/Spoke negatives scripts. Use one
 * or the other for a shop — not both at the same time (see WARNING below).
 *
 *
 * WHAT IT DOES (IN PLAIN WORDS)
 * -----------------------------
 * Every morning (when you schedule it), for each allowlisted account it can
 * work on in that run, the script:
 *
 *   1. Looks at the **last 7 completed days** of search queries that showed ads
 *      (Search campaigns and Performance Max campaigns). Search uses
 *      search_term_view; PMax uses campaign_search_term_view. It uses that
 *      account’s own time zone. Re-reading recent days catches terms Google
 *      publishes late; existing-negative checks prevent duplicates.
 *   2. Checks each query against built-in “junk intent” rules (cheap, glass,
 *      financing, oil change, named other shops, Spanish, estimates, paint,
 *      mechanical-only, and many more). Matching is plural/stem aware
 *      (tints≈tint, bumpers≈bumper, repaint≈paint). Major auto insurer names
 *      (State Farm, GEICO, etc.) are protected automatically.
 *   3. If a query looks like junk **and** it did not convert in the 7-day
 *      action window **and**
 *      it did not convert in about the last 30 days **and** it is not already
 *      blocked, the script adds the **whole query** as an **exact** negative
 *      keyword on the **same campaign** that showed that query (AdsApp.mutateAll).
 *      Only campaigns whose name contains “Built by Shah” are touched.
 *   4. Sends **one** HTML summary email for the whole wave (not one email per
 *      shop). It lists adds, exact reasons for skipped rule matches, and Manual
 *      review terms. A CSV attachment records the terminal decision for every
 *      unique evaluated campaign term, including NO_RULE terms.
 *
 * Important details:
 *   - It adds negatives at the **campaign** level, not at the whole-account level.
 *   - It does **not** add bare words like just “paint”. It adds the full search
 *     query in exact match, like: [cheap paint near me]
 *   - It does **not** write to shared negative keyword lists. It only reads them
 *     so it does not add something that is already covered.
 *   - If something goes wrong for an account, that account is tried again later
 *     (it is not marked “done for today”).
 *
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *   - It does not change bids, ads, or budgets.
 *   - It does not use Google Sheets (no Hub, no Spoke, no review checklist).
 *   - It does not have a “Remove” checkbox. If a negative was a mistake, you
 *     delete that exact negative yourself in Google Ads.
 *   - It detects clear named competitors (possessives, multi-word brands, seed
 *     / COMPETITOR_PHRASES). City + body-shop geo intent is kept. Ambiguous
 *     single-token names are left alone (safe-side). OEM collision intent
 *     (e.g. BMW certified collision) is kept.
 *
 *
 * HOW TO SET IT UP (STEP BY STEP)
 * -------------------------------
 * 1. Open your **Google Ads manager account (MCC)**.
 * 2. Go to **Tools and settings → Bulk actions → Scripts** (or Scripts).
 * 3. Click **+** to make a **new** script. Give it a clear name, like
 *    “Standalone Daily Negatives Sweeper”.
 * 4. Delete any sample code. Paste **this whole file** into the script editor.
 * 5. Scroll to CONFIG (just below this comment block) and fill in at least:
 *      - ACCOUNT_ALLOWLIST  → every Account ID you want swept (dashes are OK)
 *        Example: '123-456-7890'
 *      - EMAIL_RECIPIENTS   → who should get the morning summary email
 *        Example: 'you@agency.com'
 * 6. Click **Authorize** / allow permissions when Google asks (Sheets are not
 *    used; it still needs Ads + email permission).
 * 7. Click **Run** once while you watch the logs, to make sure it works.
 * 8. Click **Schedule** (or Frequency) and set it to run **Daily** at 7:00 AM
 *    Pacific or later for the current Eastern/Central/Pacific account mix.
 *
 * Preview tip: If you click Preview in Google Ads, this script will **not** add
 * negatives and will **not** send email. Use **Run** (or the daily schedule) for
 * real changes.
 *
 *
 * IF YOU HAVE MORE THAN 50 ACCOUNTS ON THE ALLOWLIST
 * --------------------------------------------------
 * Google only lets one script run work on **50 accounts at a time**.
 *
 * This script is smart about that:
 *   - It picks up to 50 allowlisted accounts that are not finished yet today.
 *   - When an account finishes OK, it puts a label on that account like
 *     BbsStandaloneNeg:2026-08-20
 *     (the date uses CONFIG.QUEUE_TIME_ZONE; the prefix is CONFIG.DONE_LABEL_PREFIX)
 *   - The next run skips labeled accounts and takes the next batch.
 *
 * So if you have about 70 shops:
 *   - Make a **second** Scripts row.
 *   - Paste the **same** code again (same allowlist, same settings).
 *   - Schedule the first for e.g. 7:00 and the second for e.g. 8:00 Pacific.
 *   - You will get **two emails** that morning (one per wave). That is normal.
 *
 * Rule of thumb: number of daily runs needed ≈ (how many IDs on the allowlist) ÷ 50,
 * rounded up.
 *
 *
 * HOW TO TURN ONE SHOP ON OR OFF
 * ------------------------------
 *   - To **include** a shop: add its Account ID to ACCOUNT_ALLOWLIST, save, keep
 *     the schedule.
 *   - To **stop** a shop: remove its Account ID from ACCOUNT_ALLOWLIST and save.
 *     (You do not need a Hub flag.)
 *
 *
 * OPTIONAL SETTINGS (STILL IN CONFIG)
 * -----------------------------------
 *   DISABLED_RULE_IDS
 *     List of rule names to skip for **every** allowlisted shop.
 *     Example: ['AUTO_GLASS', 'YEAR_TOKEN']
 *
 *   PROTECTED_PHRASES
 *     Phrases that must never be auto-negatived for every shop.
 *     The Google Ads **account name** is also protected automatically.
 *
 *   COMPETITOR_PHRASES
 *     Extra competitor names for every shop (on top of built-in seed names).
 *
 *   ACCOUNT_OVERRIDES
 *     Extra rules for **one** Account ID only. Example:
 *       '1234567890': {
 *         DISABLED_RULE_IDS: ['AUTO_GLASS'],
 *         PROTECTED_PHRASES: ['mobile repair'],
 *         COMPETITOR_PHRASES: ['local rival body']
 *       }
 *
 *   QUEUE_TIME_ZONE
 *     Used only to decide the “today” date on the done label (default:
 *     America/Los_Angeles). Each shop still uses its own Ads time zone for
 *     the rolling completed-day search-term window.
 *
 *   DONE_LABEL_PREFIX
 *     First part of the done label. Full label looks like:
 *     BbsStandaloneNeg:2026-08-20
 *
 *   EMAIL_FROM_NAME
 *     The name that shows on the summary email.
 *
 * Leave the other CONFIG numbers alone unless you know what they do (character
 * limits, conversion guards, safety ceiling, and so on).
 *
 *
 * THE MORNING EMAIL
 * -----------------
 * After each wave, people on EMAIL_RECIPIENTS get an HTML email with:
 *   - How many accounts ran
 *   - How many exact negatives were added
 *   - Per account: channel (SEARCH or PMAX), campaign name, the [exact negative],
 *     which rules matched, and a reconciled decision funnel
 *   - A CSV audit attachment with every evaluated unique campaign term
 *   - Short notes on failures, if any
 *
 * If nothing was added, you still get a short “we ran” / all-clear style email
 * so you know the job fired. If EMAIL_RECIPIENTS is empty, the script still adds
 * negatives but skips the email and writes a note in the script log.
 *
 *
 * IF A NEGATIVE WAS A MISTAKE
 * ---------------------------
 * Open that Google Ads account → find the campaign → Negatives → delete the
 * exact match that should not be there. The next morning the script will not
 * re-add it if the query no longer appears as a new eligible junk term (and it
 * will skip queries already covered by an existing negative).
 *
 *
 * WARNING — DO NOT DOUBLE-RUN WITH THE HUB SWEEPER
 * ------------------------------------------------
 * Do **not** put the same Account ID on this allowlist **and** turn on Hub
 * “Negatives Sweeper Enabled” for that shop. Both scripts could add the same
 * kind of negatives and make a mess. Pick one system per shop.
 *
 *
 * LONGER GUIDE (OPTIONAL)
 * -----------------------
 * docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md
 *
 * =============================================================================
 */

var CONFIG = {
  ACCOUNT_ALLOWLIST: [
    'ACCOUNT_01',
    'ACCOUNT_02',
    'ACCOUNT_03',
    'ACCOUNT_04'
  ],
  DISABLED_RULE_IDS: [],
  PROTECTED_PHRASES: [],
  COMPETITOR_PHRASES: [],
  ACCOUNT_OVERRIDES: {
    // '1234567890': {
    //   DISABLED_RULE_IDS: ['AUTO_GLASS'],
    //   PROTECTED_PHRASES: ['mobile repair'],
    //   COMPETITOR_PHRASES: ['local rival body']
    // }
  },
  EMAIL_RECIPIENTS: [
    'EMAIL_01',
    'EMAIL_02',
    'EMAIL_03',
    'EMAIL_04'
  ],
  EMAIL_FROM_NAME: 'Built by Shah Daily Negatives',
  QUEUE_TIME_ZONE: 'America/Los_Angeles',
  DONE_LABEL_PREFIX: 'BbsStandaloneNeg',
  // Re-scan recent completed days so late-published Search terms get another chance.
  ACTION_WINDOW_DAYS: 7,
  HISTORICAL_GUARD_DAYS: 30,
  MIN_ACTION_IMPRESSIONS: 1,
  MAX_ACTION_CONVERSIONS: 0,
  MAX_HISTORICAL_CONVERSIONS: 0,
  MAX_NEGATIVE_KEYWORD_CHARACTERS: 80,
  MAX_NEGATIVE_KEYWORD_WORDS: 10,
  MAX_PARALLEL_ACCOUNTS: 50,
  // Cap on eligible junk terms that may be ADDED per channel per account per run.
  // Scanning / reviewing the rolling action window is uncapped.
  // The seven-day overlap is idempotent because existing negatives are checked.
  RUNAWAY_SAFETY_CEILING_PER_ACCOUNT: 5000,
  RUNAWAY_SAFETY_CEILING_PER_CHANNEL: 2500,
  MAX_LOG_ACTIONS_PER_ACCOUNT: 500,
  MAX_AUDIT_ROWS_PER_ACCOUNT: 1000,
  MAX_AUDIT_CSV_ROWS_PER_WAVE: 25000,
  ATTACH_DECISION_AUDIT_CSV: true,
  MAX_EMAIL_ADD_ROWS_PER_ACCOUNT: 60,
  MAX_EMAIL_FAIL_ROWS_PER_ACCOUNT: 12,
  MAX_EMAIL_MANUAL_REVIEW_ROWS_PER_ACCOUNT: 40,
  MAX_EMAIL_MATCHED_SKIP_ROWS_PER_ACCOUNT: 20,
  INCLUDE_PAUSED_CAMPAIGNS: false,
  // Only touch campaigns whose name contains this (case-insensitive).
  REQUIRED_CAMPAIGN_NAME_SUBSTRING: 'Built by Shah'
};


/**
 * National / major auto insurers — never exact-negative a query that contains
 * these names (token match). Prefer distinctive phrases; avoid bare tokens that
 * collide with car brands or unrelated words (e.g. "mercury" alone).
 */
var SEED_INSURER_PROTECTED_PHRASES = [
  'state farm',
  'progressive',
  'geico',
  'allstate',
  'usaa',
  'farmers insurance',
  'liberty mutual',
  'travelers',
  'nationwide',
  'american family',
  'american family insurance',
  'aaa insurance',
  'aaa claim',
  'aaa claims',
  'aaa approved',
  'aaa collision',
  'aaa auto body',
  'aaa body shop',
  'auto-owners',
  'auto owners',
  'auto-owners insurance',
  'auto owners insurance',
  'erie insurance',
  'mercury insurance',
  'the hartford',
  'hartford insurance',
  'amica',
  'amica mutual',
  'safeco',
  'chubb',
  'metlife',
  'met life'
];

var SEED_COMPETITOR_PHRASES = [
  'maaco',
  'pep boys',
  'dent doctor',
  'dent dr',
  'earl scheib',
  'earl shibe',
  'scheib',
  'earl',
  'fix auto',
  'a1',
  'f1',
  'caliber collision',
  'service king',
  'gerber collision',
  'crash champions',
  'abradors',
  'carstar',
  'ames collision center',
  'auto arena body shop',
  'body works',
  'clickmechanic',
  'collision consultants',
  'dent mavericks',
  'fast car automotive'
];

/**
 * Model-year tokens 1990–2026 for YEAR_TOKEN (aggressive; false positives expected).
 */
function buildYearTokenTriggers_() {
  var years = [];
  for (var y = 1990; y <= 2026; y++) {
    years.push(String(y));
  }
  return years;
}

/**
 * Matching is token/phrase-aware and plural/stem-aware (tints≈tint, bumpers≈bumper,
 * repaint≈paint). An exception protects only the rule on which it appears;
 * CONFIG / ACCOUNT_OVERRIDES protected phrases protect the entire query.
 *
 * Special rule ids (custom evaluators in evaluateRules_):
 *   LOCAL_COMPETITOR, NAMED_LOCAL_SHOP, BARE_MAKE_MODEL,
 *   DEALER_OR_AUTO_GROUP, LOW_INTENT_AUTO_GEO
 */
var NEGATIVE_RULES = [
  {
    id: 'DENT_MINOR',
    triggers: [
      'dent', 'dented', 'dents',
      'pull out dent', 'pull out dents',
      'suction for dent', 'suction for dents',
      'suction dent', 'dent fixer', 'chips and dents'
    ],
    exceptions: ['accident', 'collision', 'crash', 'insurance', 'claim']
  },
  {
    id: 'BUMPER_MINOR',
    triggers: ['bumper', 'bumpers', 'bumper clip', 'bumper clips', 'bumper solutions'],
    exceptions: ['accident', 'collision', 'crash', 'insurance', 'claim']
  },
  {
    id: 'PAINT_MINOR',
    triggers: [
      'paint', 'painting', 'paints', 'painter', 'painters',
      'repaint', 'repainting', 'paint special',
      'paint and body', 'bump and paint', 'auto paint',
      'automotive paint', 'caliper painting', 'paint car hood',
      'clear coat', 'clearcoat', 'coloring', 'colouring',
      'car coloring', 'vehicle coloring', 'refinish', 'refinishing'
    ],
    exceptions: []
  },
  {
    id: 'PAINTLESS_DENT',
    triggers: ['paintless', 'dent specialist', 'pdr'],
    exceptions: []
  },
  {
    id: 'SMALL_JOB',
    triggers: ['small'],
    exceptions: ['accident', 'collision', 'crash', 'insurance', 'claim']
  },
  {
    id: 'SCRATCH_OR_KEYED',
    triggers: [
      'scratch', 'scratches', 'keyed', 'scrape', 'scrapes',
      'buff out', 'fix scratch', 'fix scratches', 'fix scrape'
    ],
    exceptions: [
      'accident', 'collision', 'crash', 'insurance', 'claim', 'vandalism'
    ]
  },
  {
    id: 'EXTERIOR_PANEL_MINOR',
    triggers: [
      'hood', 'roof', 'door', 'doors', 'mirror', 'mirrors', 'plastic',
      'door handle', 'undercarriage'
    ],
    exceptions: ['accident', 'collision', 'crash', 'insurance', 'claim']
  },
  {
    id: 'AUTO_GLASS',
    triggers: [
      'glass', 'window', 'safelite', 'windshield', 'windsheild', 'crack'
    ],
    exceptions: ['fiberglass']
  },
  {
    id: 'TINT',
    triggers: ['tint', 'tints', 'tinting', 'tint removal'],
    exceptions: []
  },
  {
    id: 'DING_MINOR',
    triggers: ['ding', 'dings', 'door ding'],
    exceptions: ['accident', 'collision', 'crash', 'insurance', 'claim']
  },
  {
    id: 'DETAILING',
    triggers: [
      'detailing', 'detail', 'detailer',
      'buff', 'buffing', 'polish', 'polishing'
    ],
    exceptions: []
  },
  {
    id: 'PARTS_OR_INSTALLATION',
    triggers: [
      'install', 'installation', 'parts', 'headliner', 'seat', 'cover',
      'kit', 'body kit', 'upholstery', 'interior',
      'auto supply', 'auto parts', 'parts store', 'door handle',
      'dashboard', 'dashboard repair', 'dash repair'
    ],
    exceptions: []
  },
  {
    id: 'WHEELS_OR_EXHAUST',
    triggers: [
      'curb', 'rim', 'rims', 'exhaust', 'dr rim',
      'wheel', 'wheels', 'tire', 'tires', 'alignment',
      'bent rim', 'bent rims', 'rim repair', 'wheel repair', 'tire repair',
      'welder', 'welders', 'welding', 'car welder', 'car welders'
    ],
    exceptions: []
  },
  { id: 'COUPON', triggers: ['coupon'], exceptions: [] },
  { id: 'RUST', triggers: ['rust'], exceptions: [] },
  {
    id: 'FRAME_NON_COLLISION',
    triggers: ['frame'],
    exceptions: [
      'accident', 'collision', 'crash', 'insurance', 'claim', 'structural',
      'unibody', 'chassis', 'straightening', 'frame repair', 'frame damage'
    ]
  },
  { id: 'CAR_KEY', triggers: ['car key', 'lost key', 'key fob', 'spare key'], exceptions: [] },
  {
    id: 'MOBILE_SERVICE',
    triggers: ['mobile app', 'mobile repair', 'mobile dent', 'mobile mechanic'],
    exceptions: ['automobile']
  },
  {
    id: 'LOW_VALUE_COMPETITOR',
    triggers: [
      'maaco', 'pep boys', 'dent doctor', 'dent dr',
      'earl scheib', 'earl shibe', 'scheib',
      'fix auto',
      'kwik kar', 'midas', 'car x', 'carx', 'ziebart', 'jiffy lube'
    ],
    exceptions: []
  },
  {
    id: 'CHEAP',
    triggers: ['cheap', 'cheapest', 'cheaply', 'affordable'],
    exceptions: []
  },
  { id: 'LOCAL_COMPETITOR', triggers: [], exceptions: [] },
  { id: 'NAMED_LOCAL_SHOP', triggers: [], exceptions: [] },
  { id: 'BARE_MAKE_MODEL', triggers: [], exceptions: [] },
  { id: 'LOW_INTENT_AUTO_GEO', triggers: [], exceptions: [] },
  {
    id: 'DEALER_OR_AUTO_GROUP',
    triggers: [
      'auto group', 'dealership', 'dealerships',
      'chevrolet service', 'chevy service', 'toyota service',
      'ford service', 'honda service', 'nissan service',
      'bmw service', 'volkswagen service', 'vw service',
      'cadillac body', 'costco auto', 'costcoauto'
    ],
    exceptions: []
  },
  {
    id: 'GENERIC_CAR_REPAIR',
    triggers: [
      'car repair', 'car repair estimate',
      'auto repair', 'auto repair estimate',
      'repair shop', 'repair shops',
      'auto service', 'auto care', 'car service', 'car service center',
      'service center', 'car fix', 'car fixes', 'fix car', 'fix cars',
      'fix my engine',
      'mechanic', 'mechanics', 'auto mechanic',
      'foreign car repair', 'truck repair', 'volkswagen repair'
    ],
    exceptions: [
      'body', 'autobody', 'auto body', 'collision', 'accident', 'crash',
      'insurance', 'claim', 'fender', 'panel'
    ]
  },
  {
    id: 'CAREERS_OR_HIRING',
    triggers: [
      'auto body tech', 'auto body technician', 'body shop tech',
      'body technician', 'now hiring', 'job opening', 'job openings',
      'hiring', 'career', 'careers', 'salary', 'internship',
      'technician near me'
    ],
    exceptions: []
  },
  {
    id: 'PAYMENT_OR_FINANCING',
    triggers: [
      'payment plan', 'pay later', 'buy now pay later',
      'financing', 'finance', 'loan',
      '0 down', 'zero down', 'interest free',
      'no credit', 'bad credit',
      'affirm', 'klarna', 'afterpay'
    ],
    exceptions: []
  },
  {
    id: 'ESTIMATE_OR_QUOTE',
    triggers: [
      'estimate', 'estimates', 'quote', 'quotes',
      'free estimate', 'free quote', 'auto estimate', 'auto estimates'
    ],
    exceptions: []
  },
  {
    id: 'APPRAISAL_OR_ADJUSTER',
    triggers: ['appraisal', 'appraiser', 'adjuster', 'collision appraisal'],
    exceptions: []
  },
  {
    id: 'CLASSIC_OR_OLD_CAR',
    triggers: [
      'classic car', 'classic cars',
      'old car', 'old cars',
      'antique car', 'vintage car'
    ],
    exceptions: []
  },
  {
    id: 'MECHANICAL_REPAIR',
    triggers: [
      'air conditioning', 'ac repair', 'radiator',
      'brakes', 'brake', 'oil change',
      'transmission', 'engine repair', 'muffler',
      'tune up', 'tune-up', 'spark plug',
      'alternator', 'starter', 'engine'
    ],
    exceptions: []
  },
  {
    id: 'SALVAGE_OR_JUNKYARD',
    triggers: [
      'salvage', 'pick n pull', 'pick and pull',
      'pick a part', 'pickapart',
      'junkyard', 'junk yard', 'u pull', 'upull'
    ],
    exceptions: []
  },
  {
    id: 'SAME_DAY_OR_ONE_DAY',
    triggers: ['same day', '1 day', 'one day', 'same-day'],
    exceptions: []
  },
  { id: 'SPRINTER_VAN', triggers: ['sprinter'], exceptions: [] },
  {
    id: 'SPANISH_LANGUAGE',
    triggers: [
      'como sacar', 'sacar un golpe', 'golpe', 'golpes', 'carro', 'carros',
      'reparar', 'abolladura', 'abolladuras', 'enderezado', 'pintura',
      'cerca de mi', 'hojalateria', 'latoneria', 'taller de',
      'cuanto', 'cobran', 'quitar', 'granizo', 'lamina',
      'choque', 'colision', 'presupuesto', 'cotizacion', 'chapa y pintura'
    ],
    exceptions: []
  },
  {
    id: 'PUT_A_CLAIM_SCAMMY',
    triggers: ['put a claim'],
    exceptions: []
  },
  {
    id: 'RENOVATION',
    triggers: ['renovation', 'renovate'],
    exceptions: []
  },
  {
    id: 'BROKEN_PART',
    triggers: [
      'broken tail light', 'broken taillight',
      'broken side mirror', 'broken mirror',
      'broken headlight', 'broken bumper', 'broken windshield',
      'tail light replacement', 'taillight replacement',
      'side mirror replacement', 'mirror replacement',
      'headlight replacement'
    ],
    exceptions: []
  },
  {
    id: 'AFTERMARKET_AERO',
    triggers: ['carbon fiber', 'splitter'],
    exceptions: []
  },
  {
    id: 'REBUILD_OR_TRUCK_BODY',
    triggers: ['rebuild', 'restomod', 'truck body', 'car rebuild'],
    exceptions: []
  },
  {
    id: 'RV_OR_MOTORHOME',
    triggers: ['rv', 'motorhome', 'motor home', 'rv body'],
    exceptions: []
  },
  {
    id: 'TOWING',
    triggers: ['tow', 'towing', 'tow truck'],
    exceptions: []
  },
  {
    id: 'CUSTOM_BODY_OR_PAINT',
    triggers: [
      'custom body', 'custom paint', 'custom shop',
      'custom body shop', 'custom body shops'
    ],
    exceptions: []
  },
  {
    id: 'GARAGE_DIY_BODY',
    triggers: [
      'garage body', 'garage body work', 'diy', 'do it yourself',
      'home garage'
    ],
    exceptions: []
  },
  {
    id: 'YEAR_TOKEN',
    triggers: buildYearTokenTriggers_(),
    exceptions: []
  }
];

/** OEM brands kept when query is generic certified-collision intent (no store name). */
var OEM_COLLISION_KEEP_BRANDS = [
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy', 'chrysler',
  'dodge', 'ford', 'gmc', 'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep',
  'kia', 'lexus', 'lincoln', 'mazda', 'mercedes', 'mercedesbenz', 'benz', 'mini',
  'mitsubishi', 'nissan', 'porsche', 'ram', 'subaru', 'tesla', 'toyota',
  'volkswagen', 'vw', 'volvo', 'genesis', 'rover'
];

/** Bare make/model-only queries (entire term is only these tokens) → negative. */
var BARE_MAKE_MODEL_TOKENS = [
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy', 'chrysler',
  'dodge', 'ford', 'gmc', 'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep',
  'kia', 'lexus', 'lincoln', 'mazda', 'mercedes', 'mini', 'mitsubishi',
  'nissan', 'porsche', 'ram', 'subaru', 'tesla', 'toyota', 'volkswagen', 'vw',
  'volvo', 'genesis', 'promaster', 'promasters', 'sprinter'
];

var NAMED_SHOP_FILLER_TOKENS = {
  near: true, me: true, shop: true, shops: true, body: true, auto: true,
  autobody: true, collision: true, repair: true, repairs: true, center: true,
  certified: true, the: true, a: true, an: true, of: true, and: true, for: true,
  in: true, at: true, to: true, local: true, best: true, open: true, now: true,
  within: true, mi: true, miles: true, car: true, cars: true, automotive: true,
  automobile: true, services: true, service: true, llc: true, inc: true,
  town: true, city: true, area: true, county: true, nearby: true, close: true,
  insurance: true, claim: true, claims: true, accident: true, crash: true,
  estimate: true, estimates: true, quote: true, quotes: true, free: true,
  cheap: true, cheapest: true, affordable: true, cost: true, price: true,
  paint: true, painting: true, painter: true, painters: true, repaint: true,
  dent: true, dents: true, ding: true, dings: true, scratch: true, scratches: true,
  job: true, jobs: true, tech: true, technician: true, hiring: true,
  appraisal: true, appraiser: true, adjuster: true,
  what: true, is: true, are: true, how: true, where: true, who: true, fix: true,
  my: true, your: true, our: true, with: true, without: true, from: true,
  on: true, or: true, by: true, vs: true,
  top: true, today: true, saturday: true, sunday: true, monday: true, tuesday: true,
  wednesday: true, thursday: true, friday: true, weekend: true, location: true,
  locations: true, around: true, here: true, hours: true
};

/** US states, abbreviations, and common places — filler for named-shop geo safety. */
var US_PLACE_FILLER_TOKENS = {
  'ak': true,
  'akron': true,
  'al': true,
  'alabama': true,
  'alaska': true,
  'albuquerque': true,
  'allen': true,
  'allentown': true,
  'amarillo': true,
  'anaheim': true,
  'anchorage': true,
  'annapolis': true,
  'ar': true,
  'arizona': true,
  'arkansas': true,
  'arlington': true,
  'atlanta': true,
  'augusta': true,
  'aurora': true,
  'austin': true,
  'az': true,
  'bakersfield': true,
  'baltimore': true,
  'bangor': true,
  'baton': true,
  'batonrichmond': true,
  'bellevue': true,
  'birmingham': true,
  'bloomington': true,
  'boise': true,
  'boston': true,
  'boulder': true,
  'bridgeport': true,
  'bronx': true,
  'bronxville': true,
  'burlington': true,
  'ca': true,
  'california': true,
  'callen': true,
  'cambridge': true,
  'carrollton': true,
  'cedarrapids': true,
  'chandler': true,
  'charleston': true,
  'charlotte': true,
  'chattanooga': true,
  'chesapeake': true,
  'chicago': true,
  'cincinnati': true,
  'clearlake': true,
  'cleveland': true,
  'co': true,
  'colerain': true,
  'collegesation': true,
  'colorado': true,
  'columbia': true,
  'columbus': true,
  'connecticut': true,
  'corpuschristi': true,
  'ct': true,
  'dallas': true,
  'dayton': true,
  'dc': true,
  'de': true,
  'delaware': true,
  'denton': true,
  'denver': true,
  'desmoines': true,
  'detroit': true,
  'dover': true,
  'durham': true,
  'elpaso': true,
  'eugene': true,
  'fairfield': true,
  'farmersbranch': true,
  'fl': true,
  'florence': true,
  'florida': true,
  'fontana': true,
  'fortworth': true,
  'fremont': true,
  'fresno': true,
  'frisco': true,
  'ga': true,
  'galveston': true,
  'garland': true,
  'georgia': true,
  'glendale': true,
  'grandprairie': true,
  'grandrapids': true,
  'greenbay': true,
  'greensboro': true,
  'greenville': true,
  'hackensack': true,
  'hamilton': true,
  'hawaii': true,
  'henderson': true,
  'hi': true,
  'honolulu': true,
  'houston': true,
  'huntington': true,
  'huntsville': true,
  'ia': true,
  'id': true,
  'idaho': true,
  'il': true,
  'illinois': true,
  'in': true,
  'indiana': true,
  'indianapolis': true,
  'iowa': true,
  'irving': true,
  'jackson': true,
  'jacksonville': true,
  'jersey': true,
  'kansas': true,
  'kansascity': true,
  'katonah': true,
  'kentucky': true,
  'kissimmee': true,
  'knoxville': true,
  'ks': true,
  'ky': true,
  'la': true,
  'larchmont': true,
  'laredo': true,
  'lasvegas': true,
  'leaguecity': true,
  'lewisville': true,
  'lexington': true,
  'liberty': true,
  'lincoln': true,
  'little': true,
  'longbeach': true,
  'losangeles': true,
  'louisiana': true,
  'louisville': true,
  'lubbock': true,
  'ma': true,
  'madison': true,
  'maine': true,
  'manchester': true,
  'maryland': true,
  'massachusetts': true,
  'mckinney': true,
  'md': true,
  'me': true,
  'memphis': true,
  'mesa': true,
  'mi': true,
  'miami': true,
  'michigan': true,
  'middletown': true,
  'milwaukee': true,
  'minneapolis': true,
  'minnesota': true,
  'mississippi': true,
  'missouri': true,
  'mn': true,
  'mo': true,
  'mobile': true,
  'modesto': true,
  'montana': true,
  'montgomery': true,
  'moreno': true,
  'mountvernon': true,
  'ms': true,
  'mt': true,
  'naperville': true,
  'nashua': true,
  'nashville': true,
  'nc': true,
  'nd': true,
  'ne': true,
  'nebraska': true,
  'nevada': true,
  'newark': true,
  'newhaven': true,
  'neworleans': true,
  'newport': true,
  'newyork': true,
  'nh': true,
  'nj': true,
  'nm': true,
  'norfolk': true,
  'nv': true,
  'ny': true,
  'oakland': true,
  'oh': true,
  'ohio': true,
  'ok': true,
  'oklahoma': true,
  'oklahomacity': true,
  'omaha': true,
  'or': true,
  'oregon': true,
  'orlando': true,
  'overland': true,
  'oxnard': true,
  'pa': true,
  'paterson': true,
  'pearland': true,
  'pennsylvania': true,
  'peoria': true,
  'philadelphia': true,
  'phoenix': true,
  'pittsburgh': true,
  'plano': true,
  'portland': true,
  'providence': true,
  'raleigh': true,
  'reno': true,
  'ri': true,
  'richardson': true,
  'richmond': true,
  'riverside': true,
  'rochester': true,
  'rock': true,
  'rockwall': true,
  'sacramento': true,
  'saintpaul': true,
  'salem': true,
  'saltlake': true,
  'sanangelo': true,
  'sanantonio': true,
  'sanberardino': true,
  'sandiego': true,
  'sanfrancisco': true,
  'sanjose': true,
  'santaana': true,
  'santafe': true,
  'savannah': true,
  'sc': true,
  'scarsdale': true,
  'scottsdale': true,
  'sd': true,
  'seattle': true,
  'shreveport': true,
  'spokane': true,
  'springdale': true,
  'springfield': true,
  'stamford': true,
  'stockton': true,
  'stpetersburg': true,
  'sulphursprings': true,
  'tacoma': true,
  'tallahassee': true,
  'tampa': true,
  'teaneck': true,
  'tennessee': true,
  'texas': true,
  'tn': true,
  'toledo': true,
  'tucson': true,
  'tulsa': true,
  'tx': true,
  'ut': true,
  'utah': true,
  'va': true,
  'vermont': true,
  'vernon': true,
  'virginia': true,
  'virginiabeach': true,
  'vt': true,
  'wa': true,
  'warren': true,
  'warwick': true,
  'washington': true,
  'westchester': true,
  'whiteplains': true,
  'wi': true,
  'wichita': true,
  'wilmington': true,
  'winston': true,
  'wisconsin': true,
  'worcester': true,
  'wv': true,
  'wy': true,
  'wylie': true,
  'wyoming': true,
  'yonkers': true
};

/** Multi-word US places stripped before leftover name-token counting. */
var US_PLACE_MULTIWORD_PHRASES = [
  'baton rouge',
  'cape coral',
  'cedar rapids',
  'chula vista',
  'clear lake',
  'college station',
  'colorado springs',
  'coral springs',
  'corpus christi',
  'des moines',
  'district of columbia',
  'el paso',
  'farmers branch',
  'fort collins',
  'fort lauderdale',
  'fort wayne',
  'fort worth',
  'garden grove',
  'grand prairie',
  'grand rapids',
  'huntington beach',
  'jersey city',
  'kansas city',
  'las vegas',
  'league city',
  'little rock',
  'long beach',
  'los angeles',
  'moreno valley',
  'mount vernon',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new orleans',
  'new york',
  'newport news',
  'north carolina',
  'north dakota',
  'oak cliff',
  'oklahoma city',
  'overland park',
  'pembroke pines',
  'rancho cucamonga',
  'rhode island',
  'saint paul',
  'salt lake',
  'san angelo',
  'san antonio',
  'san bernardino',
  'san diego',
  'san francisco',
  'san jose',
  'santa ana',
  'santa clarita',
  'sioux falls',
  'south carolina',
  'south dakota',
  'st louis',
  'st paul',
  'sulphur springs',
  'virginia beach',
  'west chester',
  'west virginia',
  'white plains'
];


function main() {
  validateConfig_();

  var preview = AdsApp.getExecutionInfo().isPreview();
  var allowlist = uniqueIdsFromList_(CONFIG.ACCOUNT_ALLOWLIST);
  if (!allowlist.length) {
    Logger.log('CONFIG.ACCOUNT_ALLOWLIST is empty — nothing to do.');
    return;
  }

  var todayText = Utilities.formatDate(
    new Date(),
    CONFIG.QUEUE_TIME_ZONE,
    'yyyy-MM-dd'
  );
  var doneLabelName = CONFIG.DONE_LABEL_PREFIX + ':' + todayText;

  var dueIds = selectDueAllowlistedAccounts_(allowlist, doneLabelName);
  if (!dueIds.length) {
    Logger.log(
      'No allowlisted accounts are due for ' + todayText +
      ' (all already labeled ' + doneLabelName + ', or none found under MCC).'
    );
    if (!preview) {
      sendSummaryEmail_({
        runId: buildRunId_(),
        preview: false,
        todayText: todayText,
        doneLabelName: doneLabelName,
        results: [],
        waveEmpty: true,
        allowlistSize: allowlist.length
      });
    }
    return;
  }

  var runId = buildRunId_();
  var input = JSON.stringify({
    runId: runId,
    preview: preview,
    todayText: todayText,
    doneLabelName: doneLabelName,
    overridesByCustomerId: buildOverridesPayload_(allowlist)
  });

  Logger.log(
    'Starting standalone negatives sweep ' + runId + ' for ' +
    dueIds.length + ' account(s)' + (preview ? ' in Preview.' : '.') +
    ' Label when done: ' + doneLabelName
  );

  AdsManagerApp.accounts()
    .withIds(dueIds)
    .executeInParallel('processAccount', 'allFinished', input);
}

function allFinished(results, inputJson) {
  var input = JSON.parse(inputJson || '{}');
  var preview = !!input.preview || AdsApp.getExecutionInfo().isPreview();
  var parsed = [];
  var i;

  for (i = 0; i < results.length; i++) {
    var raw = results[i];
    var status = '';
    var returnValue = '';
    try {
      status = String(raw.getStatus ? raw.getStatus() : '');
      returnValue = String(raw.getReturnValue ? raw.getReturnValue() : '');
    } catch (e) {
      status = 'ERROR';
      returnValue = '';
    }

    var output = null;
    if (returnValue) {
      try {
        output = JSON.parse(returnValue);
      } catch (parseError) {
        output = null;
      }
    }

    if (!output) {
      output = {
        success: false,
        customerId: '',
        accountName: 'Unknown',
        added: 0,
        failed: 1,
        manualReview: 0,
        hitSafetyCeiling: false,
        termsReviewed: 0,
        rawRows: { SEARCH: 0, PMAX: 0 },
        uniqueTerms: { SEARCH: 0, PMAX: 0 },
        decisionCounts: {},
        auditRows: [],
        auditRowsTotal: 0,
        auditTruncated: false,
        actions: [],
        message: 'Parallel worker returned no JSON (status: ' + status + ').'
      };
    }
    parsed.push(output);
  }

  if (!preview) {
    stampDoneLabels_(parsed, input.doneLabelName);
    sendSummaryEmail_({
      runId: input.runId || buildRunId_(),
      preview: false,
      todayText: input.todayText || '',
      doneLabelName: input.doneLabelName || '',
      results: parsed,
      waveEmpty: false,
      allowlistSize: (CONFIG.ACCOUNT_ALLOWLIST || []).length
    });
  } else {
    Logger.log('Preview: skipped done labels and email.');
  }

  var adds = 0;
  var fails = 0;
  for (i = 0; i < parsed.length; i++) {
    adds += number_(parsed[i].added);
    fails += number_(parsed[i].failed);
  }
  var realAccounts = 0;
  for (i = 0; i < parsed.length; i++) {
    if (parsed[i].customerId) {
      realAccounts += 1;
      Logger.log(
        'ACCOUNT_RESULT id=' + parsed[i].customerId +
        ' name=' + (parsed[i].accountName || '') +
        ' added=' + number_(parsed[i].added) +
        ' failed=' + number_(parsed[i].failed) +
        ' success=' + !!parsed[i].success +
        ' termsReviewed=' + number_(parsed[i].termsReviewed) +
        ' decisionTotal=' + sumDecisionCounts_(parsed[i].decisionCounts) +
        ' reconciled=' +
          (sumDecisionCounts_(parsed[i].decisionCounts) ===
            number_(parsed[i].termsReviewed)) +
        (parsed[i].hitSafetyCeiling ? ' hitSafetyCeiling=true' : '') +
        ' msg=' + (parsed[i].message || '')
      );
    }
  }
  Logger.log(
    'Standalone negatives wave finished. Real accounts: ' + realAccounts +
    ' (worker results: ' + parsed.length + ')' +
    ', adds: ' + adds + ', fails: ' + fails
  );
}

function processAccount(inputJson) {
  var input = JSON.parse(inputJson || '{}');
  var account = AdsApp.currentAccount();
  var customerId = normalizeCustomerId_(account.getCustomerId());
  var preview = !!input.preview || AdsApp.getExecutionInfo().isPreview();
  var override = (input.overridesByCustomerId || {})[customerId] ||
    mergeAccountOverride_(customerId, account.getName() || '');

  // Re-merge so Ads account name is always protected even if MCC payload omitted it.
  override = mergeAccountOverride_(customerId, account.getName() || '');
  if (input.overridesByCustomerId && input.overridesByCustomerId[customerId]) {
    var fromMcc = input.overridesByCustomerId[customerId];
    override.disabledRuleIds = unique_(
      (fromMcc.disabledRuleIds || []).concat(override.disabledRuleIds || [])
    );
    override.protectedPhrases = unique_(
      (fromMcc.protectedPhrases || [])
        .concat(override.protectedPhrases || [])
        .concat([account.getName() || ''])
    );
    override.competitorPhrases = unique_(
      (fromMcc.competitorPhrases || []).concat(override.competitorPhrases || [])
    );
  }

  var output = {
    runId: input.runId || buildRunId_(),
    success: false,
    preview: preview,
    hitSafetyCeiling: false,
    customerId: customerId,
    accountName: account.getName() || customerId,
    added: 0,
    manualReview: 0,
    failed: 0,
    termsReviewed: 0,
    rawRows: { SEARCH: 0, PMAX: 0 },
    uniqueTerms: { SEARCH: 0, PMAX: 0 },
    dateWindow: {},
    decisionCounts: {},
    auditRows: [],
    auditRowsTotal: 0,
    auditTruncated: false,
    actions: [],
    message: ''
  };

  var hadFailure = false;
  try {
    var timeZone = account.getTimeZone();
    var dateWindow = buildDateWindow_(
      timeZone,
      CONFIG.ACTION_WINDOW_DAYS,
      CONFIG.HISTORICAL_GUARD_DAYS
    );
    output.dateWindow = dateWindow;

    var searchRows = querySearchTermsByChannel_(dateWindow, 'SEARCH');
    var pmaxRows = querySearchTermsByChannel_(dateWindow, 'PERFORMANCE_MAX');
    var searchTerms = aggregateSearchTerms_(
      searchRows,
      dateWindow.actionStart,
      'SEARCH'
    );
    var pmaxTerms = aggregateSearchTerms_(
      pmaxRows,
      dateWindow.actionStart,
      'PMAX'
    );
    var candidates = filterAndSortCandidates_(searchTerms.concat(pmaxTerms));
    output.termsReviewed = candidates.length;
    output.rawRows.SEARCH = countActionWindowRows_(searchRows, dateWindow.actionStart);
    output.rawRows.PMAX = countActionWindowRows_(pmaxRows, dateWindow.actionStart);
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      var candidateChannel = candidates[candidateIndex].channel === 'PMAX' ?
        'PMAX' : 'SEARCH';
      output.uniqueTerms[candidateChannel] += 1;
    }

    var campaignCache = { SEARCH: {}, PMAX: {} };
    var campaignNegativeCache = {};
    var sharedListCache = {};
    var pendingExactAdds = [];
    var eligibleProcessed = 0;
    var eligibleByChannel = { SEARCH: 0, PMAX: 0 };
    var channelCeilingLogged = { SEARCH: false, PMAX: false };
    var skippedWrongCampaignName = 0;

    candidates.sort(function (a, b) {
      var ae = a.channel === 'PMAX' ? 0 : 1;
      var be = b.channel === 'PMAX' ? 0 : 1;
      if (ae !== be) return ae - be;
      if (b.actionCost !== a.actionCost) return b.actionCost - a.actionCost;
      if (b.actionClicks !== a.actionClicks) return b.actionClicks - a.actionClicks;
      return b.actionImpressions - a.actionImpressions;
    });

    for (var i = 0; i < candidates.length; i++) {
      var term = candidates[i];
      if (!campaignNameMatchesRequired_(term.campaignName)) {
        skippedWrongCampaignName += 1;
        recordTermDecision_(
          output,
          term,
          null,
          'WRONG_CAMPAIGN_NAME',
          'Campaign name does not include "' +
            String(CONFIG.REQUIRED_CAMPAIGN_NAME_SUBSTRING || '') + '".'
        );
        continue;
      }
      var ruleResult = evaluateRules_(term.searchTerm, override);
      if (!ruleResult.anyRuleMatched) {
        if (ruleResult.accountProtection) {
          recordTermDecision_(
            output,
            term,
            ruleResult,
            'PROTECTED',
            'Account/global protection matched "' +
              ruleResult.accountProtection + '"; no exclusion rule was allowed to act.'
          );
        } else {
          recordTermDecision_(
            output,
            term,
            ruleResult,
            'NO_RULE',
            'No enabled negative rule matched this normalized term.'
          );
        }
        continue;
      }
      if (!ruleResult.shouldExclude) {
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'PROTECTED',
          'Matched rule(s), but protection won: ' +
            (ruleResult.protectedBy || []).join(' | ')
        );
        continue;
      }
      if (hasBlockedSearchTermStatus_(term.statuses)) {
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'GOOGLE_STATUS',
          'Google reports the term as ' + statusNames_(term.statuses).join(', ') +
            '; no new negative was needed.'
        );
        continue;
      }
      if (term.actionConversions > CONFIG.MAX_ACTION_CONVERSIONS) {
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'CONVERTED_ACTION_WINDOW',
          'The term recorded ' + round_(term.actionConversions, 4) +
            ' conversion(s) in the rolling action window.'
        );
        continue;
      }
      if (term.historyConversions > CONFIG.MAX_HISTORICAL_CONVERSIONS) {
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'CONVERTED_HISTORY',
          'The term recorded ' + round_(term.historyConversions, 4) +
            ' conversion(s) in the ' + CONFIG.HISTORICAL_GUARD_DAYS +
            '-day conversion guard.'
        );
        continue;
      }

      var prepared = prepareExactNegative_(term.searchTerm);

      var channelKey = term.channel === 'PMAX' ? 'PMAX' : 'SEARCH';
      var channelCeiling = CONFIG.RUNAWAY_SAFETY_CEILING_PER_CHANNEL ||
        CONFIG.RUNAWAY_SAFETY_CEILING_PER_ACCOUNT || 500;
      if (eligibleByChannel[channelKey] >= channelCeiling) {
        var ceilingReason = 'Stopped ' + channelKey + ' after ' + channelCeiling +
          ' eligible terms. Other channels may still be processed.';
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'HIT_SAFETY_CEILING',
          ceilingReason
        );
        if (!channelCeilingLogged[channelKey]) {
          channelCeilingLogged[channelKey] = true;
          output.hitSafetyCeiling = true;
          pushAction_(output, {
            channel: term.channel,
            campaignId: term.campaignId,
            campaignName: term.campaignName,
            searchTerm: term.searchTerm,
            exactNegative: '',
            matchedRules: [],
            impressions: term.actionImpressions,
            clicks: term.actionClicks,
            cost: term.actionCost,
            decision: 'HIT_SAFETY_CEILING',
            reason: ceilingReason
          });
        }
        continue;
      }

      if (!prepared.ok) {
        if (prepared.manualReview) {
          output.manualReview += 1;
          recordTermDecision_(
            output,
            term,
            ruleResult,
            'MANUAL_REVIEW',
            prepared.reason
          );
          pushAction_(output, {
            channel: term.channel,
            campaignId: term.campaignId,
            campaignName: term.campaignName,
            searchTerm: term.searchTerm,
            exactNegative: prepared.formatted,
            matchedRules: ruleResult.eligibleRules,
            impressions: term.actionImpressions,
            clicks: term.actionClicks,
            cost: term.actionCost,
            decision: 'MANUAL_REVIEW',
            reason: prepared.reason
          });
        } else {
          output.failed += 1;
          hadFailure = true;
          recordTermDecision_(
            output,
            term,
            ruleResult,
            'FAILED',
            prepared.reason
          );
        }
        continue;
      }

      var campaign = getCampaignByChannel_(
        term.channel,
        term.campaignId,
        campaignCache
      );
      if (!campaign) {
        output.failed += 1;
        hadFailure = true;
        var unresolvedReason =
          'The ' + term.channel + ' campaign could not be resolved by ID.';
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'FAILED',
          unresolvedReason
        );
        pushAction_(output, {
          channel: term.channel,
          campaignId: term.campaignId,
          campaignName: term.campaignName,
          searchTerm: term.searchTerm,
          exactNegative: prepared.formatted,
          matchedRules: ruleResult.eligibleRules,
          impressions: term.actionImpressions,
          clicks: term.actionClicks,
          cost: term.actionCost,
          decision: 'FAILED',
          reason: unresolvedReason
        });
        continue;
      }

      if (!campaignNameMatchesRequired_(
        (campaign.getName && campaign.getName()) || term.campaignName
      )) {
        skippedWrongCampaignName += 1;
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'WRONG_CAMPAIGN_NAME',
          'Resolved campaign name does not include "' +
            String(CONFIG.REQUIRED_CAMPAIGN_NAME_SUBSTRING || '') + '".'
        );
        continue;
      }

      if (term.channel === 'PMAX') {
        try {
          assertPMaxNegativeMethods_(campaign, true);
        } catch (pmaxApiError) {
          output.failed += 1;
          hadFailure = true;
          var pmaxFailureReason = cleanError_(pmaxApiError);
          recordTermDecision_(
            output,
            term,
            ruleResult,
            'FAILED',
            pmaxFailureReason
          );
          pushAction_(output, {
            channel: term.channel,
            campaignId: term.campaignId,
            campaignName: term.campaignName,
            searchTerm: term.searchTerm,
            exactNegative: prepared.formatted,
            matchedRules: ruleResult.eligibleRules,
            impressions: term.actionImpressions,
            clicks: term.actionClicks,
            cost: term.actionCost,
            decision: 'FAILED',
            reason: pmaxFailureReason
          });
          continue;
        }
      }

      var blockingNegative = findBlockingNegative_(
        campaign,
        term.searchTerm,
        campaignNegativeCache,
        sharedListCache,
        term.channel === 'PMAX'
      );
      if (blockingNegative) {
        recordTermDecision_(
          output,
          term,
          ruleResult,
          'ALREADY_COVERED',
          'Covered by ' + (blockingNegative.source || 'an existing negative') +
            ': ' + (blockingNegative.formatted || blockingNegative.text || '') +
            ' (' + (blockingNegative.matchType || 'UNKNOWN') + ').'
        );
        continue;
      }

      // Count toward ceiling only when queuing a real add.
      eligibleByChannel[channelKey] += 1;
      eligibleProcessed += 1;

      // Queue for one AdsApp.mutateAll per campaign (cleaner Change History).
      pendingExactAdds.push({
        campaign: campaign,
        term: term,
        prepared: prepared,
        ruleResult: ruleResult,
        campaignNegativeCache: campaignNegativeCache
      });
      // Reserve in-cache so later terms in this run do not queue duplicates.
      addExactNegativeToCache_(
        term.campaignId,
        prepared.text,
        campaignNegativeCache
      );
    }

    if (skippedWrongCampaignName) {
      Logger.log(
        'Skipped ' + skippedWrongCampaignName +
        ' term(s) whose campaign name did not include "' +
        String(CONFIG.REQUIRED_CAMPAIGN_NAME_SUBSTRING || '') + '".'
      );
    }

    if (flushPendingExactNegatives_(pendingExactAdds, output, preview)) {
      hadFailure = true;
    }

    if (!ensureDecisionReconciliation_(output, candidates)) {
      output.failed += 1;
      hadFailure = true;
    }
    logDecisionFunnel_(output);
    output.success = !hadFailure && !output.hitSafetyCeiling;
    if (preview) {
      output.message = output.success ?
        ('Preview — would add ' + output.added +
          ' exact campaign negative(s). No Ads changes were made.') :
        (output.hitSafetyCeiling ?
          'Preview — hit safety ceiling; no Ads changes were made.' :
          'Preview — completed with failures; no Ads changes were made.');
    } else {
      output.message = output.success ?
        ('OK — added ' + output.added + ' exact campaign negative(s).') :
        (output.hitSafetyCeiling ?
          'Hit safety ceiling; not stamped complete.' :
          'Completed with failures; not stamped complete.');
    }
  } catch (error) {
    output.success = false;
    output.failed += 1;
    output.message = cleanError_(error);
    pushAction_(output, {
      channel: '',
      campaignId: '',
      campaignName: '',
      searchTerm: '',
      exactNegative: '',
      matchedRules: [],
      impressions: 0,
      clicks: 0,
      cost: 0,
      decision: 'FAILED',
      reason: output.message
    });
    ensureDecisionReconciliation_(output, candidates || []);
    logDecisionFunnel_(output);
  }

  delete output._decidedTermKeys;
  return JSON.stringify(output);
}

function selectDueAllowlistedAccounts_(allowlistIds, doneLabelName) {
  var allowSet = toCustomerIdSet_(allowlistIds);
  var due = [];
  var iterator = AdsManagerApp.accounts().withIds(allowlistIds).get();
  while (iterator.hasNext()) {
    var account = iterator.next();
    var id = normalizeCustomerId_(account.getCustomerId());
    if (!allowSet[id]) continue;
    if (accountHasLabelName_(account, doneLabelName)) continue;
    due.push(id);
  }
  due.sort();
  if (due.length > CONFIG.MAX_PARALLEL_ACCOUNTS) {
    due = due.slice(0, CONFIG.MAX_PARALLEL_ACCOUNTS);
  }
  return due;
}

function accountHasLabelName_(account, labelName) {
  try {
    var labels = account.labels().get();
    while (labels.hasNext()) {
      if (String(labels.next().getName()) === labelName) return true;
    }
  } catch (error) {
    Logger.log(
      'Could not read labels for ' + account.getCustomerId() + ': ' +
      cleanError_(error)
    );
  }
  return false;
}

function stampDoneLabels_(results, doneLabelName) {
  if (!doneLabelName) return;
  ensureAccountLabelExists_(doneLabelName);
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    if (!result || !result.success || !result.customerId) {
      if (result && result.customerId && !result.success) {
        Logger.log(
          'DONE_LABEL skip id=' + result.customerId +
          ' (success=false; not stamped)'
        );
      }
      continue;
    }
    if (result.hitSafetyCeiling) {
      Logger.log(
        'DONE_LABEL skip id=' + result.customerId + ' (safety ceiling)'
      );
      continue;
    }
    try {
      var account = findManagerAccountByCustomerId_(result.customerId);
      if (!account) {
        Logger.log(
          'DONE_LABEL failed id=' + result.customerId +
          ' — account not found under this MCC for labeling.'
        );
        continue;
      }
      account.applyLabel(doneLabelName);
      Logger.log(
        'DONE_LABEL applied id=' + result.customerId +
        ' label=' + doneLabelName
      );
    } catch (error) {
      Logger.log(
        'Failed to apply done label to ' + result.customerId + ': ' +
        cleanError_(error)
      );
    }
  }
}

function findManagerAccountByCustomerId_(customerId) {
  var raw = String(customerId || '').trim();
  if (!raw) return null;
  var undashed = normalizeCustomerId_(raw);
  var dashed = formatCustomerIdDashes_(undashed);
  var ids = [];
  if (undashed) ids.push(undashed);
  if (dashed && dashed !== undashed) ids.push(dashed);
  for (var i = 0; i < ids.length; i++) {
    try {
      var iterator = AdsManagerApp.accounts().withIds([ids[i]]).get();
      if (iterator.hasNext()) return iterator.next();
    } catch (error) {
      // try next id format
    }
  }
  return null;
}

function ensureAccountLabelExists_(labelName) {
  var safe = String(labelName || '').replace(/'/g, "\\'");
  var existing = AdsManagerApp.accountLabels()
    .withCondition("Name = '" + safe + "'")
    .get();
  if (existing.hasNext()) return existing.next();
  return AdsManagerApp.createAccountLabel(labelName);
}

function buildOverridesPayload_(allowlistIds) {
  var payload = {};
  for (var i = 0; i < allowlistIds.length; i++) {
    var id = allowlistIds[i];
    payload[id] = mergeAccountOverride_(id, '');
  }
  return payload;
}

function mergeAccountOverride_(customerId, accountName) {
  var id = normalizeCustomerId_(customerId);
  var local = CONFIG.ACCOUNT_OVERRIDES[id] ||
    CONFIG.ACCOUNT_OVERRIDES[formatCustomerIdDashes_(id)] ||
    {};

  var disabled = unique_(
    (CONFIG.DISABLED_RULE_IDS || [])
      .concat(local.DISABLED_RULE_IDS || local.disabledRuleIds || [])
  );
  var protectedPhrases = unique_(
    SEED_INSURER_PROTECTED_PHRASES
      .concat(CONFIG.PROTECTED_PHRASES || [])
      .concat(local.PROTECTED_PHRASES || local.protectedPhrases || [])
      .concat([accountName || ''])
  );
  var competitorPhrases = unique_(
    SEED_COMPETITOR_PHRASES
      .concat(CONFIG.COMPETITOR_PHRASES || [])
      .concat(local.COMPETITOR_PHRASES || local.competitorPhrases || [])
  );

  return {
    disabledRuleIds: disabled,
    protectedPhrases: protectedPhrases,
    competitorPhrases: competitorPhrases
  };
}

function filterAndSortCandidates_(terms) {
  var candidates = [];
  for (var i = 0; i < terms.length; i++) {
    if (terms[i].actionImpressions >= CONFIG.MIN_ACTION_IMPRESSIONS) {
      candidates.push(terms[i]);
    }
  }
  candidates.sort(function (a, b) {
    if (b.actionCost !== a.actionCost) return b.actionCost - a.actionCost;
    if (b.actionClicks !== a.actionClicks) return b.actionClicks - a.actionClicks;
    return b.actionImpressions - a.actionImpressions;
  });
  return candidates;
}

function pushAction_(output, action) {
  if (!output.actions) output.actions = [];
  var cap = CONFIG.MAX_LOG_ACTIONS_PER_ACCOUNT || 400;
  if (output.actions.length < cap) {
    output.actions.push(action);
    return;
  }
  // Prefer keeping ADDED / FAILED / MANUAL_REVIEW over HIT_SAFETY_CEILING noise.
  var decision = String((action && action.decision) || '');
  if (
    decision !== 'ADDED' &&
    decision !== 'WOULD_ADD' &&
    decision !== 'FAILED' &&
    decision !== 'MANUAL_REVIEW'
  ) {
    return;
  }
  for (var i = output.actions.length - 1; i >= 0; i--) {
    var d = String(output.actions[i].decision || '');
    if (d === 'HIT_SAFETY_CEILING') {
      output.actions[i] = action;
      return;
    }
  }
}

function countActionWindowRows_(rows, actionStart) {
  var count = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    var rowDate = String(
      rows[i] && rows[i].segments && rows[i].segments.date || ''
    );
    if (rowDate && rowDate >= actionStart) count += 1;
  }
  return count;
}

function termDecisionKey_(term) {
  return [
    term && term.channel || '',
    term && term.campaignId || '',
    normalizeText_(term && term.searchTerm || '')
  ].join('|');
}

function recordTermDecision_(output, term, ruleResult, decision, reason) {
  if (!output._decidedTermKeys) output._decidedTermKeys = {};
  var key = termDecisionKey_(term);
  if (output._decidedTermKeys[key]) {
    Logger.log(
      'DECISION_DUPLICATE_IGNORED account=' + (output.customerId || '') +
      ' key=' + key + ' attempted=' + decision
    );
    return false;
  }
  output._decidedTermKeys[key] = true;

  var terminal = String(decision || 'FAILED');
  if (!output.decisionCounts) output.decisionCounts = {};
  output.decisionCounts[terminal] = number_(output.decisionCounts[terminal]) + 1;
  output.auditRowsTotal = number_(output.auditRowsTotal) + 1;

  if (!output.auditRows) output.auditRows = [];
  var cap = CONFIG.MAX_AUDIT_ROWS_PER_ACCOUNT || 1000;
  if (output.auditRows.length >= cap) {
    output.auditTruncated = true;
    return true;
  }

  output.auditRows.push({
    channel: term && term.channel || '',
    campaignId: term && term.campaignId || '',
    campaignName: term && term.campaignName || '',
    searchTerm: term && term.searchTerm || '',
    firstSeenDate: term && term.firstSeenDate || '',
    lastSeenDate: term && term.lastSeenDate || '',
    impressions: number_(term && term.actionImpressions),
    clicks: number_(term && term.actionClicks),
    cost: number_(term && term.actionCost),
    conversions: number_(term && term.actionConversions),
    historyConversions: number_(term && term.historyConversions),
    matchedRules: ruleResult && ruleResult.matchedRules ?
      ruleResult.matchedRules.slice() : [],
    decision: terminal,
    reason: String(reason || '')
  });
  return true;
}

function sumDecisionCounts_(counts) {
  var total = 0;
  var keys = Object.keys(counts || {});
  for (var i = 0; i < keys.length; i++) {
    total += number_(counts[keys[i]]);
  }
  return total;
}

function ensureDecisionReconciliation_(output, candidates) {
  var before = sumDecisionCounts_(output.decisionCounts);
  var expected = number_(output.termsReviewed);
  var complete = before === expected;
  if (!complete) {
    var all = candidates || [];
    for (var i = 0; i < all.length; i++) {
      var key = termDecisionKey_(all[i]);
      if (output._decidedTermKeys && output._decidedTermKeys[key]) continue;
      recordTermDecision_(
        output,
        all[i],
        null,
        'FAILED',
        'The account worker stopped before this term received a normal terminal decision.'
      );
    }
  }
  output.decisionTotal = sumDecisionCounts_(output.decisionCounts);
  output.decisionReconciled = output.decisionTotal === expected;
  return complete && output.decisionReconciled;
}

function statusNames_(statuses) {
  return Object.keys(statuses || {}).sort();
}

function logDecisionFunnel_(output) {
  Logger.log(
    'DECISION_FUNNEL account=' + (output.customerId || '') +
    ' rawSearchRows=' + number_(output.rawRows && output.rawRows.SEARCH) +
    ' rawPmaxRows=' + number_(output.rawRows && output.rawRows.PMAX) +
    ' uniqueSearchTerms=' + number_(output.uniqueTerms && output.uniqueTerms.SEARCH) +
    ' uniquePmaxTerms=' + number_(output.uniqueTerms && output.uniqueTerms.PMAX) +
    ' decisions=' + JSON.stringify(output.decisionCounts || {}) +
    ' decisionTotal=' + number_(output.decisionTotal) +
    ' reconciled=' + !!output.decisionReconciled +
    (output.auditTruncated ? ' auditTruncated=true' : '')
  );
}

function extractSearchTermFromRow_(row) {
  if (
    row.campaignSearchTermView &&
    row.campaignSearchTermView.searchTerm != null
  ) {
    return String(row.campaignSearchTermView.searchTerm || '').trim();
  }
  if (row.searchTermView && row.searchTermView.searchTerm != null) {
    return String(row.searchTermView.searchTerm || '').trim();
  }
  return '';
}

function extractSearchTermStatusFromRow_(row) {
  if (row.searchTermView && row.searchTermView.status != null) {
    return String(row.searchTermView.status || '').toUpperCase();
  }
  return '';
}

function querySearchTermsByChannel_(dateWindow, channelType) {
  var campaignStatus = CONFIG.INCLUDE_PAUSED_CAMPAIGNS ?
    "campaign.status != 'REMOVED'" : "campaign.status = 'ENABLED'";
  var query;
  if (channelType === 'SEARCH') {
    var adGroupStatus = CONFIG.INCLUDE_PAUSED_CAMPAIGNS ?
      "ad_group.status != 'REMOVED'" : "ad_group.status = 'ENABLED'";
    query =
      'SELECT segments.date, campaign.id, campaign.name, ad_group.id, ' +
      'ad_group.name, search_term_view.search_term, search_term_view.status, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      'metrics.conversions FROM search_term_view ' +
      "WHERE segments.date BETWEEN '" + dateWindow.historyStart +
      "' AND '" + dateWindow.actionEnd + "' " +
      "AND campaign.advertising_channel_type = 'SEARCH' " +
      'AND ' + campaignStatus + ' AND ' + adGroupStatus + ' ' +
      'AND metrics.impressions > 0';
  } else {
    // Performance Max is NOT in search_term_view (ad-group level).
    // Use campaign_search_term_view (campaign-level; includes PMax).
    query =
      'SELECT segments.date, campaign.id, campaign.name, ' +
      'campaign_search_term_view.search_term, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      'metrics.conversions FROM campaign_search_term_view ' +
      "WHERE segments.date BETWEEN '" + dateWindow.historyStart +
      "' AND '" + dateWindow.actionEnd + "' " +
      "AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' " +
      'AND ' + campaignStatus + ' ' +
      'AND metrics.impressions > 0';
  }

  var rows = [];
  try {
    var iterator = AdsApp.search(query);
    while (iterator.hasNext()) rows.push(iterator.next());
  } catch (searchError) {
    if (channelType === 'PERFORMANCE_MAX' || channelType === 'PMAX') {
      Logger.log(
        'PMax campaign_search_term_view query failed; trying search_term_view fallback: ' +
        cleanError_(searchError)
      );
      var fallbackQuery =
        'SELECT segments.date, campaign.id, campaign.name, ' +
        'search_term_view.search_term, search_term_view.status, ' +
        'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
        'metrics.conversions FROM search_term_view ' +
        "WHERE segments.date BETWEEN '" + dateWindow.historyStart +
        "' AND '" + dateWindow.actionEnd + "' " +
        "AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' " +
        'AND ' + campaignStatus + ' ' +
        'AND metrics.impressions > 0';
      var fallbackIterator = AdsApp.search(fallbackQuery);
      while (fallbackIterator.hasNext()) rows.push(fallbackIterator.next());
    } else {
      throw searchError;
    }
  }
  return rows;
}

function aggregateSearchTerms_(rows, actionStart, channel) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var campaignId = String(row.campaign.id);
    var searchTerm = extractSearchTermFromRow_(row);
    var normalizedTerm = normalizeText_(searchTerm);
    if (!normalizedTerm) continue;
    var key = channel + '|' + campaignId + '|' + normalizedTerm;

    if (!map[key]) {
      map[key] = {
        channel: channel,
        campaignId: campaignId,
        campaignName: String(row.campaign.name || ''),
        searchTerm: searchTerm,
        firstSeenDate: String(row.segments.date || ''),
        lastSeenDate: String(row.segments.date || ''),
        statuses: {},
        actionImpressions: 0,
        actionClicks: 0,
        actionCost: 0,
        actionConversions: 0,
        historyImpressions: 0,
        historyClicks: 0,
        historyCost: 0,
        historyConversions: 0
      };
    }

    var item = map[key];
    var rowDate = String(row.segments.date || '');
    if (rowDate && (!item.firstSeenDate || rowDate < item.firstSeenDate)) {
      item.firstSeenDate = rowDate;
    }
    if (rowDate && (!item.lastSeenDate || rowDate > item.lastSeenDate)) {
      item.lastSeenDate = rowDate;
    }
    var status = extractSearchTermStatusFromRow_(row);
    if (status) item.statuses[status] = true;
    var impressions = number_(row.metrics.impressions);
    var clicks = number_(row.metrics.clicks);
    var cost = number_(row.metrics.costMicros) / 1000000;
    var conversions = number_(row.metrics.conversions);
    item.historyImpressions += impressions;
    item.historyClicks += clicks;
    item.historyCost += cost;
    item.historyConversions += conversions;

    if (String(row.segments.date) >= actionStart) {
      item.actionImpressions += impressions;
      item.actionClicks += clicks;
      item.actionCost += cost;
      item.actionConversions += conversions;
    }
  }

  var output = [];
  var keys = Object.keys(map);
  for (var k = 0; k < keys.length; k++) output.push(map[keys[k]]);
  return output;
}

function evaluateRules_(searchTerm, accountOverride) {
  var disabled = toSet_(accountOverride.disabledRuleIds || []);
  var protectedPhrases = accountOverride.protectedPhrases || [];
  var accountProtection = firstMatchingPhrase_(searchTerm, protectedPhrases);
  var matchedRules = [];
  var matchedTriggers = [];
  var protectedBy = [];
  var eligibleRules = [];

  for (var i = 0; i < NEGATIVE_RULES.length; i++) {
    var rule = NEGATIVE_RULES[i];
    if (disabled[String(rule.id).toUpperCase()]) continue;

    var trigger = '';
    if (rule.id === 'LOCAL_COMPETITOR') {
      trigger = firstMatchingPhrase_(
        searchTerm,
        accountOverride.competitorPhrases || []
      );
    } else if (rule.id === 'NAMED_LOCAL_SHOP') {
      trigger = evaluateNamedLocalShop_(searchTerm);
    } else if (rule.id === 'BARE_MAKE_MODEL') {
      trigger = evaluateBareMakeModel_(searchTerm);
    } else if (rule.id === 'DEALER_OR_AUTO_GROUP') {
      trigger = evaluateDealerOrAutoGroup_(searchTerm, rule.triggers);
    } else if (rule.id === 'LOW_INTENT_AUTO_GEO') {
      trigger = evaluateLowIntentAutoGeo_(searchTerm);
    } else {
      trigger = firstMatchingPhrase_(searchTerm, rule.triggers);
    }
    if (!trigger) continue;

    matchedRules.push(rule.id);
    matchedTriggers.push(trigger);
    var exception = firstMatchingPhrase_(searchTerm, rule.exceptions || []);
    if (accountProtection || exception) {
      protectedBy.push(
        rule.id + ': ' + (accountProtection || exception)
      );
    } else {
      eligibleRules.push(rule.id);
    }
  }

  return {
    anyRuleMatched: matchedRules.length > 0,
    shouldExclude: eligibleRules.length > 0,
    accountProtection: accountProtection || '',
    matchedRules: unique_(matchedRules),
    matchedTriggers: unique_(matchedTriggers),
    protectedBy: unique_(protectedBy),
    eligibleRules: unique_(eligibleRules)
  };
}

function isOemBrandToken_(token) {
  var t = stemToken_(token);
  for (var i = 0; i < OEM_COLLISION_KEEP_BRANDS.length; i++) {
    if (t === OEM_COLLISION_KEEP_BRANDS[i]) return true;
  }
  return false;
}

function isGenericBodyIntent_(searchTerm) {
  var n = normalizeText_(searchTerm);
  if (!n) return false;
  n = (' ' + n + ' ')
    .replace(/ near me /g, ' ')
    .replace(/ near my location /g, ' ')
    .replace(/ open now /g, ' ')
    .replace(/ open today /g, ' ')
    .replace(/ open on saturday /g, ' ')
    .replace(/ open on sunday /g, ' ')
    .replace(/ within \d+ mi /g, ' ')
    .replace(/ within \d+ miles /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip leading quality/availability words for generic keep matching.
  n = n.replace(/^(top|best|local)\s+/, '');
  n = n.replace(/\s+near my location$/, '');
  var generics = {
    'body shop': true,
    'body shops': true,
    'auto body shop': true,
    'auto body shops': true,
    'automobile body shop': true,
    'automobile body shops': true,
    'auto body': true,
    'autobody': true,
    'autobody shops': true,
    'autobody near': true,
    'collision repair': true,
    'collision': true,
    'car collision repair': true,
    'auto collision repair': true,
    'body auto shop': true,
    'auto body repair': true,
    'auto body repair shops': true,
    'collision repair shops': true,
    'collision shops': true,
    'what is the best auto body shop': true,
    'body shop car': true,
    'top body shops': true,
    'top collision repair shops': true,
    'body shops open': true
  };
  return !!generics[n];
}

function isOemCollisionKeepIntent_(searchTerm) {
  var tokens = tokenize_(searchTerm);
  if (!tokens.length) return false;
  var n = normalizeText_(searchTerm);
  var hasOem = false;
  var hasCollisionOrBody = false;
  for (var i = 0; i < tokens.length; i++) {
    if (isOemBrandToken_(tokens[i])) hasOem = true;
  }
  // "mercedes benz" — benz alone should count with mercedes list
  if (containsPhrase_(n, 'mercedes benz') || containsPhrase_(n, 'mercedes')) {
    hasOem = true;
  }
  if (
    containsPhrase_(n, 'collision') ||
    containsPhrase_(n, 'auto body') ||
    containsPhrase_(n, 'autobody') ||
    containsPhrase_(n, 'body shop')
  ) {
    hasCollisionOrBody = true;
  }
  if (!hasOem || !hasCollisionOrBody) return false;

  var allowed = {
    near: true, me: true, shop: true, shops: true, body: true, auto: true,
    autobody: true, collision: true, repair: true, repairs: true, center: true,
    certified: true, the: true, a: true, an: true, and: true, for: true,
    in: true, at: true, to: true, car: true, benz: true
  };
  for (var j = 0; j < OEM_COLLISION_KEEP_BRANDS.length; j++) {
    allowed[OEM_COLLISION_KEEP_BRANDS[j]] = true;
  }
  for (var k = 0; k < tokens.length; k++) {
    var tok = stemToken_(tokens[k]);
    if (!allowed[tokens[k]] && !allowed[tok]) return false;
  }
  return true;
}

/**
 * Named other shop (safe-side): only fire when confidence is high.
 * - Possessive shop names (steve's auto body)
 * - 2+ leftover name tokens after stripping fillers + US places
 * Seed / COMPETITOR_PHRASES still handled by LOCAL_COMPETITOR.
 * Single leftover token (mayfield, mattys, sals, or unknown city) → KEEP.
 */
function evaluateNamedLocalShop_(searchTerm) {
  var n = normalizeText_(searchTerm);
  if (!n) return '';
  if (isGenericBodyIntent_(searchTerm)) return '';
  if (isOemCollisionKeepIntent_(searchTerm)) return '';
  if (isGeoBodyShopIntent_(searchTerm)) return '';

  var hasMarker =
    containsPhrase_(n, 'auto body') ||
    containsPhrase_(n, 'autobody') ||
    containsPhrase_(n, 'body shop') ||
    containsPhrase_(n, 'body shops') ||
    containsPhrase_(n, 'collision center') ||
    containsPhrase_(n, 'collision clinic') ||
    containsPhrase_(n, 'collision repair') ||
    containsPhrase_(n, 'collision services') ||
    containsPhrase_(n, 'collision specialists') ||
    containsPhrase_(n, 'collision specialist') ||
    containsPhrase_(n, 'collision');

  if (!hasMarker && !containsPhrase_(n, 'auto')) return '';

  var raw = String(searchTerm || '');
  var possessive = /[a-z0-9]'s\b/i.test(raw);
  if (possessive && hasMarker) {
    return 'named-shop-possessive';
  }

  var nameBits = namedShopNameBits_(searchTerm);
  // Safe-side: require 2+ non-place name tokens (e.g. "sure shot collision").
  if (hasMarker && nameBits.length >= 2) {
    return 'named-shop:' + nameBits.join(' ');
  }

  // High-confidence multi-token "Name Auto Place" only when 2+ name bits remain
  // after place strip (place tokens alone never qualify).
  if (
    containsPhrase_(n, 'auto') &&
    nameBits.length >= 2 &&
    !containsPhrase_(n, 'near me') &&
    !containsPhrase_(n, 'repair') &&
    !containsPhrase_(n, 'mechanic') &&
    !containsPhrase_(n, 'service') &&
    !containsPhrase_(n, 'care') &&
    !containsPhrase_(n, 'body')
  ) {
    return 'named-auto-biz:' + nameBits.join(' ');
  }

  return '';
}

/** Strip multi-word places, then drop filler / OEM / US place tokens. */
function namedShopNameBits_(searchTerm) {
  var n = normalizeText_(searchTerm);
  var i;
  for (i = 0; i < US_PLACE_MULTIWORD_PHRASES.length; i++) {
    var phrase = US_PLACE_MULTIWORD_PHRASES[i];
    var padded = ' ' + n + ' ';
    var needle = ' ' + phrase + ' ';
    while (padded.indexOf(needle) !== -1) {
      padded = padded.split(needle).join(' ');
    }
    n = padded.replace(/\s+/g, ' ').trim();
  }
  var tokens = n ? n.split(' ') : [];
  var nameBits = [];
  for (i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (!t || t.length < 3) continue;
    if (NAMED_SHOP_FILLER_TOKENS[t]) continue;
    if (US_PLACE_FILLER_TOKENS[t]) continue;
    if (isOemBrandToken_(t)) continue;
    nameBits.push(t);
  }
  return nameBits;
}

/**
 * Geo + body/collision intent: service words plus only place/filler leftovers.
 * Example: "yonkers auto body shop", "collision repair dallas".
 */
function isGeoBodyShopIntent_(searchTerm) {
  var n = normalizeText_(searchTerm);
  if (!n) return false;
  var hasService =
    containsPhrase_(n, 'auto body') ||
    containsPhrase_(n, 'autobody') ||
    containsPhrase_(n, 'body shop') ||
    containsPhrase_(n, 'body shops') ||
    containsPhrase_(n, 'collision') ||
    containsPhrase_(n, 'collision repair') ||
    containsPhrase_(n, 'collision center');
  if (!hasService) return false;
  // If any non-place name bits remain, this is not pure geo intent.
  return namedShopNameBits_(searchTerm).length === 0;
}


function evaluateDealerOrAutoGroup_(searchTerm, triggers) {
  var hit = firstMatchingPhrase_(searchTerm, triggers || []);
  if (hit) return hit;
  var n = normalizeText_(searchTerm);
  var tokens = tokenize_(searchTerm);
  var hasOem = false;
  for (var i = 0; i < tokens.length; i++) {
    if (isOemBrandToken_(tokens[i])) {
      hasOem = true;
      break;
    }
  }
  if (!hasOem) return '';
  if (
    containsPhrase_(n, 'collision') ||
    containsPhrase_(n, 'auto body') ||
    containsPhrase_(n, 'body shop')
  ) {
    // Dealer collision centers with a store/person name still count as dealers
    if (evaluateNamedLocalShop_(searchTerm)) return 'dealer-named-collision';
    return '';
  }
  if (
    containsPhrase_(n, 'service') ||
    containsPhrase_(n, 'auto group') ||
    containsPhrase_(n, 'dealership')
  ) {
    return 'oem-dealer-service';
  }
  return '';
}

function evaluateBareMakeModel_(searchTerm) {
  var tokens = tokenize_(searchTerm);
  if (!tokens.length || tokens.length > 3) return '';
  var allowed = {};
  for (var i = 0; i < BARE_MAKE_MODEL_TOKENS.length; i++) {
    allowed[BARE_MAKE_MODEL_TOKENS[i]] = true;
  }
  for (var j = 0; j < tokens.length; j++) {
    if (!allowed[tokens[j]] && !allowed[stemToken_(tokens[j])]) return '';
  }
  return 'bare-make-model:' + tokens.join(' ');
}

/**
 * Low-intent vehicle + named-place query with no body/collision service intent.
 * This is deliberately narrow: "car in dallas" matches, but bare "car",
 * "car near me", and "body shop in dallas" do not.
 */
function evaluateLowIntentAutoGeo_(searchTerm) {
  var n = normalizeText_(searchTerm);
  if (!n) return '';
  if (
    containsPhrase_(n, 'near me') ||
    containsPhrase_(n, 'close to me') ||
    containsPhrase_(n, 'my location')
  ) {
    return '';
  }
  if (
    containsPhrase_(n, 'body') ||
    containsPhrase_(n, 'collision') ||
    containsPhrase_(n, 'accident') ||
    containsPhrase_(n, 'claim') ||
    containsPhrase_(n, 'insurance') ||
    containsPhrase_(n, 'repair') ||
    containsPhrase_(n, 'shop') ||
    containsPhrase_(n, 'service')
  ) {
    return '';
  }

  var hasPlace = false;
  for (var i = 0; i < US_PLACE_MULTIWORD_PHRASES.length; i++) {
    var place = US_PLACE_MULTIWORD_PHRASES[i];
    if (!containsPhrase_(n, place)) continue;
    hasPlace = true;
    var padded = ' ' + n + ' ';
    var needle = ' ' + place + ' ';
    while (padded.indexOf(needle) !== -1) {
      padded = padded.split(needle).join(' ');
    }
    n = padded.replace(/\s+/g, ' ').trim();
  }

  var tokens = n ? n.split(' ') : [];
  var hasVehicle = false;
  var allowed = {
    car: true, cars: true, auto: true, automobile: true,
    automotive: true, vehicle: true, vehicles: true,
    in: true, at: true, near: true, around: true, local: true
  };
  for (var j = 0; j < tokens.length; j++) {
    var token = tokens[j];
    if (
      token === 'car' || token === 'cars' || token === 'auto' ||
      token === 'automobile' || token === 'automotive' ||
      token === 'vehicle' || token === 'vehicles'
    ) {
      hasVehicle = true;
      continue;
    }
    if (US_PLACE_FILLER_TOKENS[token]) {
      hasPlace = true;
      continue;
    }
    if (!allowed[token]) return '';
  }
  return hasVehicle && hasPlace ? 'low-intent-auto-geo' : '';
}


/**
 * Only campaigns whose names include this substring (case-insensitive) may
 * receive negatives. Protects other campaigns in mixed accounts.
 */
function campaignNameMatchesRequired_(campaignName) {
  var required = String(
    CONFIG.REQUIRED_CAMPAIGN_NAME_SUBSTRING || ''
  ).trim().toLowerCase();
  if (!required) {
    throw new Error(
      'REQUIRED_CAMPAIGN_NAME_SUBSTRING is required so mixed-account ' +
      'campaigns are not touched by accident.'
    );
  }
  return String(campaignName || '').toLowerCase().indexOf(required) !== -1;
}

function getCampaignByChannel_(channel, campaignId, cache) {
  var bucket = channel === 'PMAX' ? 'PMAX' : 'SEARCH';
  if (!cache[bucket]) cache[bucket] = {};
  var key = String(campaignId || '');
  if (Object.prototype.hasOwnProperty.call(cache[bucket], key)) {
    return cache[bucket][key];
  }
  if (!key) {
    cache[bucket][key] = null;
    return null;
  }

  if (bucket === 'PMAX') {
    if (typeof AdsApp.performanceMaxCampaigns !== 'function') {
      cache[bucket][key] = null;
      return null;
    }
    try {
      var pmaxIterator = AdsApp.performanceMaxCampaigns().withIds([key]).get();
      cache[bucket][key] = pmaxIterator.hasNext() ? pmaxIterator.next() : null;
    } catch (error) {
      cache[bucket][key] = null;
    }
    return cache[bucket][key];
  }

  var iterator = AdsApp.campaigns().withIds([key]).get();
  cache[bucket][key] = iterator.hasNext() ? iterator.next() : null;
  return cache[bucket][key];
}

function findBlockingNegative_(
  campaign,
  searchTerm,
  campaignNegativeCache,
  sharedListCache,
  isPmax
) {
  var campaignId = String(campaign.getId());
  if (!campaignNegativeCache[campaignId]) {
    campaignNegativeCache[campaignId] = loadEffectiveNegatives_(
      campaign,
      sharedListCache,
      isPmax
    );
  }
  var negatives = campaignNegativeCache[campaignId];
  for (var i = 0; i < negatives.length; i++) {
    if (
      negativeBlocksSearchTerm_(
        negatives[i].text,
        negatives[i].matchType,
        searchTerm
      )
    ) {
      return negatives[i];
    }
  }
  return null;
}

function loadEffectiveNegatives_(campaign, sharedListCache, isPmax) {
  // PerformanceMaxCampaign has no negativeKeywords() in Ads Scripts.
  // Read coverage via GAQL; adds still go through AdsApp.mutateAll.
  if (isPmax) {
    return loadPmaxCampaignNegativesViaGaql_(
      String(campaign.getId()),
      sharedListCache
    );
  }

  var output = [];
  var campaignNegatives = campaign.negativeKeywords().get();
  while (campaignNegatives.hasNext()) {
    var campaignNegative = campaignNegatives.next();
    output.push({
      text: stripKeywordSyntax_(campaignNegative.getText()),
      formatted: campaignNegative.getText(),
      matchType: String(campaignNegative.getMatchType()).toUpperCase(),
      source: 'campaign'
    });
  }

  if (typeof campaign.negativeKeywordLists !== 'function') return output;
  var lists = campaign.negativeKeywordLists().get();
  while (lists.hasNext()) {
    var list = lists.next();
    var listId = String(list.getId());
    if (!sharedListCache[listId]) {
      var listNegatives = [];
      var listKeywords = list.negativeKeywords().get();
      while (listKeywords.hasNext()) {
        var listKeyword = listKeywords.next();
        listNegatives.push({
          text: stripKeywordSyntax_(listKeyword.getText()),
          formatted: listKeyword.getText(),
          matchType: String(listKeyword.getMatchType()).toUpperCase(),
          source: 'shared list "' + list.getName() + '"'
        });
      }
      sharedListCache[listId] = listNegatives;
    }
    output = output.concat(sharedListCache[listId]);
  }
  return output;
}

function loadPmaxCampaignNegativesViaGaql_(campaignId, sharedListCache) {
  var output = [];
  var id = String(campaignId || '').replace(/-/g, '');
  if (!id) return output;

  var campaignQuery =
    'SELECT campaign_criterion.keyword.text, ' +
    'campaign_criterion.keyword.match_type ' +
    'FROM campaign_criterion ' +
    'WHERE campaign.id = ' + id + ' ' +
    "AND campaign_criterion.type = 'KEYWORD' " +
    'AND campaign_criterion.negative = TRUE';
  try {
    var campaignRows = AdsApp.search(campaignQuery);
    while (campaignRows.hasNext()) {
      var row = campaignRows.next();
      var text = stripKeywordSyntax_(
        String(
          (row.campaignCriterion &&
            row.campaignCriterion.keyword &&
            row.campaignCriterion.keyword.text) ||
            ''
        )
      );
      if (!text) continue;
      output.push({
        text: text,
        formatted: text,
        matchType: String(
          (row.campaignCriterion &&
            row.campaignCriterion.keyword &&
            row.campaignCriterion.keyword.matchType) ||
            'UNKNOWN'
        ).toUpperCase(),
        source: 'campaign'
      });
    }
  } catch (campaignNegError) {
    Logger.log(
      'PMax campaign negative GAQL failed for campaign ' + id + ': ' +
      cleanError_(campaignNegError)
    );
  }

  // Attached shared negative lists (when present) — two-step GAQL.
  // Cannot SELECT shared_criterion fields FROM campaign_shared_set.
  var listIds = [];
  var listNamesById = {};
  try {
    var attachQuery =
      'SELECT shared_set.id, shared_set.name ' +
      'FROM campaign_shared_set ' +
      'WHERE campaign.id = ' + id + ' ' +
      "AND shared_set.type = 'NEGATIVE_KEYWORDS'";
    var attachRows = AdsApp.search(attachQuery);
    while (attachRows.hasNext()) {
      var arow = attachRows.next();
      var lid = String((arow.sharedSet && arow.sharedSet.id) || '');
      if (!lid) continue;
      listIds.push(lid);
      listNamesById[lid] = String(
        (arow.sharedSet && arow.sharedSet.name) || 'shared list'
      );
    }
  } catch (attachError) {
    Logger.log(
      'PMax shared-list attach GAQL skipped for campaign ' + id + ': ' +
      cleanError_(attachError)
    );
  }

  if (listIds.length) {
    var sharedQuery =
      'SELECT shared_set.id, shared_criterion.keyword.text, ' +
      'shared_criterion.keyword.match_type ' +
      'FROM shared_criterion ' +
      'WHERE shared_set.id IN (' + listIds.join(',') + ') ' +
      "AND shared_criterion.type = 'KEYWORD'";
    try {
      var sharedRows = AdsApp.search(sharedQuery);
      while (sharedRows.hasNext()) {
        var srow = sharedRows.next();
        var listId = String(
          (srow.sharedSet && srow.sharedSet.id) || ''
        );
        var listName = listNamesById[listId] ||
          String((srow.sharedSet && srow.sharedSet.name) || 'shared list');
        var stext = stripKeywordSyntax_(
          String(
            (srow.sharedCriterion &&
              srow.sharedCriterion.keyword &&
              srow.sharedCriterion.keyword.text) ||
              ''
          )
        );
        if (!stext) continue;
        var entry = {
          text: stext,
          formatted: stext,
          matchType: String(
            (srow.sharedCriterion &&
              srow.sharedCriterion.keyword &&
              srow.sharedCriterion.keyword.matchType) ||
              'UNKNOWN'
          ).toUpperCase(),
          source: 'shared list "' + listName + '"'
        };
        output.push(entry);
        if (listId) {
          if (!sharedListCache[listId]) sharedListCache[listId] = [];
          sharedListCache[listId].push(entry);
        }
      }
    } catch (sharedNegError) {
      Logger.log(
        'PMax shared-list keyword GAQL skipped for campaign ' + id + ': ' +
        cleanError_(sharedNegError)
      );
    }
  }

  return output;
}

function addExactNegativeToCache_(campaignId, keywordText, cache) {
  if (!cache[campaignId]) cache[campaignId] = [];
  cache[campaignId].push({
    text: keywordText,
    formatted: '[' + keywordText + ']',
    matchType: 'EXACT',
    source: 'campaign'
  });
}

function verifyCampaignExactNegative_(campaign, expectedText, isPmax) {
  var expected = normalizeText_(expectedText);
  if (isPmax) {
    var rows = loadPmaxCampaignNegativesViaGaql_(String(campaign.getId()), {});
    for (var i = 0; i < rows.length; i++) {
      if (
        String(rows[i].matchType).toUpperCase() === 'EXACT' &&
        normalizeText_(rows[i].text) === expected
      ) {
        return true;
      }
    }
    return false;
  }
  var iterator = campaign.negativeKeywords().get();
  while (iterator.hasNext()) {
    var keyword = iterator.next();
    if (
      String(keyword.getMatchType()).toUpperCase() === 'EXACT' &&
      normalizeText_(stripKeywordSyntax_(keyword.getText())) === expected
    ) {
      return true;
    }
  }
  return false;
}

function assertPMaxNegativeMethods_(campaign, requireCreate) {
  // AdsApp.PerformanceMaxCampaign does NOT expose negativeKeywords() or
  // createNegativeKeyword(). Adds use AdsApp.mutateAll(campaignCriterion);
  // coverage reads use GAQL. Only require a resolvable campaign resource name.
  var missing = [];
  if (!campaign) {
    missing.push('campaign object');
  } else if (requireCreate && typeof campaign.getResourceName !== 'function') {
    missing.push('getResourceName()');
  }
  if (missing.length) {
    throw new Error(
      'PMax campaign-level exact negatives are unavailable in this Scripts ' +
      'runtime (the PMax campaign object is missing ' + missing.join(' and ') +
      '). No Ads change was assumed successful.'
    );
  }
}

function buildExactCampaignNegativeCreateOperation_(campaignResourceName, keywordText) {
  return {
    campaignCriterionOperation: {
      create: {
        campaign: String(campaignResourceName || ''),
        negative: true,
        keyword: {
          text: String(keywordText || ''),
          matchType: 'EXACT'
        }
      }
    }
  };
}

/**
 * Apply queued exact campaign negatives with AdsApp.mutateAll.
 * One mutateAll per campaign keeps Change History as one script change
 * (with all keywords in that batch) instead of one row per createNegativeKeyword.
 * Returns true if any add failed.
 */
function flushPendingExactNegatives_(pendingAdds, output, preview) {
  if (!pendingAdds || !pendingAdds.length) return false;

  var hadFailure = false;
  var groups = {};
  var order = [];
  var i;

  for (i = 0; i < pendingAdds.length; i++) {
    var item = pendingAdds[i];
    var resourceName = '';
    try {
      resourceName = String(item.campaign.getResourceName() || '');
    } catch (resourceError) {
      resourceName = '';
    }
    if (!resourceName) {
      output.failed += 1;
      hadFailure = true;
      recordTermDecision_(
        output,
        item.term,
        item.ruleResult,
        'FAILED',
        'Campaign resource name was unavailable for batch mutate.'
      );
      pushAction_(output, {
        channel: item.term.channel,
        campaignId: item.term.campaignId,
        campaignName: item.term.campaignName,
        searchTerm: item.term.searchTerm,
        exactNegative: item.prepared.formatted,
        matchedRules: item.ruleResult.eligibleRules,
        impressions: item.term.actionImpressions,
        clicks: item.term.actionClicks,
        cost: item.term.actionCost,
        decision: 'FAILED',
        reason: 'Campaign resource name was unavailable for batch mutate.'
      });
      continue;
    }
    if (!groups[resourceName]) {
      groups[resourceName] = [];
      order.push(resourceName);
    }
    groups[resourceName].push(item);
  }

  for (i = 0; i < order.length; i++) {
    if (applyExactNegativesBatch_(groups[order[i]], output, preview)) {
      hadFailure = true;
    }
  }
  return hadFailure;
}

function applyExactNegativesBatch_(items, output, preview) {
  var hadFailure = false;
  if (!items || !items.length) return false;

  var CHUNK_SIZE = 2000;
  var start = 0;
  while (start < items.length) {
    var chunk = items.slice(start, start + CHUNK_SIZE);
    start += CHUNK_SIZE;

    var operations = [];
    var j;
    for (j = 0; j < chunk.length; j++) {
      operations.push(buildExactCampaignNegativeCreateOperation_(
        chunk[j].campaign.getResourceName(),
        chunk[j].prepared.text
      ));
    }

    if (preview) {
      for (j = 0; j < chunk.length; j++) {
        var previewItem = chunk[j];
        addExactNegativeToCache_(
          previewItem.term.campaignId,
          previewItem.prepared.text,
          previewItem.campaignNegativeCache
        );
        output.added += 1;
        recordTermDecision_(
          output,
          previewItem.term,
          previewItem.ruleResult,
          'WOULD_ADD',
          'Preview only — would batch-add this exact campaign negative.'
        );
        pushAction_(output, {
          channel: previewItem.term.channel,
          campaignId: previewItem.term.campaignId,
          campaignName: previewItem.term.campaignName,
          searchTerm: previewItem.term.searchTerm,
          exactNegative: previewItem.prepared.formatted,
          matchedRules: previewItem.ruleResult.eligibleRules,
          impressions: previewItem.term.actionImpressions,
          clicks: previewItem.term.actionClicks,
          cost: previewItem.term.actionCost,
          decision: 'WOULD_ADD',
          reason: 'Preview only — would batch-add this exact campaign negative.'
        });
      }
      continue;
    }

    var results = null;
    try {
      if (typeof AdsApp.mutateAll !== 'function') {
        throw new Error(
          'AdsApp.mutateAll is unavailable in this Scripts runtime, ' +
          'so negatives cannot be batch-created.'
        );
      }
      results = AdsApp.mutateAll(operations, { partialFailure: true });
    } catch (mutateError) {
      for (j = 0; j < chunk.length; j++) {
        output.failed += 1;
        hadFailure = true;
        var mutateFailureReason = cleanError_(mutateError);
        recordTermDecision_(
          output,
          chunk[j].term,
          chunk[j].ruleResult,
          'FAILED',
          mutateFailureReason
        );
        pushAction_(output, {
          channel: chunk[j].term.channel,
          campaignId: chunk[j].term.campaignId,
          campaignName: chunk[j].term.campaignName,
          searchTerm: chunk[j].term.searchTerm,
          exactNegative: chunk[j].prepared.formatted,
          matchedRules: chunk[j].ruleResult.eligibleRules,
          impressions: chunk[j].term.actionImpressions,
          clicks: chunk[j].term.actionClicks,
          cost: chunk[j].term.actionCost,
          decision: 'FAILED',
          reason: mutateFailureReason
        });
      }
      continue;
    }

    for (j = 0; j < chunk.length; j++) {
      var item = chunk[j];
      var result = results && results[j] ? results[j] : null;
      var ok = !!(
        result &&
        typeof result.isSuccessful === 'function' &&
        result.isSuccessful()
      );
      if (ok) {
        addExactNegativeToCache_(
          item.term.campaignId,
          item.prepared.text,
          item.campaignNegativeCache
        );
        output.added += 1;
        recordTermDecision_(
          output,
          item.term,
          item.ruleResult,
          'ADDED',
          'Batch-added the full query as an exact campaign negative.'
        );
        pushAction_(output, {
          channel: item.term.channel,
          campaignId: item.term.campaignId,
          campaignName: item.term.campaignName,
          searchTerm: item.term.searchTerm,
          exactNegative: item.prepared.formatted,
          matchedRules: item.ruleResult.eligibleRules,
          impressions: item.term.actionImpressions,
          clicks: item.term.actionClicks,
          cost: item.term.actionCost,
          decision: 'ADDED',
          reason: 'Batch-added the full query as an exact campaign negative.'
        });
      } else {
        var reason = 'Batch mutate failed for this exact campaign negative.';
        if (result && typeof result.getErrorMessages === 'function') {
          var errs = result.getErrorMessages() || [];
          if (errs.length) reason = errs.join(' | ');
        }
        output.failed += 1;
        hadFailure = true;
        recordTermDecision_(
          output,
          item.term,
          item.ruleResult,
          'FAILED',
          reason
        );
        pushAction_(output, {
          channel: item.term.channel,
          campaignId: item.term.campaignId,
          campaignName: item.term.campaignName,
          searchTerm: item.term.searchTerm,
          exactNegative: item.prepared.formatted,
          matchedRules: item.ruleResult.eligibleRules,
          impressions: item.term.actionImpressions,
          clicks: item.term.actionClicks,
          cost: item.term.actionCost,
          decision: 'FAILED',
          reason: reason
        });
      }
    }
  }
  return hadFailure;
}



function inspectExactNegative_(searchTerm) {
  var text = String(searchTerm || '').trim();
  text = text.replace(/[\[\]"]/g, ' ');
  text = text.replace(/[,!@%^()={} ;~`<>?\\|]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return {
    text: text,
    formatted: text ? '[' + text + ']' : '',
    characterCount: text.length,
    wordCount: text ? text.split(/\s+/).length : 0
  };
}

function prepareExactNegative_(searchTerm) {
  var info = inspectExactNegative_(searchTerm);
  if (!info.text) {
    return {
      ok: false,
      manualReview: false,
      text: '',
      formatted: '',
      reason: 'The search term became empty after sanitization.'
    };
  }

  var issues = [];
  if (info.characterCount > CONFIG.MAX_NEGATIVE_KEYWORD_CHARACTERS) {
    issues.push(
      info.characterCount + ' characters (maximum ' +
      CONFIG.MAX_NEGATIVE_KEYWORD_CHARACTERS + ')'
    );
  }
  if (info.wordCount > CONFIG.MAX_NEGATIVE_KEYWORD_WORDS) {
    issues.push(
      info.wordCount + ' words (maximum ' +
      CONFIG.MAX_NEGATIVE_KEYWORD_WORDS + ')'
    );
  }
  if (issues.length) {
    return {
      ok: false,
      manualReview: true,
      text: info.text,
      formatted: info.formatted,
      reason: 'Skipped because the proposed exact negative has ' +
        issues.join(' and ') + '.'
    };
  }
  return {
    ok: true,
    manualReview: false,
    text: info.text,
    formatted: info.formatted,
    reason: ''
  };
}

function negativeBlocksSearchTerm_(negativeText, matchType, searchTerm) {
  var negativeTokens = tokenize_(negativeText);
  var searchTokens = tokenize_(searchTerm);
  if (!negativeTokens.length || !searchTokens.length) return false;
  var match = String(matchType || '').toUpperCase();
  if (match === 'EXACT') {
    return negativeTokens.join(' ') === searchTokens.join(' ');
  }
  if (match === 'PHRASE') {
    return (
      (' ' + searchTokens.join(' ') + ' ').indexOf(
        ' ' + negativeTokens.join(' ') + ' '
      ) !== -1
    );
  }
  if (match === 'BROAD') {
    var searchSet = toSet_(searchTokens);
    for (var i = 0; i < negativeTokens.length; i++) {
      if (!searchSet[negativeTokens[i]]) return false;
    }
    return true;
  }
  return false;
}

function sendSummaryEmail_(payload) {
  var recipients = normalizeEmailList_(CONFIG.EMAIL_RECIPIENTS);
  if (!recipients) {
    Logger.log('CONFIG.EMAIL_RECIPIENTS is empty — skipped summary email.');
    return;
  }

  var results = payload.results || [];
  var totals = summarizeResults_(results);
  var auditCsv = buildDecisionAuditCsv_(results);
  payload.auditCsvRows = auditCsv.rowCount;
  payload.auditCsvTruncated = auditCsv.truncated;
  var dateLabel = formatEmailDateLabel_(payload.todayText);
  var subject = buildSummaryEmailSubject_(payload, totals, dateLabel);
  var html = buildSummaryEmailHtml_(payload, totals, dateLabel);
  var plain = buildSummaryEmailPlain_(payload, totals, dateLabel);

  var mailOptions = {
    to: recipients,
    subject: subject,
    body: plain,
    htmlBody: html,
    name: CONFIG.EMAIL_FROM_NAME || 'Built by Shah Negatives'
  };
  if (
    CONFIG.ATTACH_DECISION_AUDIT_CSV !== false &&
    auditCsv.rowCount > 0
  ) {
    var safeRunId = String(payload.runId || buildRunId_())
      .replace(/[^A-Za-z0-9_-]+/g, '_');
    mailOptions.attachments = [
      Utilities.newBlob(
        auditCsv.content,
        'text/csv',
        'search-negatives-decision-audit-' + safeRunId + '.csv'
      )
    ];
  }
  MailApp.sendEmail(mailOptions);
  Logger.log('Sent standalone negatives summary email to: ' + recipients);
}

function buildDecisionAuditCsv_(results) {
  var headers = [
    'Account ID',
    'Account',
    'Channel',
    'Campaign ID',
    'Campaign',
    'Search Term',
    'First Seen',
    'Last Seen',
    'Impressions',
    'Clicks',
    'Cost',
    'Action Conversions',
    'History Conversions',
    'Matched Rules',
    'Decision',
    'Reason'
  ];
  var lines = [headers.map(csvCell_).join(',')];
  var rowCount = 0;
  var truncated = false;
  var cap = CONFIG.MAX_AUDIT_CSV_ROWS_PER_WAVE || 25000;

  for (var i = 0; i < (results || []).length; i++) {
    var result = results[i] || {};
    if (result.auditTruncated) truncated = true;
    var rows = result.auditRows || [];
    for (var j = 0; j < rows.length; j++) {
      if (rowCount >= cap) {
        truncated = true;
        break;
      }
      var row = rows[j] || {};
      lines.push([
        formatCustomerIdDashes_(result.customerId || ''),
        result.accountName || '',
        row.channel || '',
        row.campaignId || '',
        row.campaignName || '',
        row.searchTerm || '',
        row.firstSeenDate || '',
        row.lastSeenDate || '',
        number_(row.impressions),
        number_(row.clicks),
        round_(row.cost, 2),
        round_(row.conversions, 4),
        round_(row.historyConversions, 4),
        (row.matchedRules || []).join(' | '),
        row.decision || '',
        row.reason || ''
      ].map(csvCell_).join(','));
      rowCount += 1;
    }
    if (rowCount >= cap) break;
  }

  return {
    content: lines.join('\r\n'),
    rowCount: rowCount,
    truncated: truncated
  };
}

function csvCell_(value) {
  var text = String(value == null ? '' : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function summarizeResults_(results) {
  var totals = {
    added: 0,
    failed: 0,
    manualReview: 0,
    hitSafetyCeiling: 0,
    successAccounts: 0,
    termsReviewed: 0,
    rawSearchRows: 0,
    rawPmaxRows: 0,
    decisionCounts: {}
  };
  for (var i = 0; i < results.length; i++) {
    var r = results[i] || {};
    totals.added += number_(r.added);
    totals.failed += number_(r.failed);
    totals.manualReview += number_(r.manualReview);
    totals.termsReviewed += number_(r.termsReviewed);
    totals.rawSearchRows += number_(r.rawRows && r.rawRows.SEARCH);
    totals.rawPmaxRows += number_(r.rawRows && r.rawRows.PMAX);
    var decisions = Object.keys(r.decisionCounts || {});
    for (var d = 0; d < decisions.length; d++) {
      var name = decisions[d];
      totals.decisionCounts[name] =
        number_(totals.decisionCounts[name]) + number_(r.decisionCounts[name]);
    }
    if (r.hitSafetyCeiling) totals.hitSafetyCeiling += 1;
    if (r.success) totals.successAccounts += 1;
  }
  return totals;
}

function buildSummaryEmailSubject_(payload, totals, dateLabel) {
  var prefix = 'Built by Shah | Search Negatives';
  if (payload.waveEmpty) {
    return prefix + ' — All caught up — ' + dateLabel;
  }
  if (totals.added > 0) {
    return prefix + ' — ' + totals.added + ' add' +
      (totals.added === 1 ? '' : 's') + ' across ' +
      (payload.results || []).length + ' account' +
      ((payload.results || []).length === 1 ? '' : 's') +
      ' — ' + dateLabel;
  }
  if (totals.failed > 0) {
    return prefix + ' — ' + totals.failed + ' failure' +
      (totals.failed === 1 ? '' : 's') + ' — ' + dateLabel;
  }
  return prefix + ' — All clear — ' + dateLabel;
}

function formatEmailDateLabel_(todayText) {
  var text = String(todayText || '').trim();
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return Utilities.formatDate(
      new Date(),
      CONFIG.QUEUE_TIME_ZONE || 'America/Los_Angeles',
      'MMMM d, yyyy'
    );
  }
  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[Number(match[2]) - 1] + ' ' + Number(match[3]) + ', ' + match[1];
}

function buildSummaryEmailHtml_(payload, totals, dateLabel) {
  var results = (payload.results || []).slice();
  results.sort(function (a, b) {
    return String(a.accountName || '').localeCompare(String(b.accountName || ''));
  });

  var statusLine = buildEmailStatusLine_(payload, totals, results.length);
  var aboutLine = payload.waveEmpty ?
    'No allowlisted accounts were due in this wave. Everyone already has today’s done label, or none matched under the MCC.' :
    'This email covers ' + results.length + ' account' +
    (results.length === 1 ? '' : 's') +
    ' from the current standalone Search + PMax negatives wave (rolling seven completed days). ' +
    'One summary email per wave — not one email per shop. ' +
    'The attached decision-audit CSV includes every retained unique term, including NO_RULE rows. ' +
    'Google Ads Scripts process up to 50 accounts per run. ' +
    'With more than 50 allowlisted shops, a second scheduled Scripts row may send another wave email. ' +
    'Verify adds in Campaign → Negatives (exact). Scripts Details may blank Account/Campaign columns when using mutateAll.';

  var bodyInner = '';
  if (payload.waveEmpty) {
    bodyInner +=
      '<div style="margin:8px 0 0;padding:14px 16px;border-radius:8px;' +
      'background:#ecfdf3;border:1px solid #abefc6;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
        'font-weight:800;text-transform:uppercase;color:#087443;">' +
          'All caught up' +
        '</div>' +
        '<div style="font-size:15px;line-height:22px;font-weight:700;' +
        'color:#085d3a;margin-top:2px;">No accounts were due this wave</div>' +
        '<div style="font-size:13px;line-height:20px;color:#344054;' +
        'margin-top:8px;">' + escapeHtml_(aboutLine) + '</div>' +
      '</div>';
  } else {
    bodyInner +=
      '<div style="font-size:18px;line-height:26px;font-weight:700;color:#172b4d;' +
      'margin:0 0 6px;">Wave snapshot</div>' +
      '<div style="font-size:12px;line-height:18px;color:#667085;margin:0 0 14px;">' +
        'Counts for the accounts in this email only.' +
      '</div>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 8px;">' +
        '<tr>' +
          buildMetricTile_('Accounts', results.length, '#eaf2f8') +
          buildMetricTile_('Added', totals.added, '#e9f7ef') +
          buildMetricTile_('Failures', totals.failed, '#fdecec') +
          buildMetricTile_('Manual review', totals.manualReview, '#fff8e1') +
        '</tr>' +
      '</table>';
    bodyInner += buildWaveDecisionSummaryHtml_(totals);
    if (payload.auditCsvTruncated) {
      bodyInner +=
        '<div style="margin:10px 0 0;padding:10px 12px;border-radius:8px;' +
        'background:#fffbeb;border:1px solid #fcd34d;">' +
          '<div style="font-size:12px;line-height:18px;color:#78350f;">' +
            '<strong>Audit CSV truncated.</strong> At least one account or this wave ' +
            'exceeded the configured audit cap. Decision counts still cover every ' +
            'evaluated unique term; raise the cap and rerun if row-level overflow is needed.' +
          '</div>' +
        '</div>';
    }
    if (totals.manualReview > 0) {
      bodyInner +=
        '<div style="margin:10px 0 0;padding:10px 12px;border-radius:8px;' +
        'background:#fffbeb;border:1px solid #fcd34d;">' +
          '<div style="font-size:12px;line-height:18px;color:#78350f;">' +
            '<strong>Manual review</strong> = junk that matched rules but was too long '
            + '(over 80 characters or 10 words) to auto-add. Those terms are listed '
            + 'under each shop below so you can copy/paste into Campaign → Negatives.' +
          '</div>' +
        '</div>';
    }

    if (totals.hitSafetyCeiling > 0) {
      bodyInner +=
        '<div style="margin:14px 0 0;padding:12px 14px;border-radius:8px;' +
        'background:#fff8e6;border:1px solid #f5d98b;">' +
          '<div style="font-size:13px;line-height:20px;color:#7a4d00;font-weight:700;">' +
            totals.hitSafetyCeiling + ' account' +
            (totals.hitSafetyCeiling === 1 ? '' : 's') +
            ' hit the safety ceiling and were not stamped done.' +
          '</div>' +
        '</div>';
    }

    bodyInner += buildEmailAccountCardsHtml_(results);
  }

  return '' +
    '<!doctype html>' +
    '<html><body style="margin:0;padding:0;background:#e8eef4;' +
    'font-family:Arial,Helvetica,sans-serif;color:#172b4d;">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' +
        escapeHtml_(statusLine) +
      '</div>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;background:#e8eef4;">' +
        '<tr><td align="center" style="padding:24px 12px;">' +
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
          'style="width:100%;max-width:760px;border-collapse:collapse;' +
          'box-shadow:0 1px 3px rgba(16,24,40,.08);">' +
            buildNegativesEmailHeroHtml_({
              dateLabel: dateLabel,
              runId: payload.runId || '',
              statusLine: statusLine,
              aboutLine: aboutLine
            }) +
            '<tr><td style="background:#ffffff;padding:26px 28px 8px;">' +
              bodyInner +
            '</td></tr>' +
            buildNegativesEmailFooterHtml_(payload.runId || '', dateLabel) +
          '</table>' +
        '</td></tr>' +
      '</table>' +
    '</body></html>';
}

function buildWaveDecisionSummaryHtml_(totals) {
  var counts = totals.decisionCounts || {};
  var converted = number_(counts.CONVERTED_ACTION_WINDOW) +
    number_(counts.CONVERTED_HISTORY);
  return '' +
    '<div style="margin:10px 0 0;padding:12px 14px;border-radius:8px;' +
    'background:#f4f8fc;border:1px solid #d0dfea;">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
      'font-weight:800;text-transform:uppercase;color:#1d4f7a;">' +
        'Reconciled decision funnel' +
      '</div>' +
      '<div style="font-size:12px;line-height:19px;color:#344054;margin-top:5px;">' +
        'Raw action-window rows: Search ' + number_(totals.rawSearchRows) +
        ' · PMax ' + number_(totals.rawPmaxRows) +
        ' · Unique campaign terms: ' + number_(totals.termsReviewed) +
        ' · Added: ' + number_(counts.ADDED) +
        ' · No rule: ' + number_(counts.NO_RULE) +
        ' · Protected: ' + number_(counts.PROTECTED) +
        ' · Google status: ' + number_(counts.GOOGLE_STATUS) +
        ' · Converted: ' + converted +
        ' · Already covered: ' + number_(counts.ALREADY_COVERED) +
        ' · Manual review: ' + number_(counts.MANUAL_REVIEW) +
        ' · Failed: ' + number_(counts.FAILED) +
      '</div>' +
    '</div>';
}

function buildEmailStatusLine_(payload, totals, accountCount) {
  if (payload.waveEmpty) {
    return 'No allowlisted accounts were due. All caught up for today.';
  }
  if (totals.added > 0) {
    return totals.added + ' exact negative' +
      (totals.added === 1 ? ' was' : 's were') +
      ' added across ' + accountCount + ' account' +
      (accountCount === 1 ? '' : 's') + ' in this wave.';
  }
  if (totals.failed > 0) {
    return 'No negatives were added. ' + totals.failed + ' failure' +
      (totals.failed === 1 ? '' : 's') + ' need a look.';
  }
  return 'All clear — scanned ' + accountCount + ' account' +
    (accountCount === 1 ? '' : 's') + ' with no new exact negatives.';
}

function buildNegativesEmailHeroHtml_(options) {
  return '' +
    '<tr><td style="background:#17324d;padding:22px 28px 24px;border-radius:10px 10px 0 0;">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;">' +
        '<tr>' +
          '<td valign="middle">' +
            '<div style="font-size:18px;line-height:24px;font-weight:800;' +
            'letter-spacing:.2px;color:#ffffff;">Built by Shah</div>' +
            '<div style="font-size:11px;line-height:16px;color:#9eb4c7;' +
            'margin-top:2px;letter-spacing:.4px;text-transform:uppercase;' +
            'font-weight:700;">Google Ads Scripts</div>' +
          '</td>' +
          '<td align="right" valign="top" style="padding-left:14px;">' +
            '<span style="display:inline-block;border:1px solid #6f879d;' +
            'border-radius:999px;padding:5px 9px;color:#e8f0f7;font-size:10px;' +
            'line-height:14px;letter-spacing:.6px;text-transform:uppercase;' +
            'font-weight:700;white-space:nowrap;">For internal use only</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<div style="font-size:26px;line-height:34px;color:#ffffff;font-weight:700;' +
      'margin-top:14px;">Search Negatives Sweep</div>' +
      '<div style="font-size:14px;line-height:21px;color:#d9e8f5;margin-top:6px;' +
      'max-width:560px;">' +
        'Morning summary of exact campaign negatives added to Search and ' +
        'Performance Max. Handle as confidential agency operations material.' +
      '</div>' +
      '<table role="presentation" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;margin-top:14px;">' +
        buildEmailHeroMetaRow_('Report date', options.dateLabel || '') +
        buildEmailHeroMetaRow_('Reference', options.runId || '—') +
        buildEmailHeroMetaRow_('Audience', 'Account managers') +
      '</table>' +
      '<div style="margin-top:12px;padding:12px 14px;background:rgba(255,255,255,.08);' +
      'border:1px solid rgba(255,255,255,.14);border-radius:8px;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
        'text-transform:uppercase;font-weight:800;color:#9eb4c7;">' +
          'About this email' +
        '</div>' +
        '<div style="font-size:13px;line-height:20px;color:#e8f0f7;margin-top:6px;">' +
          escapeHtml_(options.aboutLine || '') +
        '</div>' +
      '</div>' +
      '<div style="font-size:14px;line-height:21px;color:#ffffff;font-weight:700;' +
      'margin-top:14px;">' +
        escapeHtml_(options.statusLine || '') +
      '</div>' +
    '</td></tr>';
}

function buildEmailHeroMetaRow_(label, value) {
  return '' +
    '<tr>' +
      '<td valign="top" style="width:108px;padding:0 12px 7px 0;font-size:12px;' +
      'line-height:18px;color:#9eb4c7;font-weight:700;white-space:nowrap;">' +
        escapeHtml_(label) +
      '</td>' +
      '<td valign="top" style="padding:0 0 7px;font-size:13px;line-height:18px;' +
      'color:#e8f0f7;">' +
        escapeHtml_(value) +
      '</td>' +
    '</tr>';
}

function buildMetricTile_(label, value, background) {
  return '' +
    '<td width="25%" valign="top" style="padding:0 4px;">' +
      '<div style="background:' + background + ';border-radius:8px;padding:13px 10px;' +
      'text-align:center;">' +
        '<div style="font-size:22px;line-height:28px;font-weight:700;color:#172b4d;">' +
          escapeHtml_(String(value)) +
        '</div>' +
        '<div style="font-size:11px;line-height:16px;color:#52667a;margin-top:3px;">' +
          escapeHtml_(label) +
        '</div>' +
      '</div>' +
    '</td>';
}

function buildEmailAccountCardsHtml_(results) {
  if (!results.length) return '';

  var withAdds = [];
  var withoutAdds = [];
  var i;
  for (i = 0; i < results.length; i++) {
    if (number_(results[i].added) > 0) withAdds.push(results[i]);
    else withoutAdds.push(results[i]);
  }

  var html = '';
  if (withAdds.length) {
    html +=
      '<div style="margin:22px 0 12px;padding:10px 12px;border-radius:8px;' +
      'background:#ecfdf3;border:1px solid #abefc6;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
        'font-weight:800;text-transform:uppercase;color:#087443;">' +
          'Added — review these' +
        '</div>' +
        '<div style="font-size:15px;line-height:22px;font-weight:700;' +
        'color:#085d3a;margin-top:2px;">' +
          withAdds.length + ' shop' + (withAdds.length === 1 ? '' : 's') +
          ' got new exact campaign negatives' +
        '</div>' +
      '</div>';
    for (i = 0; i < withAdds.length; i++) {
      html += buildAccountEmailCard_(withAdds[i], true);
    }
  }

  if (withoutAdds.length) {
    html +=
      '<div style="margin:22px 0 12px;padding:10px 12px;border-radius:8px;' +
      'background:#f4f8fc;border:1px solid #d0dfea;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
        'font-weight:800;text-transform:uppercase;color:#1d4f7a;">' +
          'Scanned — no new adds' +
        '</div>' +
        '<div style="font-size:15px;line-height:22px;font-weight:700;' +
        'color:#0f3d63;margin-top:2px;">' +
          withoutAdds.length + ' shop' + (withoutAdds.length === 1 ? '' : 's') +
          ' had no new exact negatives' +
        '</div>' +
      '</div>';
    for (i = 0; i < withoutAdds.length; i++) {
      html += buildAccountEmailCard_(withoutAdds[i], false);
    }
  }
  return html;
}

function buildManualReviewEmailSectionHtml_(manuals, totalManualCount) {
  manuals = manuals || [];
  var total = totalManualCount != null ? number_(totalManualCount) : manuals.length;
  if (!manuals.length && total < 1) return '';
  var maxRows = CONFIG.MAX_EMAIL_MANUAL_REVIEW_ROWS_PER_ACCOUNT || 40;
  var shown = Math.min(manuals.length, maxRows);
  var html =
    '<div style="margin-top:14px;padding:12px 14px;border-radius:8px;' +
    'background:#fffbeb;border:1px solid #fcd34d;">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
      'font-weight:800;text-transform:uppercase;color:#92400e;">' +
        'Manual review — copy/paste into Ads' +
      '</div>' +
      '<div style="font-size:12px;line-height:18px;color:#78350f;margin-top:4px;">' +
        'Not auto-added (over 80 characters or 10 words). Paste the exact text into ' +
        'Campaign → Negatives if you still want them blocked.' +
      '</div>';
  if (!manuals.length) {
    html +=
      '<div style="margin-top:8px;font-size:12px;color:#92400e;">' +
        total + ' term(s) needed manual review (details not in this email sample).' +
      '</div></div>';
    return html;
  }
  html +=
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
    'style="border-collapse:collapse;font-size:12px;margin-top:10px;">' +
      '<tr style="text-align:left;background:#fef3c7;">' +
        '<th style="padding:6px 8px;border-bottom:1px solid #fcd34d;color:#92400e;' +
        'font-size:10px;letter-spacing:.4px;text-transform:uppercase;">Ch</th>' +
        '<th style="padding:6px 8px;border-bottom:1px solid #fcd34d;color:#92400e;' +
        'font-size:10px;letter-spacing:.4px;text-transform:uppercase;">Campaign</th>' +
        '<th style="padding:6px 8px;border-bottom:1px solid #fcd34d;color:#92400e;' +
        'font-size:10px;letter-spacing:.4px;text-transform:uppercase;">Paste this</th>' +
        '<th style="padding:6px 8px;border-bottom:1px solid #fcd34d;color:#92400e;' +
        'font-size:10px;letter-spacing:.4px;text-transform:uppercase;">Why</th>' +
      '</tr>';
  for (var m = 0; m < shown; m++) {
    var row = manuals[m];
    var paste = row.exactNegative ||
      (row.searchTerm ? '[' + String(row.searchTerm).trim() + ']' : '');
    html +=
      '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #fde68a;vertical-align:top;' +
        'font-weight:700;color:#78350f;">' +
          escapeHtml_(row.channel || '') +
        '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #fde68a;vertical-align:top;' +
        'color:#78350f;">' +
          escapeHtml_(row.campaignName || row.campaignId || '') +
        '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #fde68a;vertical-align:top;' +
        'font-family:ui-monospace,Menlo,Consolas,monospace;color:#101828;">' +
          escapeHtml_(paste) +
        '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #fde68a;vertical-align:top;' +
        'color:#92400e;">' +
          escapeHtml_(row.reason || '') +
        '</td>' +
      '</tr>';
  }
  html += '</table>';
  var listedTotal = Math.max(total, manuals.length);
  if (listedTotal > shown) {
    html +=
      '<div style="margin-top:8px;font-size:12px;color:#92400e;">' +
        'Showing ' + shown + ' of ' + listedTotal +
        '. Check Logs or re-run with a higher log cap if you need the rest.' +
      '</div>';
  }
  html += '</div>';
  return html;
}

function channelAddSummary_(result) {
  var actions = result.actions || [];
  var search = 0;
  var pmax = 0;
  for (var i = 0; i < actions.length; i++) {
    if (actions[i].decision !== 'ADDED' && actions[i].decision !== 'WOULD_ADD') continue;
    if (actions[i].channel === 'PMAX') pmax += 1;
    else search += 1;
  }
  if (!search && !pmax && number_(result.added) > 0) {
    return ' · added ' + number_(result.added) +
      ' (see list; channel tags may be truncated in log)';
  }
  if (!search && !pmax) return '';
  return ' · SEARCH adds logged: ' + search + ' · PMAX adds logged: ' + pmax;
}

function buildAccountDecisionFunnelHtml_(result) {
  var counts = result.decisionCounts || {};
  var decisionTotal = sumDecisionCounts_(counts);
  var reconciled = decisionTotal === number_(result.termsReviewed);
  var labels = [
    ['Added', number_(counts.ADDED)],
    ['No rule', number_(counts.NO_RULE)],
    ['Protected', number_(counts.PROTECTED)],
    ['Google status', number_(counts.GOOGLE_STATUS)],
    ['Converted', number_(counts.CONVERTED_ACTION_WINDOW) +
      number_(counts.CONVERTED_HISTORY)],
    ['Covered', number_(counts.ALREADY_COVERED)],
    ['Manual', number_(counts.MANUAL_REVIEW)],
    ['Wrong campaign', number_(counts.WRONG_CAMPAIGN_NAME)],
    ['Failed', number_(counts.FAILED)],
    ['Safety ceiling', number_(counts.HIT_SAFETY_CEILING)]
  ];
  var parts = [];
  for (var i = 0; i < labels.length; i++) {
    if (labels[i][1]) parts.push(labels[i][0] + ' ' + labels[i][1]);
  }
  return '' +
    '<div style="margin:0 0 14px;padding:10px 12px;border-radius:8px;' +
    'background:' + (reconciled ? '#f4f8fc' : '#fef3f2') + ';border:1px solid ' +
    (reconciled ? '#d0dfea' : '#fecdca') + ';">' +
      '<div style="font-size:11px;line-height:16px;font-weight:800;' +
      'text-transform:uppercase;letter-spacing:.5px;color:' +
      (reconciled ? '#1d4f7a' : '#b42318') + ';">' +
        (reconciled ? 'Decision counts reconcile' : 'Decision mismatch') +
      '</div>' +
      '<div style="font-size:12px;line-height:18px;color:#344054;margin-top:4px;">' +
        'Raw rows: Search ' + number_(result.rawRows && result.rawRows.SEARCH) +
        ' · PMax ' + number_(result.rawRows && result.rawRows.PMAX) +
        ' · Unique terms ' + number_(result.termsReviewed) +
        ' · Decisions ' + decisionTotal +
        (parts.length ? ' · ' + escapeHtml_(parts.join(' · ')) : '') +
      '</div>' +
    '</div>';
}

function buildMatchedSkipRowsHtml_(result) {
  var rows = (result.auditRows || []).filter(function (row) {
    var decision = String(row.decision || '');
    return (row.matchedRules || []).length > 0 &&
      decision !== 'ADDED' &&
      decision !== 'WOULD_ADD' &&
      decision !== 'MANUAL_REVIEW' &&
      decision !== 'FAILED';
  });
  if (!rows.length) return '';

  var cap = CONFIG.MAX_EMAIL_MATCHED_SKIP_ROWS_PER_ACCOUNT || 20;
  var shown = Math.min(rows.length, cap);
  var html =
    '<div style="margin-top:14px;padding:12px 14px;border-radius:8px;' +
    'background:#f8fafc;border:1px solid #d0d5dd;">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
      'font-weight:800;text-transform:uppercase;color:#475467;">' +
        'Matched, then safely skipped' +
      '</div>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;font-size:12px;margin-top:8px;">';
  for (var i = 0; i < shown; i++) {
    var row = rows[i];
    html +=
      '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #eaecf0;' +
        'vertical-align:top;color:#101828;">' +
          escapeHtml_(row.searchTerm || '') +
        '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #eaecf0;' +
        'vertical-align:top;color:#475467;font-weight:700;">' +
          escapeHtml_(row.decision || '') +
        '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #eaecf0;' +
        'vertical-align:top;color:#667085;">' +
          escapeHtml_(row.reason || '') +
        '</td>' +
      '</tr>';
  }
  html += '</table>';
  if (rows.length > shown) {
    html +=
      '<div style="margin-top:8px;font-size:12px;color:#667085;">Showing ' +
      shown + ' of ' + rows.length + '; see the CSV for the complete audit.</div>';
  }
  return html + '</div>';
}

function buildAccountEmailCard_(result, hasAdds) {
  var adds = (result.actions || []).filter(function (a) {
    return a.decision === 'ADDED';
  });
  var fails = (result.actions || []).filter(function (a) {
    return a.decision === 'FAILED';
  });
  var manuals = (result.actions || []).filter(function (a) {
    return a.decision === 'MANUAL_REVIEW';
  });
  var border = hasAdds ? '#12b76a' : (fails.length ? '#f04438' : '#98a2b3');
  var headerBg = hasAdds ? '#ecfdf3' : (fails.length ? '#fef3f2' : '#f8fafc');
  var badgeBg = hasAdds ? '#ecfdf3' : (fails.length ? '#fdecec' : '#f2f4f7');
  var badgeColor = hasAdds ? '#087443' : (fails.length ? '#b42318' : '#475467');
  var badgeBorder = border;
  var badgeText = hasAdds ?
    ('Added · ' + number_(result.added)) :
    (fails.length ? ('Failed · ' + fails.length) : 'No new adds');

  var html = '' +
    '<div style="border:1px solid ' + border + ';border-left:6px solid ' + border +
    ';border-radius:9px;margin:0 0 18px;overflow:hidden;background:#ffffff;">' +
      '<div style="padding:15px 17px;background:' + headerBg +
      ';border-bottom:1px solid ' + border + ';">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
          '<tr>' +
            '<td style="font-size:17px;line-height:24px;color:#172b4d;font-weight:700;">' +
              escapeHtml_(result.accountName || result.customerId || 'Account') +
              '<div style="font-size:11px;line-height:16px;color:#718096;font-weight:400;' +
              'margin-top:2px;">' +
                escapeHtml_(formatCustomerIdDashes_(result.customerId || '')) +
                (result.success ? '' : ' · not stamped done') +
                (result.hitSafetyCeiling ? ' · safety ceiling' : '') +
                channelAddSummary_(result) +
              '</div>' +
              '<div style="font-size:11px;line-height:16px;color:#52667a;margin-top:6px;">' +
                'Verify in Ads: Campaign → Negatives (exact match). Script Details may blank Account/Campaign columns when batch-mutating.' +
              '</div>' +
            '</td>' +
            '<td align="right" valign="top">' +
              '<span style="display:inline-block;background:' + badgeBg +
              ';color:' + badgeColor + ';font-size:11px;line-height:16px;' +
              'font-weight:700;padding:5px 9px;border-radius:999px;border:1px solid ' +
              badgeBorder + ';">' +
                escapeHtml_(badgeText) +
              '</span>' +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +
      '<div style="padding:14px 17px 16px;">';

  html += buildAccountDecisionFunnelHtml_(result);

  if (adds.length) {
    var maxAddRows = CONFIG.MAX_EMAIL_ADD_ROWS_PER_ACCOUNT || 80;
    var shownAdds = Math.min(adds.length, maxAddRows);
    html +=
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;font-size:13px;">' +
        '<tr style="text-align:left;background:#f9fafb;">' +
          '<th style="padding:8px 8px;border-bottom:1px solid #e5e7eb;color:#475467;' +
          'font-size:11px;letter-spacing:.4px;text-transform:uppercase;">Ch</th>' +
          '<th style="padding:8px 8px;border-bottom:1px solid #e5e7eb;color:#475467;' +
          'font-size:11px;letter-spacing:.4px;text-transform:uppercase;">Campaign</th>' +
          '<th style="padding:8px 8px;border-bottom:1px solid #e5e7eb;color:#475467;' +
          'font-size:11px;letter-spacing:.4px;text-transform:uppercase;">Exact negative</th>' +
          '<th style="padding:8px 8px;border-bottom:1px solid #e5e7eb;color:#475467;' +
          'font-size:11px;letter-spacing:.4px;text-transform:uppercase;">Rules</th>' +
        '</tr>';
    for (var a = 0; a < shownAdds; a++) {
      var row = adds[a];
      html +=
        '<tr>' +
          '<td style="padding:8px;border-bottom:1px solid #f2f4f7;vertical-align:top;' +
          'color:#344054;font-weight:700;">' +
            escapeHtml_(row.channel || '') +
          '</td>' +
          '<td style="padding:8px;border-bottom:1px solid #f2f4f7;vertical-align:top;' +
          'color:#344054;">' +
            escapeHtml_(row.campaignName || row.campaignId || '') +
          '</td>' +
          '<td style="padding:8px;border-bottom:1px solid #f2f4f7;vertical-align:top;' +
          'font-family:ui-monospace,Menlo,Consolas,monospace;color:#101828;">' +
            escapeHtml_(row.exactNegative || '') +
          '</td>' +
          '<td style="padding:8px;border-bottom:1px solid #f2f4f7;vertical-align:top;' +
          'color:#475467;">' +
            escapeHtml_((row.matchedRules || []).join(', ')) +
          '</td>' +
        '</tr>';
    }
    html += '</table>';
    if (adds.length > shownAdds || number_(result.added) > shownAdds) {
      var totalAdded = Math.max(number_(result.added), adds.length);
      html +=
        '<div style="margin-top:10px;font-size:12px;line-height:18px;color:#667085;">' +
          'Showing ' + shownAdds + ' of ' + totalAdded +
          ' adds in this email (full count is in the shop badge / wave snapshot). ' +
          'Verify the rest in Google Ads → Campaign → Negatives.' +
        '</div>';
    }
  } else {
    html +=
      '<div style="font-size:13px;line-height:20px;color:#667085;">' +
        'No new exact negatives were added for this shop.' +
      '</div>';
  }

  html += buildMatchedSkipRowsHtml_(result);

  if (fails.length) {
    html +=
      '<div style="margin-top:14px;padding:12px 14px;border-radius:8px;' +
      'background:#fef3f2;border:1px solid #fecdca;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
        'font-weight:800;text-transform:uppercase;color:#b42318;">Failures</div>' +
        '<ul style="margin:8px 0 0;padding-left:18px;color:#7a271a;font-size:12px;' +
        'line-height:18px;">';
    for (var f = 0; f < Math.min(fails.length, CONFIG.MAX_EMAIL_FAIL_ROWS_PER_ACCOUNT || 15); f++) {
      html +=
        '<li style="margin:0 0 4px;">' +
          escapeHtml_(fails[f].searchTerm || '(account)') +
          ' — ' + escapeHtml_(fails[f].reason || '') +
        '</li>';
    }
    if (fails.length > (CONFIG.MAX_EMAIL_FAIL_ROWS_PER_ACCOUNT || 15)) {
      html += '<li>…and ' +
        (fails.length - (CONFIG.MAX_EMAIL_FAIL_ROWS_PER_ACCOUNT || 15)) +
        ' more</li>';
    }
    html += '</ul></div>';
  }

  html += buildManualReviewEmailSectionHtml_(
    manuals,
    number_(result.manualReview)
  );

  html += '</div></div>';
  return html;
}

function buildNegativesEmailFooterHtml_(runId, dateLabel) {
  return '' +
    '<tr><td style="padding:18px 28px 22px;color:#718096;font-size:12px;' +
    'line-height:18px;background:#ffffff;border-radius:0 0 10px 10px;' +
    'border-top:1px solid #e6edf3;">' +
      '<div style="text-align:center;font-size:11px;line-height:16px;' +
      'letter-spacing:.5px;text-transform:uppercase;font-weight:700;color:#52667a;">' +
        'Confidential — Internal Use Only' +
      '</div>' +
      '<div style="text-align:center;margin-top:6px;">' +
        'Campaign-level exact negatives only. Undo mistakes in Google Ads. ' +
        'Do not also enable the Hub/Spoke negatives sweeper on the same accounts.' +
      '</div>' +
      '<div style="text-align:center;margin-top:12px;color:#94a3b8;">' +
        'Issued by Built by Shah Standalone Daily Negatives Sweeper · ' +
        escapeHtml_(dateLabel || '') +
        (runId ? ' · Ref ' + escapeHtml_(runId) : '') +
      '</div>' +
    '</td></tr>';
}

function buildSummaryEmailPlain_(payload, totals, dateLabel) {
  var lines = [];
  lines.push('Built by Shah | Search Negatives');
  lines.push('Date: ' + (dateLabel || ''));
  lines.push('Run: ' + (payload.runId || ''));
  if (payload.waveEmpty) {
    lines.push('Queue empty — no accounts due this wave.');
    return lines.join('\n');
  }
  lines.push('Accounts: ' + (payload.results || []).length);
  lines.push('Adds: ' + totals.added);
  lines.push('Fails: ' + totals.failed);
  lines.push('Manual review: ' + totals.manualReview);
  lines.push('Raw Search rows: ' + totals.rawSearchRows);
  lines.push('Raw PMax rows: ' + totals.rawPmaxRows);
  lines.push('Unique evaluated terms: ' + totals.termsReviewed);
  lines.push('Decisions: ' + JSON.stringify(totals.decisionCounts || {}));
  lines.push('Audit CSV rows attached: ' + number_(payload.auditCsvRows));
  if (payload.auditCsvTruncated) {
    lines.push('WARNING: Audit CSV was truncated at the configured cap.');
  }
  lines.push('');
  var results = payload.results || [];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    lines.push(
      (r.accountName || r.customerId) + ' (' +
      formatCustomerIdDashes_(r.customerId || '') + ') — added ' +
      number_(r.added)
    );
    lines.push(
      '  Raw rows Search/PMax: ' +
      number_(r.rawRows && r.rawRows.SEARCH) + '/' +
      number_(r.rawRows && r.rawRows.PMAX) +
      ' · Unique: ' + number_(r.termsReviewed) +
      ' · Decisions: ' + JSON.stringify(r.decisionCounts || {})
    );
    var adds = (r.actions || []).filter(function (a) {
      return a.decision === 'ADDED';
    });
    for (var a = 0; a < adds.length; a++) {
      lines.push(
        '  [' + adds[a].channel + '] ' + adds[a].exactNegative +
        ' · ' + (adds[a].matchedRules || []).join(', ')
      );
    }
    var manualsPlain = (r.actions || []).filter(function (a) {
      return a.decision === 'MANUAL_REVIEW';
    });
    if (manualsPlain.length || number_(r.manualReview) > 0) {
      lines.push('  Manual review (paste into Ads Negatives):');
      for (var mp = 0; mp < manualsPlain.length; mp++) {
        var paste = manualsPlain[mp].exactNegative ||
          (manualsPlain[mp].searchTerm ?
            '[' + String(manualsPlain[mp].searchTerm).trim() + ']' : '');
        lines.push(
          '  MR [' + (manualsPlain[mp].channel || '') + '] ' + paste +
          ' · ' + (manualsPlain[mp].reason || '')
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeEmailList_(values) {
  var parts = [];
  if (!values) return '';
  if (typeof values === 'string') values = [values];
  for (var i = 0; i < values.length; i++) {
    var chunk = String(values[i] || '').split(/[,;\s]+/);
    for (var j = 0; j < chunk.length; j++) {
      var email = chunk[j].trim();
      if (email && parts.indexOf(email) === -1) parts.push(email);
    }
  }
  return parts.join(',');
}

function buildDateWindow_(timeZone, actionDays, historyDays) {
  var todayText = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  return buildDateWindowFromTodayText_(todayText, actionDays, historyDays);
}

function buildDateWindowFromTodayText_(todayText, actionDays, historyDays) {
  var today = parseDateTextAsUtc_(todayText);
  var actionEnd = addUtcDays_(today, -1);
  var actionStart = addUtcDays_(actionEnd, -(actionDays - 1));
  var historyStart = addUtcDays_(actionEnd, -(historyDays - 1));
  return {
    actionStart: formatUtcDatePure_(actionStart),
    actionEnd: formatUtcDatePure_(actionEnd),
    historyStart: formatUtcDatePure_(historyStart)
  };
}

function formatUtcDatePure_(date) {
  var year = date.getUTCFullYear();
  var month = String(date.getUTCMonth() + 1);
  var day = String(date.getUTCDate());
  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  return year + '-' + month + '-' + day;
}

function buildRunId_() {
  return 'STANDALONE_NEG_' +
    Utilities.formatDate(
      new Date(),
      CONFIG.QUEUE_TIME_ZONE || 'America/Los_Angeles',
      'yyyyMMdd_HHmmss'
    ) +
    '_' + Utilities.getUuid().substring(0, 8);
}

function hasBlockedSearchTermStatus_(statuses) {
  return !!(
    statuses.ADDED ||
    statuses.EXCLUDED ||
    statuses.ADDED_EXCLUDED
  );
}

function firstMatchingPhrase_(text, phrases) {
  for (var i = 0; i < phrases.length; i++) {
    if (containsPhrase_(text, phrases[i])) return phrases[i];
  }
  return '';
}

/**
 * Plural/stem-aware phrase match for every trigger/exception.
 * Examples: tints≈tint, bumpers≈bumper, scratches≈scratch, repaint≈paint.
 */
function containsPhrase_(text, phrase) {
  var hayTokens = tokenize_(text);
  var needleTokens = tokenize_(phrase);
  if (!hayTokens.length || !needleTokens.length) return false;

  var haystack = hayTokens.join(' ');
  var needle = needleTokens.join(' ');
  if ((' ' + haystack + ' ').indexOf(' ' + needle + ' ') !== -1) return true;

  return tokensMatchStemmed_(hayTokens, needleTokens);
}

function tokensMatchStemmed_(hayTokens, needleTokens) {
  if (needleTokens.length > hayTokens.length) return false;
  for (var i = 0; i <= hayTokens.length - needleTokens.length; i++) {
    var ok = true;
    for (var j = 0; j < needleTokens.length; j++) {
      if (!tokensEquivalent_(hayTokens[i + j], needleTokens[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function tokensEquivalent_(a, b) {
  if (a === b) return true;
  var sa = stemToken_(a);
  var sb = stemToken_(b);
  if (sa && sb && sa === sb) return true;
  // Prefixed stems only (repaint≈paint). Do NOT treat car≈carro.
  var longer = sa.length >= sb.length ? sa : sb;
  var shorter = sa.length >= sb.length ? sb : sa;
  if (shorter.length >= 4 && longer.length > shorter.length) {
    if (longer.substring(longer.length - shorter.length) === shorter) {
      var prefix = longer.substring(0, longer.length - shorter.length);
      if (prefix === 're' || prefix === 'un' || prefix === 'pre') return true;
    }
  }
  return false;
}

function stemToken_(token) {
  var t = String(token || '').toLowerCase();
  if (!t) return '';
  var mapped = STEM_TOKEN_MAP_[t];
  if (mapped) return mapped;

  if (t.length > 5 && t.substring(t.length - 3) === 'ing') {
    var baseIng = t.substring(0, t.length - 3);
    if (baseIng.length >= 3) return stemToken_(baseIng) || baseIng;
  }
  if (t.length > 4 && t.substring(t.length - 2) === 'ed') {
    var baseEd = t.substring(0, t.length - 2);
    if (baseEd.length >= 3) return stemToken_(baseEd) || baseEd;
  }
  if (t.length > 4 && t.substring(t.length - 3) === 'ies') {
    return t.substring(0, t.length - 3) + 'y';
  }
  if (t.length > 4 && t.substring(t.length - 2) === 'es') {
    return t.substring(0, t.length - 2);
  }
  if (
    t.length > 3 &&
    t.charAt(t.length - 1) === 's' &&
    t.charAt(t.length - 2) !== 's'
  ) {
    return t.substring(0, t.length - 1);
  }
  return t;
}

var STEM_TOKEN_MAP_ = {
  tints: 'tint',
  tinting: 'tint',
  bumpers: 'bumper',
  dents: 'dent',
  dented: 'dent',
  dings: 'ding',
  scratches: 'scratch',
  scrapes: 'scrape',
  doors: 'door',
  mirrors: 'mirror',
  rims: 'rim',
  wheels: 'wheel',
  tires: 'tire',
  estimates: 'estimate',
  quotes: 'quote',
  mechanics: 'mechanic',
  shops: 'shop',
  repairs: 'repair',
  painters: 'painter',
  painting: 'paint',
  paints: 'paint',
  repaint: 'paint',
  repainting: 'paint',
  welders: 'welder',
  welding: 'weld',
  cars: 'car',
  trucks: 'truck',
  vehicles: 'vehicle',
  jobs: 'job',
  careers: 'career',
  technicians: 'technician',
  dealerships: 'dealership',
  golpes: 'golpe',
  carros: 'carro',
  abolladuras: 'abolladura',
  // Keep "keyed" distinct from car-key intent (do not stem to "key")
  keyed: 'keyed',
  keying: 'keying',
  keys: 'key'
};

function stripKeywordSyntax_(text) {
  var value = String(text || '').trim();
  if (
    (value.charAt(0) === '[' && value.charAt(value.length - 1) === ']') ||
    (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"')
  ) {
    return value.substring(1, value.length - 1).trim();
  }
  return value;
}

function normalizeText_(value) {
  var text = String(value || '').toLowerCase();
  if (text.normalize) {
    text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }
  text = text.replace(/&/g, ' and ');
  text = text.replace(/[^a-z0-9]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function tokenize_(value) {
  var normalized = normalizeText_(value);
  return normalized ? normalized.split(' ') : [];
}

function normalizeCustomerId_(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCustomerIdDashes_(value) {
  var id = normalizeCustomerId_(value);
  if (id.length !== 10) return id;
  return id.substring(0, 3) + '-' + id.substring(3, 6) + '-' + id.substring(6);
}

function uniqueIdsFromList_(values) {
  var seen = {};
  var output = [];
  for (var i = 0; i < (values || []).length; i++) {
    var id = normalizeCustomerId_(values[i]);
    if (id && !seen[id]) {
      seen[id] = true;
      output.push(id);
    }
  }
  return output;
}

function toCustomerIdSet_(values) {
  var output = {};
  for (var i = 0; i < values.length; i++) {
    var id = normalizeCustomerId_(values[i]);
    if (id) output[id] = true;
  }
  return output;
}

function toSet_(values) {
  var output = {};
  for (var i = 0; i < values.length; i++) {
    output[String(values[i]).toUpperCase()] = true;
  }
  return output;
}

function unique_(values) {
  var seen = {};
  var output = [];
  for (var i = 0; i < values.length; i++) {
    var value = String(values[i] || '').trim();
    var key = normalizeText_(value);
    if (value && key && !seen[key]) {
      seen[key] = true;
      output.push(value);
    }
  }
  return output;
}

function number_(value) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : 0;
}

function round_(value, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(number_(value) * factor) / factor;
}

function parseDateTextAsUtc_(text) {
  var parts = text.split('-');
  return new Date(Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  ));
}

function addUtcDays_(date, days) {
  var copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatUtcDate_(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function cleanError_(error) {
  if (!error) return 'Unknown error';
  return String(error.message || error).replace(/\s+/g, ' ').trim();
}

function validateConfig_() {
  if (
    CONFIG.MAX_PARALLEL_ACCOUNTS < 1 ||
    CONFIG.MAX_PARALLEL_ACCOUNTS > 50
  ) {
    throw new Error('MAX_PARALLEL_ACCOUNTS must be between 1 and 50.');
  }
  if (CONFIG.ACTION_WINDOW_DAYS < 1) {
    throw new Error('ACTION_WINDOW_DAYS must be at least 1.');
  }
  if (CONFIG.HISTORICAL_GUARD_DAYS < CONFIG.ACTION_WINDOW_DAYS) {
    throw new Error(
      'HISTORICAL_GUARD_DAYS must be at least ACTION_WINDOW_DAYS.'
    );
  }
  if (CONFIG.MAX_NEGATIVE_KEYWORD_CHARACTERS !== 80) {
    throw new Error('MAX_NEGATIVE_KEYWORD_CHARACTERS must remain 80.');
  }
  if (CONFIG.MAX_NEGATIVE_KEYWORD_WORDS !== 10) {
    throw new Error('MAX_NEGATIVE_KEYWORD_WORDS must remain 10.');
  }
  if (CONFIG.RUNAWAY_SAFETY_CEILING_PER_ACCOUNT < 1) {
    throw new Error('RUNAWAY_SAFETY_CEILING_PER_ACCOUNT must be positive.');
  }
  if (CONFIG.MAX_LOG_ACTIONS_PER_ACCOUNT < 1) {
    throw new Error('MAX_LOG_ACTIONS_PER_ACCOUNT must be positive.');
  }
  if (
    CONFIG.MAX_EMAIL_ADD_ROWS_PER_ACCOUNT != null &&
    CONFIG.MAX_EMAIL_ADD_ROWS_PER_ACCOUNT < 1
  ) {
    throw new Error('MAX_EMAIL_ADD_ROWS_PER_ACCOUNT must be positive.');
  }

  if (!String(CONFIG.DONE_LABEL_PREFIX || '').trim()) {
    throw new Error('DONE_LABEL_PREFIX is required.');
  }
  if (!String(CONFIG.QUEUE_TIME_ZONE || '').trim()) {
    throw new Error('QUEUE_TIME_ZONE is required.');
  }
  if (!String(CONFIG.REQUIRED_CAMPAIGN_NAME_SUBSTRING || '').trim()) {
    throw new Error('REQUIRED_CAMPAIGN_NAME_SUBSTRING is required.');
  }
}

// Optional CommonJS exports for local helper tests. Ignored by Ads Scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG: CONFIG,
    NEGATIVE_RULES: NEGATIVE_RULES,
    SEED_COMPETITOR_PHRASES: SEED_COMPETITOR_PHRASES,
    SEED_INSURER_PROTECTED_PHRASES: SEED_INSURER_PROTECTED_PHRASES,
    normalizeText_: normalizeText_,
    containsPhrase_: containsPhrase_,
    evaluateRules_: evaluateRules_,
    inspectExactNegative_: inspectExactNegative_,
    prepareExactNegative_: prepareExactNegative_,
    mergeAccountOverride_: mergeAccountOverride_,
    normalizeCustomerId_: normalizeCustomerId_,
    buildDateWindowFromTodayText_: buildDateWindowFromTodayText_,
    evaluateLowIntentAutoGeo_: evaluateLowIntentAutoGeo_,
    sumDecisionCounts_: sumDecisionCounts_,
    recordTermDecision_: recordTermDecision_,
    ensureDecisionReconciliation_: ensureDecisionReconciliation_,
    buildDecisionAuditCsv_: buildDecisionAuditCsv_
  };
}
