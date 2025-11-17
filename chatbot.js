// chatbot.js (versão final completa - com fluxo + pendentes + horário Fortaleza)
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

// ===================== CONFIG =====================
const VENDEDOR_CHAT = "558897019483@c.us"; // número do vendedor (fixo)
const PORT = process.env.PORT || 3000;

// ===================== HTTP (Railway keep-alive) =====================
const app = express();
app.get("/", (req, res) => res.send("🚀 Bot do WhatsApp está rodando!"));
app.listen(PORT, () => console.log(`🌐 Servidor ativo na porta ${PORT}`));

// ===================== WhatsApp Client =====================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

client.on("qr", (qr) => {
  console.log("===========================================");
  console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
  console.log(qr);
  console.log("===========================================");
 // qrcode.generate(qr, { small: true });
});
client.on("ready", () => console.log("✅ Bot conectado ao WhatsApp!"));
client.initialize();

// ===================== Utilitários / Persistência =====================
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, "atendimentos.json");
const SAU_FILE = path.join(DATA_DIR, "saudacoes.json");
const END_FILE = path.join(DATA_DIR, "enderecos.json");

function loadJson(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("Erro lendo", file, e);
  }
  return fallback;
}
function saveJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("Erro gravando", file, e);
  }
}

// estados persistentes
let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});
let enderecos = loadJson(END_FILE, {});
let estadoCliente = {}; // estados temporários por chat

// histórico diário de notificações (em memória)
let notifHistory = {}; // { 'YYYY-MM-DD': { '<chatId>': true } }

// ===================== Helpers =====================
function extrairNumero(chatId) {
  return String(chatId).replace(/[^0-9]/g, "");
}

// Gera data local de Fortaleza (UTC-3) de forma robusta, independente do timezone do servidor
function getFortalezaNow() {
  const now = new Date();
  // Fortaleza é UTC-3 (sem DST)
  const targetOffsetHours = -3;
  // getTimezoneOffset() retorna minutos de deslocamento (ex: -180 para UTC+3)
  const localOffsetHours = -now.getTimezoneOffset() / 60;
  const deltaHours = targetOffsetHours - localOffsetHours;
  const local = new Date(now.getTime() + deltaHours * 3600 * 1000);
  return local;
}

function getHorarioInfo() {
  const local = getFortalezaNow();
  const weekday = local.getDay(); // 0=domingo ... 6=sábado
  const h = local.getHours();
  const m = local.getMinutes();
  const minutos = h * 60 + m;

  const toMin = (hh, mm) => hh * 60 + mm;

  let openStart = null, openEnd = null;
  if (weekday >= 1 && weekday <= 5) { // seg-sex
    openStart = toMin(7, 30);
    openEnd = toMin(17, 30);
  } else if (weekday === 6) { // sab
    openStart = toMin(7, 30);
    openEnd = toMin(13, 0);
  } else {
    // domingo fechado
    return { open: false, dateKey: local.toISOString().slice(0,10), periodKey: `closed:${local.toISOString().slice(0,10)}` };
  }

  const open = minutos >= openStart && minutos < openEnd;
  const dateKey = local.toISOString().slice(0,10);
  const periodKey = open ? `open:${dateKey}` : `closed:${dateKey}`;

  return { open, dateKey, periodKey, local };
}

const MSG_FORA_HORARIO = `Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉
⚠️ No momento não estamos disponíveis.
🕒 Horário:
Seg–Sex: 7:30 às 17:30
Sábado: 7:30 às 13:00
Domingo: Fechado`;

