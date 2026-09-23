/**
 * SEED SOURCE ONLY — not read at runtime.
 *
 * Trusted per-account policy configuration, keyed by the canonical ten-digit
 * Google Ads customer ID (no hyphens). Account names are mutable and supplied
 * by Google Ads; the customer ID is the stable policy identity.
 *
 * Runtime policy is loaded from the database (see src/config/db-policy.ts).
 * This file remains the initial seed content that scripts/seed-policy-to-db.ts
 * imports into the negative_keyword_account_rules and
 * negative_keyword_phrase_protections tables:
 * - `customRules` is the dynamic rule set for one account, rendered into that
 *   account's effective rules document at runtime;
 * - `phraseProtectionsFile` is the per-company phrase-protection document that
 *   is combined with the agency-wide protections for that account only.
 */

import type { AccountRuleDefinition } from "./account-policy-compiler.js";

export type { AccountRuleDefinition };

export interface AccountPolicySeedConfig {
  /** Stable policy identity used in artifacts; not the mutable descriptive name. */
  policyKey: string;
  /** Bump on every change to this account entry. */
  revision: string;
  /** Dynamic account-specific rules appended after the base rules. */
  customRules: AccountRuleDefinition[];
  /** Per-company phrase-protection markdown, relative to the repository root. */
  phraseProtectionsFile: string;
}

export const ACCOUNT_POLICIES: Record<string, AccountPolicySeedConfig> = {
  // 3J Collision Center
  "8500809656": {
    policyKey: "3j-collision-center",
    revision: "2026-09-15.2",
    customRules: [
      {
        id: "POL-PARTS-ONLY-NEGATIVE",
        title: "Parts, interior, and upholstery",
        instruction:
          "Negative parts-only, kit, body-kit, splitter, interior/dashboard component, or\n" +
          "upholstery intent when the searcher is not asking for collision or body-shop repair.\n" +
          "This covers both products and services: seats, leather, headliner, carpet, dash, interior\n" +
          "trim, and upholstery repair or replacement. Do not KEEP an interior/upholstery query\n" +
          "merely because it contains `repair` or `near me`. KEEP only when the query is clearly\n" +
          "asking for collision or body repair and interior wording is incidental.\n\n" +
          "Also negative a single named part or zone as the repair scope, even with `accident`:\n" +
          "bumper, fender, hood, door, quarter panel, trunk, tailgate, front end, or `frame repair`\n" +
          "without `collision`/`crash`/`wreck`/`totaled` wording. `accident bumper repair` is\n" +
          "negative. `fender repair` and `fix a car door` are negative. `rear end collision repair`\n" +
          "is KEEP under `POL-COLLISION-KEEP` because `collision` is present. `major collision with\n" +
          "frame damage and dents` is KEEP; `frame repair near me` is negative.\n\n" +
          "Panel-beater trade slang is a named-part panel service and is always negative, even with\n" +
          "`near me` or a city: `panel beater`, `panel beaters`, `panel beating`. It is not\n" +
          "protected body-shop demand under `POL-BODYWORK-KEEP`.\n\n" +
          "Examples: `panel beaters near me`, `panel beating dallas`.\n\n" +
          "Fender-bender and the same class of minor-incident slang are always negative under\n" +
          "`POL-COSMETIC-ONLY-NEGATIVE`, even when `accident`, `repair`, or `near me` is present:\n" +
          "`fender bender`, `fender-bender`, `fenderbender`, `fender bender repair`,\n" +
          "`fender bender near me`. Do not treat that idiom as crash-event wording or as OEM\n" +
          "`fender` demand.\n\n" +
          "Aluminum, steel, or iron uses `POL-METAL-MATERIAL-NEGATIVE`, which always wins even\n" +
          "with body-shop or collision wording (`aluminum certified body shop`, `aluminum hood`).\n" +
          "Do not KEEP those under this rule as \"incidental metal\" or as a shop certification.\n" +
          "Isolated component failures such as a broken hood latch with no collision/body signal\n" +
          "are negative.\n\n" +
          "Examples: `car upholstery repair near me`, `leather seat repair`, `headliner replacement`,\n" +
          "`dashboard repair`, `carbon fiber splitter`, `accident bumper repair`,\n" +
          "`fender bender repair`, `frame repair near me`, `aluminum hood`."
      },
      {
        id: "POL-GLASS-TINT-NEGATIVE",
        title: "Glass and tint only",
        instruction:
          "Negative windshield/auto-glass-only, Safelite, or window-tint demand with no qualifying\n" +
          "collision/body context."
      },
      {
        id: "POL-COSMETIC-ONLY-NEGATIVE",
        title: "Cosmetic-only and small-incident service",
        instruction:
          "Always-win for fender-bender and the same class of minor-incident slang, even when\n" +
          "`accident`, `repair`, body-shop, or geo wording is present: `fender bender`,\n" +
          "`fender-bender`, `fenderbender`, `fender bender repair`, `fender bender near me`.\n" +
          "That idiom is a small parking-lot job, not collision demand. `rear end collision`\n" +
          "is not a fender bender and stays KEEP under `POL-COLLISION-KEEP`.\n\n" +
          "Dent, ding, scratch, and bumper-scuff follow a different test than paint:\n\n" +
          "- Negative when that cosmetic job is the ask: `dent repair`, `dent repair near me`,\n" +
          "  `fix a dent`, `paintless dent repair`, `pdr`, `dent specialist`, `door ding`,\n" +
          "  `ding repair`, `scratch repair`, `keyed car`, `bumper scuff`. `accident` alone\n" +
          "  does not save these. `auto body specialists` is not this rule.\n" +
          "- KEEP when `collision`, `crash`, `wreck`, or `totaled` is present and dent/ding/\n" +
          "  scratch is only damage description, not the whole job\n" +
          "  (`major collision with frame damage and dents`).\n" +
          "- PDR / paintless dent is negative even with collision wording; the searcher wants\n" +
          "  PDR, not a collision repair.\n\n" +
          "Also negative detailing, buffing, or clear-coat demand when the full query is clearly\n" +
          "cosmetic and has no `collision`, `crash`, `wreck`, or `totaled` signal.\n" +
          "Paint, color, and repaint use `POL-PAINT-COLOR-NEGATIVE`, which always wins.\n\n" +
          "Always-win for hole-fill and the same class of small cheap body jobs, even when\n" +
          "body-shop, collision, or geo wording is present: `fill holes`, `fill hole`,\n" +
          "`filling holes`, `fill holes in car body`, `holes in car body`, `hole in car body`,\n" +
          "`patch holes`, `patch a hole`, `rust hole`, `rust holes`. Do not fire on `pothole`\n" +
          "or `potholes`. This is a DIY/small-job ask, not collision-body demand."
      },
      {
        id: "POL-3J-WINDSHIELD-KEEP",
        title: "3J approved windshield services",
        instruction:
          "KEEP clear demand for windshield repair or windshield replacement. " +
          "3J Collision Center offers windshield repair and replacement as an approved service, " +
          "so windshield demand is valid demand for this account even when the query has no " +
          "collision or body-shop wording. Independent negative evidence still applies: a query " +
          "that is also price-shopping, DIY, or otherwise negative under another rule stays negative."
      },
      {
        id: "POL-3J-FRAME-REPAIR-KEEP",
        title: "3J approved frame repair services",
        instruction:
          "KEEP clear demand for frame repair or frame straightening. " +
          "3J Collision Center offers frame repair and frame straightening as approved services, " +
          "so frame demand is valid demand for this account even when the query names the part " +
          "without collision or body-shop wording. Independent negative evidence still applies."
      },
      {
        id: "POL-3J-MOTORCYCLE-NEGATIVE",
        title: "3J does not service motorcycles",
        instruction:
          "NEGATIVE any query seeking motorcycle, motorbike, or scooter body, paint, or collision " +
          "repair. 3J Collision Center does not service two-wheeled vehicles, so this demand can " +
          "never convert for this account."
      }
    ],
    phraseProtectionsFile: "src/config/accounts/8500809656/phrase-protections.md"
  }
};

