// Bot simplificado: Envia saudação + imagens de oferta
// Envia apenas na primeira mensagem e depois somente após 3 horas

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

// ===================== CONFIG =====================
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "ultimo_envio.json");

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
let ultimoEnvio = loadJson(); // { chatId: timestamp }

// ===================== KEEP ALIVE =====================
const app = express();
app.get("/", (req, res) => res.send("Bot ativo"));
app.listen(PORT, () => console.log("Servidor ON", PORT));

// ===================== CLIENT =====================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

// >>>>> QR CODE APENAS TEXTO <<<<<
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true }); // somente o QR, sem mensagens
});

client.on("ready", () => console.log("Bot conectado"));
client.initialize();

// ===================== FUNÇÃO SAUDAÇÃO =====================
async function enviarSaudacao(chatId) {
  try {
    await client.sendMessage(chatId, "Olá! 👋 Seja bem-vindo(a)! 🎉");
    await client.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento!");
    await client.sendMessage(chatId, "Encanto aguarda você, confira nossas ofertas abaixo 👇");
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
  await enviarImagem(chatId, "./imagens/encarte.png", "👏🏻Confira nossas ofertas! 🎉");
  await enviarImagem(chatId, "./imagens/1.png", "👏🏻Gostaria de levar um de nossos produtos? 🎉");
  await enviarImagem(chatId, "./imagens/2.png", "👏🏻Gostaria de levar um de nossos produtos? 🎉");
}

// ===================== HANDLER =====================
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const agora = Date.now();
    const limite = 3 * 60 * 60 * 1000; // 3 horas

    // Se nunca enviou ou já passaram 3 horas → envia saudação + ofertas
    if (!ultimoEnvio[chatId] || (agora - ultimoEnvio[chatId] > limite)) {
      await enviarSaudacao(chatId);
      await enviarOfertas(chatId);

      ultimoEnvio[chatId] = agora;
      saveJson(ultimoEnvio);
    }

  } catch (e) {
    console.log("Erro handler", e);
  }
});
