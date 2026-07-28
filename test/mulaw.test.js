// test/mulaw.test.js — codec μ-law da ponte do copiloto ao vivo.
//
// Este é o único trecho de processamento de áudio que o valcar-voz faz por conta
// própria, e um erro aqui não daria exceção: geraria ruído, o AWS Transcribe
// devolveria lixo e o copiloto instruiria a operadora com base em nada. Falha
// silenciosa — exatamente a classe de bug que já mordeu neste sistema.
//
// O decoder aqui replica o do serviço do copiloto (repo do robô), então o teste
// valida a ida-e-volta REAL: o que sai daqui é o que aquele lado vai interpretar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcm16ParaMuLaw, pcm16ParaMuLawSample, muLawParaPcm16Sample } from '../mulaw.js';

const bufDe = (amostras) => {
  const b = Buffer.alloc(amostras.length * 2);
  amostras.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
};

test('comprime 2 bytes de PCM16 em 1 byte de μ-law', () => {
  assert.equal(pcm16ParaMuLaw(bufDe([0, 100, -100, 5000])).length, 4);
  assert.equal(pcm16ParaMuLaw(Buffer.alloc(0)).length, 0);
});

test('ida-e-volta preserva o sinal acima do piso de quantização', () => {
  // Medido: |amostra| >= 4 preserva o sinal; 1 e 2 colapsam para 0. Isso é do
  // G.711, não um defeito — perto do zero o passo é maior que 1. Amplitudes
  // assim são silêncio na prática, então não afetam a transcrição.
  for (const v of [4, 500, 5000, 20000]) {
    assert.ok(muLawParaPcm16Sample(pcm16ParaMuLawSample(v)) > 0, `+${v} deveria voltar positivo`);
    assert.ok(muLawParaPcm16Sample(pcm16ParaMuLawSample(-v)) < 0, `-${v} deveria voltar negativo`);
  }
  // e o piso é mesmo esse: abaixo dele o codec colapsa para zero
  assert.equal(muLawParaPcm16Sample(pcm16ParaMuLawSample(1)), 0);
});

test('erro relativo da ida-e-volta fica dentro do esperado para G.711 (<10%)', () => {
  // μ-law é logarítmico: o erro é proporcional à amplitude, não absoluto.
  // Amostras muito baixas ficam fora da checagem porque lá o erro relativo
  // explode por definição (quantização perto do zero).
  for (const v of [200, -200, 1000, -1000, 8000, -8000, 30000, -30000]) {
    const volta = muLawParaPcm16Sample(pcm16ParaMuLawSample(v));
    const erro = Math.abs(volta - v) / Math.abs(v);
    assert.ok(erro < 0.10, `amostra ${v} voltou ${volta} (erro ${(erro * 100).toFixed(1)}%)`);
  }
});

test('satura em vez de dar a volta no limite do Int16', () => {
  // sem o clamp, +32767 viraria um valor NEGATIVO alto — estalo audível na gravação
  // e fonema errado para o transcritor.
  assert.ok(muLawParaPcm16Sample(pcm16ParaMuLawSample(32767)) > 30000);
  assert.ok(muLawParaPcm16Sample(pcm16ParaMuLawSample(-32768)) < -30000);
});

test('silêncio não vira ruído', () => {
  const mudo = pcm16ParaMuLaw(bufDe(new Array(160).fill(0)));
  for (const b of mudo) assert.ok(Math.abs(muLawParaPcm16Sample(b)) < 40, 'zero deveria voltar perto de zero');
});

test('um quadro de 20ms a 8kHz vira 160 bytes', () => {
  // é o tamanho que o Twilio manda e que o copiloto espera por quadro `media`.
  assert.equal(pcm16ParaMuLaw(bufDe(new Array(160).fill(1234))).length, 160);
});