// ===================== Gerenciamento de Pendentes =====================
// marcarPendente: marca atendimento e garante 1 notificação por cliente por dia
async function marcarPendente(chatId, mensagem, msgObj) {
  const short = mensagem ? String(mensagem).slice(0, 200) : "";
  const numero = extrairNumero(chatId);

  // hoje (YYYY-MM-DD) - usa data de server (não crítico aqui), mas podemos usar Fortaleza também
  const hoje = getHorarioInfo().dateKey;
  notifHistory[hoje] = notifHistory[hoje] || {};

  // nome do contato
  let nomeWhatsApp = numero;
  try {
    const contato = await msgObj.getContact();
    nomeWhatsApp = contato.pushname || contato.name || numero;
  } catch (e) {
    nomeWhatsApp = numero;
  }

  // cria/atualiza registro de atendimento
  if (!atendimentos[chatId]) {
    atendimentos[chatId] = {
      nome: nomeWhatsApp,
      ultimaMsg: short,
      pendente: true,
      notifiedToVendor: false, // se já enviamos para vendedor
    };
  } else {
    atendimentos[chatId].ultimaMsg = short;
    atendimentos[chatId].pendente = true;
    // reset notifiedToVendor se for um novo ciclo (mas vamos controlar com notifHistory)
  }
  saveJson(ATEND_FILE, atendimentos);

  // Se já notificamos HOJE para esse cliente -> não notificar de novo
  if (notifHistory[hoje][chatId]) {
    return false;
  }

  // marca no histórico que avisamos hoje (impede repetição ao longo do dia)
  notifHistory[hoje][chatId] = true;

  // indicamos que há uma nova notificação a ser enviada ao vendedor
  return true;
}

// marcarAtendido: marca atendido e salva
function marcarAtendido(chatId) {
  if (atendimentos[chatId]) {
    atendimentos[chatId].pendente = false;
    atendimentos[chatId].notifiedToVendor = false;
    saveJson(ATEND_FILE, atendimentos);
    return true;
  }
  return false;
}

// enviar resumo de pendentes ao vendedor
async function enviarResumoPendentes() {
  const pendentes = Object.entries(atendimentos).filter(([_, v]) => v.pendente);

  if (pendentes.length === 0) {
    await client.sendMessage(VENDEDOR_CHAT, "✅ Nenhum cliente pendente.");
    return;
  }

  let msg = "📋 *CLIENTES PENDENTES:*\n\n";
  for (const [chatId, info] of pendentes) {
    msg += `• *${info.nome}*\n  ${info.ultimaMsg}\n  id: ${chatId}\n\n`;
  }

  await client.sendMessage(VENDEDOR_CHAT, msg);
}

// enviar notificações dos novos pendentes (só os não-notificados ao vendedor)
async function enviarNotificacoesNovosPendentes() {
  const hoje = getHorarioInfo().dateKey;

  for (const [chatId, info] of Object.entries(atendimentos)) {
    if (!info.pendente) continue;
    // só enviar se marcamos notifHistory hoje e ainda não notificamos o vendedor (notifiedToVendor false)
    if (!notifHistory[hoje] || !notifHistory[hoje][chatId]) continue;
    if (info.notifiedToVendor) continue;

    const texto = `🚨 *PENDENTE*\n👤 ${info.nome}\n💬 ${info.ultimaMsg || ""}`;
    try {
      await client.sendMessage(VENDEDOR_CHAT, texto);
      atendimentos[chatId].notifiedToVendor = true;
      saveJson(ATEND_FILE, atendimentos);
    } catch (e) {
      console.error("Erro enviando notificação pendente:", e);
    }
    await delay(400);
  }
}

// ===================== Imagens =====================
async function enviarImagem(numero, caminho, legenda) {
  try {
    const media = MessageMedia.fromFilePath(caminho);
    await client.sendMessage(numero, media, { caption: legenda });
  } catch (e) {
    console.error("Erro enviando imagem", caminho, e);
  }
}
async function enviarVariasImagens(numero, imagens) {
  for (const item of imagens) {
    await enviarImagem(numero, item.caminho, item.legenda);
    await delay(2000);
  }
}

