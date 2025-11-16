import { createClient } from '@supabase/supabase-js'
import fs from 'fs-extra'
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import express from 'express'
import path from 'path'

const __dirname = path.resolve()

// ---------------- Supabase ----------------
const supabaseUrl = 'https://lxvtuyvvnxggshtgzlny.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function salvarSessao() {
    if (!fs.existsSync('.wwebjs_auth')) return
    const files = fs.readdirSync('.wwebjs_auth')
    for (const file of files) {
        const data = fs.readFileSync(`.wwebjs_auth/${file}`)
        await supabase.storage.from('whatsapp-session').upload(file, data, { upsert: true })
    }
}

async function carregarSessao() {
    const { data } = await supabase.storage.from('whatsapp-session').list()
    if (!data) return
    if (!fs.existsSync('.wwebjs_auth')) fs.mkdirSync('.wwebjs_auth')
    for (const file of data) {
        const { data: fileData } = await supabase.storage.from('whatsapp-session').download(file.name)
        const buffer = Buffer.from(await fileData.arrayBuffer())
        fs.writeFileSync(`.wwebjs_auth/${file.name}`, buffer)
    }
}

// ---------------- Express ----------------
const app = express()
const port = process.env.PORT || 3000
app.get('/', (req, res) => res.send('🚀 Bot do WhatsApp rodando!'))
app.listen(port, () => console.log(`🌐 Servidor ativo na porta ${port}`))

// ---------------- WhatsApp ----------------
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true }
})

client.on('qr', qr => console.log('QR Code:\n', qr))
client.on('ready', () => console.log('✅ Bot conectado ao WhatsApp'))

await carregarSessao()
client.initialize()

// ---------------- Utilitários ----------------
const delay = ms => new Promise(res => setTimeout(res, ms))
const VENDEDOR_CHAT = '5588921552690@c.us'
const DATA_DIR = __dirname
const ATEND_FILE = path.join(DATA_DIR, 'atendimentos.json')
const SAU_FILE = path.join(DATA_DIR, 'saudacoes.json')

function loadJson(file, fallback = {}) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file))
    } catch (e) { console.error('Erro lendo', file, e) }
    return fallback
}
function saveJson(file, obj) {
    try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)) } catch (e) { console.error('Erro gravando', file, e) }
}

let atendimentos = loadJson(ATEND_FILE, {})
let saudacoes = loadJson(SAU_FILE, {})
let estadoCliente = {}
let ultimoClienteAtivo = null

async function sendMessageAndTrack(chatId, content, options = {}) {
    const sent = await client.sendMessage(chatId, content, options)
    return sent
}

async function enviarImagem(numero, caminho, legenda) {
    const media = MessageMedia.fromFilePath(caminho)
    await sendMessageAndTrack(numero, media, { caption: legenda })
}

async function enviarVariasImagens(numero, imagens) {
    for (const item of imagens) {
        await enviarImagem(numero, item.caminho, item.legenda)
        await delay(3000)
    }
}

function ensureAtendimento(chatId) {
    if (!atendimentos[chatId]) {
        atendimentos[chatId] = { respondido: false, lastMessage: '', firstContactAt: Date.now() }
        saveJson(ATEND_FILE, atendimentos)
    }
}

function marcarPendente(chatId, lastMsg) {
    ensureAtendimento(chatId)
    atendimentos[chatId].respondido = false
    atendimentos[chatId].lastMessage = lastMsg ? String(lastMsg).slice(0, 200) : ''
    saveJson(ATEND_FILE, atendimentos)
}

function marcarAtendido(chatId) {
    ensureAtendimento(chatId)
    atendimentos[chatId].respondido = true
    saveJson(ATEND_FILE, atendimentos)
}

