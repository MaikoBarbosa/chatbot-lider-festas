// ----------------------------
// chatbot.js
// ----------------------------
import express from "express";
import fs from "fs-extra";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { supabase, carregarSessao } from "./supabase.js";

const { Client, LocalAuth, MessageMedia } = pkg;
const app = express();
const port = process.env.PORT || 3000;

// ----------------------------
// Servidor HTTP para Railway
// ----------------------------
app.get("/", (req, res) => {
  res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});

app.listen(port, () => console.log(`🌐 Servidor ativo na porta ${port}`));

// ----------------------------
// Função delay
// ----------------------------
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ----------------------------
// Envio de imagens
// ----------------------------
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
// Estado do cliente e pendentes
// ----------------------------
let estadoCliente = {};
let atendimentos = {};
let saudacoes = {};
let enderecos = {}; // endereço salvo no Supabase

// ----------------------------
// Número do vendedor para lista de pendentes
// ----------------------------
const VENDEDOR_CHAT = "5588921552690@c.us";

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
await carregarSessao();

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

client.on("ready", () => console.log("✅ Bot conectado ao WhatsApp com sucesso!"));

client.initialize();

// ----------------------------
// Função para enviar lista de pendentes
// ----------------------------
async function enviarListaPendentes() {
  const pend = Object.keys(atendimentos).filter((c) => !atendimentos[c].respondido);
  if (pend.length === 0) {
    await client.sendMessage(VENDEDOR_CHAT, "✅ Nenhum cliente pendente no momento.");
    return;
  }
  let texto = "📋 *LISTA DE CLIENTES PENDENTES:*\n\n";
  pend.forEach((c) => {
    texto += `• ${c.replace("@c.us", "")} — *PENDENTE*\n`;
  });
  await client.sendMessage(VENDEDOR_CHAT, texto);
}

