// chatbot.js
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// --------------------------------
// Servidor HTTP para manter o Railway ativo
// --------------------------------
app.get("/", (req, res) => {
  res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});
app.listen(port, () =>
  console.log(`🌐 Servidor ativo no Railway, porta ${port}`)
);

// --------------------------------
// Inicialização do WhatsApp
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
let ultimoClienteAtivo = null;

// --------------------------------
// Extrair número corretamente
// --------------------------------
function extrairNumero(chatId) {
  return chatId.replace(/[^0-9]/g, "");
}

// --------------------------------
// PENDENTES — Agora com NOME do WhatsApp!
// --------------------------------
async function marcarPendente(chatId, mensagem, msgObj) {
  const short = mensagem ? String(mensagem).slice(0, 200) : "";
  const numero = extrairNumero(chatId);

  // pega o contato do cliente
  const contato = await msgObj.getContact();
  const nomeWhatsApp = contato.pushname || contato.name || numero;

  if (!atendimentos[chatId]) {
    atendimentos[chatId] = {
      nome: nomeWhatsApp,
      ultimaMsg: short,
      pendente: true,
      notified: false,
    };
    saveJson(ATEND_FILE, atendimentos);
    return true;
  } else {
    atendimentos[chatId].ultimaMsg = short;

    if (!atendimentos[chatId].pendente) atendimentos[chatId].notified = false;

    atendimentos[chatId].pendente = true;
    saveJson(ATEND_FILE, atendimentos);

    return !atendimentos[chatId].notified;
  }
}

function marcarAtendido(chatId) {
  if (atendimentos[chatId]) {
    atendimentos[chatId].pendente = false;
    atendimentos[chatId].notified = false;
    saveJson(ATEND_FILE, atendimentos);
    return true;
  }
  return false;
}

async function enviarNotificacoesNovosPendentes() {
  const novos = Object.entries(atendimentos).filter(
    ([_, v]) => v.pendente && !v.notified
  );
  if (novos.length === 0) return;

  for (const [chatId, info] of novos) {
    const texto = `🚨 *PENDENTE*\n👤 ${info.nome}\n💬 ${info.ultimaMsg || ""}`;

    try {
      await client.sendMessage(VENDEDOR_CHAT, texto);
      atendimentos[chatId].notified = true;
      saveJson(ATEND_FILE, atendimentos);
    } catch (e) {
      console.error("Erro enviando notificação pendente:", e);
    }
    await delay(400);
  }
}

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
  const toMin = (hh, mm) => hh * 60 + mm;

  let openStart = null,
    openEnd = null,
    open = false;

  if (weekday >= 1 && weekday <= 5) {
    openStart = toMin(7, 30);
    openEnd = toMin(17, 30);
  } else if (weekday === 6) {
    openStart = toMin(7, 30);
    openEnd = toMin(13, 0);
  }

  if (openStart !== null) open = minutos >= openStart && minutos < openEnd;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  const dateKey = `${yyyy}-${mm}-${dd}`;
  const periodKey = open ? `open:${dateKey}` : `closed:${dateKey}`;

  return { open, periodKey };
}

const MSG_FORA_HORARIO = `Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉
⏳ Líder Festas agradece sua preferência!
⚠️ No momento não estamos disponíveis.
🕒 Horário:
Seg–Sex: 7:30 às 17:30
Sábado: 7:30 às 13:00
Domingo: Fechado`;

// Saudação automática
async function enviarSaudacaoSeNecessario(chatId) {
  const info = getHorarioInfo();
  const pk = info.periodKey;

  saudacoes[chatId] = saudacoes[chatId] || {};
  if (saudacoes[chatId][pk]) return false;

  saudacoes[chatId][pk] = true;
  saveJson(SAU_FILE, saudacoes);

  if (info.open) {
    await client.sendMessage(chatId, `Olá! 👋 Seja bem-vindo(a)! 🎉`);
    await delay(1500);
    await client.sendMessage(
      chatId,
      `⏳ Líder Festas agradece por sua preferência! Estamos em atendimento!`
    );
    await client.sendMessage(chatId, `Encanto aguarda, confira nossas ofertas: 👇`);
    await delay(1500);
    await delay(1500);

    await enviarVariasImagens(chatId, [
      { caminho: "./imagens/1.png", legenda: "🎉 Confira nossas ofertas!" },
      { caminho: "./imagens/2.png", legenda: "🎉 Tem algo que você gostou?" },
    ]);

    await client.sendMessage(chatId, "ℹ️ Como podemos ajudar hoje?");
    await client.sendMessage( chatId, "📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n▶️ Para adicionar itens use: Adicionar➕\n ▶️ Para encerrar use: Encerrar❌" );
    }
    return true;
  } else {
    await client.sendMessage(chatId, MSG_FORA_HORARIO);
    return true;
  }
}

