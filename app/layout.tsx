import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Authorization Assurance Lab",
  description: "Mutation testing for authorization rules: generated tests, controlled policy mutations, real evidence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white">AA</span>
              Authorization Assurance Lab
            </Link>
            <div className="flex gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Evidence</Link>
              <Link href="/spec" className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">Specification explorer</Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
