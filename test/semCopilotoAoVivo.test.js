// test/semCopilotoAoVivo.test.js — a ligação de WhatsApp não abre mais a ponte do copiloto ao
// vivo, e a GRAVAÇÃO (que é a transcrição e a análise no Conversas) continua.
//
// Direção, 29/09: *"O item 3, copiloto ao vivo que sugere o que dizer, eu quero desativar. Não
// vamos mais precisar dessa função no nosso sistema."* Saíram `copiloto.js` (a ponte que falava
// o protocolo do Twilio com o serviço de voz do robô e devolvia a sugestão ao navegador) e
// `mulaw.js` (o codec que só a ponte usava), com o teste dele.
//
// ⚠️ O QUE ESTE TESTE MAIS GUARDA É O QUE NÃO SAIU: o gravador recebia o mesmo PCM que ia para a
// ponte. Tirar a ponte não pode tirar a gravação — é dela que o Conversas transcreve e analisa a
// ligação (`/voz/gravacao`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { criarGravador, TAXA_GRAV } from '../gravador.js';

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1');

// decoder de mentira: cada pacote vira 160 amostras (20 ms a 8 kHz) de um valor fixo por perna
class OpusFalso {
  constructor(taxa, canais) { this.taxa = taxa; this.canais = canais; this.apagado = false; }
  decode(payload) {
    const b = Buffer.alloc(160 * 2);
    for (let i = 0; i < 160; i++) b.writeInt16LE(payload[0] * 100, i * 2);
    return b;
  }
  delete() { this.apagado = true; }
}

test('⚠️ a ligação continua sendo gravada, com as duas pernas — pela EXECUÇÃO', () => {
  let t = 1_000_000;
  const g = criarGravador(OpusFalso, () => t);
  assert.ok(g, 'o gravador não nasceu');
  for (let k = 0; k < 5; k++) {
    g.onRtp('cliente', { payload: Buffer.from([1]), header: { timestamp: 48_000 + k * 960 } });
    g.onRtp('operador', { payload: Buffer.from([2]), header: { timestamp: 90_000 + k * 960 } });
    t += 20;
  }
  const wav = g.finalizar();
  assert.ok(Buffer.isBuffer(wav), 'finalizar não devolveu o WAV que vai ao Conversas');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), TAXA_GRAV);
  const amostras = (wav.length - 44) / 2;
  assert.ok(amostras >= 5 * 160, `gravou ${amostras} amostras`);
  // as duas vozes estão na mistura (100 do cliente + 200 do operador)
  assert.equal(wav.readInt16LE(44), 300);
});

test('sem áudio não há gravação, e sem decoder não há gravador (o navegador assume)', () => {
  assert.equal(criarGravador(OpusFalso).finalizar(), null);
  assert.equal(criarGravador(null), null);
});

test('o gravador não tem mais por onde mandar o áudio para outro lugar', () => {
  // a ponte recebia o PCM por um gancho do gravador (`aoDecodificar`). Ele saiu com ela.
  assert.equal(criarGravador.length, 1, 'o gravador voltou a aceitar um destino a mais para o áudio');
  assert.doesNotMatch(semComentarios(ler('gravador.js')), /aoDecodificar/);
});

test('a ponte do copiloto saiu, e o servidor não a abre mais', () => {
  assert.equal(existsSync(new URL('../copiloto.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../mulaw.js', import.meta.url)), false);
  const srv = semComentarios(ler('server.js'));
  assert.doesNotMatch(srv, /abrirCopiloto|COPILOTO_WS_URL|tipo: "copiloto"/);
  // e as DUAS pernas de ligação (entrada e saída) continuam criando o gravador e mandando o WAV
  assert.equal((srv.match(/c\.gravador = criarGravador\(OpusScript\)/g) || []).length, 2);
  assert.match(srv, /enviarGravacao\(call_id, wav\)/);
});
