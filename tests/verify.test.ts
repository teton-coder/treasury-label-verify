import { describe, expect, it } from "vitest";
import { compareValues, parseAlcohol, parseNetContentsMl, wordDiff } from "../src/lib/matching";
import {
  checkAlcohol,
  checkClassType,
  checkCountry,
  checkNetContents,
  checkProducer,
  checkTextField,
  checkWarningBold,
  checkWarningText,
  verifyLabel,
} from "../src/lib/verify-label";
import { isModelUnavailable, isTransientOverload, normalizeExtraction, reconcileBold, thinkingFor } from "../src/lib/extract-label";
import { parseApplicationCsv } from "../src/lib/csv";
import { GOVERNMENT_WARNING_TEXT } from "../src/lib/constants";
import type { ExtractedLabelFields } from "../src/lib/types";

const good: ExtractedLabelFields = {
  brand_name: "OLD TOM DISTILLERY",
  class_type: "Kentucky Straight Bourbon Whiskey",
  alcohol_content: "45% Alc./Vol. (90 Proof)",
  net_contents: "750 mL",
  producer_name: "Old Tom Distillery Co.",
  producer_address: "Bardstown, Kentucky",
  country_of_origin: null,
  government_warning: GOVERNMENT_WARNING_TEXT,
  warning_header_bold: true,
  image_quality: "good",
  readability_issues: [],
  beverage_category: "spirits",
};

describe("matching", () => {
  it("treats case/punctuation-only differences as equivalent (STONE'S THROW)", () => {
    expect(compareValues("STONE'S THROW", "Stone's Throw")).toBe("equivalent");
    expect(compareValues("STONE\u2019S THROW", "Stone's Throw")).toBe("equivalent");
    expect(compareValues("CHÂTEAU VERRE", "Chateau Verre")).toBe("equivalent");
  });
  it("flags near misses for review and real differences as different", () => {
    expect(compareValues("OLD TOM DISTILLERY", "OLD TOM DISTILERY")).toBe("similar");
    expect(compareValues("OLD TOM DISTILLERY", "Blue Ridge Spirits")).toBe("different");
  });
  it("parses ABV and proof", () => {
    expect(parseAlcohol("45% Alc./Vol. (90 Proof)")).toEqual({ abv: 45, proof: 90 });
    expect(parseAlcohol("ALC. 12.5% BY VOL.")).toEqual({ abv: 12.5, proof: null });
  });
  it("parses net contents across units", () => {
    expect(parseNetContentsMl("750 mL")).toBe(750);
    expect(parseNetContentsMl("1.75 L")).toBe(1750);
    expect(parseNetContentsMl("12 FL. OZ.")).toBeCloseTo(354.9, 0);
    expect(parseNetContentsMl("1 PINT 9.4 FL OZ")).toBeCloseTo(751.2, 0);
    expect(parseNetContentsMl("12 FL OZ (355 mL)")).toBeCloseTo(354.9, 0);
    expect(parseNetContentsMl("1,000 mL")).toBe(1000);
    expect(parseNetContentsMl("1,5 L")).toBe(1500);
    expect(parseNetContentsMl("seven fifty")).toBeNull();
  });
  it("parses European decimal commas in ABV", () => {
    expect(parseAlcohol("13,5% vol").abv).toBe(13.5);
  });
  it("produces a word diff", () => {
    const d = wordDiff("a b c", "a x c");
    expect(d.filter((t) => t.kind !== "same").map((t) => `${t.kind}:${t.text}`)).toEqual(["missing:b", "extra:x"]);
  });
});

