/**
 * BUILT BY SHAH — MCC PMax Negatives Sweeper
 * Version: 1.1.0
 *
 * Sister automation to the Search negatives sweeper. This script reviews PMax
 * search terms, uses the same Hub override columns and the same spoke Negatives
 * Audit tab with Channel = PMAX, and adds the full query as an exact campaign
 * negative only when it passes all safeguards.
 *
 * Install this in a separate Google Ads Scripts row and schedule it separately
 * from the Search sweeper. This script fails closed when the current Google Ads
 * Scripts runtime does not expose PMax campaign-level negative keyword APIs.
 *
 * INSTALL
 * 1. Paste this file into its own Google Ads manager-account Scripts row.
 * 2. Set CONFIG.HUB_SPREADSHEET_URL to the live Hub.
 * 3. A shop runs only when Hub Config has Enabled = Enabled,
 *    Negatives Sweeper Enabled = Enabled, and a Spoke Spreadsheet URL.
 * 4. Preview makes no Ads or Sheets changes. Run mutates qualifying accounts.
 * 5. Schedule daily at 7:00 AM Pacific or later. The script re-reads the last
 *    seven completed days so late-published Search terms are retried safely.
 *    Google caps executeInParallel at 50 accounts. With about 70 shops,
 *    schedule two identical Scripts rows with the same Hub URL.
 *
 * Guide:
 * docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md
 */

var CONFIG = {
  HUB_SPREADSHEET_URL: '', // required
  HUB_CONFIG_SHEET: 'Config',
  SPOKE_NEGATIVES_SHEET: 'Negatives Audit',
  CHANNEL: 'PMAX',
  NEGATIVES_LSR_COLUMN: 'Negatives PMax Last Successful Run',
  ACTION_WINDOW_DAYS: 7,
  HISTORICAL_GUARD_DAYS: 30,
  MIN_ACTION_IMPRESSIONS: 1,
  MAX_ACTION_CONVERSIONS: 0,
  MAX_HISTORICAL_CONVERSIONS: 0,
  MAX_NEGATIVE_KEYWORD_CHARACTERS: 80,
  MAX_NEGATIVE_KEYWORD_WORDS: 10,
  MAX_PARALLEL_ACCOUNTS: 50,
  // Process ALL eligible terms; high runaway ceiling only.
  RUNAWAY_SAFETY_CEILING_PER_ACCOUNT: 500,
  MAX_LOG_ROWS_PER_ACCOUNT: 500,
  INCLUDE_PAUSED_CAMPAIGNS: false,
  INCLUDE_ACCOUNT_IDS: [], // optional force list still capped at 50
  EXCLUDE_ACCOUNT_IDS: []
};

var HUB_NEGATIVES_COLUMNS = [
  'Negatives Sweeper Enabled',
  'Negatives PMax Last Successful Run',
  'Negatives Disabled Rule IDs',
  'Negatives Protected Phrases',
  'Negatives Competitor Phrases'
];

var SPOKE_HEADERS = [
  'Date Added',
  'Channel',
  'Campaign ID',
  'Campaign',
  'Search Term',
  'Exact Negative',
  'Matched Rules',
  'Impressions',
  'Clicks',
  'Cost Yesterday',
  'Cost Lookback',
  'Conversions',
  'Spend Summary',
  'Decision',
  'Reason',
  'Reviewed',
  'Remove',
  'Status',
  'Removed At',
  'AM Notes'
];

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
  var hub = SpreadsheetApp.openByUrl(CONFIG.HUB_SPREADSHEET_URL);
  var sheet = hub.getSheetByName(CONFIG.HUB_CONFIG_SHEET);
  if (!sheet) {
    throw new Error(
      'Hub sheet "' + CONFIG.HUB_CONFIG_SHEET + '" was not found.'
    );
  }

  // Preview is read-only, including schema changes.
  if (!preview) ensureHubNegativesColumns_(sheet);

  var dueRows = selectHubAccounts_(hub, sheet);
  if (!dueRows.length) {
    Logger.log('No eligible PMax negatives accounts are due.');
    return;
  }

  var ids = [];
  var accountRows = {};
  for (var i = 0; i < dueRows.length; i++) {
    ids.push(dueRows[i].customerId);
    accountRows[dueRows[i].customerId] = dueRows[i];
  }

  var runId = buildRunId_();
  var input = JSON.stringify({
    runId: runId,
    preview: preview,
    accountRows: accountRows
  });

  Logger.log(
    'Starting PMax negatives sweep ' + runId + ' for ' +
    ids.length + ' account(s)' + (preview ? ' in Preview.' : '.')
  );

  AdsManagerApp.accounts()
    .withIds(ids)
    .executeInParallel('processAccount', 'allFinished', input);
}

