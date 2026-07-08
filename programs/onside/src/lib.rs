//! Onside — in-play parimutuel prediction markets for live football,
//! settled trustlessly against TxLINE's Merkle-anchored match data.
//!
//! Market lifecycle:
//!   create_market → place_bet* → lock_market → settle(proof) → claim*
//!
//! Settlement trust model: the `settle` instruction only accepts an outcome
//! accompanied by a TxLINE stat-validation Merkle proof that verifies against
//! the `daily_scores_roots` account owned by the TxLINE txoracle program on
//! this cluster. Anyone can call it; nobody can call it wrong.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub mod txoracle;
use txoracle::{
    BinaryExpression, Comparison, ScoreStat, StatTerm, TraderPredicate, ValidateStatArgs,
    TXORACLE_PROGRAM_DEVNET,
};

// Placeholder program id (anchor example key) — replaced by our deploy key
// via `anchor keys sync` before first devnet deploy.
declare_id!("DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8");

/// Onside test USDC mint (devnet, 6 decimals). We control the mint
/// authority, which powers the judge-mode faucet in the extension.
pub const USDC_MINT_DEVNET: Pubkey =
    pubkey!("33WQevmATbd5NPyWpQrWWXRBBYpYdT6F26ZG1wYnb9EX");

/// Bounds for the per-market finality window: after the first valid
/// settlement, claims stay locked for the market's window. During it anyone
/// may re-settle with a proof carrying a LATER data timestamp ("later proof
/// wins") — protecting against settlement on a mid-match state (e.g. a
/// half-time score posted as final).
pub const MIN_FINALITY_WINDOW_SECS: i64 = 30;
pub const MAX_FINALITY_WINDOW_SECS: i64 = 3600;

#[program]
pub mod onside {
    use super::*;

