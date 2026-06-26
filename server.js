// ============================================================
// valcar-voz — SPIKE de infra (Fase 2 das ligações de voz)
// >>> No repositório novo, este arquivo deve se chamar  server.js  <<<
// ------------------------------------------------------------
// Objetivo único: descobrir se uma conexão WebRTC (ICE/UDP) consegue
// se estabelecer entre o NAVEGADOR e este processo rodando no Railway.
// Em vez de áudio, usamos um DataChannel (mesmo transporte ICE/DTLS/UDP
// do áudio) com eco ping/pong — se o canal abrir, o caminho de mídia
// também abriria. Não depende de chamada real do WhatsApp.
//
// Como ler o resultado:
//  - Só STUN (sem variáveis TURN): se conectar, o Railway entrega UDP
//    direto -> talvez nem precisemos de TURN.
//  - Se só-STUN NÃO conectar, defina TURN_URL/TURN_USER/TURN_PASS (e
//    opcionalmente FORCE_RELAY=1) e teste de novo: se aí conectar,
//    confirmamos que a Fase 2 precisa de TURN.
//
// Variáveis de ambiente (Railway):
//  PORT          (o Railway define sozinho)
//  STUN_URL      (opcional; default stun:stun.l.google.com:19302)
//  TURN_URL      (opcional; ex.: turn:host:3478 ou turns:host:443)
//  TURN_USER / TURN_PASS  (opcional)
//  FORCE_RELAY   (opcional; "1" força usar TURN — testa o TURN isolado)
// ============================================================

import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { RTCPeerConnection } from "werift";

const PORT = process.env.PORT || 8080;

function iceServers() {
  const lista = [{ urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    lista.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USER || "",
      credential: process.env.TURN_PASS || "",
    });
  }
  return lista;
}
const FORCE_RELAY = process.env.FORCE_RELAY === "1";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.type("html").send(PAGINA));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function avisar(ws, evento, dado) {
  try { ws.send(JSON.stringify({ tipo: "log", evento, dado })); } catch {}
  console.log(`[voz] ${evento}`, dado ?? "");
}

wss.on("connection", (ws) => {
  console.log("[voz] navegador conectado ao WebSocket");
  let pc = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.tipo === "offer") {
      try {
        const config = { iceServers: iceServers() };
        if (FORCE_RELAY) config.iceTransportPolicy = "relay";
        pc = new RTCPeerConnection(config);

        pc.iceConnectionStateChange.subscribe((s) => avisar(ws, "iceConnectionState", s));
        pc.connectionStateChange.subscribe((s) => avisar(ws, "connectionState", s));

        // eco do DataChannel: tudo que chega volta com prefixo "eco:"
        pc.onDataChannel.subscribe((canal) => {
          avisar(ws, "datachannel", canal.label);
          canal.message.subscribe((data) => {
            const txt = typeof data === "string" ? data : data?.toString?.() || "";
            try { canal.send("eco:" + txt); } catch (e) { console.error("erro no eco", e); }
          });
        });

        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const ld = pc.localDescription;
        const qtdCand = (ld?.sdp?.match(/a=candidate/g) || []).length;
        avisar(ws, "answer_candidatos", qtdCand);
        ws.send(JSON.stringify({ tipo: "answer", sdp: ld.sdp }));
      } catch (e) {
        console.error("[voz] erro ao responder oferta:", e);
        avisar(ws, "erro_servidor", String(e?.message || e));
      }
      return;
    }
  });

  ws.on("close", () => {
    console.log("[voz] navegador desconectou");
    try { pc?.close?.(); } catch {}
  });
});

httpServer.listen(PORT, () => {
  console.log(`[voz] spike no ar na porta ${PORT}`);
  console.log(`[voz] ICE servers:`, JSON.stringify(iceServers()));
  console.log(`[voz] FORCE_RELAY:`, FORCE_RELAY);
});

