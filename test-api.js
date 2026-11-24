
require('dotenv').config();

const port = process.env.API_PORT || 3000;
const secret = process.env.API_SECRET;

if (!secret) {
    console.error('API_SECRET is missing from .env');
    process.exit(1);
}

async function sendTestPunishment(type) {
    const punishmentId = `BOTTEST-${type}-${Date.now()}`;

    const response = await fetch(
        `http://localhost:${port}/api/v1/punishments`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secret}`
            },
            body: JSON.stringify({
                punishmentId,
                type,
                player: 'ExamplePlayer',
                staff: 'TestStaff',
                reason: `Testing the ${type} punishment API`,
                duration: type === 'WARNING' ? 'Permanent record' : '1 day',
                expiresAt: type === 'WARNING'
                    ? undefined
                    : new Date(Date.now() + 86400000).toISOString()
            })
        }
    );

    const result = await response.json();

    console.log(`${type}: HTTP ${response.status}`, result);
}

async function main() {
    await sendTestPunishment('WARNING');
    await sendTestPunishment('MUTE');
    await sendTestPunishment('BAN');
}

main().catch(console.error);