    /// Create a market for a fixture. `stat_key`/`stat_key2` use the TxLINE
    /// on-chain encoding ((period * 1000) + base key); `market_kind` defines
    /// how the proven stat(s) map onto outcome sides.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: u64,
        market_kind: MarketKind,
        stat_key: u32,
        stat_key2: Option<u32>,
        threshold: i32,
        min_settle_ts: i64,
        finality_window_secs: i64,
    ) -> Result<()> {
        require!(
            market_kind != MarketKind::MatchResult || stat_key2.is_some(),
            OnsideError::MissingSecondStat
        );
        require!(
            (MIN_FINALITY_WINDOW_SECS..=MAX_FINALITY_WINDOW_SECS)
                .contains(&finality_window_secs),
            OnsideError::BadFinalityWindow
        );
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.creator.key();
        market.fixture_id = fixture_id;
        market.market_kind = market_kind;
        market.stat_key = stat_key;
        market.stat_key2 = stat_key2;
        market.threshold = threshold;
        market.min_settle_ts = min_settle_ts;
        market.finality_window_secs = finality_window_secs;
        market.state = MarketState::Open;
        market.pools = [0; MAX_SIDES];
        market.outcome = None;
        market.settled_data_ts = 0;
        market.claim_after = 0;
        market.vault = ctx.accounts.vault.key();
        market.bump = ctx.bumps.market;
        emit!(MarketCreated {
            market: market.key(),
            fixture_id,
            market_kind
        });
        Ok(())
    }

    /// Stake `amount` of USDC on `side`. Open markets only.
    pub fn place_bet(ctx: Context<PlaceBet>, side: u8, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.state == MarketState::Open, OnsideError::MarketNotOpen);
        require!((side as usize) < market.side_count(), OnsideError::InvalidSide);
        require!(amount > 0, OnsideError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bettor_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.bettor.to_account_info(),
                },
            ),
            amount,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.market = market.key();
        bet.bettor = ctx.accounts.bettor.key();
        bet.side = side;
        bet.amount = bet.amount.checked_add(amount).ok_or(OnsideError::Overflow)?;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        market.pools[side as usize] = market.pools[side as usize]
            .checked_add(amount)
            .ok_or(OnsideError::Overflow)?;

        emit!(BetPlaced {
            market: market.key(),
            bettor: bet.bettor,
            side,
            amount
        });
        Ok(())
    }

    /// Lock the market (kickoff / market-specific close). Permissionless:
    /// the crank calls this on phase change; anyone else may too.
    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.state == MarketState::Open, OnsideError::MarketNotOpen);
        market.state = MarketState::Locked;
        emit!(MarketLocked { market: market.key() });
        Ok(())
    }

    /// Settle the market with a TxLINE Merkle proof. **Permissionless.**
    ///
    /// The caller claims an `outcome`; the program derives the predicate that
    /// outcome implies for this market's stat keys, and CPIs into
    /// txoracle::validate_stat to verify the proof against the Merkle roots
    /// TxODDS anchors on-chain. A false claim simply fails.
    ///
    /// Finality: the proof's data timestamp must be ≥ market.min_settle_ts,
    /// and for FINALITY_WINDOW_SECS after the first settlement anyone may
    /// re-settle with a proof carrying a later data timestamp. Claims only
    /// open after the window closes.
    pub fn settle(ctx: Context<Settle>, outcome: u8, proof: SettlementProof) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.state == MarketState::Locked || market.state == MarketState::Settled,
            OnsideError::MarketNotLocked
        );
        require!(
            (outcome as usize) < market.side_count(),
            OnsideError::InvalidSide
        );

        let now = Clock::get()?.unix_timestamp;
        let data_ts = proof.args.fixture_summary.update_stats.min_timestamp;

        // Proof must be about this fixture, after the earliest settle time,
        // and — on re-settlement — strictly newer than the accepted proof.
        require!(
            proof.args.fixture_summary.fixture_id == market.fixture_id as i64,
            OnsideError::WrongFixture
        );
        require!(data_ts >= market.min_settle_ts, OnsideError::TooEarlyToSettle);
        if market.state == MarketState::Settled {
            require!(now < market.claim_after, OnsideError::SettlementFinal);
            require!(data_ts > market.settled_data_ts, OnsideError::StaleProof);
        }

        // The proven stats must be exactly this market's stat keys.
        require!(
            proof.args.stat_a.stat_to_prove.key == market.stat_key,
            OnsideError::WrongStatKey
        );

        // Derive the predicate the claimed outcome implies.
        let (predicate, op, needs_stat_b) = market.predicate_for(outcome)?;
        let mut args = proof.args.clone();
        args.predicate = predicate;
        args.op = op;
        match (needs_stat_b, &args.stat_b) {
            (true, Some(stat_b)) => {
                require!(
                    Some(stat_b.stat_to_prove.key) == market.stat_key2,
                    OnsideError::WrongStatKey
                );
            }
            (true, None) => return Err(OnsideError::MissingSecondStat.into()),
            (false, _) => {
                args.stat_b = None;
                args.op = None;
            }
        }

        // Trustless verification via CPI into txoracle.
        let verdict = txoracle::validate_stat(
            &ctx.accounts.txoracle_program,
            &ctx.accounts.txline_roots,
            &args,
        )?;
        require!(verdict, OnsideError::ProofRejected);

        if market.state != MarketState::Settled {
            market.claim_after = now
                .checked_add(market.finality_window_secs)
                .ok_or(OnsideError::Overflow)?;
        }
        market.state = MarketState::Settled;
        market.outcome = Some(outcome);
        market.settled_data_ts = data_ts;
        emit!(MarketSettled {
            market: market.key(),
            outcome
        });
        Ok(())
    }

    /// Claim a pro-rata share of the pot for a winning bet.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;
        require!(
            market.state == MarketState::Settled,
            OnsideError::MarketNotSettled
        );
        // Claims open only after the re-settlement window has closed.
        require!(
            Clock::get()?.unix_timestamp >= market.claim_after,
            OnsideError::FinalityWindowOpen
        );
        let outcome = market.outcome.ok_or(OnsideError::MarketNotSettled)?;
        require!(bet.side == outcome, OnsideError::LosingBet);
        require!(!bet.claimed, OnsideError::AlreadyClaimed);

        let total_pot: u64 = market
            .pools
            .iter()
            .try_fold(0u64, |acc, p| acc.checked_add(*p))
            .ok_or(OnsideError::Overflow)?;
        let winning_pool = market.pools[outcome as usize];
        require!(winning_pool > 0, OnsideError::EmptyPool);

        // payout = bet.amount * total_pot / winning_pool  (u128 to avoid overflow)
        let payout = u64::try_from(
            (bet.amount as u128)
                .checked_mul(total_pot as u128)
                .ok_or(OnsideError::Overflow)?
                / (winning_pool as u128),
        )
        .map_err(|_| OnsideError::Overflow)?;

        let fixture_bytes = market.fixture_id.to_le_bytes();
        let kind_byte = [market.market_kind as u8];
        let stat_key_bytes = market.stat_key.to_le_bytes();
        let bump = [market.bump];
        let seeds: &[&[u8]] = &[
            b"market",
            fixture_bytes.as_ref(),
            kind_byte.as_ref(),
            stat_key_bytes.as_ref(),
            &bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.bettor_token.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;

        bet.claimed = true;
        emit!(Claimed {
            market: market.key(),
            bettor: bet.bettor,
            payout
        });
        Ok(())
    }
}

