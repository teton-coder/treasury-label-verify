"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import type { CheckStatus, FieldVerification, OverallStatus, VerificationResult } from "@/lib/types";
import { wordDiff } from "@/lib/matching";
import { GOVERNMENT_WARNING_TEXT } from "@/lib/constants";

export const OVERALL: Record<OverallStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  pass: { label: "Looks good", cls: "bg-green-50 border-green-300 text-green-900", icon: CheckCircle2 },
  fail: { label: "Problem found", cls: "bg-red-50 border-red-300 text-red-900", icon: XCircle },
  review: { label: "Needs your review", cls: "bg-amber-50 border-amber-300 text-amber-900", icon: AlertTriangle },
};

const FIELD: Record<CheckStatus, { word: string; cls: string; icon: typeof CheckCircle2 }> = {
  pass: { word: "OK", cls: "text-green-700", icon: CheckCircle2 },
  fail: { word: "Problem", cls: "text-red-700", icon: XCircle },
  review: { word: "Check", cls: "text-amber-700", icon: AlertTriangle },
  info: { word: "Note", cls: "text-slate-500", icon: Info },
};

export function StatusBadge({ status }: { status: OverallStatus }) {
  const s = OVERALL[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-base font-semibold ${s.cls}`}>
      <Icon className="h-5 w-5" aria-hidden /> {s.label}
    </span>
  );
}

export function ResultDetail({ result, imageUrl }: { result: VerificationResult; imageUrl?: string }) {
  const s = OVERALL[result.overall_status];
  const Icon = s.icon;
  const [showRaw, setShowRaw] = useState(false);
  // Problems first, then things to check, then OK, then notes.
  const order: CheckStatus[] = ["fail", "review", "pass", "info"];
  const fields = [...result.fields].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      {imageUrl && (
        <div className="lg:sticky lg:top-4 self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`Label image: ${result.filename}`} className="w-full rounded-lg border border-slate-300 bg-white" />
          <p className="mt-2 text-sm text-slate-500 break-all">{result.filename}</p>
        </div>
      )}
      <div>
        <div className={`flex items-start gap-3 rounded-xl border-2 p-5 ${s.cls}`} role="status">
          <Icon className="mt-0.5 h-8 w-8 shrink-0" aria-hidden />
          <div>
            <p className="text-2xl font-bold">{s.label}</p>
            <p className="mt-1 text-lg">{result.summary}</p>
            <p className="mt-1 text-sm opacity-70">
              Checked in {(result.processing_time_ms / 1000).toFixed(1)} seconds · read by {result.model}
            </p>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {fields.map((f) => (
            <FieldRow key={f.field} f={f} />
          ))}
        </ul>

        <button
          onClick={() => setShowRaw(!showRaw)}
          className="mt-4 inline-flex items-center gap-1 text-sm text-slate-500 underline-offset-2 hover:underline"
          aria-expanded={showRaw}
        >
          {showRaw ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          Everything the AI read from this label
        </button>
        {showRaw && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-100 p-4 text-xs text-slate-700">
            {JSON.stringify(result.extracted, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function FieldRow({ f }: { f: FieldVerification }) {
  const s = FIELD[f.status];
  const Icon = s.icon;
  const isWarning = f.field === "government_warning" && f.extracted && f.status !== "pass";
  return (
    <li className="flex gap-3 p-4">
      <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${s.cls}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold text-slate-900">
          {f.label} <span className={`ml-1 text-sm font-bold uppercase ${s.cls}`}>{s.word}</span>
        </p>
        <p className="text-base text-slate-700">{f.message}</p>
        {(f.extracted || f.expected) && !isWarning && f.field !== "image_quality" && f.field !== "warning_bold" && (
          <dl className="mt-2 grid gap-x-3 gap-y-1 text-base sm:grid-cols-[auto_1fr]">
            {f.extracted && (
              <>
                <dt className="text-slate-500">On the label:</dt>
                <dd className="font-mono break-words text-slate-900">{f.extracted}</dd>
              </>
            )}
            {f.expected && (
              <>
                <dt className="text-slate-500">{f.field === "government_warning" ? "Required:" : "Application:"}</dt>
                <dd className="font-mono break-words text-slate-900">{f.expected}</dd>
              </>
            )}
          </dl>
        )}
        {isWarning && <WarningDiff found={f.extracted!} />}
      </div>
    </li>
  );
}

/** Highlight exactly which words differ from the required warning text. */
function WarningDiff({ found }: { found: string }) {
  const tokens = wordDiff(GOVERNMENT_WARNING_TEXT, found);
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3 text-base leading-relaxed">
      <p className="mb-1 text-sm text-slate-500">
        <span className="rounded bg-red-100 px-1 line-through">Struck out</span> = required but missing or changed.{" "}
        <span className="rounded bg-amber-200 px-1">Highlighted</span> = on the label but not in the required text.
      </p>
      <p>
        {tokens.map((t, i) => (
          <span
            key={i}
            className={t.kind === "missing" ? "rounded bg-red-100 px-0.5 text-red-800 line-through" : t.kind === "extra" ? "rounded bg-amber-200 px-0.5" : ""}
          >
            {t.text}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}
