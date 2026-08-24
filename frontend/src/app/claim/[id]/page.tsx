"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Zap,
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  ArrowLeft,
  Wallet,
  Clock,
} from "lucide-react";
import { parseSecretFromHash } from "@/lib/crypto";
import {
  fetchDropDetails,
  claimDropWithWallet,
  OnChainDrop,
} from "@/lib/contract";
import { connectFreighterWallet, isFreighterConnected } from "@/lib/freighter";
import {
  STELLAR_NETWORK,
  getTxExplorerUrl,
  getContractExplorerUrl,
  getActiveContractId,
  hasUsdcTrustline,
  addUsdcTrustlineWithWallet,
} from "@/lib/stellar";
import { UsdcIcon } from "@/components/UsdcIcon";

export default function ClaimDropPage() {
  const params = useParams();
  const dropIdStr = params?.id as string;
  const dropId = parseInt(dropIdStr, 10);

  const [secret, setSecret] = useState<string | null>(null);
  const [dropDetails, setDropDetails] = useState<OnChainDrop | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Recipient Wallet State
  const [recipientAddress, setRecipientAddress] = useState<string>("" );
  const [useManualAddress, setUseManualAddress] = useState<boolean>(false);
  const [isConnectingWallet, setIsConnectingWallet] = useState<boolean>(false);
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [isAddingTrustline, setIsAddingTrustline] = useState<boolean>(false);
  const [trustlineSuccess, setTrustlineSuccess] = useState<boolean>(false);

  // Claim process state
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimStage, setClaimStage] = useState<string>("");
  const [claimSuccess, setClaimSuccess] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // 1. Extract secret from URL hash fragment (isolated strictly in client browser memory)
    const sec = parseSecretFromHash();
    setSecret(sec);

    // 2. Check if Freighter is available and retrieve address if connected
    checkFreighter();

    // 3. Load real on-chain drop info from Soroban smart contract
    loadDropInfo();
  }, [dropId]);

  // Check if the recipient wallet has established a USDC trustline
  useEffect(() => {
    const addr = recipientAddress.trim();
    if (addr && addr.startsWith("G") && addr.length === 56) {
      hasUsdcTrustline(addr).then(setHasTrustline);
    } else {
      setHasTrustline(null);
    }
  }, [recipientAddress]);

  const handleRecipientAddTrustline = async () => {
    const addr = recipientAddress.trim();
    if (!addr) {
      setErrorMsg("Please connect or enter your recipient wallet address.");
      return;
    }
    setIsAddingTrustline(true);
    setErrorMsg(null);
    try {
      const res = await addUsdcTrustlineWithWallet(addr);
      if (res.successful) {
        setTrustlineSuccess(true);
        setHasTrustline(true);
        setTimeout(() => setTrustlineSuccess(false), 6000);
      }
    } catch (err: any) {
      console.error("Recipient add trustline error:", err);
      setErrorMsg(err?.message || "Failed to establish USDC trustline in Freighter.");
    } finally {
      setIsAddingTrustline(false);
    }
  };

  const checkFreighter = async () => {
    try {
      const installed = await isFreighterConnected();
      if (installed) {
        const stored = localStorage.getItem("droppay_connected_wallet");
        if (stored && stored.startsWith("G")) {
          setRecipientAddress(stored);
        }
      }
    } catch (e) {
      console.warn("Freighter check error:", e);
    }
  };

  const handleConnectWallet = async () => {
    setIsConnectingWallet(true);
    setErrorMsg(null);
    try {
      const addr = await connectFreighterWallet();
      setRecipientAddress(addr);
      localStorage.setItem("droppay_connected_wallet", addr);
    } catch (err: any) {
      console.error("Wallet connection error:", err);
      setErrorMsg(err?.message || "Failed to connect Freighter wallet.");
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const loadDropInfo = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (!isNaN(dropId)) {
        const details = await fetchDropDetails(dropId);
        if (details) {
          setDropDetails(details);
        } else {
          // Check local history if freshly created in local testing environment
          const history = JSON.parse(localStorage.getItem("droppay_history") || "[]");
          const found = history.find((d: any) => d.dropId === dropId);
          if (found) {
            setDropDetails({
              id: dropId,
              sender: "G... (Local Session)",
              token: "USDC",
              amount: found.amount,
              amountFormatted: found.amount,
              hashLock: found.hashLock,
              expiry: Math.floor((found.createdAt + found.expiryHours * 3600 * 1000) / 1000),
              status: found.status || "Pending",
              recipient: found.recipient || null,
              claimedAt: found.claimedAt || null,
            });
          }
        }
      }
    } catch (e: any) {
      console.error("Error loading drop:", e);
      setErrorMsg(e?.message || "Failed to load drop details from blockchain.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!secret) {
      setErrorMsg("Missing claim secret from URL hash fragment. Please ensure you opened the complete link.");
      return;
    }

    const targetAddress = recipientAddress.trim();
    if (!targetAddress || !targetAddress.startsWith("G") || targetAddress.length !== 56) {
      setErrorMsg("Please connect your Freighter wallet or enter a valid 56-character Stellar public key (G...).");
      return;
    }

    if (hasTrustline === false) {
      setErrorMsg("Your recipient wallet does not have a USDC trustline on Stellar yet. Please click 'Add USDC Trustline' below.");
      return;
    }

    const activeContract = getActiveContractId();
    if (!activeContract) {
      setErrorMsg("DropEscrow contract address is not configured. Please set NEXT_PUBLIC_DROP_CONTRACT_ID or deploy the contract.");
      return;
    }

    setIsClaiming(true);
    setErrorMsg(null);

    try {
      // Step 1: Client builds & signs claim_drop on Soroban smart contract
      setClaimStage("1/2 Please approve the claim transaction in Freighter...");

      const result = await claimDropWithWallet(
        dropId,
        secret,
        targetAddress
      );

      // Step 2: Confirmed on-chain
      setClaimStage("2/2 Confirmed on Stellar blockchain!");
      setTxHash(result.txHash);
      setClaimSuccess(true);

      // Trigger Confetti Celebration 🎉
      try {
        const confettiModule = (await import("canvas-confetti")).default;
        confettiModule({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
        });
      } catch (confettiErr) {
        console.warn("Confetti skipped:", confettiErr);
      }

      // Update local drop history status
      const history = JSON.parse(localStorage.getItem("droppay_history") || "[]");
      const updated = history.map((d: any) =>
        d.dropId === dropId
          ? { ...d, status: "Claimed", recipient: targetAddress, claimedAt: Date.now() }
          : d
      );
      localStorage.setItem("droppay_history", JSON.stringify(updated));
    } catch (err: any) {
      console.error("Claim error:", err);
      setErrorMsg(err?.message || "Failed to execute on-chain claim.");
    } finally {
      setIsClaiming(false);
      setClaimStage("");
    }
  };

  const isExpired = dropDetails ? Date.now() > dropDetails.expiry * 1000 : false;
  const isAlreadyClaimed = dropDetails?.status === "Claimed";
  const isRefunded = dropDetails?.status === "Refunded";

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 md:py-16 flex flex-col items-center justify-center relative">
      {/* Ambient background light */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/5 via-black to-black" />

      {/* Top Bar */}
      <div className="w-full max-w-lg mx-auto mb-6 flex items-center justify-between z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>DropPay</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {STELLAR_NETWORK.isMainnet ? "Stellar Mainnet" : "Stellar Testnet"}
          </span>
          <span className="text-xs font-mono text-white/40">Drop #{dropIdStr || "1"}</span>
        </div>
      </div>

      {/* Main Claim Card */}
      <div className="w-full max-w-lg bg-black/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-2xl z-10">
        {isLoading ? (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-white/60 mx-auto" />
            <div className="text-xs text-white/50">Fetching drop state from Soroban ledger...</div>
          </div>
        ) : !claimSuccess ? (
          <>
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/80 text-xs font-medium mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Non-Custodial Money Drop</span>
              </div>
              <h1 className="font-instrument text-4xl sm:text-5xl text-white tracking-tight">
                Claim Your Drop
              </h1>
              <p className="text-white/60 text-xs">
                Tokens are locked in the DropEscrow smart contract.
              </p>
            </div>

            {/* Status Alert if not Pending */}
            {isAlreadyClaimed && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Drop Already Claimed</span>
                </div>
                <div className="text-[11px] text-emerald-400/80">
                  This drop was already claimed on the blockchain by {dropDetails?.recipient?.slice(0, 8)}...
                </div>
              </div>
            )}

            {isRefunded && (
              <div className="p-4 rounded-2xl bg-white/10 border border-white/20 text-white/70 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  <span>Drop Refunded</span>
                </div>
                <div className="text-[11px] text-white/50">
                  This expired drop has been refunded to the sender.
                </div>
              </div>
            )}

            {isExpired && !isAlreadyClaimed && !isRefunded && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>Claim Window Expired</span>
                </div>
                <div className="text-[11px] text-amber-300/80">
                  The time window for this drop has passed. The sender can reclaim the funds.
                </div>
              </div>
            )}

            {/* Amount Banner */}
            <div className="text-center py-6 px-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                You Received
              </div>
              <div className="text-4xl sm:text-5xl font-extrabold font-mono text-white flex items-center justify-center gap-2">
                <UsdcIcon className="w-9 h-9 sm:w-10 sm:h-10" />
                <span className="text-white/40 font-light">$</span>
                <span>{dropDetails?.amountFormatted || "10.00"}</span>
                <span className="text-xs font-sans font-medium text-white/50 ml-1 px-2.5 py-1 rounded-full bg-white/10">USDC</span>
              </div>
              <div className="text-xs text-emerald-400 font-medium flex items-center justify-center gap-1 pt-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Soroban Escrow #{dropId}</span>
              </div>
            </div>

            {/* Error Message if any */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Recipient Wallet Section */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-white" />
                  <span>Recipient Address</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseManualAddress(!useManualAddress)}
                  className="text-[11px] text-white/40 hover:text-white transition"
                >
                  {useManualAddress ? "Use Freighter" : "Enter Address Manually"}
                </button>
              </div>

              {!useManualAddress ? (
                recipientAddress ? (
                  <div className="text-xs font-mono text-white/80 bg-black/60 p-2.5 rounded-xl truncate border border-white/5 flex items-center justify-between">
                    <span>{recipientAddress}</span>
                    <button
                      onClick={() => setRecipientAddress("")}
                      className="text-white/40 hover:text-white text-[10px] ml-2"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectWallet}
                    disabled={isConnectingWallet}
                    className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    {isConnectingWallet ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wallet className="w-3.5 h-3.5" />
                    )}
                    <span>Connect Freighter Wallet to Receive</span>
                  </button>
                )
              ) : (
                <input
                  type="text"
                  placeholder="G... (56-character Stellar Public Key)"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-2.5 px-3 font-mono text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 transition"
                />
              )}

              {/* Recipient Trustline Success Notification */}
              {trustlineSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>USDC Trustline established! You can now claim your funds.</span>
                </div>
              )}

              {/* Recipient Trustline Missing Banner */}
              {recipientAddress && hasTrustline === false && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <UsdcIcon className="w-3.5 h-3.5" />
                      <span>USDC Trustline Required to Claim</span>
                    </span>
                    <span className="text-[10px] font-mono text-amber-400/80">Fee: ~0.001 XLM</span>
                  </div>
                  <p className="text-white/70 text-[11px] leading-relaxed">
                    This recipient account needs a one-time trustline before receiving Mainnet USDC.
                  </p>
                  <button
                    type="button"
                    onClick={handleRecipientAddTrustline}
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
            </div>

            {/* Claim Action Button */}
            {recipientAddress && hasTrustline === false ? (
              <button
                onClick={handleRecipientAddTrustline}
                disabled={isAddingTrustline}
                className="w-full py-4 rounded-full bg-amber-400 hover:bg-amber-300 text-black font-semibold text-base flex items-center justify-center gap-2 transition duration-200 shadow-xl shadow-amber-500/20 cursor-pointer disabled:opacity-50"
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
                onClick={handleClaim}
                disabled={isClaiming || !secret || isExpired || isAlreadyClaimed || isRefunded}
                className="w-full py-4 rounded-full bg-white text-black font-semibold text-base flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.99] transition duration-200 shadow-xl shadow-white/10 cursor-pointer disabled:opacity-50"
              >
                {isClaiming ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="animate-spin w-4 h-4" />
                    <span>{claimStage || "Processing On-Chain Claim..."}</span>
                  </span>
                ) : isAlreadyClaimed ? (
                  <span>Already Claimed</span>
                ) : isExpired ? (
                  <span>Drop Expired</span>
                ) : (
                  <>
                    <Zap className="w-5 h-5 fill-current" />
                    <span>Claim ${dropDetails?.amountFormatted || "10.00"} USDC</span>
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          /* Claim Success View */
          <div className="text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="font-instrument text-3xl sm:text-4xl text-white">Claim Successful!</h2>
              <p className="text-white/60 text-xs">
                ${dropDetails?.amountFormatted || "10.00"} USDC was released from escrow to your wallet.
              </p>
            </div>

            {/* Recipient Account Box */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-left">
              <div className="text-xs text-white/50">Recipient Account</div>
              <div className="text-xs font-mono text-white/80 truncate">
                {recipientAddress}
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400 pt-1 flex items-center gap-1.5">
                <UsdcIcon className="w-5 h-5" />
                <span>+${dropDetails?.amountFormatted || "10.00"}</span>
                <span className="text-xs font-sans text-emerald-400/70 font-normal">USDC</span>
              </div>
            </div>

            {/* Stellar Expert Explorer Link */}
            {txHash && (
              <a
                href={getTxExplorerUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition"
              >
                <span>View Transaction on Stellar Expert</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <div className="pt-2">
              <Link
                href="/app"
                className="block w-full py-3.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition text-center"
              >
                Create Your Own Drop →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
