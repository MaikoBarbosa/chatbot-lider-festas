// supabase.js (ESM)
import { createClient } from '@supabase/supabase-js';
import fs from 'fs-extra';

const supabaseUrl = 'https://lxvtuyvvnxggshtgzlny.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Salvar sessão WhatsApp
export async function salvarSessao() {
  if (!fs.existsSync('.wwebjs_auth')) return;
  const files = fs.readdirSync('.wwebjs_auth');
  for (const file of files) {
    const data = fs.readFileSync(`.wwebjs_auth/${file}`);
    await supabase.storage.from('whatsapp-session').upload(file, data, { upsert: true });
  }
  console.log('Sessão salva no Supabase ✅');
}

// Carregar sessão WhatsApp
export async function carregarSessao() {
  const { data } = await supabase.storage.from('whatsapp-session').list();
  if (!data) return;

  if (!fs.existsSync('.wwebjs_auth')) fs.mkdirSync('.wwebjs_auth');
  for (const file of data) {
    const { data: fileData } = await supabase.storage.from('whatsapp-session').download(file.name);
    const buffer = Buffer.from(await fileData.arrayBuffer());
    fs.writeFileSync(`.wwebjs_auth/${file.name}`, buffer);
  }
  console.log('Sessão carregada do Supabase ✅');
}

// Funções para salvar/recuperar endereço
export async function salvarEndereco(chatId, endereco) {
  await supabase.from('enderecos').upsert({ chat_id: chatId, endereco });
}

export async function buscarEndereco(chatId) {
  const { data } = await supabase.from('enderecos').select('endereco').eq('chat_id', chatId).single();
  return data?.endereco || null;
}