const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

client.on('qr', qr => {
    console.log('===========================================');
    console.log('🟢 ESCANEIE ESSE QR CODE (em texto abaixo):');
    console.log(qr);
    console.log('===========================================');
});

client.on('ready', () => {
    console.log('✅ Bot conectado ao WhatsApp com sucesso!');
});

client.initialize();

app.get('/', (req, res) => res.send('🤖 Bot rodando 24h no Render.'));
app.listen(port, () => console.log(`🚀 Servidor Render ativo na porta ${port}`));

const delay = ms => new Promise(res => setTimeout(res, ms));

async function enviarImagem(numero, caminho, legenda) {
    const media = MessageMedia.fromFilePath(caminho);
    await client.sendMessage(numero, media, { caption: legenda });
}

let estadoCliente = {};

async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda);
        await delay(3000);
    }
}

client.on('message', async msg => {
    const texto = msg.body.trim().toLowerCase();
    const vendedor = ['Davy@c.us'];

    if (
        texto.includes('oi') ||
        texto.includes('ola') ||
        texto.includes('olá') ||
        texto.includes('bom dia') ||
        texto.includes('boa tarde') ||
        texto.includes('boa noite') ||
        texto.includes('davi') ||
        texto.includes('davy')
    ) {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const name = contact.pushname;

        await delay(5000);
        await chat.sendStateTyping();
        await delay(3000);
        await client.sendMessage(msg.from, 'Olá! ' + name.split(" ")[0] + ' 👋 Tudo bem? Seja bem-vindo(a)! 🎉');
        await delay(3000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, '⏳ Líder Festas agradece seu contato! Estamos em atendimento. Aguarde um momento. 💬');
        await delay(3000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, 'Enquanto isso, confira nossas ofertas 👇🏻');

        await enviarVariasImagens(msg.from, [
            { caminho: './imagens/OFERTADASEMANA.png', legenda: '👏🏻Confira nossas ofertas exclusivas! 🎉' },
            { caminho: './imagens/1.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
            { caminho: './imagens/2.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
            { caminho: './imagens/3.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
            { caminho: './imagens/4.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
        ]);

        await delay(12000000);
        await client.sendMessage(msg.from, '🕒 Estamos à disposição caso precise de algo mais!');
    }

    // 🛒 Cliente quer continuar comprando
    if (texto.includes('mais') || texto.includes('adicionar') || texto.includes('adiciona') || texto.includes('coloca') || texto.includes('acrescenta')) {
        await client.sendMessage(msg.from, 'Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido.');
        return;
    }

    // ✅ Cliente quer encerrar
    if (texto.includes('encerrar') || texto.includes('pode encerrar') || texto.includes('só isso') || texto.includes('somente') || texto.includes('encerra')) {
        await client.sendMessage(msg.from, 'Certo! 😊 Só pra confirmar, será *retirada na loja* ou *entrega*?');
        return;
    }

    // 🚚 Cliente escolhe ENTREGA
    if (texto.includes('entrega')) {
        await client.sendMessage(msg.from, 'Perfeito! 🚚 Anotado que será *entrega*.\nEm alguns minutos será enviado o orçamento completo das suas compras. (Respoda com "tudo certo" ou "confirmado"');
        return;
    }

    // 🏬 Cliente escolhe RETIRADA
    if (texto.includes('retirada') || texto.includes('retirar') || texto.includes('buscar')) {
        await client.sendMessage(msg.from, 'Perfeito! 🏬 Anotado que será *retirada na loja*.\nEm alguns minutos será enviado o orçamento completo das suas compras.');
        return;
    }

    // ✅ Confirmação do orçamento
    if (texto.includes('tudo certo') || texto.includes('confirmado')) {
        await client.sendMessage(msg.from, 'Perfeito! 😊 Qual será a forma de pagamento? \n\n💰 *Pix*\n💵 *Dinheiro*\n💳 *Cartão*');
        return;
    }

    // 💸 PIX
    if (texto.includes('pix')) {
        await client.sendMessage(msg.from, '🔑 Chave Pix para pagamento:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO\n\nO valor informado já é com desconto à vista. 💰');
        await delay(3000);
        await client.sendMessage(msg.from, '🙏🎉 Agradecemos pela preferência! Lhe desejamos um ótimo dia. 💜');
        return;
    }

    // 💵 Pagamento em Dinheiro
    if (texto.includes('dinheiro')) {
    await client.sendMessage(msg.from, 'Certo! Deseja que leve troco? 💵 (Responda com "sim" ou "não")');
    estadoCliente[msg.from] = 'perguntou_troco';
    return;
    }

    // 🪙 Cliente confirma que quer troco
    if (texto.includes('sim') && estadoCliente[msg.from] === 'perguntou_troco') {
    await client.sendMessage(msg.from, 'Ok! Pode me informar o valor para o qual precisa de troco? 💰');
    estadoCliente[msg.from] = 'aguardando_valor_troco';
    return;
    }

    // 🚫 Cliente diz que não quer troco
    if (texto.includes('não') && estadoCliente[msg.from] === 'perguntou_troco') {
    await client.sendMessage(msg.from, 'Perfeito! O valor já considera o desconto para pagamento à vista. 💰');
    await delay(2000);
    await client.sendMessage(msg.from, '🙏🎉 Agradecemos pela preferência! Lhe desejamos um ótimo dia. 💜');
    estadoCliente[msg.from] = null;
    return;
    }

    // 💰 Cliente informa o valor do troco
    if (estadoCliente[msg.from] === 'aguardando_valor_troco') {
    await client.sendMessage(msg.from, `Certo! Levaremos troco para ${texto}. 💵`);
    await delay(2000);
    await client.sendMessage(msg.from, '🙏🎉 Agradecemos pela preferência! Lhe desejamos um ótimo dia. 💜');
    estadoCliente[msg.from] = null;
    return;
    }

    // 💳 Cartão
    if (texto.includes('cartão') || texto.includes('cartao')) {
        await client.sendMessage(msg.from, 'Ótimo! Será à vista ou parcelado? 💳');
        return;
    }

    if (texto.includes('parcelado')) {
        await client.sendMessage(msg.from, '💳 Parcelamos em 2x para compras acima de R$100 e em até 3x para valores acima de R$150.\n\nO valor parcelado não tem desconto. 😉');
        await delay(3000);
        await client.sendMessage(msg.from, '🙏🎉 Agradecemos pela preferência! Lhe desejamos um ótimo dia. 💜');
        return;
    }

    if (texto.includes('à vista') || texto.includes('avista') || texto.includes('a vista')) {
        await client.sendMessage(msg.from, '💰 Pagamento à vista confirmado! O valor já inclui o desconto especial. 🎉');
        await delay(3000);
        await client.sendMessage(msg.from, '🙏🎉 Agradecemos pela preferência! Lhe desejamos um ótimo dia. 💜');
        return;
    }
});
