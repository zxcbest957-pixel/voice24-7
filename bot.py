import os
import sys
import time
import asyncio
import threading
from datetime import datetime
import discord
from discord.ext import tasks, commands
from dotenv import load_dotenv
from flask import Flask
# Force UTF-8 encoding for stdout/stderr to prevent character encoding issues on Windows
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import static_ffmpeg
try:
    static_ffmpeg.add_paths()
except Exception as static_ffmpeg_err:
    print(f"[WARNING] Failed to load static-ffmpeg: {static_ffmpeg_err}")

# Load configurations
load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
CHANNEL_ID_STR = os.getenv("CHANNEL_ID")
SELF_MUTE_STR = os.getenv("SELF_MUTE", "False")
SELF_DEAF_STR = os.getenv("SELF_DEAF", "False")
KEEP_ALIVE_STR = os.getenv("KEEP_ALIVE", "True")
PORT_STR = os.getenv("PORT", "8080")

# Input validations
if not TOKEN or TOKEN.strip() == "":
    print("[ERROR] DISCORD_TOKEN is missing in the .env file.")
    sys.exit(1)

if not CHANNEL_ID_STR or not CHANNEL_ID_STR.strip().isdigit():
    print("[ERROR] CHANNEL_ID must be a valid numeric channel ID in the .env file.")
    sys.exit(1)

CHANNEL_ID = int(CHANNEL_ID_STR)
SELF_MUTE = SELF_MUTE_STR.lower() == "true"
SELF_DEAF = SELF_DEAF_STR.lower() == "true"
KEEP_ALIVE = KEEP_ALIVE_STR.lower() == "true"

try:
    PORT = int(PORT_STR)
except ValueError:
    PORT = 8080

# Configure Flask app for 24/7 web server keep-alive
app = Flask(__name__)
bot_status = "Initializing..."

@app.route("/")
def home():
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return {
        "status": "online",
        "bot_status": bot_status,
        "timestamp": now,
        "message": "Discord Voice 24/7 Idler is running successfully!"
    }, 200

def run_web_server():
    # Disable flask output logging to keep terminal output clean
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    print(f"[HTTP] Starting keep-alive web server on port {PORT}...")
    try:
        app.run(host="0.0.0.0", port=PORT)
    except Exception as e:
        print(f"[HTTP Error] Failed to start web server: {e}")

# Using commands.Bot with self_bot=True to support user accounts
bot = commands.Bot(command_prefix="vc_idler!", self_bot=True)
reconnect_lock = asyncio.Lock()

def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

async def safe_join_voice():
    """Safely handles connecting or reconnecting to the target voice channel."""
    global bot_status
    async with reconnect_lock:
        channel = bot.get_channel(CHANNEL_ID)
        if not channel:
            try:
                channel = await bot.fetch_channel(CHANNEL_ID)
            except Exception as e:
                print(f"[{get_timestamp()}] [ERROR] Could not fetch voice channel {CHANNEL_ID}: {e}")
                bot_status = f"Error: Could not find channel {CHANNEL_ID}"
                return

        if not isinstance(channel, discord.VoiceChannel):
            print(f"[{get_timestamp()}] [ERROR] Channel {CHANNEL_ID} is not a Voice Channel.")
            bot_status = "Error: Configured channel is not a voice channel"
            return

        # Check if already connected
        voice_client = discord.utils.get(bot.voice_clients, guild=channel.guild)
        
        if voice_client:
            if voice_client.channel.id == CHANNEL_ID:
                # Already in the correct channel
                # Ensure correct mute/deafen states
                if voice_client.is_connected():
                    bot_status = f"Connected to voice channel: {channel.name} ({channel.guild.name})"
                    return
            else:
                # Connected to a different channel, disconnect first
                print(f"[{get_timestamp()}] [INFO] Disconnecting from current voice channel {voice_client.channel.name} to join target channel...")
                try:
                    await voice_client.disconnect(force=True)
                except Exception as e:
                    print(f"[{get_timestamp()}] [WARNING] Error disconnecting: {e}")

        print(f"[{get_timestamp()}] [INFO] Attempting to connect to channel '{channel.name}' in guild '{channel.guild.name}'...")
        bot_status = f"Connecting to {channel.name}..."
        
        try:
            # Connect to voice channel
            vc = await channel.connect(self_mute=SELF_MUTE, self_deaf=SELF_DEAF)
            print(f"[{get_timestamp()}] [SUCCESS] Successfully joined voice channel: '{channel.name}'")
            print(f"[{get_timestamp()}] [INFO] Settings: self_mute={SELF_MUTE}, self_deaf={SELF_DEAF}")
            bot_status = f"Connected to voice channel: {channel.name} ({channel.guild.name})"

            # Play speech.mp3 after 10 seconds if it exists
            if os.path.exists("speech.mp3"):
                print(f"[{get_timestamp()}] [SPEECH] Scheduled speech.mp3 to play in 10 seconds...")
                async def play_speech_delayed():
                    await asyncio.sleep(10)
                    if vc.is_connected():
                        print(f"[{get_timestamp()}] [SPEECH] Playing speech.mp3 now.")
                        try:
                            vc.play(discord.FFmpegPCMAudio("speech.mp3"))
                        except Exception as e:
                            print(f"[{get_timestamp()}] [SPEECH ERROR] Failed to play speech.mp3: {e}")
                bot.loop.create_task(play_speech_delayed())
        except Exception as e:
            print(f"[{get_timestamp()}] [ERROR] Failed to connect to voice channel: {e}")
            bot_status = f"Failed to connect: {e}"

@bot.event
async def on_ready():
    global bot_status
    print("=" * 60)
    print(f"Logged in as USER: {bot.user.name} (ID: {bot.user.id})")
    print(f"Target Voice Channel ID: {CHANNEL_ID}")
    print("=" * 60)
    
    bot_status = "Logged in, connecting to voice..."
    await safe_join_voice()
    
    # Start the keepalive task if not already running
    if not keepalive_checker.is_running():
        keepalive_checker.start()

@tasks.loop(seconds=30)
async def keepalive_checker():
    """Background loop that executes every 30 seconds to ensure the bot stays in the target channel."""
    # Ensure client is fully connected and ready
    if not bot.is_ready():
        return
        
    guild = None
    channel = bot.get_channel(CHANNEL_ID)
    if channel:
        guild = channel.guild
    else:
        # Retry fetching channel
        await safe_join_voice()
        return

    voice_client = discord.utils.get(bot.voice_clients, guild=guild)
    
    # If not connected at all, or connected to wrong channel, run join logic
    if not voice_client or voice_client.channel.id != CHANNEL_ID:
        print(f"[{get_timestamp()}] [KEEPALIVE] Detected disconnection or wrong channel. Reconnecting to target voice channel...")
        await safe_join_voice()

@keepalive_checker.before_loop
async def before_keepalive_checker():
    await bot.wait_until_ready()

if __name__ == "__main__":
    # Start web server if enabled
    if KEEP_ALIVE:
        web_thread = threading.Thread(target=run_web_server, daemon=True)
        web_thread.start()
    else:
        print("[HTTP] Keep-alive web server is disabled via config.")

    # Start Discord client
    print("Starting Discord Client...")
    try:
        bot.run(TOKEN)
    except discord.errors.LoginFailure:
        print("[ERROR] Login failed. The DISCORD_TOKEN provided in .env is invalid.")
    except KeyboardInterrupt:
        print("\nShutting down bot...")
    except Exception as e:
        print(f"[CRITICAL ERROR] Bot process crashed: {e}")
