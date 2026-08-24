import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK, getServer, getActiveContractId } from "./stellar";
import { signTransactionWithFreighter } from "./freighter";

export interface OnChainDrop {
  id: number;
  sender: string;
  token: string;
  amount: string;
  amountFormatted: string;
  hashLock: string;
  expiry: number; // Unix timestamp in seconds
  status: "Pending" | "Claimed" | "Refunded";
  recipient: string | null;
  claimedAt: number | null;
}

export async function fetchDropDetails(dropId: number): Promise<OnChainDrop | null> {
  try {
    const contractId = getActiveContractId();
    if (!contractId) {
      return null;
    }

    const server = getServer();
    const contract = new StellarSdk.Contract(contractId);

    // Call get_drop(drop_id)
    const op = contract.call(
      "get_drop",
      StellarSdk.nativeToScVal(BigInt(dropId), { type: "u64" })
    );

    // Use a zero account for readonly view simulation
    const tempAccount = new StellarSdk.Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0"
    );

    const tx = new StellarSdk.TransactionBuilder(tempAccount, {
      fee: "100",
      networkPassphrase: STELLAR_NETWORK.passphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
      return null;
    }

    const scVal = simulation.result?.retval;
    if (!scVal) return null;

    const val = StellarSdk.scValToNative(scVal);
    if (!val) return null;

    // Map Soroban struct to OnChainDrop
    const statusMap = ["Pending", "Claimed", "Refunded"] as const;
    const statusIndex = typeof val.status === "number" ? val.status : 0;
    const amountBigInt = BigInt(val.amount.toString());
    const amountNum = Number(amountBigInt) / 10_000_000; // 7 decimals for USDC

    return {
      id: dropId,
      sender: val.sender?.toString() || "",
      token: val.token?.toString() || "",
      amount: val.amount.toString(),
      amountFormatted: amountNum.toFixed(2),
      hashLock: Buffer.from(val.hash_lock).toString("hex"),
      expiry: Number(val.expiry),
      status: statusMap[statusIndex] || "Pending",
      recipient: val.recipient ? val.recipient.toString() : null,
      claimedAt: val.claimed_at ? Number(val.claimed_at) : null,
    };
  } catch (error) {
    console.error("Error fetching drop from Soroban:", error);
    return null;
  }
}

export async function fetchDropCount(): Promise<number> {
  try {
    const contractId = getActiveContractId();
    if (!contractId) return 0;
    const server = getServer();
    const contract = new StellarSdk.Contract(contractId);

    const op = contract.call("get_drop_count");
    const tempAccount = new StellarSdk.Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0"
    );

    const tx = new StellarSdk.TransactionBuilder(tempAccount, {
      fee: "100",
      networkPassphrase: STELLAR_NETWORK.passphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
      return 0;
    }

    const scVal = simulation.result?.retval;
    if (!scVal) return 0;

    const val = StellarSdk.scValToNative(scVal);
    return Number(val) || 0;
  } catch (error) {
    console.error("Error fetching drop count:", error);
    return 0;
  }
}

/**
 * Polls for transaction confirmation via raw JSON-RPC to avoid SDK metadata v4 union switch crashes
 */
async function pollTransactionConfirmation(
  rpcUrl: string,
  hash: string,
  maxWaitMs: number = 45000
): Promise<{ status: string; returnValue?: any; resultXdr?: string }> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
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
          throw new Error("Transaction execution failed on Stellar ledger.");
        }
      }
    } catch (err: any) {
      if (err?.message?.includes("failed on Stellar ledger")) throw err;
      console.warn("Polling retry error:", err);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Transaction confirmation timed out. It may still be processing on-chain.");
}

/**
 * Executes a REAL on-chain create_drop call signed by the user's Freighter wallet.
 */
