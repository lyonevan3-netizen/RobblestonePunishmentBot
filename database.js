
const Database = require('better-sqlite3');

const db = new Database('punishments.sqlite');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS punishment_events (
        punishment_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        channel_ids_json TEXT NOT NULL,
        delivered_channels_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_punishment_queue
    ON punishment_events (status, next_attempt_at);
`);

const insertPunishment = db.prepare(`
    INSERT OR IGNORE INTO punishment_events (
        punishment_id,
        type,
        payload_json,
        channel_ids_json,
        created_at
    )
    VALUES (?, ?, ?, ?, ?)
`);

const selectPending = db.prepare(`
    SELECT *
    FROM punishment_events
    WHERE status = 'pending'
      AND next_attempt_at <= ?
    ORDER BY created_at ASC
    LIMIT 25
`);

const updateDelivered = db.prepare(`
    UPDATE punishment_events
    SET delivered_channels_json = ?
    WHERE punishment_id = ?
`);

const completePunishment = db.prepare(`
    UPDATE punishment_events
    SET status = 'completed'
    WHERE punishment_id = ?
`);

const recordFailure = db.prepare(`
    UPDATE punishment_events
    SET attempts = attempts + 1,
        next_attempt_at = ?,
        last_error = ?
    WHERE punishment_id = ?
`);

function queuePunishment(punishmentId, type, payload, channelIds) {
    const result = insertPunishment.run(
        punishmentId,
        type,
        JSON.stringify(payload),
        JSON.stringify(channelIds),
        Date.now()
    );

    return result.changes > 0;
}

function getPending() {
    return selectPending.all(Date.now());
}

function markDelivered(punishmentId, deliveredChannels) {
    updateDelivered.run(
        JSON.stringify(deliveredChannels),
        punishmentId
    );
}

function complete(punishmentId) {
    completePunishment.run(punishmentId);
}

function fail(punishmentId, attempts, error) {
    const delay = Math.min(
        5000 * Math.pow(2, attempts),
        15 * 60 * 1000
    );

    recordFailure.run(
        Date.now() + delay,
        String(error).slice(0, 1000),
        punishmentId
    );
}

module.exports = {
    queuePunishment,
    getPending,
    markDelivered,
    complete,
    fail
};
