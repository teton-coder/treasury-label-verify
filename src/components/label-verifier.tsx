"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, RotateCcw, Download, FileSpreadsheet, X, AlertTriangle, ImageIcon } from "lucide-react";
import type { ApplicationData, VerificationResult, VerifyResponse } from "@/lib/types";
import { ACCEPTED_IMAGE_TYPES, BATCH_CONCURRENCY, MAX_BATCH_SIZE, MAX_FILE_SIZE } from "@/lib/constants";
import { prepareImage } from "@/lib/prepare-image";
import { parseApplicationCsv } from "@/lib/csv";
import { OVERALL, ResultDetail, StatusBadge } from "./result-detail";

type ItemState = "waiting" | "checking" | "done" | "error";
interface Item {
  id: string;
  file: File;
  url: string;
  state: ItemState;
  app?: ApplicationData;
  result?: VerificationResult;
  error?: string;
}

const APP_FIELDS: Array<{ key: keyof ApplicationData; label: string; placeholder: string }> = [
  { key: "brand_name", label: "Brand name", placeholder: "OLD TOM DISTILLERY" },
  { key: "class_type", label: "Class / type", placeholder: "Kentucky Straight Bourbon Whiskey" },
  { key: "alcohol_content", label: "Alcohol content", placeholder: "45% Alc./Vol. (90 Proof)" },
  { key: "net_contents", label: "Net contents", placeholder: "750 mL" },
  { key: "producer_name", label: "Bottler / producer", placeholder: "Old Tom Distillery Co." },
  { key: "producer_address", label: "Bottler / producer address", placeholder: "Bardstown, Kentucky" },
  { key: "country_of_origin", label: "Country of origin (imports only)", placeholder: "Leave blank if domestic" },
];

type Mode = "single" | "batch";

