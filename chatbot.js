// ----------------------------
// Módulos
// ----------------------------
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ----------------------------
// Supabase
// ----------------------------
const supabaseUrl = 'https://lxvtuyvvnxggshtgzlny.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function salvarEndereco(chatId, endereco) {
    await supabase.from('enderecos').upsert({ chatId, endereco });
}

async function pegarEndereco(chatId) {
    const { data } = await supabase.from('enderecos').select('endereco').eq('chatId', chatId).single();
    return data ? data.endereco : null;
}

// ----------------------------
// Servidor HTTP (Railway mantém ativo)
// ----------------------------
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🚀 Bot do WhatsApp rodando no Railway!'));
app.listen(port, () => console.log(`🌐 Servidor ativo na porta ${port}`));

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', qr => console.log('QR CODE:\n', qr));
client.on('ready', () => console.log('✅ Bot conectado ao WhatsApp'));
client.initialize();

// ----------------------------
// Persistência simples
// ----------------------------
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, 'atendimentos.json');
const SAU_FILE = path.join(DATA_DIR, 'saudacoes.json');

function loadJson(file, fallback = {}) {
    try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback; }
    catch(e){ console.error('Erro lendo', file, e); return fallback; }
}

function saveJson(file, obj) {
    try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
    catch(e){ console.error('Erro gravando', file, e); }
}

let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});
let estadoCliente = {};
let ultimoClienteAtivo = null;
const VENDEDOR_CHAT = '5588921552690@c.us';
const delay = ms => new Promise(res => setTimeout(res, ms));
const sentByBot = new Set();

// ----------------------------
// Funções utilitárias
// ----------------------------
async function sendMessageAndTrack(chatId, content, options = {}) {
    const sent = await client.sendMessage(chatId, content, options);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(() => sentByBot.delete(id), 30 * 1000);
    } catch {}
    return sent;
}

async function sendMediaAndTrack(chatId, media, opts = {}) {
    const sent = await client.sendMessage(chatId, media, opts);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(() => sentByBot.delete(id), 30 * 1000);
    } catch {}
    return sent;
}

async function enviarImagem(numero, caminho, legenda) {
    const media = MessageMedia.fromFilePath(caminho);
    await sendMediaAndTrack(numero, media, { caption: legenda });
}

async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda);
        await delay(3000);
    }
}

// ----------------------------
// Gestão de atendimentos
// ----------------------------
function ensureAtendimento(chatId) {
    if (!atendimentos[chatId]) {
        atendimentos[chatId] = { respondido: false, lastMessage: "", firstContactAt: Date.now() };
        saveJson(ATEND_FILE, atendimentos);
    }
}

function marcarPendente(chatId, lastMsg) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = false;
    atendimentos[chatId].lastMessage = lastMsg ? String(lastMsg).slice(0,200) : "";
    saveJson(ATEND_FILE, atendimentos);
}

function marcarAtendido(chatId) {
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = true;
    saveJson(ATEND_FILE, atendimentos);
}

async function enviarListaPendentes() {
    const pend = Object.keys(atendimentos).filter(c => !atendimentos[c].respondido);
    if (!pend.length) return sendMessageAndTrack(VENDEDOR_CHAT, "✅ Nenhum cliente pendente.");
    let texto = "📋 *CLIENTES PENDENTES:*\n\n";
    pend.forEach(c => texto += `• ${c.replace("@c.us","")} — *PENDENTE*\n`);
    await sendMessageAndTrack(VENDEDOR_CHAT, texto);
}

// ----------------------------
// Handler de mensagens
// ----------------------------
client.on('message', async msg => {
    try {
        const chat = await msg.getChat();
        if (chat.isGroup) return;
        const chatId = chat.id._serialized;
        const texto = (msg.body || "").trim().toLowerCase();
        ultimoClienteAtivo = chatId;

        // Resposta humana
        if (msg.fromMe) {
            const maybeId = msg.id && msg.id._serialized;
            if (maybeId && sentByBot.has(maybeId)) {
                sentByBot.delete(maybeId);
                return;
            }
        }

        // Marcar pendente
        marcarPendente(chatId, msg.body);

        // Saudação (3h)
        const agora = Date.now();
        const saudacaoData = saudacoes[chatId] || 0;
        if ((texto.includes("oi") || texto.includes("ola") || texto.includes("olá") || texto.includes("bom dia") || texto.includes("boa tarde") || texto.includes("boa noite")) && agora - saudacaoData > 3*60*60*1000) {
            saudacoes[chatId] = agora;
            saveJson(SAU_FILE, saudacoes);

            await delay(2000); await chat.sendStateTyping();
            await client.sendMessage(chatId, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");
            await delay(2500); await chat.sendStateTyping();
            await client.sendMessage(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");
            await delay(2500); await chat.sendStateTyping();

            await client.sendMessage(chatId, "Enquanto isso, confira nossas ofertas 👇🏻");
            await enviarVariasImagens(chatId, [
                { caminho: "./imagens/OFERTADASEMANA.png", legenda: "👏🏻Confira nossas ofertas exclusivas! 🎉" },
                { caminho: "./imagens/1.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" },
                { caminho: "./imagens/2.png", legenda: "👏🏻Gostaria de levar um de nossos produtos? 🎉" }
            ]);

            // Bloco adicional
            await client.sendMessage(chatId, "ℹ️ Como podemos lhe ajudar ?");
            await client.sendMessage(chatId,
                "📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n" +
                "▶️ Para adicionar itens use: Adicionar➕\n" +
                "▶️ Para encerrar use: Encerrar❌"
            );
        }

        // Aqui seguem todas as funções: adicionar, encerrar, entrega, retirada, orçamento, Pix, Dinheiro, Cartão
        // Endereço com Supabase, manter ou alterar
        if (texto.includes("entrega")) {
            let enderecoSalvo = await pegarEndereco(chatId);
            if (enderecoSalvo) {
                await client.sendMessage(chatId, `O endereço salvo é:\n${enderecoSalvo}\nDeseja alterar ou manter?`);
                estadoCliente[chatId] = "confirmar_endereco";
            } else {
                await client.sendMessage(chatId, "Qual o endereço para entrega?");
                estadoCliente[chatId] = "aguardando_endereco";
            }
            return;
        }

        if (estadoCliente[chatId] === "aguardando_endereco") {
            await salvarEndereco(chatId, msg.body);
            await client.sendMessage(chatId, "Endereço salvo com sucesso! ✅");
            estadoCliente[chatId] = null;
            return;
        }

        if (estadoCliente[chatId] === "confirmar_endereco") {
            if (texto.includes("alterar")) {
                await client.sendMessage(chatId, "Ok! Qual o novo endereço?");
                estadoCliente[chatId] = "aguardando_endereco";
                return;
            }
            await client.sendMessage(chatId, "Endereço mantido ✅");
            estadoCliente[chatId] = null;
            return;
        }

        // Aqui você insere as funções de adicionar, encerrar, retirada, orçamento, pagamento como já combinamos
        // (o restante do fluxo segue igual aos códigos anteriores, mantendo lista de clientes pendentes e marcações)
        
    } catch(err) {
        console.error("Erro no handler:", err);
    }
});