function processAccount(inputJson) {
  var input = JSON.parse(inputJson || '{}');
  var account = AdsApp.currentAccount();
  var customerId = normalizeCustomerId_(account.getCustomerId());
  var hubRow = (input.accountRows || {})[customerId];
  var preview = !!input.preview || AdsApp.getExecutionInfo().isPreview();
  var output = {
    runId: input.runId || buildRunId_(),
    success: false,
    preview: preview,
    hitSafetyCeiling: false,
    configRowNumber: hubRow ? hubRow.configRowNumber : 0,
    customerId: customerId,
    accountName: account.getName() || customerId,
    added: 0,
    removed: 0,
    manualReview: 0,
    failed: 0,
    termsReviewed: 0,
    message: ''
  };

  if (!hubRow) {
    output.message = 'No Hub payload was supplied for this account.';
    return JSON.stringify(output);
  }

  // Preview intentionally performs no Ads or Sheets writes.
  if (preview) {
    output.success = true;
    output.message = 'Preview: all Ads and Sheets mutations were skipped.';
    return JSON.stringify(output);
  }

  var actionRows = [];
  var hadFailure = false;

  try {
    var spreadsheet = SpreadsheetApp.openByUrl(hubRow.spokeUrl);
    var auditSheet = getOrCreateNegativesAuditSheet_(spreadsheet);
    var campaignCache = {};
    var removedThisRun = {};
    var removeResult = processRemoveRequests_(
      auditSheet,
      campaignCache,
      removedThisRun,
      actionRows
    );
    output.removed = removeResult.removed;
    output.failed += removeResult.failed;
    hadFailure = removeResult.failed > 0;

    var timeZone = account.getTimeZone();
    var currency = account.getCurrencyCode();
    var dateWindow = buildDateWindow_(
      timeZone,
      CONFIG.ACTION_WINDOW_DAYS,
      CONFIG.HISTORICAL_GUARD_DAYS
    );
    var rows = querySearchTerms_(dateWindow);
    var terms = aggregateSearchTerms_(
      rows,
      dateWindow.actionStart,
      dateWindow.actionEnd
    );
    var candidates = [];
    var i;

    for (i = 0; i < terms.length; i++) {
      if (terms[i].actionImpressions >= CONFIG.MIN_ACTION_IMPRESSIONS) {
        candidates.push(terms[i]);
      }
    }

    candidates.sort(function (a, b) {
      if (b.actionCost !== a.actionCost) return b.actionCost - a.actionCost;
      if (b.actionClicks !== a.actionClicks) {
        return b.actionClicks - a.actionClicks;
      }
      return b.actionImpressions - a.actionImpressions;
    });
    output.termsReviewed = candidates.length;

    var accountOverride = {
      disabledRuleIds: hubRow.disabledRuleIds || [],
      protectedPhrases: unique_(
        SEED_INSURER_PROTECTED_PHRASES
          .concat(hubRow.protectedPhrases || [])
          .concat([hubRow.clientName || '', hubRow.accountName || ''])
      ),
      competitorPhrases: unique_(
        SEED_COMPETITOR_PHRASES.concat(hubRow.competitorPhrases || [])
      )
    };
    var campaignNegativeCache = {};
    var sharedListCache = {};
    var eligibleProcessed = 0;

    for (i = 0; i < candidates.length; i++) {
      var term = candidates[i];
      var ruleResult = evaluateRules_(term.searchTerm, accountOverride);
      if (!ruleResult.anyRuleMatched || !ruleResult.shouldExclude) continue;
      if (hasBlockedSearchTermStatus_(term.statuses)) continue;
      if (term.actionConversions > CONFIG.MAX_ACTION_CONVERSIONS) continue;
      if (
        term.historyConversions > CONFIG.MAX_HISTORICAL_CONVERSIONS
      ) continue;

      var prepared = prepareExactNegative_(term.searchTerm);
      var removalKey = term.campaignId + '|' + normalizeText_(prepared.text);
      if (removedThisRun[removalKey]) continue;

      if (
        eligibleProcessed >= CONFIG.RUNAWAY_SAFETY_CEILING_PER_ACCOUNT
      ) {
        output.hitSafetyCeiling = true;
        pushSafetyCeilingRow_(actionRows, timeZone);
        break;
      }
      eligibleProcessed += 1;

      if (!prepared.ok) {
        if (prepared.manualReview) {
          output.manualReview += 1;
          pushActionRow_(
            actionRows,
            term,
            prepared.formatted,
            ruleResult.eligibleRules,
            'MANUAL_REVIEW',
            prepared.reason,
            'MANUAL_REVIEW',
            timeZone,
            currency
          );
        }
        continue;
      }

      try {
        var campaign = getCampaignById_(term.campaignId, campaignCache);
        if (!campaign) {
          throw new Error('The PMax campaign could not be resolved by ID.');
        }
        assertPMaxNegativeMethods_(campaign, true);
        var blockingNegative = findBlockingNegative_(
          campaign,
          term.searchTerm,
          campaignNegativeCache,
          sharedListCache
        );
        if (blockingNegative) continue;

        campaign.createNegativeKeyword(prepared.formatted);
        if (!verifyCampaignExactNegative_(campaign, prepared.text)) {
          throw new Error(
            'Create completed, but the exact campaign negative was not verified.'
          );
        }
        addExactNegativeToCache_(
          term.campaignId,
          prepared.text,
          campaignNegativeCache
        );
        output.added += 1;
        pushActionRow_(
          actionRows,
          term,
          prepared.formatted,
          ruleResult.eligibleRules,
          'ADDED',
          'Added and verified the full query as an exact campaign negative.',
          'ADDED',
          timeZone,
          currency
        );
      } catch (changeError) {
        output.failed += 1;
        hadFailure = true;
        pushActionRow_(
          actionRows,
          term,
          prepared.formatted,
          ruleResult.eligibleRules,
          'FAILED',
          cleanError_(changeError),
          'FAILED',
          timeZone,
          currency
        );
      }
    }

    if (actionRows.length > CONFIG.MAX_LOG_ROWS_PER_ACCOUNT) {
      actionRows = actionRows.slice(0, CONFIG.MAX_LOG_ROWS_PER_ACCOUNT);
    }
    prependAuditRows_(auditSheet, actionRows);

    output.success = !hadFailure;
    output.message =
      'Reviewed ' + output.termsReviewed + '; added ' + output.added +
      '; removed ' + output.removed + '; manual review ' +
      output.manualReview + '; failed ' + output.failed + '.';
  } catch (error) {
    output.failed += 1;
    output.success = false;
    output.message = cleanError_(error);
  }

  return JSON.stringify(output);
}

