const os = require('os');
const express = require('express');
const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { Readable } = require('stream');
require('dotenv').config();

// Load configurations
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_CHANNEL_ID = process.env.CHANNEL_ID;
const SELF_MUTE = process.env.SELF_MUTE?.toLowerCase() === 'true';
const SELF_DEAF = process.env.SELF_DEAF?.toLowerCase() === 'true';
const KEEP_ALIVE = process.env.KEEP_ALIVE?.toLowerCase() === 'true';
const PORT = process.env.PORT || 8080;

if (!TOKEN || TOKEN.trim() === '') {
    console.error('[ERROR] DISCORD_TOKEN is missing in the .env file.');
    process.exit(1);
}

if (!DEFAULT_CHANNEL_ID || DEFAULT_CHANNEL_ID.trim() === '') {
    console.error('[ERROR] CHANNEL_ID is missing in the .env file.');
    process.exit(1);
}

let currentChannelId = DEFAULT_CHANNEL_ID;

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

// Handle client errors to prevent process crashes
client.on('error', (error) => {
    console.error(`[CLIENT ERROR] ${error.message}`);
});

client.on('shardError', (error) => {
    console.error(`[SHARD ERROR] A shard's WebSocket connection encountered an error: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION] Uncaught Exception: ', error);
});

// Opus silence frame (0xF8, 0xFF, 0xFE)
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

class SilenceStream extends Readable {
    constructor() {
        super();
        this.interval = null;
    }
    _read() {
        if (!this.interval) {
            this.interval = setInterval(() => {
                this.push(SILENCE_FRAME);
            }, 20);
        }
    }
    _destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}

const audioPlayer = createAudioPlayer();

audioPlayer.on('stateChange', (oldState, newState) => {
    console.log(`[AUDIO PLAYER] Changed from ${oldState.status} to ${newState.status}`);
});

audioPlayer.on('error', (error) => {
    console.error(`[AUDIO PLAYER ERROR] ${error.message}`);
});

function getTimestamp() {
    return new Date().toLocaleTimeString();
}

let targetGuildId = null;

async function safeJoinVoice(channelId = currentChannelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.error(`[${getTimestamp()}] [ERROR] Could not find channel with ID ${channelId}`);
            botStatus = `Error: Channel not found`;
            return;
        }

        if (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE') {
            console.error(`[${getTimestamp()}] [ERROR] Channel ${channelId} is not a Voice or Stage channel.`);
            botStatus = `Error: Invalid channel type`;
            return;
        }

        // Cache the correct guild ID
        targetGuildId = channel.guild.id;

        // Check if there is an existing active connection in the target guild
        const existingConnection = getVoiceConnection(targetGuildId);
        if (existingConnection) {
            const status = existingConnection.state.status;
            if (existingConnection.joinConfig.channelId === channelId && 
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

        // Subscribe to audio player transmitting silence to prevent inactivity disconnects
        connection.subscribe(audioPlayer);
        
        const silenceStream = new SilenceStream();
        const resource = createAudioResource(silenceStream, {
            inputType: StreamType.Opus
        });
        audioPlayer.play(resource);

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

async function scanAndMoveToActiveChannel() {
    try {
        const defaultChannel = await client.channels.fetch(DEFAULT_CHANNEL_ID);
        if (!defaultChannel) {
            console.error(`[${getTimestamp()}] [SCANNER] Could not find default channel with ID ${DEFAULT_CHANNEL_ID}`);
            return;
        }

        const guild = defaultChannel.guild;
        if (!guild) {
            console.error(`[${getTimestamp()}] [SCANNER] Could not resolve guild for default channel.`);
            return;
        }

        // Try to fetch latest channels state from guild API
        try {
            await guild.channels.fetch();
        } catch (fetchErr) {
            console.warn(`[${getTimestamp()}] [SCANNER] Warning: Failed to fetch guild channels from API, using cache: ${fetchErr.message}`);
        }

        // Filter for voice and stage channels
        const voiceChannels = guild.channels.cache.filter(c => c.type === 'GUILD_VOICE' || c.type === 'GUILD_STAGE_VOICE');

        let bestChannel = null;
        let maxActiveUsers = 0;

        for (const [id, channel] of voiceChannels) {
            // Count active humans (excluding our selfbot client)
            const humanCount = channel.members.filter(m => m.id !== client.user.id).size;
            
            if (humanCount > 0 && humanCount > maxActiveUsers) {
                maxActiveUsers = humanCount;
                bestChannel = channel;
            }
        }

        let newTargetId = DEFAULT_CHANNEL_ID;
        if (bestChannel) {
            newTargetId = bestChannel.id;
            console.log(`[${getTimestamp()}] [SCANNER] Found voice channel with active users: '${bestChannel.name}' (Active users: ${maxActiveUsers})`);
        } else {
            console.log(`[${getTimestamp()}] [SCANNER] No voice channels with active users found. Falling back to default channel.`);
        }

        if (currentChannelId !== newTargetId) {
            console.log(`[${getTimestamp()}] [SCANNER] Target voice channel changing from ${currentChannelId} to ${newTargetId}. Moving...`);
            currentChannelId = newTargetId;
            await safeJoinVoice(currentChannelId);
        } else {
            // Make sure the bot is actually in the target channel
            const connection = getVoiceConnection(guild.id);
            const status = connection?.state.status;
            if (!connection || status === 'disconnected' || status === 'destroyed' || connection.joinConfig.channelId !== currentChannelId) {
                console.log(`[${getTimestamp()}] [SCANNER] Bot is not in target channel ${currentChannelId}. Rejoining...`);
                await safeJoinVoice(currentChannelId);
            }
        }
    } catch (err) {
        console.error(`[${getTimestamp()}] [SCANNER ERROR] Failed to scan channels: ${err.message}`);
    }
}

client.on('ready', async () => {
    console.log('='.repeat(60));
    console.log(`Logged in as USER: ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`Default Voice Channel ID: ${DEFAULT_CHANNEL_ID}`);
    console.log('='.repeat(60));

    botStatus = 'Logged in, connecting to voice...';
    await safeJoinVoice(currentChannelId);

    // Initial check for active channels
    await scanAndMoveToActiveChannel();

    // Start keepalive checks every 30 seconds
    setInterval(async () => {
        if (!client.isReady()) return;

        // If targetGuildId isn't known yet, try to fetch the channel to resolve it
        if (!targetGuildId) {
            try {
                const channel = await client.channels.fetch(currentChannelId);
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
                await safeJoinVoice(currentChannelId);
            } else if (connection.joinConfig.channelId !== currentChannelId) {
                console.log(`[${getTimestamp()}] [KEEPALIVE] Connected to wrong channel (${connection.joinConfig.channelId}). Reconnecting to target channel...`);
                await safeJoinVoice(currentChannelId);
            }
        }
    }, 30000);

    // Start dynamic channel scanner checks every 4 minutes (240,000 milliseconds)
    console.log(`[${getTimestamp()}] [SCANNER] Starting voice channel scanner (checks every 4 minutes)...`);
    setInterval(async () => {
        if (!client.isReady()) return;
        await scanAndMoveToActiveChannel();
    }, 240000);
});

console.log('Starting Discord Client (Node.js)...');
client.login(TOKEN).catch((err) => {
    console.error(`[CRITICAL ERROR] Failed to login: ${err.message}`);
});
