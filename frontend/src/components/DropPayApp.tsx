"use client";

import React, { useState, useEffect } from "react";
import {
  Zap,
  Clock,
  Copy,
  Check,
  Share2,
  ExternalLink,
  ShieldCheck,
  Wallet,
  Sparkles,
  ArrowRight,
  RefreshCw,
  X,
  History,
  Lock,
  Fingerprint,
  QrCode as QrIcon,
  Shield,
  ArrowUpRight,
  HelpCircle,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { generateDropSecret, computeHashLock, buildClaimUrl } from "@/lib/crypto";
import {
  STELLAR_NETWORK,
  getXlmBalance,
  getUsdcBalance,
  getTxExplorerUrl,
  getContractExplorerUrl,
  hasUsdcTrustline,
  addUsdcTrustlineWithWallet,
} from "@/lib/stellar";
import {
  createDropOnChain,
  refundDropWithWallet,
  fetchDropDetails,
  OnChainDrop,
} from "@/lib/contract";
import { connectFreighterWallet, isFreighterConnected } from "@/lib/freighter";
import { UsdcIcon } from "@/components/UsdcIcon";
import QRCode from "qrcode";
import confetti from "canvas-confetti";

interface CreatedDropInfo {
  dropId: number;
  amount: string;
  secret: string;
  hashLock: string;
  expiryHours: number;
  claimUrl: string;
  txHash: string;
  createdAt: number;
  note?: string;
}

interface DropItem extends CreatedDropInfo {
  status: "Pending" | "Claimed" | "Refunded";
  recipient?: string;
  claimedAt?: number;
}

interface DropPayAppProps {
  initialTab?: "create" | "history" | "security";
  onClose?: () => void;
  isModal?: boolean;
}

export default function DropPayApp({
  initialTab = "create",
  onClose,
  isModal = false,
}: DropPayAppProps) {
  const [activeTab, setActiveTab] = useState<"create" | "history" | "security">(initialTab);

  // Form State
  const [amount, setAmount] = useState<string>("10");
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [note, setNote] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [creationStep, setCreationStep] = useState<string>("");
  const [creationProgress, setCreationProgress] = useState<number>(0);
  const [createError, setCreateError] = useState<string | null>(null);

  // Sender Wallet State (Freighter)
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [usdcBalance, setUsdcBalance] = useState<string>("0");
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [isAddingTrustline, setIsAddingTrustline] = useState<boolean>(false);
  const [trustlineSuccess, setTrustlineSuccess] = useState<boolean>(false);
  const [isConnectingWallet, setIsConnectingWallet] = useState<boolean>(false);
  const [walletCopied, setWalletCopied] = useState<boolean>(false);

  // Result state
  const [createdDrop, setCreatedDrop] = useState<CreatedDropInfo | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [showQr, setShowQr] = useState<boolean>(false);

  // History State
  const [drops, setDrops] = useState<DropItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "pending" | "claimed" | "refunded">("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isRefunding, setIsRefunding] = useState<number | null>(null);
  const [isSyncingHistory, setIsSyncingHistory] = useState<boolean>(false);

  // Passkey Test State
  const [passkeyTested, setPasskeyTested] = useState<boolean>(false);

  useEffect(() => {
    // Check if Freighter is available and auto-reconnect if previously approved
    checkFreighter();
    loadDrops();
  }, []);

  const checkFreighter = async () => {
    try {
      const installed = await isFreighterConnected();
      if (installed) {
        // Attempt silent connect if user has previously allowed
        const stored = localStorage.getItem("droppay_connected_wallet");
        if (stored && stored.startsWith("G")) {
          setWalletAddress(stored);
          refreshBalances(stored);
        }
      }
    } catch (e) {
      console.warn("Freighter check:", e);
    }
  };

  const handleConnectWallet = async () => {
    setIsConnectingWallet(true);
    setCreateError(null);
    try {
      const addr = await connectFreighterWallet();
      setWalletAddress(addr);
      localStorage.setItem("droppay_connected_wallet", addr);
      await refreshBalances(addr);
    } catch (err: any) {
      console.error("Wallet connection error:", err);
      setCreateError(err?.message || "Failed to connect Freighter wallet.");
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleDisconnectWallet = () => {
    setWalletAddress(null);
    localStorage.removeItem("droppay_connected_wallet");
    setXlmBalance("0");
    setUsdcBalance("0");
    setHasTrustline(null);
  };

  const refreshBalances = async (pubKey: string) => {
    try {
      const [xlm, usdc, trustline] = await Promise.all([
        getXlmBalance(pubKey),
        getUsdcBalance(pubKey),
        hasUsdcTrustline(pubKey),
      ]);
      setXlmBalance(xlm);
      setUsdcBalance(usdc);
      setHasTrustline(trustline);
    } catch (e) {
      console.error("Error refreshing balances:", e);
    }
  };

  const handleAddTrustline = async () => {
    if (!walletAddress) {
      await handleConnectWallet();
      return;
    }

    setIsAddingTrustline(true);
    setCreateError(null);
    try {
      const res = await addUsdcTrustlineWithWallet(walletAddress);
      if (res.successful) {
        setTrustlineSuccess(true);
        setHasTrustline(true);
        await refreshBalances(walletAddress);
        setTimeout(() => setTrustlineSuccess(false), 6000);
      }
    } catch (err: any) {
      console.error("Add trustline error:", err);
      setCreateError(err?.message || "Failed to add USDC trustline.");
    } finally {
      setIsAddingTrustline(false);
    }
  };

  const loadDrops = async () => {
    const raw = localStorage.getItem("droppay_history");
    if (!raw) return;
    try {
      const localDrops: DropItem[] = JSON.parse(raw);
      setDrops(localDrops);

      // Revalidate pending drops against real Soroban smart contract state
      if (localDrops.length > 0 && STELLAR_NETWORK.contractId) {
        setIsSyncingHistory(true);
        const updated = await Promise.all(
          localDrops.map(async (d) => {
            if (d.status === "Pending") {
              const onChain = await fetchDropDetails(d.dropId);
              if (onChain) {
                return {
                  ...d,
                  status: onChain.status,
                  recipient: onChain.recipient || d.recipient,
                  claimedAt: onChain.claimedAt || d.claimedAt,
                };
              }
            }
            return d;
          })
        );
        setDrops(updated);
        localStorage.setItem("droppay_history", JSON.stringify(updated));
        setIsSyncingHistory(false);
      }
    } catch (e) {
      console.error("Error loading drops:", e);
      setIsSyncingHistory(false);
    }
  };

  const handleCreateDrop = async () => {
    if (!walletAddress) {
      await handleConnectWallet();
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setCreateError("Please enter a valid drop amount.");
      return;
    }

    if (!STELLAR_NETWORK.contractId) {
      setCreateError(
        "DropEscrow contract is not configured. Please set NEXT_PUBLIC_DROP_CONTRACT_ID."
      );
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    setCreationProgress(15);

    try {
      // Step 1: Generate Client-side 256-bit secret (isolated in client memory)
      setCreationStep("1/3 Generating 256-bit cryptographic secret...");
      setCreationProgress(35);
      await new Promise((r) => setTimeout(r, 300));
      const secret = generateDropSecret();

      // Step 2: Compute SHA-256 Hashlock
      setCreationStep("2/3 Computing SHA-256 hash commitment...");
      setCreationProgress(60);
      const { hashBytes, hashHex } = await computeHashLock(secret);

      // Step 3: Sign with Freighter & Broadcast on-chain
      setCreationStep("3/3 Please approve transaction in Freighter...");
      setCreationProgress(80);

      const durationSeconds = expiryDays * 24 * 60 * 60;
      const { dropId, txHash } = await createDropOnChain(
        walletAddress,
        STELLAR_NETWORK.usdcContractId,
        numAmount,
        hashBytes,
        durationSeconds
      );

      setCreationStep("Lock confirmed on Stellar blockchain!");
      setCreationProgress(95);

      // Step 4: Build shareable URL with secret strictly in URL hash fragment
      const claimUrl = buildClaimUrl(dropId, secret);

      // Step 5: Generate QR Code
      const qr = await QRCode.toDataURL(claimUrl, {
        margin: 1,
        width: 280,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(qr);

      const dropInfo: CreatedDropInfo = {
        dropId,
        amount: numAmount.toFixed(2),
        secret,
        hashLock: hashHex,
        expiryHours: expiryDays * 24,
        claimUrl,
        txHash,
        createdAt: Date.now(),
        note: note.trim() || undefined,
      };

      // Save real drop to local history
      const existingHistory: DropItem[] = JSON.parse(
        localStorage.getItem("droppay_history") || "[]"
      );
      existingHistory.unshift({
        ...dropInfo,
        status: "Pending",
      });
      localStorage.setItem("droppay_history", JSON.stringify(existingHistory));
      loadDrops();

      setCreationProgress(100);
      setCreatedDrop(dropInfo);
      refreshBalances(walletAddress);

      // Trigger Confetti Celebration 🎉
      confetti({
        particleCount: 100,
        spread: 75,
        origin: { y: 0.6 },
      });
    } catch (error: any) {
      console.error("Drop creation failed:", error);
      setCreateError(error?.message || "Failed to create on-chain drop.");
    } finally {
      setIsCreating(false);
      setCreationStep("");
    }
  };

  const copyToClipboard = (text: string, dropId?: number) => {
    navigator.clipboard.writeText(text);
    if (dropId !== undefined) {
      setCopiedId(dropId);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyWallet = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setWalletCopied(true);
    setTimeout(() => setWalletCopied(false), 2000);
  };

  const handleRefund = async (dropId: number) => {
    if (!walletAddress) {
      alert("Please connect your Freighter wallet to execute the refund.");
      return;
    }

    setIsRefunding(dropId);
    try {
      await refundDropWithWallet(dropId, walletAddress);
      const updated = drops.map((d) =>
        d.dropId === dropId ? { ...d, status: "Refunded" as const } : d
      );
      setDrops(updated);
      localStorage.setItem("droppay_history", JSON.stringify(updated));
      await refreshBalances(walletAddress);
      alert(`Drop #${dropId} successfully refunded to your wallet!`);
    } catch (err: any) {
      console.error("Refund error:", err);
      alert("Refund failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsRefunding(null);
    }
  };

  const getTimeRemaining = (createdAt: number, expiryHours: number) => {
    const expiryTime = createdAt + expiryHours * 3600 * 1000;
    const diff = expiryTime - Date.now();
    if (diff <= 0) return "Expired (Ready to Refund)";
    const days = Math.floor(diff / (24 * 3600 * 1000));
    const hours = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
    if (days > 0) return `${days}d ${hours}h remaining`;
    const mins = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
    return `${hours}h ${mins}m remaining`;
  };

  const filteredDrops = drops.filter((d) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "pending") return d.status === "Pending";
    if (historyFilter === "claimed") return d.status === "Claimed";
    if (historyFilter === "refunded") return d.status === "Refunded";
    return true;
  });

  const totalLocked = drops
    .filter((d) => d.status === "Pending")
    .reduce((acc, d) => acc + parseFloat(d.amount), 0);

  const claimedCount = drops.filter((d) => d.status === "Claimed").length;

  return (
    <div className="w-full max-w-4xl mx-auto text-white">
      {/* Top Header Card */}
      <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 mb-6 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Non-Custodial Escrow
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {STELLAR_NETWORK.isMainnet ? "Stellar Mainnet" : "Stellar Testnet"}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-instrument font-normal tracking-tight text-white">
              DropPay Smart Contract
            </h2>
            <p className="text-xs text-white/60">
              Send tokens via one-time claim links. Recipients claim via Face ID. Auto-refunds on expiry.
            </p>
          </div>

          {/* Freighter Wallet Connection Box */}
          <div className="flex items-center gap-3">
            {walletAddress ? (
              <div className="bg-black/60 border border-white/10 rounded-2xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white">
                  <Wallet className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono font-medium text-white">
                      {walletAddress.slice(0, 5)}...{walletAddress.slice(-4)}
                    </span>
                    <button
                      onClick={copyWallet}
                      className="text-white/40 hover:text-white transition"
                      title="Copy Address"
                    >
                      {walletCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-[11px] text-white/50 flex items-center gap-2">
                    <span>{parseFloat(xlmBalance).toFixed(2)} XLM</span>
                    {parseFloat(usdcBalance) > 0 ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-1">
                        <UsdcIcon className="w-3 h-3" />
                        <span>${parseFloat(usdcBalance).toFixed(2)}</span>
                        <span className="text-[10px] text-emerald-400/70 font-sans">USDC</span>
                      </span>
                    ) : hasTrustline === false ? (
                      <button
                        onClick={handleAddTrustline}
                        disabled={isAddingTrustline}
                        className="text-amber-400 hover:text-amber-300 font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 transition cursor-pointer"
                        title="Click to add USDC trustline"
                      >
                        {isAddingTrustline ? "Enabling..." : "+ USDC Trustline"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={handleDisconnectWallet}
                  className="text-xs text-white/40 hover:text-rose-400 transition ml-1 px-2 py-1"
                  title="Disconnect"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                disabled={isConnectingWallet}
                className="px-5 py-3 rounded-2xl bg-white text-black font-semibold text-xs flex items-center gap-2 hover:bg-white/90 active:scale-[0.98] transition cursor-pointer disabled:opacity-50 shadow-lg shadow-white/5"
              >
                {isConnectingWallet ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wallet className="w-3.5 h-3.5" />
                )}
                <span>Connect Freighter Wallet</span>
              </button>
            )}

            {isModal && onClose && (
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-6 pt-5 border-t border-white/5">
          <button
            onClick={() => setActiveTab("create")}
            className={`px-4 py-2 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${activeTab === "create"
                ? "bg-white text-black font-semibold shadow-md shadow-white/10"
                : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Create Drop</span>
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${activeTab === "history"
                ? "bg-white text-black font-semibold shadow-md shadow-white/10"
                : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Active Drops & Escrows</span>
            {drops.filter((d) => d.status === "Pending").length > 0 && (
              <span className="w-5 h-5 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-mono">
                {drops.filter((d) => d.status === "Pending").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("security")}
            className={`px-4 py-2 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${activeTab === "security"
                ? "bg-white text-black font-semibold shadow-md shadow-white/10"
                : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Zero-Knowledge Architecture</span>
          </button>
        </div>
      </div>

      {/* CREATE TAB */}
      {activeTab === "create" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Form or Result */}
          <div className="lg:col-span-7 space-y-6">
            {!createdDrop ? (
              <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
                <div className="space-y-1">
                  <h3 className="text-xl font-instrument text-white">Create On-Chain Money Drop</h3>
                  <p className="text-xs text-white/50">
                    Funds will be locked in the Soroban contract. The claim secret stays in the link hash.
                  </p>
                </div>

                {/* Trustline Success Alert */}
                {trustlineSuccess && (
                  <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>USDC Trustline established successfully on Stellar Mainnet!</span>
                  </div>
                )}

                {/* Missing Trustline Notice & Action */}
                {walletAddress && hasTrustline === false && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-amber-300">
                        <UsdcIcon className="w-4 h-4" />
                        <span>USDC Trustline Required</span>
                      </div>
                      <span className="text-[10px] font-mono text-amber-400/80">Fee: ~0.001 XLM</span>
                    </div>
                    <p className="text-white/70 text-[11px] leading-relaxed">
                      Your Stellar account needs a one-time trustline before holding or transferring Mainnet USDC.
                    </p>
                    <button
                      type="button"
                      onClick={handleAddTrustline}
                      disabled={isAddingTrustline}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 shadow-lg shadow-amber-500/10"
                    >
                      {isAddingTrustline ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Approve in Freighter...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Add USDC Trustline</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {createError && (
                  <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{createError}</span>
                  </div>
                )}

                {/* Amount Field */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/70 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <UsdcIcon className="w-3.5 h-3.5" />
                      <span>Drop Amount (USDC)</span>
                    </span>
                    <span className="text-white/40">Soroban Token Escrow</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-mono text-lg">
                      $
                    </span>
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="25.00"
                      className="w-full bg-black/60 border border-white/10 rounded-2xl py-3.5 pl-9 pr-24 font-mono text-xl text-white focus:outline-none focus:border-white/40 transition"
                    />
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/10 border border-white/5 pointer-events-none">
                      <UsdcIcon className="w-4 h-4" />
                      <span className="text-xs font-semibold text-white tracking-wide">USDC</span>
                    </div>
                  </div>
                  {/* Preset amounts */}
                  <div className="flex gap-2 pt-1">
                    {["5", "10", "25", "50", "100"].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAmount(val)}
                        className={`px-3 py-1 rounded-xl text-xs font-mono transition cursor-pointer border ${amount === val
                            ? "bg-white/20 border-white/40 text-white"
                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                          }`}
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Expiry Duration */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-white/40" />
                      <span>Claim Window (Auto-Refund)</span>
                    </label>
                    <span className="text-xs text-white/40">100% Reclaim Guarantee</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { days: 1, label: "24 Hours" },
                      { days: 3, label: "3 Days" },
                      { days: 7, label: "7 Days" },
                      { days: 30, label: "30 Days" },
                    ].map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setExpiryDays(opt.days)}
                        className={`py-2.5 px-2 rounded-2xl text-xs font-medium transition cursor-pointer border text-center ${expiryDays === opt.days
                            ? "bg-white text-black font-semibold border-white"
                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Memo / Note */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/70">
                    Memo / Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Dinner split, Stellar hackathon bounty, Gift"
                    className="w-full bg-black/60 border border-white/10 rounded-2xl py-3 px-4 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 transition"
                  />
                </div>

                {/* Progress bar if creating */}
                {isCreating && (
                  <div className="space-y-2 bg-white/5 p-4 rounded-2xl border border-white/10">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/80 font-medium flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        <span>{creationStep}</span>
                      </span>
                      <span className="font-mono text-white/50">{creationProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white transition-all duration-300"
                        style={{ width: `${creationProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                {walletAddress && hasTrustline === false ? (
                  <button
                    onClick={handleAddTrustline}
                    disabled={isAddingTrustline}
                    className="w-full py-4 rounded-full bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm flex items-center justify-center gap-2 transition duration-200 shadow-xl shadow-amber-500/20 cursor-pointer disabled:opacity-50"
                  >
                    {isAddingTrustline ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Approve Trustline in Freighter...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Add USDC Trustline First (~0.001 XLM)</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleCreateDrop}
                    disabled={isCreating}
                    className="w-full py-4 rounded-full bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.99] transition duration-200 shadow-xl shadow-white/10 cursor-pointer disabled:opacity-50"
                  >
                    {isCreating ? (
                      <span>Executing On-Chain Transaction...</span>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 fill-current" />
                        <span>
                          {walletAddress
                            ? `Sign & Lock $${amount} USDC in Escrow`
                            : "Connect Freighter to Create Drop"}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              /* Created Drop Result View */
              <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Drop #{createdDrop.dropId} Live On-Chain</span>
                  </div>
                  <button
                    onClick={() => {
                      setCreatedDrop(null);
                      setAmount("10");
                    }}
                    className="text-xs text-white/50 hover:text-white transition"
                  >
                    + Create Another
                  </button>
                </div>

                <div className="space-y-1 text-center py-2">
                  <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                    Escrow Locked
                  </div>
                  <div className="text-4xl font-extrabold font-mono text-white flex items-center justify-center gap-2">
                    <UsdcIcon className="w-8 h-8" />
                    <span>${createdDrop.amount}</span>
                    <span className="text-base text-white/60 font-sans font-normal">USDC</span>
                  </div>
                  <p className="text-xs text-white/60 max-w-md mx-auto pt-1">
                    Funds are secured in Soroban smart contract. Anyone with this link can claim the funds in seconds with Face ID.
                  </p>
                </div>

                {/* Shareable Link Box */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/70">
                    Shareable Claim Link (Zero-Knowledge Hash Fragment)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={createdDrop.claimUrl}
                      className="w-full bg-black/80 border border-white/10 rounded-2xl py-3 px-4 font-mono text-xs text-white/80 truncate focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(createdDrop.claimUrl)}
                      className="px-4 py-3 rounded-2xl bg-white text-black font-semibold text-xs flex items-center gap-1.5 hover:bg-white/90 transition shrink-0 cursor-pointer shadow-lg shadow-white/5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                {/* QR Code Toggle */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
                      <QrIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">Scan & Claim QR Code</div>
                      <div className="text-[11px] text-white/50">
                        Scan from mobile camera to claim instantly with Face ID.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowQr(!showQr)}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition cursor-pointer shrink-0"
                  >
                    {showQr ? "Hide QR" : "Show QR"}
                  </button>
                </div>

                {showQr && qrDataUrl && (
                  <div className="p-6 bg-white rounded-2xl flex flex-col items-center justify-center space-y-3">
                    <img src={qrDataUrl} alt="Drop Claim QR" className="w-52 h-52 rounded-lg" />
                    <p className="text-black/60 text-xs font-medium text-center">
                      Point iPhone/Android camera to open 1-tap claim
                    </p>
                  </div>
                )}

                {/* Transaction & Contract Explorer Links */}
                <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                  <a
                    href={getTxExplorerUrl(createdDrop.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-white/70 hover:text-white transition"
                  >
                    <span>View Transaction on Stellar Expert</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href={createdDrop.claimUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition font-medium"
                  >
                    <span>Test Claim Page</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Contract Metrics & How it Works */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 backdrop-blur-xl shadow-2xl space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Escrow Guarantees
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-white">Trustless Smart Contract</div>
                    <div className="text-white/50">
                      Tokens are locked directly on Soroban ledger, not on our servers.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-white">Zero-Knowledge Links</div>
                    <div className="text-white/50">
                      The 256-bit secret is in the URL hash and is never logged or transmitted.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
                  <Clock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-white">Guaranteed Reclaim</div>
                    <div className="text-white/50">
                      If unclaimed within the chosen duration, the sender reclaims 100% of funds.
                    </div>
                  </div>
                </div>
              </div>

              {STELLAR_NETWORK.contractId && (
                <div className="pt-3 border-t border-white/5">
                  <a
                    href={getContractExplorerUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition"
                  >
                    <span>View DropEscrow Contract on Explorer</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
              <div className="text-xs text-white/50 font-medium">Currently Locked in Escrow</div>
              <div className="text-2xl font-bold font-mono text-white mt-1 flex items-center gap-1.5">
                <UsdcIcon className="w-5 h-5" />
                <span>${totalLocked.toFixed(2)}</span>
                <span className="text-xs font-sans text-white/40">USDC</span>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
              <div className="text-xs text-white/50 font-medium">Total Drops Created</div>
              <div className="text-2xl font-bold font-mono text-white mt-1">{drops.length}</div>
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
              <div className="text-xs text-white/50 font-medium">Successfully Claimed</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{claimedCount}</div>
            </div>
          </div>

          {/* Drops Table */}
          <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 backdrop-blur-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-instrument text-white">Your Money Drops</h3>
                {isSyncingHistory && (
                  <span className="text-[10px] font-mono text-white/40 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Syncing Soroban state...</span>
                  </span>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                {(["all", "pending", "claimed", "refunded"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setHistoryFilter(filter)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition cursor-pointer ${historyFilter === filter
                        ? "bg-white text-black font-semibold"
                        : "text-white/60 hover:text-white"
                      }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {filteredDrops.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 mx-auto">
                  <History className="w-5 h-5" />
                </div>
                <div className="text-xs text-white/50">No drops found in this filter.</div>
                <button
                  onClick={() => setActiveTab("create")}
                  className="text-xs text-white font-medium underline underline-offset-4"
                >
                  Create your first Drop →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDrops.map((drop) => {
                  const expired = Date.now() > drop.createdAt + drop.expiryHours * 3600 * 1000;
                  return (
                    <div
                      key={drop.dropId}
                      className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-base text-white flex items-center gap-1.5">
                            <UsdcIcon className="w-4 h-4" />
                            <span>${drop.amount}</span>
                            <span className="text-xs text-white/50 font-sans font-normal">USDC</span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${drop.status === "Claimed"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : drop.status === "Refunded"
                                  ? "bg-white/10 text-white/50 border border-white/10"
                                  : expired
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              }`}
                          >
                            {drop.status === "Pending" && expired ? "Expired (Refundable)" : drop.status}
                          </span>
                          <span className="text-[11px] font-mono text-white/40">
                            Drop #{drop.dropId}
                          </span>
                        </div>
                        <div className="text-[11px] text-white/50 flex items-center gap-2 flex-wrap">
                          <span>
                            {drop.status === "Pending"
                              ? getTimeRemaining(drop.createdAt, drop.expiryHours)
                              : drop.status === "Claimed"
                                ? `Claimed • ${new Date(drop.claimedAt || drop.createdAt).toLocaleDateString()}`
                                : "Refunded to sender"}
                          </span>
                          {drop.note && <span>• "{drop.note}"</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {drop.status === "Pending" && (
                          <button
                            onClick={() => copyToClipboard(drop.claimUrl, drop.dropId)}
                            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white transition flex items-center gap-1 cursor-pointer"
                          >
                            {copiedId === drop.dropId ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedId === drop.dropId ? "Copied" : "Copy Link"}</span>
                          </button>
                        )}

                        {drop.status === "Pending" && expired && (
                          <button
                            onClick={() => handleRefund(drop.dropId)}
                            disabled={isRefunding === drop.dropId}
                            className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-300 transition cursor-pointer disabled:opacity-50"
                          >
                            {isRefunding === drop.dropId ? "Refunding..." : "Reclaim 100% Funds"}
                          </button>
                        )}

                        {drop.txHash && (
                          <a
                            href={getTxExplorerUrl(drop.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition"
                            title="View on Stellar Expert"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECURITY TAB */}
      {activeTab === "security" && (
        <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="space-y-1">
            <h3 className="text-xl font-instrument text-white">Zero-Knowledge Security Architecture</h3>
            <p className="text-xs text-white/50">
              How DropPay guarantees mathematical security without custodial risk.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">URL Hash Isolation</div>
              <p className="text-[11px] text-white/60 leading-relaxed">
                The 256-bit claim secret is kept strictly in the URL hash (
                <code className="text-white/80">#secret=...</code>) and is never sent across web servers or CDN logs.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white">
                <Fingerprint className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">Biometric Passkey Claim</div>
              <p className="text-[11px] text-white/60 leading-relaxed">
                Recipients claim with Face ID / Touch ID via WebAuthn P-256. No seed phrases, extensions, or account setups required.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white">
                <Clock className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">Cryptographic Timeout</div>
              <p className="text-[11px] text-white/60 leading-relaxed">
                If the recipient doesn't claim before the chosen expiration, the sender reclaims 100% of their deposit in 1 click.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
