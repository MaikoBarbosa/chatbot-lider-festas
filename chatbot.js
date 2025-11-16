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

app.listen(port, () =>
    console.log(`🌐 Servidor ativo no Railway, porta ${port}`)
);

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
    },
});

client.on("qr", (qr) => {
    console.log("===========================================");
    console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
    console.log(qr);
    console.log("===========================================");
});

client.on("ready", () => {
    console.log("✅ Bot conectado ao WhatsApp com sucesso!");
});

client.initialize();

// ----------------------------
// Persistência simples (JSON)
// ----------------------------
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, "atendimentos.json");
const SAU_FILE = path.join(DATA_DIR, "saudacoes.json");

function loadJson(file, fallback = {}) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file));
        }
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

let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});

// ----------------------------
// Utilitários
// ----------------------------
const VENDEDOR_CHAT = "5588921552690@c.us"; // número do vendedor
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const sentByBot = new Set();

async function sendMessageAndTrack(chatId, content, options = {}) {
    const sent = await client.sendMessage(chatId, content, options);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(() => sentByBot.delete(id), 30 * 1000);
    } catch (e) {}
    return sent;
}

async function sendMediaAndTrack(chatId, media, opts = {}) {
    const sent = await client.sendMessage(chatId, media, opts);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(() => sentByBot.delete(id), 30 * 1000);
    } catch (e) {}
    return sent;
}

// Enviar imagem
async function enviarImagem(numero, caminho, legenda) {
    const media = MessageMedia.fromFilePath(caminho);
    await sendMediaAndTrack(numero, media, { caption: legenda });
}

// Enviar várias imagens
async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda);
        await delay(3000);
    }
}

// ----------------------------
// Helpers de horário / período
// ----------------------------
function getHorarioInfo(date = new Date()) {
    const weekday = date.getDay();
    const h = date.getHours();
    const m = date.getMinutes();
    const minutos = h * 60 + m;
    const toMin = (hh, mm) => hh * 60 + mm;

    let openStart = null;
    let openEnd = null;
    let open = false;

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

    return { open, openStart, openEnd, weekday, periodKey };
}

// ----------------------------
// Gestão de atendimentos
// ----------------------------
function ensureAtendimento(chatId) {
    if (!atendimentos[chatId]) {
        atendimentos[chatId] = {
            respondido: false,
            lastMessage: "",
            firstContactAt: Date.now(),
        };
        saveJson(ATEND_FILE, atendimentos);
    }
}

function marcarPendente(chatId, lastMsg) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = false;
    atendimentos[chatId].lastMessage = lastMsg ? String(lastMsg).slice(0, 200) : "";
    atendimentos[chatId].firstContactAt = atendimentos[chatId].firstContactAt || Date.now();
    saveJson(ATEND_FILE, atendimentos);
}

function marcarAtendido(chatId) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = true;
    saveJson(ATEND_FILE, atendimentos);
}

async function enviarListaPendentes() {
    const pend = Object.keys(atendimentos).filter((c) => !atendimentos[c].respondido);
    if (pend.length === 0) {
        await sendMessageAndTrack(VENDEDOR_CHAT, "✅ Nenhum cliente pendente no momento.");
        return;
    }

    let texto = "📋 *LISTA DE CLIENTES PENDENTES:*\n\n";
    pend.forEach((c) => {
        const last = atendimentos[c].lastMessage ? ` — ${atendimentos[c].lastMessage}` : "";
        texto += `• ${c.replace("@c.us", "")}${last}\n`;
    });

    await sendMessageAndTrack(VENDEDOR_CHAT, texto);
}

// ----------------------------
// Mensagem fora do horário
const MSG_FORA_HORARIO =
`Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉
⏳ Líder Festas agradece por sua preferência!
⚠️ No momento não estamos disponíveis.
✅ Horário de funcionamento:
⏰ 7:30 às 17:30 hrs, de segunda a sexta-feira;
⏰ 7:30 às 13:00 hrs, aos sábados;
⏰ Fechado aos domingos.`;

