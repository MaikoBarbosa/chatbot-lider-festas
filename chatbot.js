// chatbot.js (versão final completa + pendentes corrigidos)
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

// 👉 NUMERO FIXO DO VENDEDOR
const VENDEDOR_CHAT = "558897019483@c.us";

const app = express();
const port = process.env.PORT || 3000;

// --------------------------------
// Servidor Railway
// --------------------------------
app.get("/", (req, res) => {
  res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});
app.listen(port, () =>
  console.log(`🌐 Servidor ativo no Railway, porta ${port}`)
);

// --------------------------------
// Inicialização WhatsApp
// --------------------------------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

client.on("qr", (qr) => {
  console.log("===========================================");
  console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
  console.log(qr);
  console.log("===========================================");
});
client.on("ready", () =>
  console.log("✅ Bot conectado ao WhatsApp com sucesso!")
);
client.initialize();

// --------------------------------
// Utilitários
// --------------------------------
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, "atendimentos.json");
const SAU_FILE = path.join(DATA_DIR, "saudacoes.json");
const END_FILE = path.join(DATA_DIR, "enderecos.json");

function loadJson(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  } catch (e) {
    console.error("Erro lendo", file, e);
  }
  return fallback;
}
function saveJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("Erro gravando", file, e);
  }
}

// --------------------------------
// Estado persistente
// --------------------------------
let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});
let enderecos = loadJson(END_FILE, {});
let estadoCliente = {};

let notifHistory = {};  // histórico diário
let atendidosHoje = {}; // atendidos pelo vendedor

// --------------------------------
// Extrair número
// --------------------------------
function extrairNumero(chatId) {
  return String(chatId).replace(/[^0-9]/g, "");
}

// --------------------------------
// MARCAR PENDENTE — Nova versão (1x por cliente/dia)
// --------------------------------
async function marcarPendente(chatId, mensagem, msgObj) {
  const short = mensagem ? String(mensagem).slice(0, 200) : "";
  const numero = extrairNumero(chatId);

  const hoje = new Date().toISOString().slice(0, 10);
  notifHistory[hoje] = notifHistory[hoje] || {};

  let nomeWhatsApp = numero;
  try {
    const contato = await msgObj.getContact();
    nomeWhatsApp = contato.pushname || contato.name || numero;
  } catch (e) {
    nomeWhatsApp = numero;
  }

  if (!atendimentos[chatId]) {
    atendimentos[chatId] = {
      nome: nomeWhatsApp,
      ultimaMsg: short,
      pendente: true
    };
  } else {
    atendimentos[chatId].ultimaMsg = short;
    atendimentos[chatId].pendente = true;
  }
  saveJson(ATEND_FILE, atendimentos);

  if (notifHistory[hoje][chatId]) return false;

  notifHistory[hoje][chatId] = true;
  return true;
}

// --------------------------------
// Marcar como atendido
// --------------------------------
function marcarAtendido(chatId) {
  if (atendimentos[chatId]) {
    atendimentos[chatId].pendente = false;
    saveJson(ATEND_FILE, atendimentos);
    return true;
  }
  return false;
}

// --------------------------------
// Enviar pendentes resumidos
// --------------------------------
async function enviarResumoPendentes() {
  const pendentes = Object.values(atendimentos).filter((c) => c.pendente);

  if (pendentes.length === 0) {
    await client.sendMessage(VENDEDOR_CHAT, "✅ Nenhum cliente pendente.");
    return;
  }

  let msg = "📋 *CLIENTES PENDENTES:*\n\n";
  pendentes.forEach((c) => {
    msg += `• *${c.nome}*\n  ${c.ultimaMsg}\n\n`;
  });

  await client.sendMessage(VENDEDOR_CHAT, msg);
}

// --------------------------------
// Notificações de novos pendentes
// --------------------------------
async function enviarNotificacoesNovosPendentes() {
  const hoje = new Date().toISOString().slice(0, 10);

  for (const [chatId, info] of Object.entries(atendimentos)) {
    if (!info.pendente) continue;
    if (!notifHistory[hoje][chatId]) continue;

    const texto = `🚨 *PENDENTE*\n👤 ${info.nome}\n💬 ${info.ultimaMsg}`;
    try {
      await client.sendMessage(VENDEDOR_CHAT, texto);
    } catch (e) {
      console.error("Erro ao enviar pendente:", e);
    }
    await delay(500);
  }
}

