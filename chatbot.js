import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

import express from 'express';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------
// Supabase
// ----------------------------
const supabaseUrl = 'https://lxvtuyvvnxggshtgzlny.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------------
// Servidor HTTP
// ----------------------------
app.get('/', (req, res) => {
  res.send('🚀 Bot do WhatsApp está rodando!');
});

app.listen(port, () => console.log(`🌐 Servidor ativo na porta ${port}`));

// ----------------------------
// Inicialização do WhatsApp
// ----------------------------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true },
});

client.on('qr', qr => console.log(qr));
client.on('ready', () => console.log('✅ Bot conectado!'));
client.initialize();

// ----------------------------
// Função delay
// ----------------------------
const delay = ms => new Promise(res => setTimeout(res, ms));

// ----------------------------
// Enviar imagens
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
// Variáveis globais
// ----------------------------
let estadoCliente = {};
let atendimentos = {}; // controle de mensagens pendentes

// ----------------------------
// Funções Supabase Endereço
// ----------------------------
async function getEndereco(chatId) {
  const { data, error } = await supabase
    .from('enderecos')
    .select('endereco')
    .eq('chatId', chatId)
    .single();
  if (error) return null;
  return data ? data.endereco : null;
}

async function saveEndereco(chatId, endereco) {
  const { data: exists } = await supabase
    .from('enderecos')
    .select('*')
    .eq('chatId', chatId)
    .single();
  if (exists) {
    await supabase.from('enderecos').update({ endereco }).eq('chatId', chatId);
  } else {
    await supabase.from('enderecos').insert([{ chatId, endereco }]);
  }
}

// ----------------------------
// Lista de pendentes
// ----------------------------
function marcarPendente(chatId, lastMsg) {
  atendimentos[chatId] = { respondido: false, lastMessage: lastMsg };
}

function marcarAtendido(chatId) {
  if (atendimentos[chatId]) atendimentos[chatId].respondido = true;
}

async function enviarListaPendentes() {
  const pendentes = Object.keys(atendimentos).filter(c => !atendimentos[c].respondido);
  if (!pendentes.length) {
    await client.sendMessage('5588921552690@c.us', '✅ Nenhum cliente pendente no momento.');
    return;
  }
  let texto = '📋 *LISTA DE CLIENTES PENDENTES:*\n\n';
  pendentes.forEach(c => texto += `• ${c.replace('@c.us', '')} — *PENDENTE*\n`);
  await client.sendMessage('5588921552690@c.us', texto);
}

