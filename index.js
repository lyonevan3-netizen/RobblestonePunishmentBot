
require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// BOT STARTUP

client.once(Events.ClientReady, (readyClient) => {
    console.log('====================================');
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log('Robblestone Punishment Bot is online!');
    console.log('====================================');
});

// TEST LOGGING

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
        .setDescription(
            'This is a test entry. No actual punishment has been issued.'
        )
        .addFields(
            { name: 'Player', value: 'ExamplePlayer', inline: true },
            { name: 'Staff', value: 'Test Staff', inline: true },
            {
                name: 'Reason',
                value: 'Testing Discord punishment logs',
                inline: false
            },
            { name: 'Duration', value: '7 days', inline: true },
            { name: 'Punishment ID', value: id, inline: true }
        )
        .setTimestamp()
        .setFooter({
            text: 'Robblestone Punishment System • TEST'
        });

    const message = await channel.send({ embeds: [embed] });

    await message.startThread({
        name: `Evidence - ${id}`,
        autoArchiveDuration: 1440,
        reason: 'Test punishment evidence thread'
    });

    console.log(`Created TEST ${type} log in #${channel.name}`);

    return channel.name;
}

// SLASH COMMAND HANDLER

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        if (interaction.commandName === 'ping') {
            await interaction.reply({
                content: 'Pong! 🏓 Robblestone Punishment Bot is working!',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        if (interaction.commandName === 'testlogs') {
            if (!interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )) {
                await interaction.reply({
                    content: 'You do not have permission to use this command.',
                    flags: MessageFlags.Ephemeral
                });

                return;
            }

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const generalId = process.env.DISCORD_PUNISHMENTS_CHANNEL_ID;
            const muteId = process.env.MUTE_PUNISHMENTS_CHANNEL_ID;
            const banId = process.env.BAN_PUNISHMENTS_CHANNEL_ID;

            const testId = `TEST-${Date.now()}`;

            await sendTestLog(
                generalId,
                'WARNING',
                `${testId}-WARN`
            );

            await sendTestLog(
                generalId,
                'MUTE',
                `${testId}-MUTE`
            );

            await sendTestLog(
                muteId,
                'MUTE',
                `${testId}-MUTE`
            );

            await sendTestLog(
                generalId,
                'BAN',
                `${testId}-BAN`
            );

            await sendTestLog(
                banId,
                'BAN',
                `${testId}-BAN`
            );

            await interaction.editReply(
                'All test punishment logs and evidence threads were created successfully!'
            );
        }
    } catch (error) {
        console.error('Interaction error:', error);

        const errorMessage =
            `An error occurred: ${error.message}`;

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage).catch(console.error);
        } else {
            await interaction.reply({
                content: errorMessage,
                flags: MessageFlags.Ephemeral
            }).catch(console.error);
        }
    }
});

// ERROR HANDLING

client.on(Events.Error, (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// STARTUP VALIDATION

if (!process.env.DISCORD_TOKEN) {
    console.error('ERROR: DISCORD_TOKEN is missing from .env!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error);
    process.exit(1);
});
