// chatbot.js
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------
// Servidor HTTP para manter o Railway rodando
// ----------------------------
app.get("/", (req, res) => {
  res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});
app.listen(port, () => console.log(`🌐 Servidor ativo no Railway, porta ${port}`));

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
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
// Utilitários
// ----------------------------
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

// ----------------------------
// Estado persistente / memória
// ----------------------------
let atendimentos = loadJson(ATEND_FILE, {}); // { chatId: { nome, ultimaMsg, pendente, notified } }
let saudacoes = loadJson(SAU_FILE, {}); // saudacoes[chatId] = { periodKey: true }
let enderecos = loadJson(END_FILE, {}); // enderecos[chatId] = "endereço salvo"

let estadoCliente = {}; // fluxo por chatId
let ultimoClienteAtivo = null;

const VENDEDOR_CHAT = "5588921552690@c.us"; // seu próprio número (altere se precisar)

// ----------------------------
// Pendentes: marca / desmarca / notifica
// ----------------------------
function marcarPendente(chatId, mensagem) {
  const short = mensagem ? String(mensagem).slice(0, 200) : "";
  if (!atendimentos[chatId]) {
    atendimentos[chatId] = { nome: chatId.replace("@c.us", ""), ultimaMsg: short, pendente: true, notified: false };
    saveJson(ATEND_FILE, atendimentos);
    return true; // novo pendente
  } else {
    // se já pendente, apenas atualiza ultimaMsg (sem reenviar notificação se já notificado)
    atendimentos[chatId].ultimaMsg = short;
    // se já respondido anteriormente e virou pendente de novo, reset notified
    if (!atendimentos[chatId].pendente) atendimentos[chatId].notified = false;
    atendimentos[chatId].pendente = true;
    saveJson(ATEND_FILE, atendimentos);
    // se já tinha been notified true — não é novo para notificar
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

// envia apenas os novos pendentes (notified = false) como notificações separadas
async function enviarNotificacoesNovosPendentes() {
  const novos = Object.entries(atendimentos).filter(([_, v]) => v.pendente && !v.notified);
  if (novos.length === 0) return;
  for (const [chatId, info] of novos) {
    const texto = `🚨 *PENDENTE* — ${info.nome}\n${info.ultimaMsg || ""}`;
    try {
      await client.sendMessage(VENDEDOR_CHAT, texto);
      // marca notified=true para não enviar de novo
      atendimentos[chatId].notified = true;
      saveJson(ATEND_FILE, atendimentos);
    } catch (e) {
      console.error("Erro enviando notificação pendente:", e);
    }
    await delay(400); // pequeno espaçamento para não flood
  }
}

// envia resumo completo (útil quando vendedor pede ou após atendido)
async function enviarResumoPendentes() {
  const pendentes = Object.values(atendimentos).filter((c) => c.pendente);
  if (pendentes.length === 0) {
    await client.sendMessage(VENDEDOR_CHAT, "✅ Nenhum cliente pendente no momento.");
    return;
  }
  let msg = "📋 *CLIENTES PENDENTES:*\n\n";
  pendentes.forEach((c) => {
    msg += `• ${c.nome} — ${c.ultimaMsg}\n`;
  });
  await client.sendMessage(VENDEDOR_CHAT, msg);
}

// ----------------------------
// Enviar imagens (mesma utilidade)
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
// Horário / Saudação
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
⏳ Líder Festas agradece por sua preferência!
⚠️ No momento não estamos disponíveis.
✅ Horário de funcionamento:
⏰ 7:30 às 17:30 hrs, de segunda a sexta-feira;
⏰ 7:30 às 13:00 hrs, aos sábados;
⏰ Fechado aos domingos.`;

async function enviarSaudacaoSeNecessario(chatId) {
  const info = getHorarioInfo();
  const pk = info.periodKey;
  saudacoes[chatId] = saudacoes[chatId] || {};
  if (saudacoes[chatId][pk]) return false;
  saudacoes[chatId][pk] = true;
  saveJson(SAU_FILE, saudacoes);

  if (info.open) {
    await client.sendMessage(chatId, `Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉`);
    await delay(1500);
    await client.sendMessage(chatId, `⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬`);
    await delay(1500);
    await client.sendMessage(chatId, `Enquanto isso, confira nossas ofertas 👇🏻`);
    await enviarVariasImagens(chatId, [
      { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
      { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
      { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
    ]);
    await client.sendMessage(chatId, "ℹ️ Como podemos lhe ajudar ?");
    await client.sendMessage(
      chatId,
      `📝 Caso deseje fazer um pedido envie-nos sua lista.
▶️ Para adicionar itens use: Adicionar➕
▶️ Para encerrar use: Encerrar❌`
    );
    return true;
  } else {
    await client.sendMessage(chatId, MSG_FORA_HORARIO);
    return true;
  }
}

// ----------------------------
// Handler principal
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();

    // Ignorar grupos
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();
    ultimoClienteAtivo = chatId;

    // Mensagem vinda do VENDEDOR (humano que usa o mesmo WhatsApp)
    if (msg.fromMe) {
      try {
        let clienteRespondido = null;

        if (msg.hasQuotedMsg) {
          const quoted = await msg.getQuotedMessage();
          clienteRespondido = quoted.from; // id do cliente citado
        } else if (ultimoClienteAtivo) {
          // se não houver quote, assume o último cliente ativo
          clienteRespondido = ultimoClienteAtivo;
        }

        if (clienteRespondido) {
          const removed = marcarAtendido(clienteRespondido);
          if (removed) {
            await enviarResumoPendentes();
          }
        }
      } catch (e) {
        console.error("Erro processando resposta humana:", e);
      }
      return;
    }

    // Mensagem de cliente -> marcar pendente (notifica apenas se ainda não notificado)
    const isNewNotification = marcarPendente(chatId, msg.body || "");
    if (isNewNotification) {
      // envia notificação só para os novos não-notificados
      await enviarNotificacoesNovosPendentes();
    }

    // também atualiza resumo completo ocasionalmente? (não necessário sempre)
    // await enviarResumoPendentes(); // opcional

    // Saudação / ofertas (só uma vez por período)
    const sentGreeting = await enviarSaudacaoSeNecessario(chatId);
    if (sentGreeting) return;

    // ========== Fluxos do cliente ==========
    // Adicionar itens
    if (["mais", "bota", "adicionar", "adiciona", "coloca", "acrescenta"].some((t) => texto.includes(t))) {
      await client.sendMessage(chatId, `Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido.`);
      estadoCliente[chatId] = "aguardando_item";
      return;
    }
    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei! Deseja adicionar mais algum item, ou podemos encerrar ?`);
      await delay(1500);
      await client.sendMessage(chatId, "➕ Para adicionar mais itens use: Adicionar➕\n❌ Para encerrar use: Encerrar❌");
      estadoCliente[chatId] = null;
      return;
    }

    // Encerrar pedido
    if (["encerrar", "pode encerrar", "só isso", "somente", "somente isso", "encerra"].some((t) => texto.includes(t))) {
      await client.sendMessage(chatId, `Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?`);
      estadoCliente[chatId] = "aguardando_tipo_entrega";
      return;
    }

    // Tipo entrega / retirada
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
      } else if (texto.includes("retirada") || texto.includes("retirar") || texto.includes("buscar") || texto.includes("pegar")) {
        await client.sendMessage(chatId, `Perfeito! 🏬 Será retirada na loja.`);
        estadoCliente[chatId] = "confirmar_orcamento";
        await client.sendMessage(
          chatId,
          `📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`
        );
        return;
      }
    }

    // Recebeu endereço (salva)
    if (estadoCliente[chatId] === "aguardando_endereco") {
      enderecos[chatId] = msg.body;
      saveJson(END_FILE, enderecos);
      await client.sendMessage(chatId, `Endereço salvo: ${enderecos[chatId]}`);
      estadoCliente[chatId] = "confirmar_orcamento";
      await client.sendMessage(
        chatId,
        `📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`
      );
      return;
    }

    // Confirma endereço existente
    if (estadoCliente[chatId] === "confirma_endereco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Perfeito! Endereço mantido: ${enderecos[chatId]}`);
      } else if (texto.includes("não") || texto.includes("nao")) {
        await client.sendMessage(chatId, `Ok! Por favor informe o novo endereço:`);
        estadoCliente[chatId] = "aguardando_endereco";
        return;
      }
      estadoCliente[chatId] = "confirmar_orcamento";
      await client.sendMessage(
        chatId,
        `📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`
      );
      return;
    }

    // Confirmar orçamento
    if (estadoCliente[chatId] === "confirmar_orcamento") {
      if (["tudo certo", "correto", "confirmado"].some((t) => texto.includes(t))) {
        await client.sendMessage(
          chatId,
          `Perfeito! 😊 Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`
        );
        estadoCliente[chatId] = null;
        return;
      }
      if (["errado", "tem erro", "faltou", "alterar", "corrigir"].some((t) => texto.includes(t))) {
        await client.sendMessage(chatId, `Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️`);
        estadoCliente[chatId] = "aguardando_alteracao";
        return;
      }
    }

    if (estadoCliente[chatId] === "aguardando_alteracao") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei: *${msg.body}*`);
      await delay(1500);
      await client.sendMessage(chatId, `Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`);
      estadoCliente[chatId] = null;
      return;
    }

    // Pagamentos: PIX
    if (texto.includes("pix")) {
      await client.sendMessage(
        chatId,
        `🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO`
      );
      await delay(1500);
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      return;
    }

    // Dinheiro -> troco
    if (texto.includes("dinheiro")) {
      await client.sendMessage(chatId, `Certo! Precisa de troco? 💵 (Responda: sim ou não)`);
      estadoCliente[chatId] = "perguntou_troco";
      return;
    }
    if (estadoCliente[chatId] === "perguntou_troco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Ok! Para qual valor precisa de troco? 💰`);
        estadoCliente[chatId] = "aguardando_valor_troco";
        return;
      } else {
        await client.sendMessage(chatId, `Perfeito! Valor já considera desconto à vista.`);
        await delay(1000);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
        return;
      }
    }
    if (estadoCliente[chatId] === "aguardando_valor_troco") {
      await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}. 💵`);
      await delay(1000);
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      estadoCliente[chatId] = null;
      return;
    }

    // Cartão
    if (texto.includes("cartão") || texto.includes("cartao")) {
      await client.sendMessage(chatId, `Perfeito! Será à vista ou parcelado? 💳`);
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
      } else if (texto.includes("à vista") || texto.includes("avista") || texto.includes("a vista")) {
        await client.sendMessage(chatId, `💰 Pagamento à vista confirmado! Valor já inclui desconto especial.`);
        await delay(1000);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
      }
      return;
    }
    if (estadoCliente[chatId] === "confirmar_parcelamento") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Perfeito! Vamos seguir com o parcelamento. 💳✅`);
      } else if (texto.includes("não") || texto.includes("nao")) {
        await client.sendMessage(chatId, `Sem problemas! Vamos continuar no pagamento à vista. 👍`);
      }
      estadoCliente[chatId] = null;
      return;
    }

    // se não casou com nada acima -> nada a fazer (pode expandir)
  } catch (err) {
    console.error("Erro no handler de mensagem:", err);
  }
});