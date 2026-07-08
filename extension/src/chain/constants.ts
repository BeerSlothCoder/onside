import { PublicKey } from "@solana/web3.js";

export const RPC_URL = "https://api.devnet.solana.com";
export const ONSIDE_PROGRAM_ID = new PublicKey(
  "DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8"
);
export const TXORACLE_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
);
export const USDC_MINT = new PublicKey(
  "33WQevmATbd5NPyWpQrWWXRBBYpYdT6F26ZG1wYnb9EX"
);
export const USDC_DECIMALS = 6;
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export const MARKET_KIND_LABELS: Record<string, { name: string; sides: string[] }> = {
  matchResult: { name: "Match result", sides: ["Home", "Draw", "Away"] },
  statOver: { name: "Over/Under", sides: ["Over", "Under"] },
};
