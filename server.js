// ============================================================
// valcar-voz — Fase 2, ponte completa (Entrega 1: núcleo testável)
// >>> No repositório, este arquivo deve se chamar  server.js  <<<
// ------------------------------------------------------------
// Liga a perna da Meta (cliente no WhatsApp) com a perna do operador
// (navegador). Roteamento por DEPARTAMENTO (dinâmico, decidido pelo
// Conversas). Ringback nativo: só dá accept na Meta quando um operador
// atende. Se ninguém atender em 30s -> perdida.
//
// Tela de teste do operador: GET /operador  (requer VOZ_DEV=1)
//
// Variáveis (Railway, serviço valcar-voz):
//  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, GRAPH_VERSION (v21.0),
//  VOZ_SECRET (obrigatória — HMAC dos tickets + header x-voz-secret),
//  CONVERSAS_URL (obrigatória p/ reportar eventos de volta ao Conversas),
//  VOZ_DEV (=1 p/ liberar a tela de operador de teste),
//  STUN_URL/TURN_URL/TURN_USER/TURN_PASS/FORCE_RELAY (opcionais)
// ============================================================

import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import crypto from "crypto";
import { RTCPeerConnection, MediaStreamTrack } from "werift";

const PORT = process.env.PORT || 8080;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";
const FORCE_RELAY = process.env.FORCE_RELAY === "1";

// Segredo obrigatório: sem ele, tickets e header x-voz-secret não têm valor de
// segurança (o fallback fraco "x" foi removido). Aborta o boot se faltar.
if (!process.env.VOZ_SECRET) {
  console.error("[voz] FATAL: VOZ_SECRET não definido — abortando para não subir sem autenticação.");
  process.exit(1);
}
if (!process.env.CONVERSAS_URL) {
  console.warn("[voz] AVISO: CONVERSAS_URL não definido — eventos (atendida/encerrada) não serão reportados ao Conversas.");
}

// comparação de segredo em tempo constante (evita timing attack no x-voz-secret)
function segredoOk(req) {
  const recebido = Buffer.from(String(req.headers["x-voz-secret"] || ""));
  const esperado = Buffer.from(String(process.env.VOZ_SECRET || ""));
  if (recebido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(recebido, esperado);
}
process.on("uncaughtException", (e) => console.error("[voz] uncaughtException:", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[voz] unhandledRejection:", e?.message || e));

function iceServers() {
  const lista = [{ urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) lista.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER || "", credential: process.env.TURN_PASS || "" });
  return lista;
}
function rtcConfig() { const c = { iceServers: iceServers() }; if (FORCE_RELAY) c.iceTransportPolicy = "relay"; return c; }
function setupAtivo(sdp) { return sdp.replace(/a=setup:actpass/g, "a=setup:active").replace(/a=setup:passive/g, "a=setup:active"); }

async function metaCalls(phoneId, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { erro: e?.message } }; }
}

// envia mensagem de texto no WhatsApp (usado no "ocupado")
async function metaMessages(phoneId, to, texto) {
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { erro: e?.message } }; }
}