describe("government warning", () => {
  it("passes the exact statement, ignoring line wraps", () => {
    expect(checkWarningText(GOVERNMENT_WARNING_TEXT.replace(/ /g, "\n")).status).toBe("pass");
  });
  it("fails title-case header (Jenny's example)", () => {
    const r = checkWarningText(GOVERNMENT_WARNING_TEXT.replace("GOVERNMENT WARNING:", "Government Warning:"));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/all capital letters/);
  });
  it("fails changed wording", () => {
    const r = checkWarningText(GOVERNMENT_WARNING_TEXT.replace("birth defects", "health issues"));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/birth defects/);
  });
  it("fails a dropped clause", () => {
    expect(checkWarningText(GOVERNMENT_WARNING_TEXT.split(" (2)")[0]).status).toBe("fail");
  });
  it("sends punctuation-only differences to review", () => {
    expect(checkWarningText(GOVERNMENT_WARNING_TEXT.replace("machinery,", "machinery")).status).toBe("review");
  });
  it("fails when missing", () => {
    expect(checkWarningText(null).status).toBe("fail");
  });
  it("checks bold header", () => {
    expect(checkWarningBold({ ...good, warning_header_bold: false }).status).toBe("fail");
    expect(checkWarningBold({ ...good, warning_header_bold: null }).status).toBe("review");
    expect(checkWarningBold(good).status).toBe("pass");
  });
});

describe("field checks", () => {
  it("brand equivalence passes, mismatch fails", () => {
    expect(checkTextField("b", "Brand", "STONE'S THROW", "Stone's Throw", "fail").status).toBe("pass");
    expect(checkTextField("b", "Brand", "STONE'S THROW", "River Bend", "fail").status).toBe("fail");
    expect(checkTextField("b", "Brand", null, undefined, "fail").status).toBe("fail");
  });
  it("alcohol: application mismatch and proof inconsistency fail", () => {
    expect(checkAlcohol(good, "40%").status).toBe("fail");
    expect(checkAlcohol(good, "45% ABV").status).toBe("pass");
    expect(checkAlcohol({ ...good, alcohol_content: "45% Alc./Vol. (80 Proof)" }).status).toBe("fail");
  });
  it("alcohol: missing is a failure for spirits, review for beer", () => {
    expect(checkAlcohol({ ...good, alcohol_content: null }).status).toBe("fail");
    expect(checkAlcohol({ ...good, alcohol_content: null, beverage_category: "beer" }).status).toBe("review");
  });
  it("net contents compares across units", () => {
    expect(checkNetContents("12 FL OZ", "355 mL").status).toBe("pass");
    expect(checkNetContents("750 mL", "1 L").status).toBe("fail");
  });
  it("country of origin required only for imports", () => {
    expect(checkCountry(null, {}).status).toBe("info");
    expect(checkCountry(null, { is_import: true }).status).toBe("fail");
    expect(checkCountry("Product of Scotland", { country_of_origin: "Scotland" }).status).toBe("pass");
    expect(checkCountry("Product of France", { country_of_origin: "Scotland" }).status).toBe("fail");
  });
});

describe("class / type", () => {
  it("sends extra surrounding words to review, not fail", () => {
    expect(checkClassType("Hazy IPA India Pale Ale", "India Pale Ale").status).toBe("review");
    expect(checkClassType("India Pale Ale", "India Pale Ale").status).toBe("pass");
    expect(checkClassType("Pale Lager", "India Pale Ale").status).toBe("fail");
  });
});

describe("producer", () => {
  it("ignores role phrases like 'Distilled & Bottled by' and 'Imported by'", () => {
    expect(checkProducer({ ...good, producer_name: "Distilled & Bottled by Old Tom Distillery Co." }, "Old Tom Distillery Co.").status).toBe("pass");
    expect(checkProducer({ ...good, producer_name: "Imported by Verre Imports LLC" }, "Verre Imports LLC").status).toBe("pass");
    expect(checkProducer({ ...good, producer_name: "Bottled by River Bend Co." }, "Old Tom Distillery Co.").status).toBe("fail");
    expect(checkProducer({ ...good, producer_name: "Imported by Verre Imports LLC, New York, NY" }, "Verre Imports LLC").status).toBe("pass");
    expect(checkProducer({ ...good, producer_name: "Old Tom Distillery Co." }, "Old Tom Distillery").status).toBe("pass");
  });
  it("does not pass short or partial producer names", () => {
    for (const [label, app] of [["Acme Spirits", "A"], ["Acme Spirits Co.", "Co."], ["Big Sky Distilling", "Sky"], ["Coca Cola", "Cola"], ["Stone's Throw Spirits", "Stone"]]) {
      expect(checkProducer({ ...good, producer_name: label }, app).status, `${label} vs ${app}`).not.toBe("pass");
    }
  });
});

