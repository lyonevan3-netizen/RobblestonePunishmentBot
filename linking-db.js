
const Database = require('better-sqlite3');
const crypto = require('crypto');

const dbPath = process.env.LINKS_DB_PATH || './account-links.sqlite';
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS pending_link_codes (
    code_hash TEXT PRIMARY KEY,
    minecraft_uuid TEXT NOT NULL,
    minecraft_username TEXT NOT NULL,
    public_rank TEXT NOT NULL DEFAULT '',
    staff_rank TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_link_uuid
ON pending_link_codes(minecraft_uuid);

CREATE TABLE IF NOT EXISTS linked_accounts (
    minecraft_uuid TEXT PRIMARY KEY,
    minecraft_username TEXT NOT NULL,
    discord_user_id TEXT NOT NULL UNIQUE,
    public_rank TEXT NOT NULL DEFAULT '',
    staff_rank TEXT NOT NULL DEFAULT '',
    linked_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption_attempts (
    discord_user_id TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
);
`);

const hashCode = code =>
    crypto.createHash('sha256').update(code).digest('hex');

function issueCode({ uuid, username, publicRank = '', staffRank = '' }) {
    const now = Date.now();

    const last = db.prepare(`
        SELECT created_at
        FROM pending_link_codes
        WHERE minecraft_uuid=?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(uuid);

    if (last && now - last.created_at < 30000) {
        const error = new Error(
            'Please wait 30 seconds before requesting another code.'
        );
        error.code = 'RATE_LIMITED';
        throw error;
    }

    const code = crypto.randomInt(0, 1000000)
        .toString()
        .padStart(6, '0');

    const codeHash = hashCode(code);
    const expiresAt = now + 5 * 60 * 1000;

    const tx = db.transaction(() => {
        db.prepare(`
            DELETE FROM pending_link_codes
            WHERE minecraft_uuid=?
        `).run(uuid);

        db.prepare(`
            INSERT INTO pending_link_codes (
                code_hash,
                minecraft_uuid,
                minecraft_username,
                public_rank,
                staff_rank,
                created_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            codeHash,
            uuid,
            username,
            publicRank,
            staffRank,
            now,
            expiresAt
        );
    });

    tx();

    return {
        code,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

function redeemCode(code, discordUserId) {
    const normalized = String(code || '').trim();
    const now = Date.now();

    if (!discordUserId) {
        return { status: 'invalid' };
    }

    const tx = db.transaction(() => {
        let attempts = db.prepare(`
            SELECT *
            FROM redemption_attempts
            WHERE discord_user_id=?
        `).get(discordUserId);

        if (attempts && attempts.locked_until > now) {
            return {
                status: 'rate_limited',
                retryAt: attempts.locked_until
            };
        }

        if (!attempts || now - attempts.window_started_at >= 10 * 60 * 1000) {
            db.prepare(`
                INSERT INTO redemption_attempts
                    (discord_user_id, window_started_at, attempts, locked_until)
                VALUES (?, ?, 0, 0)
                ON CONFLICT(discord_user_id) DO UPDATE SET
                    window_started_at=excluded.window_started_at,
                    attempts=0,
                    locked_until=0
            `).run(discordUserId, now);

            attempts = {
                attempts: 0
            };
        }

        const recordFailure = () => {
            const newAttempts = attempts.attempts + 1;
            const lockedUntil = newAttempts >= 5
                ? now + 10 * 60 * 1000
                : 0;

            db.prepare(`
                INSERT INTO redemption_attempts
                    (discord_user_id, window_started_at, attempts, locked_until)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(discord_user_id) DO UPDATE SET
                    attempts=excluded.attempts,
                    locked_until=excluded.locked_until
            `).run(
                discordUserId,
                attempts.window_started_at || now,
                newAttempts,
                lockedUntil
            );

            return lockedUntil
                ? { status: 'rate_limited', retryAt: lockedUntil }
                : { status: 'invalid' };
        };

        if (!/^\d{6}$/.test(normalized)) {
            return recordFailure();
        }

        const pending = db.prepare(`
            SELECT *
            FROM pending_link_codes
            WHERE code_hash=?
        `).get(hashCode(normalized));

        if (!pending) {
            return recordFailure();
        }

        if (pending.expires_at <= now) {
            db.prepare(`
                DELETE FROM pending_link_codes
                WHERE code_hash=?
            `).run(hashCode(normalized));

            return { status: 'expired' };
        }

        const existingMinecraft = db.prepare(`
            SELECT discord_user_id
            FROM linked_accounts
            WHERE minecraft_uuid=?
        `).get(pending.minecraft_uuid);

        if (existingMinecraft &&
            existingMinecraft.discord_user_id !== discordUserId) {
            return { status: 'minecraft_already_linked' };
        }

        const existingDiscord = db.prepare(`
            SELECT minecraft_uuid
            FROM linked_accounts
            WHERE discord_user_id=?
        `).get(discordUserId);

        if (existingDiscord &&
            existingDiscord.minecraft_uuid !== pending.minecraft_uuid) {
            return { status: 'discord_already_linked' };
        }

        db.prepare(`
            INSERT INTO linked_accounts (
                minecraft_uuid,
                minecraft_username,
                discord_user_id,
                public_rank,
                staff_rank,
                linked_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(minecraft_uuid) DO UPDATE SET
                minecraft_username=excluded.minecraft_username,
                public_rank=excluded.public_rank,
                staff_rank=excluded.staff_rank,
                updated_at=excluded.updated_at
        `).run(
            pending.minecraft_uuid,
            pending.minecraft_username,
            discordUserId,
            pending.public_rank,
            pending.staff_rank,
            now,
            now
        );

        db.prepare(`
            DELETE FROM pending_link_codes
            WHERE code_hash=?
        `).run(hashCode(normalized));

        db.prepare(`
            DELETE FROM redemption_attempts
            WHERE discord_user_id=?
        `).run(discordUserId);

        return {
            status: 'linked',
            uuid: pending.minecraft_uuid,
            username: pending.minecraft_username,
            discordUserId,
            publicRank: pending.public_rank,
            staffRank: pending.staff_rank
        };
    });

    return tx();
}

function updateRanks(uuid, username, publicRank, staffRank) {
    const result = db.prepare(`
        UPDATE linked_accounts SET
            minecraft_username=?,
            public_rank=?,
            staff_rank=?,
            updated_at=?
        WHERE minecraft_uuid=?
    `).run(
        username,
        publicRank || '',
        staffRank || '',
        Date.now(),
        uuid
    );

    return result.changes > 0;
}

function unlinkDiscord(discordUserId) {
    const row = db.prepare(`
        SELECT *
        FROM linked_accounts
        WHERE discord_user_id=?
    `).get(discordUserId);

    if (!row) return null;

    db.prepare(`
        DELETE FROM linked_accounts
        WHERE discord_user_id=?
    `).run(discordUserId);

    return row;
}

function getAllLinked() {
    return db.prepare(`
        SELECT * FROM linked_accounts
    `).all();
}

function getByUuid(uuid) {
    return db.prepare(`
        SELECT *
        FROM linked_accounts
        WHERE minecraft_uuid=?
    `).get(uuid) || null;
}

module.exports = {
    issueCode,
    redeemCode,
    updateRanks,
    unlinkDiscord,
    getAllLinked,
    getByUuid
};
