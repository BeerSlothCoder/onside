import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import nacl from "tweetnacl";
import { TXLINE_CONFIG, type TxlineNetwork } from "./constants.js";

export interface TxlineCredentials {
  jwt: string;
  apiToken: string;
  apiOrigin: string;
}

/**
 * Full TxLINE onboarding per the official quickstart:
 * 1. on-chain subscribe(serviceLevel, weeks) on the txoracle program (free tiers: no payment)
 * 2. POST /auth/guest/start → guest JWT
 * 3. sign `${txSig}:${leagues}:${jwt}` with the wallet
 * 4. POST /api/token/activate → apiToken
 *
 * The returned credentials are used as:
 *   Authorization: Bearer <jwt>
 *   X-Api-Token: <apiToken>
 */
export async function subscribeAndActivate(opts: {
  network: TxlineNetwork;
  wallet: anchor.Wallet;
  /** Anchor Program for the txoracle IDL (network-matched). */
  program: anchor.Program;
  serviceLevelId: number;
  durationWeeks?: number;
  selectedLeagues?: number[];
}): Promise<TxlineCredentials> {
  const cfg = TXLINE_CONFIG[opts.network];
  const durationWeeks = opts.durationWeeks ?? 4;
  const leagues = opts.selectedLeagues ?? [];

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    cfg.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    cfg.programId
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    opts.wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // 0. Ensure the user's TxL ATA exists (required by subscribe even on free tier)
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    opts.wallet.publicKey,
    userTokenAccount,
    opts.wallet.publicKey,
    cfg.txlTokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // 1. On-chain subscription
  const txSig = await opts.program.methods
    .subscribe(opts.serviceLevelId, durationWeeks)
    .preInstructions([createAtaIx])
    .accounts({
      user: opts.wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: cfg.txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // 2. Guest JWT
  const authRes = await fetch(`${cfg.apiOrigin}/auth/guest/start`, {
    method: "POST",
  });
  if (!authRes.ok) throw new Error(`guest/start failed: ${authRes.status}`);
  const { token: jwt } = (await authRes.json()) as { token: string };

  // 3. Sign activation message
  const message = new TextEncoder().encode(
    `${txSig}:${leagues.join(",")}:${jwt}`
  );
  const payer = (opts.wallet as anchor.Wallet & {
    payer?: anchor.web3.Keypair;
  }).payer;
  if (!payer) throw new Error("Wallet must expose a local payer keypair");
  const signature = nacl.sign.detached(message, payer.secretKey);

  // 4. Activate API token
  const actRes = await fetch(`${cfg.apiOrigin}/api/token/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      txSig,
      walletSignature: Buffer.from(signature).toString("base64"),
      leagues,
    }),
  });
  if (!actRes.ok) throw new Error(`token/activate failed: ${actRes.status}`);
  // The endpoint returns either JSON {token} or the token as plain text.
  const raw = await actRes.text();
  let apiToken = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { token?: string };
    if (parsed && typeof parsed === "object" && parsed.token) {
      apiToken = parsed.token;
    }
  } catch {
    /* plain-text token */
  }

  return { jwt, apiToken, apiOrigin: cfg.apiOrigin };
}

/** Reuse previously activated credentials from env (TXLINE_JWT / TXLINE_API_TOKEN). */
export function credentialsFromEnv(env: {
  TXLINE_API_ORIGIN?: string;
  TXLINE_JWT?: string;
  TXLINE_API_TOKEN?: string;
}): TxlineCredentials | null {
  if (!env.TXLINE_JWT || !env.TXLINE_API_TOKEN) return null;
  return {
    jwt: env.TXLINE_JWT,
    apiToken: env.TXLINE_API_TOKEN,
    apiOrigin: env.TXLINE_API_ORIGIN ?? TXLINE_CONFIG.devnet.apiOrigin,
  };
}

/**
 * Convenience: connection for a network, honouring SOLANA_RPC_URL when set
 * and retrying transient fetch failures (flaky routes to public RPCs).
 */
export function connectionFor(network: TxlineNetwork): Connection {
  const url =
    (typeof process !== "undefined" && process.env?.SOLANA_RPC_URL) ||
    TXLINE_CONFIG[network].rpcUrl;
  const retryingFetch: typeof fetch = async (input, init) => {
    let lastErr: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        return await fetch(input, init);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr;
  };
  return new Connection(url, {
    commitment: "confirmed",
    fetch: retryingFetch as never,
  });
}
