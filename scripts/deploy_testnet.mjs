import * as StellarSdk from "@stellar/stellar-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const server = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: false });

async function fundAccount(pubKey) {
  console.log(`Funding account ${pubKey} via Friendbot...`);
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pubKey)}`);
  if (!res.ok) throw new Error("Friendbot funding failed");
  console.log("Account funded successfully.");
  await new Promise((r) => setTimeout(r, 2000));
}

async function main() {
  console.log("=== DropPay Stellar Testnet Contract Deployment ===");

  // 1. Generate or load deployer keypair
  const seed = StellarSdk.hash(Buffer.from("droppay-testnet-deployer-master-seed-v1"));
  const deployer = StellarSdk.Keypair.fromRawEd25519Seed(seed);
  console.log("Deployer Public Key:", deployer.publicKey());

  // 2. Ensure deployer account is funded
  try {
    await server.getAccount(deployer.publicKey());
  } catch {
    await fundAccount(deployer.publicKey());
  }

  const wasmPath = path.resolve(
    __dirname,
    "../contracts/drop_escrow/target/wasm32-unknown-unknown/release/drop_escrow.wasm"
  );

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found at: ${wasmPath}`);
  }

  const wasmBuffer = fs.readFileSync(wasmPath);
  console.log(`Loaded WASM bytecode: ${wasmBuffer.length} bytes`);

  let account = await server.getAccount(deployer.publicKey());

  // Step 1: Upload Contract WASM
  console.log("Uploading contract WASM to Stellar Testnet RPC...");
  const uploadOp = StellarSdk.Operation.uploadContractWasm({
    wasm: wasmBuffer,
  });

  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(uploadOp)
    .setTimeout(60)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(deployer);

  const uploadRes = await server.sendTransaction(preparedTx);
  console.log("WASM upload submitted. TxHash:", uploadRes.hash);

  if (uploadRes.status === "ERROR") {
    console.error("Upload error:", uploadRes.errorResult);
    return;
  }

  // Poll for tx completion
  let getTxRes = await server.getTransaction(uploadRes.hash);
  while (getTxRes.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    getTxRes = await server.getTransaction(uploadRes.hash);
  }

  if (getTxRes.status !== "SUCCESS") {
    console.error("WASM upload tx did not succeed:", getTxRes);
    return;
  }

  // Extract wasmId from transaction result
  const wasmIdHex = getTxRes.returnValue.value().toString("hex");
  console.log("WASM installed on Testnet! WASM Hash:", wasmIdHex);

  // Step 2: Create Contract Instance
  account = await server.getAccount(deployer.publicKey());
  console.log("Instantiating DropEscrow contract on Testnet...");

  const createOp = StellarSdk.Operation.createCustomContract({
    address: deployer.publicKey(),
    wasmHash: Buffer.from(wasmIdHex, "hex"),
  });

  tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(createOp)
    .setTimeout(60)
    .build();

  const preparedCreateTx = await server.prepareTransaction(tx);
  preparedCreateTx.sign(deployer);

  const createRes = await server.sendTransaction(preparedCreateTx);
  console.log("Contract creation submitted. TxHash:", createRes.hash);

  let getCreateTxRes = await server.getTransaction(createRes.hash);
  while (getCreateTxRes.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    getCreateTxRes = await server.getTransaction(createRes.hash);
  }

  const contractAddress = StellarSdk.Address.fromScVal(getCreateTxRes.returnValue).toString();
  console.log("🎉 SUCCESS! DropEscrow Contract Deployed to Testnet!");
  console.log("Contract Address:", contractAddress);
  console.log(`Explorer Link: https://stellar.expert/explorer/testnet/contract/${contractAddress}`);

  // Write contract address to .env.local
  const envPath = path.resolve(__dirname, "../frontend/.env.local");
  fs.writeFileSync(envPath, `NEXT_PUBLIC_DROP_CONTRACT_ID=${contractAddress}\n`);
  console.log("Updated frontend/.env.local with deployed contract ID.");
}

main().catch(console.error);