// --------------------------------
// Imagens
// --------------------------------
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

// --------------------------------
// Saudação / Horários
// --------------------------------
function getHorarioInfo(date = new Date()) {
  const weekday = date.getDay();
  const h = date.getHours();
  const m = date.getMinutes();
  const minutos = h * 60 + m;

  let open = false;
  let openStart = null;
  let openEnd = null;

  if (weekday >= 1 && weekday <= 5) {
    openStart = 7 * 60 + 30;
    openEnd = 17 * 60 + 30;
  } else if (weekday === 6) {
    openStart = 7 * 60 + 30;
    openEnd = 13 * 60;
  }

  if (openStart !== null) open = minutos >= openStart && minutos < openEnd;

  const key = open ? "open" : "closed";
  const today = date.toISOString().slice(0, 10);

  return { open, periodKey: `${key}:${today}` };
}

const MSG_FORA_HORARIO = `Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉
⚠️ No momento não estamos disponíveis.
🕒 Horário:
Seg–Sex: 7:30 às 17:30
Sábado: 7:30 às 13:00
Domingo: Fechado`;

async function enviarSaudacaoSeNecessario(chatId) {
  const info = getHorarioInfo();
  const pk = info.periodKey;

  saudacoes[chatId] = saudacoes[chatId] || {};
  if (saudacoes[chatId][pk]) return false;

  saudacoes[chatId][pk] = true;
  saveJson(SAU_FILE, saudacoes);

  if (info.open) {
    await client.sendMessage(chatId, `Olá! 👋 Seja bem-vindo(a)! 🎉`);
    await delay(1200);
    await client.sendMessage(chatId, `⏳ Líder Festas agradece por sua preferência! Estamos em atendimento!`);
    await delay(1500);

    await enviarVariasImagens(chatId, [
      { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
      { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
    ]);

    await delay(1200);
    await client.sendMessage(chatId, "ℹ️ Como podemos ajudar hoje?");
    return true;
  }

  await client.sendMessage(chatId, MSG_FORA_HORARIO);
  return true;
}

// --------------------------------
// HANDLER PRINCIPAL
// --------------------------------
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();

    // --------------------------------
    // MENSAGEM DO VENDEDOR
    // --------------------------------
    if (msg.from === VENDEDOR_CHAT) {
      try {
        let clienteRespondido = null;

        if (msg.hasQuotedMsg) {
          const quoted = await msg.getQuotedMessage();
          clienteRespondido = quoted.from;
        } else {
          clienteRespondido = chat.id._serialized;
        }

        if (clienteRespondido) {
          if (marcarAtendido(clienteRespondido)) {
            const hoje = new Date().toISOString().slice(0, 10);

            if (notifHistory[hoje] && notifHistory[hoje][clienteRespondido]) {
              delete notifHistory[hoje][clienteRespondido];
            }

            await enviarResumoPendentes();
          }
        }
      } catch (e) {
        console.error("Erro processando resposta do vendedor:", e);
      }
      return;
    }

    // --------------------------------
    // Cliente → marcar pendente
    // --------------------------------
    const notificar = await marcarPendente(chatId, msg.body, msg);
    if (notificar) await enviarNotificacoesNovosPendentes();

    // Saudação
    const saudou = await enviarSaudacaoSeNecessario(chatId);
    if (saudou) return;

    // ----------------------------------------------------
    // A PARTIR DAQUI FICA TODO O RESTANTE DO SEU FLUXO
    // ----------------------------------------------------

    // Adicionar itens
    if (["mais", "bota", "adicionar", "adiciona", "coloca", "acrescenta"].some((t) => texto.includes(t))) {
      await client.sendMessage(chatId, `Perfeito! 😊 Pode me enviar o que mais deseja adicionar o seu pedido.`);
      estadoCliente[chatId] = "aguardando_item";
      return;
    }

    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei! Deseja adicionar mais algum item, ou podemos encerrar ?`);
      estadoCliente[chatId] = null;
      return;
    }

    // Encerrar pedido
    if (["encerrar", "pode encerrar", "só isso", "somente", "somente isso", "encerra"].some((t) => texto.includes(t))) {
      await client.sendMessage(chatId, `Certo! 😊 Será retirada na loja ou entrega?`);
      estadoCliente[chatId] = "aguardando_tipo_entrega";
      return;
    }

    // Tipo entrega
    if (estadoCliente[chatId] === "aguardando_tipo_entrega") {
      if (texto.includes("entrega")) {
        if (!enderecos[chatId]) {
          await client.sendMessage(chatId, `Perfeito! 🚚 Para entrega, qual o endereço completo?`);
          estadoCliente[chatId] = "aguardando_endereco";
          return;
        } else {
          await client.sendMessage(chatId, `Será entregue no endereço salvo: ${enderecos[chatId]}?\nDeseja alterar? (sim/não)`);
          estadoCliente[chatId] = "confirma_endereco";
          return;
        }
      }

      if (texto.includes("retirada") || texto.includes("retirar") || texto.includes("buscar")) {
        await client.sendMessage(chatId, `Perfeito! 🏬 Será retirada na loja.`);
        estadoCliente[chatId] = "confirmar_orcamento";

        await client.sendMessage(
          chatId,
          `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`
        );
        return;
      }
    }

    // Endereço salvo
    if (estadoCliente[chatId] === "aguardando_endereco") {
      enderecos[chatId] = msg.body;
      saveJson(END_FILE, enderecos);

      await client.sendMessage(chatId, `Endereço salvo: ${enderecos[chatId]}`);
      estadoCliente[chatId] = "confirmar_orcamento";

      await client.sendMessage(
        chatId,
        `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`
      );
      return;
    }

    // Confirma endereço
    if (estadoCliente[chatId] === "confirma_endereco") {
      estadoCliente[chatId] = "confirmar_orcamento";

      await client.sendMessage(
        chatId,
        `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`
      );
      return;
    }

    // Confirmar orçamento
    if (estadoCliente[chatId] === "confirmar_orcamento") {
      if (["tudo certo", "correto", "confirmado", "ok"].some((t) => texto.includes(t))) {
        await client.sendMessage(chatId, `Perfeito! 😊 Qual será a forma de pagamento?\nPix\nDinheiro\nCartão`);
        estadoCliente[chatId] = null;
        return;
      }

      if (["errado", "faltou", "corrigir"].some((t) => texto.includes(t))) {
        await client.sendMessage(chatId, `Certo! Me informe o que deseja alterar.`);
        estadoCliente[chatId] = "aguardando_alteracao";
        return;
      }
    }

    if (estadoCliente[chatId] === "aguardando_alteracao") {
      await client.sendMessage(chatId, `Perfeito! Já anotei.`);
      await client.sendMessage(chatId, `Forma de pagamento?`);
      estadoCliente[chatId] = null;
      return;
    }

    // PIX
    if (texto.includes("pix")) {
      await client.sendMessage(chatId, `🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO`);
      await client.sendMessage(chatId, `🙏 Obrigado pela preferência!`);
      return;
    }

    // Dinheiro
    if (texto.includes("dinheiro")) {
      await client.sendMessage(chatId, `Certo! Precisa de troco? (sim / não)`);
      estadoCliente[chatId] = "perguntou_troco";
      return;
    }

    if (estadoCliente[chatId] === "perguntou_troco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Para qual valor precisa de troco?`);
        estadoCliente[chatId] = "aguardando_valor_troco";
        return;
      }
      await client.sendMessage(chatId, `Perfeito! Obrigado!`);
      estadoCliente[chatId] = null;
      return;
    }

    if (estadoCliente[chatId] === "aguardando_valor_troco") {
      await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}.`);
      estadoCliente[chatId] = null;
      return;
    }

    // Cartão
    if (texto.includes("cartão") || texto.includes("cartao")) {
      await client.sendMessage(chatId, `Será à vista ou parcelado?`);
      estadoCliente[chatId] = "escolher_cartao";
      return;
    }

    if (estadoCliente[chatId] === "escolher_cartao") {
      if (texto.includes("parcelado")) {
        await client.sendMessage(chatId,
          `Parcelamos:\n2x acima R$100\n3x acima R$150\nDeseja parcelar?`);
        estadoCliente[chatId] = "confirmar_parcelamento";
        return;
      }

      await client.sendMessage(chatId, `À vista confirmado!`);
      estadoCliente[chatId] = null;
      return;
    }

    if (estadoCliente[chatId] === "confirmar_parcelamento") {
      await client.sendMessage(chatId, `Perfeito! Obrigado!`);
      estadoCliente[chatId] = null;
      return;
    }

  } catch (err) {
    console.error("Erro no handler:", err);
  }
});
