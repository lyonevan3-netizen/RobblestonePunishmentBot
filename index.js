
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const punishmentDatabase = require('./database');
const linkingDatabase = require('./linking-db');

const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const app = express();

app.use(express.json({ limit: '32kb' }));

// ============================================
// MANAGED DISCORD ROLE SYNCHRONISATION
// ============================================

// Public rank roles: Main Discord ONLY.
// These roles never grant Minecraft staff permissions.

const PUBLIC_RANK_ROLES = {
    everfrost: '1574536863543464017',
    celestial: '1444132471661789224',
    divine: '1574536395429650512',
    elite: '1574536540774867075',
    champion: '1574536702222143629'
};

// Main Discord staff roles.

const MAIN_STAFF_ROLES = {
    helper: '1564067882407829574',
    mod: '1442966864694349924',
    snrmod: '1519119882602545223',
    admin: '843659441329143819',
    director: '1444754871797678110'
};

// Staff Discord staff roles.

const STAFF_SERVER_ROLES = {
    helper: '1539475267913777242',
    mod: '1539475551557779507',
    snrmod: '1539485309723476019',
    admin: '1539477444459765811',
    director: '1539477756994134038'
};

// Update a member's integration-managed roles.

async function updateMemberRoles(
    guildId,
    discordUserId,
    managedRoleIds,
    desiredRoleIds
) {
    if (!guildId) return 'not_configured';

    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(discordUserId);

        const removeIds = managedRoleIds.filter(
            id => member.roles.cache.has(id) && !desiredRoleIds.includes(id)
        );

        const addIds = desiredRoleIds.filter(
            id => !member.roles.cache.has(id)
        );

        if (removeIds.length) {
            await member.roles.remove(
                removeIds,
                'Robblestone rank synchronisation'
            );
        }

        if (addIds.length) {
            await member.roles.add(
                addIds,
                'Robblestone rank synchronisation'
            );
        }

        return 'updated';

    } catch (error) {
        if (error.code === 10007 || error.code === 10004) {
            return 'not_a_member';
        }

        throw error;
    }
}

// Synchronise the roles for one linked Minecraft account.

async function syncLinkedAccountRoles(account) {
    if (!client.isReady()) return;

    const publicRole = PUBLIC_RANK_ROLES[account.public_rank] || null;
    const mainStaffRole = MAIN_STAFF_ROLES[account.staff_rank] || null;
    const staffRole = STAFF_SERVER_ROLES[account.staff_rank] || null;

    const mainManaged = [
        ...Object.values(PUBLIC_RANK_ROLES),
        ...Object.values(MAIN_STAFF_ROLES)
    ];

    const mainDesired = [
        publicRole,
        mainStaffRole
    ].filter(Boolean);

    const staffManaged = Object.values(STAFF_SERVER_ROLES);

    const staffDesired = [
        staffRole
    ].filter(Boolean);

    const results = await Promise.all([
        updateMemberRoles(
            process.env.MAIN_GUILD_ID,
            account.discord_user_id,
            mainManaged,
            mainDesired
        ),
        updateMemberRoles(
            process.env.STAFF_GUILD_ID,
            account.discord_user_id,
            staffManaged,
            staffDesired
        )
    ]);

    console.log(
        `Role sync for ${account.minecraft_username} (${account.discord_user_id}): Main=${results[0]}, Staff=${results[1]}`
    );

    return results;
}

// Remove only roles managed by this integration.

async function removeLinkedAccountRoles(discordUserId) {
    const mainManaged = [
        ...Object.values(PUBLIC_RANK_ROLES),
        ...Object.values(MAIN_STAFF_ROLES)
    ];

    const staffManaged = Object.values(STAFF_SERVER_ROLES);

    await Promise.all([
        updateMemberRoles(
            process.env.MAIN_GUILD_ID,
            discordUserId,
            mainManaged,
            []
        ),
        updateMemberRoles(
            process.env.STAFF_GUILD_ID,
            discordUserId,
            staffManaged,
            []
        )
    ]);
}

