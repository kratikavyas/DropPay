import * as StellarSdk from "@stellar/stellar-sdk";

export const STELLAR_NETWORK = {
  rpcUrl:
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
    "https://soroban-rpc.mainnet.stellar.gateway.fm",
  horizonUrl:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    "https://horizon.stellar.org",
  passphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
    StellarSdk.Networks.PUBLIC,
  contractId:
    process.env.NEXT_PUBLIC_DROP_CONTRACT_ID ||
    "CDM46YOGN2DVMPGTZVVJSIQIP66SY4EZFBET6UCR54RN2NPN45TBHEFA",
  usdcContractId:
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ||
    "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  explorerUrl:
    process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ||
    "https://stellar.expert/explorer/public",
  isMainnet:
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
      StellarSdk.Networks.PUBLIC) === StellarSdk.Networks.PUBLIC,
};

export function getActiveContractId(): string {
  if (STELLAR_NETWORK.contractId) {
    return STELLAR_NETWORK.contractId;
  }
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("droppay_mainnet_contract_id");
    if (stored && stored.startsWith("C")) {
      return stored;
    }
  }
  return "CDM46YOGN2DVMPGTZVVJSIQIP66SY4EZFBET6UCR54RN2NPN45TBHEFA";
}

export function getServer(): StellarSdk.rpc.Server {
  return new StellarSdk.rpc.Server(STELLAR_NETWORK.rpcUrl, {
    allowHttp: false,
  });
}

export function getHorizonServer(): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);
}

export function getTxExplorerUrl(txHash: string): string {
  const base = STELLAR_NETWORK.explorerUrl.replace(/\/$/, "");
  return `${base}/tx/${txHash}`;
}

export function getContractExplorerUrl(contractAddress?: string): string {
  const base = STELLAR_NETWORK.explorerUrl.replace(/\/$/, "");
  const addr = contractAddress || getActiveContractId();
  return `${base}/contract/${addr}`;
}

export function getAccountExplorerUrl(accountAddress: string): string {
  const base = STELLAR_NETWORK.explorerUrl.replace(/\/$/, "");
  return `${base}/account/${accountAddress}`;
}

export async function fundWithFriendbot(publicKey: string): Promise<boolean> {
  if (STELLAR_NETWORK.isMainnet) {
    return false; // Friendbot is only available on Testnet
  }
  try {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
    );
    return response.ok;
  } catch (error) {
    console.error("Friendbot funding error:", error);
    return false;
  }
}

export async function getXlmBalance(publicKey: string): Promise<string> {
  try {
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(publicKey);
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    return nativeBalance ? nativeBalance.balance : "0";
  } catch (error) {
    return "0";
  }
}

export async function getUsdcBalance(publicKey: string): Promise<string> {
  try {
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(publicKey);
    const usdcBalance = account.balances.find(
      (b: any) =>
        b.asset_code === "USDC" ||
        (b.asset_type !== "native" && b.asset_code?.toUpperCase() === "USDC")
    );
    return usdcBalance ? (usdcBalance as any).balance : "0";
  } catch (error) {
    return "0";
  }
}

export const MAINNET_USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export const MAINNET_USDC_ASSET = new StellarSdk.Asset(
  "USDC",
  MAINNET_USDC_ISSUER
);

export async function hasUsdcTrustline(publicKey: string): Promise<boolean> {
  if (!publicKey || !publicKey.startsWith("G")) return false;
  try {
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(publicKey);
    return account.balances.some(
      (b: any) =>
        b.asset_code === "USDC" &&
        b.asset_issuer === MAINNET_USDC_ISSUER
    );
  } catch (error) {
    console.warn("hasUsdcTrustline error:", error);
    return false;
  }
}

export async function addUsdcTrustlineWithWallet(
  publicKey: string
): Promise<{ txHash: string; successful: boolean }> {
  if (!publicKey || !publicKey.startsWith("G")) {
    throw new Error("Invalid Stellar public key");
  }

  const { signTransactionWithFreighter } = await import("./freighter");
  const horizon = getHorizonServer();
  const account = await horizon.loadAccount(publicKey);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000", // Standard 0.001 XLM base fee
    networkPassphrase: STELLAR_NETWORK.passphrase,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: MAINNET_USDC_ASSET,
      })
    )
    .setTimeout(90)
    .build();

  const signedXdr = await signTransactionWithFreighter(tx.toXDR(), {
    network: "PUBLIC",
    networkPassphrase: STELLAR_NETWORK.passphrase,
    address: publicKey,
  });

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.passphrase
  );

  const result: any = await horizon.submitTransaction(signedTx);
  if (!result || !result.successful) {
    throw new Error(result?.title || "Failed to establish USDC trustline on Stellar Mainnet");
  }

  return {
    txHash: result.hash,
    successful: !!result.successful,
  };
}

