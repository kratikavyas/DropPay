import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK, getServer, fundWithFriendbot } from "@/lib/stellar";

// Dedicated Relayer Keypair (generated deterministically or loaded from env)
let relayerKeypair: StellarSdk.Keypair;
if (process.env.RELAYER_SECRET_KEY && process.env.RELAYER_SECRET_KEY.startsWith("S")) {
  relayerKeypair = StellarSdk.Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
} else {
  // Use a deterministic seed for demo testnet relayer
  const seed = StellarSdk.hash(Buffer.from("droppay-testnet-relayer-master-seed-v1"));
  relayerKeypair = StellarSdk.Keypair.fromRawEd25519Seed(seed);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dropId, secret, recipientAddress } = body;

    if (dropId === undefined || !secret || !recipientAddress) {
      return NextResponse.json(
        { error: "Missing required fields: dropId, secret, recipientAddress" },
        { status: 400 }
      );
    }

    const server = getServer();
    const relayerPub = relayerKeypair.publicKey();

    // Ensure relayer is funded on Testnet
    try {
      await server.getAccount(relayerPub);
    } catch {
      console.log("Funding relayer keypair with Friendbot...");
      await fundWithFriendbot(relayerPub);
      // Wait 2s for ledger close
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Ensure recipient account is funded / exists on Testnet
    try {
      await server.getAccount(recipientAddress);
    } catch {
      console.log("Funding new recipient account with Friendbot...");
      await fundWithFriendbot(recipientAddress);
      await new Promise((r) => setTimeout(r, 1500));
    }

    const account = await server.getAccount(relayerPub);
    const contract = new StellarSdk.Contract(STELLAR_NETWORK.contractId);

    // Convert secret string to Buffer/Bytes
    const secretBytes = Buffer.from(secret, "utf-8");

    // Build claim_drop operation
    const op = contract.call(
      "claim_drop",
      StellarSdk.nativeToScVal(BigInt(dropId), { type: "u64" }),
      StellarSdk.nativeToScVal(secretBytes, { type: "bytes" }),
      new StellarSdk.Address(recipientAddress).toScVal()
    );

    // Build transaction with relayer as source and fee payer
    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase: STELLAR_NETWORK.passphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    // Simulate transaction to get footprint and resource fee
    const preparedTx = await server.prepareTransaction(tx);

    // Sign with relayer keypair (sponsoring the gas)
    preparedTx.sign(relayerKeypair);

    // Submit to Stellar Testnet RPC
    const sendResponse = await server.sendTransaction(preparedTx);

    if (sendResponse.status === "ERROR") {
      return NextResponse.json(
        { error: "Transaction submission failed", details: sendResponse.errorResult },
        { status: 500 }
      );
    }

    // Poll for completion (up to 15s)
    let statusResponse = await server.getTransaction(sendResponse.hash);
    let attempts = 0;
    while (statusResponse.status === "NOT_FOUND" && attempts < 10) {
      await new Promise((r) => setTimeout(r, 1500));
      statusResponse = await server.getTransaction(sendResponse.hash);
      attempts++;
    }

    return NextResponse.json({
      success: true,
      txHash: sendResponse.hash,
      status: statusResponse.status,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${sendResponse.hash}`,
    });
  } catch (error: any) {
    console.error("Relayer claim execution error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process claim transaction" },
      { status: 500 }
    );
  }
}
