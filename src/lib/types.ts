/** Fields extracted from a label image by the vision model. */
export interface ExtractedLabelFields {
  brand_name: string | null;
  class_type: string | null;
  alcohol_content: string | null;
  net_contents: string | null;
  producer_name: string | null;
  producer_address: string | null;
  country_of_origin: string | null;
  /** Verbatim transcription of the health warning, or null if absent. */
  government_warning: string | null;
  /** Whether the "GOVERNMENT WARNING:" lead-in appears in bold type. null = cannot tell. */
  warning_header_bold: boolean | null;
  image_quality: "good" | "fair" | "poor";
  readability_issues: string[];
  beverage_category: "beer" | "wine" | "spirits" | "unknown";
}

/**
 * pass   = verified
 * fail   = definite problem, label should be rejected or corrected
 * review = agent judgment needed (near-match, unreadable, ambiguous)
 * info   = informational only, does not affect the outcome
 */
export type CheckStatus = "pass" | "fail" | "review" | "info";

export interface FieldVerification {
  field: string;
  label: string;
  status: CheckStatus;
  /** Value read from the label. */
  extracted: string | null;
  /** Value from the application, or the required statutory text. */
  expected?: string;
  message: string;
}

export type OverallStatus = "pass" | "fail" | "review";

export interface VerificationResult {
  filename: string;
  overall_status: OverallStatus;
  fields: FieldVerification[];
  extracted: ExtractedLabelFields;
  processing_time_ms: number;
  summary: string;
  model: string;
}

/** Values from the COLA application to compare against the label. All optional. */
export interface ApplicationData {
  brand_name?: string;
  class_type?: string;
  alcohol_content?: string;
  net_contents?: string;
  producer_name?: string;
  producer_address?: string;
  country_of_origin?: string;
  is_import?: boolean;
}

export type ErrorCode = "NOT_CONFIGURED" | "BAD_INPUT" | "AI_TIMEOUT" | "AI_ERROR" | "RATE_LIMITED";

export interface VerifyResponse {
  success: boolean;
  result?: VerificationResult;
  error?: string;
  code?: ErrorCode;
}
