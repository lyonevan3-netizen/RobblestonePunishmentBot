
require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
    console.log(`Successfully logged in as ${readyClient.user.tag}!`);
    console.log('Robblestone Punishment Bot is online.');
});

async function sendTestLog(channelId, type, id) {
    if (!channelId) {
        throw new Error(`Missing channel ID for ${type}`);
    }

    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased() || !channel.threads) {
        throw new Error(`Channel ${channelId} is not a usable text channel.`);
    }

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`TEST ${type} PUNISHMENT`)
        .setDescription('This is a test entry. No actual punishment has been issued.')
        .addFields(
            { name: 'Player', value: 'ExamplePlayer', inline: true },
            { name: 'Staff', value: 'Test Staff', inline: true },
            { name: 'Reason', value: 'Testing Discord punishment logs', inline: false },
            { name: 'Duration', value: '7 days', inline: true },
            { name: 'Punishment ID', value: id, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Robblestone Punishment System • TEST' });

    const message = await channel.send({ embeds: [embed] });

    await message.startThread({
        name: `Evidence - ${id}`,
        autoArchiveDuration: 1440,
        reason: 'Test evidence thread'
    });

    return channel.name;
}

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply({
            content: 'Pong! 🏓 Robblestone Punishment Bot is working!',
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'testlogs') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const generalId = process.env.DISCORD_PUNISHMENTS_CHANNEL_ID;
            const muteId = process.env.MUTE_PUNISHMENTS_CHANNEL_ID;
            const banId = process.env.BAN_PUNISHMENTS_CHANNEL_ID;

            const results = [];

            results.push(await sendTestLog(
                generalId, 'WARNING', 'TEST-WARN'
            ));

            results.push(await sendTestLog(
                generalId, 'MUTE', 'TEST-MUTE'
            ));

            results.push(await sendTestLog(
                muteId, 'MUTE', 'TEST-MUTE'
            ));

            results.push(await sendTestLog(
                generalId, 'BAN', 'TEST-BAN'
            ));

            results.push(await sendTestLog(
                banId, 'BAN', 'TEST-BAN'
            ));

            await interaction.editReply(
                'Test logs sent successfully! Check your punishment channels and their evidence threads.'
            );
        } catch (error) {
            console.error('Test logging failed:', error);

            await interaction.editReply(
                `Test logging failed: ${error.message}. Check the terminal and bot channel permissions.`
            );
        }
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error('ERROR: DISCORD_TOKEN is missing from your .env file!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in to Discord:', error);
});