// valida o ticket assinado pelo Conversas (HMAC com VOZ_SECRET) -> dados do operador
function verificarTicketVoz(ticket) {
  try {
    const [corpo, sig] = String(ticket || "").split(".");
    if (!corpo || !sig) return null;
    const esperado = crypto.createHmac("sha256", process.env.VOZ_SECRET).update(corpo).digest("hex");
    if (sig !== esperado) return null;
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

// reporta evento da ligação de volta ao Conversas (grava na tabela chamadas / Registro)
async function reportarEvento(tipo, c, extra) {
  const base = process.env.CONVERSAS_URL;
  if (!base) return;
  const operadorReal = c.operadorId && !String(c.operadorId).startsWith("dev:") ? c.operadorId : null;
  try {
    await fetch(base.replace(/\/+$/, "") + "/voz/evento", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voz-secret": process.env.VOZ_SECRET },
      body: JSON.stringify({ tipo, call_id: c.call_id, operador_id: operadorReal, ...(extra || {}) }),
    });
  } catch (e) { console.error("[voz] falha reportarEvento:", e.message); }
}

// ---- estado ----
const operadores = new Set(); // ws (cada um com ws._info = {nome, departamentos:[], operador_id})
const chamadas = new Map();    // call_id -> { estado, offerSdp, phoneId, metaPc, operatorPc, operadorWs, ... }

// "presente na voz": conectado E não-ausente. O painel do Conversas informa a presença do
// operador (online/ausente) por uma mensagem { tipo:"presenca" }. Ausente = indisponível para
// receber ligação, igual a offline (cai para outro disponível ou para a fila do departamento).
// Sem informação de presença (ex.: painel antigo / tela de teste), trata como presente.
function presenteVoz(ws) { return ws.readyState === 1 && ws._info && ws._presenca !== "ausente"; }
function disponivel(ws) { return presenteVoz(ws) && !ws._emChamada; }
function operadoresDoDepto(deptId) {
  return [...operadores].filter((ws) => disponivel(ws) && (!deptId || ws._info.departamentos.includes(deptId)));
}
// presentes no depto, INCLUINDO ocupados (p/ distinguir "todos ocupados" de "ninguém disponível")
function onlineDoDepto(deptId) {
  return [...operadores].filter((ws) => presenteVoz(ws) && (!deptId || ws._info.departamentos.includes(deptId)));
}
function avisarOperadores(filtroWsExcluir, payload) {
  for (const op of operadores) if (op !== filtroWsExcluir && op.readyState === 1) { try { op.send(JSON.stringify(payload)); } catch {} }
}

// ---- HTTP ----
const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.redirect("/operador"));
app.get("/operador", (_req, res) => res.type("html").send(PAGINA_OPERADOR));

// chamada recebida (encaminhada pelo Conversas no evento connect)
app.post("/chamada", async (req, res) => {
  if (!segredoOk(req)) return res.status(403).json({ erro: "secret" });
  const { call_id, from, nome, conversa_id, departamento_id, operador_id, mensagem_ocupado, mensagem_gravacao, phone_number_id, sdp } = req.body || {};
  res.json({ ok: true });
  if (!call_id || !sdp) { console.error("[voz] /chamada sem call_id/sdp"); return; }
  const phoneId = phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const c = { call_id, from, nome: nome || from, conversa_id, departamento_id, operador_id: operador_id || null, mensagemOcupado: mensagem_ocupado || null, mensagemGravacao: mensagem_gravacao || null, phoneId, offerSdp: sdp, estado: "tocando", metaPc: null, operatorPc: null, operadorWs: null, iniciada: 0, timer: null };
  chamadas.set(call_id, c);

  // roteamento (em ordem):
  //  (3) operador atribuído: presente+livre -> só ele | presente+ocupado -> OCUPADO | ausente/offline -> cai pro depto
  //  (2)/(1) departamento (o da conversa ou o padrão): livres -> toca | todos ocupados -> OCUPADO | ninguém presente -> perdida
  // "presente" = conectado e NÃO-ausente (presenteVoz). Operador ausente é tratado como offline.
  let alvo = [], modo = "", ocupado = false;
  if (operador_id) {
    const online = [...operadores].filter((ws) => presenteVoz(ws) && ws._info.operador_id === operador_id);
    if (online.length) {
      const livres = online.filter(disponivel);
      if (livres.length) { alvo = livres; modo = "operador atribuído"; }
      else { ocupado = true; modo = "operador atribuído OCUPADO"; }
    } else {
      const livresDepto = operadoresDoDepto(departamento_id);
      if (livresDepto.length) { alvo = livresDepto; modo = "atribuído offline -> departamento"; }
      else if (onlineDoDepto(departamento_id).length) { ocupado = true; modo = "atribuído offline; departamento OCUPADO"; }
      else { modo = "atribuído offline; ninguém no departamento"; }
    }
  } else {
    const livresDepto = operadoresDoDepto(departamento_id);
    if (livresDepto.length) { alvo = livresDepto; modo = `departamento ${departamento_id || "—"}`; }
    else if (onlineDoDepto(departamento_id).length) { ocupado = true; modo = "departamento OCUPADO"; }
    else { modo = "departamento sem ninguém online"; }
  }

  if (ocupado) {
    c.estado = "encerrada";
    console.log(`[voz] chamada ${call_id} de ${c.nome}: OCUPADO [${modo}] -> encerra + avisa`);
    metaCalls(phoneId, { messaging_product: "whatsapp", call_id, action: "terminate" }).catch(() => {});
    if (c.mensagemOcupado && from) {
      const r = await metaMessages(phoneId, from, c.mensagemOcupado);
      console.log(`[voz] msg ocupado p/ ${from}:`, r.status, r.ok ? "" : JSON.stringify(r.json));
    }
    chamadas.delete(call_id);
    return;
  }

  c.tocandoPara = new Set(alvo);
  console.log(`[voz] chamada ${call_id} de ${c.nome}: tocando p/ ${alvo.length} operador(es) [${modo}]`);
  for (const op of alvo) { try { op.send(JSON.stringify({ tipo: "chamada_recebida", call_id, from, nome: c.nome, conversa_id, departamento_id })); } catch {} }
  // 30s sem atender -> perdida (encerra e some da UI)
  c.timer = setTimeout(() => {
    if (c.estado !== "tocando") return;
    c.estado = "encerrada";
    metaCalls(phoneId, { messaging_product: "whatsapp", call_id, action: "terminate" }).catch(() => {});
    avisarOperadores(null, { tipo: "chamada_expirada", call_id });
    chamadas.delete(call_id);
    console.log(`[voz] chamada ${call_id} expirada (perdida)`);
  }, 30000);
});

