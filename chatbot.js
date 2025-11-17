const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------
// Servidor HTTP para Railway
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
// Persistência simples (JSON)
// ----------------------------
const DATA_DIR = __dirname;
const ATEND_FILE = path.join(DATA_DIR, "atendimentos.json");
const SAU_FILE = path.join(DATA_DIR, "saudacoes.json");
const END_FILE = path.join(DATA_DIR, "enderecos.json");

function loadJson(file, fallback = {}) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file)); }
    catch(e){ console.error("Erro lendo", file, e); }
    return fallback;
}

function saveJson(file, obj){
    try{ fs.writeFileSync(file, JSON.stringify(obj,null,2)); }
    catch(e){ console.error("Erro gravando", file, e); }
}

let atendimentos = loadJson(ATEND_FILE, {});
let saudacoes = loadJson(SAU_FILE, {});
let enderecos = loadJson(END_FILE, {});

// ----------------------------
// Variáveis globais
// ----------------------------
let estadoCliente = {};
let ultimoClienteAtivo = null;
const VENDEDOR_CHAT = "5588921552690@c.us"; 
const delay = ms => new Promise(res=>setTimeout(res, ms));
const sentByBot = new Set();

// ----------------------------
// Envio de mensagens rastreadas
// ----------------------------
async function sendMessageAndTrack(chatId, content, options={}) {
    const sent = await client.sendMessage(chatId, content, options);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(()=>sentByBot.delete(id), 30*1000);
    } catch(e){}
    return sent;
}

async function sendMediaAndTrack(chatId, media, opts={}) {
    const sent = await client.sendMessage(chatId, media, opts);
    try {
        const id = sent.id._serialized;
        sentByBot.add(id);
        setTimeout(()=>sentByBot.delete(id), 30*1000);
    } catch(e){}
    return sent;
}

// ----------------------------
// Envio de imagens
// ----------------------------
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
function ensureAtendimento(chatId){
    if(!atendimentos[chatId]){
        atendimentos[chatId] = { respondido:false, lastMessage:"", firstContactAt: Date.now() };
        saveJson(ATEND_FILE, atendimentos);
    }
}

function marcarPendente(chatId, lastMsg){
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = false;
    atendimentos[chatId].lastMessage = lastMsg?String(lastMsg).slice(0,200):"";
    atendimentos[chatId].firstContactAt = atendimentos[chatId].firstContactAt||Date.now();
    saveJson(ATEND_FILE, atendimentos);
}

function marcarAtendido(chatId){
    ensureAtendimento(chatId);
    atendimentos[chatId].respondido = true;
    saveJson(ATEND_FILE, atendimentos);
}

// Enviar lista pendentes para o vendedor
async function enviarListaPendentes(){
    const pend = Object.keys(atendimentos).filter(c=>!atendimentos[c].respondido);
    if(pend.length===0){
        await sendMessageAndTrack(VENDEDOR_CHAT, "✅ Nenhum cliente pendente no momento.");
        return;
    }
    let texto = "📋 *LISTA DE CLIENTES PENDENTES:*\n\n";
    pend.forEach(c=>{
        const last = atendimentos[c].lastMessage?` — ${atendimentos[c].lastMessage}`:"";
        texto += `• ${c.replace("@c.us","")}${last}\n`;
    });
    await sendMessageAndTrack(VENDEDOR_CHAT, texto);
}

// ----------------------------
// Saudação automática
// ----------------------------
function getHorarioInfo(date=new Date()){
    const weekday = date.getDay();
    const h = date.getHours();
    const m = date.getMinutes();
    const minutos = h*60+m;
    const toMin = (hh,mm)=>hh*60+mm;
    let openStart=null, openEnd=null, open=false;

    if(weekday>=1 && weekday<=5){ openStart=toMin(7,30); openEnd=toMin(17,30); }
    else if(weekday===6){ openStart=toMin(7,30); openEnd=toMin(13,0); }

    if(openStart!==null) open = minutos>=openStart && minutos<openEnd;

    const yyyy=date.getFullYear();
    const mm = String(date.getMonth()+1).padStart(2,"0");
    const dd = String(date.getDate()).padStart(2,"0");
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const periodKey = open?`open:${dateKey}`:`closed:${dateKey}`;
    return { open, periodKey };
}

const MSG_FORA_HORARIO = `Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉
⏳ Líder Festas agradece por sua preferência!
⚠️ No momento não estamos disponíveis.
✅ Horário de funcionamento:
⏰ 7:30 às 17:30 hrs, de segunda a sexta-feira;
⏰ 7:30 às 13:00 hrs, aos sábados;
⏰ Fechado aos domingos.`;