function allFinished(results) {
  var successful = [];
  var summaries = [];

  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var value = result.getReturnValue();
    if (result.getStatus() !== 'OK' || !value) {
      summaries.push(
        normalizeCustomerId_(result.getCustomerId()) + ': ' +
        result.getStatus() + ' ' + (result.getError() || '')
      );
      continue;
    }

    try {
      var output = JSON.parse(value);
      summaries.push(output.customerId + ': ' + output.message);
      if (
        output.success &&
        !output.hitSafetyCeiling &&
        !output.preview &&
        output.configRowNumber
      ) {
        successful.push(output);
      }
    } catch (error) {
      summaries.push(
        normalizeCustomerId_(result.getCustomerId()) +
        ': result parse failed: ' + cleanError_(error)
      );
    }
  }

  if (successful.length) stampSuccessfulHubRows_(successful);
  for (var s = 0; s < summaries.length; s++) Logger.log(summaries[s]);
}

function ensureHubNegativesColumns_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var headerMap = buildHeaderMap_(headers);
  var missing = [];

  for (var i = 0; i < HUB_NEGATIVES_COLUMNS.length; i++) {
    if (headerMap[HUB_NEGATIVES_COLUMNS[i]] === undefined) {
      missing.push(HUB_NEGATIVES_COLUMNS[i]);
    }
  }
  if (!missing.length) return;

  sheet.insertColumnsAfter(lastColumn, missing.length);
  sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
  sheet.getRange(1, lastColumn + 1, 1, missing.length)
    .setFontWeight('bold');
}