// chamada encerrada pelo lado da Meta (cliente desligou) — encaminhada pelo Conversas
app.post("/chamada-fim", (req, res) => {
  if (!segredoOk(req)) return res.status(403).json({ erro: "secret" });
  const { call_id } = req.body || {};
  res.json({ ok: true });
  const c = chamadas.get(call_id);
  if (!c || c.estado === "encerrada") { chamadas.delete(call_id); return; }
  const tocando = c.estado === "tocando";
  c.estado = "encerrada";
  if (c.operadorWs) c.operadorWs._emChamada = null; // libera o operador
  try { c.metaPc?.close?.(); } catch {}
  try { c.operatorPc?.close?.(); } catch {}
  if (c.operadorWs?.readyState === 1) try { c.operadorWs.send(JSON.stringify({ tipo: "encerrada", call_id, motivo: "cliente" })); } catch {}
  if (tocando) avisarOperadores(null, { tipo: "chamada_expirada", call_id });
  clearTimeout(c.timer);
  chamadas.delete(call_id);
  console.log(`[voz] chamada ${call_id} encerrada pelo cliente`);
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.tipo === "hello") {
      const p = verificarTicketVoz(m.ticket);
      if (!p) { try { ws.send(JSON.stringify({ tipo: "erro", msg: "ticket inválido" })); } catch {} return; }
      ws._info = { nome: p.nome || "Operador", departamentos: Array.isArray(p.departamentos) ? p.departamentos : [], operador_id: p.operador_id, papel: p.papel || "atendente" };
      operadores.add(ws);
      try { ws.send(JSON.stringify({ tipo: "conectado", nome: ws._info.nome, departamentos: ws._info.departamentos })); } catch {}
      console.log(`[voz] operador "${ws._info.nome}" (${ws._info.operador_id}) conectado; deptos: ${ws._info.departamentos.length}`);
      return;
    }

    if (m.tipo === "hello_dev") {
      if (process.env.VOZ_DEV !== "1") { try { ws.send(JSON.stringify({ tipo: "erro", msg: "modo dev desativado" })); } catch {} return; }
      ws._info = { nome: m.nome || "Operador", departamentos: Array.isArray(m.departamentos) ? m.departamentos : [], operador_id: "dev:" + (m.nome || "op") };
      operadores.add(ws);
      try { ws.send(JSON.stringify({ tipo: "conectado", nome: ws._info.nome, departamentos: ws._info.departamentos })); } catch {}
      console.log(`[voz] operador(dev) "${ws._info.nome}" conectado; deptos: ${ws._info.departamentos.length}`);
      return;
    }
    // presença informada pelo painel (online/ausente). Ausente -> não recebe novas ligações.
    if (m.tipo === "presenca") { ws._presenca = (m.status === "ausente") ? "ausente" : "online"; return; }
    if (m.tipo === "atender") return atender(ws, m.call_id, m.sdp);
    if (m.tipo === "desligar") return desligar(m.call_id, "operador");
    if (m.tipo === "recusar") return recusar(ws, m.call_id);
  });

  ws.on("close", () => {
    operadores.delete(ws);
    for (const [cid, c] of chamadas) if (c.operadorWs === ws && c.estado === "atendida") desligar(cid, "operador_saiu");
  });
});

