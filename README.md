# Label Check: AI-Assisted Alcohol Label Verification (Prototype)

A web tool that reads an alcohol beverage label image, compares it with the COLA application data, and checks the TTB-mandated items: brand, class/type, alcohol content, net contents, bottler/producer, country of origin (imports), and the government health warning (exact wording, capitalized header, bold header).

- **Live prototype:** https://treasury-label-verify.vercel.app
- **Try it in 30 seconds:** open the link, click **"No label handy? Load a sample"**, then **Check label**. For batches, switch to **Check many labels** and click **Load the sample batch**.

---

## What it does

| Stakeholder need (from discovery notes) | How the prototype handles it |
|---|---|
| "Results back in about 5 seconds" (Sarah) | Single fast vision call per label (Gemini 3.6 Flash, minimal thinking, temperature 0, structured JSON output). Images are downscaled in the browser to about 2000px before upload. A hard 25 s timeout means an agent is never left hanging. The elapsed time is shown on every result. |
| "Something my 73-year-old mother could use" (Sarah) | Two big tabs: *Check one label* / *Check many labels*. Large type (18px+ body text), high-contrast colors, plain-English results ("Looks good", "Problem found", "Needs your review"), icons plus words (never color alone), keyboard and screen-reader friendly. Problems are listed first. |
| Batch uploads of 200–300 labels (Sarah, Janet) | Up to 300 images per batch. Application data comes from a CSV keyed by filename. Labels are checked 6 at a time, and each result appears as soon as it is ready. Rate-limited requests back off and retry automatically. Filter by outcome, retry failures with one click, and download results as CSV. Images with no CSV row, and CSV rows with no image, are flagged instead of silently passing. |
| "STONE'S THROW" vs "Stone's Throw" needs judgment (Dave) | Three-level matching: exact, **equivalent** (case, punctuation, or accents only, which passes), **similar** (small spelling differences, sent to a human), different (fails). Net contents compare by volume (12 FL OZ = 355 mL). Producer matching ignores role phrases ("Distilled & Bottled by"), and accents are ignored (CHÂTEAU = Chateau). |
| Warning must be exact, "GOVERNMENT WARNING:" in caps and bold (Jenny) | Word-for-word comparison against 27 CFR 16.21. A title-case header fails. A changed or missing word fails and shows a highlighted word diff. The bold header is checked separately. Differences only in punctuation or capitalization within the body (for example "1." instead of "(1)") go to human review, because they may be a misread. |
| Bad angles, glare, poor lighting (Jenny) | The model reads skewed or glare-affected photos and reports readability issues. A poor image produces "Needs your review" rather than a false pass or fail. |
| Firewall blocks many outbound domains (Marcus) | Only one outbound dependency: `generativelanguage.googleapis.com`, called **server-side**. The browser only talks to this app. Fonts are self-hosted at build time. See *Production path* below. |
| No sensitive data storage (Marcus) | Nothing is persisted. Images live in memory for the duration of the request. There is no database, no logging of image content, and nothing in cookies. |

## Approach

**The AI reads; rules decide.** The model is used only as an OCR/extraction step that returns a strict JSON schema. Every pass/fail decision is made by deterministic, unit-tested TypeScript rules (`src/lib/verify-label.ts`). This means:

- results are explainable (every check says *why*) and repeatable;
- the model can't "decide" a label is compliant or hallucinate the standard warning text, because the prompt requires verbatim transcription and the comparison happens in code;
- rules can be audited and changed by compliance staff without retraining anything.

Three outcomes, not two: **pass / fail / needs review**. Anything ambiguous (near-miss spellings, unreadable images, uncertain bold detection, punctuation-only warning differences) is routed to the agent instead of guessed. The tool is designed to take the routine matching off agents' plates, not to replace their judgment.

```
Browser                               Next.js API route (/api/verify)           Gemini 3.6 Flash
───────                               ──────────────────────────────           ────────────────
pick image(s) ─► downscale to ~2000px ─► validate type/size ─► extract ────────► structured JSON
              (6 in parallel for batch)                        │
                                                               ▼
                                         verify-label.ts rules (+ application data)
                                                               │
results UI ◄──────────────────────────── pass / fail / review per field + reasons
```

## Tools used

| Area | Choice | Why |
|---|---|---|
| App framework | Next.js 16 (App Router), React 19, TypeScript | One deployable unit for UI and API; types shared end to end |
| Styling | Tailwind CSS 4, lucide-react icons | Fast to build an accessible, consistent UI |
| AI | Google Gemini 3.6 Flash via `@google/genai` (automatic fallback to 3.5 Flash-Lite) | Current stable, fast, inexpensive multimodal model with native JSON-schema output; strong on printed text and imperfect photos |
| Tests | Vitest (26 tests on matching, rules, CSV, and output normalization) | The rules are the product; they must be tested |
| Hosting | Vercel | Zero-config Next.js hosting for a prototype |
| Sample data | `scripts/make-samples.mjs` (sharp and SVG) | Reproducible test labels, each exercising a specific rule |

## Setup and run locally