function selectHubAccounts_(hub, sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  var headers = [];
  for (var h = 0; h < values[0].length; h++) {
    headers.push(String(values[0][h] || '').trim());
  }
  var map = buildHeaderMap_(headers);
  requireHeaders_(map, [
    'Account ID',
    'Account Name',
    'Client Name',
    'Enabled',
    'Spoke Spreadsheet URL',
    'Priority',
    'Negatives Sweeper Enabled',
    CONFIG.NEGATIVES_LSR_COLUMN,
    'Negatives Disabled Rule IDs',
    'Negatives Protected Phrases',
    'Negatives Competitor Phrases'
  ]);

  var includeSet = toCustomerIdSet_(CONFIG.INCLUDE_ACCOUNT_IDS);
  var excludeSet = toCustomerIdSet_(CONFIG.EXCLUDE_ACCOUNT_IDS);
  var hasForceList = objectSize_(includeSet) > 0;
  var timeZone = getHubTimeZone_(hub);
  var today = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var customerId = normalizeCustomerId_(row[map['Account ID']]);
    if (!customerId) continue;
    if (hasForceList && !includeSet[customerId]) continue;
    if (excludeSet[customerId]) continue;
    if (!isEnabled_(row[map.Enabled])) continue;
    if (!isEnabled_(row[map['Negatives Sweeper Enabled']])) continue;

    var spokeUrl = String(
      row[map['Spoke Spreadsheet URL']] || ''
    ).trim();
    if (!spokeUrl) continue;

    var lastRun = calendarDateText_(
      row[map[CONFIG.NEGATIVES_LSR_COLUMN]],
      timeZone
    );
    // An include list is an operator force list and therefore bypasses due date.
    if (!hasForceList && lastRun === today) continue;

    rows.push({
      customerId: customerId,
      accountName: String(row[map['Account Name']] || ''),
      clientName: String(row[map['Client Name']] || ''),
      spokeUrl: spokeUrl,
      disabledRuleIds: splitList_(row[map['Negatives Disabled Rule IDs']]),
      protectedPhrases: splitList_(
        row[map['Negatives Protected Phrases']]
      ),
      competitorPhrases: splitList_(
        row[map['Negatives Competitor Phrases']]
      ),
      configRowNumber: i + 1,
      priority: number_(row[map.Priority])
    });
  }

  rows.sort(function (a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.customerId < b.customerId ? -1 :
      (a.customerId > b.customerId ? 1 : 0);
  });
  return rows.slice(0, CONFIG.MAX_PARALLEL_ACCOUNTS);
}

function stampSuccessfulHubRows_(outputs) {
  var hub = SpreadsheetApp.openByUrl(CONFIG.HUB_SPREADSHEET_URL);
  var sheet = hub.getSheetByName(CONFIG.HUB_CONFIG_SHEET);
  if (!sheet) throw new Error('Hub Config sheet was not found during stamping.');

  ensureHubNegativesColumns_(sheet);
  var headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  var map = buildHeaderMap_(headers);
  requireHeaders_(map, ['Account ID', CONFIG.NEGATIVES_LSR_COLUMN]);
  var timeZone = getHubTimeZone_(hub);
  var dateText = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

  for (var i = 0; i < outputs.length; i++) {
    var rowNumber = number_(outputs[i].configRowNumber);
    if (rowNumber < 2 || rowNumber > sheet.getLastRow()) continue;
    var currentId = normalizeCustomerId_(
      sheet.getRange(rowNumber, map['Account ID'] + 1).getDisplayValue()
    );
    if (currentId !== outputs[i].customerId) {
      Logger.log(
        'Skipped Hub stamp for ' + outputs[i].customerId +
        ' because its Config row moved during the run.'
      );
      continue;
    }
    sheet.getRange(
      rowNumber,
      map[CONFIG.NEGATIVES_LSR_COLUMN] + 1
    ).setValue(dateText);
  }
}

function getOrCreateNegativesAuditSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CONFIG.SPOKE_NEGATIVES_SHEET);
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet(CONFIG.SPOKE_NEGATIVES_SHEET);

  ensureSheetCapacity_(sheet, 1001, SPOKE_HEADERS.length);
  var current = sheet
    .getRange(1, 1, 1, SPOKE_HEADERS.length)
    .getDisplayValues()[0];
  var mismatch = false;
  for (var i = 0; i < SPOKE_HEADERS.length; i++) {
    if (current[i] !== SPOKE_HEADERS[i]) {
      mismatch = true;
      break;
    }
  }
  if (mismatch) {
    var hasExistingData = sheet.getLastRow() > 1;
    var hasAnyHeader = false;
    for (i = 0; i < current.length; i++) {
      if (current[i]) hasAnyHeader = true;
    }
    if (hasExistingData || hasAnyHeader) {
      throw new Error(
        'Negatives Audit headers do not match the required schema.'
      );
    }
    sheet.getRange(1, 1, 1, SPOKE_HEADERS.length).setValues([SPOKE_HEADERS]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SPOKE_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1f4e78')
    .setFontColor('#ffffff');
  // Never reinsert checkboxes across an existing audit tab: doing so can clear
  // manager-owned Reviewed/Remove values. New rows receive validation when
  // prepended; a newly created tab gets a large ready-to-use checkbox area.
  if (created) {
    sheet.getRange(2, 16, sheet.getMaxRows() - 1, 2).insertCheckboxes();
  }
  sheet.getRange(2, 10, sheet.getMaxRows() - 1, 2)
    .setNumberFormat('$0.00');
  return sheet;
}

function processRemoveRequests_(
  sheet,
  campaignCache,
  removedThisRun,
  actionRows
) {
  var result = { removed: 0, failed: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;

  var values = sheet
    .getRange(1, 1, lastRow, SPOKE_HEADERS.length)
    .getValues();
  var headers = [];
  for (var h = 0; h < values[0].length; h++) {
    headers.push(String(values[0][h] || '').trim());
  }
  var map = buildHeaderMap_(headers);
  requireHeaders_(map, SPOKE_HEADERS);
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var currency = AdsApp.currentAccount().getCurrencyCode();
  var removedAt = Utilities.formatDate(
    new Date(),
    timeZone,
    'yyyy-MM-dd HH:mm:ss'
  );

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var channel = String(row[map.Channel] || '').trim().toUpperCase();
    var status = String(row[map.Status] || '').trim().toUpperCase();
    if (!isChecked_(row[map.Remove])) continue;
    if (status !== 'ADDED') continue;
    if (channel !== CONFIG.CHANNEL) continue;

    var campaignId = String(row[map['Campaign ID']] || '').replace(/\.0$/, '');
    var exactText = stripKeywordSyntax_(row[map['Exact Negative']]);
    var reason = '';

    try {
      var campaign = getCampaignById_(campaignId, campaignCache);
      if (!campaign) throw new Error('Campaign could not be resolved by ID.');
      if (!exactText) throw new Error('Exact Negative is blank.');
      assertPMaxNegativeMethods_(campaign, false);
      var removed = removeExactCampaignNegative_(campaign, exactText);
      if (!removed) {
        throw new Error(
          'The exact campaign negative was not found; nothing was removed.'
        );
      }
      if (verifyCampaignExactNegative_(campaign, exactText)) {
        throw new Error('The negative still exists after remove().');
      }

      // Preserve Reviewed, Remove, and AM Notes. Only update workflow fields.
      sheet.getRange(i + 1, map.Status + 1).setValue('REMOVED');
      sheet.getRange(i + 1, map['Removed At'] + 1).setValue(removedAt);
      removedThisRun[
        campaignId + '|' + normalizeText_(exactText)
      ] = true;
      result.removed += 1;
    } catch (error) {
      reason = 'Remove request failed: ' + cleanError_(error);
      result.failed += 1;
      if (actionRows.length < CONFIG.MAX_LOG_ROWS_PER_ACCOUNT) {
        actionRows.push([
          removedAt,
          CONFIG.CHANNEL,
          campaignId,
          String(row[map.Campaign] || ''),
          String(row[map['Search Term']] || ''),
          String(row[map['Exact Negative']] || ''),
          String(row[map['Matched Rules']] || ''),
          0,
          0,
          0,
          0,
          0,
          formatMoney_(0, currency) + ' lookback / ' +
            formatMoney_(0, currency) + ' yesterday / 0 conv',
          'FAILED',
          reason,
          false,
          false,
          'FAILED',
          '',
          ''
        ]);
      }
    }
  }
  return result;
}

function removeExactCampaignNegative_(campaign, expectedText) {
  assertPMaxNegativeMethods_(campaign, false);
  var expected = normalizeText_(expectedText);
  var iterator = campaign.negativeKeywords().get();
  while (iterator.hasNext()) {
    var negative = iterator.next();
    if (
      String(negative.getMatchType()).toUpperCase() === 'EXACT' &&
      normalizeText_(stripKeywordSyntax_(negative.getText())) === expected
    ) {
      negative.remove();
      return true;
    }
  }
  return false;
}

function prependAuditRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.insertRowsAfter(1, rows.length);
  sheet.getRange(2, 1, rows.length, SPOKE_HEADERS.length).setValues(rows);
  sheet.getRange(2, 16, rows.length, 2).insertCheckboxes();
  sheet.getRange(2, 10, rows.length, 2).setNumberFormat('$0.00');
  sheet.getRange(2, 1, rows.length, SPOKE_HEADERS.length)
    .setVerticalAlignment('top');
  sheet.getRange(2, 5, rows.length, 2).setWrap(true);
  sheet.getRange(2, 13, rows.length, 3).setWrap(true);
}