// 🔴 🔴 🔴 DESATIVANDO A FUNÇÃO DE FORA DO HORÁRIO 🔴 🔴 🔴
// Basta comentar todo o bloco abaixo:

// async function enviarForaHorarioSeNecessario(chatId) {
//     const info = getHorarioInfo(new Date());
//     if (!info.open) {
//         await sendMessageAndTrack(chatId, MSG_FORA_HORARIO);
//         return true; // enviou mensagem
//     }
//     return false; // não enviou nada
// }

// Agora essa função não funciona mais, mas o BOT continua funcionando normalmente.
async function enviarForaHorarioSeNecessario(chatId) {
    return false; // sempre libera o fluxo como se estivesse dentro do horário
}

// ----------------------------
// Variáveis globais
// ----------------------------
let estadoCliente = {};
let ultimoClienteAtivo = null;

// ----------------------------
// Handler principal de mensagens
// ----------------------------
client.on("message", async (msg) => {
    try {
        const chat = await msg.getChat();

        if (chat.isGroup) return; // ignora mensagens de grupo

        // =======================
        // DETECÇÃO DE RESPOSTA HUMANA (Vendedor)
        // =======================
        if (msg.fromMe) {
            const maybeId = msg.id && msg.id._serialized;
            if (maybeId && sentByBot.has(maybeId)) {
                sentByBot.delete(maybeId);
                return;
            }

            try {
                let clienteRespondido = null;
                if (msg.hasQuotedMsg) {
                    const quoted = await msg.getQuotedMessage();
                    clienteRespondido = quoted.from;
                } else if (ultimoClienteAtivo) {
                    clienteRespondido = ultimoClienteAtivo;
                }

                if (clienteRespondido) {
                    marcarAtendido(clienteRespondido);
                    await enviarListaPendentes();
                    console.log(`✅ Cliente ${clienteRespondido} marcado como respondido por humano`);
                }
            } catch (e) {
                console.error("Erro ao processar resposta humana:", e);
            }
            return;
        }

        // -----------------------------
        // Mensagem vinda de cliente
        // -----------------------------
        const chatId = chat.id._serialized;
        const texto = (msg.body || "").trim().toLowerCase();
        ultimoClienteAtivo = chatId;

        marcarPendente(chatId, msg.body || "");
        await enviarListaPendentes();

        // Mensagem fora do horário
        const enviouForaHorario = await enviarForaHorarioSeNecessario(chatId);
        if (enviouForaHorario) return; // se enviou mensagem de fora do horário, interrompe fluxo

        // -----------------------------
        // Fluxo normal de saudação e pedidos dentro do horário
        // -----------------------------
        if (
            texto.includes("oi") || texto.includes("ola") || texto.includes("olá") ||
            texto.includes("bom dia") || texto.includes("boa tarde") || texto.includes("boa noite") ||
            texto.includes("davi") || texto.includes("davy")
        ) {
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
            await client.sendMessage(chatId,
                "📝 Envie-nos sua lista de pedido.\n\n➕ Para adicionar mais itens use:\n\n▶️ *mais*, *adicionar*, *coloca*, *acrescenta*\n\n❌ Para encerrar use:\n\n▶️ *encerrar*, *pode encerrar*, *só*, *só isso*, *somente*"
            );
            return;
        }

        // -----------------------------
        // Fluxo de pedidos
        // -----------------------------
        if (texto.includes("mais") || texto.includes("adicionar") || texto.includes("adiciona") ||
            texto.includes("coloca") || texto.includes("acrescenta")) {
            await client.sendMessage(chatId, "Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido.");
            estadoCliente[chatId] = "aguardando_item";
            return;
        }

        if (estadoCliente[chatId] === "aguardando_item") {
            await client.sendMessage(chatId, `Perfeito! 😊 Já anotei que deseja adicionar: *${msg.body}*`);
            await delay(1500);
            await client.sendMessage(chatId,
                "➕ Para adicionar mais itens use:\n\n▶️ *mais*, *adicionar*, *coloca*, *acrescenta*\n\n❌ Para encerrar seu pedido use:\n\n▶️ *encerrar*, *pode encerrar*, *só isso*, *somente*"
            );
            estadoCliente[chatId] = null;
            return;
        }

        if (texto.includes("encerrar") || texto.includes("pode encerrar") || texto.includes("só isso") ||
            texto.includes("somente") || texto.includes("encerra")) {
            await client.sendMessage(chatId, "Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?");
            return;
        }

        if (texto.includes("entrega")) {
            await client.sendMessage(chatId,
                "Perfeito! 🚚 Anotado que será *entrega*.\nEm alguns minutos será enviado o orçamento completo."
            );
            await delay(1500);
            await client.sendMessage(chatId,
                "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
            );
            return;
        }

        if (texto.includes("retirada") || texto.includes("retirar") || texto.includes("buscar")) {
            await client.sendMessage(chatId,
                "Perfeito! 🏬 Anotado que será *retirada na loja*."
            );
            await delay(1500);
            await client.sendMessage(chatId,
                "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
            );
            return;
        }

        if (texto.includes("tudo certo") || texto.includes("correto") || texto.includes("confirmado")) {
            await client.sendMessage(chatId,
                "Perfeito! 😊 Qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*"
            );
            return;
        }

        if (texto.includes("errado") || texto.includes("tem erro") || texto.includes("faltou") || texto.includes("alterar")) {
            await client.sendMessage(chatId, "Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️");
            estadoCliente[chatId] = "aguardando_alteracao";
            return;
        }

        if (estadoCliente[chatId] === "aguardando_alteracao") {
            await client.sendMessage(chatId, `Perfeito! 😊 Já anotei que deseja alterar: *${msg.body}*`);
            await delay(2000);
            await client.sendMessage(chatId,
                "E qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*"
            );
            estadoCliente[chatId] = null;
            return;
        }

        if (texto.includes("pix")) {
            await client.sendMessage(chatId,
                "🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO"
            );
            await delay(2000);
            await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            return;
        }

        if (texto.includes("dinheiro")) {
            await client.sendMessage(chatId, "Certo! Precisa de troco? 💵 (Responda: *sim* ou *não*)");
            estadoCliente[chatId] = "perguntou_troco";
            return;
        }

        if (estadoCliente[chatId] === "perguntou_troco") {
            if (texto.includes("sim")) {
                await client.sendMessage(chatId, "Ok! Para qual valor precisa de troco? 💰");
                estadoCliente[chatId] = "aguardando_valor_troco";
                return;
            } else if (texto.includes("não") || texto.includes("nao")) {
                await client.sendMessage(chatId, "Perfeito! O valor já considera o desconto à vista. 💰");
                await delay(1500);
                await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
                estadoCliente[chatId] = null;
                return;
            }
        }

        if (estadoCliente[chatId] === "aguardando_valor_troco") {
            await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}. 💵`);
            await delay(2000);
            await client.sendMessage(chatId, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            estadoCliente[chatId] = null;
            return;
        }

        if (texto.includes("cartão") || texto.includes("cartao")) {
            await client.sendMessage(chatId,
                "Perfeito! Será à vista ou parcelado? 💳"
            );
            return;
        }

        if (texto.includes("parcelado")) {
            await client.sendMessage(chatId,
                "💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150.\n\nObs: Valor parcelado não tem desconto."
            );
            await delay(2000);
            await client.sendMessage(chatId,
                "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
            );
            return;
        }

        if (texto.includes("à vista") || texto.includes("avista") || texto.includes("a vista")) {
            await client.sendMessage(chatId,
                "💰 Pagamento à vista confirmado! O valor já inclui o desconto especial."
            );
            await delay(2000);
            await client.sendMessage(chatId,
                "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
            );
            return;
        }

    } catch (err) {
        console.error("Erro no handler de mensagem:", err);
    }
});