async function enviarSaudacaoSeNecessario(chatId){
    const info = getHorarioInfo(new Date());
    const pk = info.periodKey;
    saudacoes[chatId] = saudacoes[chatId]||{};
    if(saudacoes[chatId][pk]) return false;

    saudacoes[chatId][pk] = true;
    saveJson(SAU_FILE, saudacoes);

    const chat = await client.getChatById(chatId);
    if(info.open){
        await delay(2000); await chat.sendStateTyping();
        await sendMessageAndTrack(chatId, "Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉");
        await delay(2500); await chat.sendStateTyping();
        await sendMessageAndTrack(chatId, "⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬");
        await delay(2500); await chat.sendStateTyping();
        await sendMessageAndTrack(chatId, "Enquanto isso, confira nossas ofertas 👇🏻");
        await enviarVariasImagens(chatId, [
            { caminho:"./imagens/OFERTADASEMANA.png", legenda:"👏🏻Confira nossas ofertas exclusivas! 🎉" },
            { caminho:"./imagens/1.png", legenda:"👏🏻Gostaria de levar um de nossos produtos? 🎉" },
            { caminho:"./imagens/2.png", legenda:"👏🏻Gostaria de levar um de nossos produtos? 🎉" },
        ]);
        await sendMessageAndTrack(chatId,
`ℹ️ Como podemos lhe ajudar ?
📝 Caso deseje fazer um pedido envie-nos sua lista.
▶️ Para adicionar itens use: Adicionar➕
▶️ Para encerrar use: Encerrar❌`
        );
    } else {
        await sendMessageAndTrack(chatId, MSG_FORA_HORARIO);
    }
    return true;
}

// ----------------------------
// Função parcelamento cartão
// ----------------------------
async function enviarOpcaoParcelamento(msg){
    const chatId = msg.from;
    await client.sendMessage(chatId,
        "💳 Parcelamos em *2x para compras acima de R$100* e *3x acima de R$150*.\n\n" +
        "⚠️ *Obs:* Valor parcelado não tem desconto.\n\n" +
        "Você realmente deseja parcelar? \n\n" +
        "👉 *Responda:* SIM ou NÃO"
    );
    const handler = async (resposta)=>{
        if(resposta.from!==chatId) return;
        const txt = resposta.body.trim().toLowerCase();
        if(txt==="sim") await client.sendMessage(chatId,"Perfeito! Vamos seguir com o parcelamento. 💳✅");
        if(txt==="não"||txt==="nao") await client.sendMessage(chatId,"Sem problemas! Vamos continuar no pagamento à vista. 👍");
        client.removeListener("message", handler);
    };
    client.on("message", handler);
}

