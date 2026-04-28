import { REST, Routes } from 'discord.js';

import { commands } from './commands.js';
import { config } from './config.js';

const rest = new REST({ version: '10' }).setToken(config.discord.token);
const route = config.discord.guildId
  ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
  : Routes.applicationCommands(config.discord.clientId);

await rest.put(route, { body: commands });

console.log(
  `Registered ${commands.length} slash commands ${config.discord.guildId ? `for guild ${config.discord.guildId}` : 'globally'}.`,
);
