import { Keypair } from "@solana/web3.js";

const STORAGE_KEY = "onside_burner_secret";

/**
 * Burner demo wallet stored in chrome.storage.local (judge mode).
 * Devnet-only funds — the whole point is zero-friction testing.
 */
export async function loadWallet(): Promise<Keypair | null> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const secret = got[STORAGE_KEY] as number[] | undefined;
  if (!secret) return null;
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export async function createWallet(): Promise<Keypair> {
  const kp = Keypair.generate();
  await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(kp.secretKey) });
  return kp;
}

export async function loadOrCreateWallet(): Promise<Keypair> {
  return (await loadWallet()) ?? (await createWallet());
}

export function onWalletChange(cb: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) cb();
  });
}
