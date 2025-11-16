import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import express from "express";
import fs from "fs";
import path from "path";
import { salvarEndereco, buscarEndereco } from "./supabase.js";

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------
// Servidor HTTP para Railway
// ----------------------------
app.get("/", (req, res) => res.send("🚀 Bot do WhatsApp está rodando!"));
app.listen(port, () => console.log(`🌐 Servidor ativo na porta ${port}`));

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

client.on("qr", (qr) => console.log("🟢 ESCANEIE ESTE QR CODE:\n", qr));
client.on("ready", () => console.log("✅ Bot conectado ao WhatsApp!"));
client.initialize();

// ----------------------------
// Funções auxiliares
// ----------------------------
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function enviarImagem(numero, caminho, legenda) {
  const media = MessageMedia.fromFilePath(caminho);
  await client.sendMessage(numero, media, { caption: legenda });
}

async function enviarVariasImagens(numero, imagens) {
  for (const item of imagens) {
    await enviarImagem(numero, item.caminho, item.legenda);
    await delay(3000);
  }
}

// ----------------------------
// Persistência simples local (JSON)
// ----------------------------
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, "atendimentos.json");
const SAU_FILE = path.join(DATA_DIR, "saudacoes.json");

function loadJson(file, fallback = {}) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file)); } catch (e) { console.error("Erro lendo", file, e); }
  return fallback;
}
function saveJson(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch (e) { console.error("Erro gravando", file, e); } }

let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});

// ----------------------------
// Funções de atendimento
// ----------------------------
function ensureAtendimento(chatId) {
  if (!atendimentos[chatId]) {
    atendimentos[chatId] = { respondido: false, lastMessage: "", firstContactAt: Date.now() };
    saveJson(ATEND_FILE, atendimentos);
  }
}
function marcarPendente(chatId, lastMsg) {
  ensureAtendimento(chatId);
  atendimentos[chatId].respondido = false;
  atendimentos[chatId].lastMessage = lastMsg ? String(lastMsg).slice(0, 200) : "";
  saveJson(ATEND_FILE, atendimentos);
}
function marcarAtendido(chatId) { ensureAtendimento(chatId); atendimentos[chatId].respondido = true; saveJson(ATEND_FILE, atendimentos); }

async function enviarListaPendentes() {
  const pend = Object.keys(atendimentos).filter((c) => !atendimentos[c].respondido);
  if (pend.length === 0) {
    await client.sendMessage("5588921552690@c.us", "✅ Nenhum cliente pendente no momento.");
    return;
  }
  let texto = "📋 *LISTA DE CLIENTES PENDENTES:*\n\n";
  pend.forEach((c) => { texto += `• ${c.replace("@c.us", "")} — *PENDENTE*\n`; });
  await client.sendMessage("5588921552690@c.us", texto);
}

// ----------------------------
// Variáveis globais
// ----------------------------
let estadoCliente = {};
let ultimoClienteAtivo = null;

