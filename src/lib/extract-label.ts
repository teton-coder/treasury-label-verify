import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { ExtractedLabelFields } from "./types";
import { AI_TIMEOUT_MS, DEFAULT_MODEL } from "./constants";

/**
 * The model only READS the label. All pass/fail decisions are made by the
 * deterministic rules in verify-label.ts, so results are explainable and
 * repeatable, and the AI can never "decide" a label is compliant.
 */
const EXTRACTION_PROMPT = `You are transcribing an alcohol beverage label for a U.S. TTB compliance reviewer.

Read every panel visible in the image and transcribe the requested fields EXACTLY as printed:
- Preserve capitalization, punctuation, numbers, and units character-for-character.
- Do NOT correct spelling, grammar, or wording. If the label is wrong, your transcription must be wrong the same way.
- If a field is not present, or you cannot read it with confidence, return null. Never guess or fill in from memory.
- government_warning: the complete health warning statement from its first word to its last, verbatim. Do not substitute the standard text.
- warning_header_bold: true if the words "GOVERNMENT WARNING" are visibly bold compared with the rest of the warning, false if they are not, null if you cannot tell.
- The image may be photographed at an angle, with glare, or in poor light. Do your best and report any problems in readability_issues.`;

const nullableString = { type: Type.STRING, nullable: true };

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    brand_name: { ...nullableString, description: "Brand name as printed" },
    class_type: { ...nullableString, description: "Class/type designation, e.g. Kentucky Straight Bourbon Whiskey" },
    alcohol_content: { ...nullableString, description: "Alcohol statement as printed, e.g. 45% Alc./Vol. (90 Proof)" },
    net_contents: { ...nullableString, description: "Net contents as printed, e.g. 750 mL" },
    producer_name: { ...nullableString, description: "Bottler/producer/importer name" },
    producer_address: { ...nullableString, description: "City and state (or address) of bottler/producer/importer" },
    country_of_origin: { ...nullableString, description: "Country of origin statement if present" },
    government_warning: { ...nullableString, description: "Verbatim health warning statement" },
    warning_header_bold: { type: Type.BOOLEAN, nullable: true },
    image_quality: { type: Type.STRING, enum: ["good", "fair", "poor"] },
    readability_issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    beverage_category: { type: Type.STRING, enum: ["beer", "wine", "spirits", "unknown"] },
  },
  required: [
    "brand_name",
    "class_type",
    "alcohol_content",
    "net_contents",
    "producer_name",
    "producer_address",
    "country_of_origin",
    "government_warning",
    "warning_header_bold",
    "image_quality",
    "readability_issues",
    "beverage_category",
  ],
  propertyOrdering: [
    "brand_name",
    "class_type",
    "alcohol_content",
    "net_contents",
    "producer_name",
    "producer_address",
    "country_of_origin",
    "government_warning",
    "warning_header_bold",
    "image_quality",
    "readability_issues",
    "beverage_category",
  ],
};

export class ExtractionError extends Error {
  constructor(
    message: string,
    public code: "NOT_CONFIGURED" | "AI_TIMEOUT" | "AI_ERROR" | "RATE_LIMITED",
  ) {
    super(message);
  }
}

export function getApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export function getModelName(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ExtractionError(
      "The AI service is not configured on this server (missing GEMINI_API_KEY).",
      "NOT_CONFIGURED",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function extractLabelFields(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedLabelFields> {
  const ai = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  let text: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: getModelName(),
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: EXTRACTION_PROMPT }],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // Transcription does not benefit from "thinking"; disabling it is the
        // single biggest latency win toward the ~5 second target.
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: controller.signal,
      },
    });
    text = response.text;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ExtractionError(
        `The AI service did not respond within ${AI_TIMEOUT_MS / 1000} seconds. Please try again.`,
        "AI_TIMEOUT",
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      throw new ExtractionError("The AI service is busy (rate limit). Please retry in a moment.", "RATE_LIMITED");
    }
    console.error("Gemini error:", msg);
    throw new ExtractionError("The AI service returned an error while reading this image.", "AI_ERROR");
  } finally {
    clearTimeout(timer);
  }

  if (!text) {
    throw new ExtractionError("The AI service returned an empty response (the image may have been blocked).", "AI_ERROR");
  }
  try {
    return normalizeExtraction(JSON.parse(text));
  } catch {
    throw new ExtractionError("Could not understand the AI service response.", "AI_ERROR");
  }
}

/** Defensive normalization: never trust model output shape. */
export function normalizeExtraction(raw: Record<string, unknown>): ExtractedLabelFields {
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" || /^(null|n\/a|none)$/i.test(t) ? null : t;
  };
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;

  return {
    brand_name: str(raw.brand_name),
    class_type: str(raw.class_type),
    alcohol_content: str(raw.alcohol_content),
    net_contents: str(raw.net_contents),
    producer_name: str(raw.producer_name),
    producer_address: str(raw.producer_address),
    country_of_origin: str(raw.country_of_origin),
    government_warning: str(raw.government_warning),
    warning_header_bold: typeof raw.warning_header_bold === "boolean" ? raw.warning_header_bold : null,
    image_quality: oneOf(raw.image_quality, ["good", "fair", "poor"] as const, "fair"),
    readability_issues: Array.isArray(raw.readability_issues)
      ? raw.readability_issues.filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : [],
    beverage_category: oneOf(raw.beverage_category, ["beer", "wine", "spirits", "unknown"] as const, "unknown"),
  };
}
