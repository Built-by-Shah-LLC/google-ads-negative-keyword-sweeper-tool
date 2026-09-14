import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchingPhraseProtections, normalizeTerm } from "../src/config/phrase-protections.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import type { ClassificationCandidate, ClassificationDecision } from "../src/types.js";

// Read-only conformance audit: replays deterministic encodings of the policy's
// explicit always-win / always-KEEP token locks against recorded LLM decisions.
// Never calls Google Ads or any LLM. Output is one Markdown report.

interface AccountSpec {
  label: string;
  customerId: string;
  runDir: string;
  brandTokens: string[];
}

interface JoinedRow {
  candidate: ClassificationCandidate;
  decision: ClassificationDecision;
}

interface CheckResult {
  id: string;
  title: string;
  ruleRef: string;
  expectation: "NEGATIVE_EXACT" | "KEEP";
  severity: "hard" | "indicative";
  matched: number;
  conformant: number;
  violations: Array<{
    searchTerm: string;
    decision: string;
    ruleIds: string[];
    reason: string;
    confidence: number;
    campaignName: string;
    impressions: number;
    clicks: number;
  }>;
}

const workspace = process.cwd();
const args = process.argv.slice(2);

function optionValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]!);
  }
  return values;
}

function optionValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

// ---------- token helpers on the production normalization ----------

function tokensOf(term: string): string[] {
  const normalized = normalizeTerm(term);
  return normalized ? normalized.split(" ") : [];
}

function hasToken(tokens: string[], wanted: Iterable<string>): boolean {
  const set = wanted instanceof Set ? wanted : new Set(wanted);
  return tokens.some((token) => set.has(token));
}

function hasSeq(tokens: string[], ...seq: string[]): boolean {
  for (let index = 0; index + seq.length <= tokens.length; index += 1) {
    if (seq.every((part, offset) => tokens[index + offset] === part)) return true;
  }
  return false;
}

const BODY_TOKENS = new Set(["body", "autobody", "bodyshop", "bodywork"]);
const CRASH_TOKENS = new Set(["collision", "collisions", "crash", "crashes", "wreck", "wrecks", "accident", "accidents", "totaled", "smashed"]);
const MECHANICAL_TOKENS = new Set(["mechanic", "mechanics", "technician", "technicians", "service", "services", "tech"]);
const REVIEWS_TOKENS = new Set(["review", "reviews", "image", "images", "photo", "photos", "picture", "pictures", "pics", "gallery", "rating", "ratings"]);
const PAINT_TOKENS = new Set(["paint", "paints", "painted", "painting", "painter", "painters", "repaint", "repainted", "repainting", "color", "colors", "colored", "colour", "colours", "coloring", "colouring"]);
const METAL_TOKENS = new Set(["aluminum", "aluminium", "steel", "iron"]);
const ORIGIN_ADJECTIVES = new Set(["korean", "german", "italian", "european", "japanese"]);

function bodyShopWording(tokens: string[]): boolean {
  return hasToken(tokens, BODY_TOKENS);
}

function crashEventWording(tokens: string[]): boolean {
  return hasToken(tokens, CRASH_TOKENS)
    || hasSeq(tokens, "rear", "ended") || hasSeq(tokens, "rear", "end", "collision")
    || hasSeq(tokens, "t", "boned") || hasSeq(tokens, "hit", "my", "car");
}

function contiguousMechanicalRepair(tokens: string[]): boolean {
  const heads = new Set(["auto", "car", "automobile", "automotive"]);
  const repairs = new Set(["repair", "repairs", "repaired", "repairing"]);
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (heads.has(tokens[index]!) && repairs.has(tokens[index + 1]!)) return true;
  }
  return false;
}

function anyAlwaysWinDetectorFires(tokens: string[]): boolean {
  return alwaysWinDetectors.some((detector) => detector(tokens));
}

