#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env,
};

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &token_contract.address()),
        StellarAssetClient::new(env, &token_contract.address()),
    )
}

#[test]
fn test_successful_create_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Mint 100 tokens to sender
    token_admin_client.mint(&sender, &100_0000000);
    assert_eq!(token.balance(&sender), 100_0000000);

    // Generate secret and its SHA-256 hash
    let secret_str = "stellar_droppay_secret_key_123456";
    let secret_bytes = Bytes::from_slice(&env, secret_str.as_bytes());
    let hash_lock: BytesN<32> = env.crypto().sha256(&secret_bytes).into();

    let amount = 25_0000000; // 25 USDC
    let duration = 7 * 24 * 60 * 60; // 7 days

    // Create drop
    let drop_id = client.create_drop(&sender, &token.address, &amount, &hash_lock, &duration);
    assert_eq!(drop_id, 0);
    assert_eq!(client.get_drop_count(), 1);

    // Verify token balances after drop creation
    assert_eq!(token.balance(&sender), 75_0000000);
    assert_eq!(token.balance(&contract_id), 25_0000000);

    // Check drop state
    let drop = client.get_drop(&drop_id).unwrap();
    assert_eq!(drop.sender, sender);
    assert_eq!(drop.token, token.address);
    assert_eq!(drop.amount, amount);
    assert_eq!(drop.hash_lock, hash_lock);
    assert_eq!(drop.status, DropStatus::Pending);
    assert_eq!(drop.recipient, None);

    // Recipient claims with the correct secret
    let claim_res = client.claim_drop(&drop_id, &secret_bytes, &recipient);
    assert!(claim_res);

    // Verify token balances after claim
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&recipient), 25_0000000);

    // Check updated drop state
    let claimed_drop = client.get_drop(&drop_id).unwrap();
    assert_eq!(claimed_drop.status, DropStatus::Claimed);
    assert_eq!(claimed_drop.recipient, Some(recipient));
    assert!(claimed_drop.claimed_at.is_some());
}

#[test]
#[should_panic]
fn test_invalid_secret_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token_admin_client.mint(&sender, &100_0000000);

    let correct_secret = Bytes::from_slice(&env, b"correct_secret_phrase");
    let hash_lock: BytesN<32> = env.crypto().sha256(&correct_secret).into();

    let drop_id = client.create_drop(&sender, &token.address, &10_0000000, &hash_lock, &3600);

    let wrong_secret = Bytes::from_slice(&env, b"wrong_secret_phrase");
    client.claim_drop(&drop_id, &wrong_secret, &recipient);
}

#[test]
#[should_panic]
fn test_claim_after_expiry_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token_admin_client.mint(&sender, &100_0000000);

    let secret = Bytes::from_slice(&env, b"secret_to_expire");
    let hash_lock: BytesN<32> = env.crypto().sha256(&secret).into();

    let drop_id = client.create_drop(&sender, &token.address, &10_0000000, &hash_lock, &100);

    // Fast-forward ledger time past expiry
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);

    client.claim_drop(&drop_id, &secret, &recipient);
}

#[test]
fn test_successful_refund_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);

    token_admin_client.mint(&sender, &50_0000000);

    let secret = Bytes::from_slice(&env, b"refund_test_secret");
    let hash_lock: BytesN<32> = env.crypto().sha256(&secret).into();

    let duration = 604800; // 7 days
    let drop_id = client.create_drop(&sender, &token.address, &50_0000000, &hash_lock, &duration);

    assert_eq!(token.balance(&sender), 0);
    assert_eq!(token.balance(&contract_id), 50_0000000);

    // Fast forward ledger timestamp past 7 days
    env.ledger().set_timestamp(env.ledger().timestamp() + duration + 10);

    let refund_res = client.refund_drop(&drop_id);
    assert!(refund_res);

    // Sender gets full balance back
    assert_eq!(token.balance(&sender), 50_0000000);
    assert_eq!(token.balance(&contract_id), 0);

    let refunded_drop = client.get_drop(&drop_id).unwrap();
    assert_eq!(refunded_drop.status, DropStatus::Refunded);
}

#[test]
#[should_panic]
fn test_refund_before_expiry_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);

    token_admin_client.mint(&sender, &50_0000000);

    let secret = Bytes::from_slice(&env, b"premature_refund_test");
    let hash_lock: BytesN<32> = env.crypto().sha256(&secret).into();

    let drop_id = client.create_drop(&sender, &token.address, &50_0000000, &hash_lock, &86400);

    // Attempt refund immediately before expiry
    client.refund_drop(&drop_id);
}

#[test]
#[should_panic]
fn test_double_claim_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DropEscrowContract, ());
    let client = DropEscrowContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token(&env, &token_admin);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token_admin_client.mint(&sender, &50_0000000);

    let secret = Bytes::from_slice(&env, b"double_claim_test");
    let hash_lock: BytesN<32> = env.crypto().sha256(&secret).into();

    let drop_id = client.create_drop(&sender, &token.address, &20_0000000, &hash_lock, &3600);

    client.claim_drop(&drop_id, &secret, &recipient);

    // Attempt second claim
    client.claim_drop(&drop_id, &secret, &recipient);
}
