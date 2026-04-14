//! Crypto benchmarks for pwd-vault-core.
//!
//! Run with: `cargo bench -p pwd-vault-core`

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use pwd_vault_core::crypto::{
    compute_mac, decrypt, derive_auth_hash, derive_entry_key, derive_master_key, derive_vault_key,
    encrypt, generate_salt, verify_mac,
};

fn bench_key_derivation(c: &mut Criterion) {
    let salt = generate_salt();
    let password = "benchmark-master-password-2024";

    c.bench_function("derive_master_key", |b| {
        b.iter(|| derive_master_key(password, &salt).unwrap());
    });

    let master_key = derive_master_key(password, &salt).unwrap();
    c.bench_function("derive_auth_hash", |b| {
        b.iter(|| derive_auth_hash(&master_key))
    });
    c.bench_function("derive_vault_key", |b| {
        b.iter(|| derive_vault_key(&master_key))
    });
}

fn bench_encrypt_decrypt(c: &mut Criterion) {
    let key = [0xAB_u8; 32];
    let mut group = c.benchmark_group("encrypt_decrypt");

    for size in [64, 256, 1024, 4096] {
        let data = vec![0x42_u8; size];

        group.bench_with_input(BenchmarkId::new("encrypt", size), &data, |b, data| {
            b.iter(|| encrypt(data, &key).unwrap());
        });

        let encrypted = encrypt(&data, &key).unwrap();
        group.bench_with_input(BenchmarkId::new("decrypt", size), &encrypted, |b, enc| {
            b.iter(|| decrypt(enc, &key).unwrap());
        });
    }
    group.finish();
}

fn bench_mac(c: &mut Criterion) {
    let data = vec![0x42_u8; 4096];
    let mac_key = [0xAB_u8; 32];
    c.bench_function("compute_mac_4k", |b| {
        b.iter(|| compute_mac(&data, &mac_key))
    });

    let mac = compute_mac(&data, &mac_key);
    c.bench_function("verify_mac_4k", |b| {
        b.iter(|| verify_mac(&data, &mac, &mac_key))
    });
}

fn bench_entry_key(c: &mut Criterion) {
    let seed = [0xCD_u8; 32];
    let entry_id = b"550e8400-e29b-41d4-a716-446655440000";

    c.bench_function("derive_entry_key", |b| {
        b.iter(|| derive_entry_key(&seed, entry_id));
    });
}

criterion_group!(
    benches,
    bench_key_derivation,
    bench_encrypt_decrypt,
    bench_mac,
    bench_entry_key
);
criterion_main!(benches);