async function enviarListaPendentes() {
    const pend = Object.keys(atendimentos).filter(c => !atendimentos[c].respondido)
    if (pend.length === 0) {
        await sendMessageAndTrack(VENDEDOR_CHAT, '✅ Nenhum cliente pendente no momento.')
        return
    }
    let texto = '📋 *LISTA DE CLIENTES PENDENTES:*\n\n'
    pend.forEach(c => texto += `• ${c.replace('@c.us', '')} — *PENDENTE*\n`)
    await sendMessageAndTrack(VENDEDOR_CHAT, texto)
}

// ---------------- Supabase Endereço ----------------
async function salvarEndereco(chatId, endereco) {
    const { error } = await supabase
        .from('enderecos')
        .upsert({ chatId, endereco })
    if (error) console.error('Erro ao salvar endereço:', error)
}
async function carregarEndereco(chatId) {
    const { data, error } = await supabase
        .from('enderecos')
        .select('endereco')
        .eq('chatId', chatId)
        .single()
    if (error) return null
    return data?.endereco || null
}

// ---------------- Handler de mensagens ----------------
client.on('message', async msg => {
    try {
        const chat = await msg.getChat()
        if (chat.isGroup) return
        const chatId = chat.id._serialized
        const texto = (msg.body || '').trim().toLowerCase()
        ultimoClienteAtivo = chatId

        // ---------------- Saudação ----------------
        const agora = Date.now()
        const saudacaoData = saudacoes[chatId] || 0
        if ((texto.includes('oi') || texto.includes('ola') || texto.includes('olá') ||
            texto.includes('bom dia') || texto.includes('boa tarde') || texto.includes('boa noite')) &&
            agora - saudacaoData > 3*60*60*1000) { // 3 horas
            saudacoes[chatId] = agora
            saveJson(SAU_FILE, saudacoes)

            await delay(2000); await chat.sendStateTyping()
            await client.sendMessage(chatId, 'Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉')
            await delay(2500); await chat.sendStateTyping()
            await client.sendMessage(chatId, '⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬')
            await delay(2500); await chat.sendStateTyping()
            await client.sendMessage(chatId, 'Enquanto isso, confira nossas ofertas 👇🏻')
            await enviarVariasImagens(chatId, [
                { caminho: './imagens/OFERTADASEMANA.png', legenda: '👏🏻Confira nossas ofertas exclusivas! 🎉' },
                { caminho: './imagens/1.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
                { caminho: './imagens/2.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
            ])
            await client.sendMessage(chatId, 'ℹ️ Como podemos lhe ajudar ?')
            await client.sendMessage(chatId,
                '📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n' +
                '▶️ Para adicionar itens use: Adicionar➕\n' +
                '▶️ Para encerrar use: Encerrar❌'
            )
        }

        // ---------------- Adicionar Item ----------------
        if (estadoCliente[chatId] === 'aguardando_item') {
            await client.sendMessage(chatId, 'Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?')
            estadoCliente[chatId] = null
        }

        if (texto.includes('mais') || texto.includes('adicionar') || texto.includes('adiciona') ||
            texto.includes('coloca') || texto.includes('acrescenta')) {
            estadoCliente[chatId] = 'aguardando_item'
            await client.sendMessage(chatId, 'Perfeito! 😄 Pode me enviar o que deseja adicionar.')
            return
        }

        // ---------------- Encerrar pedido ----------------
        if (texto.includes('encerrar') || texto.includes('pode encerrar') ||
            texto.includes('só') || texto.includes('só isso') || texto.includes('somente')) {
            // Verificar endereço
            let endereco = await carregarEndereco(chatId)
            if (endereco) {
                await client.sendMessage(chatId, `Certo! 😊 Endereço atual: ${endereco}\nDeseja alterar ou manter?`)
                estadoCliente[chatId] = 'confirma_endereco'
            } else {
                await client.sendMessage(chatId, 'Certo! 😊 Qual o endereço para entrega?')
                estadoCliente[chatId] = 'aguardando_endereco'
            }
            return
        }

        // ---------------- Endereço ----------------
        if (estadoCliente[chatId] === 'aguardando_endereco') {
            await salvarEndereco(chatId, msg.body)
            await client.sendMessage(chatId, `Endereço salvo: ${msg.body}`)
            await client.sendMessage(chatId, '📝 Após o envio do orçamento, responda:\n✅ Tudo certo\n⚠️ Errado\nAssim podemos finalizar seu pedido. 😉')
            estadoCliente[chatId] = null
            return
        }

        if (estadoCliente[chatId] === 'confirma_endereco') {
            if (texto.includes('alterar')) {
                await client.sendMessage(chatId, 'Por favor, informe o novo endereço:')
                estadoCliente[chatId] = 'aguardando_endereco'
            } else {
                await client.sendMessage(chatId, 'Ótimo! Mantemos o endereço salvo.')
                await client.sendMessage(chatId, '📝 Após o envio do orçamento, responda:\n✅ Tudo certo\n⚠️ Errado\nAssim podemos finalizar seu pedido. 😉')
                estadoCliente[chatId] = null
            }
            return
        }

        // ---------------- Orçamento ----------------
        if (texto.includes('tudo certo') || texto.includes('correto') || texto.includes('confirmado')) {
            await client.sendMessage(chatId, 'Perfeito! 😊 Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão')
            return
        }

        if (texto.includes('errado') || texto.includes('incorreto') || texto.includes('ajustar') || texto.includes('corrigir') || texto.includes('faltou')) {
            await client.sendMessage(chatId, 'Certo! 😅 Me informe o que deseja alterar no pedido. ✏️')
            estadoCliente[chatId] = 'aguardando_alteracao'
            return
        }

        if (estadoCliente[chatId] === 'aguardando_alteracao') {
            await client.sendMessage(chatId, `Anotado: ${msg.body}`)
            await client.sendMessage(chatId, 'Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão')
            estadoCliente[chatId] = null
            return
        }

        // ---------------- Pagamentos ----------------
        if (texto.includes('pix')) {
            await client.sendMessage(chatId, '🔑 Chave Pix:\n📱 CNPJ: 49.093.600/0001-30\nNAYANDRA KELLY H SANTIAGO')
            await delay(2000)
            await client.sendMessage(chatId, '🙏🎉 Agradecemos pela preferência! Tenha um ótimo dia! 💜')
            return
        }

        if (texto.includes('dinheiro')) {
            await client.sendMessage(chatId, 'Certo! Precisa de troco? 💵 (sim/não)')
            estadoCliente[chatId] = 'perguntou_troco'
            return
        }

        if (estadoCliente[chatId] === 'perguntou_troco') {
            if (texto.includes('sim')) {
                await client.sendMessage(chatId, 'Ok! Para qual valor precisa de troco? 💰')
                estadoCliente[chatId] = 'aguardando_valor_troco'
            } else {
                await client.sendMessage(chatId, 'Perfeito! 💰')
                estadoCliente[chatId] = null
            }
            return
        }

        if (estadoCliente[chatId] === 'aguardando_valor_troco') {
            await client.sendMessage(chatId, `Certo! Levaremos troco para ${msg.body}. 💵`)
            estadoCliente[chatId] = null
            return
        }

        if (texto.includes('cartão') || texto.includes('cartao')) {
            await client.sendMessage(chatId, 'Perfeito! Será à vista ou parcelado? 💳')
            return
        }

        if (texto.includes('parcelado')) {
            await client.sendMessage(chatId, '💳 Parcelamos em 2x para compras acima de R$100 e 3x para valores acima de R$150. Obs: Valor parcelado não tem desconto.')
            estadoCliente[chatId] = null
            return
        }

        if (texto.includes('à vista') || texto.includes('avista') || texto.includes('a vista')) {
            await client.sendMessage(chatId, '💰 Pagamento à vista confirmado! O valor já inclui o desconto especial.')
            estadoCliente[chatId] = null
            return
        }

        // ---------------- Marcar pendente ----------------
        marcarPendente(chatId, msg.body)
        await enviarListaPendentes()

    } catch (err) {
        console.error('Erro no handler de mensagem:', err)
    }
})