// Always-win token detectors shared by several checks. Each returns true when the
// policy's explicit token evidence is present. Kept conservative: only patterns the
// Markdown names verbatim are encoded.
const alwaysWinDetectors: Array<(tokens: string[]) => boolean> = [
  (t) => hasToken(t, REVIEWS_TOKENS),
  (t) => hasSeq(t, "24", "7") || hasSeq(t, "24", "hour") || hasSeq(t, "24", "hours")
    || hasToken(t, ["24hour", "24hours", "24hr", "24hrs"]) || hasSeq(t, "twenty", "four", "seven")
    || hasSeq(t, "twenty", "four", "hours"),
  (t) => hasToken(t, ["quick", "quickly", "fast", "faster", "fastest", "minor", "sameday", "oneday"])
    || hasSeq(t, "same", "day") || hasSeq(t, "one", "day") || hasSeq(t, "1", "day"),
  (t) => hasToken(t, METAL_TOKENS),
  (t) => hasToken(t, PAINT_TOKENS),
  (t) => hasToken(t, ["salvage", "salvaged", "junkyard", "junkyards", "restomod"])
    || hasSeq(t, "rebuilt", "title") || hasSeq(t, "salvage", "title")
    || (hasToken(t, ["rebuild", "rebuilds", "rebuilt", "rebuilding"])
      && hasToken(t, ["car", "cars", "vehicle", "auto", "salvage", "junk", "title"])),
  (t) => hasToken(t, ["inspection", "inspections", "inspect", "inspects", "inspected", "inspector", "inspectors"]),
  (t) => hasToken(t, ["tow", "towing", "tows", "towed", "wrecker", "wreckers", "impound"]),
  (t) => hasToken(t, ["motorcycle", "motorcycles", "motorbike", "motorbikes", "bike", "bikes", "ebike",
    "scooter", "scooters", "atv", "atvs", "lucid", "rv", "motorhome", "sprinter", "camper", "tanker"])
    || hasSeq(t, "semi", "truck") || hasSeq(t, "18", "wheeler") || hasSeq(t, "big", "rig")
    || hasSeq(t, "box", "truck") || hasSeq(t, "dump", "truck") || hasSeq(t, "garbage", "truck")
    || hasToken(t, ["semi"])
    || (hasToken(t, ["truck", "trucks"]) && !hasSeq(t, "pickup", "truck")),
  (t) => hasSeq(t, "fender", "bender") || hasToken(t, ["fenderbender", "pdr"])
    || hasSeq(t, "paintless", "dent")
    || (hasToken(t, ["dent", "dents", "ding", "dings", "scratch", "scratches", "keyed", "scuff"]) && !crashEventWording(t))
    || hasSeq(t, "fill", "hole") || hasSeq(t, "fill", "holes") || hasSeq(t, "filling", "holes")
    || hasSeq(t, "rust", "hole") || hasSeq(t, "rust", "holes") || hasSeq(t, "patch", "hole") || hasSeq(t, "patch", "holes")
    || hasSeq(t, "hole", "in", "car", "body") || hasSeq(t, "holes", "in", "car", "body"),
  (t) => hasSeq(t, "how", "much") || hasToken(t, ["quote", "quotes", "estimate", "estimates", "price", "prices",
    "cost", "costs", "cheap", "cheaper", "affordable", "discount", "discounts", "financing", "finance", "free"])
    || hasSeq(t, "payment", "plan"),
  (t) => hasToken(t, ["com", "www", "http", "https", "website", "login", "portal"])
    || hasSeq(t, "dot", "com") || hasSeq(t, "web", "site") || hasSeq(t, "sign", "in") || hasSeq(t, "log", "in")
    || hasSeq(t, "online", "account"),
  (t) => hasToken(t, ["custom"]) && (bodyShopWording(t) || hasToken(t, ["fabrication", "fiberglass"])),
];

function questionOpener(tokens: string[]): boolean {
  const first = tokens[0];
  if (!first) return false;
  if (["what", "how", "why", "which", "does", "do", "did", "can", "could", "should", "whats"].includes(first)) return true;
  if ((first === "is" || first === "are") && !(hasSeq(tokens, "is", "there") && (bodyShopWording(tokens) || crashEventWording(tokens)))) return true;
  if (hasToken(tokens, ["vs", "versus"]) || hasSeq(tokens, "difference", "between")) return true;
  return false;
}

function mobileService(tokens: string[]): boolean {
  if (!hasToken(tokens, ["mobile"])) return false;
  const geoMobile = (hasSeq(tokens, "mobile", "al") || hasSeq(tokens, "mobile", "alabama"))
    && (bodyShopWording(tokens) || crashEventWording(tokens));
  return !geoMobile;
}

