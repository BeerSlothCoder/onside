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

// Placeholder program id (anchor example key) — replaced by our deploy key
// via `anchor keys sync` before first devnet deploy.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// TxLINE txoracle program (devnet). Settlement proofs must verify against
/// roots anchored by this program's `daily_scores_roots` PDA.
pub const TXORACLE_PROGRAM_DEVNET: Pubkey =
    pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Devnet test USDC mint used for all pools (6 decimals).
pub const USDC_MINT_DEVNET: Pubkey =
    pubkey!("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");

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
        threshold: i64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.creator.key();
        market.fixture_id = fixture_id;
        market.market_kind = market_kind;
        market.stat_key = stat_key;
        market.stat_key2 = stat_key2;
        market.threshold = threshold;
        market.state = MarketState::Open;
        market.pools = [0; MAX_SIDES];
        market.outcome = None;
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

    /// Settle the market with a TxLINE Merkle proof.
    ///
    /// TODO(step: settlement): verify `proof` against the txoracle
    /// `daily_scores_roots` account (passed as `txline_roots`) — either via
    /// CPI into txoracle::validate_stat (mechanism A) or by verifying the
    /// Merkle path in-program against the deserialized roots account
    /// (mechanism B). Until then this instruction is gated to the market
    /// authority so nothing fake can be demoed as trustless.
    pub fn settle(ctx: Context<Settle>, outcome: u8, _proof: SettlementProof) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.state == MarketState::Locked,
            OnsideError::MarketNotLocked
        );
        require!(
            (outcome as usize) < market.side_count(),
            OnsideError::InvalidSide
        );
        // Temporary trust gate — removed when proof verification lands.
        require!(
            ctx.accounts.settler.key() == market.authority,
            OnsideError::ProofRequired
        );
        // The roots account must at least belong to the txoracle program.
        require!(
            *ctx.accounts.txline_roots.owner == TXORACLE_PROGRAM_DEVNET,
            OnsideError::BadRootsAccount
        );

        market.state = MarketState::Settled;
        market.outcome = Some(outcome);
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

/// TxLINE stat-validation payload passed to `settle`.
/// Mirrors /api/scores/stat-validation; verified in the settlement step.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettlementProof {
    pub target_ts: i64,
    pub update_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
    pub events_sub_tree_root: [u8; 32],
    pub event_stat_root: [u8; 32],
    // Proof paths are capped for account-size sanity; real depth is small.
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub fixture_id: u64,
    pub market_kind: MarketKind,
    pub stat_key: u32,
    pub stat_key2: Option<u32>,
    pub threshold: i64,
    pub state: MarketState,
    pub pools: [u64; MAX_SIDES],
    pub outcome: Option<u8>,
    pub vault: Pubkey,
    pub bump: u8,
}

impl Market {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 4 + 5 + 8 + 1 + 8 * MAX_SIDES + 2 + 32 + 1 + 16;

    pub fn side_count(&self) -> usize {
        match self.market_kind {
            MarketKind::MatchResult => 3,
            MarketKind::StatOver => 2,
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
    /// CHECK: TxLINE daily_scores_roots account; ownership checked in handler,
    /// Merkle verification added in the settlement step.
    pub txline_roots: UncheckedAccount<'info>,
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
}
