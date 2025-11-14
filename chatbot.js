// app.js
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const PERSIST_SESSION = true; // se false, vai forçar QR a cada start

// --- Helper para formatar número (ex: 5511999999999 -> 5511999999999@c.us)
function formatNumber(num) {
    if (!num) return num;
    if (num.endsWith("@c.us")) return num;
    return `${num.replace(/\D/g, "")}@c.us`;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Variável que guardará o client (para permitir recriar)
let client = null;

// Função que cria uma instância do client
function createClient() {
    return new Client({
        authStrategy: new LocalAuth({ clientId: "lider-festas" }),
        puppeteer: {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--no-zygote",
                "--single-process",
                "--disable-setuid-sandbox",
            ],
        },
    });
}

// Função para iniciar (ou reiniciar) o WhatsApp client
async function startClient() {
    if (client) {
        try { await client.destroy(); } catch (e) { /* ignore */ }
        client = null;
        await delay(1000);
    }

    client = createClient();

    client.on("qr", (qr) => {
        console.log("===========================================");
        console.log("🟢 ESCANEIE ESTE QR CODE (em texto):");
        console.log(qr);
        console.log("===========================================");
        // também mostra QR bonito no terminal (se disponível)
        try { qrcode.generate(qr, { small: true }); } catch (e) {}
    });

    client.on("ready", () => {
        console.log("✅ Bot conectado ao WhatsApp com sucesso!");
    });

    client.on("authenticated", (session) => {
        console.log("🔐 Autenticado com sucesso.");
    });

    client.on("auth_failure", (msg) => {
        console.error("❌ Falha de autenticação:", msg);
    });

    client.on("disconnected", (reason) => {
        console.warn("⚠️ Cliente desconectado:", reason);
        // tenta reiniciar em 3s
        setTimeout(() => startClient().catch(console.error), 3000);
    });

    client.on("change_state", (state) => {
        console.log("📶 Estado:", state);
    });

    client.on("message_create", (m) => {
        // log minimal para debug - remova em produção
        console.log("⤵️ Mensagem recebida de:", m.from);
    });

    client.on("error", (err) => {
        console.error("🚨 Erro global do client:", err);
    });

    await client.initialize();
}

// Função enviar imagem com checagem
async function enviarImagem(numero, caminhoRelativo, legenda) {
    const caminho = path.join(__dirname, caminhoRelativo);
    if (!fs.existsSync(caminho)) {
        console.error("❌ Arquivo não encontrado:", caminho);
        return;
    }
    const media = MessageMedia.fromFilePath(caminho);
    await client.sendMessage(formatNumber(numero), media, { caption: legenda });
}

async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda).catch((e) => {
            console.error("Erro enviando imagem:", e);
        });
        await delay(3000);
    }
}

// =====================
// Lógica de conversa (seu fluxo, com try/catch)
// =====================
let estadoCliente = {};
let ultimoPing = Date.now();

