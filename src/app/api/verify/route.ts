import { NextRequest, NextResponse } from "next/server";
import { ExtractionError, extractLabelFields, getActiveModel, getApiKey } from "@/lib/extract-label";
import { verifyLabel } from "@/lib/verify-label";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { ApplicationData, VerifyResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/verify  (multipart/form-data)
 *   file             one label image (JPEG / PNG / WebP)
 *   applicationData  optional JSON string of ApplicationData
 *
 * One image per request by design: batches are fanned out from the browser
 * with limited concurrency, so each label shows up as soon as it is done and
 * one slow or failed label never blocks the rest.
 *
 * Nothing is stored. The image is held in memory for the duration of the call.
 */
export async function POST(req: NextRequest): Promise<NextResponse<VerifyResponse>> {
  const started = Date.now();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "BAD_INPUT", "Expected a multipart form upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "BAD_INPUT", "No image was attached.");
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return fail(400, "BAD_INPUT", `Unsupported file type (${file.type || "unknown"}). Use JPEG, PNG, or WebP.`);
  }
  if (file.size === 0) return fail(400, "BAD_INPUT", "The image file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(413, "BAD_INPUT", `Image is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 4 MB.`);
  }

  const app = parseApplicationData(form.get("applicationData"));
  if (app === "invalid") return fail(400, "BAD_INPUT", "Application data was not valid JSON.");

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const extracted = await extractLabelFields(base64, file.type);
    const verdict = verifyLabel(extracted, app);
    return NextResponse.json({
      success: true,
      result: {
        filename: file.name,
        ...verdict,
        extracted,
        processing_time_ms: Date.now() - started,
        model: getActiveModel(),
      },
    });
  } catch (err) {
    if (err instanceof ExtractionError) {
      const status = { NOT_CONFIGURED: 503, AI_TIMEOUT: 504, RATE_LIMITED: 429, AI_ERROR: 502 }[err.code];
      return fail(status, err.code, err.message);
    }
    console.error("Unexpected verify error", err);
    return fail(500, "AI_ERROR", "Something went wrong while checking this label.");
  }
}

/** GET /api/verify: health check used by the UI to show a clear banner if the AI is not configured. */
export async function GET() {
  return NextResponse.json({ configured: !!getApiKey(), model: getActiveModel() });
}

function fail(status: number, code: VerifyResponse["code"], error: string) {
  return NextResponse.json<VerifyResponse>({ success: false, code, error }, { status });
}

const APP_KEYS = ["brand_name", "class_type", "alcohol_content", "net_contents", "producer_name", "producer_address", "country_of_origin"] as const;

function parseApplicationData(raw: FormDataEntryValue | null): ApplicationData | "invalid" {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (!obj || typeof obj !== "object") return "invalid";
  const src = obj as Record<string, unknown>;
  const out: ApplicationData = {};
  for (const k of APP_KEYS) {
    const v = src[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 500);
  }
  if (src.is_import === true) out.is_import = true;
  return out;
}
