<div align="center">

<img src="icons/icon128.png" width="96" alt="XCORD Logo">

# XCORD

**X actions, without leaving Discord.**

[![Version](https://img.shields.io/badge/version-1.4.0-5865f2?style=flat-square)](releases/XCORD-v1.4.0.zip)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-43b581?style=flat-square)](manifest.json)
[![Chrome Extension](https://img.shields.io/badge/chrome-extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#installation)
[![No API Key](https://img.shields.io/badge/X%20API%20key-not%20required-orange?style=flat-square)](#permissions)

XCORD is a lightweight Chrome extension that adds one-click X (Twitter) actions directly next to X links inside Discord.

</div>

---

## 📸 Screenshots

<div align="center">

![XCORD action buttons inside Discord — Follow, Like, and Repost next to X links](screenshots/xcord-discord-actions.jpg)

*One-click **Follow**, **Like**, and **Repost** buttons injected directly next to X links in Discord.*

</div>

---

## ✨ Features

- **Follow** X profiles directly from Discord
- **Like** X posts with a dedicated button
- **Repost** independently from Like
- Keeps Discord focused while the action runs in a temporary background tab
- Automatically closes the temporary X tab when the action finishes
- Detects profiles and posts that are already followed, liked, or reposted
- Clean, native-looking controls designed to fit Discord's interface
- Fully English interface

## 📦 Installation

1. Download [`XCORD-v1.4.0.zip`](releases/XCORD-v1.4.0.zip) and extract it
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the extracted `XCORD-v1.4.0` folder
6. Refresh Discord
7. Make sure you are signed in to X on the same Chrome profile

## 🚀 Usage

- X **profile links** receive a **Follow @username** button
- X **post links** receive separate **Like** and **Repost** buttons
- If an action fails, hover the retry button to view the error message

## ⚙️ How It Works

XCORD opens the relevant X page in a temporary inactive tab, performs the selected action, verifies the result, and closes the tab automatically. Your Discord tab remains active the whole time.

## 🔐 Permissions

XCORD requests only the permissions needed to detect links in Discord and perform actions on X:

| Permission | Purpose |
|:---|:---|
| `tabs` | Creates and closes the temporary background X tab |
| `scripting` | Performs the requested X action in that tab |
| Discord host access | Detects X links and adds action buttons |
| X/Twitter host access | Performs Follow, Like, and Repost actions |

**XCORD does not require an X API key.**

## 📁 Project Structure

```
XCORD-v1.4.0/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — tab & action orchestration
├── content.js         # Discord link detection & button injection
├── content.css        # Native-looking Discord button styles
├── popup.html         # Extension popup UI
└── icons/             # Extension icons (16/32/48/128)
```

## 📌 Version

Current version: **1.4.0**
