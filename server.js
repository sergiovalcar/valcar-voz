// ============================================================
// valcar-voz — Fase 2, tijolo 1: ECO DE ÁUDIO (meia-ponte)
// >>> No repositório, este arquivo deve se chamar  server.js  <<<
// ------------------------------------------------------------
// Valida a API de MÍDIA do werift sobre o UDP do Railway:
// navegador (mic) -> werift -> de volta pro navegador (alto-falante).
// Se você falar (de fone!) e ouvir sua própria voz, o caminho de áudio
// RTP funciona — é o mesmo mecanismo que a ponte Meta<->navegador usará.
//
// Próximo passo depois deste: trocar a "perna do navegador" de um dos
// lados pela "perna da Meta" (oferta SDP do webhook calls + accept).
// ============================================================

import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { RTCPeerConnection, MediaStreamTrack } from "werift";

const PORT = process.env.PORT || 8080;
process.on("uncaughtException", (e) => console.error("[voz] uncaughtException:", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[voz] unhandledRejection:", e?.message || e));

function iceServers() {
  const lista = [{ urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    lista.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER || "", credential: process.env.TURN_PASS || "" });
  }
  return lista;
}
const FORCE_RELAY = process.env.FORCE_RELAY === "1";

const app = express();
app.use(express.json({ limit: "1mb" }));
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";
const chamadasMeta = new Map(); // call_id -> RTCPeerConnection (perna da Meta)

// chama o endpoint /calls da Graph API (pre_accept / accept / terminate)
async function metaCalls(phoneId, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return { ok: false, status: 0, json: { erro: e?.message } };
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.type("html").send(PAGINA));

// ------------------------------------------------------------
// PERNA DA META (Fase 2, teste isolado): recebe a oferta SDP encaminhada
// pelo Conversas, monta a conexão WebRTC com a Meta, aceita a chamada
// (pre_accept -> accept) e ECOA o áudio do cliente de volta (o cliente
// ouve a própria voz). Valida o handshake + o áudio da perna da Meta.
// ------------------------------------------------------------
app.post("/chamada", async (req, res) => {
  if ((req.headers["x-voz-secret"] || "") !== (process.env.VOZ_SECRET || "")) {
    return res.status(403).json({ erro: "secret inválido" });
  }
  const { call_id, sdp, phone_number_id } = req.body || {};
  res.json({ ok: true }); // responde rápido; o accept acontece em seguida
  if (!call_id || !sdp) { console.error("[voz][meta] /chamada sem call_id/sdp"); return; }
  const phoneId = phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  console.log(`[voz][meta ${call_id}] chamada recebida; montando WebRTC…`);

  try {
    const config = { iceServers: iceServers() };
    if (FORCE_RELAY) config.iceTransportPolicy = "relay";
    const pc = new RTCPeerConnection(config);
    chamadasMeta.set(call_id, pc);

    pc.iceConnectionStateChange.subscribe((s) => console.log(`[voz][meta ${call_id}] ice:`, s));
    pc.connectionStateChange.subscribe((s) => {
      console.log(`[voz][meta ${call_id}] pc:`, s);
      if (s === "closed" || s === "failed" || s === "disconnected") { try { pc.close?.(); } catch {} chamadasMeta.delete(call_id); }
    });

    // eco: o áudio do cliente volta pra ele mesmo
    const echoTrack = new MediaStreamTrack({ kind: "audio" });
    pc.addTransceiver(echoTrack, { direction: "sendrecv" });
    pc.onTrack.subscribe((track) => {
      const t = track?.onReceiveRtp ? track : track?.track;
      if (!t?.onReceiveRtp) return;
      let n = 0;
      t.onReceiveRtp.subscribe((rtp) => {
        n++;
        if (n === 1) console.log(`[voz][meta ${call_id}] áudio do cliente fluindo (RTP recebido)`);
        try { echoTrack.writeRtp(rtp); } catch (e) { if (n < 3) console.error("writeRtp:", e?.message); }
      });
    });

    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // a Meta exige a=setup:active no SDP de resposta do negócio
    const answerSdp = pc.localDescription.sdp
      .replace(/a=setup:actpass/g, "a=setup:active")
      .replace(/a=setup:passive/g, "a=setup:active");

    // ordem obrigatória: pre_accept ANTES de accept
    const sess = { sdp_type: "answer", sdp: answerSdp };
    const pre = await metaCalls(phoneId, { messaging_product: "whatsapp", call_id, action: "pre_accept", session: sess });
    console.log(`[voz][meta ${call_id}] pre_accept:`, pre.status, JSON.stringify(pre.json));
    const acc = await metaCalls(phoneId, { messaging_product: "whatsapp", call_id, action: "accept", session: sess });
    console.log(`[voz][meta ${call_id}] accept:`, acc.status, JSON.stringify(acc.json));
  } catch (e) {
    console.error(`[voz][meta ${call_id}] erro:`, e?.message || e);
  }
});

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

        // track que VAMOS ENVIAR de volta (o eco). Adicionado antes do setRemoteDescription
        // para casar com a m-line de áudio que vem na oferta do navegador.
        const echoTrack = new MediaStreamTrack({ kind: "audio" });
        pc.addTransceiver(echoTrack, { direction: "sendrecv" });

        // track que RECEBEMOS (a voz do navegador) -> repassa cada pacote RTP de volta
        pc.onTrack.subscribe((track) => {
          const t = track?.onReceiveRtp ? track : track?.track;
          if (!t?.onReceiveRtp) { avisar(ws, "erro_servidor", "track recebida sem onReceiveRtp"); return; }
          avisar(ws, "track_recebida", t.kind);
          let n = 0;
          t.onReceiveRtp.subscribe((rtp) => {
            n++;
            if (n === 1) avisar(ws, "audio_fluindo", "primeiro pacote RTP recebido");
            try { echoTrack.writeRtp(rtp); } catch (e) { if (n < 3) console.error("writeRtp:", e?.message); }
          });
        });

        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ tipo: "answer", sdp: pc.localDescription.sdp }));
      } catch (e) {
        console.error("[voz] erro ao responder oferta:", e);
        avisar(ws, "erro_servidor", String(e?.message || e));
      }
      return;
    }
  });

  ws.on("close", () => { console.log("[voz] navegador desconectou"); try { pc?.close?.(); } catch {} });
});

