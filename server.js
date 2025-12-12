const crypto = require("crypto");
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==== НАСТРОЙКИ ====
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const REF_SECRET = process.env.REF_SECRET;
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) console.error("❌ BOT_TOKEN is not set");
if (!CHANNEL_ID) console.error("❌ CHANNEL_ID is not set");
if (!REF_SECRET) console.error("❌ REF_SECRET is not set");

// ==== ШИФРОВАНИЕ ref ====
function makeRef(chatId) {
  const key = crypto.createHash("sha256").update(String(REF_SECRET)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const enc = B
