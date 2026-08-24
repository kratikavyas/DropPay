import { NextRequest, NextResponse } from "next/server";
import { fundWithFriendbot } from "@/lib/stellar";

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    const ok = await fundWithFriendbot(address);
    if (!ok) {
      return NextResponse.json({ error: "Friendbot request failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Account funded with 10,000 Testnet XLM" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Faucet error" }, { status: 500 });
  }
}
