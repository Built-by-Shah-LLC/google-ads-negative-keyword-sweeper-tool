import type { RecoveryScore } from "./contract.js";
export interface Fraction {
  n: bigint;
  d: bigint;
}
export function fraction(value: string): Fraction {
  if (!/^[0-9]{1,30}(?:\.[0-9]{1,12})?$/.test(value)) throw new Error("Invalid non-negative decimal.");
  const [whole, decimals = ""] = value.split(".");
  return {
    n: BigInt(whole! + decimals),
    d: 10n ** BigInt(decimals.length)
  };
}
const gcd = (a: bigint, b: bigint): bigint => {
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
};
export const add = (a: Fraction, b: Fraction): Fraction => {
  const common = gcd(a.d, b.d);
  return {
    n: a.n * (b.d / common) + b.n * (a.d / common),
    d: a.d * (b.d / common)
  };
};
const multiply = (a: Fraction, b: Fraction): Fraction => ({
  n: a.n * b.n,
  d: a.d * b.d
});
export function divide(a: Fraction, b: Fraction): Fraction | null {
  return b.n === 0n ? null : {
    n: a.n * b.d,
    d: a.d * b.n
  };
}
export function decimal(value: Fraction, places = 6): string {
  const scale = 10n ** BigInt(places);
  const rounded = (value.n * scale * 2n / value.d + 1n) / 2n;
  const digits = rounded.toString().padStart(places + 1, "0");
  return places ? (digits.slice(0, -places) + "." + digits.slice(-places)).replace(/\.?0+$/, "") || "0" : digits;
}
const ratio = (a: string, b: string): Fraction => {
  const value = divide(fraction(a), fraction(b));
  return value === null ? {
    n: 0n,
    d: 1n
  } : value.n > value.d ? {
    n: 1n,
    d: 1n
  } : value;
};
export const sumDecimals = (values: string[]) => decimal(values.reduce((total, value) => add(total, fraction(value)), {
  n: 0n,
  d: 1n
}), 12);
export function recoveryScore(input: {
  qualityEvents: string | null;
  conversions: string | null;
  clicks: string | null;
  cost: string | null;
  targetCpa: string | null;
  conversionValue?: string | null;
  targetRoas?: string | null;
  valueBased?: boolean;
  recent: boolean;
  completedConversionWeeks: number;
}): RecoveryScore {
  const unavailable: string[] = [];
  const roas = input.conversionValue != null && input.cost !== null ? divide(fraction(input.conversionValue), fraction(input.cost)) : null;
  const valueRatio = roas && input.targetRoas != null && fraction(input.targetRoas).n > 0n ? divide(roas, fraction(input.targetRoas)) : null;
  const cappedValue = valueRatio && valueRatio.n > valueRatio.d ? fraction("1") : valueRatio;
  const quality = input.valueBased ? multiply(fraction("40"), cappedValue ?? fraction("0")) : input.qualityEvents === null ? {
    n: 0n,
    d: 1n
  } : multiply(fraction("40"), ratio(input.qualityEvents, "4"));
  if (input.valueBased ? !cappedValue : input.qualityEvents === null) unavailable.push("quality");
  const cpa = input.cost !== null && input.conversions !== null ? divide(fraction(input.cost), fraction(input.conversions)) : null;
  const efficiencyRatio = input.valueBased ? cappedValue : cpa && cpa.n > 0n && input.targetCpa !== null && fraction(input.targetCpa).n > 0n ? divide(fraction(input.targetCpa), cpa) : null;
  const efficiency = efficiencyRatio ? multiply(fraction("25"), efficiencyRatio.n > efficiencyRatio.d ? fraction("1") : efficiencyRatio) : fraction("0");
  if (!efficiencyRatio) unavailable.push("efficiency");
  const proof = input.conversions === null || input.clicks === null ? {
    n: 0n,
    d: 1n
  } : multiply(multiply(fraction("15"), ratio(input.conversions, "4")), ratio(input.clicks, "30"));
  if (input.conversions === null || input.clicks === null) unavailable.push("proof");
  const demand = input.clicks === null ? {
    n: 0n,
    d: 1n
  } : multiply(fraction("10"), ratio(input.clicks, "50"));
  if (input.clicks === null) unavailable.push("demand");
  const recency = add(fraction(input.recent ? "5" : "0"), multiply(fraction("5"), ratio(String(input.completedConversionWeeks), "3")));
  const total = [quality, efficiency, proof, demand, recency].reduce(add, {
    n: 0n,
    d: 1n
  });
  return {
    quality: decimal(quality, 2),
    efficiency: decimal(efficiency, 2),
    proof: decimal(proof, 2),
    demand: decimal(demand, 2),
    recency: decimal(recency, 2),
    total: decimal(total, 2),
    unavailable
  };
}
export const normalizeRecoveryText = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
export function negativeMatches(text: string, query: string, matchType: "EXACT" | "PHRASE" | "BROAD"): boolean | null {
  const negative = normalizeRecoveryText(text),
    search = normalizeRecoveryText(query);
  if (!negative || !search) return null;
  // shortcut: uncertain punctuation/spelling is review-only; expand only with verified Ads matching examples.
  if (!/^[\p{L}\p{N} ]+$/u.test(negative) || !/^[\p{L}\p{N} ]+$/u.test(search)) return negative === search ? true : null;
  if (matchType === "EXACT") return negative === search;
  if (matchType === "PHRASE") return (" " + search + " ").includes(" " + negative + " ");
  const remaining = search.split(" ");
  return negative.split(" ").every(word => {
    const index = remaining.indexOf(word);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}
export function recoveryDates(timeZone: string, now: Date): {
  startDate: string;
  endDate: string;
  today: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (kind: string) => parts.find(part => part.type === kind)!.value;
  const today = value("year") + "-" + value("month") + "-" + value("day");
  const offset = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const endDate = offset(today, -2);
  return {
    today,
    endDate,
    startDate: offset(endDate, -89)
  };
}
export function monday(date: string): string {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
