// ----------------------------
// supabase.js
// ----------------------------
import { createClient } from "@supabase/supabase-js";

// URL do seu projeto Supabase
const supabaseUrl = "https://lxvtuyvvnxggshtgzlny.supabase.co";
// Chave vindo da variável de ambiente no Railway
const supabaseKey = process.env.SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------------
// Função para salvar ou atualizar endereço
// ----------------------------
export async function salvarEndereco(chatId, endereco) {
  try {
    await supabase
      .from("enderecos")
      .upsert({ chat_id: chatId, endereco: endereco });
    console.log(`Endereço salvo para ${chatId}: ${endereco}`);
  } catch (err) {
    console.error("Erro ao salvar endereço:", err);
  }
}

// ----------------------------
// Função para carregar todos os endereços
// ----------------------------
export async function carregarEnderecos() {
  const enderecos = {};
  try {
    const { data, error } = await supabase.from("enderecos").select("*");
    if (error) {
      console.error("Erro ao carregar endereços:", error);
      return enderecos;
    }
    if (data) {
      data.forEach((item) => {
        enderecos[item.chat_id] = item.endereco;
      });
    }
  } catch (err) {
    console.error("Erro ao carregar endereços:", err);
  }
  return enderecos;
}