describe("warning header position", () => {
  it("explains when text precedes a correct header", () => {
    const r = checkWarningText("Notice: " + GOVERNMENT_WARNING_TEXT);
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/must begin with/);
  });
});

describe("verifyLabel", () => {
  it("passes the sample label", () => {
    const v = verifyLabel(good, {
      brand_name: "Old Tom Distillery",
      alcohol_content: "45%",
      net_contents: "750 mL",
    });
    expect(v.overall_status).toBe("pass");
  });
  it("fails when any check fails", () => {
    expect(verifyLabel({ ...good, government_warning: null }).overall_status).toBe("fail");
  });
  it("needs review for poor images", () => {
    expect(verifyLabel({ ...good, image_quality: "poor", readability_issues: ["glare"] }).overall_status).toBe("review");
  });
});

describe("model selection", () => {
  it("recognizes Google capacity errors as transient", () => {
    expect(isTransientOverload('{"error":{"code":503,"status":"UNAVAILABLE"}}')).toBe(true);
    expect(isTransientOverload('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}')).toBe(false);
  });
  it("falls back only on genuine model-not-found errors", () => {
    expect(isModelUnavailable('{"error":{"code":404,"status":"NOT_FOUND"}}')).toBe(true);
    expect(isModelUnavailable("Unsupported MIME type: image/gif is not supported")).toBe(false);
    expect(isModelUnavailable("Thinking level is not available for this request")).toBe(false);
  });
  it("uses a thinking setting each model supports", () => {
    expect(thinkingFor("gemini-3.6-flash")).toEqual({ thinkingLevel: "MINIMAL" });
    expect(thinkingFor("gemini-3.8-flash")).toEqual({ thinkingLevel: "LOW" });
    expect(thinkingFor("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
  });
});

describe("bold second opinion", () => {
  it("keeps agreement and turns disagreement into 'cannot tell'", () => {
    expect(reconcileBold(true, "heavier_than_body")).toBe(true);
    expect(reconcileBold(false, "same_as_body")).toBe(false);
    expect(reconcileBold(true, "same_as_body")).toBeNull();
    expect(reconcileBold(false, "heavier_than_body")).toBeNull();
    expect(reconcileBold(true, "unclear")).toBeNull();
    expect(reconcileBold(true, null)).toBe(true);
  });
});

describe("bold header mapping", () => {
  it("maps stroke-weight comparison to bold true/false/unknown", () => {
    expect(normalizeExtraction({ warning_header_weight: "heavier_than_body" }).warning_header_bold).toBe(true);
    expect(normalizeExtraction({ warning_header_weight: "same_as_body" }).warning_header_bold).toBe(false);
    expect(normalizeExtraction({ warning_header_weight: "unclear" }).warning_header_bold).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  it("coerces bad model output safely", () => {
    const n = normalizeExtraction({ brand_name: " ", image_quality: "great", readability_issues: "x", warning_header_bold: "yes" });
    expect(n.brand_name).toBeNull();
    expect(n.image_quality).toBe("fair");
    expect(n.readability_issues).toEqual([]);
    expect(n.warning_header_bold).toBeNull();
  });
});

describe("batch CSV", () => {
  it("maps rows by filename with column aliases and quoted fields", () => {
    const csv = 'Filename,Brand,ABV,Net Contents\r\nold-tom.png,"OLD TOM, DISTILLERY",45%,750 mL\n';
    const { byFilename, warnings } = parseApplicationCsv(csv);
    expect(warnings).toEqual([]);
    expect(byFilename.get("old-tom.png")).toEqual({
      brand_name: "OLD TOM, DISTILLERY",
      alcohol_content: "45%",
      net_contents: "750 mL",
    });
  });
  it("requires a filename column", () => {
    expect(parseApplicationCsv("brand\nx").warnings[0]).toMatch(/filename/);
  });
});
