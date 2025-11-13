const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// 🔥 Servidor HTTP para manter o Railway rodando
app.get("/", (req, res) => {
    res.send("🚀 Bot do WhatsApp está rodando no Railway!");
});

app.listen(port, () =>
    console.log(`🌐 Servidor ativo no Railway, porta ${port}`)
);

// 🔥 Inicialização do WhatsApp
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

// Função delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Enviar imagem
async function enviarImagem(numero, caminho, legenda) {
    const media = MessageMedia.fromFilePath(caminho);
    await client.sendMessage(numero, media, { caption: legenda });
}

// Enviar várias imagens em sequência
async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda);
        await delay(3000);
    }
}

let estadoCliente = {};

// 🔥 Todas as respostas do bot
client.on("message", async (msg) => {
    const texto = msg.body.trim().toLowerCase();

    // Saudações
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

        await client.sendMessage(
            msg.from,
            "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉"
        );
        await delay(2500);

        await chat.sendStateTyping();
        await client.sendMessage(
            msg.from,
            "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬"
        );

        await delay(2500);
        await chat.sendStateTyping();

        await client.sendMessage(
            msg.from,
            "Enquanto isso, confira nossas ofertas 👇🏻"
        );

        await enviarVariasImagens(msg.from, [
            {
                caminho: "./imagens/OFERTADASEMANA.png",
                legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉",
            },
            {
                caminho: "./imagens/1.png",
                legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉",
            },
            {
                caminho: "./imagens/2.png",
                legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉",
            },
        ]);

        await client.sendMessage(
            msg.from,
            "📝 Nos envie sua lista de pedidos.\n\n➕ Para adicionar itens use: *mais*, *adicionar*, *coloca*, *acrescenta*\n❌ Para encerrar use: *encerrar*, *pode encerrar*, *só isso*, *somente*"
        );

        return;
    }

    // Cliente quer adicionar
    if (
        texto.includes("mais") ||
        texto.includes("adicionar") ||
        texto.includes("adiciona") ||
        texto.includes("coloca") ||
        texto.includes("acrescenta")
    ) {
        await client.sendMessage(
            msg.from,
            "Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido."
        );
        return;
    }

    // Cliente quer encerrar
    if (
        texto.includes("encerrar") ||
        texto.includes("pode encerrar") ||
        texto.includes("só isso") ||
        texto.includes("somente") ||
        texto.includes("encerra")
    ) {
        await client.sendMessage(
            msg.from,
            "Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?"
        );
        return;
    }

    // ENTREGA
    if (texto.includes("entrega")) {
        await client.sendMessage(
            msg.from,
            "Perfeito! 🚚 Anotado que será *entrega*.\nEm alguns minutos será enviado o orçamento completo."
        );

        await delay(1500);

        await client.sendMessage(
            msg.from,
            "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
        );
        return;
    }

    // RETIRADA
    if (
        texto.includes("retirada") ||
        texto.includes("retirar") ||
        texto.includes("buscar")
    ) {
        await client.sendMessage(
            msg.from,
            "Perfeito! 🏬 Anotado que será *retirada na loja*."
        );

        await delay(1500);

        await client.sendMessage(
            msg.from,
            "📝 Após o envio do orçamento, responda:\n\n✅ *Tudo certo*, *correto*, *confirmado*\n⚠️ *Errado*, *tem erro*, *faltou*, *alterar*\n\nAssim podemos finalizar seu pedido. 😉"
        );
        return;
    }

    // Confirma orçamento
    if (
        texto.includes("tudo certo") ||
        texto.includes("correto") ||
        texto.includes("confirmado")
    ) {
        await client.sendMessage(
            msg.from,
            "Perfeito! 😊 Qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*"
        );
        return;
    }

    // Algo errado no orçamento
    if (
        texto.includes("errado") ||
        texto.includes("tem erro") ||
        texto.includes("faltou") ||
        texto.includes("alterar")
    ) {
        await client.sendMessage(
            msg.from,
            "Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️"
        );
        estadoCliente[msg.from] = "aguardando_alteracao";
        return;
    }

    // Cliente informa alteração
    if (estadoCliente[msg.from] === "aguardando_alteracao") {
        await client.sendMessage(
            msg.from,
            `Perfeito! 😊 Já anotei que deseja alterar: *${msg.body}*`
        );

        await delay(2000);

        await client.sendMessage(
            msg.from,
            "E qual será a forma de pagamento?\n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*"
        );

        estadoCliente[msg.from] = null;
        return;
    }

    // PIX
    if (texto.includes("pix")) {
        await client.sendMessage(
            msg.from,
            "🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO"
        );

        await delay(2000);

        await client.sendMessage(
            msg.from,
            "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
        );
        return;
    }

    // DINHEIRO
    if (texto.includes("dinheiro")) {
        await client.sendMessage(
            msg.from,
            "Certo! Precisa de troco? 💵 (Responda: *sim* ou *não*)"
        );
        estadoCliente[msg.from] = "perguntou_troco";
        return;
    }

    // Quer troco
    if (texto.includes("sim") && estadoCliente[msg.from] === "perguntou_troco") {
        await client.sendMessage(
            msg.from,
            "Ok! Para qual valor precisa de troco? 💰"
        );
        estadoCliente[msg.from] = "aguardando_valor_troco";
        return;
    }

    // Não quer troco
    if (texto.includes("não") && estadoCliente[msg.from] === "perguntou_troco") {
        await client.sendMessage(
            msg.from,
            "Perfeito! O valor já considera o desconto à vista. 💰"
        );

        await delay(1500);

        await client.sendMessage(
            msg.from,
            "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
        );
        estadoCliente[msg.from] = null;
        return;
    }

    // Valor para troco
    if (estadoCliente[msg.from] === "aguardando_valor_troco") {
        await client.sendMessage(
            msg.from,
            `Certo! Levaremos troco para ${texto}. 💵`
        );

        await delay(2000);

        await client.sendMessage(
            msg.from,
            "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
        );

        estadoCliente[msg.from] = null;
        return;
    }

    // Cartão
    if (texto.includes("cartão") || texto.includes("cartao")) {
        await client.sendMessage(
            msg.from,
            "Perfeito! Será à vista ou parcelado? 💳"
        );
        return;
    }

    if (texto.includes("parcelado")) {
        await client.sendMessage(
            msg.from,
            "💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150.\n\nObs: Valor parcelado não tem desconto."
        );

        await delay(2000);

        await client.sendMessage(
            msg.from,
            "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
        );
        return;
    }

    if (
        texto.includes("à vista") ||
        texto.includes("avista") ||
        texto.includes("a vista")
    ) {
        await client.sendMessage(
            msg.from,
            "💰 Pagamento à vista confirmado! O valor já inclui o desconto especial."
        );

        await delay(2000);

        await client.sendMessage(
            msg.from,
            "🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜"
        );
        return;
    }
});
