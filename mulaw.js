// mulaw.js — codec G.711 μ-law, funções puras e sem dependências.
//
// Separado de copiloto.js porque aquele importa `ws` e abre socket: para testar o
// codec seria preciso subir o mundo inteiro. Aqui é aritmética pura.
//
// Por que μ-law: o serviço do copiloto (repo do robô) nasceu recebendo Media Streams
// do Twilio, que trafega μ-law 8 kHz em base64. Para reaproveitar aquele serviço sem
// tocar no que já funciona, o valcar-voz fala o mesmo formato — o PCM16 8 kHz que o
// gravador já decodifica é comprimido aqui antes de ir para a ponte.

const BIAS = 0x84;
const CLIP = 32635;

export function pcm16ParaMuLawSample(s) {
  let sinal = (s >> 8) & 0x80;
  if (sinal !== 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return (~(sinal | (exp << 4) | mant)) & 0xff;
}

export function muLawParaPcm16Sample(u) {
  u = (~u) & 0xff;
  let t = ((u & 0x0f) << 3) + BIAS;
  t <<= (u & 0x70) >> 4;
  return (u & 0x80) ? (BIAS - t) : (t - BIAS);
}

// Buffer PCM16 little-endian -> Buffer μ-law (1 byte por amostra).
export function pcm16ParaMuLaw(pcm) {
  const n = pcm.length >> 1;
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = pcm16ParaMuLawSample(pcm.readInt16LE(i << 1));
  return out;
}