function mechanicalKillOutsideProtection(tokens: string[], term: string, customerId: string, protections: import("../src/types.js").PhraseProtection[]): boolean {
  const matches = matchingPhraseProtections(term, customerId, protections)
    .filter((entry) => entry.ruleId === "POL-MECHANICAL-ONLY-NEGATIVE");
  let remaining = [...tokens];
  for (const match of matches) {
    const phraseTokens = tokensOf(match.phrase);
    // Remove one occurrence of the protected phrase span from the token stream.
    for (let index = 0; index + phraseTokens.length <= remaining.length; index += 1) {
      if (phraseTokens.every((part, offset) => remaining[index + offset] === part)) {
        remaining = [...remaining.slice(0, index), ...remaining.slice(index + phraseTokens.length)];
        break;
      }
    }
  }
  return hasToken(remaining, MECHANICAL_TOKENS)
    || (contiguousMechanicalRepair(remaining) && !bodyShopWording(remaining) && !crashEventWording(remaining));
}

function protectionExcuseApplies(term: string, customerId: string, protections: import("../src/types.js").PhraseProtection[], ruleId: string): boolean {
  const matches = matchingPhraseProtections(term, customerId, protections).filter((entry) => entry.ruleId === ruleId);
  if (matches.length === 0) return false;
  const tokens = tokensOf(term);
  if (ruleId === "POL-MECHANICAL-ONLY-NEGATIVE") return !mechanicalKillOutsideProtection(tokens, term, customerId, protections);
  return true;
}

// ---------- check registry ----------

type Detector = (tokens: string[], term: string, account: AccountSpec) => boolean;

interface CheckDef {
  id: string;
  title: string;
  ruleRef: string;
  expectation: "NEGATIVE_EXACT" | "KEEP";
  severity: "hard" | "indicative";
  detect: Detector;
}