// ------------------------------------------------------------
// Página de teste (servida em "/"): roda no navegador.
// Usa a API WebRTC padrão do browser (100% confiável). O navegador é o
// "offerer" (cria o DataChannel + a oferta); o servidor (werift) responde.
// ------------------------------------------------------------
const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>valcar-voz — teste de conexão</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:680px;margin:30px auto;padding:0 16px;color:#1d1d1f}
  h1{font-size:20px}
  button{font-size:15px;font-weight:600;background:#EB3237;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .estado{font-size:15px;margin:14px 0;padding:12px 14px;border-radius:10px;background:#f5f5f7}
  .ok{background:#e7f6ec;color:#1a7f37}
  .falha{background:#fdecec;color:#b3272c}
  pre{background:#0d1117;color:#c9d1d9;font-size:12.5px;padding:12px;border-radius:10px;overflow:auto;max-height:340px}
  .dim{color:#86868b}
</style></head>
<body>
  <h1>valcar-voz — teste de conexão WebRTC</h1>
  <p class="dim">Clica em "Iniciar teste". O navegador tenta abrir um canal WebRTC com este servidor (no Railway) e mandar um "ping". Se voltar o "eco", o caminho de mídia (UDP/ICE) funciona.</p>
  <button id="btn" onclick="iniciar()">Iniciar teste</button>
  <div class="estado" id="estado">Aguardando…</div>
  <pre id="logs"></pre>
<script>
const ICE_DO_BROWSER = [{ urls: "stun:stun.l.google.com:19302" }];
const E = (id)=>document.getElementById(id);
function log(t){ E("logs").textContent += t + "\\n"; }
function estado(t, cls){ E("estado").textContent = t; E("estado").className = "estado " + (cls||""); }

async function iniciar(){
  E("btn").disabled = true;
  E("logs").textContent = "";
  estado("Conectando ao servidor…");

  const wsUrl = (location.protocol==="https:"?"wss://":"ws://") + location.host;
  const ws = new WebSocket(wsUrl);

  ws.onerror = ()=>{ estado("Falha no WebSocket.", "falha"); E("btn").disabled=false; };
  ws.onopen = async ()=>{
    log("WebSocket aberto.");
    const pc = new RTCPeerConnection({ iceServers: ICE_DO_BROWSER });
    window._pc = pc;

    pc.oniceconnectionstatechange = ()=> log("ICE(browser): " + pc.iceConnectionState);
    pc.onconnectionstatechange = ()=>{
      log("PC(browser): " + pc.connectionState);
      if(pc.connectionState==="failed") estado("Não conectou (provável bloqueio de UDP). Precisaremos de TURN.", "falha");
    };

    const canal = pc.createDataChannel("probe");
    canal.onopen = ()=>{ log("DataChannel aberto — enviando ping…"); canal.send("ping"); };
    canal.onmessage = (ev)=>{
      log("Recebido do servidor: " + ev.data);
      estado("✅ Conectou! Caminho de mídia OK (eco recebido).", "ok");
      E("btn").disabled = false;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve)=>{
      if(pc.iceGatheringState==="complete") return resolve();
      const t = setTimeout(resolve, 3000);
      pc.onicegatheringstatechange = ()=>{ if(pc.iceGatheringState==="complete"){ clearTimeout(t); resolve(); } };
    });
    const cand = (pc.localDescription.sdp.match(/a=candidate/g)||[]).length;
    log("Candidatos na oferta: " + cand);
    estado("Negociando conexão…");
    ws.send(JSON.stringify({ tipo:"offer", sdp: pc.localDescription.sdp }));
  };

  ws.onmessage = async (ev)=>{
    const m = JSON.parse(ev.data);
    if(m.tipo==="answer"){ await window._pc.setRemoteDescription({ type:"answer", sdp:m.sdp }); log("Resposta do servidor aplicada."); }
    if(m.tipo==="log"){ log("[servidor] " + m.evento + ": " + JSON.stringify(m.dado)); }
  };

  setTimeout(()=>{
    if(window._pc && window._pc.connectionState!=="connected"){
      estado("Não conectou em 12s — provável bloqueio de UDP. Próximo passo: TURN.", "falha");
      E("btn").disabled = false;
    }
  }, 12000);
}
</script>
</body></html>`;
