import axios from "axios";
import { config } from "./config.js";

// ================= CONFIG =================
const CONFIG = {
  ROLE_NAME: config.discord.verifiedRoleName || "Harmony Town Resident",
  COLLECTION_SYMBOL: config.solana.collectionSymbol || "harmie",
  CHECK_INTERVAL_MS: 60 * 1000, // verify loop
  EXPIRY_MS: 10 * 60 * 1000,
  MONITOR_INTERVAL_MS: 5 * 60 * 1000, // 🔥 check ownership every 5 mins
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || "YOUR_HELIUS_API_KEY",
};

// Pending verifications
const activeVerifications = new Map();

// ✅ VERIFIED USERS STORE (wallet bound)
const verifiedUsers = new Map();

// ================ HELPERS =================

function generateCode() {
  return "BLUB-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function fetchMagicEdenBio(wallet) {
  try {
    const res = await axios.get(
      `https://api-mainnet.magiceden.dev/v2/wallets/${wallet}`
    );

    return res.data?.bio || "";
  } catch (err) {
    console.error("Magic Eden fetch error:", err.message);
    return "";
  }
}

async function checkNFTOwnership(wallet) {
  try {
    const res = await axios.post(
      `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: "1",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: wallet,
          page: 1,
          limit: 1000,
        },
      }
    );

    const assets = res.data.result.items || [];

    return assets.some(
      (nft) =>
        nft?.collection?.symbol?.toLowerCase() ===
        CONFIG.COLLECTION_SYMBOL
    );
  } catch (err) {
    console.error("NFT check error:", err.message);
    return false;
  }
}

// ============ VERIFICATION LOOP ============

function startVerification(client) {
  setInterval(async () => {
    const now = Date.now();

    for (const [userId, data] of activeVerifications.entries()) {
      if (now > data.expiry) {
        activeVerifications.delete(userId);
        continue;
      }

      const bio = await fetchMagicEdenBio(data.wallet);
      if (!bio) continue;

      if (bio.includes(data.code)) {
        console.log(`✅ Verified: ${userId}`);

        const hasNFT = await checkNFTOwnership(data.wallet);

        if (!hasNFT) {
          console.log(`❌ No NFT for ${userId}`);
          activeVerifications.delete(userId);
          continue;
        }

        try {
          const guild = client.guilds.cache.get(data.guildId);
          const member = await guild.members.fetch(userId);

          const role = guild.roles.cache.find(
            (r) => r.name === CONFIG.ROLE_NAME
          );

          if (role) {
            await member.roles.add(role);
          }

          // 🔥 STORE VERIFIED USER
          verifiedUsers.set(userId, {
            wallet: data.wallet,
            guildId: data.guildId,
          });

          await member.send(
            `✅ Verified!\nWallet: ${data.wallet}\nRole granted: ${CONFIG.ROLE_NAME}`
          );
        } catch (err) {
          console.error("Role assign error:", err.message);
        }

        activeVerifications.delete(userId);
      }
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

// ============ OWNERSHIP MONITOR ============

function startOwnershipMonitor(client) {
  setInterval(async () => {
    console.log("🔍 Running ownership check...");

    for (const [userId, data] of verifiedUsers.entries()) {
      const stillHasNFT = await checkNFTOwnership(data.wallet);

      if (!stillHasNFT) {
        console.log(`🚨 Removing role from ${userId}`);

        try {
          const guild = client.guilds.cache.get(data.guildId);
          const member = await guild.members.fetch(userId);

          const role = guild.roles.cache.find(
            (r) => r.name === CONFIG.ROLE_NAME
          );

          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
          }

          await member.send(
            `⚠️ Your ${CONFIG.ROLE_NAME} role has been removed because you no longer hold a Harmie NFT.`
          );
        } catch (err) {
          console.error("Role removal error:", err.message);
        }

        verifiedUsers.delete(userId);
      }
    }
  }, CONFIG.MONITOR_INTERVAL_MS);
}

// ============== COMMAND HANDLER ==============

async function handleVerify(interaction) {
  const wallet = interaction.options.getString("wallet");
  const userId = interaction.user.id;

  if (!wallet || wallet.length < 32) {
    return interaction.reply({
      content: "❌ Invalid wallet address.",
      ephemeral: true,
    });
  }

  const code = generateCode();

  activeVerifications.set(userId, {
    wallet,
    code,
    expiry: Date.now() + CONFIG.EXPIRY_MS,
    guildId: interaction.guildId,
  });

  await interaction.reply({
    content: `🧾 **Verification Started**

Paste this into your Magic Eden bio:

\`${code}\`

⏱ 10 minutes  
🔄 Checked every minute  

Role: **${CONFIG.ROLE_NAME}**`,
    ephemeral: true,
  });
}

async function startMagicEdenVerificationWithWallet(interaction, walletAddress) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!walletAddress || walletAddress.length < 32) {
    return interaction.reply({
      content: "❌ Invalid wallet address.",
      ephemeral: true,
    });
  }

  const code = generateCode();

  activeVerifications.set(userId, {
    wallet: walletAddress,
    code,
    expiry: Date.now() + CONFIG.EXPIRY_MS,
    guildId,
  });

  await interaction.reply({
    content: `🧾 **Magic Eden Bio Verification Started**

**Your wallet:** \`${walletAddress}\`

**Step 1:** Go to [Magic Eden](https://magiceden.io/) and sign in with this wallet
**Step 2:** Go to your profile settings  
**Step 3:** Paste this code into your bio:

\`${code}\`

**Step 4:** Click "Save" and wait for verification (checked every minute)

⏱ 10 minutes  
🔄 Checked every minute  

Role: **${CONFIG.ROLE_NAME}**`,
    ephemeral: true,
  });
}

export {
  handleVerify,
  startVerification,
  startOwnershipMonitor,
  startMagicEdenVerificationWithWallet,
};