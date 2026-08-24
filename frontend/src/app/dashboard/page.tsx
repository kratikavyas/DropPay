"use client";

import React from "react";
import Link from "next/link";
import DropPayApp from "@/components/DropPayApp";
import { ArrowLeft } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 md:py-12 flex flex-col items-center justify-center relative">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/5 via-black to-black" />

      {/* Top back navigation */}
      <div className="w-full max-w-2xl mx-auto mb-6 flex items-center justify-between z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>

        <span className="font-instrument text-lg text-white">DropPay</span>
      </div>

      {/* Main interactive application opened to history */}
      <div className="w-full max-w-2xl z-10">
        <DropPayApp initialTab="history" isModal={false} />
      </div>
    </div>
  );
}