pub const MAX_SIDES: usize = 3;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketKind {
    /// Home / Draw / Away via goal-difference proof (stat1 − stat2 vs 0).
    MatchResult = 0,
    /// Yes / No: stat (e.g. first-half goals) > threshold.
    StatOver = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketState {
    Open,
    Locked,
    Settled,
}

/// TxLINE stat-validation payload passed to `settle` — the exact
/// txoracle::validate_stat argument set (predicate/op are overwritten by the
/// program from the market's outcome mapping, so a settler cannot smuggle in
/// a different predicate than the outcome implies).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettlementProof {
    pub args: ValidateStatArgs,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub fixture_id: u64,
    pub market_kind: MarketKind,
    pub stat_key: u32,
    pub stat_key2: Option<u32>,
    pub threshold: i32,
    pub min_settle_ts: i64,
    pub finality_window_secs: i64,
    pub state: MarketState,
    pub pools: [u64; MAX_SIDES],
    pub outcome: Option<u8>,
    pub settled_data_ts: i64,
    pub claim_after: i64,
    pub vault: Pubkey,
    pub bump: u8,
}

impl Market {
    pub const SIZE: usize =
        8 + 32 + 8 + 1 + 4 + 5 + 4 + 8 + 8 + 1 + 8 * MAX_SIDES + 2 + 8 + 8 + 32 + 1 + 16;

    pub fn side_count(&self) -> usize {
        match self.market_kind {
            MarketKind::MatchResult => 3,
            MarketKind::StatOver => 2,
        }
    }

    /// Outcome sides:
    ///   MatchResult: 0 = Home, 1 = Draw, 2 = Away  (stat_a − stat_b vs 0)
    ///   StatOver:    0 = Over threshold, 1 = Under/equal  (integer stats:
    ///                Under ⇔ value < threshold + 1)
    /// Returns (predicate, op, needs_stat_b).
    pub fn predicate_for(
        &self,
        outcome: u8,
    ) -> Result<(TraderPredicate, Option<BinaryExpression>, bool)> {
        match self.market_kind {
            MarketKind::MatchResult => {
                let comparison = match outcome {
                    0 => Comparison::GreaterThan,
                    1 => Comparison::EqualTo,
                    2 => Comparison::LessThan,
                    _ => return Err(OnsideError::InvalidSide.into()),
                };
                Ok((
                    TraderPredicate { threshold: 0, comparison },
                    Some(BinaryExpression::Subtract),
                    true,
                ))
            }
            MarketKind::StatOver => match outcome {
                0 => Ok((
                    TraderPredicate {
                        threshold: self.threshold,
                        comparison: Comparison::GreaterThan,
                    },
                    None,
                    false,
                )),
                1 => Ok((
                    TraderPredicate {
                        threshold: self
                            .threshold
                            .checked_add(1)
                            .ok_or(OnsideError::Overflow)?,
                        comparison: Comparison::LessThan,
                    },
                    None,
                    false,
                )),
                _ => Err(OnsideError::InvalidSide.into()),
            },
        }
    }
}

