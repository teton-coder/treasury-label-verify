import type {
  ApplicationData,
  CheckStatus,
  ExtractedLabelFields,
  FieldVerification,
  OverallStatus,
} from "./types";
import { GOVERNMENT_WARNING_HEADER, GOVERNMENT_WARNING_TEXT } from "./constants";
import {
  compareValues,
  looseKey,
  normalizeText,
  parseAlcohol,
  parseNetContentsMl,
  wordDiff,
} from "./matching";

/**
 * Deterministic rules engine. Takes what the AI read off the label (and,
 * optionally, what the applicant claimed on the COLA application) and
 * returns an explainable pass / fail / needs-review decision per field.
 */
export function verifyLabel(
  extracted: ExtractedLabelFields,
  app: ApplicationData = {},
): { overall_status: OverallStatus; fields: FieldVerification[]; summary: string } {
  const fields: FieldVerification[] = [
    checkTextField("brand_name", "Brand name", extracted.brand_name, app.brand_name, "fail"),
    checkClassType(extracted.class_type, app.class_type),
    checkAlcohol(extracted, app.alcohol_content),
    checkNetContents(extracted.net_contents, app.net_contents),
    checkProducer(extracted, app.producer_name),
    checkCountry(extracted.country_of_origin, app),
    checkWarningText(extracted.government_warning),
    checkWarningBold(extracted),
    checkImageQuality(extracted),
  ];

  const overall_status: OverallStatus = fields.some((f) => f.status === "fail")
    ? "fail"
    : fields.some((f) => f.status === "review")
      ? "review"
      : "pass";

  return { overall_status, fields, summary: summarize(overall_status, fields) };
}

function summarize(status: OverallStatus, fields: FieldVerification[]): string {
  const names = (s: CheckStatus) =>
    fields
      .filter((f) => f.status === s)
      .map((f) => f.label.toLowerCase())
      .join(", ");
  if (status === "pass") return "All checks passed.";
  if (status === "fail") return `Problem found: ${names("fail")}.`;
  return `Needs a closer look: ${names("review")}.`;
}

const result = (
  field: string,
  label: string,
  status: CheckStatus,
  extracted: string | null,
  message: string,
  expected?: string,
): FieldVerification => ({ field, label, status, extracted, message, ...(expected ? { expected } : {}) });

/** Generic "present on label, and matches the application if given" check. */
export function checkTextField(
  field: string,
  label: string,
  onLabel: string | null,
  onApp: string | undefined,
  missingStatus: CheckStatus,
): FieldVerification {
  const expected = onApp?.trim() || undefined;
  if (!onLabel) {
    return result(field, label, missingStatus, null, `${label} could not be found on the label.`, expected);
  }
  if (!expected) {
    return result(field, label, "pass", onLabel, `${label} is present.`);
  }
  switch (compareValues(onLabel, expected)) {
    case "exact":
      return result(field, label, "pass", onLabel, "Matches the application.", expected);
    case "equivalent":
      return result(
        field,
        label,
        "pass",
        onLabel,
        "Matches the application (differs only in capitalization or punctuation).",
        expected,
      );
    case "similar":
      return result(
        field,
        label,
        "review",
        onLabel,
        "Almost matches the application. Could be a typo on the label or a misread. Please check.",
        expected,
      );
    default:
      return result(field, label, "fail", onLabel, "Does not match the application.", expected);
  }
}

/**
 * Class/type must match the application. If the label reading contains the application's
 * designation plus extra words (often a tagline read together with it), a person decides.
 */
export function checkClassType(onLabel: string | null, onApp?: string): FieldVerification {
  const r = checkTextField("class_type", "Class / type", onLabel, onApp, "fail");
  if (r.status !== "fail" || !onLabel || !onApp?.trim()) return r;
  const l = ` ${looseKey(onLabel)} `;
  const a = looseKey(onApp);
  if (a && l.includes(` ${a} `)) {
    return {
      ...r,
      status: "review",
      message: `The application's designation "${onApp.trim()}" appears on the label alongside other words. Please confirm the class/type is shown correctly.`,
    };
  }
  return r;
}