// ----------------------------
// Fluxo principal de mensagens
// ----------------------------
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();
    ultimoClienteAtivo = chatId;

    // Mensagens do próprio bot
    if (msg.fromMe) return;

    // Marcar cliente como pendente
    marcarPendente(chatId, msg.body);
    await enviarListaPendentes();

    // ----------------------------
    // Saudação a cada 3h
    // ----------------------------
    const agora = Date.now();
    const saudacaoData = saudacoes[chatId] || 0;
    const tresHoras = 3 * 60 * 60 * 1000;

    if ((texto.includes("oi") || texto.includes("ola") || texto.includes("olá") ||
        texto.includes("bom dia") || texto.includes("boa tarde") || texto.includes("boa noite")) &&
        agora - saudacaoData > tresHoras) {

      saudacoes[chatId] = agora; saveJson(SAU_FILE, saudacoes);

      await delay(2000); await chat.sendStateTyping();
      await client.sendMessage(chatId, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");
      await delay(2500); await chat.sendStateTyping();
      await client.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");
      await delay(2500); await chat.sendStateTyping();
      await client.sendMessage(chatId, "Enquanto isso, confira nossas ofertas 👇🏻");

      await enviarVariasImagens(chatId, [
        { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
        { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
        { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
      ]);

      // Novo bloco
      await client.sendMessage(chatId, "ℹ️ Como podemos lhe ajudar ?");
      await delay(1500);
      await client.sendMessage(chatId,
        "📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n" +
        "▶️ Para adicionar itens use: Adicionar➕\n" +
        "▶️ Para encerrar use: Encerrar❌"
      );
    }

    // ----------------------------
    // ADICIONAR / ENCERRAR
    // ----------------------------
    if (texto.includes("mais") || texto.includes("adicionar") || texto.includes("adiciona") ||
        texto.includes("coloca") || texto.includes("acrescenta")) {
      await client.sendMessage(chatId, "Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?");
      estadoCliente[chatId] = "aguardando_decisao_item";
      return;
    }

    if (estadoCliente[chatId] === "aguardando_decisao_item") {
      if (texto.includes("encerrar") || texto.includes("pode encerrar") || texto.includes("só") || texto.includes("somente")) {
        estadoCliente[chatId] = null; // seguir fluxo encerrar
      } else {
        estadoCliente[chatId] = "aguardando_item";
        await client.sendMessage(chatId, "Perfeito! 😄 Pode me enviar o que deseja adicionar.");
        return;
      }
    }

    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(chatId, `Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?`);
      estadoCliente[chatId] = "aguardando_decisao_item";
      return;
    }

    // ----------------------------
    // Encerrar → pergunta entrega ou retirada
    // ----------------------------
    if (texto.includes("encerrar") || texto.includes("pode encerrar") || texto.includes("só") || texto.includes("somente")) {
      const enderecoSalvo = await buscarEndereco(chatId)
      if (enderecoSalvo) {
        await client.sendMessage(chatId, `🚚 Entrega confirmada! O endereço salvo é:\n${enderecoSalvo}\nDeseja alterar ou manter?`);
        estadoCliente[chatId] = "confirmar_endereco";
      } else {
        await client.sendMessage(chatId, "Certo! 😊 Será *retirada na loja* ou *entrega*?");
        estadoCliente[chatId] = "aguardando_endereco";
      }
      return;
    }

    // ----------------------------
    // Alterar ou manter endereço
    // ----------------------------
    if (estadoCliente[chatId] === "confirmar_endereco") {
      if (texto.includes("alterar")) {
        await client.sendMessage(chatId, "Ok! Por favor, envie o novo endereço de entrega.");
        estadoCliente[chatId] = "aguardando_endereco";
        return;
      }
      if (texto.includes("manter")) {
        await client.sendMessage(chatId, "Perfeito! Mantendo o endereço salvo. ✅");
        estadoCliente[chatId] = null;
        return;
      }
      await client.sendMessage(chatId, "Por favor, responda apenas: *alterar* ou *manter*.");
      return;
    }

    // ----------------------------
    // Receber endereço
    // ----------------------------
    if (estadoCliente[chatId] === "aguardando_endereco") {
      await salvarEndereco(chatId, msg.body);
      await client.sendMessage(chatId, `Endereço registrado com sucesso:\n${msg.body}`);
      estadoCliente[chatId] = null;
      return;
    }

    // ----------------------------
    // Fluxo orçamento, pagamento, retirada, Pix, dinheiro, cartão
    // ----------------------------
    // Aqui você pode adicionar os blocos de orçamento e pagamentos
    // Seguindo exatamente a sequência que já definimos antes (Tudo certo / Errado, Pix, dinheiro com troco, cartão à vista ou parcelado)

  } catch (err) {
    console.error("Erro no handler de mensagem:", err);
  }
});