export function LabelVerifier() {
  const [mode, setMode] = useState<Mode>("single");
  const [items, setItems] = useState<Item[]>([]);
  const [app, setApp] = useState<ApplicationData>({});
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvMap, setCsvMap] = useState<Map<string, ApplicationData> | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "fail" | "review" | "pass" | "error">("all");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    fetch("/api/verify")
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(null));
  }, []);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => URL.revokeObjectURL(i.url));
      return [];
    });
    setOpenId(null);
    setNotices([]);
    setFilter("all");
    setElapsed(0);
  }, []);

  const switchMode = (m: Mode) => {
    if (running) return;
    reset();
    setMode(m);
  };

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const msgs: string[] = [];
      const ok: File[] = [];
      for (const f of Array.from(list)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) msgs.push(`"${f.name}" was skipped: only JPEG, PNG, or WebP images are accepted.`);
        else if (f.size > MAX_FILE_SIZE) msgs.push(`"${f.name}" was skipped: larger than 25 MB.`);
        else ok.push(f);
      }
      setItems((prev) => {
        const base = mode === "single" ? [] : prev;
        if (mode === "single") prev.forEach((i) => URL.revokeObjectURL(i.url));
        const room = mode === "single" ? 1 : MAX_BATCH_SIZE - base.length;
        if (ok.length > room) msgs.push(`Only ${room} more image(s) can be added (limit ${mode === "single" ? 1 : MAX_BATCH_SIZE}).`);
        const added = ok.slice(0, Math.max(0, room)).map<Item>((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          state: "waiting",
        }));
        return [...base, ...added];
      });
      setNotices(msgs);
      setOpenId(null);
    },
    [mode],
  );

  const loadCsv = async (file: File) => {
    const { byFilename, warnings } = parseApplicationCsv(await file.text());
    setCsvName(file.name);
    setCsvMap(byFilename);
    setNotices(warnings);
  };

  const checkOne = async (item: Item, appData: ApplicationData): Promise<Partial<Item>> => {
    try {
      const prepared = await prepareImage(item.file);
      const body = new FormData();
      body.append("file", prepared, item.file.name);
      if (Object.values(appData).some(Boolean)) body.append("applicationData", JSON.stringify(appData));
      // Retry rate-limited requests with exponential backoff so a burst in a large batch self-heals.
      const MAX_ATTEMPTS = 4;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const res = await fetch("/api/verify", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as VerifyResponse | null;
        if (data?.success && data.result) return { state: "done", result: data.result, app: appData };
        if (data?.code === "NOT_CONFIGURED") setConfigured(false);
        if (res.status === 429 && attempt < MAX_ATTEMPTS - 1) {
          const retryAfter = Number(res.headers.get("retry-after")) * 1000;
          const wait = retryAfter > 0 ? retryAfter : 4000 * 2 ** attempt + Math.random() * 1000;
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        return { state: "error", error: data?.error ?? `The server returned an error (${res.status}).` };
      }
      return { state: "error", error: "The AI service is busy. Try again." };
    } catch {
      return { state: "error", error: "Could not reach the server. Check your connection and try again." };
    }
  };

  const run = async (only?: Set<string>) => {
    const queue = items.filter((i) => (only ? only.has(i.id) : i.state === "waiting" || i.state === "error"));
    if (!queue.length) return;
    setRunning(true);
    startedAt.current = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    const update = (id: string, patch: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++];
        update(item.id, { state: "checking", error: undefined });
        const appData = mode === "single" ? app : csvMap?.get(item.file.name.toLowerCase()) ?? {};
        const patch = await checkOne(item, appData);
        // In a batch with a CSV, a label with no matching row was only checked for required items.
        // Don't let it read as "Looks good" without saying so.
        if (mode === "batch" && csvMap && !csvMap.has(item.file.name.toLowerCase()) && patch.result) {
          const r = patch.result;
          patch.result = {
            ...r,
            overall_status: r.overall_status === "fail" ? "fail" : "review",
            summary: `No row for this file in ${csvName ?? "the CSV"}, so it was not compared with an application. ${r.summary}`,
            fields: [
              {
                field: "application_row",
                label: "Application data",
                status: "review",
                extracted: null,
                message: `No row with filename "${item.file.name}" was found in the CSV. Only required label items were checked.`,
              },
              ...r.fields,
            ],
          };
        }
        update(item.id, patch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, worker));
    clearInterval(tick);
    setElapsed(Date.now() - startedAt.current);
    setRunning(false);
    if (mode === "single") setOpenId(queue[0].id);
  };

  // Tell the agent about CSV rows with no matching image (missing upload or filename typo), and vice versa.
  const csvNotices = useMemo(() => {
    if (mode !== "batch" || !csvMap || items.length === 0) return [];
    const names = new Set(items.map((i) => i.file.name.toLowerCase()));
    const orphan = [...csvMap.keys()].filter((k) => !names.has(k));
    const missing = items.filter((i) => !csvMap.has(i.file.name.toLowerCase())).length;
    const msgs: string[] = [];
    if (orphan.length) msgs.push(`${orphan.length} CSV row(s) have no matching image: ${orphan.slice(0, 5).join(", ")}${orphan.length > 5 ? ", …" : ""}`);
    if (missing) msgs.push(`${missing} image(s) have no row in the CSV. They are checked for required items only and marked for review.`);
    return msgs;
  }, [mode, csvMap, items]);
  const allNotices = [...notices, ...csvNotices];

  const loadSamples = async () => {
    try {
      await loadSamplesInner();
    } catch {
      setNotices(["The sample labels could not be loaded. Please refresh the page and try again."]);
    }
  };

  const loadSamplesInner = async () => {
    const res = await fetch("/samples/manifest.json");
    const manifest: Array<{ file: string; application: ApplicationData }> = await res.json();
    const files = await Promise.all(
      manifest.map(async (m) => {
        const blob = await (await fetch(`/samples/${m.file}`)).blob();
        return new File([blob], m.file, { type: blob.type || "image/png" });
      }),
    );
    if (mode === "single") {
      addFiles([files[0]]);
      setApp(manifest[0].application);
    } else {
      reset(); // avoid duplicates if clicked twice
      addFiles(files);
      const csvRes = await fetch("/samples/applications.csv");
      await loadCsv(new File([await csvRes.text()], "applications.csv"));
    }
  };

  const counts = useMemo(() => {
    const c = { total: items.length, done: 0, pass: 0, fail: 0, review: 0, error: 0 };
    for (const i of items) {
      if (i.state === "done" && i.result) {
        c.done++;
        c[i.result.overall_status]++;
      } else if (i.state === "error") {
        c.done++;
        c.error++;
      }
    }
    return c;
  }, [items]);

  const visible = items.filter((i) =>
    filter === "all" ? true : filter === "error" ? i.state === "error" : i.result?.overall_status === filter,
  );

  const exportCsv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = ["filename", "result", "summary", "problems", "needs_review", "seconds", "model"];
    const rows = items.map((i) => {
      const r = i.result;
      const list = (s: string) => r?.fields.filter((f) => f.status === s).map((f) => `${f.label}: ${f.message}`).join(" | ") ?? "";
      return [
        i.file.name,
        r ? OVERALL[r.overall_status].label : "Error",
        r?.summary ?? i.error ?? "",
        list("fail"),
        list("review"),
        r ? (r.processing_time_ms / 1000).toFixed(1) : "",
        r?.model ?? "",
      ].map((v) => esc(String(v)));
    });
    const blob = new Blob([[header.join(","), ...rows.map((r) => r.join(","))].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `label-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const single = items[0];
  const waiting = items.filter((i) => i.state === "waiting").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {configured === false && (
        <div role="alert" className="mb-6 flex gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden />
          <p className="text-base">
            <strong>The AI service is not connected on this server.</strong> Labels cannot be checked until an administrator sets the
{" "}
            <code className="rounded bg-amber-100 px-1">GEMINI_API_KEY</code> setting.
          </p>
        </div>
      )}

      {/* Mode tabs */}
      <div
        role="tablist"
        aria-label="How many labels"
        className="mb-6 inline-flex rounded-xl border border-slate-300 bg-white p-1"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            const next = mode === "single" ? "batch" : "single";
            switchMode(next);
            document.getElementById(`tab-${next}`)?.focus();
          }
        }}
      >
        {(["single", "batch"] as const).map((m) => (
          <button
            key={m}
            id={`tab-${m}`}
            role="tab"
            aria-selected={mode === m}
            aria-controls="panel"
            tabIndex={mode === m ? 0 : -1}
            onClick={() => switchMode(m)}
            disabled={running}
            className={`rounded-lg px-5 py-3 text-lg font-semibold ${mode === m ? "bg-[#1b2a4a] text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {m === "single" ? "Check one label" : "Check many labels"}
          </button>
        ))}
      </div>

      <div id="panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
      {/* SINGLE MODE */}
      {mode === "single" && (
        <>
          {single?.result && openId ? (
            <div>
              <button onClick={reset} className="mb-5 inline-flex items-center gap-2 rounded-lg bg-[#1b2a4a] px-5 py-3 text-lg font-semibold text-white hover:bg-[#2a3d66]">
                <RotateCcw className="h-5 w-5" aria-hidden /> Check another label
              </button>
              <ResultDetail result={single.result} imageUrl={single.url} />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-2 text-xl font-bold text-slate-900">1. Label image</h2>
                {single ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={single.url} alt="Selected label" className="max-h-[420px] w-full rounded-xl border border-slate-300 bg-white object-contain" />
                    {!running && (
                      <button onClick={reset} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-2 text-base shadow hover:bg-white">
                        <X className="h-4 w-4" aria-hidden /> Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <DropZone multiple={false} onFiles={addFiles} />
                )}
                <button onClick={loadSamples} className="mt-3 text-base text-blue-700 underline underline-offset-2">
                  No label handy? Load a sample
                </button>
              </section>
              <section>
                <h2 className="text-xl font-bold text-slate-900">2. Application details</h2>
                <p className="mb-3 text-base text-slate-600">Type what the application says. Leave blank to only check that required items are on the label.</p>
                <div className="space-y-3">
                  {APP_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-base font-medium text-slate-800">{f.label}</span>
                      <input
                        type="text"
                        value={(app[f.key] as string) ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setApp({ ...app, [f.key]: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-400 px-3 py-2.5 text-lg placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                      />
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => run()}
                  disabled={!single || running}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-6 py-4 text-xl font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {running ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> Checking… {(elapsed / 1000).toFixed(0)}s
                    </>
                  ) : (
                    "Check label"
                  )}
                </button>
                {single?.state === "error" && (
                  <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-base text-red-800">
                    {single.error}
                  </p>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {/* BATCH MODE */}
      {mode === "batch" && (
        <div className="space-y-6">
          {counts.done === 0 && !running && (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <section>
                <h2 className="mb-2 text-xl font-bold text-slate-900">1. Label images</h2>
                <DropZone multiple onFiles={addFiles} note={items.length ? `${items.length} image(s) added. Add more or continue.` : undefined} />
                <button onClick={loadSamples} className="mt-3 text-base text-blue-700 underline underline-offset-2">
                  Load the sample batch (6 labels with application data)
                </button>
              </section>
              <section>
                <h2 className="text-xl font-bold text-slate-900">2. Application data (optional)</h2>
                <p className="mb-3 text-base text-slate-600">
                  A spreadsheet saved as CSV with one row per label. It needs a <strong>filename</strong> column plus any of: brand_name, class_type,
                  alcohol_content, net_contents, producer_name, country_of_origin.{" "}
                  <a href="/samples/applications.csv" className="text-blue-700 underline" download>
                    Download an example
                  </a>
                </p>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-400 bg-white p-4 text-lg hover:border-blue-600">
                  <FileSpreadsheet className="h-7 w-7 text-slate-500" aria-hidden />
                  <span>{csvName ? `Using ${csvName} (${csvMap?.size ?? 0} rows)` : "Choose CSV file"}</span>
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && loadCsv(e.target.files[0])} />
                </label>
              </section>
            </div>
          )}

          {items.length > 0 && (
            <section aria-live="polite">
              <div className="flex flex-wrap items-center gap-3">
                {waiting > 0 && !running && (
                  <button onClick={() => run()} className="rounded-xl bg-green-700 px-6 py-4 text-xl font-bold text-white hover:bg-green-800">
                    Check {waiting} label{waiting === 1 ? "" : "s"}
                  </button>
                )}
                {!running && counts.error > 0 && (
                  <button
                    onClick={() => run(new Set(items.filter((i) => i.state === "error").map((i) => i.id)))}
                    className="rounded-xl border-2 border-slate-400 bg-white px-5 py-3 text-lg font-semibold hover:bg-slate-50"
                  >
                    Retry {counts.error} that didn&apos;t finish
                  </button>
                )}
                {counts.done > 0 && !running && (
                  <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-400 bg-white px-5 py-3 text-lg font-semibold hover:bg-slate-50">
                    <Download className="h-5 w-5" aria-hidden /> Download results (CSV)
                  </button>
                )}
                {!running && (
                  <button onClick={reset} className="inline-flex items-center gap-2 px-3 py-3 text-lg text-slate-600 hover:text-slate-900">
                    <RotateCcw className="h-5 w-5" aria-hidden /> Start over
                  </button>
                )}
              </div>

              {(running || counts.done > 0) && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xl font-bold text-slate-900">
                      {running ? "Checking…" : "Finished"} {counts.done} of {counts.total}
                    </p>
                    <p className="text-base text-slate-500">
                      {(elapsed / 1000).toFixed(0)}s elapsed{counts.done > 0 ? ` · about ${(elapsed / 1000 / counts.done).toFixed(1)}s per label (running ${BATCH_CONCURRENCY} at a time)` : ""}
                    </p>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.done}>
                    <div className="h-full bg-[#1b2a4a] transition-all" style={{ width: `${(counts.done / Math.max(1, counts.total)) * 100}%` }} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter results">
                    {(
                      [
                        ["all", `All (${counts.total})`],
                        ["fail", `Problems (${counts.fail})`],
                        ["review", `Needs review (${counts.review})`],
                        ["pass", `Looks good (${counts.pass})`],
                        ["error", `Didn't finish (${counts.error})`],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setFilter(k)}
                        aria-pressed={filter === k}
                        className={`rounded-full border px-4 py-2 text-base ${filter === k ? "border-[#1b2a4a] bg-[#1b2a4a] text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <ul className="mt-4 space-y-2">
                {visible.map((i) => (
                  <li key={i.id} className="rounded-xl border border-slate-200 bg-white">
                    <button
                      className="flex w-full items-center gap-4 p-3 text-left disabled:cursor-default"
                      onClick={() => setOpenId(openId === i.id ? null : i.id)}
                      disabled={!i.result}
                      aria-expanded={openId === i.id}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={i.url} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-medium text-slate-900">{i.file.name}</p>
                        <p className="truncate text-base text-slate-600">
                          {i.state === "waiting" && "Waiting"}
                          {i.state === "checking" && "Checking…"}
                          {i.state === "error" && <span className="text-red-700">{i.error}</span>}
                          {i.result?.summary}
                        </p>
                      </div>
                      {i.state === "checking" && <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Checking" />}
                      {i.result && <StatusBadge status={i.result.overall_status} />}
                      {i.state === "error" && <span className="rounded-full bg-slate-100 px-3 py-1 text-base font-semibold text-slate-700">Didn&apos;t finish</span>}
                    </button>
                    {openId === i.id && i.result && (
                      <div className="border-t border-slate-200 p-4">
                        <ResultDetail result={i.result} imageUrl={i.url} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      </div>

      {allNotices.length > 0 && (
        <ul className="mt-4 space-y-1" role="alert">
          {allNotices.map((n, idx) => (
            <li key={idx} className="rounded-lg bg-amber-50 px-4 py-2 text-base text-amber-900">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DropZone({ multiple, onFiles, note }: { multiple: boolean; onFiles: (f: FileList) => void; note?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center ${over ? "border-blue-600 bg-blue-50" : "border-slate-400 bg-white"}`}
    >
      {multiple ? <Upload className="h-12 w-12 text-slate-500" aria-hidden /> : <ImageIcon className="h-12 w-12 text-slate-500" aria-hidden />}
      <p className="mt-3 text-xl font-semibold text-slate-800">Drag {multiple ? "label images" : "a label image"} here</p>
      <p className="text-base text-slate-600">or</p>
      <button onClick={() => input.current?.click()} className="mt-2 rounded-lg bg-[#1b2a4a] px-6 py-3 text-lg font-semibold text-white hover:bg-[#2a3d66]">
        Choose {multiple ? "images" : "image"}
      </button>
      <p className="mt-3 text-sm text-slate-500">
        JPEG, PNG or WebP{multiple ? ` · up to ${MAX_BATCH_SIZE} at a time` : ""}. Phone photos are fine.
      </p>
      {note && <p className="mt-2 text-base font-medium text-slate-700">{note}</p>}
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple={multiple}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
