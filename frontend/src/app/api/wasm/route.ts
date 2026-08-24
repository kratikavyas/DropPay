import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export async function GET() {
  try {
    const wasmPath = path.resolve(
      process.cwd(),
      "../contracts/drop_escrow/target/wasm32-unknown-unknown/release/drop_escrow.optimized.wasm"
    );

    if (!fs.existsSync(wasmPath)) {
      return NextResponse.json(
        { error: "Optimized WASM file not found at " + wasmPath },
        { status: 404 }
      );
    }

    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmHash = crypto.createHash("sha256").update(wasmBuffer).digest("hex");

    return NextResponse.json({
      success: true,
      sizeBytes: wasmBuffer.length,
      sizeKb: (wasmBuffer.length / 1024).toFixed(2),
      wasmHash,
      wasmBase64: wasmBuffer.toString("base64"),
    });
  } catch (error: any) {
    console.error("Error loading WASM:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load WASM binary" },
      { status: 500 }
    );
  }
}
