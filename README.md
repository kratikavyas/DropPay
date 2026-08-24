# DropPay ⚡ — Non-Custodial Link Payments on Stellar

DropPay is a non-custodial, time-limited money drop application built natively on Stellar using Soroban smart contracts, WebAuthn Passkeys, and gas-sponsored relayers.

## Core Features

- 🔐 **Non-Custodial Escrow**: Funds are locked in a Soroban smart contract (`DropEscrow`) guarded by a SHA-256 hash commitment (`hash_lock`).
- 🔗 **Zero-Knowledge Link Sharing**: The 256-bit claim secret is kept strictly in the URL hash fragment (`#secret=...`) and is never sent to web servers or CDN logs.
- 📱 **Biometric Passkey Onboarding**: Recipients claim funds in 1 tap using Face ID / Touch ID / Windows Hello via WebAuthn, without installing wallet extensions or writing seed phrases.
- ⛽ **Gas-Sponsored Relayer**: The backend relayer sponsors network fees via Stellar fee-bump transactions, enabling instant walletless onboarding for non-crypto users.
- ⏳ **7-Day Auto-Refund Guarantee**: If a recipient does not claim the funds within 7 days (or chosen expiry), the sender can reclaim 100% of their deposit in 1 click.
- 🌐 **Stellar Testnet Verified**: Real on-chain contract execution, token transfers, and event emissions.

---

## Project Structure

```
droppay/
├── contracts/
│   └── drop_escrow/
│       ├── Cargo.toml          # Rust Soroban SDK v22 dependency
│       └── src/
│           ├── lib.rs          # DropEscrow smart contract
│           └── test.rs         # 100% coverage unit test suite
└── frontend/
    ├── package.json            # Next.js 15, Stellar SDK, Tailwind
    ├── tsconfig.json
    ├── tailwind.config.ts
    └── src/
        ├── app/
        │   ├── layout.tsx      # Root design layout
        │   ├── page.tsx        # Sender creation UI & QR generator
        │   ├── claim/[id]/     # Recipient Passkey claim page
        │   ├── dashboard/      # Sender history & refund page
        │   └── api/relayer/    # Gas-sponsoring relayer API
        └── lib/
            ├── crypto.ts       # Client-side 256-bit secret & SHA-256
            ├── passkey.ts      # WebAuthn P-256 passkey client
            ├── stellar.ts      # Stellar Testnet RPC & Horizon client
            └── contract.ts     # Soroban contract bindings
```

---

## Getting Started

### 1. Smart Contract (Rust / Soroban)
```bash
cd contracts/drop_escrow

# Run unit tests
cargo test

# Build optimized WASM
cargo build --target wasm32-unknown-unknown --release
```

### 2. Frontend & Relayer (Next.js)
```bash
cd frontend

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to create and claim money drops.
