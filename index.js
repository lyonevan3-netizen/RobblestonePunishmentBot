
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const punishmentDatabase = require('./database');

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

const app = express();

app.use(express.json({ limit: '32kb' }));

// BOT STARTUP

client.once(Events.ClientReady, (readyClient) => {
    console.log('====================================');
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log('Robblestone Punishment Bot is online!');
    console.log('====================================');

    processPunishmentQueue();

    setInterval(() => {
        processPunishmentQueue();
    }, 5000).unref();
});

// TEST LOGGING

async function sendTestLog(channelId, type, id) {
    if (!channelId) {
        throw new Error(`Missing channel ID for ${type}`);
    }

    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased() || !channel.threads) {
        throw new Error(`Channel ${channelId} is not usable.`);
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
                value: 'Testing Discord punishment logs'
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
        name: `Evidence - ${id}`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: 'Test punishment evidence thread'
    });

    console.log(`Created TEST ${type} log in #${channel.name}`);

    return channel.name;
}

// PERSISTENT PUNISHMENT DELIVERY QUEUE

let processingQueue = false;

async function processPunishmentQueue() {
    if (processingQueue || !client.isReady()) return;

    processingQueue = true;

    try {
        const pendingEvents = punishmentDatabase.getPending();

        for (const event of pendingEvents) {
            try {
                const payload = JSON.parse(event.payload_json);
                const channelIds = JSON.parse(event.channel_ids_json);
                const deliveredChannels =
                    JSON.parse(event.delivered_channels_json);

                const {
                    punishmentId,
                    type,
                    player,
                    staff,
                    reason,
                    duration,
                    expiresAt
                } = payload;

                const embed = new EmbedBuilder()
                    .setColor(
                        type === 'BAN' ? 0xE74C3C :
                        type === 'MUTE' ? 0xE67E22 :
                        0xF1C40F
                    )
                    .setTitle(`${type} PUNISHMENT`)
                    .addFields(
                        { name: 'Player', value: player, inline: true },
                        { name: 'Staff', value: staff, inline: true },
                        { name: 'Reason', value: reason },
                        {
                            name: 'Duration',
                            value: duration || 'Not specified',
                            inline: true
                        },
                        {
                            name: 'Punishment ID',
                            value: punishmentId,
                            inline: true
                        }
                    )
                    .setTimestamp()
                    .setFooter({
                        text: 'Robblestone Punishment System'
                    });

                if (expiresAt) {
                    embed.addFields({
                        name: 'Expires',
                        value: `<t:${Math.floor(
                            new Date(expiresAt).getTime() / 1000
                        )}:F>`
                    });
                }

                for (const channelId of channelIds) {
                    if (deliveredChannels.includes(channelId)) continue;

                    const channel = await client.channels.fetch(channelId);

                    if (
                        !channel ||
                        !channel.isTextBased() ||
                        !channel.threads
                    ) {
                        throw new Error(
                            `Discord channel ${channelId} is unavailable.`
                        );
                    }

                    const message = await channel.send({
                        embeds: [embed]
                    });

                    const thread = await message.startThread({
                        name: `Evidence - ${punishmentId}`.slice(0, 100),
                        autoArchiveDuration: 1440,
                        reason: 'Punishment evidence thread'
                    });

                    deliveredChannels.push(channelId);

                    punishmentDatabase.markDelivered(
                        punishmentId,
                        deliveredChannels
                    );

                    console.log(
                        `Delivered ${punishmentId} to #${channel.name}; evidence thread ${thread.id}`
                    );
                }

                punishmentDatabase.complete(punishmentId);

                console.log(
                    `Punishment ${punishmentId} fully delivered.`
                );

            } catch (error) {
                console.error(
                    `Queue delivery failed for ${event.punishment_id}:`,
                    error
                );

                punishmentDatabase.fail(
                    event.punishment_id,
                    event.attempts,
                    error.message
                );
            }
        }
    } finally {
        processingQueue = false;
    }
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

            await sendTestLog(generalId, 'WARNING', `${testId}-WARN`);
            await sendTestLog(generalId, 'MUTE', `${testId}-MUTE`);
            await sendTestLog(muteId, 'MUTE', `${testId}-MUTE`);
            await sendTestLog(generalId, 'BAN', `${testId}-BAN`);
            await sendTestLog(banId, 'BAN', `${testId}-BAN`);

            await interaction.editReply(
                'All test punishment logs and evidence threads were created successfully!'
            );
        }
    } catch (error) {
        console.error('Interaction error:', error);

        const errorMessage = `An error occurred: ${error.message}`;

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

// API SECURITY

function isAuthorised(req) {
    const secret = process.env.API_SECRET;

    if (!secret) return false;

    const supplied = req.get('Authorization') || '';
    const expected = `Bearer ${secret}`;

    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);

    return suppliedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

// API HEALTH CHECK

app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Robblestone Punishment Bot'
    });
});