httpServer.listen(PORT, () => {
  console.log(`[voz] eco de áudio no ar na porta ${PORT}`);
  console.log(`[voz] ICE servers:`, JSON.stringify(iceServers()), "FORCE_RELAY:", FORCE_RELAY);
});

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>valcar-voz — eco de áudio</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:680px;margin:30px auto;padding:0 16px;color:#1d1d1f}
  h1{font-size:20px}
  button{font-size:15px;font-weight:600;background:#EB3237;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .estado{font-size:15px;margin:14px 0;padding:12px 14px;border-radius:10px;background:#f5f5f7}
  .ok{background:#e7f6ec;color:#1a7f37}
  .falha{background:#fdecec;color:#b3272c}
  .aviso{background:#fff7e6;color:#8a6d00;font-size:13.5px}
  pre{background:#0d1117;color:#c9d1d9;font-size:12.5px;padding:12px;border-radius:10px;overflow:auto;max-height:320px}
  .dim{color:#86868b}
</style></head>
<body>
  <h1>valcar-voz — eco de áudio (teste da ponte)</h1>
  <p class="dim">Clica em "Iniciar", autoriza o microfone e fala. Sua voz vai até o servidor (Railway) e volta — você deve se ouvir com um pequeno atraso.</p>
  <div class="estado aviso">⚠️ Use <b>fone de ouvido</b> para evitar microfonia (o eco realimentando o microfone).</div>
  <button id="btn" onclick="iniciar()">Iniciar</button>
  <div class="estado" id="estado">Aguardando…</div>
  <audio id="saida" autoplay></audio>
  <pre id="logs"></pre>
<script>
const ICE_DO_BROWSER = [{ urls: "stun:stun.l.google.com:19302" }];
const E = (id)=>document.getElementById(id);
function log(t){ E("logs").textContent += t + "\\n"; }
function estado(t, cls){ E("estado").textContent = t; E("estado").className = "estado " + (cls||""); }

async function iniciar(){
  E("btn").disabled = true;
  E("logs").textContent = "";
  estado("Pedindo acesso ao microfone…");

  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false }); }
  catch(e){ estado("Sem acesso ao microfone: " + e.message, "falha"); E("btn").disabled=false; return; }

  const wsUrl = (location.protocol==="https:"?"wss://":"ws://") + location.host;
  const ws = new WebSocket(wsUrl);
  ws.onerror = ()=>{ estado("Falha no WebSocket.", "falha"); E("btn").disabled=false; };

  ws.onopen = async ()=>{
    log("WebSocket aberto.");
    const pc = new RTCPeerConnection({ iceServers: ICE_DO_BROWSER });
    window._pc = pc;

    // envia o microfone
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    // toca o que voltar (o eco)
    pc.ontrack = (ev)=>{
      log("Recebendo áudio de volta (track).");
      E("saida").srcObject = ev.streams[0] || new MediaStream([ev.track]);
      E("saida").play().catch(()=>{});
      window._ouviu = true;
      estado("✅ Conectado — fale e você deve ouvir sua voz (com atraso).", "ok");
    };

    pc.oniceconnectionstatechange = ()=> log("ICE(browser): " + pc.iceConnectionState);
    pc.onconnectionstatechange = ()=>{
      log("PC(browser): " + pc.connectionState);
      if(pc.connectionState==="connected" && !window._ouviu) estado("Conectado — aguardando o áudio de volta…", "ok");
      if(pc.connectionState==="failed") estado("Não conectou.", "falha");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve)=>{
      if(pc.iceGatheringState==="complete") return resolve();
      const t = setTimeout(resolve, 3000);
      pc.onicegatheringstatechange = ()=>{ if(pc.iceGatheringState==="complete"){ clearTimeout(t); resolve(); } };
    });
    estado("Negociando conexão…");
    ws.send(JSON.stringify({ tipo:"offer", sdp: pc.localDescription.sdp }));
  };

  ws.onmessage = async (ev)=>{
    const m = JSON.parse(ev.data);
    if(m.tipo==="answer"){ await window._pc.setRemoteDescription({ type:"answer", sdp:m.sdp }); log("Resposta do servidor aplicada."); }
    if(m.tipo==="log"){ log("[servidor] " + m.evento + ": " + JSON.stringify(m.dado)); }
  };

  setTimeout(()=>{ if(!window._ouviu && window._pc && window._pc.connectionState!=="connected"){ estado("Não conectou em 12s.", "falha"); E("btn").disabled=false; } }, 12000);
}
</script>
</body></html>`;
