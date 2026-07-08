import { PublicKey } from "@solana/web3.js";

/** TxLINE network configuration — values from the official docs (Program Addresses page). */
export const TXLINE_CONFIG = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlTokenMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
  },
} as const;

export type TxlineNetwork = keyof typeof TXLINE_CONFIG;

/** Free World Cup tiers (per docs): 1 = 60s-delayed, 12 = real-time (mainnet). */
export const SERVICE_LEVEL_WORLD_CUP_DELAYED = 1;
export const SERVICE_LEVEL_WORLD_CUP_REALTIME = 12;

/** Soccer game phases (on-chain encoding). */
export enum GamePhase {
  NotStarted = 1,
  FirstHalf = 2,
  Halftime = 3,
  SecondHalf = 4,
  Finished = 5,
  WaitingExtraTime = 6,
  ExtraTime1 = 7,
  ExtraTimeHalftime = 8,
  ExtraTime2 = 9,
  FinishedAfterExtraTime = 10,
  WaitingPenalties = 11,
  Penalties = 12,
  FinishedAfterPenalties = 13,
  Interrupted = 14,
  Abandoned = 15,
  Cancelled = 16,
}

/**
 * Stat key encoding: (period * 1000) + base key.
 * Base keys: 1/2 team goals, 3/4 yellows, 5/6 reds, 7/8 corners.
 */
export const StatKey = {
  goals: (participant: 1 | 2, period: 0 | 1 | 2 | 3 | 4 | 5 = 0) =>
    period * 1000 + participant,
  yellowCards: (participant: 1 | 2, period: 0 | 1 | 2 = 0) =>
    period * 1000 + 2 + participant,
  redCards: (participant: 1 | 2, period: 0 | 1 | 2 = 0) =>
    period * 1000 + 4 + participant,
  corners: (participant: 1 | 2, period: 0 | 1 | 2 = 0) =>
    period * 1000 + 6 + participant,
} as const;

/** Devnet test USDC used for Onside pools (public spl-token-faucet mint, 6 decimals). */
export const DEVNET_USDC_MINT = new PublicKey(
  "33WQevmATbd5NPyWpQrWWXRBBYpYdT6F26ZG1wYnb9EX"
);
export const USDC_DECIMALS = 6;
