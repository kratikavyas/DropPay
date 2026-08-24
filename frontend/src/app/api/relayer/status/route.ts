import { NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK, getServer, getHorizonServer, fundWithFriendbot } from "@/lib/stellar";

export async function GET() {
  try {
    const seed = StellarSdk.hash(Buffer.from("droppay-testnet-relayer-master-seed-v1"));
    const relayerKeypair = StellarSdk.Keypair.fromRawEd25519Seed(seed);
    const pubKey = relayerKeypair.publicKey();

    let balance = "0";
    try {
      const horizon = getHorizonServer();
      const account = await horizon.loadAccount(pubKey);
      const nativeBalance = account.balances.find((b: any) => b.asset_type === "native");
      balance = nativeBalance ? (nativeBalance as any).balance : "0";
    } catch {
      await fundWithFriendbot(pubKey);
      balance = "10000";
    }

    return NextResponse.json({
      status: "online",
      network: "Stellar Testnet",
      contractId: STELLAR_NETWORK.contractId,
      relayerAddress: pubKey,
      relayerBalanceXlm: balance,
    });
  } catch (error: any) {
    return NextResponse.json({ status: "error", message: error?.message }, { status: 500 });
  }
}