// ----------------------------
// Handler principal de mensagens
// ----------------------------
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();

    // ----------------------------
    // Saudações
    // ----------------------------
    const agora = Date.now();
    const tresHoras = 3 * 60 * 60 * 1000;
    if (
      (texto.includes("oi") ||
        texto.includes("ola") ||
        texto.includes("olá") ||
        texto.includes("bom dia") ||
        texto.includes("boa tarde") ||
        texto.includes("boa noite")) &&
      (!saudacoes[chatId] || agora - saudacoes[chatId] > tresHoras)
    ) {
      saudacoes[chatId] = agora;

      await delay(2000);
      await chat.sendStateTyping();
      await client.sendMessage(chatId, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");

      await delay(2500);
      await chat.sendStateTyping();
      await client.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");

      await delay(2500);
      await chat.sendStateTyping();
      await client.sendMessage(chatId, "Enquanto isso, confira nossas ofertas 👇🏻");

      await enviarVariasImagens(chatId, [
        { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
        { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
        { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
      ]);

      await client.sendMessage(chatId, "ℹ️ Como podemos lhe ajudar ?");
      await client.sendMessage(
        chatId,
        "📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n▶️ Para adicionar itens use: Adicionar➕\n▶️ Para encerrar use: Encerrar❌"
      );
      return;
    }

    // ----------------------------
    // Adicionar itens
    // ----------------------------
    if (
      texto.includes("mais") ||
      texto.includes("adicionar") ||
      texto.includes("adiciona") ||
      texto.includes("coloca") ||
      texto.includes("acrescenta")
    ) {
      await client.sendMessage(chatId, "Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?");
      estadoCliente[chatId] = "aguardando_item";
      return;
    }

    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(chatId, `Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?`);
      estadoCliente[chatId] = null;
      return;
    }

    // ----------------------------
    // Encerrar pedido
    // ----------------------------
    if (
      texto.includes("encerrar") ||
      texto.includes("pode encerrar") ||
      texto.includes("só") ||
      texto.includes("só isso") ||
      texto.includes("somente")
    ) {
      // Pergunta entrega ou retirada
      if (enderecos[chatId]) {
        await client.sendMessage(chatId, `Endereço salvo: ${enderecos[chatId]}. Deseja alterar ou manter?`);
        estadoCliente[chatId] = "confirmar_endereco";
      } else {
        await client.sendMessage(chatId, "Certo! 😊 Será *entrega* ou *retirada na loja*?");
        estadoCliente[chatId] = "aguardando_tipo_entrega";
      }
      return;
    }

    // ----------------------------
    // Tipo de entrega
    // ----------------------------
    if (estadoCliente[chatId] === "aguardando_tipo_entrega") {
      if (texto.includes("entrega")) {
        estadoCliente[chatId] = "aguardando_endereco";
        await client.sendMessage(chatId, "Qual o endereço para entrega?");
      } else if (
        texto.includes("retirada") ||
        texto.includes("retirar") ||
        texto.includes("buscar") ||
        texto.includes("pegar")
      ) {
        estadoCliente[chatId] = "retirada_confirmada";
        await client.sendMessage(chatId, "Perfeito! 🏬 Retirada na loja confirmada.");
      }
      return;
    }

    if (estadoCliente[chatId] === "aguardando_endereco") {
      enderecos[chatId] = msg.body;
      await supabase.from("enderecos").upsert({ chat_id: chatId, endereco: msg.body });
      estadoCliente[chatId] = "endereco_confirmado";

      await client.sendMessage(chatId, `Endereço salvo: ${msg.body}`);
      await client.sendMessage(chatId, "📝 Após o envio do orçamento, responda:\n✅ Tudo certo\n⚠️ Errado\nAssim podemos finalizar seu pedido. 😉");
      return;
    }

    // ----------------------------
    // Confirmação do orçamento
    // ----------------------------
    if (texto.includes("tudo certo") || texto.includes("correto") || texto.includes("confirmado")) {
      await client.sendMessage(chatId, "Perfeito! 😊 Qual será a forma de pagamento?\n\n💰 Pix\n💵 Dinheiro\n💳 Cartão");
      return;
    }

    // ----------------------------
    // Orçamento errado
    // ----------------------------
    if (texto.includes("errado") || texto.includes("incorreto") || texto.includes("faltou") || texto.includes("corrigir") || texto.includes("ajustar")) {
      await client.sendMessage(chatId, "Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️");
      estadoCliente[chatId] = "aguardando_alteracao";
      return;
    }

    if (estadoCliente[chatId] === "aguardando_alteracao") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei que deseja alterar: *${msg.body}*`);
      await delay(2000);
      await client.sendMessage(chatId, "E qual será a forma de pagamento?\n\n💰 Pix\n💵 Dinheiro\n💳 Cartão");
      estadoCliente[chatId] = null;
      return;
    }

    // ----------------------------
    // Pagamentos
    // ----------------------------
    if (texto.includes("pix")) {
      await client.sendMessage(chatId, "🔑 Chave Pix:\n📱 CNPJ: 49.093.600/0001-30\nNAYANDRA KELLY H SANTIAGO");
      await delay(2000);
      await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
      return;
    }

    if (texto.includes("dinheiro")) {
      await client.sendMessage(chatId, "Certo! Precisa de troco? 💵 (Responda: sim ou não)");
      estadoCliente[chatId] = "perguntou_troco";
      return;
    }

    if (estadoCliente[chatId] === "perguntou_troco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, "Ok! Para qual valor precisa de troco? 💰");
        estadoCliente[chatId] = "aguardando_valor_troco";
      } else if (texto.includes("não")) {
        await client.sendMessage(chatId, "Perfeito! O valor já considera o desconto à vista. 💰");
        await delay(1500);
        await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
        estadoCliente[chatId] = null;
      }
      return;
    }

    if (estadoCliente[chatId] === "aguardando_valor_troco") {
      await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}. 💵`);
      await delay(2000);
      await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
      estadoCliente[chatId] = null;
      return;
    }

    if (texto.includes("cartão") || texto.includes("cartao")) {
      await client.sendMessage(chatId, "Perfeito! Será à vista ou parcelado? 💳");
      estadoCliente[chatId] = "pag_cartao";
      return;
    }

    if (estadoCliente[chatId] === "pag_cartao") {
      if (texto.includes("parcelado")) {
        await client.sendMessage(chatId, "💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150.\nObs: Valor parcelado não tem desconto.");
      } else if (texto.includes("à vista") || texto.includes("avista") || texto.includes("a vista")) {
        await client.sendMessage(chatId, "💰 Pagamento à vista confirmado! O valor já inclui o desconto especial.");
      }
      await delay(2000);
      await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
      estadoCliente[chatId] = null;
      return;
    }

  } catch (err) {
    console.error("Erro no handler de mensagem:", err);
  }
});