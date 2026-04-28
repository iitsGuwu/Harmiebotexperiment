import { SlashCommandBuilder } from 'discord.js';

const builders = [
  new SlashCommandBuilder()
    .setName('rankings')
    .setDescription('Show the top Harmies from the live site rankings.')
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many Harmies to show.')
        .setMinValue(3)
        .setMaxValue(15),
    ),
  new SlashCommandBuilder()
    .setName('harmie')
    .setDescription('Roll a random Harmie or look one up by number, name, or mint.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Optional. Example: 153, Harmies #153, or a mint address.')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('unburn')
    .setDescription('Pick a random burnt Harmie recovered from the OpenSea activity feed.'),
  new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Post a random Harmie meme from the local meme folder.'),
  new SlashCommandBuilder()
    .setName('random')
    .setDescription('Generate a random Harmie using the CIS reference pack.'),
  new SlashCommandBuilder()
    .setName('prompted')
    .setDescription('Generate a Harmie from a custom text prompt using the CIS reference pack.')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Describe the Harmie scene. Type freely or pick from the suggestion library.')
        .setMinLength(3)
        .setMaxLength(400)
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName('topup')
    .setDescription('Show the Harmie CIS credit top up link.'),
  new SlashCommandBuilder()
    .setName('link-wallet')
    .setDescription('Create a SIWS wallet-verification link to verify your Harmies holdings.'),
  new SlashCommandBuilder()
    .setName('reverify-wallet')
    .setDescription('Re-run wallet verification for one of your already linked wallets.')
    .addStringOption((option) =>
      option
        .setName('address')
        .setDescription('Optional wallet address to re-verify. Defaults to your primary wallet.')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('unlink-wallet')
    .setDescription('Unlink one of your verified wallets from Harmie Bot.')
    .addStringOption((option) =>
      option
        .setName('address')
        .setDescription('The wallet address to remove.')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your wallet by pasting a code into your Magic Eden bio.')
    .addStringOption((option) =>
      option
        .setName('wallet')
        .setDescription('Your Solana wallet address.')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Show your linked wallets and current Harmies balance.'),
  new SlashCommandBuilder()
    .setName('flex')
    .setDescription('Show off up to 10 Harmies from your connected wallet in a clean grid.'),
  new SlashCommandBuilder()
    .setName('community-stats')
    .setDescription('Show linked-holder ownership stats plus live Harmies market data.'),
  new SlashCommandBuilder()
    .setName('wallet-audit')
    .setDescription('Show stale wallet-link and verification health for this server.')
    .setDefaultMemberPermissions(0x20n),
];

export const commands = builders.map((builder) => builder.toJSON());
