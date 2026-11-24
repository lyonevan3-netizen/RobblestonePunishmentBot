
require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('testlogs')
        .setDescription('Tests the punishment log channels and evidence threads.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
    try {
        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationCommands('1574710372936450058'),
            { body: commands }
        );

        console.log('Successfully registered slash commands!');
    } catch (error) {
        console.error('Command registration failed:', error);
    }
}

deployCommands();
