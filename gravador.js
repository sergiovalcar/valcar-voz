// gravador.js — GRAVAÇÃO NO SERVIDOR da ligação de WhatsApp: decodifica o Opus das duas pernas
// (cliente + operador), posiciona cada frame pelo timestamp RTP (48kHz) num buffer de saída de
// 8kHz, e ao final mixa tudo num WAV mono. Não depende do navegador do operador.
//
// É ESTE WAV que vai ao Conversas (`/voz/gravacao`) e vira a transcrição e a análise da ligação.
// Mudou de arquivo em 29/09, quando o copiloto ao vivo saiu (direção: *"O item 3, copiloto ao
// vivo que sugere o que dizer, eu quero desativar. Não vamos mais precisar dessa função no nosso
// sistema."*): o gravador tinha um gancho (`aoDecodificar`) que mandava o mesmo PCM para a ponte
// do copiloto. O gancho saiu com a ponte, e o gravador veio para cá para um teste poder
// EXECUTÁ-LO — server.js sobe o servidor no topo e nenhum teste consegue importá-lo.
//
// `Opus` é o construtor do decoder (o `opusscript` que server.js carrega), injetado: sem ele a
// gravação no servidor fica desabilitada e o fallback do navegador continua valendo.

export const TAXA_GRAV = 8000; // Hz de saída (qualidade telefone, suficiente para revisão de voz)

export function wavDe(int16, taxa) {
  const nBytes = int16.length * 2;
  const buf = Buffer.alloc(44 + nBytes);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + nBytes, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(taxa, 24); buf.writeUInt32LE(taxa * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(nBytes, 40);
  for (let i = 0; i < int16.length; i++) buf.writeInt16LE(int16[i], 44 + i * 2);
  return buf;
}

export function criarGravador(Opus, agora = Date.now) {
  if (!Opus) return null;
  let dec;
  try { dec = { cliente: new Opus(TAXA_GRAV, 1), operador: new Opus(TAXA_GRAV, 1) }; }
  catch (e) { console.warn("[voz] falha ao criar decoder Opus:", e?.message); return null; }
  const legs = { cliente: { first: null, wall: 0 }, operador: { first: null, wall: 0 } };
  let bufs = { cliente: new Int16Array(TAXA_GRAV * 30), operador: new Int16Array(TAXA_GRAV * 30) };
  const len = { cliente: 0, operador: 0 };
  let recStart = 0;
  function garantir(p, ate) { if (ate <= bufs[p].length) return; let n = bufs[p].length; while (n < ate) n *= 2; const novo = new Int16Array(n); novo.set(bufs[p]); bufs[p] = novo; }
  function onRtp(perna, rtp) {
    try {
      const payload = rtp?.payload; const ts = rtp?.header?.timestamp;
      if (!payload || !payload.length || ts == null) return;
      const leg = legs[perna]; const now = agora(); const t = ts >>> 0;
      if (leg.first == null) { leg.first = t; leg.wall = now; if (!recStart) recStart = now; }
      let pcm; try { pcm = dec[perna].decode(payload); } catch { return; }
      if (!pcm || !pcm.length) return;
      const nSamp = pcm.length >> 1;
      const posLeg = Math.round((t - leg.first) / 6); // 48kHz RTP -> 8kHz saída
      const off = Math.round((leg.wall - recStart) / 1000 * TAXA_GRAV);
      let idx = off + posLeg; if (idx < 0) idx = 0;
      garantir(perna, idx + nSamp);
      for (let i = 0; i < nSamp; i++) bufs[perna][idx + i] = pcm.readInt16LE(i << 1);
      if (idx + nSamp > len[perna]) len[perna] = idx + nSamp;
    } catch {}
  }
  function finalizar() {
    const total = Math.max(len.cliente, len.operador);
    try { dec.cliente.delete?.(); dec.operador.delete?.(); } catch {}
    if (!total) return null;
    const mix = new Int16Array(total);
    for (let i = 0; i < total; i++) {
      let s = (i < len.cliente ? bufs.cliente[i] : 0) + (i < len.operador ? bufs.operador[i] : 0);
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      mix[i] = s;
    }
    bufs = null;
    return wavDe(mix, TAXA_GRAV);
  }
  return { onRtp, finalizar };
}