export async function createDropOnChain(
  senderAddress: string,
  tokenAddress: string,
  amountFormatted: number,
  hashBytes: Uint8Array,
  durationSeconds: number
): Promise<{ dropId: number; txHash: string }> {
  const contractId = getActiveContractId();
  if (!contractId) {
    throw new Error("DropEscrow contract ID is not configured (NEXT_PUBLIC_DROP_CONTRACT_ID missing)");
  }

  const server = getServer();
  const contract = new StellarSdk.Contract(contractId);

  // 1. Fetch sender account from Stellar
  const account = await server.getAccount(senderAddress);

  // 2. Prepare parameters
  const amountStroops = BigInt(Math.round(amountFormatted * 10_000_000));
  const hashBytesScVal = StellarSdk.xdr.ScVal.scvBytes(Buffer.from(hashBytes));

  const op = contract.call(
    "create_drop",
    new StellarSdk.Address(senderAddress).toScVal(),
    new StellarSdk.Address(tokenAddress).toScVal(),
    StellarSdk.nativeToScVal(amountStroops, { type: "i128" }),
    hashBytesScVal,
    StellarSdk.nativeToScVal(BigInt(durationSeconds), { type: "u64" })
  );

  // 3. Build preliminary transaction
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: STELLAR_NETWORK.passphrase,
  })
    .addOperation(op)
    .setTimeout(90)
    .build();

  // 4. Simulate & prepare with Soroban resources & footprint
  const preparedTx = await server.prepareTransaction(tx);

  // 5. Sign with Freighter wallet (explicit network, passphrase, address)
  const signedXdr = await signTransactionWithFreighter(
    preparedTx.toXDR(),
    {
      network: STELLAR_NETWORK.isMainnet ? "PUBLIC" : "TESTNET",
      networkPassphrase: STELLAR_NETWORK.passphrase,
      address: senderAddress,
    }
  );

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.passphrase
  );

  // 6. Broadcast to Stellar network
  const sendRes = await server.sendTransaction(signedTx);
  if (sendRes.status === "ERROR") {
    throw new Error(
      `Send transaction rejected: ${sendRes.errorResult?.toXDR("base64") || "RPC Error"}`
    );
  }

  // 7. Poll for final confirmation via safe JSON-RPC
  const confirmRes = await pollTransactionConfirmation(STELLAR_NETWORK.rpcUrl, sendRes.hash);

  // 8. Extract real drop_id from contract return value
  let dropId = 0;
  if (confirmRes.returnValue) {
    try {
      const scVal = StellarSdk.xdr.ScVal.fromXDR(confirmRes.returnValue, "base64");
      const val = StellarSdk.scValToNative(scVal);
      dropId = Number(val);
    } catch {
      dropId = 0;
    }
  }

  if (dropId === 0) {
    const count = await fetchDropCount();
    dropId = Math.max(0, count - 1);
  }

  return {
    dropId,
    txHash: sendRes.hash,
  };
}

/**
 * Executes a REAL on-chain claim_drop call signed by the recipient's Freighter wallet.
 */
export async function claimDropWithWallet(
  dropId: number,
  secret: string,
  recipientAddress: string
): Promise<{ txHash: string }> {
  const contractId = getActiveContractId();
  if (!contractId) {
    throw new Error("DropEscrow contract ID is not configured");
  }

  const server = getServer();
  const contract = new StellarSdk.Contract(contractId);

  const account = await server.getAccount(recipientAddress);

  const secretBytes = Buffer.from(new TextEncoder().encode(secret));
  const secretScVal = StellarSdk.xdr.ScVal.scvBytes(secretBytes);

  const op = contract.call(
    "claim_drop",
    StellarSdk.nativeToScVal(BigInt(dropId), { type: "u64" }),
    secretScVal,
    new StellarSdk.Address(recipientAddress).toScVal()
  );

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: STELLAR_NETWORK.passphrase,
  })
    .addOperation(op)
    .setTimeout(90)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const signedXdr = await signTransactionWithFreighter(
    preparedTx.toXDR(),
    {
      network: STELLAR_NETWORK.isMainnet ? "PUBLIC" : "TESTNET",
      networkPassphrase: STELLAR_NETWORK.passphrase,
      address: recipientAddress,
    }
  );

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.passphrase
  );

  const sendRes = await server.sendTransaction(signedTx);
  if (sendRes.status === "ERROR") {
    throw new Error(`Claim transaction rejected: ${sendRes.errorResult?.toXDR("base64") || "RPC Error"}`);
  }

  await pollTransactionConfirmation(STELLAR_NETWORK.rpcUrl, sendRes.hash);
  return { txHash: sendRes.hash };
}

/**
 * Executes a REAL on-chain refund_drop call signed by the sender's Freighter wallet.
 */
export async function refundDropWithWallet(
  dropId: number,
  senderAddress: string
): Promise<{ txHash: string }> {
  const contractId = getActiveContractId();
  if (!contractId) {
    throw new Error("DropEscrow contract ID is not configured");
  }

  const server = getServer();
  const contract = new StellarSdk.Contract(contractId);

  const account = await server.getAccount(senderAddress);

  const op = contract.call(
    "refund_drop",
    StellarSdk.nativeToScVal(BigInt(dropId), { type: "u64" })
  );

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: STELLAR_NETWORK.passphrase,
  })
    .addOperation(op)
    .setTimeout(90)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const signedXdr = await signTransactionWithFreighter(
    preparedTx.toXDR(),
    {
      network: STELLAR_NETWORK.isMainnet ? "PUBLIC" : "TESTNET",
      networkPassphrase: STELLAR_NETWORK.passphrase,
      address: senderAddress,
    }
  );

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.passphrase
  );

  const sendRes = await server.sendTransaction(signedTx);
  if (sendRes.status === "ERROR") {
    throw new Error(`Refund transaction rejected: ${sendRes.errorResult?.toXDR("base64") || "RPC Error"}`);
  }

  await pollTransactionConfirmation(STELLAR_NETWORK.rpcUrl, sendRes.hash);
  return { txHash: sendRes.hash };
}
