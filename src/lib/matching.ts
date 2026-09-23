/**
 * Pure text-matching helpers. No I/O, fully unit-tested.
 */

/** Normalize typographic quotes/dashes and collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-, punctuation- and whitespace-insensitive key. "STONE'S THROW" == "Stone's Throw". */
export function looseKey(s: string): string {
  return normalizeText(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // CHÂTEAU == Chateau
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MatchLevel = "exact" | "equivalent" | "similar" | "different";

/**
 * Compare a label value to an application value the way a reviewer would.
 * - exact: identical after whitespace/quote normalization
 * - equivalent: differs only in case or punctuation (Dave's STONE'S THROW case)
 * - similar: small spelling differences (likely OCR or a typo) -> human review
 * - different: a real mismatch
 */
export function compareValues(label: string, application: string): MatchLevel {
  const a = normalizeText(label);
  const b = normalizeText(application);
  if (a === b) return "exact";
  const ka = looseKey(a);
  const kb = looseKey(b);
  if (ka === kb) return "equivalent";
  if (diceSimilarity(ka, kb) >= 0.85) return "similar";
  return "different";
}

/** Dice coefficient on character bigrams (multiset). 0..1 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

/** Parse ABV and proof out of strings like "45% Alc./Vol. (90 Proof)". */
export function parseAlcohol(s: string): { abv: number | null; proof: number | null } {
  const abvMatch = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  const proofMatch = s.match(/(\d{1,3}(?:\.\d+)?)\s*(?:°\s*)?proof/i);
  return {
    abv: abvMatch ? parseFloat(abvMatch[1]) : null,
    proof: proofMatch ? parseFloat(proofMatch[1]) : null,
  };
}

const UNIT_TO_ML: Array<[RegExp, number]> = [
  [/^(ml|milliliters?|millilitres?)$/, 1],
  [/^(cl|centiliters?|centilitres?)$/, 10],
  [/^(l|liters?|litres?|ltr)$/, 1000],
  [/^(fl\.? ?oz\.?|fluid ounces?|oz\.?|ounces?)$/, 29.5735],
  [/^(pt|pints?)$/, 473.176],
  [/^(qt|quarts?)$/, 946.353],
  [/^(gal|gallons?)$/, 3785.41],
];

/** Parse net contents to millilitres. "750 mL" -> 750, "12 FL. OZ." -> 354.9 */
export function parseNetContentsMl(s: string): number | null {
  const m = normalizeText(s)
    .toLowerCase()
    .match(/(\d+(?:[.,]\d+)?)\s*([a-z. ]+?)(?:\s*\(|$|\s*\/|\s*,)/);
  if (!m) return null;
  const qty = parseFloat(m[1].replace(",", "."));
  const unit = m[2].trim().replace(/\.$/, "");
  for (const [re, factor] of UNIT_TO_ML) {
    if (re.test(unit)) return qty * factor;
  }
  return null;
}

export interface WordDiffToken {
  text: string;
  kind: "same" | "missing" | "extra";
}

/**
 * Word-level diff (LCS) between required text and found text.
 * "missing" = in required but not on label; "extra" = on label but not required.
 */
export function wordDiff(required: string, found: string): WordDiffToken[] {
  const a = normalizeText(required).split(" ");
  const b = normalizeText(found).split(" ");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: WordDiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ text: a[i], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ text: a[i++], kind: "missing" });
    } else {
      out.push({ text: b[j++], kind: "extra" });
    }
  }
  while (i < n) out.push({ text: a[i++], kind: "missing" });
  while (j < m) out.push({ text: b[j++], kind: "extra" });
  return out;
}