async function atender(ws, call_id, browserOffer) {
  const c = chamadas.get(call_id);
  if (!c || c.estado !== "tocando") { try { ws.send(JSON.stringify({ tipo: "chamada_indisponivel", call_id })); } catch {} return; }
  c.estado = "atendida"; c.operadorWs = ws; c.operadorId = ws._info?.operador_id || null;
  ws._emChamada = call_id; // ocupado: não recebe toque de novas ligações
  clearTimeout(c.timer);
  // aviso de gravação ao cliente (LGPD) — a gravação em si é feita no navegador do operador
  if (c.mensagemGravacao && c.from) metaMessages(c.phoneId, c.from, c.mensagemGravacao).catch(() => {});
  avisarOperadores(ws, { tipo: "chamada_assumida", call_id });
  console.log(`[voz] chamada ${call_id} atendida por "${ws._info?.nome}"`);

  try {
    const metaPc = new RTCPeerConnection(rtcConfig());
    const operatorPc = new RTCPeerConnection(rtcConfig());
    c.metaPc = metaPc; c.operatorPc = operatorPc;

    const paraMeta = new MediaStreamTrack({ kind: "audio" });      // voz do operador -> cliente
    const paraOperador = new MediaStreamTrack({ kind: "audio" });  // voz do cliente -> operador
    metaPc.addTransceiver(paraMeta, { direction: "sendrecv" });
    operatorPc.addTransceiver(paraOperador, { direction: "sendrecv" });

    metaPc.onTrack.subscribe((tr) => {
      const t = tr?.onReceiveRtp ? tr : tr?.track; if (!t?.onReceiveRtp) return;
      t.onReceiveRtp.subscribe((rtp) => { try { paraOperador.writeRtp(rtp); } catch {} });
    });
    operatorPc.onTrack.subscribe((tr) => {
      const t = tr?.onReceiveRtp ? tr : tr?.track; if (!t?.onReceiveRtp) return;
      t.onReceiveRtp.subscribe((rtp) => { try { paraMeta.writeRtp(rtp); } catch {} });
    });
    metaPc.connectionStateChange.subscribe((s) => console.log(`[voz][meta ${call_id}] pc:`, s));
    operatorPc.connectionStateChange.subscribe((s) => console.log(`[voz][op ${call_id}] pc:`, s));

    // perna do operador (navegador é o offerer): responde
    await operatorPc.setRemoteDescription({ type: "offer", sdp: browserOffer });
    const oAns = await operatorPc.createAnswer(); await operatorPc.setLocalDescription(oAns);
    try { ws.send(JSON.stringify({ tipo: "resposta", call_id, sdp: operatorPc.localDescription.sdp })); } catch {}

    // perna da Meta: gera answer e ACEITA agora (pre_accept -> accept)
    await metaPc.setRemoteDescription({ type: "offer", sdp: c.offerSdp });
    const mAns = await metaPc.createAnswer(); await metaPc.setLocalDescription(mAns);
    const sess = { sdp_type: "answer", sdp: setupAtivo(metaPc.localDescription.sdp) };
    const pre = await metaCalls(c.phoneId, { messaging_product: "whatsapp", call_id, action: "pre_accept", session: sess });
    console.log(`[voz][meta ${call_id}] pre_accept:`, pre.status);
    const acc = await metaCalls(c.phoneId, { messaging_product: "whatsapp", call_id, action: "accept", session: sess });
    console.log(`[voz][meta ${call_id}] accept:`, acc.status);
    c.iniciada = Date.now();
    reportarEvento("atendida", c);
  } catch (e) {
    console.error(`[voz] erro ao atender ${call_id}:`, e?.message || e);
    desligar(call_id, "erro");
  }
}

function desligar(call_id, motivo) {
  const c = chamadas.get(call_id);
  if (!c || c.estado === "encerrada") { chamadas.delete(call_id); return; }
  c.estado = "encerrada";
  if (c.operadorWs) c.operadorWs._emChamada = null; // libera o operador
  metaCalls(c.phoneId, { messaging_product: "whatsapp", call_id, action: "terminate" }).catch(() => {});
  try { c.metaPc?.close?.(); } catch {}
  try { c.operatorPc?.close?.(); } catch {}
  if (c.operadorWs?.readyState === 1) try { c.operadorWs.send(JSON.stringify({ tipo: "encerrada", call_id, motivo })); } catch {}
  clearTimeout(c.timer);
  const dur = c.iniciada ? Math.round((Date.now() - c.iniciada) / 1000) : 0;
  if (c.iniciada) reportarEvento("encerrada", c, { duracao_seg: dur });
  chamadas.delete(call_id);
  console.log(`[voz] chamada ${call_id} desligada (${motivo}); duração ${dur}s`);
}

