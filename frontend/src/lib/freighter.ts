import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction,
  getNetwork,
} from "@stellar/freighter-api";
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./stellar";

export interface FreighterSignOptions {
  network?: string;
  networkPassphrase?: string;
  address?: string;
}

export async function isFreighterConnected(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = await isConnected();
    return !!result;
  } catch {
    return false;
  }
}

export async function getFreighterNetwork(): Promise<string> {
  if (typeof window === "undefined") return "";
  try {
    const net: any = await getNetwork();
    if (typeof net === "string") return net.toUpperCase();
    if (net && typeof net === "object" && "network" in net) {
      return (net as any).network?.toUpperCase() || "";
    }
  } catch (e) {
    console.warn("getNetwork error:", e);
  }
  return "";
}

export async function connectFreighterWallet(): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Cannot connect wallet in non-browser environment");
  }

  const installed = await isConnected();
  if (!installed) {
    throw new Error("Freighter wallet extension is not installed. Please install it from https://freighter.app");
  }

  try {
    const accessRes: any = await requestAccess();
    if (accessRes) {
      if (typeof accessRes === "object" && accessRes.address) {
        return accessRes.address;
      }
      if (typeof accessRes === "string" && accessRes.startsWith("G")) {
        return accessRes;
      }
    }
  } catch (err: any) {
    if (err?.message?.includes("User declined")) {
      throw new Error("User declined access to Freighter wallet");
    }
  }

  // Fallback to getAddress
  try {
    const addrRes: any = await getAddress();
    if (addrRes) {
      if (typeof addrRes === "object" && addrRes.address) {
        return addrRes.address;
      }
      if (typeof addrRes === "string" && addrRes.startsWith("G")) {
        return addrRes;
      }
    }
  } catch (e) {
    console.warn("getAddress fallback error:", e);
  }

  throw new Error("Failed to retrieve public key from Freighter wallet");
}

export async function signTransactionWithFreighter(
  txXdr: string,
  options?: FreighterSignOptions | string
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Cannot sign transaction in non-browser environment");
  }

  let networkPassphrase = STELLAR_NETWORK.passphrase;
  let network = STELLAR_NETWORK.isMainnet ? "PUBLIC" : "TESTNET";
  let address: string | undefined = undefined;

  if (typeof options === "string") {
    networkPassphrase = options;
  } else if (options && typeof options === "object") {
    if (options.networkPassphrase) networkPassphrase = options.networkPassphrase;
    if (options.network) network = options.network;
    if (options.address) address = options.address;
  }

  const signOpts: any = {
    network,
    networkPassphrase,
  };
  if (address) {
    signOpts.address = address;
  }

  const signedResult: any = await signTransaction(txXdr, signOpts);

  if (!signedResult) {
    throw new Error("Signing rejected or failed in Freighter wallet");
  }

  let signedTxXdr = "";
  if (typeof signedResult === "string") {
    signedTxXdr = signedResult;
  } else if (typeof signedResult === "object" && signedResult.signedTxXdr) {
    signedTxXdr = signedResult.signedTxXdr;
  } else {
    signedTxXdr = txXdr;
  }

  // Verify that the returned transaction envelope has valid signatures
  try {
    const parsedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
    if (!parsedTx.signatures || parsedTx.signatures.length === 0) {
      throw new Error("Freighter returned transaction with 0 signatures. Please approve the signing prompt.");
    }
  } catch (parseErr: any) {
    if (parseErr?.message?.includes("0 signatures")) {
      throw parseErr;
    }
    console.warn("Signature verification warning:", parseErr);
  }

  return signedTxXdr;
}