function buildChecks(): CheckDef[] {
  const negative = (id: string, title: string, ruleRef: string, detect: Detector, severity: "hard" | "indicative" = "hard"): CheckDef =>
    ({ id, title, ruleRef, expectation: "NEGATIVE_EXACT", severity, detect });
  const keep = (id: string, title: string, ruleRef: string, detect: Detector, severity: "hard" | "indicative" = "indicative"): CheckDef =>
    ({ id, title, ruleRef, expectation: "KEEP", severity, detect });

  return [
    negative("reviews-research", "Reviews / photos / ratings research", "POL-REVIEWS-NEGATIVE",
      (t) => hasToken(t, REVIEWS_TOKENS)),
    negative("hours-247", "24/7 and 24-hour hours demand", "POL-HOURS-247-NEGATIVE",
      (t) => hasSeq(t, "24", "7") || hasSeq(t, "24", "hour") || hasSeq(t, "24", "hours")
        || hasToken(t, ["24hour", "24hours", "24hr", "24hrs"]) || hasSeq(t, "twenty", "four", "seven")
        || hasSeq(t, "twenty", "four", "hours")),
    negative("small-speed", "Quick / fast / minor / same-day / one-day small rush jobs", "POL-SMALL-SPEED-NEGATIVE",
      (t) => hasToken(t, ["quick", "quickly", "fast", "faster", "fastest", "minor", "sameday", "oneday"])
        || hasSeq(t, "same", "day") || hasSeq(t, "one", "day") || hasSeq(t, "1", "day")),
    negative("mobile-service", "Mobile coming-to-you service (excl. Mobile AL geo)", "POL-MOBILE-SERVICE-NEGATIVE", mobileService),
    negative("metal-material", "Aluminum / steel / iron (always-win, even with body wording)", "POL-METAL-MATERIAL-NEGATIVE",
      (t) => hasToken(t, METAL_TOKENS)),
    negative("paint-color", "Paint / color / repaint mention (always-win)", "POL-PAINT-COLOR-NEGATIVE",
      (t) => hasToken(t, PAINT_TOKENS)),
    negative("salvage-junk", "Salvage title / junk / rebuild-car demand", "POL-SALVAGE-JUNK-NEGATIVE",
      alwaysWinDetectors[5]!),
    negative("inspection", "Inspection / inspector ask", "POL-INSPECTION-NEGATIVE",
      alwaysWinDetectors[6]!),
    negative("towing", "Towing / wrecker demand", "POL-TOWING-NEGATIVE",
      alwaysWinDetectors[7]!),
    negative("wrong-vehicle", "Trucks / RV / Sprinter / motorcycle / bike / scooter / ATV", "POL-WRONG-VEHICLE-NEGATIVE",
      alwaysWinDetectors[8]!),
    negative("lucid", "Lucid vehicles (never OEM KEEP)", "POL-WRONG-VEHICLE-NEGATIVE",
      (t) => hasToken(t, ["lucid"])),
    negative("cosmetic-only", "Fender-bender slang, dent/scratch ask, PDR, hole-fill", "POL-COSMETIC-ONLY-NEGATIVE",
      alwaysWinDetectors[9]!),
    negative("informational", "Informational question openers (not trailing ?)", "POL-INFORMATIONAL-NEGATIVE", questionOpener),
    negative("price-shopper", "Quote / price / cost / cheap / financing / how much", "POL-PRICE-SHOPPER-NEGATIVE",
      alwaysWinDetectors[10]!),
    negative("website-nav", "Website / domain / login navigation", "POL-WEBSITE-NAV-NEGATIVE",
      alwaysWinDetectors[11]!),
    negative("custom-fab", "Custom body / fabrication shops", "POL-CUSTOM-FABRICATION-NEGATIVE",
      alwaysWinDetectors[12]!),
    negative("mechanical-contiguous", "Contiguous auto/car repair, no body-shop or crash-event wording", "POL-MECHANICAL-ONLY-NEGATIVE",
      (t) => contiguousMechanicalRepair(t) && !bodyShopWording(t) && !crashEventWording(t)),
    negative("mechanic-service", "Mechanic / technician / standalone tech / service kill list", "POL-MECHANICAL-ONLY-NEGATIVE",
      (t, term, account) => hasToken(t, MECHANICAL_TOKENS)
        && !protectionExcuseApplies(term, account.customerId, accountProtections.get(account.customerId) ?? [], "POL-MECHANICAL-ONLY-NEGATIVE")),
    keep("body-repair", "Body-attached repair (auto body repair / body repair) with no always-win evidence", "POL-BODYWORK-KEEP",
      (t) => (hasSeq(t, "auto", "body", "repair") || hasSeq(t, "autobody", "repair") || hasSeq(t, "body", "repair")
        || hasSeq(t, "body", "shop", "repair") || hasSeq(t, "body", "work", "repair"))
        && !anyAlwaysWinDetectorFires(t) && !questionOpener(t) && !mobileService(t)),
    keep("quality-shopping", "best / top rated / highest rated / 5 star shop-finding with body/collision demand", "POL-BODYWORK-KEEP / POL-REVIEWS-NEGATIVE carve-out",
      (t) => (hasToken(t, ["best"]) || hasSeq(t, "top", "rated") || hasSeq(t, "highest", "rated")
        || hasSeq(t, "highly", "rated") || hasSeq(t, "best", "rated") || hasSeq(t, "5", "star") || hasSeq(t, "five", "star"))
        && (bodyShopWording(t) || crashEventWording(t))
        && !hasToken(t, ["review", "reviews"]) && !anyAlwaysWinDetectorFires(t) && !questionOpener(t)),
    keep("origin-adjective-body", "korean / german / italian / european / japanese + body-shop wording", "POL-BODYWORK-KEEP",
      (t) => hasToken(t, ORIGIN_ADJECTIVES) && bodyShopWording(t) && !anyAlwaysWinDetectorFires(t) && !questionOpener(t)),
    negative("origin-adjective-collision-only", "Origin adjective + collision without body-shop wording", "POL-COMPETITOR-NEGATIVE",
      (t) => hasToken(t, ORIGIN_ADJECTIVES) && crashEventWording(t) && !bodyShopWording(t) && !anyAlwaysWinDetectorFires(t)),
    keep("auto-repair-plus-body", "Contiguous auto/car repair WITH body-shop wording present", "POL-BODYWORK-KEEP",
      (t) => contiguousMechanicalRepair(t) && bodyShopWording(t) && !anyAlwaysWinDetectorFires(t) && !questionOpener(t) && !mobileService(t)
        && !hasToken(t, MECHANICAL_TOKENS)),
  ];
}

// Protections are account-scoped; populated per account before checks run.
const accountProtections = new Map<string, import("../src/types.js").PhraseProtection[]>();

// ---------- main ----------

