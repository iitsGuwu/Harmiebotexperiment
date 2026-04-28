import { randomBytes } from "node:crypto";
import axios from "axios";
import bs58 from "bs58";
import { config } from "./config.js";
import { getWalletHarmieCount } from "./collection-stats.js";
import { saveVerifiedWalletLink, logWalletAuditEvent } from "./wallet-store.js";
import { botEvents } from "./bot-events.js";

// ================= CONFIG =================
const CONFIG = {
  ROLE_NAME: config.discord.verifiedRoleName || "HarmonyTown Resident",
  CHECK_INTERVAL_MS: 60 * 1000, // verify loop — check every 60s
  EXPIRY_MS: 10 * 60 * 1000, // 10 minute window
};

// Pending verifications (keyed by userId)
const activeVerifications = new Map();

// Track which wallets are currently being verified to prevent duplicates
const activeWallets = new Set();

// ================ HELPERS =================

/**
 * Generate a cryptographically random verification code.
 * Uses crypto.randomBytes instead of Math.random for unpredictability.
 */
function generateCode() {
  return "BLUB-" + randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

/**
 * Validate that a wallet address is a valid Solana base58 public key (32 bytes).
 */
function isValidSolanaAddress(wallet) {
  if (!wallet || typeof wallet !== "string") return false;
  try {
    return bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

/**
 * Fetch the bio field from the Magic Eden user profile API.
 * Endpoint: GET /v2/wallets/{wallet} → { walletAddress, bio }
 */
async function fetchMagicEdenBio(wallet) {
  try {
    const res = await axios.get(
      `https://api-mainnet.magiceden.dev/v2/wallets/${encodeURIComponent(wallet)}`
    );

    return res.data?.bio || "";
  } catch (err) {
    console.error("Magic Eden fetch error:", err.message);
    return "";
  }
}

/**
 * Check NFT ownership using the same DAS RPC that collection-stats.js uses.
 * Returns { hasNFT: boolean, count: number }.
 */
async function checkNFTOwnership(wallet) {
  try {
    const result = await getWalletHarmieCount(wallet);
    return {
      hasNFT: result.count > 0,
      count: result.count,
    };
  } catch (err) {
    console.error("NFT ownership check error:", err.message);
    return { hasNFT: false, count: 0 };
  }
}

// ============ VERIFICATION LOOP ============

function startVerification(client) {
  setInterval(async () => {
    const now = Date.now();

    for (const [userId, data] of activeVerifications.entries()) {
      // Expire old verifications
      if (now > data.expiry) {
        activeVerifications.delete(userId);
        activeWallets.delete(data.wallet);
        console.log(`⏱ Verification expired for ${userId}`);
        continue;
      }

      // Fetch the user's Magic Eden bio
      const bio = await fetchMagicEdenBio(data.wallet);
      if (!bio) continue;

      // Check if the bio contains the verification code
      if (!bio.includes(data.code)) continue;

      console.log(`✅ Bio code matched for ${userId}`);

      // Check NFT ownership via the configured DAS RPC
      const ownership = await checkNFTOwnership(data.wallet);

      if (!ownership.hasNFT) {
        console.log(`❌ No Harmie NFTs found for ${userId} (wallet: ${data.wallet})`);
        activeVerifications.delete(userId);
        activeWallets.delete(data.wallet);
        continue;
      }

      console.log(`✅ Verified: ${userId} holds ${ownership.count} Harmie(s)`);

      try {
        // Save to the persistent wallet store (same as SIWS path)
        const linkedWallet = saveVerifiedWalletLink({
          discordUserId: userId,
          guildId: data.guildId,
          walletAddress: data.wallet,
          walletLabel: "Magic Eden Bio",
          harmieCount: ownership.count,
          totalSupply: 500,
          verificationMethod: "magic_eden_bio",
        });

        // Log the audit event
        logWalletAuditEvent({
          eventType: "verify_attempt",
          status: "success",
          discordUserId: userId,
          walletAddress: data.wallet,
          details: {
            method: "magic_eden_bio",
            harmieCount: ownership.count,
          },
        });

        // Emit the wallet-linked event (triggers role grant + DM in index.js)
        if (data.guildId) {
          botEvents.emit("wallet-linked", {
            guildId: data.guildId,
            discordUserId: userId,
            channelId: data.channelId || null,
            walletAddress: data.wallet,
          });
        }
      } catch (err) {
        console.error("Wallet store / role assign error:", err.message);

        // If it's a policy error (e.g., wallet already linked to another user),
        // notify the user via DM
        if (err.kind === "policy") {
          try {
            const guild = client.guilds.cache.get(data.guildId);
            if (guild) {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member) {
                await member.send(
                  `❌ **Verification failed:** ${err.message}`
                ).catch(() => { });
              }
            }
          } catch {
            // DM delivery is best-effort
          }
        }
      }

      activeVerifications.delete(userId);
      activeWallets.delete(data.wallet);
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

// ============== COMMAND HANDLER ==============

/**
 * Shared handler for both /verify and the Magic Eden Bio button flow.
 * Creates a verification challenge and tells the user to paste a code into their ME bio.
 */
async function startBioVerification(interaction, walletAddress) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!isValidSolanaAddress(walletAddress)) {
    return interaction.reply({
      content: "❌ Invalid Solana wallet address. Must be a valid base58 public key (32–44 characters).",
      ephemeral: true,
    });
  }

  // Prevent the same wallet from being verified by multiple users simultaneously
  if (activeWallets.has(walletAddress)) {
    return interaction.reply({
      content: "❌ That wallet is already in an active verification session. Please wait for it to expire or try again later.",
      ephemeral: true,
    });
  }

  // If this user already has an active verification, clean it up
  const existing = activeVerifications.get(userId);
  if (existing) {
    activeWallets.delete(existing.wallet);
  }

  const code = generateCode();

  activeVerifications.set(userId, {
    wallet: walletAddress,
    code,
    expiry: Date.now() + CONFIG.EXPIRY_MS,
    guildId,
    channelId: interaction.channelId || null,
  });
  activeWallets.add(walletAddress);

  await interaction.reply({
    content: `🧾 **Magic Eden Bio Verification Started**

**Your wallet:** \`${walletAddress}\`

**Step 1:** Go to [Magic Eden](https://magiceden.io/) and sign in with this wallet
**Step 2:** Go to your profile settings  
**Step 3:** Paste this code into your bio:

\`${code}\`

**Step 4:** Click "Save" and wait for verification (checked every minute)

⏱ **Expires in 10 minutes**  
🔄 Checked every minute  

Role: **${CONFIG.ROLE_NAME}**`,
    ephemeral: true,
  });
}

/**
 * Handle the /verify slash command.
 * Reads the wallet from the command options.
 */
async function handleVerify(interaction) {
  const wallet = interaction.options.getString("wallet");
  await startBioVerification(interaction, wallet);
}

/**
 * Handle the Magic Eden Bio button flow (after modal submit).
 * Receives the wallet address from the modal.
 */
async function startMagicEdenVerificationWithWallet(interaction, walletAddress) {
  await startBioVerification(interaction, walletAddress);
}

export {
  handleVerify,
  startVerification,
  startMagicEdenVerificationWithWallet,
};