function pushActionRow_(
  rows,
  term,
  exactNegative,
  matchedRules,
  decision,
  reason,
  status,
  timeZone,
  currency
) {
  if (rows.length >= CONFIG.MAX_LOG_ROWS_PER_ACCOUNT) return;
  var now = Utilities.formatDate(
    new Date(),
    timeZone,
    'yyyy-MM-dd HH:mm:ss'
  );
  rows.push([
    now,
    CONFIG.CHANNEL,
    term.campaignId,
    term.campaignName,
    term.searchTerm,
    exactNegative,
    matchedRules.join(', '),
    round_(term.yesterdayImpressions, 0),
    round_(term.yesterdayClicks, 0),
    round_(term.yesterdayCost, 2),
    round_(term.historyCost, 2),
    round_(term.historyConversions, 2),
    formatMoney_(term.historyCost, currency) + ' lookback / ' +
      formatMoney_(term.yesterdayCost, currency) + ' yesterday / ' +
      round_(term.historyConversions, 2) + ' conv',
    decision,
    reason,
    false,
    false,
    status,
    '',
    ''
  ]);
}

function pushSafetyCeilingRow_(rows, timeZone) {
  var row = [
    Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd HH:mm:ss'),
    CONFIG.CHANNEL,
    '',
    '',
    '',
    '',
    '',
    0,
    0,
    0,
    0,
    0,
    '',
    'HIT_SAFETY_CEILING',
    'Stopped after ' + CONFIG.RUNAWAY_SAFETY_CEILING_PER_ACCOUNT +
      ' eligible terms. The account was not stamped complete.',
    false,
    false,
    'HIT_SAFETY_CEILING',
    '',
    ''
  ];
  if (rows.length < CONFIG.MAX_LOG_ROWS_PER_ACCOUNT) {
    rows.push(row);
  } else if (rows.length) {
    rows[rows.length - 1] = row;
  }
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

function querySearchTerms_(dateWindow) {
  var campaignStatus = CONFIG.INCLUDE_PAUSED_CAMPAIGNS ?
    "campaign.status != 'REMOVED'" : "campaign.status = 'ENABLED'";
  // PMax search terms live on campaign_search_term_view, not search_term_view.
  var query =
    'SELECT segments.date, campaign.id, campaign.name, ' +
    'campaign_search_term_view.search_term, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions FROM campaign_search_term_view ' +
    "WHERE segments.date BETWEEN '" + dateWindow.historyStart +
    "' AND '" + dateWindow.actionEnd + "' " +
    "AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' " +
    'AND ' + campaignStatus + ' ' +
    'AND metrics.impressions > 0';

  var rows = [];
  try {
    var iterator = AdsApp.search(query);
    while (iterator.hasNext()) rows.push(iterator.next());
  } catch (searchError) {
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
  }
  return rows;
}

function aggregateSearchTerms_(rows, actionStart, actionEnd) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var campaignId = String(row.campaign.id);
    var searchTerm = extractSearchTermFromRow_(row);
    var normalizedTerm = normalizeText_(searchTerm);
    if (!normalizedTerm) continue;
    var key = campaignId + '|' + normalizedTerm;

    if (!map[key]) {
      map[key] = {
        campaignId: campaignId,
        campaignName: String(row.campaign.name || ''),
        searchTerm: searchTerm,
        statuses: {},
        actionImpressions: 0,
        actionClicks: 0,
        actionCost: 0,
        actionConversions: 0,
        yesterdayImpressions: 0,
        yesterdayClicks: 0,
        yesterdayCost: 0,
        yesterdayConversions: 0,
        historyImpressions: 0,
        historyClicks: 0,
        historyCost: 0,
        historyConversions: 0
      };
    }

    var item = map[key];
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

    var rowDate = String(row.segments.date || '');
    if (rowDate >= actionStart) {
      item.actionImpressions += impressions;
      item.actionClicks += clicks;
      item.actionCost += cost;
      item.actionConversions += conversions;
    }
    if (rowDate === actionEnd) {
      item.yesterdayImpressions += impressions;
      item.yesterdayClicks += clicks;
      item.yesterdayCost += cost;
      item.yesterdayConversions += conversions;
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


function getCampaignById_(campaignId, cache) {
  var key = String(campaignId || '');
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  if (!key) {
    cache[key] = null;
    return null;
  }
  if (typeof AdsApp.performanceMaxCampaigns !== 'function') {
    throw pMaxNegativesUnavailableError_(
      'AdsApp.performanceMaxCampaigns() is missing'
    );
  }
  var selector;
  try {
    selector = AdsApp.performanceMaxCampaigns();
  } catch (error) {
    throw pMaxNegativesUnavailableError_(
      'AdsApp.performanceMaxCampaigns() failed: ' + cleanError_(error)
    );
  }
  if (!selector || typeof selector.withIds !== 'function') {
    throw pMaxNegativesUnavailableError_(
      'the PMax campaign selector does not support withIds()'
    );
  }
  var iterator = selector.withIds([key]).get();
  cache[key] = iterator.hasNext() ? iterator.next() : null;
  return cache[key];
}

function findBlockingNegative_(
  campaign,
  searchTerm,
  campaignNegativeCache,
  sharedListCache
) {
  var campaignId = String(campaign.getId());
  if (!campaignNegativeCache[campaignId]) {
    campaignNegativeCache[campaignId] = loadEffectiveNegatives_(
      campaign,
      sharedListCache
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

function loadEffectiveNegatives_(campaign, sharedListCache) {
  assertPMaxNegativeMethods_(campaign, false);
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

  // Shared-list inspection is retained when the PMax campaign object exposes
  // it, but campaign-level negativeKeywords() is the required fail-closed API.
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

function addExactNegativeToCache_(campaignId, keywordText, cache) {
  if (!cache[campaignId]) cache[campaignId] = [];
  cache[campaignId].push({
    text: keywordText,
    formatted: '[' + keywordText + ']',
    matchType: 'EXACT',
    source: 'campaign'
  });
}

function verifyCampaignExactNegative_(campaign, expectedText) {
  assertPMaxNegativeMethods_(campaign, false);
  var expected = normalizeText_(expectedText);
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
  var missing = [];
  if (!campaign || typeof campaign.negativeKeywords !== 'function') {
    missing.push('negativeKeywords()');
  }
  if (requireCreate && (
    !campaign || typeof campaign.createNegativeKeyword !== 'function'
  )) {
    missing.push('createNegativeKeyword()');
  }
  if (missing.length) {
    throw pMaxNegativesUnavailableError_(
      'the PMax campaign object is missing ' + missing.join(' and ')
    );
  }
}

function pMaxNegativesUnavailableError_(detail) {
  return new Error(
    'PMax campaign-level exact negatives are unavailable in this Scripts ' +
    'runtime (' + detail + '). No Ads change was assumed successful.'
  );
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
      characterCount: 0,
      wordCount: 0,
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
      characterCount: info.characterCount,
      wordCount: info.wordCount,
      reason: 'Skipped because the proposed exact negative has ' +
        issues.join(' and ') + '.'
    };
  }
  return {
    ok: true,
    manualReview: false,
    text: info.text,
    formatted: info.formatted,
    characterCount: info.characterCount,
    wordCount: info.wordCount,
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

function buildDateWindow_(timeZone, actionDays, historyDays) {
  var todayText = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  var today = parseDateTextAsUtc_(todayText);
  var actionEnd = addUtcDays_(today, -1);
  var actionStart = addUtcDays_(actionEnd, -(actionDays - 1));
  var historyStart = addUtcDays_(actionEnd, -(historyDays - 1));
  return {
    actionStart: formatUtcDate_(actionStart),
    actionEnd: formatUtcDate_(actionEnd),
    historyStart: formatUtcDate_(historyStart)
  };
}

function buildRunId_() {
  var timeZone = AdsApp.currentAccount().getTimeZone();
  return 'PMAX_NEG_' +
    Utilities.formatDate(new Date(), timeZone, 'yyyyMMdd_HHmmss') +
    '_' + Utilities.getUuid().substring(0, 8);
}

function getHubTimeZone_(hub) {
  try {
    return hub.getSpreadsheetTimeZone() ||
      AdsApp.currentAccount().getTimeZone() ||
      'America/New_York';
  } catch (error) {
    return 'America/New_York';
  }
}

function calendarDateText_(value, timeZone) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
  }
  return text;
}

function buildHeaderMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return map;
}

function requireHeaders_(map, required) {
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (map[required[i]] === undefined) missing.push(required[i]);
  }
  if (missing.length) {
    throw new Error('Missing required header(s): ' + missing.join(', '));
  }
}

function ensureSheetCapacity_(sheet, requiredRows, requiredColumns) {
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      requiredRows - sheet.getMaxRows()
    );
  }
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumns - sheet.getMaxColumns()
    );
  }
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

