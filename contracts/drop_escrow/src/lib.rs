#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AmountMustBePositive = 1,
    InvalidDuration = 2,
    DropNotFound = 3,
    DropNotPending = 4,
    DropExpired = 5,
    InvalidSecret = 6,
    DropNotExpired = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DropStatus {
    Pending = 0,
    Claimed = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Drop {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
    pub hash_lock: BytesN<32>,
    pub expiry: u64,
    pub status: DropStatus,
    pub recipient: Option<Address>,
    pub claimed_at: Option<u64>,
}

#[contracttype]
pub enum DataKey {
    Drop(u64),
    DropCount,
}

const DAY_IN_LEDGERS: u32 = 17280; // ~5 seconds per ledger -> 17,280 ledgers per day
const BUMP_LEDGERS: u32 = 30 * DAY_IN_LEDGERS; // ~30 days

#[contract]
pub struct DropEscrowContract;

#[contractimpl]
impl DropEscrowContract {
    /// Creates a new time-locked and hash-locked escrow Drop.
    /// Senders deposit tokens into the contract.
    pub fn create_drop(
        env: Env,
        sender: Address,
        token: Address,
        amount: i128,
        hash_lock: BytesN<32>,
        duration_seconds: u64,
    ) -> u64 {
        sender.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::AmountMustBePositive);
        }
        if duration_seconds < 60 {
            panic_with_error!(&env, Error::InvalidDuration);
        }

        // Transfer tokens from sender to contract escrow
        let client = token::Client::new(&env, &token);
        client.transfer(&sender, &env.current_contract_address(), &amount);

        // Fetch and increment drop count
        let mut count: u64 = env.storage().instance().get(&DataKey::DropCount).unwrap_or(0);
        let drop_id = count;
        count += 1;
        env.storage().instance().set(&DataKey::DropCount, &count);

        let expiry = env.ledger().timestamp() + duration_seconds;

        let drop = Drop {
            sender: sender.clone(),
            token: token.clone(),
            amount,
            hash_lock: hash_lock.clone(),
            expiry,
            status: DropStatus::Pending,
            recipient: None,
            claimed_at: None,
        };

        // Store drop in persistent storage
        let key = DataKey::Drop(drop_id);
        env.storage().persistent().set(&key, &drop);
        env.storage().persistent().extend_ttl(&key, BUMP_LEDGERS, BUMP_LEDGERS);
        env.storage().instance().extend_ttl(BUMP_LEDGERS, BUMP_LEDGERS);

        // Emit creation event
        env.events().publish(
            (symbol_short!("created"), sender, drop_id),
            (token, amount, expiry, hash_lock),
        );

        drop_id
    }

    /// Claims an active drop if provided with the correct preimage secret before expiry.
    pub fn claim_drop(env: Env, drop_id: u64, secret: Bytes, recipient: Address) -> bool {
        let key = DataKey::Drop(drop_id);
        let mut drop: Drop = match env.storage().persistent().get(&key) {
            Some(d) => d,
            None => panic_with_error!(&env, Error::DropNotFound),
        };

        if drop.status != DropStatus::Pending {
            panic_with_error!(&env, Error::DropNotPending);
        }

        let now = env.ledger().timestamp();
        if now > drop.expiry {
            panic_with_error!(&env, Error::DropExpired);
        }

        // Verify cryptographic hash lock
        let secret_hash = env.crypto().sha256(&secret);
        if secret_hash.to_bytes() != drop.hash_lock {
            panic_with_error!(&env, Error::InvalidSecret);
        }

        // Update drop state
        drop.status = DropStatus::Claimed;
        drop.recipient = Some(recipient.clone());
        drop.claimed_at = Some(now);

        env.storage().persistent().set(&key, &drop);

        // Transfer funds from contract to recipient
        let client = token::Client::new(&env, &drop.token);
        client.transfer(&env.current_contract_address(), &recipient, &drop.amount);

        // Emit claim event
        env.events().publish(
            (symbol_short!("claimed"), recipient, drop_id),
            (drop.token, drop.amount, now),
        );

        true
    }

    /// Senders can refund their deposit after the expiration timestamp has passed.
    pub fn refund_drop(env: Env, drop_id: u64) -> bool {
        let key = DataKey::Drop(drop_id);
        let mut drop: Drop = match env.storage().persistent().get(&key) {
            Some(d) => d,
            None => panic_with_error!(&env, Error::DropNotFound),
        };

        // Authenticate sender
        drop.sender.require_auth();

        if drop.status != DropStatus::Pending {
            panic_with_error!(&env, Error::DropNotPending);
        }

        let now = env.ledger().timestamp();
        if now <= drop.expiry {
            panic_with_error!(&env, Error::DropNotExpired);
        }

        // Update drop state
        drop.status = DropStatus::Refunded;
        env.storage().persistent().set(&key, &drop);

        // Transfer funds back to sender
        let client = token::Client::new(&env, &drop.token);
        client.transfer(&env.current_contract_address(), &drop.sender, &drop.amount);

        // Emit refund event
        env.events().publish(
            (symbol_short!("refunded"), drop.sender.clone(), drop_id),
            (drop.token, drop.amount, now),
        );

        true
    }

    /// Retrieve drop details by ID
    pub fn get_drop(env: Env, drop_id: u64) -> Option<Drop> {
        let key = DataKey::Drop(drop_id);
        env.storage().persistent().get(&key)
    }

    /// Total drops created
    pub fn get_drop_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::DropCount).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