async function handleMessage(msg) {
    try {
        const texto = (msg.body || "").trim().toLowerCase();

        // Atualiza ping
        ultimoPing = Date.now();

        // Saudações (mesma lógica sua)
        if (
            texto.includes("oi") ||
            texto.includes("ola") ||
            texto.includes("olá") ||
            texto.includes("bom dia") ||
            texto.includes("boa tarde") ||
            texto.includes("boa noite") ||
            texto.includes("davi") ||
            texto.includes("davy")
        ) {
            const chat = await msg.getChat();
            await delay(2000);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");
            await delay(2500);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");
            await delay(2500);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, "Enquanto isso, confira nossas ofertas 👇🏻");

            await enviarVariasImagens(msg.from, [
                { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
                { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
                { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
            ]);

            await client.sendMessage(msg.from,
                "📝 Nos envie sua lista de pedidos.\n\n➕ Para adicionar itens use: *mais*, *adicionar*, *coloca*, *acrescenta*\n❌ Para encerrar use: *encerrar*, *pode encerrar*, *só isso*, *somente*"
            );
            return;
        }

        // resto do seu fluxo (mantive igual ao seu, com try/catch por segurança)
        if (texto.includes("mais") || texto.includes("adicionar") || texto.includes("adiciona") || texto.includes("coloca") || texto.includes("acrescenta")) {
            await client.sendMessage(msg.from, "Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido.");
            return;
        }

        if (texto.includes("encerrar") || texto.includes("pode encerrar") || texto.includes("só isso") || texto.includes("somente") || texto.includes("encerra")) {
            await client.sendMessage(msg.from, "Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?");
            return;
        }

        if (texto.includes("entrega")) {
            await client.sendMessage(msg.from, "Perfeito! 🚚 Anotado que será *entrega*.\nEm alguns minutos será enviado o orçamento completo.");
            await delay(1500);
            await client.sendMessage(msg.from,
                "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
            );
            return;
        }

        if (texto.includes("retirada") || texto.includes("retirar") || texto.includes("buscar")) {
            await client.sendMessage(msg.from, "Perfeito! 🏬 Anotado que será *retirada na loja*.");
            await delay(1500);
            await client.sendMessage(msg.from,
                "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
            );
            return;
        }

        if (texto.includes("tudo certo") || texto.includes("correto") || texto.includes("confirmado")) {
            await client.sendMessage(msg.from, "Perfeito! 😊 Qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*");
            return;
        }

        if (texto.includes("errado") || texto.includes("tem erro") || texto.includes("faltou") || texto.includes("alterar")) {
            await client.sendMessage(msg.from, "Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️");
            estadoCliente[msg.from] = "aguardando_alteracao";
            return;
        }

        if (estadoCliente[msg.from] === "aguardando_alteracao") {
            await client.sendMessage(msg.from, `Perfeito! 😊 Já anotei que deseja alterar: *${msg.body}*`);
            await delay(2000);
            await client.sendMessage(msg.from, "E qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*");
            estadoCliente[msg.from] = null;
            return;
        }

        if (texto.includes("pix")) {
            await client.sendMessage(msg.from, "🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO");
            await delay(2000);
            await client.sendMessage(msg.from, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            return;
        }

        if (texto.includes("dinheiro")) {
            await client.sendMessage(msg.from, "Certo! Precisa de troco? 💵 (Responda: *sim* ou *não*)");
            estadoCliente[msg.from] = "perguntou_troco";
            return;
        }

        if (texto.includes("sim") && estadoCliente[msg.from] === "perguntou_troco") {
            await client.sendMessage(msg.from, "Ok! Para qual valor precisa de troco? 💰");
            estadoCliente[msg.from] = "aguardando_valor_troco";
            return;
        }

        if (texto.includes("não") && estadoCliente[msg.from] === "perguntou_troco") {
            await client.sendMessage(msg.from, "Perfeito! O valor já considera o desconto à vista. 💰");
            await delay(1500);
            await client.sendMessage(msg.from, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            estadoCliente[msg.from] = null;
            return;
        }

        if (estadoCliente[msg.from] === "aguardando_valor_troco") {
            await client.sendMessage(msg.from, `Certo! Levaremos troco para ${texto}. 💵`);
            await delay(2000);
            await client.sendMessage(msg.from, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            estadoCliente[msg.from] = null;
            return;
        }

        if (texto.includes("cartão") || texto.includes("cartao")) {
            await client.sendMessage(msg.from, "Perfeito! Será à vista ou parcelado? 💳");
            return;
        }

        if (texto.includes("parcelado")) {
            await client.sendMessage(msg.from, "💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150.\n\nObs: Valor parcelado não tem desconto.");
            await delay(2000);
            await client.sendMessage(msg.from, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            return;
        }

        if (texto.includes("à vista") || texto.includes("avista") || texto.includes("a vista")) {
            await client.sendMessage(msg.from, "💰 Pagamento à vista confirmado! O valor já inclui o desconto especial.");
            await delay(2000);
            await client.sendMessage(msg.from, "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            return;
        }

    } catch (err) {
        console.error("Erro no handler de mensagem:", err);
    }
}

// Listener de mensagens centralizado
function setupMessageListener() {
    // remove listeners antigos (caso reinicie)
    client.removeAllListeners("message");
    client.on("message", async (msg) => {
        await handleMessage(msg);
    });

    // ping update
    client.on("message", () => {
        ultimoPing = Date.now();
    });
}

// Sistema de estabilidade (mesma ideia sua, com logs)
setInterval(async () => {
    const agora = Date.now();
    if (agora - ultimoPing > 180000) {
        console.log("🔄 Nenhuma mensagem em 3 minutos. Testando conexão...");
        try {
            await client.sendPresenceAvailable();
            console.log("🟢 WhatsApp respondeu ao ping.");
            ultimoPing = Date.now();
        } catch (e) {
            console.error("❌ WhatsApp não respondeu ao ping, reiniciando client...", e);
            startClient().catch(console.error);
        }
    }
}, 30000);

// Express simples (útil como "keep alive")
app.get("/", (req, res) => {
    res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});

app.listen(port, () => {
    console.log(`🌐 Servidor ativo, porta ${port}`);
});

// Captura erros não tratados
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

// Start inicial
startClient().then(() => {
    // set listeners quando client estiver pronto (com delay pequeno)
    const trySetup = setInterval(() => {
        if (client && client.info) {
            setupMessageListener();
            clearInterval(trySetup);
        }
    }, 1000);
}).catch((e) => {
    console.error("Erro ao iniciar client:", e);
});