Requirements: Node.js 22.12+ and a Gemini API key (https://aistudio.google.com/apikey). The free tier works for single labels. Large batches need a key with billing enabled, because free-tier rate limits are about 10 requests per minute.

```bash
git clone https://github.com/teton-coder/treasury-label-verify.git
cd treasury-label-verify
npm install
cp .env.example .env.local        # then paste your key into GEMINI_API_KEY
npm run dev                        # http://localhost:3000
```

Other commands:

```bash
npm test               # unit tests
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm run build && npm start   # production build
node scripts/make-samples.mjs  # regenerate sample labels
```

Environment variables:

| Name | Required | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | – | `GOOGLE_API_KEY` is also accepted |
| `GEMINI_MODEL` | no | `gemini-3.6-flash` | Swap models without a code change. If the model is unavailable for the key, `gemini-3.5-flash-lite` is used automatically. |

If the key is missing, the app still loads and shows a clear banner instead of failing silently.

### API

`POST /api/verify` (multipart): `file` = image, `applicationData` = optional JSON `{brand_name, class_type, alcohol_content, net_contents, producer_name, country_of_origin, is_import}`. Returns per-field results. `GET /api/verify` returns `{configured, model}` as a health check.

## Sample labels

`public/samples/` contains six generated labels plus `applications.csv`:

| File | What it tests | Expected |
|---|---|---|
| 01-old-tom-bourbon-compliant | The sample from the brief; application brand in title case | Looks good |
| 02-stones-throw-titlecase-warning | "Government Warning:" in title case (Jenny's example) | Problem |
| 03-harbor-light-abv-mismatch | Label 40%, application 43% | Problem |
| 04-copper-kettle-altered-warning | Warning wording changed; 12 FL OZ vs 355 mL application | Problem (warning), net contents OK |
| 05-chateau-verre-import | Import with country of origin; accented brand vs unaccented application | Looks good |
| 06-desert-bloom-photo-angle | Tilted photo with glare and blur; warning header not bold | Problem (bold), image handled |

## Assumptions

- **Standalone proof of concept**, per Marcus: no COLA integration, no authentication, no persistence.
- The **application data** is what the agent is verifying against. It is entered by hand (single) or via CSV (batch) because COLA integration is out of scope. With no application data, the tool still checks that required items are present and the warning is correct.
- **Warning text** is the statutory text in 27 CFR 16.21. Whitespace and line breaks are ignored because labels wrap text. Everything else must match.
- **Country of origin** is only required when the application indicates an import (a country is entered). Otherwise it is informational.
- **Alcohol content** missing is a *fail* for spirits and *needs review* for beer and wine, since some are exempt.
- Proof, when printed, must equal 2 × ABV.
- Rules cover the common elements listed in the brief. The full beverage-specific rulebook (type-size minimums, sulfite and allergen declarations, same-field-of-vision rules, and so on) is out of scope for a prototype and listed below.

## Limitations and trade-offs

- **The warning check compares the model's transcription, not the pixels.** The prompt requires a verbatim copy and forbids correcting text, and the comparison itself is deterministic code. Even so, a model that silently "fixes" a misspelled warning is the main false-pass risk. A production version should add a second independent OCR pass (for example Azure Document Intelligence) and flag any disagreement for review.
- **Bold detection is visual judgment by the model.** It is reliable on clear images but not guaranteed, so uncertainty is reported as "needs review", never as a pass.
- **Type size is not measured.** 27 CFR 16.22 minimum type sizes depend on container size and would need calibrated image measurement.
- **Multi-panel labels** must be in one image or checked separately. A production version would accept front and back images per application.
- **Cloud AI dependency.** Treasury's firewall may block Google's endpoint. See *Production path*.
- **Batch concurrency is client-driven** (6 at a time, with backoff on rate limits). For 300 labels this takes a few minutes and requires the tab to stay open. Throughput is bounded by the API key's quota. A production version would use a server-side job queue.
- **No authentication or rate limiting**, since it is a public prototype. Do not upload sensitive material.

## Production path (if this moved forward)

1. **Model hosting inside the boundary:** the extraction step sits behind one function (`extractLabelFields`). It can be pointed at Azure OpenAI / Azure AI Document Intelligence in Treasury's existing FedRAMP-authorized Azure tenant (matching Marcus's note that they are on Azure), or Gemini via Vertex AI in an authorized environment, without touching the rules or UI.
2. Server-side batch queue with resumable jobs and a results export matching COLA fields.
3. Authentication (PIV/CAC via the agency IdP), audit logging of decisions (not images), and retention aligned with records policy.
4. A labeled evaluation set of real historical COLA decisions to measure accuracy and false-pass rate before any workflow use.

## Project structure

```
src/
  app/
    api/verify/route.ts     POST: validate, extract, verify. GET: health check
    layout.tsx, page.tsx, globals.css
  components/
    label-verifier.tsx      Single and batch workflows, upload, progress, export
    result-detail.tsx       Per-field results and warning word diff
  lib/
    extract-label.ts        Gemini call, prompt, JSON schema, output normalization
    verify-label.ts         Deterministic compliance rules
    matching.ts             Text normalization, fuzzy match, ABV/volume parsing, word diff
    csv.ts                  Batch application CSV parser
    prepare-image.ts        In-browser downscale before upload
    constants.ts, types.ts
tests/verify.test.ts        Unit tests
scripts/make-samples.mjs    Generates public/samples
```
