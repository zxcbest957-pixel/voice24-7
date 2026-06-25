# Discord Voice 24/7 Idler (Selfbot)

A lightweight Python script that keeps your personal Discord account connected to a specific voice channel 24/7. It includes auto-reconnect on kick/disconnect, keep-alive heartbeat checks, and an optional Flask web server for 24/7 cloud hosting.

---

> [!WARNING]
> **Discord Terms of Service Violation**
> Automating user accounts (selfbots) violates Discord's Terms of Service. This script is designed for educational purposes and personal idler setup. To minimize risk:
> 1. Do not use commands on this account.
> 2. Keep the connection static in a single channel.
> 3. Never share your Discord account token with anyone.

---

## 🛠️ Configuration & Setup

### 1. Extract your Discord User Token
To log in as your user account, you need your personal account token:
1. Open Discord in your Web Browser (Chrome, Firefox, etc.) and log in.
2. Press `Ctrl + Shift + I` (or `F12`) to open the browser Developer Tools.
3. Select the **Console** tab.
4. Copy and paste the following snippet, then press **Enter**:
   ```javascript
   (window.webpackChunkdiscord_app ? window.webpackChunkdiscord_app.push([[Symbol()], {}, (x) => {for (const y in x.c) {if (x.c[y].exports && x.c[y].exports.default && x.c[y].exports.default.getToken !== undefined) {return console.log("%cToken: %c" + x.c[y].exports.default.getToken(), "color: green; font-size: 14px; font-weight: bold;", "color: red; font-size: 14px;");}}}]): console.log("Ensure you are logged in to Discord in the browser."));
   ```
5. Copy the printed token (red text). Save it somewhere secure.
   *Alternative Method*: Go to the **Network** tab in Developer Tools, click on any request to the Discord API (e.g., search or load channel history), scroll down to **Request Headers**, and find the **`Authorization`** header. That value is your token.

### 2. Copy the Target Voice Channel ID
1. Open Discord Settings -> **Advanced** -> Turn on **Developer Mode**.
2. Go to the server and right-click on the voice channel you want to stay in.
3. Click **Copy Channel ID**.

### 3. Edit `.env` file
Open the `.env` file in this directory and update the settings:
```ini
DISCORD_TOKEN=your_token_here
CHANNEL_ID=your_voice_channel_id_here
SELF_MUTE=True
SELF_DEAF=True
KEEP_ALIVE=True
PORT=8080
```

---

## 🚀 How to Run

### Option A: Local Run (Windows)
Double-click on [run.bat](file:///c:/Users/aktuv/Downloads/scirpt/discord_voice_247/run.bat).
This script will automatically:
1. Ensure Python is installed.
2. Initialize a local virtual environment (`.venv`).
3. Install and update dependencies (`discord.py-self`, `PyNaCl`, `python-dotenv`, `Flask`).
4. Run `bot.py`.

### Option B: 24/7 Hosting on a Free Server (e.g., Render, Koyeb)
To keep the bot online 24/7 without keeping your computer on, you can host it on a free hosting platform:
1. Create a private GitHub repository and upload your files (exclude `.venv` and `.env`).
2. Register a free account on **Render** (render.com) or **Koyeb** (koyeb.com).
3. Create a new **Web Service** and link your Github repository.
4. Set the following configurations in your Web Service:
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python bot.py`
5. Add your Environment Variables in the service settings dashboard:
   - `DISCORD_TOKEN` = `your_token_here`
   - `CHANNEL_ID` = `your_voice_channel_id_here`
   - `SELF_MUTE` = `True`
   - `SELF_DEAF` = `True`
   - `KEEP_ALIVE` = `True`
   - `PORT` = `8080`
6. Once deployed, copy your web app URL (e.g., `https://my-voice-idler.onrender.com`).
7. Go to **UptimeRobot** (uptimerobot.com) and create a free account.
8. Add a new Monitor:
   - **Monitor Type**: `HTTPS`
   - **Friendly Name**: `Discord Voice Idler`
   - **URL/IP**: `https://my-voice-idler.onrender.com` (your web service URL)
   - **Monitoring Interval**: Every 5 minutes
9. UptimeRobot will ping your web service every 5 minutes. The script's built-in web server will answer with status `200 OK`, preventing the hosting platform from turning off your bot!
