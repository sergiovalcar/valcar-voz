#!/usr/bin/env node
// scripts/reintroduzir-permissoes-do-texto.mjs — a conferência de sabotagem do guarda novo.
//
// Roda em CÓPIA, nunca na árvore principal: a casa já perdeu uma rodada por isso. E ela
// FALHA quando a substituição não muda o arquivo — mutante sem alvo "passa" e se lê como
// "a suíte parou de morder", que é o instrumento mentindo sobre o próprio trabalho.
//
// A rodada de CONTROLE vem primeiro: base vermelha faz todo mutante "morder" por motivo
// nenhum.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const TESTE = 'test/permissoesQueOTextoPromete.test.js';

const DEFEITOS = [
  {
    nome: '⚠️ o texto promete `update_pull_request_branch` e a lista não tem (o defeito real de 24/09)',
    arquivo: '.claude/settings.json',
    de: '      "mcp__github__update_pull_request_branch",\n',
    para: '',
  },
  {
    // direção, 24/09: "não quero que peça permissão nem mesmo os que alteram" — o defeito
    // agora é o contrário: a linha sair do allow e o banco voltar a pedir.
    nome: 'execute_sql volta a pedir permissão',
    arquivo: '.claude/settings.json',
    de: '      "mcp__Supabase__execute_sql",\n      "mcp__Supabase__list_tables",',
    para: '      "mcp__Supabase__list_tables",',
  },
  {
    nome: 'git fetch sai do ask e volta ao padrão não declarado',
    arquivo: '.claude/settings.json',
    de: '      "Bash(git fetch*)",\n      "Bash(git push*)",',
    para: '      "Bash(git push*)",',
  },
  {
    nome: '⚠️ a varredura para de casar e "nenhum ausente" vira "não conferi nada"',
    arquivo: TESTE,
    de: "/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g",
    para: "/`(zzz[a-z0-9_]+)`/g",
  },
];

function suitePassa(dir) {
  try {
    execFileSync('node', ['--test', TESTE], { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const base = mkdtempSync(path.join(tmpdir(), 'perm-sabotagem-'));
cpSync(path.join(RAIZ, '.claude'), path.join(base, '.claude'), { recursive: true });
cpSync(path.join(RAIZ, 'test', path.basename(TESTE)), path.join(base, TESTE), {
  recursive: false,
  force: true,
  errorOnExist: false,
});

try {
  if (!suitePassa(base)) {
    console.log('✖ RODADA DE CONTROLE VERMELHA: a base já falha, nenhum mutante prova nada.');
    process.exit(1);
  }
  console.log(`Base verde (${DEFEITOS.length} defeitos a reintroduzir).`);

  let falhou = false;
  for (const d of DEFEITOS) {
    const alvo = path.join(base, d.arquivo);
    const antes = readFileSync(alvo, 'utf8');
    const depois = antes.replace(d.de, d.para);
    if (depois === antes) {
      console.log(`PADRÃO VELHO   ${d.nome}\n   → não achei o trecho em ${d.arquivo}: o arquivo saiu intacto, este mutante não conferiu nada`);
      falhou = true;
      continue;
    }
    writeFileSync(alvo, depois);
    const mordeu = !suitePassa(base);
    writeFileSync(alvo, antes);
    console.log(`${mordeu ? 'MORDE  ' : '✖ PASSOU'}   ${d.nome}`);
    if (!mordeu) falhou = true;
  }
  process.exit(falhou ? 1 : 0);
} finally {
  rmSync(base, { recursive: true, force: true });
}
