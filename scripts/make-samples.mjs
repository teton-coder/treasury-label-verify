/**
 * Generates the sample label set in public/samples/.
 * Each label deliberately exercises a different rule so reviewers can see
 * pass / fail / review outcomes without sourcing their own images.
 *
 *   node scripts/make-samples.mjs
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "public/samples";
mkdirSync(OUT, { recursive: true });

const W1 = "(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.";
const W2 = "(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(text, max) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function label(o) {
  const w = 900;
  const h = 1200;
  const header = o.header ?? "GOVERNMENT WARNING:";
  const headerWeight = o.boldHeader === false ? 400 : 800;
  const body = `${o.w1 ?? W1} ${o.w2 ?? W2}`;
  const lines = wrap(body, 62);
  const warnY = 930;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${o.bg}"/>
  <rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="${o.fg}" stroke-width="4"/>
  <text x="450" y="170" font-family="Georgia, serif" font-size="${o.brandSize ?? 72}" font-weight="700" fill="${o.fg}" text-anchor="middle">${esc(o.brand)}</text>
  <text x="450" y="260" font-family="Georgia, serif" font-size="30" fill="${o.fg}" text-anchor="middle" font-style="italic">${esc(o.tagline ?? "")}</text>
  <circle cx="450" cy="420" r="110" fill="none" stroke="${o.fg}" stroke-width="3"/>
  <text x="450" y="440" font-family="Georgia, serif" font-size="54" fill="${o.fg}" text-anchor="middle">${esc(o.mark ?? "★")}</text>
  <text x="450" y="600" font-family="Georgia, serif" font-size="40" font-weight="700" fill="${o.fg}" text-anchor="middle">${esc(o.classType)}</text>
  ${o.abv ? `<text x="450" y="670" font-family="Helvetica, Arial" font-size="34" fill="${o.fg}" text-anchor="middle">${esc(o.abv)}</text>` : ""}
  <text x="450" y="730" font-family="Helvetica, Arial" font-size="34" fill="${o.fg}" text-anchor="middle">${esc(o.net)}</text>
  <text x="450" y="800" font-family="Helvetica, Arial" font-size="24" fill="${o.fg}" text-anchor="middle">${esc(o.producer)}</text>
  ${o.country ? `<text x="450" y="840" font-family="Helvetica, Arial" font-size="24" fill="${o.fg}" text-anchor="middle">${esc(o.country)}</text>` : ""}
  ${
    o.noWarning
      ? ""
      : `<text x="70" y="${warnY}" font-family="Helvetica, Arial" font-size="22" fill="${o.fg}"><tspan font-weight="${headerWeight}">${esc(header)}</tspan></text>
  ${lines.map((l, i) => `<text x="70" y="${warnY + 32 * (i + 1)}" font-family="Helvetica, Arial" font-size="22" fill="${o.fg}">${esc(l)}</text>`).join("\n  ")}`
  }
</svg>`;
}

const samples = [
  {
    file: "01-old-tom-bourbon-compliant.png",
    note: "Fully compliant. Application brand is title case; label is all caps (should still pass).",
    svg: { bg: "#f4ead5", fg: "#3b2410", brand: "OLD TOM DISTILLERY", tagline: "Est. 1887 · Bardstown", classType: "Kentucky Straight Bourbon Whiskey", abv: "45% Alc./Vol. (90 Proof)", net: "750 mL", producer: "Distilled & Bottled by Old Tom Distillery Co., Bardstown, KY", mark: "OT", brandSize: 58 },
    application: { brand_name: "Old Tom Distillery", class_type: "Kentucky Straight Bourbon Whiskey", alcohol_content: "45% Alc./Vol. (90 Proof)", net_contents: "750 mL", producer_name: "Old Tom Distillery Co." },
  },
  {
    file: "02-stones-throw-titlecase-warning.png",
    note: "Warning header in title case ('Government Warning:'). Should fail.",
    svg: { bg: "#e9f0f5", fg: "#10283b", brand: "STONE'S THROW", tagline: "Small Batch", classType: "Straight Rye Whiskey", abv: "50% Alc./Vol. (100 Proof)", net: "750 mL", producer: "Bottled by Stone's Throw Spirits, Denver, CO", header: "Government Warning:", mark: "ST" },
    application: { brand_name: "Stone's Throw", class_type: "Straight Rye Whiskey", alcohol_content: "50%", net_contents: "750 mL", producer_name: "Stone's Throw Spirits" },
  },
  {
    file: "03-harbor-light-abv-mismatch.png",
    note: "Label says 40% but application says 43%. Should fail on alcohol content.",
    svg: { bg: "#fdfaf3", fg: "#1d3557", brand: "HARBOR LIGHT", tagline: "Coastal Dry Gin", classType: "London Dry Gin", abv: "40% Alc./Vol. (80 Proof)", net: "1 L", producer: "Harbor Light Distilling, Portland, ME", mark: "⚓" },
    application: { brand_name: "Harbor Light", class_type: "London Dry Gin", alcohol_content: "43%", net_contents: "1 L", producer_name: "Harbor Light Distilling" },
  },
  {
    file: "04-copper-kettle-altered-warning.png",
    note: "Warning wording altered ('may cause health problems' changed). Should fail with a word diff.",
    svg: { bg: "#f7efe6", fg: "#5a2d0c", brand: "COPPER KETTLE", tagline: "Hazy IPA", classType: "India Pale Ale", abv: "6.8% Alc./Vol.", net: "12 FL. OZ.", producer: "Brewed & Canned by Copper Kettle Brewing, Bend, OR", w2: "(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may be harmful.", mark: "CK" },
    application: { brand_name: "Copper Kettle", class_type: "India Pale Ale", alcohol_content: "6.8%", net_contents: "355 mL", producer_name: "Copper Kettle Brewing" },
  },
  {
    file: "05-chateau-verre-import.png",
    note: "Imported wine with country of origin; application net contents in a different format. Should pass.",
    svg: { bg: "#f3f0f7", fg: "#3a1d4d", brand: "CHÂTEAU VERRE", tagline: "Bordeaux Supérieur 2021", classType: "Red Bordeaux Wine", abv: "13.5% Alc./Vol.", net: "750 ML", producer: "Imported by Verre Imports LLC, New York, NY", country: "Product of France", mark: "CV", brandSize: 64 },
    application: { brand_name: "Chateau Verre", class_type: "Red Bordeaux Wine", alcohol_content: "13.5%", net_contents: "750 mL", producer_name: "Verre Imports LLC", country_of_origin: "France" },
  },
  {
    file: "06-desert-bloom-photo-angle.jpg",
    note: "Photographed at an angle with glare and blur, warning header not bold. Tests image handling.",
    svg: { bg: "#fff4e6", fg: "#6b2d00", brand: "DESERT BLOOM", tagline: "Blanco", classType: "Tequila Blanco", abv: "40% Alc./Vol. (80 Proof)", net: "750 mL", producer: "Imported by Desert Bloom Spirits, Phoenix, AZ", country: "Product of Mexico", boldHeader: false, mark: "DB" },
    application: { brand_name: "Desert Bloom", class_type: "Tequila Blanco", alcohol_content: "40%", net_contents: "750 mL", producer_name: "Desert Bloom Spirits", country_of_origin: "Mexico" },
    photo: true,
  },
];

for (const s of samples) {
  let img = sharp(Buffer.from(label(s.svg)));
  if (s.photo) {
    // Simulate a hand-held photo: rotate, blur slightly, add glare.
    const base = await img.png().toBuffer();
    const glare = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><defs><radialGradient id="g" cx="0.7" cy="0.25" r="0.35"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="900" height="1200" fill="url(#g)"/></svg>`,
    );
    const lit = await sharp(base).composite([{ input: glare }]).blur(0.8).png().toBuffer();
    img = sharp(lit).rotate(-7, { background: "#5c5147" }).modulate({ brightness: 0.92 }).jpeg({ quality: 78 });
  } else {
    img = img.png();
  }
  await img.toFile(`${OUT}/${s.file}`);
}

writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify(samples.map(({ file, note, application }) => ({ file, note, application })), null, 2),
);

const cols = ["filename", "brand_name", "class_type", "alcohol_content", "net_contents", "producer_name", "country_of_origin"];
const q = (v) => (v && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? "");
writeFileSync(
  `${OUT}/applications.csv`,
  [cols.join(","), ...samples.map((s) => [s.file, ...cols.slice(1).map((c) => s.application[c])].map(q).join(","))].join("\n") + "\n",
);
console.log(`Wrote ${samples.length} samples to ${OUT}`);