export function checkAlcohol(ex: ExtractedLabelFields, onApp?: string): FieldVerification {
  const F = "alcohol_content";
  const L = "Alcohol content";
  const expected = onApp?.trim() || undefined;
  const text = ex.alcohol_content;

  if (!text) {
    // Required on spirits; beer and some wines may omit it (27 CFR 7.63, 4.36).
    const strict = ex.beverage_category === "spirits";
    return result(
      F,
      L,
      strict ? "fail" : "review",
      null,
      strict
        ? "Alcohol content is required on distilled spirits but was not found."
        : "Alcohol content was not found. It is optional for some beers and wines. Please confirm.",
      expected,
    );
  }

  const { abv, proof } = parseAlcohol(text);
  if (abv === null) {
    return result(F, L, "review", text, "Could not read a percentage from the alcohol statement.", expected);
  }
  if (abv <= 0 || abv > 95) {
    return result(F, L, "fail", text, `An alcohol content of ${abv}% is not plausible.`, expected);
  }
  if (proof !== null && Math.abs(proof - abv * 2) > 0.5) {
    return result(
      F,
      L,
      "fail",
      text,
      `Proof (${proof}) is inconsistent with ${abv}% ABV. Proof should be ${abv * 2}.`,
      expected,
    );
  }
  if (expected) {
    const appAbv = parseAlcohol(expected).abv;
    if (appAbv === null) {
      return result(F, L, "review", text, "Could not read a percentage from the application value.", expected);
    }
    if (Math.abs(appAbv - abv) > 0.05) {
      return result(F, L, "fail", text, `Label says ${abv}% but the application says ${appAbv}%.`, expected);
    }
    return result(F, L, "pass", text, `Matches the application (${abv}%).`, expected);
  }
  return result(F, L, "pass", text, `Alcohol content is present (${abv}%).`);
}

export function checkNetContents(onLabel: string | null, onApp?: string): FieldVerification {
  const F = "net_contents";
  const L = "Net contents";
  const expected = onApp?.trim() || undefined;
  if (!onLabel) return result(F, L, "fail", null, "Net contents could not be found on the label.", expected);

  const labelMl = parseNetContentsMl(onLabel);
  if (labelMl === null) {
    return result(F, L, "review", onLabel, "Net contents found, but the unit of measure was not recognized.", expected);
  }
  if (!expected) return result(F, L, "pass", onLabel, "Net contents are present.");

  const appMl = parseNetContentsMl(expected);
  if (appMl === null) {
    return result(F, L, "review", onLabel, "Could not read a unit from the application value.", expected);
  }
  // Allow rounding between metric and U.S. units (e.g. 12 fl oz = 355 mL).
  if (Math.abs(labelMl - appMl) / appMl <= 0.01) {
    return result(F, L, "pass", onLabel, "Matches the application.", expected);
  }
  return result(F, L, "fail", onLabel, "Does not match the application.", expected);
}

export function checkProducer(ex: ExtractedLabelFields, onApp?: string): FieldVerification {
  const F = "producer";
  const L = "Bottler / producer";
  const shown = [ex.producer_name, ex.producer_address].filter(Boolean).join(", ") || null;
  if (!ex.producer_name && !ex.producer_address) {
    return result(F, L, "fail", null, "Name and address of the bottler or producer could not be found.", onApp);
  }
  if (!ex.producer_address) {
    return result(F, L, "review", shown, "A name was found but no city/state. Please confirm the address is on the label.", onApp);
  }
  if (onApp?.trim() && ex.producer_name) {
    // "Distilled & Bottled by Old Tom Distillery Co., Bardstown, KY" -> "Old Tom Distillery Co."
    const onLabel = stripRolePhrase(ex.producer_name).split(",")[0].trim();
    const r = checkTextField(F, L, onLabel, stripRolePhrase(onApp), "fail");
    if (r.status !== "pass" && isSubstantialNameMatch(onLabel, onApp)) {
      return result(F, L, "pass", shown, "Matches the application.", onApp.trim());
    }
    return { ...r, extracted: shown, expected: onApp.trim() };
  }
  return result(F, L, "pass", shown, "Name and address are present.");
}

/**
 * Whole-word match where the application name is a substantial part of the label name
 * ("Old Tom Distillery" vs "Old Tom Distillery Co."). Requires at least two words and
 * 60% of the label's words, so "Co." or "Sky" never match "Big Sky Distilling".
 */
export function isSubstantialNameMatch(labelName: string, appName: string): boolean {
  const a = looseKey(stripRolePhrase(appName)).split(" ").filter(Boolean);
  const l = looseKey(labelName).split(" ").filter(Boolean);
  if (a.length < 2 || l.length === 0 || a.length / l.length < 0.6) return false;
  return ` ${l.join(" ")} `.includes(` ${a.join(" ")} `);
}

/** Remove leading role statements like "Distilled & Bottled by" / "Imported by". */
export function stripRolePhrase(s: string): string {
  return s
    .replace(
      /^\s*(?:(?:distilled|bottled|produced|imported|brewed|canned|packed|blended|made|vinted|cellared|manufactured|and|&|,)\s*)+\s*(?:by|for)\s*:?\s*/i,
      "",
    )
    .trim();
}