// ===================== Saudação automática (uma vez por períodoKey por chat) =====================
async function enviarSaudacaoSeNecessario(chatId) {
  const info = getHorarioInfo();
  const pk = info.periodKey; // e.g. "open:2025-11-17" ou "closed:2025-11-17"

  saudacoes[chatId] = saudacoes[chatId] || {};
  if (saudacoes[chatId][pk]) return false; // já saudou neste período

  saudacoes[chatId][pk] = true;
  saveJson(SAU_FILE, saudacoes);

  if (info.open) {
    await client.sendMessage(chatId, `Olá! 👋 Seja bem-vindo(a)! 🎉`);
    await delay(1200);
    await client.sendMessage(chatId, `⏳ Líder Festas agradece por sua preferência! Estamos em atendimento!`);
    await delay(1200);
    await client.sendMessage(chatId, `Encanto aguarda, confira nossas ofertas:`);

    // tente enviar imagens (verifique se existem)
    await enviarVariasImagens(chatId, [
      { caminho: "./imagens/Encarte.png", legenda: "👏🏻Confira nossas ofertas! 🎉" },
      { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
      { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
    ]);

    await delay(800);
    await client.sendMessage(chatId, "ℹ️ Como podemos ajudar hoje?\n▶️ Para adicionar itens use: Adicionar➕\n▶️ Para encerrar use: Encerrar❌");
    return true;
  } else {
    await client.sendMessage(chatId, MSG_FORA_HORARIO);
    return true;
  }
}

// ===================== Handler principal =====================
client.on("message", async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || "").trim().toLowerCase();

    // ---------------------------
    // Mensagem do vendedor (humano no mesmo WhatsApp)
    // ---------------------------
    if (msg.from === VENDEDOR_CHAT) {
      try {
        let clienteRespondido = null;

        if (msg.hasQuotedMsg) {
          const quoted = await msg.getQuotedMessage();
          clienteRespondido = quoted.from;
        } else {
          // vendedor enviando diretamente em um chat (quando vendedor abre o chat do cliente)
          const vendedorChat = await msg.getChat();
          clienteRespondido = vendedorChat.id._serialized;
        }

        if (clienteRespondido) {
          // marca atendido e prepara atualização
          if (marcarAtendido(clienteRespondido)) {
            // limpa notifHistory de hoje para esse cliente (permitir nova notificação em outro dia)
            const hoje = getHorarioInfo().dateKey;
            if (notifHistory[hoje] && notifHistory[hoje][clienteRespondido]) {
              delete notifHistory[hoje][clienteRespondido];
            }

            // envia resumo atualizado para o vendedor
            await enviarResumoPendentes();
          }
        }
      } catch (e) {
        console.error("Erro processando resposta do vendedor:", e);
      }
      return;
    }

    // ---------------------------
    // Cliente: marcar pendente (apenas 1 notificação por dia)
    // ---------------------------
    const deveNotificar = await marcarPendente(chatId, msg.body, msg);
    if (deveNotificar) {
      // envia notificações novas para o vendedor (apenas os novos)
      await enviarNotificacoesNovosPendentes();
    }

    // Saudação (apenas 1x por open/closed por dia)
    const saudou = await enviarSaudacaoSeNecessario(chatId);
    if (saudou) return;

    // ========================= FLUXO CLIENTE COMPLETO =========================

    // Adicionar itens
    if (["mais", "bota", "adicionar", "adiciona", "coloca", "acrescenta"].some((t) => texto.includes(t))) {
      await client.sendMessage(chatId, `Perfeito! 😊 Pode me enviar o que mais deseja adicionar ao seu pedido.`);
      estadoCliente[chatId] = "aguardando_item";
      return;
    }
    if (estadoCliente[chatId] === "aguardando_item") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei! Deseja adicionar mais algum item, ou podemos encerrar?`);
      await delay(800);
      await client.sendMessage(chatId, "▶️ Para adicionar mais itens use: Adicionar➕\n▶️ Para encerrar use: Encerrar❌");
      estadoCliente[chatId] = null;
      return;
    }

    // Encerrar pedido -> pergunta tipo (retirada / entrega)
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
        await client.sendMessage(chatId, `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`);
        return;
      } else {
        await client.sendMessage(chatId, `Não entendi, por favor responda "entrega" ou "retirada".`);
        return;
      }
    }

    // Recebeu endereço (salva)
    if (estadoCliente[chatId] === "aguardando_endereco") {
      enderecos[chatId] = msg.body.trim();
      saveJson(END_FILE, enderecos);
      await client.sendMessage(chatId, `Endereço salvo: ${enderecos[chatId]}`);
      estadoCliente[chatId] = "confirmar_orcamento";
      await client.sendMessage(chatId, `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`);
      return;
    }

    // Confirma endereço salvo
    if (estadoCliente[chatId] === "confirma_endereco") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Perfeito! Endereço mantido: ${enderecos[chatId]}`);
      } else if (texto.includes("não") || texto.includes("nao")) {
        await client.sendMessage(chatId, `Ok! Me informe o novo endereço, por favor.`);
        estadoCliente[chatId] = "aguardando_endereco";
        return;
      } else {
        await client.sendMessage(chatId, `Responda "sim" ou "não", por favor.`);
        return;
      }
      estadoCliente[chatId] = "confirmar_orcamento";
      await client.sendMessage(chatId, `📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado`);
      return;
    }

    // Confirmar orçamento
    if (estadoCliente[chatId] === "confirmar_orcamento") {
      if (["tudo certo", "correto", "confirmado", "certo", "ok"].some((t) => texto.includes(t))) {
        await client.sendMessage(chatId, `Perfeito! 😊 Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`);
        estadoCliente[chatId] = null;
        return;
      }
      if (["errado", "tem erro", "faltou", "alterar", "corrigir"].some((t) => texto.includes(t))) {
        await client.sendMessage(chatId, `Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️`);
        estadoCliente[chatId] = "aguardando_alteracao";
        return;
      }
      // se não entende, pede para confirmar
      await client.sendMessage(chatId, `Responda "tudo certo" ou "errado" por favor.`);
      return;
    }

    // Aguardar alteração do orçamento
    if (estadoCliente[chatId] === "aguardando_alteracao") {
      await client.sendMessage(chatId, `Perfeito! 😊 Já anotei: *${msg.body}*`);
      await delay(800);
      await client.sendMessage(chatId, `Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`);
      estadoCliente[chatId] = null;
      return;
    }

    // PAGAMENTOS - PIX
    if (texto.includes("pix")) {
      await client.sendMessage(chatId, `🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO`);
      await delay(800);
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      return;
    }

    // PAGAMENTOS - DINHEIRO (troco)
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
      } else if (texto.includes("não") || texto.includes("nao")) {
        await client.sendMessage(chatId, `Perfeito! Valor já considera desconto à vista.`);
        await delay(800);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
        return;
      } else {
        await client.sendMessage(chatId, `Responda "sim" ou "não", por favor.`);
        return;
      }
    }
    if (estadoCliente[chatId] === "aguardando_valor_troco") {
      await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}. 💵`);
      await delay(800);
      await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      estadoCliente[chatId] = null;
      return;
    }

    // PAGAMENTOS - CARTÃO
    if (texto.includes("cartão") || texto.includes("cartao")) {
      await client.sendMessage(chatId, `Perfeito! Será à vista ou parcelado? 💳`);
      estadoCliente[chatId] = "escolher_cartao";
      return;
    }
    if (estadoCliente[chatId] === "escolher_cartao") {
      if (texto.includes("parcelado")) {
        await client.sendMessage(chatId,
          `💳 Parcelamos em:\n\n▶️*2x para compras acima de R$100*\n▶️*3x acima de R$150*.\n\n*Obs:* Valor parcelado não tem desconto.\nVocê deseja realmente parcelar? (sim/não)`
        );
        estadoCliente[chatId] = "confirmar_parcelamento";
      } else if (texto.includes("à vista") || texto.includes("avista") || texto.includes("a vista")) {
        await client.sendMessage(chatId, `💰 Pagamento à vista confirmado! Valor já inclui desconto especial.`);
        await delay(700);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
        estadoCliente[chatId] = null;
      } else {
        await client.sendMessage(chatId, `Responda "à vista" ou "parcelado".`);
      }
      return;
    }
    if (estadoCliente[chatId] === "confirmar_parcelamento") {
      if (texto.includes("sim")) {
        await client.sendMessage(chatId, `Perfeito! Vamos seguir com o parcelamento. 💳✅`);
        await delay(700);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      } else if (texto.includes("não") || texto.includes("nao")) {
        await client.sendMessage(chatId, `Sem problemas! Vamos continuar no pagamento à vista. 👍`);
        await delay(700);
        await client.sendMessage(chatId, `🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜`);
      } else {
        await client.sendMessage(chatId, `Responda "sim" ou "não", por favor.`);
        return;
      }
      estadoCliente[chatId] = null;
      return;
    }

    // Se nenhuma das condições, você pode expandir aqui
    // Ex.: catálogo, ajuda, falar com vendedor, etc.

  } catch (err) {
    console.error("Erro no handler:", err);
  }
});
