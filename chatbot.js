// ----------------------------
// IMPORTS
// ----------------------------
const qrcode = require("qrcode-terminal");
const { Client, MessageMedia } = require("whatsapp-web.js"); // CommonJS import
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { supabase, salvarSessao, carregarSessao } = require("./supabase"); // arquivo supabase.js

// ----------------------------
// SERVIDOR HTTP
// ----------------------------
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});

app.listen(port, () =>
    console.log(`🌐 Servidor ativo no Railway, porta ${port}`)
);

// ----------------------------
// CLIENTE WHATSAPP
// ----------------------------
const client = new Client({
    authStrategy: undefined, // sessão será carregada pelo Supabase
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
});

client.on("qr", (qr) => {
    console.log("===========================================");
    console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
    console.log(qr);
    console.log("===========================================");
});

client.on("ready", async () => {
    console.log("✅ Bot conectado ao WhatsApp com sucesso!");
    await carregarSessao();
});

client.initialize();

// ----------------------------
// FUNÇÃO DELAY
// ----------------------------
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ----------------------------
// ENVIAR IMAGENS
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
// VARIÁVEIS DE ESTADO
// ----------------------------
let estadoCliente = {};
let enderecos = {}; // endereço em memória para evitar múltiplas perguntas
let ultimoClienteAtivo = null;
let atendimentos = {}; // lista de clientes pendentes

// ----------------------------
// FUNÇÕES AUXILIARES
// ----------------------------
function ensureAtendimento(chatId) {
    if (!atendimentos[chatId]) atendimentos[chatId] = { respondido: false, lastMessage: "", firstContactAt: Date.now() };
}

function marcarPendente(chatId, lastMsg) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = false;
    atendimentos[chatId].lastMessage = lastMsg || "";
}

function marcarAtendido(chatId) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = true;
}

async function enviarListaPendentes(vendedor) {
    const pend = Object.keys(atendimentos).filter(c => !atendimentos[c].respondido);
    if (pend.length === 0) {
        await client.sendMessage(vendedor, "✅ Nenhum cliente pendente no momento.");
        return;
    }
    let texto = "📋 *LISTA DE CLIENTES PENDENTES:*\n\n";
    pend.forEach(c => texto += `• ${c.replace("@c.us", "")} — *PENDENTE*\n`);
    await client.sendMessage(vendedor, texto);
}

// ----------------------------
// FUNÇÕES DE ENDEREÇO
// ----------------------------
async function perguntarEndereco(chatId) {
    if (enderecos[chatId]) {
        await client.sendMessage(chatId, `ℹ️ Já temos este endereço salvo: *${enderecos[chatId]}*\nDeseja alterar ou manter? (Responda: Alterar / Manter)`);
        estadoCliente[chatId] = "confirmar_endereco";
    } else {
        await client.sendMessage(chatId, "📍 Qual é o endereço para entrega?");
        estadoCliente[chatId] = "aguardando_endereco";
    }
}

async function salvarEndereco(chatId, endereco) {
    enderecos[chatId] = endereco;
    // salvar no Supabase
    await supabase.from("enderecos").upsert({ chat_id: chatId, endereco });
}

