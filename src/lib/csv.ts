import type { ApplicationData } from "./types";

/**
 * Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF).
 * Used for batch uploads: one row per label, keyed by image filename.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const COLUMN_ALIASES: Record<string, keyof ApplicationData | "filename"> = {
  filename: "filename",
  file: "filename",
  image: "filename",
  brand_name: "brand_name",
  brand: "brand_name",
  class_type: "class_type",
  class: "class_type",
  type: "class_type",
  alcohol_content: "alcohol_content",
  abv: "alcohol_content",
  alcohol: "alcohol_content",
  net_contents: "net_contents",
  net: "net_contents",
  volume: "net_contents",
  producer_name: "producer_name",
  producer: "producer_name",
  bottler: "producer_name",
  producer_address: "producer_address",
  address: "producer_address",
  country_of_origin: "country_of_origin",
  country: "country_of_origin",
  is_import: "is_import",
  import: "is_import",
};

export interface ApplicationCsv {
  byFilename: Map<string, ApplicationData>;
  warnings: string[];
}

/** Turn a CSV (header row + one row per label) into a filename -> ApplicationData map. */
export function parseApplicationCsv(text: string): ApplicationCsv {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  const byFilename = new Map<string, ApplicationData>();
  if (rows.length === 0) return { byFilename, warnings: ["The CSV file is empty."] };

  const header = rows[0].map((h) => COLUMN_ALIASES[h.trim().toLowerCase().replace(/[\s/-]+/g, "_")]);
  const fileCol = header.indexOf("filename");
  if (fileCol === -1) {
    return { byFilename, warnings: ['The CSV needs a "filename" column that matches the image file names.'] };
  }

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[fileCol]?.trim();
    if (!name) {
      warnings.push(`Row ${r + 1} has no filename and was skipped.`);
      continue;
    }
    const data: ApplicationData = {};
    header.forEach((key, c) => {
      const v = cells[c]?.trim();
      if (!key || key === "filename" || !v) return;
      if (key === "is_import") data.is_import = /^(y|yes|true|1)$/i.test(v);
      else data[key] = v;
    });
    byFilename.set(name.toLowerCase(), data);
  }
  return { byFilename, warnings };
}