// operador recusou: tira ele da lista de quem está tocando. Se não sobrar
// ninguém tocando, encerra a chamada na Meta (o cliente para de ouvir o toque).
function recusar(ws, call_id) {
  const c = chamadas.get(call_id);
  if (!c || c.estado !== "tocando") return;
  c.tocandoPara?.delete(ws);
  console.log(`[voz] chamada ${call_id} recusada por "${ws._info?.nome}"; restam ${c.tocandoPara?.size || 0}`);
  if (!c.tocandoPara || c.tocandoPara.size === 0) {
    c.estado = "encerrada";
    metaCalls(c.phoneId, { messaging_product: "whatsapp", call_id, action: "terminate" }).catch(() => {});
    clearTimeout(c.timer);
    chamadas.delete(call_id);
    console.log(`[voz] chamada ${call_id} recusada por todos -> encerrada`);
  }
}

httpServer.listen(PORT, () => {
  console.log(`[voz] ponte no ar na porta ${PORT}; ICE:`, JSON.stringify(iceServers()), "DEV:", process.env.VOZ_DEV === "1");
});

// ------------------------------------------------------------
// Tela de operador de teste (GET /operador). Sem template literals
// aninhados (usa concatenação) p/ não quebrar esta string.
// ------------------------------------------------------------
const PAGINA_OPERADOR = '<!doctype html>'
+ '<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
+ '<title>valcar-voz — operador (teste)</title><style>'
+ 'body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#1d1d1f}'
+ 'h1{font-size:19px}button{font-size:15px;font-weight:600;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}'
+ '.vermelho{background:#EB3237;color:#fff}.verde{background:#1a7f37;color:#fff}.cinza{background:#e5e5ea;color:#1d1d1f}'
+ '.cartao{border:1px solid #e5e5ea;border-radius:12px;padding:16px;margin:14px 0}'
+ '.dim{color:#86868b;font-size:13.5px}label{display:block;margin:6px 0}.oculto{display:none}'
+ '#log{background:#0d1117;color:#c9d1d9;font-size:12px;padding:10px;border-radius:8px;max-height:220px;overflow:auto;white-space:pre-wrap}'
+ '</style></head><body>'
+ '<h1>Operador (teste de voz)</h1>'
+ '<div class="cartao" id="conexao">'
+ '<label>Seu nome <input id="nome" value="Sérgio" style="padding:6px;border:1px solid #ccc;border-radius:6px"></label>'
+ '<div class="dim">Departamentos que você atende:</div><div id="depts"></div>'
+ '<button class="verde" onclick="conectar()">Conectar</button> <span id="status" class="dim">desconectado</span>'
+ '</div>'
+ '<div class="cartao oculto" id="tocando"><b id="quemliga"></b><div class="dim" id="deptliga"></div><br>'
+ '<button class="verde" onclick="atender()">Atender</button> <button class="cinza" onclick="recusar()">Recusar</button></div>'
+ '<div class="cartao oculto" id="emchamada"><b>Em chamada</b> — <span id="cron">00:00</span><br><br>'
+ '<button class="vermelho" onclick="desligar()">Desligar</button></div>'
+ '<audio id="saida" autoplay></audio>'
+ '<div id="log"></div>'
+ '<script>'
+ 'var DEPTS=[{id:"6a57083b-2a59-4a30-8eba-f76dd8c613c5",nome:"Atendimento Geral"},{id:"f481a2e1-aa31-417a-b35a-b9bae34c8802",nome:"Checagem/Qualidade"},{id:"bae7efb1-417b-4c8b-9fb3-cb1d72e6e849",nome:"Reten\\u00e7\\u00e3o e Negocia\\u00e7\\u00e3o"},{id:"be8cb40f-b275-4137-ae20-73f2c77862a3",nome:"Vendas"}];'
+ 'var ws,pc,callId,cronT,ac;'
+ 'function $(i){return document.getElementById(i)}'
+ 'function log(t){$("log").textContent+=t+"\\n";$("log").scrollTop=1e9}'
+ 'DEPTS.forEach(function(d){$("depts").innerHTML+=\'<label><input type="checkbox" value="\'+d.id+\'" checked> \'+d.nome+\'</label>\'});'
+ 'function deptsSel(){return [].slice.call($("depts").querySelectorAll("input:checked")).map(function(i){return i.value})}'
+ 'function nomeDept(id){for(var i=0;i<DEPTS.length;i++)if(DEPTS[i].id===id)return DEPTS[i].nome;return "—"}'
+ 'function beep(){try{if(!ac)return;var o=ac.createOscillator(),g=ac.createGain();o.frequency.value=480;g.gain.value=0.06;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+0.25)}catch(e){}}'
+ 'var ringT;function ring(on){if(on){beep();ringT=setInterval(beep,1500)}else{clearInterval(ringT)}}'
+ 'function conectar(){ac=new (window.AudioContext||window.webkitAudioContext)();ac.resume();'
+ ' var u=(location.protocol==="https:"?"wss://":"ws://")+location.host;ws=new WebSocket(u);'
+ ' ws.onopen=function(){ws.send(JSON.stringify({tipo:"hello_dev",nome:$("nome").value,departamentos:deptsSel()}));};'
+ ' ws.onmessage=onMsg;ws.onclose=function(){$("status").textContent="desconectado"};ws.onerror=function(){$("status").textContent="erro WS"};}'
+ 'function onMsg(ev){var m=JSON.parse(ev.data);'
+ ' if(m.tipo==="conectado"){$("status").textContent="conectado ("+m.departamentos.length+" deptos)";log("Conectado.");}'
+ ' if(m.tipo==="erro"){$("status").textContent=m.msg;log("Erro: "+m.msg);}'
+ ' if(m.tipo==="chamada_recebida"){callId=m.call_id;$("quemliga").textContent="Ligação de "+(m.nome||m.from);$("deptliga").textContent=nomeDept(m.departamento_id);$("tocando").classList.remove("oculto");ring(true);log("Tocando: "+m.call_id);}'
+ ' if(m.tipo==="chamada_assumida"||m.tipo==="chamada_expirada"){if(m.call_id===callId){fimUI();log(m.tipo);}}'
+ ' if(m.tipo==="chamada_indisponivel"){fimUI();log("Indisponível (já assumida).");}'
+ ' if(m.tipo==="resposta"){pc.setRemoteDescription({type:"answer",sdp:m.sdp});log("Resposta aplicada — áudio deve começar.");}'
+ ' if(m.tipo==="encerrada"){log("Encerrada ("+(m.motivo||"")+").");fimChamada();}}'
+ 'function recusar(){ring(false);$("tocando").classList.add("oculto");if(ws)ws.send(JSON.stringify({tipo:"recusar",call_id:callId}));}'
+ 'function fimUI(){ring(false);$("tocando").classList.add("oculto");}'
+ 'async function atender(){ring(false);$("tocando").classList.add("oculto");'
+ ' var stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){log("Sem mic: "+e.message);return;}'
+ ' pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});'
+ ' stream.getTracks().forEach(function(t){pc.addTrack(t,stream)});'
+ ' pc.ontrack=function(e){$("saida").srcObject=e.streams[0]||new MediaStream([e.track]);$("saida").play().catch(function(){});};'
+ ' pc.onconnectionstatechange=function(){log("PC: "+pc.connectionState);if(pc.connectionState==="connected")emChamada();};'
+ ' var off=await pc.createOffer();await pc.setLocalDescription(off);'
+ ' await new Promise(function(r){if(pc.iceGatheringState==="complete")return r();var t=setTimeout(r,3000);pc.onicegatheringstatechange=function(){if(pc.iceGatheringState==="complete"){clearTimeout(t);r()}}});'
+ ' ws.send(JSON.stringify({tipo:"atender",call_id:callId,sdp:pc.localDescription.sdp}));log("Atendendo…");}'
+ 'function emChamada(){$("emchamada").classList.remove("oculto");var s=Date.now();cronT=setInterval(function(){var d=Math.floor((Date.now()-s)/1000);var mm=String(Math.floor(d/60)).padStart(2,"0"),ss=String(d%60).padStart(2,"0");$("cron").textContent=mm+":"+ss},500);}'
+ 'function desligar(){if(ws)ws.send(JSON.stringify({tipo:"desligar",call_id:callId}));fimChamada();}'
+ 'function fimChamada(){clearInterval(cronT);$("emchamada").classList.add("oculto");try{pc&&pc.close()}catch(e){}pc=null;$("saida").srcObject=null;}'
+ '</script></body></html>';