#[account]
pub struct Bet {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Bet {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 8;
}

#[derive(Accounts)]
#[instruction(fixture_id: u64, market_kind: MarketKind, stat_key: u32)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Market::SIZE,
        seeds = [b"market", fixture_id.to_le_bytes().as_ref(), &[market_kind as u8], stat_key.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        token::mint = usdc_mint,
        constraint = vault.owner == market.key() @ OnsideError::BadVault
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: constrained to the fixed devnet USDC mint.
    #[account(address = USDC_MINT_DEVNET)]
    pub usdc_mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = Bet::SIZE,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, address = market.vault @ OnsideError::BadVault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint)]
    pub bettor_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockMarket<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settler: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: TxLINE daily_scores_roots PDA — must be owned by the txoracle
    /// program; contents are verified by the validate_stat CPI itself.
    #[account(owner = TXORACLE_PROGRAM_DEVNET @ OnsideError::BadRootsAccount)]
    pub txline_roots: UncheckedAccount<'info>,
    /// CHECK: the txoracle program we CPI into — pinned by address.
    #[account(address = TXORACLE_PROGRAM_DEVNET @ OnsideError::BadRootsAccount)]
    pub txoracle_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump = bet.bump,
        constraint = bet.bettor == bettor.key() @ OnsideError::NotYourBet
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, address = market.vault @ OnsideError::BadVault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint)]
    pub bettor_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub fixture_id: u64,
    pub market_kind: MarketKind,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: u8,
    pub amount: u64,
}

#[event]
pub struct MarketLocked {
    pub market: Pubkey,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub outcome: u8,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub payout: u64,
}

#[error_code]
pub enum OnsideError {
    #[msg("Market is not open for betting")]
    MarketNotOpen,
    #[msg("Market is not locked")]
    MarketNotLocked,
    #[msg("Market is not settled")]
    MarketNotSettled,
    #[msg("Invalid outcome side")]
    InvalidSide,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Bet did not win")]
    LosingBet,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Winning pool is empty")]
    EmptyPool,
    #[msg("Wrong vault account")]
    BadVault,
    #[msg("Not your bet")]
    NotYourBet,
    #[msg("Settlement requires a valid TxLINE proof")]
    ProofRequired,
    #[msg("Roots account not owned by the TxLINE program")]
    BadRootsAccount,
    #[msg("Proof is for a different fixture")]
    WrongFixture,
    #[msg("Proof data timestamp is before the market's earliest settle time")]
    TooEarlyToSettle,
    #[msg("Settlement is final; the finality window has closed")]
    SettlementFinal,
    #[msg("A proof with a newer data timestamp has already settled this market")]
    StaleProof,
    #[msg("Proven stat key does not match the market")]
    WrongStatKey,
    #[msg("This market kind requires a second stat term")]
    MissingSecondStat,
    #[msg("TxLINE rejected the proof for the claimed outcome")]
    ProofRejected,
    #[msg("Claims are locked until the finality window closes")]
    FinalityWindowOpen,
    #[msg("Finality window out of allowed bounds")]
    BadFinalityWindow,
    #[msg("txoracle returned no data")]
    NoReturnData,
    #[msg("return data not from txoracle")]
    WrongReturnSource,
}