// ----------------------------
// FLUXO PRINCIPAL
// ----------------------------
client.on("message", async (msg) => {
    try {
        const chat = await msg.getChat();
        if (chat.isGroup) return;

        const chatId = msg.from;
        ultimoClienteAtivo = chatId;
        const texto = (msg.body || "").trim().toLowerCase();

        // MARCAR CLIENTE PENDENTE
        marcarPendente(chatId, msg.body || "");
        await enviarListaPendentes("5588921552690@c.us"); // número do vendedor

        // SAUDAÇÃO
        if (texto.match(/oi|ola|olá|bom dia|boa tarde|boa noite/)) {
            await delay(2000);
            await chat.sendStateTyping();
            await client.sendMessage(chatId, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");
            await delay(2000);
            await chat.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");
            await delay(2000);
            await client.sendMessage(chatId, "Enquanto isso, confira nossas ofertas 👇🏻");

            await enviarVariasImagens(chatId, [
                { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
                { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
                { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" }
            ]);

            await client.sendMessage(chatId, "ℹ️ Como podemos lhe ajudar ?");
            await client.sendMessage(chatId,
                "📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n" +
                "▶️ Para adicionar itens use: Adicionar➕\n" +
                "▶️ Para encerrar use: Encerrar❌"
            );
            return;
        }

        // ADICIONAR ITENS
        if (texto.match(/mais|adicionar|adiciona|coloca|acrescenta/)) {
            await client.sendMessage(chatId, "Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?");
            estadoCliente[chatId] = "aguardando_item";
            return;
        }

        if (estadoCliente[chatId] === "aguardando_item") {
            // aqui pode repetir adicionar/encerrar
            await client.sendMessage(chatId, "Ótimo! Item anotado: " + msg.body);
            estadoCliente[chatId] = null;
            return;
        }

        // ENCERRAR PEDIDO
        if (texto.match(/encerrar|pode encerrar|só isso|somente|encerra/)) {
            await client.sendMessage(chatId, "Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?");
            estadoCliente[chatId] = "aguardando_tipo_entrega";
            return;
        }

        // TIPO ENTREGA/RETIRADA
        if (estadoCliente[chatId] === "aguardando_tipo_entrega") {
            if (texto.includes("entrega")) {
                await perguntarEndereco(chatId);
                estadoCliente[chatId] = "entrega";
            } else if (texto.match(/retirada|retirar|buscar|pegar/)) {
                await client.sendMessage(chatId, "Perfeito! 🏬 Anotado que será *retirada na loja*.");
                await delay(1500);
                await client.sendMessage(chatId,
                    "📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado\n\nAssim podemos finalizar seu pedido. 😉"
                );
                estadoCliente[chatId] = "retirada";
            }
            return;
        }

        // ENDEREÇO ENTREGA
        if (estadoCliente[chatId] === "aguardando_endereco") {
            await salvarEndereco(chatId, msg.body);
            await client.sendMessage(chatId, `Endereço recebido: *${msg.body}*`);
            await delay(1500);
            await client.sendMessage(chatId,
                "📝 Após o envio do orçamento, responda:\n\n✅ Tudo certo\n⚠️ Errado\n\nAssim podemos finalizar seu pedido. 😉"
            );
            estadoCliente[chatId] = "entrega";
            return;
        }

        // CONFIRMAR OU ALTERAR ENDEREÇO
        if (estadoCliente[chatId] === "confirmar_endereco") {
            if (texto.includes("manter")) {
                await client.sendMessage(chatId, `Perfeito! Mantemos o endereço: *${enderecos[chatId]}*`);
            } else if (texto.includes("alterar")) {
                await client.sendMessage(chatId, "📍 Qual é o novo endereço?");
                estadoCliente[chatId] = "aguardando_endereco";
            }
            return;
        }

        // ORÇAMENTO
        if (texto.match(/tudo certo|correto|confirmado/)) {
            await client.sendMessage(chatId, "Perfeito! 😊 Qual será a forma de pagamento?\n\n💰 Pix\n💵 Dinheiro\n💳 Cartão");
            return;
        }

        if (texto.match(/errado|incorreto|ajustar|corrigir|faltou/)) {
            await client.sendMessage(chatId, "Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️");
            estadoCliente[chatId] = "aguardando_alteracao";
            return;
        }

        if (estadoCliente[chatId] === "aguardando_alteracao") {
            await client.sendMessage(chatId, `Perfeito! 😊 Já anotei a alteração: ${msg.body}`);
            await delay(1500);
            await client.sendMessage(chatId, "Agora escolha a forma de pagamento:\n💰 Pix\n💵 Dinheiro\n💳 Cartão");
            estadoCliente[chatId] = null;
            return;
        }

        // PAGAMENTO
        if (texto.includes("pix")) {
            await client.sendMessage(chatId, "🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO");
            return;
        }

        if (texto.includes("dinheiro")) {
            await client.sendMessage(chatId, "💵 Pagamento em dinheiro registrado. Obrigado! 🙏");
            return;
        }

        if (texto.includes("cartão") || texto.includes("cartao")) {
            await client.sendMessage(chatId,
                "💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150.\nObs: Valor parcelado não tem desconto."
            );
            return;
        }

    } catch (err) {
        console.error("Erro no handler de mensagem:", err);
    }
});