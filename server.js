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

  const enc = Buffer.concat([cipher.update(String(chatId), "utf8"), cipher.final()]);
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
  const m = String(text || "").match(/ref:\s*([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// ==== ВЕБХУК ====
app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("UPDATE:", JSON.stringify(update, null, 2));

  const msg = update.message || update.channel_post;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat?.id;
  const text = msg.text || "";

  // 1) Ответы сотрудников в канале (reply)
  if (String(chatId) === String(CHANNEL_ID)) {
    try {
      if (!msg.reply_to_message || !msg.text) return res.sendStatus(200);

      const originalText = msg.reply_to_message.text || "";
      const ref = extractRef(originalText);

      if (!ref) {
        await axios.post(`${TELEGRAM_URL}/sendMessage`, {
          chat_id: CHANNEL_ID,
          reply_to_message_id: msg.message_id,
          text: "⚠️ Не нашла ref в заявке. Ответьте именно на сообщение заявки бота (Reply).",
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
          text: "⚠️ ref не читается. Ответ не отправлен.",
        });
        return res.sendStatus(200);
      }

      await axios.post(`${TELEGRAM_URL}/sendMessage`, {
        chat_id: residentChatId,
        text: `💬 Ответ по вашей заявке:\n\n${msg.text}`,
      });

      return res.sendStatus(200);
    } catch (e) {
      console.error("Telegram error (reply):", e.response?.data || e.message);
      return res.sendStatus(200);
    }
  }

  // 2) Сообщения жителей
  if (text === "/start") {
    try {
      await axios.post(`${TELEGRAM_URL}/sendMessage`, {
        chat_id: chatId,
        text:
          "Здравствуйте! 👋\n\n" +
          "Я бот вашего дома.\n\n" +
          "Напишите заявку одним сообщением. Я передам её в УК.\n\n" +
          "Ответ придёт сюда же.\n\n" +
          "Пожалуйста, не указывайте телефон и личные контакты — бот передаёт сообщения анонимно.",
      });
    } catch (e) {
      console.error("Telegram error (start):", e.response?.data || e.message);
    }
    return res.sendStatus(200);
  }

  // Любой другой текст = заявка
  try {
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: "Ваша заявка принята! Сотрудник увидит её в ближайшее время.",
    });

    const ref = makeRef(chatId);

    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text:
        `🛠 Новая заявка\n\n` +
        `От: ${msg.from?.first_name || "Житель"}\n\n` +
        text +
        `\n\nref: ${ref}`,
    });
  } catch (e) {
    console.error("Telegram error (ticket):", e.response?.data || e.message);
  }

  return res.sendStatus(200);
});

// ==== HEALTHCHECK ====
app.get("/", (req, res) => {
  res.send("Bot server is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
