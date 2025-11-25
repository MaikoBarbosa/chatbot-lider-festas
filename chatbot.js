// Bot simplificado: Envia saudação + imagens de oferta
// Envia apenas na primeira mensagem e depois somente após 3 horas

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

// ===================== CONFIG =====================
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "ultimo_envio.json");

// Delay de X segundos
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Carregar registros de horário
function loadJson() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {}
  return {};
}

function saveJson(obj) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

let ultimoEnvio = loadJson();  // { chatId: timestamp OR "enviando" }

// ===================== KEEP ALIVE =====================
const app = express();
app.get("/", (req, res) => res.send("Bot ativo"));
app.listen(PORT, () => console.log("Servidor ON", PORT));

// ===================== CLIENT =====================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

// QR CODE
client.on("qr", (qr) => {
  console.log("===========================================");
  console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
  console.log(qr);
  console.log("===========================================");
});

client.on("ready", () => console.log("✅ Bot conectado ao WhatsApp!"));
client.initialize();

// ===================== Helpers =====================

// Gera data local de Fortaleza (UTC-3)
function getFortalezaNow() {
  const now = new Date();
  const targetOffsetHours = -3;
  const localOffsetHours = -now.getTimezoneOffset() / 60;
  const deltaHours = targetOffsetHours - localOffsetHours;
  return new Date(now.getTime() + deltaHours * 3600 * 1000);
}

function getHorarioInfo() {
  const local = getFortalezaNow();
  const weekday = local.getDay();
  const h = local.getHours();
  const m = local.getMinutes();
  const minutos = h * 60 + m;

  const toMin = (hh, mm) => hh * 60 + mm;

  let openStart = null, openEnd = null;

  // Seg–Sex
  if (weekday >= 1 && weekday <= 5) {
    openStart = toMin(7, 30);
    openEnd = toMin(17, 30);
  }
  // Sábado
  else if (weekday === 6) {
    openStart = toMin(7, 30);
    openEnd = toMin(13, 0);
  }
  // Domingo fechado
  else {
    return {
      open: false,
      dateKey: local.toISOString().slice(0,10),
      periodKey: `closed:${local.toISOString().slice(0,10)}`
    };
  }

  const open = minutos >= openStart && minutos < openEnd;
  const dateKey = local.toISOString().slice(0,10);
  const periodKey = open ? `open:${dateKey}` : `closed:${dateKey}`;

  return { open, dateKey, periodKey, local };
}

const MSG_FORA_HORARIO = `Olá! 👋 Tudo bem?  
⚠️ *No momento não estamos disponíveis.*

🕒 *Horário de atendimento:*  
Seg–Sex: 7:30 às 17:30  
Sábado: 7:30 às 13:00  
Domingo: Fechado`;

// ===================== FUNÇÃO SAUDAÇÃO =====================
async function enviarSaudacao(chatId) {
  try {
    await client.sendMessage(chatId, "Olá! 👋 Seja bem-vindo(a)! 🎉");
    await delay(5000);

    await client.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento!");
    await delay(5000);

    await client.sendMessage(chatId, "Enquanto aguarda, confira nossas ofertas 👇");
    await delay(5000);

  } catch (e) {
    console.log("Erro saudação", e);
  }
}

// ===================== ENVIAR IMAGENS =====================
async function enviarImagem(numero, caminho, legenda) {
  try {
    const media = MessageMedia.fromFilePath(caminho);
    await client.sendMessage(numero, media, { caption: legenda });
  } catch (e) {
    console.log("Erro imagem", e);
  }
}

async function enviarOfertas(chatId) {
  await enviarImagem(chatId, "./imagens/black.jpeg", "👏🏻 Black Friday 🎉");
  await delay(5000);

  await enviarImagem(chatId, "./imagens/1.png", "👏🏻 Gostaria de levar um de nossos produtos? 🎉");
  await delay(5000);

  await enviarImagem(chatId, "./imagens/2.png", "👏🏻 Gostaria de levar um de nossos produtos? 🎉");
}

// ===================== HANDLER =====================
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const agora = Date.now();
    const limite = 3 * 60 * 60 * 1000; // 3 horas

    // Verifica horário
    const horario = getHorarioInfo();

    // ===================== ⚠️ FORA DO HORÁRIO =====================
    if (!horario.open) {
      await client.sendMessage(chatId, MSG_FORA_HORARIO);
      return; // <-- IMPORTANTE: não envia imagens, não envia saudação
    }

    // ========== 🔒 TRAVA ANTI-DUPLICAÇÃO ==========
    if (ultimoEnvio[chatId] === "enviando") {
      console.log("⛔ Ignorado (já está enviando para este chat)");
      return;
    }

    // Se não enviou ainda ou passou 3 horas
    if (!ultimoEnvio[chatId] || (agora - ultimoEnvio[chatId] > limite)) {

      ultimoEnvio[chatId] = "enviando";
      saveJson(ultimoEnvio);

      // Dentro do horário → enviar saudação + ofertas
      await enviarSaudacao(chatId);
      await enviarOfertas(chatId);

      ultimoEnvio[chatId] = agora;
      saveJson(ultimoEnvio);
    }

  } catch (e) {
    console.log("Erro handler", e);
  }
});