/**
 * The first three 3J rules are the reviewed standard collision-shop dynamic
 * rules. They were moved out of the agency-wide document so approved services
 * can vary per company; every completed company therefore needs its own copy.
 */
function standardCollisionDynamicRules(): AccountRuleDefinition[] {
  const threeJ = ACCOUNT_POLICIES["8500809656"];
  if (!threeJ) throw new Error("The 3J seed policy is required.");
  return threeJ.customRules.slice(0, 3).map((rule) => ({ ...rule }));
}

const STANDARD_COMPLETED_ACCOUNT_POLICIES: Record<string, Omit<AccountPolicySeedConfig, "customRules">> = {
  "8402372674": {
    policyKey: "akins-collision-center",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/8402372674/phrase-protections.md"
  },
  "2305040084": {
    policyKey: "anderson-auto-body",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/2305040084/phrase-protections.md"
  },
  "9459997727": {
    policyKey: "arrow-body-services",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/9459997727/phrase-protections.md"
  },
  "6304919700": {
    policyKey: "art-city-auto-body-orem",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/6304919700/phrase-protections.md"
  },
  "1130534333": {
    policyKey: "capital-collision",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/1130534333/phrase-protections.md"
  },
  "8820051592": {
    policyKey: "carstar-santa-maria",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/8820051592/phrase-protections.md"
  },
  "3666014313": {
    policyKey: "art-city-auto-body-dg-enterprise",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/3666014313/phrase-protections.md"
  },
  "7990574090": {
    policyKey: "electrified-collision",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/7990574090/phrase-protections.md"
  },
  "6592667815": {
    policyKey: "frankie-ms-auto-body",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/6592667815/phrase-protections.md"
  },
  "8791302016": {
    policyKey: "lg-auto-body-rockville",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/8791302016/phrase-protections.md"
  },
  "7289311819": {
    policyKey: "pit-stop-auto-collision",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/7289311819/phrase-protections.md"
  },
  "1618289856": {
    policyKey: "sonoma-auto-center",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/1618289856/phrase-protections.md"
  },
  "3419276158": {
    policyKey: "tellos-collision-center",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/3419276158/phrase-protections.md"
  },
  "4007102747": {
    policyKey: "tri-state-auto-body",
    revision: "2026-09-23.1",
    phraseProtectionsFile: "src/config/accounts/4007102747/phrase-protections.md"
  }
};

for (const [customerId, policy] of Object.entries(STANDARD_COMPLETED_ACCOUNT_POLICIES)) {
  const customRules = standardCollisionDynamicRules();
  if (customerId === "1130534333") {
    customRules.push({
      id: "POL-CAPITAL-OWN-BRANDS-KEEP",
      title: "Capital Collision approved brand names",
      instruction:
        "KEEP service-seeking queries for Capital Collision and its approved location brands: " +
        "Capital Collision, Riverside Collision Center, and Woodcrest Collision Center. " +
        "These are this account's own brands, not competitors. Independent negative evidence " +
        "such as careers, DIY, towing-only, price-shopping, or reviews still applies."
    });
  }
  ACCOUNT_POLICIES[customerId] = { ...policy, customRules };
}