export function checkCountry(onLabel: string | null, app: ApplicationData): FieldVerification {
  const F = "country_of_origin";
  const L = "Country of origin";
  const isImport = app.is_import === true || !!app.country_of_origin?.trim();
  if (!isImport) {
    return onLabel
      ? result(F, L, "info", onLabel, "Country of origin is shown.")
      : result(F, L, "info", null, "Not shown. Only required for imported products.");
  }
  if (!onLabel) {
    return result(F, L, "fail", null, "This is an import, but no country of origin was found.", app.country_of_origin);
  }
  if (app.country_of_origin?.trim()) {
    // Labels usually say "Product of Scotland"; the application just says "Scotland".
    if (looseKey(onLabel).includes(looseKey(app.country_of_origin))) {
      return result(F, L, "pass", onLabel, "Matches the application.", app.country_of_origin);
    }
    return checkTextField(F, L, onLabel, app.country_of_origin, "fail");
  }
  return result(F, L, "pass", onLabel, "Country of origin is present.");
}

/**
 * The warning must match 27 CFR 16.21 word for word, with "GOVERNMENT WARNING:"
 * in capitals. Whitespace and line breaks are ignored (labels wrap text).
 */
export function checkWarningText(found: string | null): FieldVerification {
  const F = "government_warning";
  const L = "Government warning";
  const required = GOVERNMENT_WARNING_TEXT;
  if (!found) {
    return result(F, L, "fail", null, "The government health warning is missing.", required);
  }
  const text = normalizeText(found);

  // Header must be exactly "GOVERNMENT WARNING:" in capitals.
  if (!text.startsWith(GOVERNMENT_WARNING_HEADER)) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf("government warning");
    const detail =
      idx === -1
        ? 'The statement does not begin with "GOVERNMENT WARNING:".'
        : text.slice(idx, idx + 19) === GOVERNMENT_WARNING_HEADER
          ? `The statement must begin with "GOVERNMENT WARNING:", but other text comes before it ("${text.slice(0, idx).trim()}").`
          : `The header reads "${text.slice(idx, idx + 19)}". It must be "GOVERNMENT WARNING:" in all capital letters.`;
    return result(F, L, "fail", found, detail, required);
  }

  if (text === normalizeText(required)) {
    return result(F, L, "pass", found, "Word-for-word match with the required statement.");
  }

  // Word-level comparison ignoring case/punctuation: a changed or missing word is a real failure.
  const words = wordDiff(looseKey(required), looseKey(text));
  const changed = words.filter((w) => w.kind !== "same");
  if (changed.length > 0) {
    const missing = words.filter((w) => w.kind === "missing").map((w) => w.text);
    const extra = words.filter((w) => w.kind === "extra").map((w) => w.text);
    const parts = [
      missing.length ? `missing or changed: "${missing.join(" ")}"` : "",
      extra.length ? `not in the required text: "${extra.join(" ")}"` : "",
    ].filter(Boolean);
    return result(F, L, "fail", found, `Wording differs from the required statement (${parts.join("; ")}).`, required);
  }

  // Same words, but punctuation or capitalization differs (e.g. "1." instead of "(1)").
  // Could be a transcription misread, so a person decides.
  return result(
    F,
    L,
    "review",
    found,
    "Same words as required, but punctuation or capitalization differs. Please compare against the image.",
    required,
  );
}

export function checkWarningBold(ex: ExtractedLabelFields): FieldVerification {
  const F = "warning_bold";
  const L = "Warning header in bold";
  if (!ex.government_warning) {
    return result(F, L, "info", null, "No warning found, so bold type could not be checked.");
  }
  if (ex.warning_header_bold === true) {
    return result(F, L, "pass", "bold", '"GOVERNMENT WARNING" appears in bold type.');
  }
  if (ex.warning_header_bold === false) {
    return result(F, L, "fail", "not bold", '"GOVERNMENT WARNING" must be in bold type, but it does not appear to be.');
  }
  return result(F, L, "review", null, 'Could not tell whether "GOVERNMENT WARNING" is bold. Please check the image.');
}

export function checkImageQuality(ex: ExtractedLabelFields): FieldVerification {
  const F = "image_quality";
  const L = "Image quality";
  const issues = ex.readability_issues.join(", ");
  if (ex.image_quality === "poor") {
    return result(
      F,
      L,
      "review",
      ex.image_quality,
      `The image is hard to read${issues ? ` (${issues})` : ""}. Results may be less reliable; consider asking for a better image.`,
    );
  }
  return result(F, L, "info", ex.image_quality, issues ? `Readable, with notes: ${issues}.` : "Clear and readable.");
}
