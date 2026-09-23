import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// next/font self-hosts the font at build time, so no runtime call to Google Fonts
// (relevant given the agency firewall notes).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Label Check · Alcohol Label Verification Prototype",
  description: "Prototype tool that reads an alcohol beverage label image and checks it against the application and TTB labeling rules.",
  robots: { index: false },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900 antialiased">
        <header className="bg-[#1b2a4a] text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
            <div>
              <h1 className="text-2xl font-bold">Label Check</h1>
              <p className="text-base text-white/80">Compare an alcohol label with its application in seconds</p>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium">Prototype · not an official system</span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-sm text-slate-500 sm:px-6">
          Results are advisory. A compliance agent makes the final decision. Images are processed in memory and are not stored.
          Warning text per 27 CFR 16.21–16.22.
        </footer>
      </body>
    </html>
  );
}