// ============================================
// BOT STARTUP
// ============================================

client.once(Events.ClientReady, (readyClient) => {
    console.log('====================================');
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log('Robblestone Punishment Bot is online!');
    console.log('====================================');

    // Process saved punishments immediately.

    processPunishmentQueue();

    // Reconcile roles for accounts already linked before restart.

    for (const account of linkingDatabase.getAllLinked()) {
        syncLinkedAccountRoles(account).catch(error =>
            console.error(
                `Initial role reconciliation failed for ${account.minecraft_username}:`,
                error
            )
        );
    }

    // Process new punishments every five seconds.

    setInterval(() => {
        processPunishmentQueue();
    }, 5000).unref();

    // Recheck linked account roles every five minutes.
    // This helps correct roles after missed rank updates.

    setInterval(async () => {
        if (!client.isReady()) return;

        for (const account of linkingDatabase.getAllLinked()) {
            try {
                await syncLinkedAccountRoles(account);
            } catch (error) {
                console.error(
                    `Periodic role reconciliation failed for ${account.minecraft_username}:`,
                    error
                );
            }
        }
    }, 5 * 60 * 1000).unref();
});

// ============================================
// TEST LOGGING
// ============================================

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

// ============================================
// PERSISTENT PUNISHMENT DELIVERY QUEUE
// ============================================

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
                    staffUuid,
                    reason,
                    duration,
                    expiresAt
                } = payload;

                const linkedStaff = staffUuid
                    ? linkingDatabase.getByUuid(staffUuid)
                    : null;

                const staffDisplay = linkedStaff
                    ? `<@${linkedStaff.discord_user_id}> (${staff})`
                    : staff;

                const embed = new EmbedBuilder()
                    .setColor(
                        type === 'BAN' ? 0xE74C3C :
                        type === 'MUTE' ? 0xE67E22 :
                        0xF1C40F
                    )
                    .setTitle(`${type} PUNISHMENT`)
                    .addFields(
                        { name: 'Player', value: player, inline: true },
                        { name: 'Staff', value: staffDisplay, inline: true },
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

// ============================================
// SLASH COMMAND HANDLER
// ============================================

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // MINECRAFT ACCOUNT LINKING


        // MINECRAFT ACCOUNT LINKING

        if (interaction.commandName === 'link') {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const code = interaction.options.getString('code', true);

            const result = linkingDatabase.redeemCode(
                code,
                interaction.user.id
            );

            if (result.status === 'invalid') {
                await interaction.editReply(
                    'That code is invalid. Check the six digits and try again. You can request a new code in Minecraft.'
                );
                return;
            }

            if (result.status === 'expired') {
                await interaction.editReply(
                    'That link code has expired. Run `/link` in Minecraft to generate a new one.'
                );
                return;
            }

            if (result.status === 'rate_limited') {
                const remainingSeconds = Math.max(
                    1,
                    Math.ceil((result.retryAt - Date.now()) / 1000)
                );

                await interaction.editReply(
                    `Too many incorrect attempts. Please wait ${remainingSeconds} seconds before trying again.`
                );
                return;
            }

            if (result.status === 'minecraft_already_linked') {
                await interaction.editReply(
                    'That Minecraft account is already linked to a different Discord account. Unlink it first.'
                );
                return;
            }

            if (result.status === 'discord_already_linked') {
                await interaction.editReply(
                    'Your Discord account is already linked to a different Minecraft account. Use `/unlink` first.'
                );
                return;
            }

            const account = linkingDatabase.getByUuid(result.uuid);

            let roleMessage =
                'Your account is linked. Rank roles will synchronise shortly.';

            try {
                if (account) {
                    await syncLinkedAccountRoles(account);
                }

                roleMessage =
                    'Your Minecraft account is now linked. Your managed rank roles have been synchronised where you are a member.';

            } catch (error) {
                console.error(
                    'Initial linked-account role sync failed:',
                    error
                );

                roleMessage =
                    'Your account is linked, but role synchronisation could not complete. It will be retried; please check bot role permissions.';
            }

            await interaction.editReply(
                `Successfully linked **${result.username}**. ${roleMessage}`
            );

            return;
        }


        // SAFE ACCOUNT UNLINKING

        if (interaction.commandName === 'unlink') {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            // Find the linked account without deleting it yet.

            const account = linkingDatabase.getAllLinked().find(
                entry => entry.discord_user_id === interaction.user.id
            );

            if (!account) {
                await interaction.editReply(
                    'Your Discord account is not currently linked.'
                );
                return;
            }

            try {
                // Remove integration-managed Discord roles first.

                await removeLinkedAccountRoles(interaction.user.id);

                // Only delete the account link after role cleanup succeeds.

                const removed = linkingDatabase.unlinkDiscord(
                    interaction.user.id
                );

                if (!removed) {
                    throw new Error(
                        'The account link could not be removed from the database.'
                    );
                }

                await interaction.editReply(
                    `Successfully unlinked **${account.minecraft_username}**. Your integration-managed public and staff roles have been removed where possible.`
                );

            } catch (error) {
                console.error('Unlink operation failed:', error);

                await interaction.editReply(
                    'Unlinking could not be completed because Discord role cleanup failed. Your account link has been preserved. Please contact an administrator.'
                );
            }

            return;
        }

        // PING COMMAND

        if (interaction.commandName === 'ping') {
            await interaction.reply({
                content: 'Pong! 🏓 Robblestone Punishment Bot is working!',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // TEST LOGS COMMAND

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

            const generalId =
                process.env.DISCORD_PUNISHMENTS_CHANNEL_ID;

            const muteId =
                process.env.MUTE_PUNISHMENTS_CHANNEL_ID;

            const banId =
                process.env.BAN_PUNISHMENTS_CHANNEL_ID;

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

// ============================================
// API SECURITY
// ============================================

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

// ============================================
// CREATE A ONE-TIME MINECRAFT LINK CODE
// ============================================

app.post('/api/v1/link-codes', (req, res) => {
    try {
        if (!isAuthorised(req)) {
            return res.status(401).json({
                error: 'Unauthorised'
            });
        }

        const {
            uuid,
            username,
            publicRank = '',
            staffRank = ''
        } = req.body || {};

        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        const publicKeys = new Set(
            Object.keys(PUBLIC_RANK_ROLES)
        );

        const staffKeys = new Set(
            Object.keys(MAIN_STAFF_ROLES)
        );

        if (
            typeof uuid !== 'string' ||
            !uuidPattern.test(uuid) ||
            typeof username !== 'string' ||
            !username.trim() ||
            username.length > 64 ||
            typeof publicRank !== 'string' ||
            (publicRank && !publicKeys.has(publicRank)) ||
            typeof staffRank !== 'string' ||
            (staffRank && !staffKeys.has(staffRank))
        ) {
            return res.status(400).json({
                error: 'Missing or invalid link information'
            });
        }

        const issued = linkingDatabase.issueCode({
            uuid: uuid.toLowerCase(),
            username: username.trim(),
            publicRank,
            staffRank
        });

        return res.status(201).json({
            code: issued.code,
            expiresAt: issued.expiresAt
        });

    } catch (error) {
        if (error.code === 'RATE_LIMITED') {
            return res.status(429).json({
                error: error.message
            });
        }

        console.error('Link-code API error:', error);

        return res.status(500).json({
            error: 'Could not create a link code'
        });
    }
});

// ============================================
// UPDATE DISCORD ROLES AFTER A LUCKPERMS CHANGE
// ============================================

app.post('/api/v1/ranks/sync', async (req, res) => {
    try {
        if (!isAuthorised(req)) {
            return res.status(401).json({
                error: 'Unauthorised'
            });
        }

        const {
            uuid,
            username,
            publicRank = '',
            staffRank = ''
        } = req.body || {};

        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (
            typeof uuid !== 'string' ||
            !uuidPattern.test(uuid) ||
            typeof username !== 'string' ||
            !username.trim() ||
            username.length > 64 ||
            typeof publicRank !== 'string' ||
            (publicRank && !Object.hasOwn(PUBLIC_RANK_ROLES, publicRank)) ||
            typeof staffRank !== 'string' ||
            (staffRank && !Object.hasOwn(MAIN_STAFF_ROLES, staffRank))
        ) {
            return res.status(400).json({
                error: 'Missing or invalid rank information'
            });
        }

        const normalizedUuid = uuid.toLowerCase();

        const linked = linkingDatabase.updateRanks(
            normalizedUuid,
            username.trim(),
            publicRank,
            staffRank
        );

        if (!linked) {
            return res.status(200).json({
                success: true,
                linked: false
            });
        }

        const account = linkingDatabase.getByUuid(normalizedUuid);

        if (account && client.isReady()) {
            await syncLinkedAccountRoles(account);
        }

        return res.status(200).json({
            success: true,
            linked: true
        });

    } catch (error) {
        console.error('Rank-sync API error:', error);

        return res.status(500).json({
            error: 'Could not synchronise Discord roles'
        });
    }
});

// ============================================
// API HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Robblestone Punishment Bot'
    });
});

