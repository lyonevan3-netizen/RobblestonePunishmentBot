
require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const clientId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_TOKEN;

if (!clientId || !token) {
    console.error('Missing DISCORD_CLIENT_ID or DISCORD_TOKEN in .env');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Checks whether Robblestone Punishment Bot is online.'),

    new SlashCommandBuilder()
        .setName('testlogs')
        .setDescription('Tests punishment channels and evidence threads.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
    try {
        console.log('Registering Robblestone slash commands...');

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );

        console.log('Successfully registered all slash commands!');
    } catch (error) {
        console.error('Command registration failed:', error);
        process.exitCode = 1;
    }
}

deployCommands();
