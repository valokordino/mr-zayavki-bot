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
  const hasContent = Boolean(msg.text || msg.caption || msg.photo || msg.video || msg.document);

  // ============================================================
  // 1) СООБЩЕНИЯ СОТРУДНИКОВ В КАНАЛЕ УК
  // ============================================================
  if (String(chatId) === String(CHANNEL_ID)) {
    try {
      // Написали не через Reply
      if (!msg.reply_to_message && hasContent) {
        await axios.post(`${TELEGRAM_URL}/sendMessage`, {
          chat_id: CHANNEL_ID,
          reply_to_message_id: msg.message_id,
          text:
            "⚠️ Чтобы ответ был отправлен жителю, нажмите «Ответить (Reply)» " +
            "на сообщение заявки бота и напишите ответ в ответе.",
        });
        return res.sendStatus(200);
      }

      if (!msg.reply_to_message || !hasContent) return res.sendStatus(200);

      const originalText =
        msg.reply_to_message.text || msg.reply_to_message.caption || "";
      const ref = extractRef(originalText);
      if (!ref) return res.sendStatus(200);

      const residentChatId = readRef(ref);

      // Отправка ответа жителю
      if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        await axios.post(`${TELEGRAM_URL}/sendPhoto`, {
          chat_id: residentChatId,
          photo: photo.file_id,
          caption: "💬 Ответ по вашей заявке:\n\n" + (msg.caption || ""),
        });
      } else if (msg.video) {
        await axios.post(`${TELEGRAM_URL}/sendVideo`, {
          chat_id: residentChatId,
          video: msg.video.file_id,
          caption: "💬 Ответ по вашей заявке:\n\n" + (msg.caption || ""),
        });
      } else if (msg.document) {
        await axios.post(`${TELEGRAM_URL}/sendDocument`, {
          chat_id: residentChatId,
          document: msg.document.file_id,
          caption: "💬 Ответ по вашей заявке:\n\n" + (msg.caption || ""),
        });
      } else {
        await axios.post(`${TELEGRAM_URL}/sendMessage`, {
          chat_id: residentChatId,
          text: `💬 Ответ по вашей заявке:\n\n${msg.text || msg.caption || ""}`,
        });
      }

      // ===== Реакция 👌 на исходную заявку =====
      await axios.post(`${TELEGRAM_URL}/setMessageReaction`, {
        chat_id: CHANNEL_ID,
        message_id: msg.reply_to_message.message_id,
        reaction: [{ type: "emoji", emoji: "👌" }],
        is_big: false,
      });

      return res.sendStatus(200);
    } catch (e) {
      console.error("Telegram error (reply):", e.response?.data || e.message);
      return res.sendStatus(200);
    }
  }

      
  // ============================================================
  // 2) СООБЩЕНИЯ ЖИТЕЛЕЙ
  // ============================================================
  if (text === "/start") {
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text:
        "Здравствуйте! 👋\n\n" +
        "Напишите заявку одним сообщением (можно с фото/видео/файлом).\n" +
        "Я передам её в управляющую компанию, ответ придёт сюда же.",
    });
    return res.sendStatus(200);
  }

  // Заявка
try {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text: "Ваша заявка принята!",
  });

  const ref = makeRef(chatId);
  const userText = msg.text || msg.caption || "";

  const header =
    `🛠 <b>Новая заявка</b>\n\n` +
    `От: ${msg.from?.first_name || "Житель"}\n\n`;
  const footer = `\n\n<i>ref: ${ref}</i>`;

  let sent; // сюда сохраним результат отправки в канал

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];

    sent = await axios.post(`${TELEGRAM_URL}/sendPhoto`, {
      chat_id: CHANNEL_ID,
      parse_mode: "HTML",
      photo: photo.file_id,
      caption: header + (userText || "(без текста)") + footer,
    });
  } else {
    sent = await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      parse_mode: "HTML",
      text: header + (userText || "(без текста)") + footer,
    });
  }

  // ⚡ реакция на только что созданную заявку (сообщение бота в канале)
  await axios.post(`${TELEGRAM_URL}/setMessageReaction`, {
    chat_id: CHANNEL_ID,
    message_id: sent.data.result.message_id,
    reaction: [{ type: "emoji", emoji: "⚡" }],
    is_big: false,
  });

} catch (e) {
  console.error("Telegram error (ticket):", e.response?.data || e.message);
}

return res.sendStatus(200);
});


// ==== HEALTHCHECK ====
app.get("/", (_, res) => res.send("Bot server is running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