// RECEIVE MINECRAFT PUNISHMENTS

app.post('/api/v1/punishments', (req, res) => {
    try {
        if (!isAuthorised(req)) {
            return res.status(401).json({
                error: 'Unauthorised'
            });
        }

        const {
            punishmentId,
            type,
            player,
            staff,
            reason,
            duration,
            expiresAt
        } = req.body || {};

        const validTypes = ['WARNING', 'MUTE', 'BAN'];

        if (
            typeof punishmentId !== 'string' ||
            !punishmentId.trim() ||
            punishmentId.length > 100 ||
            !validTypes.includes(type) ||
            typeof player !== 'string' ||
            !player.trim() ||
            player.length > 100 ||
            typeof staff !== 'string' ||
            !staff.trim() ||
            staff.length > 100 ||
            typeof reason !== 'string' ||
            !reason.trim() ||
            reason.length > 1000 ||
            (duration !== undefined &&
                (typeof duration !== 'string' || duration.length > 100)) ||
            (expiresAt !== undefined &&
                (typeof expiresAt !== 'string' ||
                 Number.isNaN(Date.parse(expiresAt))))
        ) {
            return res.status(400).json({
                error: 'Missing or invalid punishment information'
            });
        }

        const channelIds = [
            process.env.DISCORD_PUNISHMENTS_CHANNEL_ID
        ];

        if (type === 'MUTE') {
            channelIds.push(process.env.MUTE_PUNISHMENTS_CHANNEL_ID);
        }

        if (type === 'BAN') {
            channelIds.push(process.env.BAN_PUNISHMENTS_CHANNEL_ID);
        }

        if (channelIds.some(id => !id)) {
            return res.status(500).json({
                error: 'A required Discord channel is not configured'
            });
        }

        const payload = {
            punishmentId,
            type,
            player,
            staff,
            reason,
            duration: duration || 'Not specified',
            expiresAt: expiresAt || null
        };

        const inserted = punishmentDatabase.queuePunishment(
            punishmentId,
            type,
            payload,
            channelIds
        );

        if (!inserted) {
            return res.status(200).json({
                success: true,
                duplicate: true,
                punishmentId
            });
        }

        console.log(`Queued punishment ${punishmentId} (${type})`);

        processPunishmentQueue();

        return res.status(202).json({
            success: true,
            queued: true,
            punishmentId
        });

    } catch (error) {
        console.error('Punishment API error:', error);

        return res.status(500).json({
            error: 'Failed to queue punishment'
        });
    }
});

// API ERROR HANDLING

app.use((error, req, res, next) => {
    console.error('API request error:', error);

    if (!res.headersSent) {
        res.status(400).json({
            error: 'Invalid API request'
        });
    }
});

// GENERAL ERROR HANDLING

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

if (!process.env.API_SECRET) {
    console.error('ERROR: API_SECRET is missing from .env!');
    process.exit(1);
}

// START API

const apiPort = Number(process.env.API_PORT || 3000);

if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    console.error('ERROR: API_PORT is invalid!');
    process.exit(1);
}

app.listen(apiPort, '0.0.0.0', () => {
    console.log(`Punishment API listening on port ${apiPort}`);
});

// START DISCORD BOT

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error);
    process.exit(1);
});
