/**
 * TTB label compliance constants.
 *
 * Health warning text: 27 CFR 16.21 (Alcoholic Beverage Labeling Act of 1988).
 * "GOVERNMENT WARNING" must appear in capital letters and bold type: 27 CFR 16.22.
 */
export const GOVERNMENT_WARNING_TEXT =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

export const GOVERNMENT_WARNING_HEADER = "GOVERNMENT WARNING:";

/** Largest original file a user may pick. It is downscaled in the browser before upload. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
/** Largest image the API accepts (after client downscale). Vercel's request body cap is 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Stakeholders mention importers submitting 200-300 labels at once. */
export const MAX_BATCH_SIZE = 300;
/** Parallel requests the browser runs during a batch. */
export const BATCH_CONCURRENCY = 6;
/** Longest edge of the image sent to the model. Enough for small warning text, keeps latency low. */
export const MAX_IMAGE_EDGE_PX = 2000;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Goal is ~5 s per label. Hard stop so an agent is never left waiting on a hung call. */
export const AI_TIMEOUT_MS = 25_000;

/**
 * Current stable Flash model. Google restricts the 2.5 family to existing users,
 * so a newly created key needs a 3.x model. If the primary model is unavailable
 * for the key, the fallback is tried automatically.
 */
export const DEFAULT_MODEL = "gemini-3.6-flash";
export const FALLBACK_MODEL = "gemini-3.5-flash-lite";