// ----------------------------
// Handler principal
// ----------------------------
client.on('message', async msg => {
  const chat = await msg.getChat();
  if (chat.isGroup) return;

  const chatId = chat.id._serialized;
  const texto = (msg.body || '').trim().toLowerCase();
  marcarPendente(chatId, msg.body);
  await enviarListaPendentes();

  // ----------------------
  // Saudação
  // ----------------------
  if (/oi|ola|olá|bom dia|boa tarde|boa noite/.test(texto)) {
    await delay(2000); await chat.sendStateTyping();
    await client.sendMessage(chatId, 'Olá! 👋 Tudo bem? Seja bem-vindo(a)! 🎉');
    await delay(2500); await chat.sendStateTyping();
    await client.sendMessage(chatId, '⏳ Líder Festas agradece por sua preferência! Estamos em atendimento. Aguarde só um momento! 💬');
    await delay(2500); await chat.sendStateTyping();
    await client.sendMessage(chatId, 'Enquanto isso, confira nossas ofertas 👇🏻');
    await enviarVariasImagens(chatId, [
      { caminho: './imagens/OFERTADASEMANA.png', legenda: '👏🏻Confira nossas ofertas exclusivas! 🎉' },
      { caminho: './imagens/1.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
      { caminho: './imagens/2.png', legenda: '👏🏻Gostaria de levar um de nossos produtos? 🎉' },
    ]);
    await client.sendMessage(chatId, 'ℹ️ Como podemos lhe ajudar ?');
    await client.sendMessage(chatId,
      '📝 Caso deseje fazer um pedido envie-nos sua lista.\n\n' +
      '▶️ Para adicionar itens use: Adicionar➕\n' +
      '▶️ Para encerrar use: Encerrar❌'
    );
    return;
  }

  // ----------------------
  // Adicionar itens
  // ----------------------
  if (estadoCliente[chatId] === 'aguardando_item') {
    await client.sendMessage(chatId, 'Perfeito! 😄 Deseja adicionar algo no seu pedido ou podemos encerrar?');
    estadoCliente[chatId] = null;
    return;
  }

  if (/mais|adicionar|adiciona|coloca|acrescenta/.test(texto)) {
    await client.sendMessage(chatId, 'Perfeito! 😄 Pode me enviar o que mais deseja adicionar ao seu pedido.');
    estadoCliente[chatId] = 'aguardando_item';
    return;
  }

  // ----------------------
  // Encerrar pedido
  // ----------------------
  if (/encerrar|pode encerrar|só|só isso|somente/.test(texto)) {
    // Verifica se já existe endereço
    const enderecoSalvo = await getEndereco(chatId);
    if (enderecoSalvo) {
      await client.sendMessage(chatId, `O endereço salvo é: ${enderecoSalvo}. Deseja alterar ou manter?`);
      estadoCliente[chatId] = 'confirma_endereco';
    } else {
      await client.sendMessage(chatId, 'Certo! 😊 Só pra confirmar, será *entrega na loja* ou *retirada*?');
    }
    return;
  }

  // ----------------------
  // Confirmar endereço
  // ----------------------
  if (estadoCliente[chatId] === 'confirma_endereco') {
    if (/alterar/.test(texto)) {
      await client.sendMessage(chatId, 'Ok! Por favor informe o novo endereço:');
      estadoCliente[chatId] = 'novo_endereco';
    } else if (/manter/.test(texto)) {
      await client.sendMessage(chatId, 'Perfeito! Seguindo com o endereço salvo.');
      estadoCliente[chatId] = null;
    }
    return;
  }

  if (estadoCliente[chatId] === 'novo_endereco') {
    await saveEndereco(chatId, msg.body);
    await client.sendMessage(chatId, `Endereço atualizado para: ${msg.body}`);
    estadoCliente[chatId] = null;
    return;
  }

  // ----------------------
  // Entrega / Retirada
  // ----------------------
  if (/entrega/.test(texto)) {
    const enderecoSalvo = await getEndereco(chatId);
    if (enderecoSalvo) {
      await client.sendMessage(chatId, `O endereço salvo é: ${enderecoSalvo}. Deseja alterar ou manter?`);
      estadoCliente[chatId] = 'confirma_endereco';
    } else {
      await client.sendMessage(chatId, 'Qual o endereço para entrega?');
      estadoCliente[chatId] = 'novo_endereco';
    }
    return;
  }

  if (/retirada|retirar|buscar|pegar/.test(texto)) {
    await client.sendMessage(chatId, 'Perfeito! 🏬 Será retirada na loja.');
    return;
  }

  // ----------------------
  // Orçamento
  // ----------------------
  if (/tudo certo|correto|confirmado/.test(texto)) {
    await client.sendMessage(chatId, 'Perfeito! 😊 Qual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão');
    return;
  }

  if (/errado|incorreto|ajustar|corrigir|faltou/.test(texto)) {
    await client.sendMessage(chatId, 'Certo! 😅 Me informe o que deseja alterar no orçamento.');
    estadoCliente[chatId] = 'aguardando_alteracao';
    return;
  }

  if (estadoCliente[chatId] === 'aguardando_alteracao') {
    await client.sendMessage(chatId, `Perfeito! 😊 Já anotei: ${msg.body}\nQual será a forma de pagamento?\n💰 Pix\n💵 Dinheiro\n💳 Cartão`);
    estadoCliente[chatId] = null;
    return;
  }

  // ----------------------
  // Pagamento
  // ----------------------
  if (/pix/.test(texto)) {
    await client.sendMessage(chatId, '🔑 Chave Pix: 📱 CNPJ: 49.093.600/0001-30\nNAYANDRA KELLY H SANTIAGO');
    return;
  }

  if (/dinheiro/.test(texto)) {
    await client.sendMessage(chatId, '💵 Pagamento em dinheiro registrado.');
    return;
  }

  if (/cartão|cartao/.test(texto)) {
    await client.sendMessage(chatId, '💳 Parcelamento disponível: 2x acima de R$100, 3x acima de R$150. Valor parcelado não tem desconto.');
    return;
  }
});