// ============================================
// RECEIVE MINECRAFT PUNISHMENTS
// ============================================

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
            staffUuid,
            reason,
            duration,
            expiresAt
        } = req.body || {};

        const validTypes = [
            'WARNING',
            'MUTE',
            'BAN'
        ];

        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
                 Number.isNaN(Date.parse(expiresAt)))) ||
            (staffUuid !== undefined &&
                staffUuid !== null &&
                staffUuid !== '' &&
                (typeof staffUuid !== 'string' ||
                 !uuidPattern.test(staffUuid)))
        ) {
            return res.status(400).json({
                error: 'Missing or invalid punishment information'
            });
        }

        const channelIds = [
            process.env.DISCORD_PUNISHMENTS_CHANNEL_ID
        ];

        if (type === 'MUTE') {
            channelIds.push(
                process.env.MUTE_PUNISHMENTS_CHANNEL_ID
            );
        }

        if (type === 'BAN') {
            channelIds.push(
                process.env.BAN_PUNISHMENTS_CHANNEL_ID
            );
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
            staffUuid: staffUuid
                ? staffUuid.toLowerCase()
                : null,
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

        console.log(
            `Queued punishment ${punishmentId} (${type})`
        );

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

// ============================================
// API ERROR HANDLING
// ============================================

app.use((error, req, res, next) => {
    console.error('API request error:', error);

    if (!res.headersSent) {
        res.status(400).json({
            error: 'Invalid API request'
        });
    }
});

// ============================================
// GENERAL ERROR HANDLING
// ============================================

client.on(Events.Error, (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// ============================================
// STARTUP VALIDATION
// ============================================

if (!process.env.DISCORD_TOKEN) {
    console.error('ERROR: DISCORD_TOKEN is missing from .env!');
    process.exit(1);
}

if (!process.env.API_SECRET) {
    console.error('ERROR: API_SECRET is missing from .env!');
    process.exit(1);
}

// ============================================
// START API
// ============================================

const apiPort = Number(process.env.API_PORT || 3000);

if (
    !Number.isInteger(apiPort) ||
    apiPort < 1 ||
    apiPort > 65535
) {
    console.error('ERROR: API_PORT is invalid!');
    process.exit(1);
}

app.listen(apiPort, '0.0.0.0', () => {
    console.log(
        `Punishment API listening on port ${apiPort}`
    );
});

// ============================================
// START DISCORD BOT
// ============================================

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to log in:', error);
    process.exit(1);
});
