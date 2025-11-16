import { createClient } from '@supabase/supabase-js'
import fs from 'fs-extra'

// URL do seu projeto Supabase
const supabaseUrl = 'https://lxvtuyvvnxggshtgzlny.supabase.co'
// A chave vem da variável de ambiente no Railway
const supabaseKey = process.env.SUPABASE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

// ==========================
// Sessão WhatsApp
// ==========================

// Função para salvar a sessão do WhatsApp no Supabase
export async function salvarSessao() {
    if (!fs.existsSync('.wwebjs_auth')) return

    const files = fs.readdirSync('.wwebjs_auth')
    for (const file of files) {
        const filePath = `.wwebjs_auth/${file}`
        const data = fs.readFileSync(filePath)
        await supabase.storage.from('whatsapp-session').upload(file, data, { upsert: true })
    }
    console.log('Sessão salva no Supabase ✅')
}

// Função para carregar a sessão do Supabase
export async function carregarSessao() {
    const { data } = await supabase.storage.from('whatsapp-session').list()
    if (!data) return

    if (!fs.existsSync('.wwebjs_auth')) fs.mkdirSync('.wwebjs_auth')

    for (const file of data) {
        const { data: fileData } = await supabase.storage.from('whatsapp-session').download(file.name)
        const buffer = Buffer.from(await fileData.arrayBuffer())
        fs.writeFileSync(`.wwebjs_auth/${file.name}`, buffer)
    }
    console.log('Sessão carregada do Supabase ✅')
}

// ==========================
// Endereços de entrega
// ==========================

// Salvar ou atualizar endereço do cliente
export async function salvarEndereco(chatId, endereco) {
    const { data, error } = await supabase
        .from('enderecos')
        .upsert({ id: chatId, endereco })
    if (error) console.error('Erro ao salvar endereço:', error)
    return data
}

// Buscar endereço de um cliente
export async function buscarEndereco(chatId) {
    const { data, error } = await supabase
        .from('enderecos')
        .select('endereco')
        .eq('id', chatId)
        .single()
    if (error) return null
    return data?.endereco || null
}