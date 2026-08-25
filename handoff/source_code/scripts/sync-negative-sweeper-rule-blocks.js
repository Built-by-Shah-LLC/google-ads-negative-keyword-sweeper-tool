#!/usr/bin/env node
'use strict';

/**
 * Copies the production rule constants and pure evaluators from the standalone
 * daily sweeper into every deployable sibling. Google Ads Scripts cannot import
 * local modules, so the paste-ready files intentionally contain generated
 * copies. Run the contract test after this script.
 */

var fs = require('fs');
var path = require('path');

var scriptsDir = __dirname;
var canonicalPath = path.join(
  scriptsDir,
  'built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js'
);
var targetNames = [
  'built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js',
  'built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js',
  'built-by-shah-mcc-search-negatives-sweeper.js',
  'built-by-shah-mcc-pmax-negatives-sweeper.js'
];

function sliceBetween(source, startMarker, endMarker, label) {
  var start = source.indexOf(startMarker);
  var end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate ' + label + ' markers.');
  }
  return source.slice(start, end);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  var start = source.indexOf(startMarker);
  var end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not replace ' + label + ' markers.');
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

var canonical = fs.readFileSync(canonicalPath, 'utf8');
var ruleBlock = sliceBetween(
  canonical,
  'var SEED_INSURER_PROTECTED_PHRASES = [',
  'function main()',
  'canonical rule block'
);
var evaluatorBlock = sliceBetween(
  canonical,
  'function evaluateRules_(',
  '/**\n * Only campaigns whose names include this substring',
  'canonical evaluator block'
);
var matcherBlock = sliceBetween(
  canonical,
  'function firstMatchingPhrase_(',
  'function stripKeywordSyntax_(',
  'canonical matcher block'
);

for (var i = 0; i < targetNames.length; i++) {
  var targetPath = path.join(scriptsDir, targetNames[i]);
  var source = fs.readFileSync(targetPath, 'utf8');
  source = replaceBetween(
    source,
    'var SEED_INSURER_PROTECTED_PHRASES = [',
    'function main()',
    ruleBlock,
    targetNames[i] + ' rule block'
  );

  var evaluatorEndMarker =
    targetNames[i].indexOf('standalone-backfill') !== -1 ?
      '/**\n * Only campaigns whose names include this substring' :
      'function getCampaignById_(';
  source = replaceBetween(
    source,
    'function evaluateRules_(',
    evaluatorEndMarker,
    evaluatorBlock,
    targetNames[i] + ' evaluator block'
  );
  source = replaceBetween(
    source,
    'function firstMatchingPhrase_(',
    'function stripKeywordSyntax_(',
    matcherBlock,
    targetNames[i] + ' matcher block'
  );
  fs.writeFileSync(targetPath, source);
  process.stdout.write('Synchronized ' + targetNames[i] + '\n');
}