async function main(): Promise<void> {
  const outPath = optionValue("--out");
  if (!outPath) throw new Error("--out <markdown path> is required.");
  const specs: AccountSpec[] = optionValues("--account").map((raw) => {
    const [label, customerId, runDir, brand] = raw.split(":");
    if (!label || !customerId || !runDir) throw new Error(`Bad --account spec: ${raw}`);
    return { label, customerId, runDir, brandTokens: (brand ?? "").split("|").filter(Boolean) };
  });
  if (specs.length === 0) throw new Error("At least one --account label:customerId:runDir[:brandToken] is required.");

  const rules = await loadRuleSet(workspace);
  const checks = buildChecks();

  const sections: string[] = [];
  const headlineRows: string[] = [];

  for (const spec of specs) {
    accountProtections.set(spec.customerId, rules.phraseProtections ?? []);
    const base = resolve(workspace, spec.runDir, "organizations", spec.customerId);
    const candidatesDoc = JSON.parse(await readFile(resolve(base, "candidates.json"), "utf8")) as { candidates: ClassificationCandidate[]; dateRange: { startDate: string; endDate: string }; organization: { descriptiveName: string } };
    const decisionsDoc = JSON.parse(await readFile(resolve(base, "decisions.json"), "utf8")) as { decisions: ClassificationDecision[]; model: string; ruleVersion: string; promptVersion: string };
    const candidateByItemId = new Map(candidatesDoc.candidates.map((candidate) => [candidate.itemId, candidate]));
    const rows: JoinedRow[] = decisionsDoc.decisions.map((decision) => ({
      candidate: candidateByItemId.get(decision.itemId)!,
      decision
    })).filter((row) => row.candidate);

    // ---- contract + exact-text integrity (hard, validation-enforced) ----
    const contractViolations: string[] = [];
    const ruleIdSet = new Set(rules.ruleIds);
    for (const { candidate, decision } of rows) {
      const cited = decision.ruleIds ?? [];
      const unknown = cited.filter((id) => !ruleIdSet.has(id));
      if (unknown.length > 0) contractViolations.push(`${candidate.searchTerm} — unknown rule IDs ${unknown.join(",")}`);
      if (decision.decision === "KEEP") {
        if (decision.negativeText !== null) contractViolations.push(`${candidate.searchTerm} — KEEP with non-null negativeText`);
        if (cited.some((id) => id.endsWith("-NEGATIVE") || id === "POL-FULL-QUERY-EXACT")) contractViolations.push(`${candidate.searchTerm} — KEEP cites ${cited.join(",")}`);
        if (!cited.some((id) => id.endsWith("-KEEP"))) contractViolations.push(`${candidate.searchTerm} — KEEP without a -KEEP rule`);
      } else if (decision.decision === "NEGATIVE_EXACT") {
        if (decision.negativeText !== candidate.searchTerm) contractViolations.push(`${candidate.searchTerm} — negativeText rewritten to ${decision.negativeText}`);
        if (cited.some((id) => id.endsWith("-KEEP"))) contractViolations.push(`${candidate.searchTerm} — NEGATIVE cites a -KEEP rule`);
        if (!cited.some((id) => id.endsWith("-NEGATIVE"))) contractViolations.push(`${candidate.searchTerm} — NEGATIVE without a -NEGATIVE rule`);
      }
      if (!(decision.confidence >= 0 && decision.confidence <= 1)) contractViolations.push(`${candidate.searchTerm} — confidence ${decision.confidence}`);
      if (typeof decision.reason === "string" && decision.reason.length > 240) contractViolations.push(`${candidate.searchTerm} — reason over 240 chars`);
    }

    // ---- token-lock checks ----
    const results: CheckResult[] = checks.map((check) => {
      const result: CheckResult = { ...check, matched: 0, conformant: 0, violations: [] };
      for (const { candidate, decision } of rows) {
        const tokens = tokensOf(candidate.searchTerm);
        if (!check.detect(tokens, candidate.searchTerm, spec)) continue;
        result.matched += 1;
        if (decision.decision === check.expectation) {
          result.conformant += 1;
        } else {
          result.violations.push({
            searchTerm: candidate.searchTerm,
            decision: decision.decision,
            ruleIds: decision.ruleIds,
            reason: decision.reason,
            confidence: decision.confidence,
            campaignName: candidate.campaignName,
            impressions: candidate.impressions,
            clicks: candidate.clicks
          });
        }
      }
      return result;
    });

    // ---- own-brand check ----
    const ownBrand = { matched: 0, kept: [] as JoinedRow[], negativeWithoutOwnBrand: [] as JoinedRow[] };
    if (spec.brandTokens.length > 0) {
      for (const row of rows) {
        const tokens = tokensOf(row.candidate.searchTerm);
        if (!hasToken(tokens, spec.brandTokens)) continue;
        ownBrand.matched += 1;
        if (row.decision.decision === "KEEP") ownBrand.kept.push(row);
        else if (!row.decision.ruleIds.includes("POL-OWN-BRAND-NEGATIVE")) ownBrand.negativeWithoutOwnBrand.push(row);
      }
    }

    // ---- phrase-protection observation ----
    const protectionRows: Array<{ term: string; matchedIds: string[]; decision: string; ruleIds: string[]; reason: string }> = [];
    for (const { candidate, decision } of rows) {
      const matches = matchingPhraseProtections(candidate.searchTerm, spec.customerId, rules.phraseProtections ?? []);
      if (matches.length === 0) continue;
      protectionRows.push({
        term: candidate.searchTerm,
        matchedIds: matches.map((match) => match.id),
        decision: decision.decision,
        ruleIds: decision.ruleIds,
        reason: decision.reason
      });
    }

    // ---- distributions ----
    const ruleDistribution = new Map<string, number>();
    for (const { decision } of rows) {
      const primary = decision.ruleIds[0] ?? "(none)";
      ruleDistribution.set(primary, (ruleDistribution.get(primary) ?? 0) + 1);
    }
    const sortedRules = [...ruleDistribution.entries()].sort((a, b) => b[1] - a[1]);
    const keeps = rows.filter((row) => row.decision.decision === "KEEP");
    const negatives = rows.filter((row) => row.decision.decision === "NEGATIVE_EXACT");
    const confidences = rows.map((row) => row.decision.confidence).sort((a, b) => a - b);
    const percentile = (p: number) => confidences[Math.min(confidences.length - 1, Math.floor(confidences.length * p))] ?? 0;
    const lowConfidence = rows.filter((row) => row.decision.confidence < 0.7);
    const alreadyExcluded = rows.filter((row) => row.candidate.targetingStatus === "EXCLUDED");
    const negativeClicks = negatives.reduce((total, row) => total + row.candidate.clicks, 0);
    const negativeCost = negatives.reduce((total, row) => total + row.candidate.costMicros, 0);
    const negativeConversions = negatives.reduce((total, row) => total + row.candidate.conversions, 0);

    const hardViolations = results.filter((result) => result.severity === "hard" && result.violations.length > 0);
    const indicativeFlags = results.filter((result) => result.severity === "indicative" && result.violations.length > 0);
    const totalHardMatched = results.filter((r) => r.severity === "hard").reduce((t, r) => t + r.matched, 0);
    const totalHardConformant = results.filter((r) => r.severity === "hard").reduce((t, r) => t + r.conformant, 0);
    const hardRate = totalHardMatched > 0 ? (totalHardConformant / totalHardMatched) * 100 : 100;

    headlineRows.push(`| ${candidatesDoc.organization.descriptiveName} (${spec.customerId}) | ${rows.length} | ${keeps.length} / ${negatives.length} | ${contractViolations.length} | ${hardRate.toFixed(1)}% | ${ownBrand.kept.length} |`);

    const section: string[] = [];
    section.push(`## ${candidatesDoc.organization.descriptiveName} (\`${spec.customerId}\`)`);
    section.push("");
    section.push(`- Run: \`${spec.runDir}\``);
    section.push(`- Window: ${candidatesDoc.dateRange.startDate} → ${candidatesDoc.dateRange.endDate} | Model: ${decisionsDoc.model} | Rules: ${decisionsDoc.ruleVersion} / ${decisionsDoc.promptVersion}`);
    section.push(`- Decisions: **${rows.length}** (${keeps.length} KEEP, ${negatives.length} NEGATIVE_EXACT)`);
    section.push(`- Already excluded by existing negatives in Google Ads (targetingStatus EXCLUDED): ${alreadyExcluded.length} of ${rows.length}`);
    section.push(`- Traffic on proposed negatives: ${negativeClicks} clicks, $${(negativeCost / 1_000_000).toFixed(2)} spend, ${negativeConversions} conversions (30d)`);
    section.push(`- Confidence: p10 ${percentile(0.1).toFixed(2)}, p50 ${percentile(0.5).toFixed(2)}, p90 ${percentile(0.9).toFixed(2)} | below 0.70: ${lowConfidence.length}`);
    section.push("");
    section.push(`### Contract and exact-text integrity`);
    section.push("");
    if (contractViolations.length === 0) {
      section.push(`All ${rows.length} decisions satisfy the output contract: valid rule IDs, KEEP/NEGATIVE rule-citation rules, \`negativeText\` byte-identical to the full search term on every NEGATIVE_EXACT, null on KEEP, confidence within [0,1], reasons ≤ 240 chars.`);
    } else {
      section.push(`**${contractViolations.length} contract violations:**`);
      for (const violation of contractViolations.slice(0, 50)) section.push(`- ${violation}`);
    }
    section.push("");
    section.push(`### Explicit token-lock conformance`);
    section.push("");
    section.push(`Checks below encode only patterns the policy names verbatim. **Hard** checks are always-win/always-KEEP token locks where a mismatch is a probable rule violation. **Indicative** checks flag mismatches for human review because competitor/leftover evidence the detector cannot see may justify them.`);
    section.push("");
    section.push(`| Check | Rule | Expect | Matched | Conformant | Rate |`);
    section.push(`|---|---|---|---|---|---|`);
    for (const result of results) {
      const rate = result.matched > 0 ? `${((result.conformant / result.matched) * 100).toFixed(0)}%` : "—";
      section.push(`| ${result.title}${result.severity === "indicative" ? " *(indicative)*" : ""} | ${result.ruleRef} | ${result.expectation} | ${result.matched} | ${result.conformant} | ${rate} |`);
    }
    section.push("");
    if (hardViolations.length > 0) {
      section.push(`### Hard-lock mismatches (probable rule violations)`);
      section.push("");
      for (const result of hardViolations) {
        section.push(`#### ${result.title} — ${result.violations.length} of ${result.matched} mismatched`);
        section.push("");
        section.push(`| Search term | Decision | Cited rules | Reason | Campaign | Imp | Clk |`);
        section.push(`|---|---|---|---|---|---|---|`);
        for (const violation of result.violations.slice(0, 40)) {
          section.push(`| ${violation.searchTerm.replaceAll("|", "\\|")} | ${violation.decision} | ${violation.ruleIds.join(", ")} | ${violation.reason.replaceAll("|", "\\|")} | ${violation.campaignName.replaceAll("|", "\\|")} | ${violation.impressions} | ${violation.clicks} |`);
        }
        if (result.violations.length > 40) section.push(`| … ${result.violations.length - 40} more | | | | | | |`);
        section.push("");
      }
    } else {
      section.push(`### Hard-lock mismatches`);
      section.push("");
      section.push(`None. Every always-win token-lock check conformed.`);
      section.push("");
    }
    if (indicativeFlags.length > 0) {
      section.push(`### Indicative mismatches (human review — may be justified by competitor evidence)`);
      section.push("");
      for (const result of indicativeFlags) {
        section.push(`#### ${result.title} — ${result.violations.length} of ${result.matched} flagged`);
        section.push("");
        section.push(`| Search term | Decision | Cited rules | Reason | Imp | Clk |`);
        section.push(`|---|---|---|---|---|---|`);
        for (const violation of result.violations.slice(0, 25)) {
          section.push(`| ${violation.searchTerm.replaceAll("|", "\\|")} | ${violation.decision} | ${violation.ruleIds.join(", ")} | ${violation.reason.replaceAll("|", "\\|")} | ${violation.impressions} | ${violation.clicks} |`);
        }
        if (result.violations.length > 25) section.push(`| … ${result.violations.length - 25} more | | | | | |`);
        section.push("");
      }
    }
    section.push(`### Own-brand suppression (\`POL-OWN-BRAND-NEGATIVE\`)`);
    section.push("");
    if (spec.brandTokens.length === 0) {
      section.push(`No brand tokens configured for this account.`);
    } else {
      section.push(`Queries containing the organization's distinctive name (${spec.brandTokens.map((token) => `\`${token}\``).join(" / ")}): **${ownBrand.matched}**. KEPT (hard violation): **${ownBrand.kept.length}**. Negative without citing own-brand (soft note): **${ownBrand.negativeWithoutOwnBrand.length}**.`);
      if (ownBrand.kept.length > 0) {
        section.push("");
        section.push(`| Search term | Decision | Cited rules | Reason |`);
        section.push(`|---|---|---|---|`);
        for (const row of ownBrand.kept.slice(0, 30)) {
          section.push(`| ${row.candidate.searchTerm.replaceAll("|", "\\|")} | ${row.decision.decision} | ${row.decision.ruleIds.join(", ")} | ${row.decision.reason.replaceAll("|", "\\|")} |`);
        }
      }
    }
    section.push("");
    section.push(`### Phrase-protection exercise (release 2026-09-09.3 feature)`);
    section.push("");
    if (protectionRows.length === 0) {
      section.push(`No query matched a configured phrase protection in this account's 30-day window.`);
    } else {
      section.push(`${protectionRows.length} quer${protectionRows.length === 1 ? "y" : "ies"} matched a configured protection. The excused evidence applies only to the specified rule; remaining independent exclusions must still hold.`);
      section.push("");
      section.push(`| Search term | Protection(s) | Decision | Cited rules | Reason |`);
      section.push(`|---|---|---|---|---|`);
      for (const row of protectionRows.slice(0, 40)) {
        section.push(`| ${row.term.replaceAll("|", "\\|")} | ${row.matchedIds.join(", ")} | ${row.decision} | ${row.ruleIds.join(", ")} | ${row.reason.replaceAll("|", "\\|")} |`);
      }
      if (protectionRows.length > 40) section.push(`| … ${protectionRows.length - 40} more | | | | |`);
    }
    section.push("");
    section.push(`### Rule-citation distribution (primary rule per decision)`);
    section.push("");
    section.push(`| Primary cited rule | Decisions | Share |`);
    section.push(`|---|---|---|`);
    for (const [ruleId, count] of sortedRules) {
      section.push(`| ${ruleId} | ${count} | ${((count / rows.length) * 100).toFixed(1)}% |`);
    }
    section.push("");
    section.push(`### Lowest-confidence decisions (< 0.70) — optional review`);
    section.push("");
    if (lowConfidence.length === 0) {
      section.push(`None.`);
    } else {
      section.push(`| Search term | Decision | Cited rules | Confidence | Reason |`);
      section.push(`|---|---|---|---|---|`);
      for (const row of lowConfidence.slice(0, 30)) {
        section.push(`| ${row.candidate.searchTerm.replaceAll("|", "\\|")} | ${row.decision.decision} | ${row.decision.ruleIds.join(", ")} | ${row.decision.confidence} | ${row.decision.reason.replaceAll("|", "\\|")} |`);
      }
      if (lowConfidence.length > 30) section.push(`| … ${lowConfidence.length - 30} more | | | | |`);
    }
    section.push("");
    sections.push(section.join("\n"));
  }

  const report: string[] = [];
  report.push(`# Rule-conformance audit — Royal Auto Body & Erland Auto Body (30-day Moonshot runs)`);
  report.push(``);
  report.push(`Date: 2026-09-09. Method: deterministic replay of the explicit token locks in`);
  report.push(`\`src/config/negative-keyword-rules.md\` (rule set ${rules.version}, prompt ${rules.promptVersion},`);
  report.push(`release \`${rules.releaseId}\`) against the recorded kimi-k2.6 decisions from the two`);
  report.push(`30-day measurement runs. Each account is audited independently against the same policy;`);
  report.push(`no Google Ads or LLM calls are made by this audit. Hard checks encode only patterns the`);
  report.push(`policy names verbatim; indicative checks need human judgment for competitor leftovers.`);
  report.push(`Generator: \`scripts/audit-rule-conformance.ts\`.`);
  report.push(``);
  report.push(`## Headline summary`);
  report.push(``);
  report.push(`| Account | Decisions | KEEP / NEGATIVE | Contract violations | Hard-lock conformance | Own-brand KEEPs |`);
  report.push(`|---|---|---|---|---|---|`);
  report.push(...headlineRows);
  report.push(``);
  for (const section of sections) report.push(section);
  report.push(``);
  report.push(`## Limitations`);
  report.push(``);
  report.push(`- The competitor leftover-token test, geo disambiguation, insurer recognition, and general intent judgment cannot be encoded deterministically; those decisions are covered only by the indicative listings and the low-confidence table, not by hard pass/fail.`);
  report.push(`- Detectors replay the policy's named token lists on the production normalization (NFKC, case, punctuation). Model judgments that hinge on context beyond the named tokens are intentionally out of scope for hard checks.`);
  report.push(`- Conformance here measures agreement with the written locks, not business outcomes; a conformant run can still contain individually debatable decisions.`);
  report.push(``);

  const target = resolve(workspace, outPath);
  await writeFile(target, report.join("\n"), "utf8");
  console.log(JSON.stringify({ written: target, accounts: specs.map((spec) => spec.label) }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