// ----------------------------
// Handler principal de mensagens
// ----------------------------
client.on("message", async msg=>{
    try{
        const chat = await msg.getChat();
        if(chat.isGroup) return;

        const chatId = chat.id._serialized;
        const texto = (msg.body||"").trim().toLowerCase();
        ultimoClienteAtivo = chatId;

        // =======================
        // Resposta do vendedor (humano)
        // =======================
        if(msg.fromMe){
            const maybeId = msg.id && msg.id._serialized;
            if(maybeId && sentByBot.has(maybeId)){ sentByBot.delete(maybeId); return; }

            try{
                let clienteRespondido = null;
                if(msg.hasQuotedMsg){
                    const quoted = await msg.getQuotedMessage();
                    clienteRespondido = quoted.from;
                } else if(ultimoClienteAtivo){
                    clienteRespondido = ultimoClienteAtivo;
                }
                if(clienteRespondido){
                    marcarAtendido(clienteRespondido);
                    await enviarListaPendentes();
                    console.log(`✅ Cliente ${clienteRespondido} marcado como respondido por humano`);
                }
            }catch(e){ console.error("Erro ao processar resposta humana:", e); }
            return;
        }

        // -----------------------------
        // Mensagem do cliente
        // -----------------------------
        marcarPendente(chatId, msg.body||"");
        await enviarListaPendentes();
        const sentGreeting = await enviarSaudacaoSeNecessario(chatId);
        if(sentGreeting) return;

        // -----------------------------
        // Fluxo de adicionar/encerrar
        // -----------------------------
        if(["mais","adicionar","adiciona","coloca","acrescenta"].some(t=>texto.includes(t))){
            await client.sendMessage(chatId,"Perfeito! 😄 Pode me enviar o que deseja adicionar ao seu pedido.");
            estadoCliente[chatId] = "aguardando_item";
            return;
        }

        if(estadoCliente[chatId]==="aguardando_item"){
            await client.sendMessage(chatId,`Perfeito! 😊 Já anotei: *${msg.body}*`);
            await delay(1500);
            await client.sendMessage(chatId,
`➕ Para adicionar mais itens use: *mais*, *adicionar*, *coloca*, *acrescenta*
❌ Para encerrar seu pedido use: *encerrar*, *pode encerrar*, *só isso*, *somente*`);
            estadoCliente[chatId] = null;
            return;
        }

        if(["encerrar","pode encerrar","só isso","somente","encerra"].some(t=>texto.includes(t))){
            // Verificar se endereço salvo
            if(!enderecos[chatId]) estadoCliente[chatId] = "solicitar_endereco";
            else estadoCliente[chatId] = "confirmar_endereco";
            await client.sendMessage(chatId,"Certo! 😊 Será *retirada na loja* ou *entrega*?");
            return;
        }

        // -----------------------------
        // Fluxo ENTREGA / ENDEREÇO
        // -----------------------------
        if(estadoCliente[chatId]==="solicitar_endereco" && texto.includes("entrega")){
            await client.sendMessage(chatId,"Perfeito! 🚚 Anotado que será entrega. Qual o endereço para entrega?");
            estadoCliente[chatId] = "aguardando_endereco";
            return;
        }

        if(estadoCliente[chatId]==="aguardando_endereco"){
            enderecos[chatId] = msg.body;
            saveJson(END_FILE, enderecos);
            estadoCliente[chatId] = "confirmar_orcamento";
            await client.sendMessage(chatId,
`Endereço salvo: ${msg.body}
📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`);
            return;
        }

        if(estadoCliente[chatId]==="confirmar_endereco"){
            await client.sendMessage(chatId,`O endereço salvo é: ${enderecos[chatId]}\nDeseja alterar? Responda: SIM ou NÃO`);
            estadoCliente[chatId]="alterar_endereco";
            return;
        }

        if(estadoCliente[chatId]==="alterar_endereco"){
            if(texto==="sim"){
                await client.sendMessage(chatId,"Por favor, informe o novo endereço:");
                estadoCliente[chatId]="aguardando_endereco";
            } else {
                estadoCliente[chatId]="confirmar_orcamento";
                await client.sendMessage(chatId,
`📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`);
            }
            return;
        }

        // ----------------------------
        // CONFIRMAR ORÇAMENTO
        // ----------------------------
        if(estadoCliente[chatId]==="confirmar_orcamento"){
            if(["tudo certo","correto","confirmado"].some(t=>texto.includes(t))){
                estadoCliente[chatId] = null;
                await client.sendMessage(chatId,"Perfeito! 😊 Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão");
                return;
            }
            if(["errado","tem erro","faltou","alterar"].some(t=>texto.includes(t))){
                estadoCliente[chatId] = "aguardando_alteracao";
                await client.sendMessage(chatId,"Certo! 😅 Me informe o que deseja alterar no orçamento. ✏️");
                return;
            }
        }

        if(estadoCliente[chatId]==="aguardando_alteracao"){
            await client.sendMessage(chatId,`Perfeito! 😊 Já anotei: *${msg.body}*`);
            await delay(1500);
            estadoCliente[chatId] = "confirmar_orcamento";
            await client.sendMessage(chatId,
`📝 Após o envio do orçamento, responda:
✅ Tudo certo
⚠️ Errado
Assim podemos finalizar seu pedido. 😉`);
            return;
        }

        // ----------------------------
        // PAGAMENTOS
        // ----------------------------
        if(texto.includes("pix")){
            await client.sendMessage(chatId,
"🔑 Chave Pix:\n📱 *CNPJ: 49.093.600/0001-30*\nNAYANDRA KELLY H SANTIAGO");
            await delay(2000);
            await client.sendMessage(chatId,"🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            return;
        }

        if(texto.includes("dinheiro")){
            await client.sendMessage(chatId,"Certo! Precisa de troco? 💵 (Responda: *sim* ou *não*)");
            estadoCliente[chatId]="perguntou_troco";
            return;
        }

        if(estadoCliente[chatId]==="perguntou_troco"){
            if(texto==="sim"){
                await client.sendMessage(chatId,"Ok! Para qual valor precisa de troco? 💰");
                estadoCliente[chatId]="aguardando_valor_troco";
            } else {
                await client.sendMessage(chatId,"Perfeito! O valor já considera o desconto à vista. 💰");
                await delay(1500);
                await client.sendMessage(chatId,"🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
                estadoCliente[chatId]=null;
            }
            return;
        }

        if(estadoCliente[chatId]==="aguardando_valor_troco"){
            await client.sendMessage(chatId,`Certo! Levaremos troco para ${msg.body}. 💵`);
            await delay(1500);
            await client.sendMessage(chatId,"🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜");
            estadoCliente[chatId]=null;
            return;
        }

        if(texto.includes("cartão")||texto.includes("cartao")){
            estadoCliente[chatId]= "pag_cartao";
            await client.sendMessage(chatId,"Perfeito! Será à vista ou parcelado? 💳");
            return;
        }

        if(estadoCliente[chatId]==="pag_cartao"){
            if(texto.includes("parcelado")){
                estadoCliente[chatId]=null;
                await enviarOpcaoParcelamento(msg);
                return;
            }
            if(["à vista","avista","a vista"].some(t=>texto.includes(t))){
                await client.sendMessage(chatId,"💰 Pagamento à vista confirmado! O