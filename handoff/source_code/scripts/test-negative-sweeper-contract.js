#!/usr/bin/env node
'use strict';

var assert = require('assert');
global.Logger = { log: function () {} };

var files = [
  'built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js',
  'built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js',
  'built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js',
  'built-by-shah-mcc-search-negatives-sweeper.js',
  'built-by-shah-mcc-pmax-negatives-sweeper.js'
];
var modules = files.map(function (file) {
  return require('./' + file);
});
var canonical = modules[0];

function stable(value) {
  return JSON.stringify(value);
}

function accountOverride(mod, accountName) {
  return {
    disabledRuleIds: [],
    protectedPhrases:
      mod.SEED_INSURER_PROTECTED_PHRASES.concat([accountName || '']),
    competitorPhrases: mod.SEED_COMPETITOR_PHRASES.slice()
  };
}

function evaluate(mod, term, accountName) {
  return mod.evaluateRules_(
    term,
    accountOverride(mod, accountName || 'Unrelated Body Shop')
  );
}

for (var i = 1; i < modules.length; i++) {
  assert.strictEqual(
    stable(modules[i].NEGATIVE_RULES),
    stable(canonical.NEGATIVE_RULES),
    files[i] + ' NEGATIVE_RULES drifted from the daily canonical source'
  );
  assert.strictEqual(
    stable(modules[i].SEED_COMPETITOR_PHRASES),
    stable(canonical.SEED_COMPETITOR_PHRASES),
    files[i] + ' competitor seeds drifted from the daily canonical source'
  );
  assert.strictEqual(
    stable(modules[i].SEED_INSURER_PROTECTED_PHRASES),
    stable(canonical.SEED_INSURER_PROTECTED_PHRASES),
    files[i] + ' insurer protections drifted from the daily canonical source'
  );
}

var suppliedTerms = [
  'aaa auto repair',
  'ames collision center',
  'auto arena body shop',
  'auto salvage yards with online inventory',
  'automobile body repairing & painting scarsdale ny',
  'body works car near me',
  'car buffing near me',
  'car clear coat repair',
  'car coloring price',
  'car in dallas',
  'car painting dallas',
  'car rear bumper loose',
  'clickmechanic',
  'collision consultants',
  'custom body shop near me',
  'dashboard repair',
  'dent mavericks dallas',
  'east coast auto salvage',
  'engine repair dallas',
  'fast car automotive',
  'fix cars near me',
  'fix paint on car cost',
  'fix small dent in car'
];

for (i = 0; i < suppliedTerms.length; i++) {
  var suppliedTerm = suppliedTerms[i];
  var canonicalResult = evaluate(canonical, suppliedTerm);
  assert.strictEqual(
    canonicalResult.shouldExclude,
    true,
    'Expected supplied junk term to classify: ' + suppliedTerm
  );
  for (var m = 1; m < modules.length; m++) {
    assert.strictEqual(
      stable(evaluate(modules[m], suppliedTerm)),
      stable(canonicalResult),
      files[m] + ' evaluated differently for: ' + suppliedTerm
    );
  }
}

assert.strictEqual(
  evaluate(canonical, 'auto arena body shop', 'Auto Arena Body Shop')
    .shouldExclude,
  false,
  'The shop’s own account name must remain protected'
);
assert.strictEqual(
  evaluate(canonical, 'auto arena body shop', 'Another Body Shop')
    .shouldExclude,
  true,
  'The same phrase must classify as a competitor in another account'
);
assert.strictEqual(
  evaluate(canonical, 'aaa auto repair').shouldExclude,
  true,
  'AAA must not suppress mechanical auto-repair junk'
);
assert.strictEqual(
  evaluate(canonical, 'aaa insurance auto repair').shouldExclude,
  false,
  'Genuine AAA insurance intent must remain protected'
);
assert.strictEqual(
  evaluate(canonical, 'aaa collision auto repair').shouldExclude,
  false,
  'Genuine AAA collision intent must remain protected'
);
assert.strictEqual(
  evaluate(canonical, 'aaa collision center').accountProtection,
  'aaa collision',
  'AAA collision intent must expose its explicit protection reason'
);
assert.strictEqual(
  evaluate(canonical, 'dallas auto body shop').shouldExclude,
  false,
  'City-only body-shop intent must not become a named competitor'
);
assert.strictEqual(
  evaluate(canonical, 'collision repair dallas').shouldExclude,
  false,
  'City-only collision intent must not become a named competitor'
);
assert.strictEqual(
  evaluate(canonical, 'car').shouldExclude,
  false,
  'The low-intent geo rule must never trigger on bare car'
);
assert.strictEqual(
  evaluate(canonical, 'car near me').shouldExclude,
  false,
  'The low-intent geo rule requires a named place'
);

