const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { Readable } = require('stream');
const ffmpeg = require('ffmpeg-static');
require('dotenv').config();

if (ffmpeg) {
    const ffmpegDir = path.dirname(ffmpeg);
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH}`;
}

const SPEECH_FILE = path.join(__dirname, 'speech.mp3');

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
    if (newState.status === 'idle') {
        console.log(`[AUDIO PLAYER] Finished playing or idle. Resuming silence keepalive...`);
        try {
            const silenceStream = new SilenceStream();
            const resource = createAudioResource(silenceStream, {
                inputType: StreamType.Opus
            });
            audioPlayer.play(resource);
        } catch (silenceErr) {
            console.error(`[AUDIO PLAYER ERROR] Failed to resume silence keepalive: ${silenceErr.message}`);
        }
    }
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

                // Play voice message after 10 seconds of joining
                if (fs.existsSync(SPEECH_FILE)) {
                    console.log(`[${getTimestamp()}] [SPEECH] Scheduled speech.mp3 to play in 10 seconds...`);
                    setTimeout(() => {
                        const currentConnection = getVoiceConnection(targetGuildId);
                        if (currentConnection && currentConnection.state.status === 'ready' && currentConnection.joinConfig.channelId === channelId) {
                            console.log(`[${getTimestamp()}] [SPEECH] Playing speech.mp3 now.`);
                            try {
                                const resource = createAudioResource(SPEECH_FILE);
                                audioPlayer.play(resource);
                            } catch (speechErr) {
                                console.error(`[${getTimestamp()}] [SPEECH ERROR] Failed to play speech.mp3: ${speechErr.message}`);
                            }
                        }
                    }, 10000);
                } else {
                    console.log(`[${getTimestamp()}] [SPEECH] No speech.mp3 file found at ${SPEECH_FILE}. Skipping speech playback.`);
                }
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

        // Filter for voice and stage channels that have space
        const availableChannels = voiceChannels.filter(channel => {
            const isCurrentChannel = channel.members.has(client.user.id);
            return channel.userLimit === 0 || channel.members.size < channel.userLimit || isCurrentChannel;
        });

        if (availableChannels.size === 0) {
            console.log(`[${getTimestamp()}] [SCANNER] No available voice channels with space found.`);
            return;
        }

        // Filter channels that have other human users
        const populatedChannels = availableChannels.filter(c => c.members.filter(m => m.id !== client.user.id).size > 0);

        let chosenChannel = null;
        if (populatedChannels.size > 0) {
            // Pick a random channel from those that have people and space
            const list = [...populatedChannels.values()];
            chosenChannel = list[Math.floor(Math.random() * list.length)];
            console.log(`[${getTimestamp()}] [SCANNER] Found ${populatedChannels.size} populated channels with space. Selected random: '${chosenChannel.name}' (People: ${chosenChannel.members.size})`);
        } else {
            // Pick a random channel from all available channels with space
            const list = [...availableChannels.values()];
            chosenChannel = list[Math.floor(Math.random() * list.length)];
            console.log(`[${getTimestamp()}] [SCANNER] No populated channels. Selected random available: '${chosenChannel.name}'`);
        }

        const newTargetId = chosenChannel.id;

        if (currentChannelId !== newTargetId) {
            console.log(`[${getTimestamp()}] [SCANNER] Target voice channel changing from ${currentChannelId} to ${newTargetId}. Moving...`);
            currentChannelId = newTargetId;
            await safeJoinVoice(currentChannelId);
        } else {
            // Make sure the bot is actually in the target channel and healthy
            const connection = getVoiceConnection(guild.id);
            const status = connection?.state.status;
            if (!connection || status === 'disconnected' || status === 'destroyed' || connection.joinConfig.channelId !== currentChannelId) {
                console.log(`[${getTimestamp()}] [SCANNER] Bot is not in target channel ${currentChannelId} or status is ${status || 'none'}. Rejoining...`);
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

    botStatus = 'Logged in, scanning channels...';
    
    // Initial scan will automatically join the best or default voice channel
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

    // Start dynamic channel scanner checks every 3 minutes (180,000 milliseconds)
    console.log(`[${getTimestamp()}] [SCANNER] Starting voice channel scanner (checks every 3 minutes)...`);
    setInterval(async () => {
        if (!client.isReady()) return;
        await scanAndMoveToActiveChannel();
    }, 180000);
});

console.log('Starting Discord Client (Node.js)...');
client.login(TOKEN).catch((err) => {
    console.error(`[CRITICAL ERROR] Failed to login: ${err.message}`);
});
