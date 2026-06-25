const os = require('os');
const express = require('express');
const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
require('dotenv').config();

// Load configurations
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const SELF_MUTE = process.env.SELF_MUTE?.toLowerCase() === 'true';
const SELF_DEAF = process.env.SELF_DEAF?.toLowerCase() === 'true';
const KEEP_ALIVE = process.env.KEEP_ALIVE?.toLowerCase() === 'true';
const PORT = process.env.PORT || 8080;

if (!TOKEN || TOKEN.trim() === '') {
    console.error('[ERROR] DISCORD_TOKEN is missing in the .env file.');
    process.exit(1);
}

if (!CHANNEL_ID || CHANNEL_ID.trim() === '') {
    console.error('[ERROR] CHANNEL_ID is missing in the .env file.');
    process.exit(1);
}

// Configure Express app for 24/7 web server keep-alive
const app = express();
let botStatus = 'Initializing...';

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        bot_status: botStatus,
        timestamp: new Date().toISOString(),
        message: 'Discord Voice 24/7 Idler (Node.js) is running successfully!'
    });
});

if (KEEP_ALIVE) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[HTTP] Starting keep-alive web server on port ${PORT}...`);
    }).on('error', (err) => {
        console.error(`[HTTP Error] Failed to start web server: ${err.message}`);
    });
} else {
    console.log('[HTTP] Keep-alive web server is disabled via config.');
}

// Initialize Discord Client (Self-bot)
const client = new Client({
    patchVoice: true // Critical: patches discord.js voice gateway connection for user accounts
});

function getTimestamp() {
    return new Date().toLocaleTimeString();
}

let targetGuildId = null;

async function safeJoinVoice() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.error(`[${getTimestamp()}] [ERROR] Could not find channel with ID ${CHANNEL_ID}`);
            botStatus = `Error: Channel not found`;
            return;
        }

        if (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE') {
            console.error(`[${getTimestamp()}] [ERROR] Channel ${CHANNEL_ID} is not a Voice or Stage channel.`);
            botStatus = `Error: Invalid channel type`;
            return;
        }

        // Cache the correct guild ID
        targetGuildId = channel.guild.id;

        // Check if there is an existing active connection in the target guild
        const existingConnection = getVoiceConnection(targetGuildId);
        if (existingConnection) {
            const status = existingConnection.state.status;
            if (existingConnection.joinConfig.channelId === CHANNEL_ID && 
                status !== 'disconnected' && 
                status !== 'destroyed') {
                // Already connected to the right channel and healthy, skip rejoining
                botStatus = `Connected to voice channel: ${channel.name} (${channel.guild.name})`;
                return;
            }
        }

        console.log(`[${getTimestamp()}] [INFO] Attempting to connect to channel '${channel.name}' in guild '${channel.guild.name}'...`);
        botStatus = `Connecting to ${channel.name}...`;

        // Establish voice connection using @discordjs/voice
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfMute: SELF_MUTE,
            selfDeaf: SELF_DEAF,
        });

        connection.removeAllListeners('stateChange');
        connection.removeAllListeners('error');

        connection.on('stateChange', (oldState, newState) => {
            console.log(`[${getTimestamp()}] [VOICE STATE] Changed from ${oldState.status} to ${newState.status}`);
            if (newState.status === 'ready') {
                console.log(`[${getTimestamp()}] [SUCCESS] Voice connection established successfully!`);
                botStatus = `Connected to voice channel: ${channel.name} (${channel.guild.name})`;
            }
        });

        connection.on('error', (error) => {
            console.error(`[${getTimestamp()}] [VOICE ERROR] Voice connection error: ${error.message}`);
            botStatus = `Voice Connection Error: ${error.message}`;
        });

    } catch (err) {
        console.error(`[${getTimestamp()}] [ERROR] Failed to join voice channel: ${err.message}`);
        botStatus = `Failed to connect: ${err.message}`;
    }
}

client.on('ready', async () => {
    console.log('='.repeat(60));
    console.log(`Logged in as USER: ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`Target Voice Channel ID: ${CHANNEL_ID}`);
    console.log('='.repeat(60));

    botStatus = 'Logged in, connecting to voice...';
    await safeJoinVoice();

    // Start keepalive checks every 30 seconds
    setInterval(async () => {
        if (!client.isReady()) return;

        // If targetGuildId isn't known yet, try to fetch the channel to resolve it
        if (!targetGuildId) {
            try {
                const channel = await client.channels.fetch(CHANNEL_ID);
                if (channel) {
                    targetGuildId = channel.guild.id;
                }
            } catch (err) {
                console.error(`[${getTimestamp()}] [KEEPALIVE] Failed to fetch channel to find guild ID: ${err.message}`);
            }
        }

        if (targetGuildId) {
            const connection = getVoiceConnection(targetGuildId);
            const status = connection?.state.status;
            
            // Reconnect if the connection is missing, disconnected, or destroyed
            if (!connection || status === 'disconnected' || status === 'destroyed') {
                console.log(`[${getTimestamp()}] [KEEPALIVE] Voice connection not found or inactive (status: ${status || 'none'}). Reconnecting...`);
                await safeJoinVoice();
            } else if (connection.joinConfig.channelId !== CHANNEL_ID) {
                console.log(`[${getTimestamp()}] [KEEPALIVE] Connected to wrong channel (${connection.joinConfig.channelId}). Reconnecting to target channel...`);
                await safeJoinVoice();
            }
        }
    }, 30000);
});

console.log('Starting Discord Client (Node.js)...');
client.login(TOKEN).catch((err) => {
    console.error(`[CRITICAL ERROR] Failed to login: ${err.message}`);
});