function splitList_(value) {
  var text = String(value || '');
  if (!text.trim()) return [];
  var parts = text.split(/[,;\n]+/);
  var output = [];
  for (var i = 0; i < parts.length; i++) {
    var item = parts[i].trim();
    if (item) output.push(item);
  }
  return unique_(output);
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

function isEnabled_(value) {
  return String(value || '').trim().toUpperCase() === 'ENABLED';
}

function isChecked_(value) {
  return value === true || String(value || '').trim().toUpperCase() === 'TRUE';
}

function objectSize_(value) {
  return Object.keys(value || {}).length;
}

function number_(value) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : 0;
}

function round_(value, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(number_(value) * factor) / factor;
}

function formatMoney_(value, currency) {
  var symbol = String(currency || '').toUpperCase() === 'USD' ? '$' :
    String(currency || '') + ' ';
  return symbol + round_(value, 2).toFixed(2);
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
  if (!String(CONFIG.HUB_SPREADSHEET_URL || '').trim()) {
    throw new Error('CONFIG.HUB_SPREADSHEET_URL is required.');
  }
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
}

// Optional CommonJS exports for local helper tests. Ignored by Ads Scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG: CONFIG,
    NEGATIVE_RULES: NEGATIVE_RULES,
    SEED_COMPETITOR_PHRASES: SEED_COMPETITOR_PHRASES,
    SEED_INSURER_PROTECTED_PHRASES: SEED_INSURER_PROTECTED_PHRASES,
    SPOKE_HEADERS: SPOKE_HEADERS,
    normalizeText_: normalizeText_,
    containsPhrase_: containsPhrase_,
    evaluateRules_: evaluateRules_,
    inspectExactNegative_: inspectExactNegative_,
    prepareExactNegative_: prepareExactNegative_,
    negativeBlocksSearchTerm_: negativeBlocksSearchTerm_,
    normalizeCustomerId_: normalizeCustomerId_,
    stripKeywordSyntax_: stripKeywordSyntax_,
    splitList_: splitList_,
    calendarDateText_: calendarDateText_,
    aggregateSearchTerms_: aggregateSearchTerms_
  };
}
