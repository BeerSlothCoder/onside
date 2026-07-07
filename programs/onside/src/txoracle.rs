//! Minimal CPI client for the TxLINE txoracle program's `validate_stat`.
//!
//! Types mirror the txoracle IDL exactly (borsh layout must match):
//!   ScoreStat            { key: u32, value: i32, period: i32 }
//!   ScoresUpdateStats    { update_count: i32, min_timestamp: i64, max_timestamp: i64 }
//!   ScoresBatchSummary   { fixture_id: i64, update_stats, events_sub_tree_root: [u8;32] }
//!   ProofNode            { hash: [u8;32], is_right_sibling: bool }
//!   StatTerm             { stat_to_prove: ScoreStat, event_stat_root: [u8;32], stat_proof: Vec<ProofNode> }
//!   TraderPredicate      { threshold: i32, comparison: Comparison }
//!   Comparison           enum { GreaterThan, LessThan, EqualTo }
//!   BinaryExpression     enum { Add, Subtract }
//!
//! validate_stat(ts: i64, fixture_summary, fixture_proof, main_tree_proof,
//!               predicate, stat_a, stat_b: Option, op: Option) -> bool
//! Single readonly account: daily_scores_merkle_roots.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{get_return_data, invoke};

/// TxLINE txoracle program (devnet).
pub const TXORACLE_PROGRAM_DEVNET: Pubkey =
    pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor instruction discriminator for `validate_stat` (from the IDL).
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateStatArgs {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: TraderPredicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

/// CPI into txoracle::validate_stat; returns the program's bool verdict.
/// `daily_scores_roots` must be the txoracle `daily_scores_roots` PDA for the
/// epoch day of `args.ts` (ownership is checked by the caller's constraint).
pub fn validate_stat(
    txoracle_program: &AccountInfo,
    daily_scores_roots: &AccountInfo,
    args: &ValidateStatArgs,
) -> Result<bool> {
    let mut data = Vec::with_capacity(512);
    data.extend_from_slice(&VALIDATE_STAT_DISCRIMINATOR);
    args.serialize(&mut data)?;

    let ix = Instruction {
        program_id: *txoracle_program.key,
        accounts: vec![AccountMeta::new_readonly(*daily_scores_roots.key, false)],
        data,
    };

    invoke(&ix, &[daily_scores_roots.clone()])?;

    let (from, ret) =
        get_return_data().ok_or(error!(crate::OnsideError::NoReturnData))?;
    require_keys_eq!(from, *txoracle_program.key, crate::OnsideError::WrongReturnSource);
    require!(!ret.is_empty(), crate::OnsideError::NoReturnData);
    Ok(ret[0] == 1)
}
