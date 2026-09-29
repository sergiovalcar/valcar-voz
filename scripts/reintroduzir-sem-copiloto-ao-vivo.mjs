#!/usr/bin/env node
// Conferência por REINTRODUÇÃO da saída do copiloto ao vivo (direção, 29/09) — põe cada defeito
// de volta, UM DE CADA VEZ, e exige que a suíte falhe NUM TESTE DE VERDADE (um `not ok` com
// nome, lido do resumo do TAP — não do código de saída, que também sai diferente de zero quando
// o arquivo nem carrega).
//
// ⚠️ RODA NUMA CÓPIA DESCARTÁVEL (`git archive HEAD | tar -x` + link do node_modules), nunca na
// árvore de trabalho: o arquivo fica mutado no disco entre a aplicação e a restauração.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const COMANDO = 'node --test test/semCopilotoAoVivo.test.js';
const DEFEITOS = [
  // ⚠️ o que este conserto mais teme: tirar a ponte levar a gravação junto
  ['server.js', '⚠️ a ligação recebida deixa de ser gravada (a análise no Conversas some)',
   '    c.gravador = criarGravador(OpusScript); // grava no servidor (é a transcrição da análise no Conversas)\n\n',
   '    c.gravador = null;\n\n'],
  ['gravador.js', '⚠️ o gravador deixa de juntar as amostras (o WAV sai vazio)',
   '      if (idx + nSamp > len[perna]) len[perna] = idx + nSamp;', '      if (false) len[perna] = idx + nSamp;'],
  ['gravador.js', 'a mistura perde a voz de uma das pernas',
   '(i < len.operador ? bufs.operador[i] : 0)', '0'],
  // a ponte tentando voltar
  ['gravador.js', '⚠️ o gravador volta a ter um destino a mais para o áudio (o gancho da ponte)',
   'export function criarGravador(Opus, agora = Date.now) {', 'export function criarGravador(Opus, aoDecodificar, agora = Date.now) {'],
  ['server.js', '⚠️ o servidor volta a abrir a ponte do copiloto',
   'import { criarGravador } from "./gravador.js";', 'import { criarGravador } from "./gravador.js";\nconst abrirCopiloto = () => null;'],
  ['server.js', 'a sugestão volta a ser devolvida ao navegador',
   'import { criarGravador } from "./gravador.js";', 'import { criarGravador } from "./gravador.js";\nconst _s = (ws, sug) => ws.send(JSON.stringify({ tipo: "copiloto", sugestao: sug }));'],
];

function rodar() {
  let saida;
  try { saida = execSync(COMANDO, { stdio: 'pipe', encoding: 'utf8' }); }
  catch (e) { saida = `${e?.stdout || ''}\n${e?.stderr || ''}`; }
  const num = (re) => { const m = re.exec(saida); return m ? Number(m[1]) : null; };
  const nomes = [...saida.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
    .filter((n) => !n.endsWith('.js') && !/#\s*TODO\b/i.test(n));
  return { testes: num(/^# tests (\d+)$/m), falharam: num(/^# fail (\d+)$/m), nomes };
}

const base = rodar();
if (base.testes === null || base.falharam === null) { console.log('✖ A LINHA DE BASE NÃO RODOU'); process.exit(1); }
if (base.falharam > 0) { console.log(`✖ A LINHA DE BASE ESTÁ VERMELHA (${base.falharam} de ${base.testes})`); process.exit(1); }
console.log(`· linha de base verde: ${base.testes} testes`);

let falhou = 0;
for (const [arquivo, nome, de, para] of DEFEITOS) {
  const original = readFileSync(arquivo, 'utf8');
  const mutado = original.replace(de, para);
  if (mutado === original) { console.log(`✖ ${nome} — O PADRÃO NÃO CASOU: a conferência não conferiu nada`); falhou += 1; continue; }
  let r;
  try { writeFileSync(arquivo, mutado); r = rodar(); } finally { writeFileSync(arquivo, original); }
  if (r.falharam > 0 && r.nomes.length) console.log(`✔ ${nome} — pego por: ${r.nomes.join(' · ')}`);
  else if (r.falharam > 0) { console.log(`✖ ${nome} — FALHOU SEM NOMEAR UM TESTE`); falhou += 1; }
  else { console.log(`✖ ${nome} — A SUÍTE PASSOU com o defeito de volta`); falhou += 1; }
}
process.exit(falhou ? 1 : 0);
