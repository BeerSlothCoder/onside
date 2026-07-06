// Onside background service worker.
// Later: burner-wallet keypair custody (chrome.storage.session), airdrop +
// test-USDC faucet calls, transaction signing requests from the overlay.
chrome.runtime.onInstalled.addListener(() => {
  console.log("Onside installed — devnet mode");
});