var matcherCases = [
  ['tints near me', 'tint'],
  ['bumpers loose', 'bumper'],
  ['repainting cost', 'paint'],
  ['fix cars near me', 'fix car']
];
for (i = 0; i < matcherCases.length; i++) {
  for (m = 0; m < modules.length; m++) {
    assert.strictEqual(
      modules[m].containsPhrase_(matcherCases[i][0], matcherCases[i][1]),
      true,
      files[m] + ' lost plural/stem matching for ' + matcherCases[i].join(' / ')
    );
  }
}

assert.strictEqual(canonical.CONFIG.ACTION_WINDOW_DAYS, 7);
assert.strictEqual(modules[3].CONFIG.ACTION_WINDOW_DAYS, 7);
assert.strictEqual(modules[4].CONFIG.ACTION_WINDOW_DAYS, 7);
assert.strictEqual(modules[1].CONFIG.ACTION_WINDOW_DAYS, 90);
assert.strictEqual(modules[2].CONFIG.ACTION_WINDOW_DAYS, 90);
assert.deepStrictEqual(
  canonical.buildDateWindowFromTodayText_('2026-08-24', 7, 30),
  {
    actionStart: '2026-08-17',
    actionEnd: '2026-08-23',
    historyStart: '2026-07-25'
  }
);

function reportingRow(date, cost, pmax) {
  var row = {
    segments: { date: date },
    campaign: { id: '99', name: 'Built by Shah - Test' },
    metrics: {
      impressions: 10,
      clicks: 2,
      costMicros: cost * 1000000,
      conversions: 0
    }
  };
  if (pmax) {
    row.campaignSearchTermView = { searchTerm: 'audit reporting term' };
  } else {
    row.searchTermView = {
      searchTerm: 'audit reporting term',
      status: 'NONE'
    };
  }
  return row;
}

var searchAggregate = modules[3].aggregateSearchTerms_(
  [
    reportingRow('2026-08-22', 3, false),
    reportingRow('2026-08-23', 2, false)
  ],
  '2026-08-17',
  '2026-08-23'
)[0];
assert.strictEqual(searchAggregate.actionCost, 5);
assert.strictEqual(searchAggregate.yesterdayCost, 2);
assert.strictEqual(searchAggregate.actionImpressions, 20);
assert.strictEqual(searchAggregate.yesterdayImpressions, 10);

var pmaxAggregate = modules[4].aggregateSearchTerms_(
  [
    reportingRow('2026-08-22', 4, true),
    reportingRow('2026-08-23', 1, true)
  ],
  '2026-08-17',
  '2026-08-23'
)[0];
assert.strictEqual(pmaxAggregate.actionCost, 5);
assert.strictEqual(pmaxAggregate.yesterdayCost, 1);

function syntheticTerm(text, id) {
  return {
    channel: 'SEARCH',
    campaignId: String(id),
    campaignName: 'Built by Shah - Test',
    searchTerm: text,
    firstSeenDate: '2026-08-17',
    lastSeenDate: '2026-08-23',
    actionImpressions: 2,
    actionClicks: 1,
    actionCost: 3,
    actionConversions: 0,
    historyConversions: 0
  };
}

var candidates = [syntheticTerm('known', 1), syntheticTerm('unresolved', 1)];
var output = {
  customerId: '1234567890',
  accountName: 'Contract Test',
  termsReviewed: candidates.length,
  decisionCounts: {},
  auditRows: [],
  auditRowsTotal: 0,
  auditTruncated: false
};
canonical.recordTermDecision_(
  output,
  candidates[0],
  { matchedRules: [] },
  'NO_RULE',
  'No rule matched.'
);
assert.strictEqual(
  canonical.ensureDecisionReconciliation_(output, candidates),
  false,
  'The invariant must detect an initially missing terminal decision'
);
assert.strictEqual(output.decisionReconciled, true);
assert.strictEqual(output.decisionTotal, candidates.length);
assert.strictEqual(canonical.sumDecisionCounts_(output.decisionCounts), 2);
delete output._decidedTermKeys;

var csv = canonical.buildDecisionAuditCsv_([output]);
assert.strictEqual(csv.rowCount, candidates.length);
assert.strictEqual(csv.truncated, false);
assert.ok(csv.content.indexOf('"NO_RULE"') !== -1);
assert.ok(csv.content.indexOf('"FAILED"') !== -1);

process.stdout.write(
  'Negative sweeper contract passed for ' + files.length +
  ' scripts and ' + suppliedTerms.length + ' supplied terms.\n'
);
