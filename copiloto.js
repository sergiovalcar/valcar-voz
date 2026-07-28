// copiloto.js — COPILOTO AO VIVO nas ligações de WhatsApp (demanda #4).
//
// O copiloto ao vivo já existia, mas só nas ligações do Twilio: o TwiML manda
// <Start><Stream> e o serviço `copiloto-voz` (repo do robô) faz STT + Claude +
// grava a sugestão. As ligações de WhatsApp que passam por aqui nunca tiveram —
// 0 de 71 nos últimos 30 dias.
//
// Em vez de duplicar STT/IA aqui, este módulo faz o valcar-voz FALAR O MESMO
// PROTOCOLO que o copiloto já entende (Twilio Media Streams): start → media* →
// stop. Assim toda a inteligência, o roteiro configurável e o prompt de
// onboarding continuam num lugar só.
//
// A ponte é bidirecional: o copiloto responde as sugestões NESTE mesmo socket
// (evento 'sugestao'), e quem chama repassa ao navegador do operador pelo
// WebSocket que ele já tem aberto. Não passa pela Carteira — o operador de uma
// ligação de WhatsApp está no painel do Conversas, não no da Carteira.
//
// Env: COPILOTO_WS_URL (a mesma da Carteira). Sem ela, o módulo é inerte.
//
// REGRA: nada aqui pode derrubar a ligação. Todo caminho é best-effort.

import { WebSocket } from "ws";
import { pcm16ParaMuLaw } from "./mulaw.js";

// nomes de faixa do Twilio: o copiloto abre um fluxo de transcrição POR faixa, e
// intercalar as duas num fluxo só corromperia o áudio. cliente=inbound, operador=outbound.
const FAIXA = { cliente: "inbound", operador: "outbound" };

// Abre a ponte para uma ligação. Devolve { enviar, fechar } ou null quando desligado.
//   callId    — id da chamada na Meta; vira o `callSid` do copiloto (chave da sugestão)
//   finalidade— 'onboarding' | 'cobranca' (define o tom e o roteiro)
//   aoSugerir — callback(sugestao) para entregar ao navegador do operador
export function abrirCopiloto({ callId, finalidade = "onboarding", aoSugerir }) {
  const url = process.env.COPILOTO_WS_URL;
  if (!url || !callId) return null;

  let ws = null, pronto = false, fechado = false;
  const pendentes = []; // quadros gerados antes do socket abrir (o áudio não espera)
  const MAX_PENDENTES = 200; // ~4s de áudio; passou disso, descarta o mais antigo

  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.log(`[copiloto ${callId}] não abriu:`, e?.message);
    return null;
  }

  ws.on("open", () => {
    pronto = true;
    // `start` no formato do Twilio Media Streams. `origem` diz ao copiloto que a
    // resposta deve voltar por este socket em vez de (só) ir para a Carteira.
    enviarBruto({
      event: "start",
      start: {
        callSid: callId,
        customParameters: { callSid: callId, finalidade, origem: "valcar_voz", clienteId: "", cobradorId: "" },
      },
    });
    while (pendentes.length) enviarBruto(pendentes.shift());
    console.log(`[copiloto ${callId}] ponte aberta (${finalidade})`);
  });

  ws.on("message", (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m?.event === "sugestao" && m.sugestao && typeof aoSugerir === "function") aoSugerir(m.sugestao);
    } catch { /* mensagem que não entendemos não quebra a ligação */ }
  });

  // erro/queda do copiloto NÃO afeta a chamada: só perde a instrução ao vivo.
  ws.on("error", (e) => { console.log(`[copiloto ${callId}] erro:`, e?.message); });
  ws.on("close", () => { pronto = false; });

  function enviarBruto(obj) {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch { /* ignora */ }
  }

  return {
    // recebe o PCM16 8 kHz que o gravador já decodificou — sem custo extra de decode
    enviar(perna, pcm) {
      if (fechado || !pcm || !pcm.length) return;
      let quadro;
      try {
        quadro = { event: "media", media: { track: FAIXA[perna] || "inbound", payload: pcm16ParaMuLaw(pcm).toString("base64") } };
      } catch { return; }
      if (pronto) enviarBruto(quadro);
      else { pendentes.push(quadro); if (pendentes.length > MAX_PENDENTES) pendentes.shift(); }
    },
    fechar() {
      if (fechado) return;
      fechado = true;
      enviarBruto({ event: "stop" });
      // dá um instante para o `stop` sair antes de derrubar o socket
      setTimeout(() => { try { ws?.close(); } catch { /* ignora */ } }, 300);
    },
  };
}
