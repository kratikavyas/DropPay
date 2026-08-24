"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowUpRight, Zap, Sparkles } from "lucide-react";
import DropPayApp from "@/components/DropPayApp";

export default function DropPayLandingPage() {
  const [navMounted, setNavMounted] = useState(false);
  const [heroMounted, setHeroMounted] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isAppModalOpen, setIsAppModalOpen] = useState(false);
  const [appModalTab, setAppModalTab] = useState<"create" | "history" | "security">("create");

  // Navbar entrance (after 100ms) & Hero entrance (after 300ms) & scroll tracking
  useEffect(() => {
    const navTimer = setTimeout(() => {
      setNavMounted(true);
    }, 100);

    const heroTimer = setTimeout(() => {
      setHeroMounted(true);
    }, 300);

    const handleScroll = () => {
      if (window.scrollY > 40) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      clearTimeout(navTimer);
      clearTimeout(heroTimer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Lock body scroll when overlay or modal is open
  useEffect(() => {
    if (overlayOpen || isAppModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [overlayOpen, isAppModalOpen]);

  const openAppWithTab = (tab: "create" | "history" | "security" = "create") => {
    setOverlayOpen(false);
    setAppModalTab(tab);
    setIsAppModalOpen(true);
  };

  const navMenuItems = [
    { label: "Create Money Drop", action: () => openAppWithTab("create") },
    { label: "My Active Drops", action: () => openAppWithTab("history") },
    { label: "Zero-Knowledge Escrow", action: () => openAppWithTab("security") },
    { label: "Biometric Passkeys", action: () => openAppWithTab("security") },
    { label: "Launch Full App", action: () => openAppWithTab("create") },
  ];

  return (
    <div className="bg-black text-white min-h-screen w-full relative overflow-x-hidden">
      {/* NAVBAR (fixed) */}
      <header
        className={`fixed top-0 left-0 w-full z-50 transition-colors duration-500 ${
          isScrolled ? "bg-black/80 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:h-20">
          {/* Left — Logo */}
          <Link
            href="/"
            className={`text-white text-xl md:text-2xl font-semibold tracking-tight z-50 transition-all duration-700 ease-entrance flex items-center gap-2 ${
              navMounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
            }`}
            style={{ transitionDelay: navMounted ? "0ms" : "0ms" }}
          >
            <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <span>DropPay</span>
          </Link>

          {/* Center — Desktop Only Pill */}
          <button
            type="button"
            onClick={() => setOverlayOpen((prev) => !prev)}
            className={`hidden md:flex px-5 py-2 rounded-full border border-white/20 text-white/90 text-sm hover:bg-white/10 items-center gap-2 z-50 transition-all duration-700 ease-entrance cursor-pointer ${
              navMounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
            }`}
            style={{ transitionDelay: navMounted ? "200ms" : "0ms" }}
          >
            {overlayOpen ? "Close" : "Navigate"}
          </button>

          {/* Right — Desktop Only "Launch App" */}
          <div
            className={`hidden md:flex items-center gap-3 z-50 transition-all duration-700 ease-entrance ${
              navMounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
            }`}
            style={{ transitionDelay: navMounted ? "400ms" : "0ms" }}
          >
            <button
              onClick={() => openAppWithTab("create")}
              className="px-4 py-2 rounded-full bg-white text-black text-xs font-medium hover:bg-white/90 transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-white/10"
            >
              <span>Launch App</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right — Mobile Hamburger */}
          <button
            type="button"
            onClick={() => setOverlayOpen((prev) => !prev)}
            aria-label="Toggle menu"
            className={`md:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5 z-50 transition-all duration-700 ease-entrance cursor-pointer ${
              navMounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
            }`}
            style={{ transitionDelay: navMounted ? "200ms" : "0ms" }}
          >
            <span
              className={`w-6 h-[2px] bg-white transition-all duration-500 ease-overlay ${
                overlayOpen ? "rotate-45 translate-y-[4px]" : ""
              }`}
            />
            <span
              className={`w-6 h-[2px] bg-white transition-all duration-500 ease-overlay ${
                overlayOpen ? "-rotate-45 -translate-y-[4px]" : ""
              }`}
            />
          </button>
        </div>
      </header>

      {/* FULL-SCREEN OVERLAY MENU */}
      <div
        className={`fixed inset-0 z-40 bg-black flex flex-col items-center justify-center transition-all duration-700 ease-overlay ${
          overlayOpen ? "opacity-100 visible pointer-events-auto" : "opacity-0 invisible pointer-events-none"
        }`}
      >
        <nav className="flex flex-col items-center justify-center gap-7">
          {navMenuItems.map((item, index) => {
            const delay = overlayOpen ? `${150 + index * 80}ms` : "0ms";
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className={`text-white font-instrument text-3xl sm:text-4xl md:text-6xl hover:opacity-60 transition-all duration-600 ease-overlay cursor-pointer ${
                  overlayOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
                style={{ transitionDelay: delay }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* HERO (full viewport) */}
      <section className="relative w-full h-screen overflow-hidden flex items-end justify-center">
        {/* Background video wrapper */}
        <div
          className={`absolute inset-0 transition-all duration-[1400ms] ease-entrance ${
            heroMounted ? "scale-100 opacity-100" : "scale-105 opacity-0"
          }`}
        >
          <video
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260819_212700_3bb9329b-5c50-4257-a09b-ca85cf3654a3.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        {/* Foreground (bottom-centered) */}
        <div className="relative z-10 text-center px-6 pb-16 md:pb-24 max-w-4xl mx-auto">
          {/* Tag pill */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/20 text-white/90 text-xs font-medium mb-4 backdrop-blur-md transition-all duration-900 ease-entrance ${
              heroMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: heroMounted ? "300ms" : "0ms" }}
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span>Non-Custodial Escrow</span>
          </div>

          {/* H1 (Instrument Serif) */}
          <h1
            className={`font-instrument text-white text-[2.5rem] leading-[0.95] sm:text-5xl md:text-6xl lg:text-7xl mb-5 md:mb-6 transition-all duration-900 ease-entrance ${
              heroMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: heroMounted ? "450ms" : "0ms" }}
          >
            Non-custodial money drops
            <br className="hidden sm:block" /> beyond compare
          </h1>

          {/* Subcopy */}
          <p
            className={`text-white/80 text-base md:text-lg mb-8 md:mb-10 max-w-lg mx-auto leading-relaxed transition-all duration-900 ease-entrance ${
              heroMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: heroMounted ? "650ms" : "0ms" }}
          >
            Lock USDC in a zero-knowledge smart contract. Recipients claim in seconds with Face ID. Unclaimed funds auto-refund in 7 days.
          </p>

          {/* CTA: Launch DropPay */}
          <div
            className={`transition-all duration-900 ease-entrance ${
              heroMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
            style={{ transitionDelay: heroMounted ? "850ms" : "0ms" }}
          >
            <button
              type="button"
              onClick={() => openAppWithTab("create")}
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-black text-sm md:text-base font-semibold rounded-full hover:bg-white/90 active:scale-[0.99] transition-all shadow-2xl shadow-white/20 cursor-pointer"
            >
              <span>Create a Money Drop</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Interactive DropPay App Slide-in Modal */}
      {isAppModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <DropPayApp
              initialTab={appModalTab}
              onClose={() => setIsAppModalOpen(false)}
              isModal={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
