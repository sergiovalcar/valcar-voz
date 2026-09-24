// test/permissoesQueOTextoPromete.test.js — o texto e a lista não podem discordar.
//
// ⚠️ O ARQUIVO AFIRMAVA UMA PROTEÇÃO QUE A CONFIGURAÇÃO NÃO TINHA. `PERMISSOES.md` dizia,
// com todas as letras, que `update_pull_request_branch` "VEIO PARA CÁ" — e ele tinha saído
// do `allow` sem entrar em `ask` nenhum. Ficou assim desde o conserto que o anunciou, e
// nada pegou: JSON não aceita comentário, então o texto é o único lugar onde a decisão
// mora, e ninguém confere o texto contra a lista.
//
// É a classe que este repositório já pagou duas vezes no mesmo arquivo — a guarda do
// `git fetch` por forma exata, que prometia "não cabe argumento a mais" e não respondia a
// pergunta que importa. **Texto que promete a regra não é a regra**, e o preço é maior que
// o da regra ausente: quem lê o texto PARA DE PROCURAR.
//
// A régua é o FATO e não uma lista à mão de nomes (regra 4): todo identificador de
// ferramenta que o texto cita entre crases tem de existir em ALGUMA das três listas. A
// ferramenta nova citada amanhã já nasce cobrada, sem ninguém lembrar deste teste.
//
// Medido em 24/09: 7 identificadores citados, 7 nas listas, ZERO falso positivo — o
// denominador é o que diz que a varredura de fato varre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(`../.claude/${p}`, import.meta.url), 'utf8');

const texto = ler('PERMISSOES.md');
const permissoes = JSON.parse(ler('settings.json')).permissions;
const listados = [...permissoes.allow, ...permissoes.ask, ...permissoes.deny];

// A cauda é o que o texto cita: ninguém escreve `mcp__github__push_files` no meio da frase.
const caudas = new Set(
  listados.filter((n) => n.startsWith('mcp__')).map((n) => n.split('__').pop()),
);
const nomesInteiros = new Set(listados);

// Identificador com cara de ferramenta: snake_case entre crases, com ao menos um `_`.
const citados = [...texto.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
const citadosInteiros = [...texto.matchAll(/`(mcp__[A-Za-z0-9_]+)`/g)].map((m) => m[1]);

test('toda ferramenta que o TEXTO cita existe em alguma lista', () => {
  const ausentes = [...new Set(citados)].filter((n) => !caudas.has(n));
  assert.deepEqual(
    ausentes,
    [],
    `PERMISSOES.md cita ferramenta que NÃO está em allow/ask/deny: ${ausentes.join(', ')}. ` +
      'Ou a linha faltou na configuração, ou o texto afirma proteção que não existe.',
  );
});

test('o nome inteiro citado no texto também está listado', () => {
  const ausentes = [...new Set(citadosInteiros)].filter((n) => !nomesInteiros.has(n));
  assert.deepEqual(ausentes, [], `citados por inteiro e fora das listas: ${ausentes.join(', ')}`);
});

// ⚠️ SEM DENOMINADOR, "nenhum ausente" se lê igual a "não achei nada para conferir" — que é
// o que aconteceria se a regex parasse de casar depois de uma reescrita do texto.
test('a varredura de fato varre — denominador mínimo', () => {
  assert.ok(
    new Set(citados).size >= 5,
    `só ${new Set(citados).size} identificadores citados; a varredura provavelmente parou de casar`,
  );
});

// ⚠️ O ACHADO DE 23/09 EM UMA LINHA: sair do `allow` é o PADRÃO da ferramenta, não uma regra
// declarada — e padrão não se defende quando outra lista, fora deste arquivo, passar a
// cobrir a operação. As três operações que o parecer nomeou entram por ESCRITO.
test('as operações que o parecer nomeou estão escritas — e execute_sql onde a direção mandou', () => {
  assert.ok(permissoes.ask.includes('mcp__github__update_pull_request_branch'), 'update_pull_request_branch precisa estar escrito em ask');
  assert.ok(!permissoes.allow.includes('mcp__github__update_pull_request_branch'), 'update_pull_request_branch não pode voltar para allow');
  // `execute_sql` (direção, 24/09): "Não quero que peça permissão nem mesmo os que alteram.
  // Já está autorizado desde já." Decisão dela, cobrada aqui para ninguém devolver a linha a
  // `ask` achando que ficou esquecida. `apply_migration` segue em `deny`.
  assert.ok(permissoes.allow.includes('mcp__Supabase__execute_sql'), 'execute_sql está em allow por decisão da direção');
  assert.ok(!permissoes.ask.includes('mcp__Supabase__execute_sql'), 'execute_sql em ask voltaria a pedir permissão');
  assert.ok(permissoes.deny.includes('mcp__Supabase__apply_migration'), 'apply_migration continua em deny');
  assert.ok(
    permissoes.ask.some((n) => n.startsWith('Bash(git fetch')),
    'git fetch precisa estar escrito em ask',
  );
  assert.ok(
    !permissoes.allow.some((n) => n.startsWith('Bash(git fetch')),
    'nenhuma forma de git fetch pode voltar para allow',
  );
});
