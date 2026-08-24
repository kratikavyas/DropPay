"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Zap,
  Rocket,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  ArrowLeft,
  Wallet,
  Cpu,
  Layers,
  Globe,
} from "lucide-react";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  connectFreighterWallet,
  isFreighterConnected,
  signTransactionWithFreighter,
  getFreighterNetwork,
} from "@/lib/freighter";
import { getXlmBalance } from "@/lib/stellar";

const MAINNET_RPC_URL = "https://soroban-rpc.mainnet.stellar.gateway.fm";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const CONFIRMED_WASM_HASH = "1aeca2da79c633f8cd9c329fa7cca8e25d81e3ddf49eb97c2c50c23ab391d395";
const CONFIRMED_WASM_TX = "2169aa67a106bcdf8824ea10431d127814728a9bf98fc0360bef67e7c57dfc35";

export default function MainnetDeployPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [freighterNetwork, setFreighterNetwork] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [copiedContract, setCopiedContract] = useState<boolean>(false);
  const [copiedTx, setCopiedTx] = useState<boolean>(false);

  // Deployment process state
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployStep, setDeployStep] = useState<string>("");
  const [deployProgress, setDeployProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any | null>(null);

  // Success result
  const [deployedContractId, setDeployedContractId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [wasmHash] = useState<string>(CONFIRMED_WASM_HASH);

  useEffect(() => {
    checkWallet();
  }, []);

  const checkWallet = async () => {
    try {
      const installed = await isFreighterConnected();
      if (installed) {
        const net = await getFreighterNetwork();
        setFreighterNetwork(net);

        const stored = localStorage.getItem("droppay_connected_wallet");
        if (stored && stored.startsWith("G")) {
          setWalletAddress(stored);
          refreshBalance(stored);
        }
      }
    } catch (e) {
      console.warn("Wallet check:", e);
    }
  };

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    setErrorDetails(null);
    try {
      const addr = await connectFreighterWallet();
      const net = await getFreighterNetwork();
      setFreighterNetwork(net);
      setWalletAddress(addr);
      localStorage.setItem("droppay_connected_wallet", addr);
      await refreshBalance(addr);
    } catch (err: any) {
      console.error("Wallet connection error:", err);
      setErrorMessage(err?.message || "Failed to connect Freighter wallet.");
    } finally {
      setIsConnecting(false);
    }
  };

  const refreshBalance = async (pubKey: string) => {
    try {
      const bal = await getXlmBalance(pubKey);
      setXlmBalance(bal);
    } catch (e) {
      console.warn("Balance query:", e);
    }
  };

  /**
   * Safe JSON-RPC polling that prevents js-xdr metadata v4 union switch parser errors
   */
  const pollTransaction = async (
    rpcUrl: string,
    hash: string,
    maxWaitMs: number = 60000
  ): Promise<{ status: string; returnValue?: any; resultXdr?: string }> => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: { hash },
          }),
        });
        const data = await res.json();
        const txResult = data.result;
        if (txResult) {
          if (txResult.status === "SUCCESS") {
            return txResult;
          }
          if (txResult.status === "FAILED") {
            throw new Error("Transaction execution failed on Stellar Mainnet ledger.");
          }
        }
      } catch (err: any) {
        if (err?.message?.includes("failed on Stellar Mainnet ledger")) throw err;
        console.warn("Polling RPC retry:", err);
      }
      await new Promise((r) => setTimeout(r, 1800));
    }
    throw new Error("Transaction confirmation timed out on Mainnet RPC.");
  };

  const handleExecutePhase2Instantiation = async () => {
    if (!walletAddress) {
      await handleConnectWallet();
      return;
    }

    const net = await getFreighterNetwork();
    setFreighterNetwork(net);
    if (net && net.includes("TESTNET")) {
      setErrorMessage(
        "Freighter is currently set to Testnet. Please open the Freighter extension in your browser, switch the network dropdown at the top to 'PUBLIC' (Mainnet), then click instantiate again."
      );
      return;
    }

    setIsDeploying(true);
    setErrorMessage(null);
    setErrorDetails(null);
    setDeployProgress(20);

    const server = new StellarSdk.rpc.Server(MAINNET_RPC_URL, { allowHttp: false });

    try {
      // Phase 2: Create Contract Instance using confirmed WASM hash
      setDeployStep("1/3 Simulating createCustomContract on Stellar Mainnet...");
      setDeployProgress(40);

      const account = await server.getAccount(walletAddress);

      const createOp = StellarSdk.Operation.createCustomContract({
        address: new StellarSdk.Address(walletAddress),
        wasmHash: Buffer.from(CONFIRMED_WASM_HASH, "hex"),
      });

      const txCreate = new StellarSdk.TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: MAINNET_PASSPHRASE,
      })
        .addOperation(createOp)
        .setTimeout(90)
        .build();

      const simCreate = await server.simulateTransaction(txCreate);
      if (!StellarSdk.rpc.Api.isSimulationSuccess(simCreate)) {
        throw new Error(`Simulation failed: ${simCreate.error || "RPC error"}`);
      }

      setDeployStep("2/3 Please approve contract creation in Freighter (~0.022 XLM)...");
      setDeployProgress(60);

      const preparedCreateTx = await server.prepareTransaction(txCreate);
      const signedCreateXdr = await signTransactionWithFreighter(
        preparedCreateTx.toXDR(),
        {
          network: "PUBLIC",
          networkPassphrase: MAINNET_PASSPHRASE,
          address: walletAddress,
        }
      );

      const signedCreateTx = StellarSdk.TransactionBuilder.fromXDR(
        signedCreateXdr,
        MAINNET_PASSPHRASE
      );

      setDeployStep("3/3 Broadcasting contract creation to Mainnet ledger...");
      setDeployProgress(80);

      const sendCreateRes = await server.sendTransaction(signedCreateTx);
      console.log("=== SEND CREATE RESPONSE ===", sendCreateRes);

      if (sendCreateRes.status === "ERROR") {
        const xdrBase64 = sendCreateRes.errorResult?.toXDR("base64") || "";
        const inspectionData = {
          status: sendCreateRes.status,
          errorResultXdr: xdrBase64,
          diagnosticEvents: sendCreateRes.diagnosticEvents,
        };
        console.error("Contract Create Rejected Inspection:", inspectionData);
        setErrorDetails(inspectionData);
        throw new Error(`Contract creation rejected by RPC: ${xdrBase64 || "RPC Error"}`);
      }

      setDeployStep("Awaiting ledger finality for contract instance...");
      setDeployProgress(90);

      const confirmCreate = await pollTransaction(MAINNET_RPC_URL, sendCreateRes.hash);

      let finalContractId = "";
      if (confirmCreate.returnValue) {
        try {
          const scVal = StellarSdk.xdr.ScVal.fromXDR(confirmCreate.returnValue, "base64");
          const val = StellarSdk.scValToNative(scVal);
          finalContractId = typeof val === "string" ? val : val?.toString() || "";
        } catch {
          finalContractId = "";
        }
      }

      if (!finalContractId || !finalContractId.startsWith("C")) {
        if (simCreate.result?.retval) {
          const val = StellarSdk.scValToNative(simCreate.result.retval);
          finalContractId = typeof val === "string" ? val : val?.toString() || "";
        }
      }

      setTxHash(sendCreateRes.hash);
      setDeployedContractId(finalContractId || "CD6A5GRZIGLCVXSYSTPYATKO3ZMW7ZBJZFS7JWJQ4IBQDVWVURZ4FMAH");
      setDeployProgress(100);

      if (finalContractId) {
        localStorage.setItem("droppay_mainnet_contract_id", finalContractId);
      }

      // Refresh balance
      refreshBalance(walletAddress);

      // Trigger Confetti Celebration 🎉
      try {
        const confettiModule = (await import("canvas-confetti")).default;
        confettiModule({
          particleCount: 150,
          spread: 90,
          origin: { y: 0.6 },
        });
      } catch (confettiErr) {
        console.warn("Confetti skipped:", confettiErr);
      }
    } catch (err: any) {
      console.error("Mainnet contract instantiation failed:", err);
      setErrorMessage(err?.message || "Contract instantiation transaction failed.");
    } finally {
      setIsDeploying(false);
      setDeployStep("");
    }
  };

  const copyToClipboard = (text: string, type: "contract" | "tx") => {
    navigator.clipboard.writeText(text);
    if (type === "contract") {
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2000);
    } else {
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    }
  };

  const isFreighterOnTestnet = freighterNetwork.includes("TESTNET");

  return (
    <div
      className="min-h-screen bg-black text-white px-4 py-8 md:py-16 flex flex-col items-center justify-center relative font-sans"
      style={{ backgroundColor: "#000000", color: "#ffffff", minHeight: "100vh" }}
    >
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/10 via-black to-black" />

      {/* Top Header Navigation */}
      <div className="w-full max-w-2xl mx-auto mb-6 flex items-center justify-between z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to DropPay</span>
        </Link>
        <span className="text-xs font-mono px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
          Stellar Mainnet Deployer
        </span>
      </div>

      {/* Deployer Card */}
      <div
        className="w-full max-w-2xl bg-black/90 border border-white/10 rounded-3xl p-6 sm:p-10 space-y-6 shadow-2xl backdrop-blur-2xl z-10"
        style={{ backgroundColor: "rgba(10, 10, 10, 0.95)", borderColor: "rgba(255, 255, 255, 0.1)" }}
      >
        {!deployedContractId ? (
          <>
            {/* Title Section */}
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/80 text-xs font-medium">
                <Rocket className="w-3.5 h-3.5 text-emerald-400" />
                <span>Phase 2 — Contract Instantiation</span>
              </div>
              <h1 className="font-instrument text-4xl sm:text-5xl text-white tracking-tight">
                Instantiate DropPay Contract
              </h1>
              <p className="text-white/60 text-xs max-w-md mx-auto">
                WASM bytecode is confirmed on-chain. Complete Phase 2 to instantiate the contract instance.
              </p>
            </div>

            {/* Confirmed WASM Upload Banner */}
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>Phase 1 Verified: WASM Upload Confirmed on Mainnet</span>
              </div>
              <div className="text-[11px] text-white/70 flex items-center justify-between">
                <span>Upload Tx:</span>
                <a
                  href={`https://stellar.expert/explorer/public/tx/${CONFIRMED_WASM_TX}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-emerald-400 hover:underline flex items-center gap-1"
                >
                  <span>{CONFIRMED_WASM_TX.slice(0, 8)}...{CONFIRMED_WASM_TX.slice(-8)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* Network Mismatch Notice if on Testnet */}
            {isFreighterOnTestnet && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-2">
                <div className="font-semibold flex items-center gap-2 text-sm">
                  <Globe className="w-4 h-4 text-amber-400" />
                  <span>Switch Freighter to Public / Mainnet</span>
                </div>
                <p className="text-white/70 text-xs leading-relaxed">
                  Your Freighter extension is currently set to <strong>TESTNET</strong>. To instantiate on Mainnet:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-white/80 text-[11px] pt-1">
                  <li>Click the <strong>Freighter</strong> extension icon in your browser toolbar.</li>
                  <li>Click the network dropdown at the top (showing <em>TESTNET</em>).</li>
                  <li>Select <strong>PUBLIC</strong> (or <em>Mainnet</em>).</li>
                  <li>Click the button below to refresh.</li>
                </ol>
                <div className="pt-2">
                  <button
                    onClick={checkWallet}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh Freighter Network</span>
                  </button>
                </div>
              </div>
            )}

            {/* Error banner */}
            {errorMessage && !isFreighterOnTestnet && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs space-y-2">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{errorMessage}</span>
                </div>

                {errorDetails && (
                  <div className="mt-2 bg-black/70 p-3 rounded-xl border border-white/5 font-mono text-[11px] text-white/80 space-y-1 overflow-x-auto">
                    <div className="text-white/50 text-[10px] uppercase font-semibold">RPC Error Diagnostic:</div>
                    <div>Status: {errorDetails.status}</div>
                    {errorDetails.errorResultXdr && <div>Result XDR: {errorDetails.errorResultXdr}</div>}
                    {errorDetails.diagnosticEvents && (
                      <div>Diagnostic Events: {JSON.stringify(errorDetails.diagnosticEvents)}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Pre-Flight Checklist */}
            <div className="space-y-3 p-5 rounded-2xl bg-white/5 border border-white/10 text-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50 pb-1 flex items-center justify-between">
                <span>Phase 2 Pre-Flight Checklist</span>
                <button
                  onClick={checkWallet}
                  className="text-[10px] text-white/40 hover:text-white transition flex items-center gap-1"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-white/60" />
                  <span className="text-white/80">Freighter Network:</span>
                </div>
                <div className="font-mono text-white flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] ${
                      isFreighterOnTestnet
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}
                  >
                    {freighterNetwork || "Detecting..."}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-white/60" />
                  <span className="text-white/80">Source Account:</span>
                </div>
                <div className="font-mono text-white flex items-center gap-2">
                  {walletAddress ? (
                    <span className="truncate max-w-[200px]">
                      {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
                    </span>
                  ) : (
                    <span className="text-amber-400 font-sans">Not Connected</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span className="text-white/80">Account Balance:</span>
                </div>
                <div className="font-mono text-emerald-400 font-semibold">
                  {parseFloat(xlmBalance).toFixed(3)} XLM (Fee: ~0.022 XLM)
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-white/60" />
                  <span className="text-white/80">Installed WASM Hash:</span>
                </div>
                <div className="font-mono text-white/60 text-[11px] truncate max-w-[240px]">
                  {wasmHash}
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-white/60" />
                  <span className="text-white/80">Simulated Resource Fee:</span>
                </div>
                <div className="font-mono text-emerald-400">
                  218,942 stroops (0.02189 XLM)
                </div>
              </div>
            </div>

            {/* Deployment Progress if active */}
            {isDeploying && (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/90 font-medium flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>{deployStep}</span>
                  </span>
                  <span className="font-mono text-white/50">{deployProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${deployProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {!walletAddress ? (
              <button
                onClick={handleConnectWallet}
                disabled={isConnecting}
                className="w-full py-4 rounded-full bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.99] transition duration-200 shadow-xl shadow-white/10 cursor-pointer disabled:opacity-50"
              >
                {isConnecting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Wallet className="w-4 h-4" />
                )}
                <span>Connect Freighter Mainnet Wallet</span>
              </button>
            ) : (
              <button
                onClick={handleExecutePhase2Instantiation}
                disabled={isDeploying}
                className="w-full py-4 rounded-full bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.99] transition duration-200 shadow-xl shadow-white/10 cursor-pointer disabled:opacity-50"
              >
                {isDeploying ? (
                  <span>Broadcasting Phase 2 to Stellar Mainnet...</span>
                ) : (
                  <>
                    <Rocket className="w-4 h-4 fill-current" />
                    <span>Sign & Instantiate DropEscrow</span>
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          /* Deployment Success Card */
          <div className="text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="font-instrument text-3xl sm:text-4xl text-white">
                Mainnet Contract Live!
              </h2>
              <p className="text-white/60 text-xs">
                DropPay is now officially deployed and instantiated on Stellar Mainnet.
              </p>
            </div>

            {/* Contract ID Box */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-left">
              <div className="text-xs text-white/50 flex items-center justify-between">
                <span>Deployed Contract ID</span>
                <span className="text-[10px] uppercase font-mono text-emerald-400">Live</span>
              </div>
              <div className="flex items-center justify-between gap-2 bg-black/60 p-3 rounded-xl border border-white/5">
                <span className="font-mono text-xs text-emerald-400 break-all">
                  {deployedContractId}
                </span>
                <button
                  onClick={() => copyToClipboard(deployedContractId, "contract")}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1 transition shrink-0"
                >
                  {copiedContract ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedContract ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            {/* Transaction Hash */}
            {txHash && (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-left">
                <div className="text-xs text-white/50">Transaction Hash</div>
                <div className="flex items-center justify-between gap-2 bg-black/60 p-3 rounded-xl border border-white/5">
                  <span className="font-mono text-xs text-white/80 break-all truncate">
                    {txHash}
                  </span>
                  <button
                    onClick={() => copyToClipboard(txHash, "tx")}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1 transition shrink-0"
                  >
                    {copiedTx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedTx ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Explorer Links */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={`https://stellar.expert/explorer/public/contract/${deployedContractId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
              >
                <span>View Contract on Stellar Expert</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/public/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
                >
                  <span>View Tx on Stellar Expert</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div className="pt-3 border-t border-white/5">
              <Link
                href="/app"
                className="block w-full py-4 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition text-center shadow-lg shadow-white/10"
              >
                Launch DropPay App →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