// --------------------------------
// Handler principal
// --------------------------------
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();

    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();
    ultimoClienteAtivo = chatId;

    // Se a mensagem vem do vendedor
    if (msg.fromMe) {
      try {
        let clienteRespondido = null;

        if (msg.hasQuotedMsg) {
          const quoted = await msg.getQuotedMessage();
          clienteRespondido = quoted.from;
        } else {
          clienteRespondido = ultimoClienteAtivo;
        }

        if (clienteRespondido) {
          const removed = marcarAtendido(clienteRespondido);
          if (removed) await enviarResumoPendentes();
        }
      } catch (e) {
        console.error("Erro na resposta humana:", e);
      }
      return;
    }

    // Marca pendente COM nome do WhatsApp
    const isNewNotification = await marcarPendente(
      chatId,
      msg.body || "",
      msg
    );

    if (isNewNotification) await enviarNotificacoesNovosPendentes();

    // Saudação
    const sentGreeting = await enviarSaudacaoSeNecessario(chatId);
    if (sentGreeting) return;

    // --------------------------------
    // DAQUI PARA BAIXO É SEU FLUXO NORMAL DE ATENDIMENTO
    // (mantive tudo exatamente como estava)
    // --------------------------------

    // Adicionar itens
    if (
      ["mais", "bota", "adicionar", "adiciona", "coloca", "acrescenta"].some(
        (t) => texto.includes(t)
      )
    ) {
      await client.sendMessage(
        chatId,
        `Perfeito! 😊 Já anotei! Deseja adicionar mais algum item, ou podemos encerrar ?`
      );
      estadoCliente[chatId] = "aguardando_item";
      return;
    }

    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(
        chatId,
        `Perfeito! 😊 Já anotei! Deseja adicionar mais algum item, ou podemos encerrar ?`
      );
      await delay(1500);
      await client.sendMessage(
        chatId,
        "➕ Adicionar mais itens: *Adicionar*\n❌ Encerrar: *Encerrar*"
      );
      estadoCliente[chatId] = null;
      return;
    }

    // Encerrar pedido
    if (
      ["encerrar", "pode encerrar", "só isso", "somente", "somente isso", "encerra"].some(
        (t) => texto.includes(t)
      )
    ) {
      await client.sendMessage(
        chatId,
        `Certo! Será *retirada* ou *entrega*?`
      );
      estadoCliente[chatId] = "aguardando_tipo_entrega";
      return;
    }

    // Tipo de entrega / retirada
    if (estadoCliente[chatId] === "aguardando_tipo_entrega") {
      if (texto.includes("entrega")) {
        if (!enderecos[chatId]) {
          await client.sendMessage(
            chatId,
            `Perfeito! 🚚 Qual o endereço completo para entrega?`
          );
          estadoCliente[chatId] = "aguardando_endereco";
          return;
        } else {
          await client.sendMessage(
            chatId,
            `Será entregue no endereço salvo: ${enderecos[chatId]}\nDeseja alterar? (sim/não)`
          );
          estadoCliente[chatId] = "confirma_endereco";
          return;
        }
      } else if (
        texto.includes("retirada") ||
        texto.includes("retirar") ||
        texto.includes("buscar") ||
        texto.includes("pegar")
      ) {
        await client.sendMessage(chatId, `Perfeito! 🏬 Retirada na loja.`);
        estadoCliente[chatId] = "confirmar_orcamento";
        await client.sendMessage(
          chatId,
          `📝 Após eu enviar o orçamento, responda:\n✔️ Tudo certo\n⚠️ Errado\nAssim finalizamos seu pedido.`
        );
        return;
      }
    }

    // Recebe endereço
    if (estadoCliente[chatId] === "aguardando_endereco") {
      enderecos[chatId] = msg.body;
      saveJson(END_FILE, enderecos);

      await client.sendMessage(chatId, `Endereço salvo: ${enderecos[chatId]}`);
      estadoCliente[chatId] = "confirmar_orcamento";

      await client.sendMessage(
        chatId,
        `📝 Após o orçamento, responda:\n✔️ Tudo certo\n⚠️ Errado`
      );
      return;
    }

    // Confirma endereço salvo
    if (estadoCliente[chatId] === "confirma_endereco") {
      if (texto.includes("sim")) {
        await client.sendMessage(
          chatId,
          `Perfeito! Continuaremos com este endereço.`
        );
      } else {
        await client.sendMessage(chatId, `Ok! Informe o novo endereço:`);
        estadoCliente[chatId] = "aguardando_endereco";
        return;
      }

      estadoCliente[chatId] = "confirmar_orcamento";
      await client.sendMessage(
        chatId,
        `📝 Após o orçamento, responda:\n✔️ Tudo certo\n⚠️ Errado`
      );
      return;
    }

    // Confirma orçamento
    if (estadoCliente[chatId] === "confirmar_orcamento") {
      if (
        ["tudo certo", "correto", "confirmado"].some((t) =>
          texto.includes(t)
        )
      ) {
        await client.sendMessage(
          chatId,
          `Perfeito! Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`
        );
        estadoCliente[chatId] = null;
        return;
      }

      if (
        ["errado", "alterar", "faltou", "corrigir", "tem erro"].some((t) =>
          texto.includes(t)
        )
      ) {
        await client.sendMessage(
          chatId,
          `Sem problema 😄 O que deseja alterar?`
        );
        estadoCliente[chatId] = "aguardando_alteracao";
        return;
      }
    }

    if (estadoCliente[chatId] === "aguardando_alteracao") {
      await client.sendMessage(chatId, `Entendido! Vamos ajustar: *${msg.body}*`);
      await delay(1500);
      await client.sendMessage(
        chatId,
        `Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`
      );
      estadoCliente[chatId] = null;
      return;
    }

    // PIX
    if (texto.includes("pix")) {
      await client.sendMessage(
        chatId,
        `🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO`
      );
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      return;
    }

    // Dinheiro
    if (texto.includes("dinheiro")) {
      await client.sendMessage(
        chatId,
        `Certo! Precisa de troco? (sim/não)`
      );
      estadoCliente[chatId] = "perguntou_troco";
      return;
    }

    if (estadoCliente[chatId] === "perguntou_troco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Para qual valor precisa de troco?`);
        estadoCliente[chatId] = "aguardando_valor_troco";
      } else {
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
      }
      return;
    }

    if (estadoCliente[chatId] === "aguardando_valor_troco") {
      await client.sendMessage(
        chatId,
        `Ok! Levaremos troco para ${msg.body}.`
      );
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      estadoCliente[chatId] = null;
      return;
    }

    // Cartão
    if (texto.includes("cartão") || texto.includes("cartao")) {
      await client.sendMessage(
        chatId,
        `Será à vista ou parcelado?`
      );
      estadoCliente[chatId] = "escolher_cartao";
      return;
    }

    if (estadoCliente[chatId] === "escolher_cartao") {
      if (texto.includes("parcelado")) {
        await client.sendMessage(
          chatId,
          `💳 Parcelamos em *2x para compras acima de R$100* e *3x acima de R$150*.\n⚠️ *Obs:* Valor parcelado não tem desconto.\nVocê deseja realmente parcelar? (sim/não)`
        );
        estadoCliente[chatId] = "confirmar_parcelamento";
      } else if (
        texto.includes("à vista") ||
        texto.includes("avista") ||
        texto.includes("a vista")
      ) {
        await client.sendMessage(chatId, `Pagamento à vista confirmado!`);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
      }
      return;
    }

    if (estadoCliente[chatId] === "confirmar_parcelamento") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Parcelamento confirmado!`);
      } else {
        await client.sendMessage(chatId, `Ok! Então será à vista.`);
      }
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      estadoCliente[chatId] = null;
      return;
    }

  } catch (err) {
    console.error("Erro no handler:", err);
  }
});
