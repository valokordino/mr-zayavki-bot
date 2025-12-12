const crypto = require("crypto");
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==== НАСТРОЙКИ ====
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;
const REF_SECRET = process.env.REF_SECRET;

// Защита от “тихих” поломок
if (!TOKEN) console.error("❌ BOT_TOKEN is not set");
if (!CHANNEL_ID) console.error("❌ CHANNEL_ID is not set");
if (!REF_SECRET) console.error("❌ REF_SECRET is not set");

// ==== ВСПОМОГАТЕЛЬНАЯ ЛОГИКА - ШИФРОВАНИЕ ====
function makeRef(chatId) {
  const key = crypto.createHash("sha256").update(String(REF_SECRET)).digest(); // 32 bytes
  const iv = crypto.randomBytes(12); // AES-GCM iv 12 bytes
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(String(chatId), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function readRef(ref) {
  const key = crypto.createHash("sha256").update(String(REF_SECRET)).digest();
  const buf = Buffer.from(ref, "base64url");

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return Number(dec.toString("utf8"));
}

function extractRef(text) {
  const m = String(text || "").match(/ref:\s*([A-Za-z0-9_\-]+)/);
  return m ? m[1] : null;
}

// ==== ХЭНДЛЕР ВЕБХУКА ====
app.post("/webhook", async (req, res) => {
  const update = req.body;

  // ЛОГ для диагностики: увидишь, что реально приходит (message / channel_post и т.д.)
  console.log("UPDATE:", JSON.stringify(update, null, 2));

  // Берём сообщение либо из лички/группы, либо из канала
  const msg = update.message || update.channel_post;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat?.id;
  const text = msg.text || "";

  // 1) ОБРАБОТКА ОТВЕТОВ СОТРУДНИКОВ В КАНАЛЕ (reply)
  // ВАЖНО: ответ должен быть именно reply на сообщение заявки бота
  if (String(chatId) === String(CHANNEL_ID)) {
    try {
      if (!msg.reply_to_message || !msg.text) return res.sendStatus(200);

      const originalText = msg.reply_to_message.text || "";
      const ref = extractRef(originalText);

      if (!ref) {
        await axios.post(`${TELEGRAM_URL}/sendMessage`, {
          chat_id: CHANNEL_ID,
          reply_to_message_id: msg.message_id,
          text: "⚠️ Не нашла ref в заявке. Ответ не отправлен. Ответьте именно на сообщение заявки бота (Reply).",
        });
        return res.sendStatus(200);
      }

      let residentChatId;
      try {
        residentChatId = readRef(ref);
      } catch (e) {
        await axios.post(`${TELEGRAM_URL}/sendMessage`, {
          chat_id: CHANNEL_ID,
          reply_to_message_id: msg.message_id,
          text: "⚠️ ref не читается (возможно, повреждён). Ответ не отправлен.",
        });
        return res.sendStatus(200);
      }

      await axios.post(`${TELEGRAM_URL}/sendMessage`, {
        chat_id: residentChatId,
        text: `💬 Ответ по вашей заявке:\n\n${msg.text}`,
      });

      return res.sendStatus(200);
    } catch (e) {
      console.error("Telegram error (reply handling):", e.response?.data || e.message);
      return res.sendStatus(200);
    }
  }

  // 2) ОБРАБОТКА СООБЩЕНИЙ ОТ ЖИТЕЛЕЙ (личка)
  // Если человек отправил /start — приветствие и
