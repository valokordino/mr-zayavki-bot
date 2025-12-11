const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==== НАСТРОЙКИ ====
const TOKEN = process.env.BOT_TOKEN;       // токен бота
const CHANNEL_ID = process.env.CHANNEL_ID; // chat_id канала УК
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;

// ==== ХЭНДЛЕР ВЕБХУКА ====
app.post("/webhook", async (req, res) => {
  const update = req.body;

  if (!update.message || !update.message.text) {
    return res.sendStatus(200);
  }

  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text;


  if (text === '/start') {
    return bot.sendMessage(
        chatId,
        "Здравствуйте! 👋\n\n" +
        "Я бот приёмной службы вашего дома.\n\n" +
        "Пожалуйста, напишите текст вашей заявки в свободной форме. Например:\n" +
        "• \"Не горит свет на лестничной площадке, подъезд 3, этаж 4\"\n" +
        "• \"Сломалась входная дверь со стороны двора, подъезд 1\"\n\n" +
        "Я передам сообщение в техническую службу."
    );
}

  try {
    // Ответ пользователю
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: "Ваша заявка принята! Сотрудник увидит её в ближайшее время.",
    });

    // Отправка заявки в канал УК
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text:
        `🛠 Новая заявка\n\n` +
        `От: ${msg.from.first_name || ""} (@${msg.from.username || "нет"})\n\n` +
        text,
    });
  } catch (e) {
    console.error("Telegram error:", e.response?.data || e.message);
  }

  res.sendStatus(200);
});

// ==== СТАРТ СЕРВЕРА ====
app.get("/", (req, res) => {
  res.send("Bot server is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
