const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { ScopaMaresciallo } = require('./games/maresciallo');
const { ScoponeScientifico } = require('./games/scientifico');
const { ScopaClassica } = require('./games/classica');
const { BOT_ID, BOT_NOME, scegliMossaBot } = require('./games/bot');

function creaPartita(tipo, codice, punti, num, opzioni = {}) {
  if (tipo === 'scientifico') return new ScoponeScientifico(codice, punti, opzioni);
  if (tipo === 'classica') return new ScopaClassica(codice, punti, opzioni);
  return new ScopaMaresciallo(codice, punti, num);
}

const TIPI_2_GIOCATORI = ['scientifico', 'classica'];
const db = require('./db');
const torneo = require('./tournament');

const app = express();
const server = http.createServer(app);
// perMessageDeflate: compressione WebSocket. Riduce ~50-70% banda sui broadcast
// di stato (carte + tavolo) a costo di ~5% CPU. Threshold 1KB per evitare
// overhead su messaggi piccoli (chat, turno ecc.).
const io = new Server(server, {
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: { level: 6 }
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Autenticazione ---
// Estrae il nome dall'Authorization: Bearer <token>, o null.
function autenticaRichiesta(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return db.validaSessione(m[1]);
}
function richiediAuth(req, res, next) {
  const nome = autenticaRichiesta(req);
  if (!nome) return res.status(401).json({ ok: false, errore: 'Non autenticato' });
  req.nomeAuth = nome;
  next();
}
function richiediAdmin(req, res, next) {
  const nome = autenticaRichiesta(req);
  if (!nome || !db.isAdmin(nome)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  req.nomeAuth = nome;
  next();
}

// --- Rate limiting login (prevenzione brute force) ---
// Map IP -> { tentativi, bloccatoFino } — in memoria, sliding window semplice.
const loginTentativi = new Map();
const LOGIN_MAX_TENTATIVI = 5;
const LOGIN_FINESTRA_MS = 5 * 60 * 1000; // 5 min
const LOGIN_BAN_MS = 15 * 60 * 1000; // 15 min
function ipDaReq(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}
function controllaLoginRate(req) {
  const ip = ipDaReq(req);
  const ora = Date.now();
  let info = loginTentativi.get(ip);
  if (info && info.bloccatoFino && info.bloccatoFino > ora) {
    return { ok: false, attesaSec: Math.ceil((info.bloccatoFino - ora) / 1000) };
  }
  if (!info || ora - info.finestra > LOGIN_FINESTRA_MS) {
    info = { tentativi: 0, finestra: ora };
  }
  return { ok: true, ip, info };
}
function registraLoginFallito(ip) {
  let info = loginTentativi.get(ip) || { tentativi: 0, finestra: Date.now() };
  info.tentativi++;
  if (info.tentativi >= LOGIN_MAX_TENTATIVI) {
    info.bloccatoFino = Date.now() + LOGIN_BAN_MS;
    console.log(`Login bloccato per IP ${ip} per ${LOGIN_BAN_MS/1000}s (troppi tentativi)`);
  }
  loginTentativi.set(ip, info);
}
function resetLoginTentativi(ip) {
  loginTentativi.delete(ip);
}
// Pulizia periodica entries scadute
setInterval(() => {
  const ora = Date.now();
  for (const [ip, info] of loginTentativi) {
    if ((info.bloccatoFino && info.bloccatoFino < ora) || (ora - info.finestra > LOGIN_FINESTRA_MS)) {
      loginTentativi.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

// --- API Auth ---
app.post('/api/registra', async (req, res) => {
  const { nome, email, password, citta } = req.body;
  res.json(await db.registra(nome, email, password, citta));
});
app.post('/api/login', async (req, res) => {
  const { nome, password } = req.body;
  const rate = controllaLoginRate(req);
  if (!rate.ok) {
    return res.status(429).json({ ok: false, errore: `Troppi tentativi. Riprova tra ${rate.attesaSec}s.` });
  }
  const r = await db.login(nome, password);
  if (!r.ok) registraLoginFallito(rate.ip);
  else resetLoginTentativi(rate.ip);
  res.json(r);
});
app.get('/api/stats/:nome', (req, res) => {
  const stats = db.getStats(req.params.nome);
  if (!stats) return res.json({ ok: false, errore: 'Utente non trovato' });
  res.json({ ok: true, stats });
});
app.get('/api/classifica', (req, res) => {
  res.json({ ok: true, classifica: db.getClassifica() });
});

// Health check (pubblico, leggero — usabile da uptime monitor o pm2)
const startedAt = Date.now();
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    utentiOnline: io.sockets.sockets.size,
    stanzeAttive: stanze.size,
    timestamp: Date.now()
  });
});

// Metriche dettagliate (riservate admin)
app.get('/api/admin/metriche', richiediAdmin, (req, res) => {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  let stanzeInCorso = 0, stanzeAttesa = 0, stanzeFinite = 0;
  for (const [, p] of stanze) {
    if (p.stato === 'inCorso' || p.stato === 'fineRound') stanzeInCorso++;
    else if (p.stato === 'attesa') stanzeAttesa++;
    else if (p.stato === 'finePartita') stanzeFinite++;
  }
  res.json({
    ok: true,
    metriche: {
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      uptimeProcesso: Math.floor(process.uptime()),
      utentiOnline: io.sockets.sockets.size,
      stanzeTotali: stanze.size,
      stanzeInCorso,
      stanzeAttesa,
      stanzeFinite,
      timerTurniAttivi: timerTurni.size,
      memoria: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        external_mb: Math.round(mem.external / 1024 / 1024)
      },
      sistema: {
        loadavg_1m: load[0].toFixed(2),
        loadavg_5m: load[1].toFixed(2),
        loadavg_15m: load[2].toFixed(2),
        cpu_count: os.cpus().length,
        ram_libera_mb: Math.round(os.freemem() / 1024 / 1024),
        ram_totale_mb: Math.round(os.totalmem() / 1024 / 1024)
      },
      node: process.version,
      pid: process.pid
    }
  });
});
app.get('/api/isadmin/:nome', (req, res) => {
  res.json({ ok: true, admin: db.isAdmin(req.params.nome) });
});
app.post('/api/cambiapassword', richiediAuth, async (req, res) => {
  const { nuovaPassword, vecchiaPassword } = req.body;
  if (!nuovaPassword) return res.json({ ok: false, errore: 'Dati mancanti' });
  if (!db.haPasswordTemporanea(req.nomeAuth)) {
    if (!vecchiaPassword || !(await db.verificaPassword(req.nomeAuth, vecchiaPassword))) {
      return res.json({ ok: false, errore: 'Vecchia password errata' });
    }
  }
  res.json(await db.cambiaPassword(req.nomeAuth, nuovaPassword));
});
app.post('/api/eliminaaccount', richiediAuth, (req, res) => {
  res.json(db.cancellaUtente(req.nomeAuth));
});

// --- API Amici ---
app.get('/api/amici/:nome', richiediAuth, (req, res) => {
  res.json({ ok: true, amici: db.getAmici(req.params.nome), richieste: db.getRichiesteAmicizia(req.params.nome) });
});
app.post('/api/amici/richiedi', richiediAuth, (req, res) => {
  const r = db.richiediAmicizia(req.nomeAuth, req.body.amico);
  if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('richiestaAmicizia', { da: req.nomeAuth });
  res.json(r);
});
app.post('/api/amici/accetta', richiediAuth, (req, res) => {
  const r = db.accettaAmicizia(req.nomeAuth, req.body.amico);
  if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('amiciziaAccettata', { da: req.nomeAuth });
  res.json(r);
});
app.post('/api/amici/rifiuta', richiediAuth, (req, res) => { res.json(db.rifiutaAmicizia(req.nomeAuth, req.body.amico)); });
app.post('/api/amici/rimuovi', richiediAuth, (req, res) => { res.json(db.rimuoviAmico(req.nomeAuth, req.body.amico)); });
app.get('/api/amici/:nome/online', richiediAuth, (req, res) => {
  const amici = db.getAmici(req.params.nome).map(a => a.nome); const online = {};
  for (const a of amici) { online[a] = { online: false, stanza: null }; for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === a) { online[a] = { online: true, stanza: s.codiceStanza || null }; break; } }
  res.json({ ok: true, online });
});

// --- API Torneo ---
app.get('/api/torneo/attivo', (req, res) => {
  const t = torneo.getTorneoAttivo();
  if (!t) return res.json({ ok: true, torneo: null });
  if (t.stato === 'iscrizioni') res.json({ ok: true, torneo: torneo.getIscrizioni(t.id) });
  else res.json({ ok: true, torneo: torneo.getTabellone(t.id) });
});
app.get('/api/torneo/:id/tabellone', (req, res) => {
  const tab = torneo.getTabellone(parseInt(req.params.id));
  if (!tab) return res.json({ ok: false, errore: 'Torneo non trovato' });
  res.json({ ok: true, torneo: tab });
});
app.post('/api/torneo/iscriviti', richiediAuth, (req, res) => {
  const { torneoId, numeroSquadra } = req.body;
  const ip = ipDaReq(req);
  const risultato = torneo.iscriviGiocatore(torneoId, req.nomeAuth, ip, numeroSquadra);
  if (risultato.ok && risultato.torneoIniziato) {
    io.emit('torneoIniziato', { torneoId });
    avviaPartitePronteTorneo(torneoId);
  } else if (risultato.ok) {
    io.emit('torneoAggiornato', { torneoId });
  }
  res.json(risultato);
});
app.post('/api/torneo/lascia', richiediAuth, (req, res) => {
  const { torneoId } = req.body;
  const risultato = torneo.rimuoviIscrizione(torneoId, req.nomeAuth);
  if (risultato.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(risultato);
});

// --- API Admin ---
app.post('/api/admin/resetpassword', richiediAdmin, async (req, res) => {
  res.json(await db.resetPassword(req.body.nome));
});
app.post('/api/admin/cancellautente', richiediAdmin, (req, res) => {
  res.json(db.cancellaUtente(req.body.nome));
});
app.get('/api/admin/utenti', richiediAdmin, (req, res) => {
  res.json({ ok: true, utenti: db.getTuttiUtenti() });
});
app.get('/api/admin/online', richiediAdmin, (req, res) => {
  const utentiOnline = [];
  for (const [, s] of io.sockets.sockets) {
    if (s.nomeGiocatore) {
      const ip = s.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || s.handshake.address;
      utentiOnline.push({ nome: s.nomeGiocatore, stanza: s.codiceStanza || null, ip });
    }
  }
  const infoStanze = [];
  for (const [codice, partita] of stanze) {
    infoStanze.push({ codice, stato: partita.stato, giocatori: partita.giocatori.map(g => ({ nome: g.nome, disconnesso: g.disconnesso || false })), numGiocatori: partita.maxGiocatori });
  }
  res.json({ ok: true, utentiOnline, stanze: infoStanze });
});
app.post('/api/admin/torneo/crea', richiediAdmin, (req, res) => {
  const { nome, numGiocatori, modalitaVittoria, valoreVittoria, controlloIp, tipoGioco } = req.body;
  const risultato = torneo.creaTorneo(nome, numGiocatori, modalitaVittoria || 'punti', valoreVittoria || 31, controlloIp !== false, tipoGioco || 'maresciallo');
  if (risultato.ok) io.emit('torneoDisponibile', { torneoId: risultato.torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/annulla', richiediAdmin, (req, res) => {
  const { torneoId } = req.body;
  const risultato = torneo.annullaTorneo(torneoId);
  if (risultato.ok) io.emit('torneoAnnullato', { torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/assegna', richiediAdmin, (req, res) => {
  const { torneoId, nomeUtente, numeroSquadra } = req.body;
  const risultato = torneo.iscriviGiocatoreInSquadra(torneoId, nomeUtente, numeroSquadra, null);
  if (risultato.ok && risultato.torneoIniziato) { io.emit('torneoIniziato', { torneoId }); avviaPartitePronteTorneo(torneoId); }
  else if (risultato.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/sposta', richiediAdmin, (req, res) => {
  const { torneoId, nomeUtente, numeroSquadra } = req.body;
  const risultato = torneo.spostaGiocatore(torneoId, nomeUtente, numeroSquadra);
  if (risultato.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(risultato);
});

// Crea stanza per partita torneo
function creaStanzaTorneo(torneoId, round, posizione) {
  const tab = torneo.getTabellone(torneoId);
  if (!tab) return;
  const roundData = tab.rounds.find(r => r.chiave === round);
  if (!roundData) return;
  const partitaData = roundData.partite.find(p => p.posizione === posizione);
  if (!partitaData || !partitaData.squadraA || !partitaData.squadraB) return;
  if (partitaData.stato !== 'attesa') return;
  const codice = 'T' + generaCodiceStanza().slice(1);
  const tipo = tab.tipoGioco || 'maresciallo';
  const partita = creaPartita(tipo, codice, tab.valoreVittoria, 2);
  partita.tipoGioco = tipo;
  stanze.set(codice, partita);
  segnaAttivita(codice);
  torneo.setCodiceStanza(torneoId, round, posizione, codice);
  const tutti = [...partitaData.squadraA.giocatori, ...partitaData.squadraB.giocatori];
  for (const [, s] of io.sockets.sockets) {
    if (s.nomeGiocatore && tutti.includes(s.nomeGiocatore)) {
      io.to(s.id).emit('torneoPartitaPronta', { torneoId, codiceStanza: codice, round, posizione, squadraA: partitaData.squadraA, squadraB: partitaData.squadraB });
    }
  }
}
function avviaPartitePronteTorneo(torneoId) {
  const pronte = torneo.getPartitePronte(torneoId);
  for (const p of pronte) creaStanzaTorneo(torneoId, p.round, p.posizione);
}

// Stanze di gioco
const stanze = new Map();
const disconnessioniPendenti = new Map();
const timerTurni = new Map(); // codice -> { timer, scadenza, giocatoreId }
const chatLobbyMessaggi = [];

const TURN_TIMEOUT_MS = 180 * 1000;

function cancellaTimerTurno(codice) {
  const t = timerTurni.get(codice);
  if (t) { clearTimeout(t.timer); timerTurni.delete(codice); }
}

// Pulisce tutte le risorse legate a una stanza eliminata.
// Chiamare PRIMA di stanze.delete per garantire consistenza.
function cleanupStanza(codice) {
  cancellaTimerTurno(codice);
  // Pulisci eventuali disconnessioni pendenti legate alla stanza
  for (const [chiave, timer] of disconnessioniPendenti) {
    if (chiave.startsWith(codice + '_')) {
      clearTimeout(timer);
      disconnessioniPendenti.delete(chiave);
    }
  }
}

// Pulizia periodica stanze stale (> 30 min inattive, o finePartita > 10 min)
const ultimoAttivoStanza = new Map(); // codice -> timestamp
function segnaAttivita(codice) { if (codice) ultimoAttivoStanza.set(codice, Date.now()); }
const STANZA_STALE_MS = 30 * 60 * 1000;
const STANZA_FINE_MS = 10 * 60 * 1000;
setInterval(() => {
  const ora = Date.now();
  for (const [codice, partita] of stanze) {
    const ultimo = ultimoAttivoStanza.get(codice) || 0;
    const inattivita = ora - ultimo;
    const tuttiDisconnessi = partita.giocatori.every(g => g.disconnesso || g.id === BOT_ID);
    let daEliminare = false;
    if (partita.stato === 'finePartita' && inattivita > STANZA_FINE_MS) daEliminare = true;
    else if (tuttiDisconnessi && inattivita > STANZA_STALE_MS) daEliminare = true;
    if (daEliminare) {
      cleanupStanza(codice);
      stanze.delete(codice);
      ultimoAttivoStanza.delete(codice);
      console.log(`Pulizia: stanza ${codice} eliminata (stato=${partita.stato}, inattivita=${Math.round(inattivita/1000)}s)`);
    }
  }
}, 5 * 60 * 1000).unref();

function avviaTimerTurno(codice) {
  cancellaTimerTurno(codice);
  const partita = stanze.get(codice);
  if (!partita || partita.stato !== 'inCorso') return;
  const corrente = partita.getGiocatoreCorrente?.();
  if (!corrente) return;
  // Se il turno e' del bot, il timer non serve (il bot risponde subito).
  if (corrente.id === BOT_ID) return;
  const scadenza = Date.now() + TURN_TIMEOUT_MS;
  const timer = setTimeout(() => forfeitPerTimeout(codice, corrente.id), TURN_TIMEOUT_MS);
  timerTurni.set(codice, { timer, scadenza, giocatoreId: corrente.id });
  segnaAttivita(codice);
  io.to(codice).emit('turnoTimer', { giocatoreId: corrente.id, scadenza });
}

// === BOT ===
function isBotTurn(partita) {
  if (!partita || !partita.vsBot) return false;
  const corrente = partita.getGiocatoreCorrente?.();
  return corrente && corrente.id === BOT_ID;
}

function botGioca(codice) {
  const partita = stanze.get(codice);
  if (!partita || partita.stato !== 'inCorso') return;
  if (!isBotTurn(partita)) return;

  // Difensivo: verifica che il bot esista ancora nella partita.
  // Se per qualche motivo il bot e' stato rimosso, chiudi la stanza (lascia l'umano fuori).
  const bot = partita.giocatori.find(g => g.id === BOT_ID);
  if (!bot) {
    console.error(`botGioca: bot non presente in stanza ${codice}, chiusura stanza`);
    cleanupStanza(codice);
    stanze.delete(codice);
    ultimoAttivoStanza.delete(codice);
    io.to(codice).emit('errore', 'Partita terminata per errore interno');
    return;
  }

  let mossa;
  try {
    mossa = scegliMossaBot(partita);
  } catch (e) {
    console.error(`botGioca errore scegliMossaBot:`, e.message);
    return;
  }
  if (!mossa) return;

  const c = bot.mano.find(c => c.id === mossa.cartaId);
  const cartaInfo = c ? { valore: c.valore, seme: c.seme, id: c.id } : null;
  const risultato = partita.eseguiMossa(BOT_ID, mossa.cartaId, mossa.cartePresaIds);
  if (!risultato.valida) {
    console.warn(`botGioca mossa invalida (${mossa.cartaId}): ${risultato.errore}`);
    return;
  }

  if (partita.stato === 'fineRound' || partita.stato === 'finePartita') {
    const puntiRound = partita.calcolaPuntiRound();
    const dettagliPunti = partita.calcolaPuntiRoundDettagliato();
    const finePartita = partita.stato === 'finePartita';
    const vincitore = finePartita ? partita.getVincitore() : null;
    // NIENTE stats aggiornate in partita vs bot
    const umano = partita.giocatori.find(g => g.id !== BOT_ID);
    if (umano) {
      const sqMia = partita.getSquadraDelGiocatore(umano.id);
      const sqAvv = 1 - sqMia;
      io.to(umano.id).emit('fineRound', {
        stato: partita.getStato(umano.id),
        puntiRound,
        dettagliGiocatore: dettagliPunti[sqMia],
        dettagliAvversario: dettagliPunti[sqAvv],
        finePartita,
        vincitore,
        cartaGiocata: cartaInfo,
        giocatoreId: BOT_ID
      });
    }
    return;
  }

  // Stato aggiornato all'umano
  const umano = partita.giocatori.find(g => g.id !== BOT_ID);
  if (umano) {
    io.to(umano.id).emit('statoAggiornato', {
      ...partita.getStato(umano.id),
      cartaGiocata: cartaInfo,
      giocatoreId: BOT_ID
    });
  }

  // Se e' ancora il turno del bot (non dovrebbe ma per sicurezza)
  if (isBotTurn(partita)) {
    setTimeout(() => botGioca(codice), 800 + Math.random() * 600);
  }
}

function forfeitPerTimeout(codice, giocatoreIdAtteso) {
  const partita = stanze.get(codice);
  if (!partita) return;
  const giocatore = partita.giocatori.find(g => g.id === giocatoreIdAtteso);
  if (!giocatore) return;
  if (partita.stato !== 'inCorso' && partita.stato !== 'fineRound') return;
  const corrente = partita.getGiocatoreCorrente?.();
  if (!corrente || corrente.id !== giocatoreIdAtteso) return; // turno gia' cambiato

  console.log(`Timeout turno: ${giocatore.nome} (${codice}) ha sforato i 180s`);
  cancellaTimerTurno(codice);
  const nome = giocatore.nome;

  db.aggiornaStats(nome, { giocate: 1, perse: 1, punti: -1 });
  for (const g of partita.giocatori) {
    if (g.nome !== nome) db.aggiornaStats(g.nome, { giocate: 1, vinte: 1, punti: 1 });
  }
  const partitaTorneo = torneo.getPartitaDaCodice(codice);
  if (partitaTorneo) {
    const sqAvv = partita.giocatori.find(g => g.nome !== nome);
    const vincitoreId = sqAvv ? (partita.getSquadraDelGiocatore(sqAvv.id) === 0 ? partitaTorneo.squadra_a : partitaTorneo.squadra_b) : partitaTorneo.squadra_b;
    const ris = torneo.registraRisultato(partitaTorneo.torneo_id, partitaTorneo.round, partitaTorneo.posizione, vincitoreId, 0, 0);
    if (ris.completato) io.emit('torneoCompletato', { torneoId: partitaTorneo.torneo_id });
    else { io.emit('torneoAggiornato', { torneoId: partitaTorneo.torneo_id }); if (ris.prossimaPartitaPronta) creaStanzaTorneo(partitaTorneo.torneo_id, ris.round, ris.posizione); }
  }
  io.to(codice).emit('avversarioAbbandonato', { nome, motivo: 'timeout' });
  partita.rimuoviGiocatore(giocatore.id);
  if (partita.giocatori.filter(g => !g.disconnesso).length === 0) {
    cleanupStanza(codice);
    stanze.delete(codice);
    ultimoAttivoStanza.delete(codice);
  }
}

// Genera codice stanza
function generaCodiceStanza() {
  const caratteri = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codice = '';
  for (let i = 0; i < 6; i++) {
    codice += caratteri.charAt(Math.floor(Math.random() * caratteri.length));
  }
  return codice;
}

io.on('connection', (socket) => {
  console.log(`Giocatore connesso: ${socket.id}`);

  // Autenticazione socket: richiede un token rilasciato al login.
  socket.on('autenticato', ({ nome, token }) => {
    const nomeValidato = db.validaSessione(token);
    if (nomeValidato && nomeValidato === nome) {
      socket.nomeGiocatore = nomeValidato;
    } else {
      socket.nomeGiocatore = null;
      socket.emit('sessioneNonValida');
    }
  });

  const richiediSocketAuth = () => {
    if (!socket.nomeGiocatore) { socket.emit('errore', 'Non autenticato'); return false; }
    return true;
  };

  socket.on('chatLobbyMessaggio', ({ testo }) => {
    if (!socket.nomeGiocatore || !testo || !testo.trim()) return;
    const msg = { nome: socket.nomeGiocatore, testo: testo.trim().slice(0, 200), timestamp: Date.now() };
    chatLobbyMessaggi.push(msg); if (chatLobbyMessaggi.length > 50) chatLobbyMessaggi.shift();
    for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore && !s.codiceStanza) io.to(s.id).emit('chatLobbyMessaggio', msg);
  });
  socket.on('chatLobbyStoria', () => socket.emit('chatLobbyStoria', chatLobbyMessaggi));

  socket.on('invitaAmico', ({ amico, codiceStanza }) => {
    if (!socket.nomeGiocatore || !amico || !codiceStanza) return;
    for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === amico) io.to(s.id).emit('invitoStanza', { da: socket.nomeGiocatore, codiceStanza });
  });

  socket.on('uniscitiPartitaTorneo', ({ codiceStanza }) => {
    if (!richiediSocketAuth()) return;
    const nome = socket.nomeGiocatore;
    const partita = stanze.get(codiceStanza);
    if (!partita) { socket.emit('errore', 'Stanza torneo non trovata'); return; }
    const giocatoreEsistente = partita.giocatori.find(g => g.nome === nome);
    if (giocatoreEsistente) {
      giocatoreEsistente.id = socket.id;
      giocatoreEsistente.disconnesso = false;
      socket.join(codiceStanza); socket.codiceStanza = codiceStanza;
      if (partita.stato !== 'attesa') socket.emit('partitaIniziata', partita.getStato(socket.id));
      return;
    }
    if (partita.giocatori.length >= partita.maxGiocatori) { socket.emit('errore', 'Stanza piena'); return; }
    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codiceStanza); socket.codiceStanza = codiceStanza;
    io.to(codiceStanza).emit('giocatoreUnito', { giocatori: partita.giocatori.map(g => ({ id: g.id, nome: g.nome })), maxGiocatori: partita.maxGiocatori });
    if (partita.giocatori.length === partita.maxGiocatori) {
      partita.iniziaPartita();
      for (const g of partita.giocatori) io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
      avviaTimerTurno(codiceStanza);
    }
  });

  // Richiedi stanze disponibili
  socket.on('richiediStanzeDisponibili', () => {
    const stanzeDisponibili = [];
    for (const [codice, partita] of stanze) {
      if (partita.giocatori.length < partita.maxGiocatori && partita.stato === 'attesa') {
        stanzeDisponibili.push({
          codice: codice,
          creatore: partita.giocatori[0].nome,
          puntiVittoria: partita.puntiVittoria,
          numGiocatori: partita.maxGiocatori,
          giocatoriConnessi: partita.giocatori.length,
          tipoGioco: partita.tipoGioco || 'maresciallo'
        });
      }
    }
    socket.emit('stanzeDisponibili', stanzeDisponibili);
  });

  // Crea nuova stanza
  socket.on('creaStanza', ({ puntiVittoria, numGiocatori, tipoGioco, assoPigliaTutto, vsBot }) => {
    if (!richiediSocketAuth()) return;
    const nome = socket.nomeGiocatore;
    const codice = generaCodiceStanza();
    const tipo = ['scientifico', 'classica', 'maresciallo'].includes(tipoGioco) ? tipoGioco : 'maresciallo';
    const puntiValidi = TIPI_2_GIOCATORI.includes(tipo) ? [11, 21, 31] : [11, 21, 31, 41, 51];
    const defPunti = tipo === 'classica' ? 11 : (tipo === 'scientifico' ? 21 : 31);
    const punti = puntiValidi.includes(puntiVittoria) ? puntiVittoria : defPunti;
    // vsBot: forza 2 giocatori
    const num = (vsBot || TIPI_2_GIOCATORI.includes(tipo)) ? 2 : ([2, 4].includes(numGiocatori) ? numGiocatori : 2);
    const partita = creaPartita(tipo, codice, punti, num, { assoPigliaTutto: !!assoPigliaTutto });
    partita.tipoGioco = tipo;
    partita.vsBot = !!vsBot;
    partita.aggiungiGiocatore(socket.id, nome);

    stanze.set(codice, partita);
    segnaAttivita(codice);
    socket.join(codice);
    socket.codiceStanza = codice;

    if (vsBot) {
      // Aggiungi il bot come secondo giocatore e avvia subito
      partita.aggiungiGiocatore(BOT_ID, BOT_NOME);
      partita.iniziaPartita();
      socket.emit('stanzaCreata', { codice, nome, numGiocatori: num, tipoGioco: tipo });
      socket.emit('partitaIniziata', partita.getStato(socket.id));
      console.log(`Stanza ${codice} vs BOT creata da ${nome} (${tipo})`);
      // Se tocca al bot iniziare
      if (isBotTurn(partita)) setTimeout(() => botGioca(codice), 1000);
      return;
    }

    socket.emit('stanzaCreata', { codice, nome, numGiocatori: num, tipoGioco: tipo });
    console.log(`Stanza ${codice} creata da ${nome} (${tipo}, ${num} giocatori)`);
  });

  // Unisciti a stanza esistente
  socket.on('uniscitiStanza', ({ codice }) => {
    if (!richiediSocketAuth()) return;
    const nome = socket.nomeGiocatore;
    const partita = stanze.get(codice);

    if (!partita) {
      socket.emit('errore', 'Stanza non trovata');
      return;
    }

    // Controlla se è una riconnessione (giocatore con stesso nome, disconnesso o meno)
    const chiaveDisc = `${codice}_${nome}`;
    const giocatoreEsistente = partita.giocatori.find(g => g.nome === nome);

    if (giocatoreEsistente && (partita.stato === 'inCorso' || partita.stato === 'fineRound' || partita.stato === 'finePartita')) {
      const vecchioSocket = io.sockets.sockets.get(giocatoreEsistente.id);
      if (vecchioSocket) {
        vecchioSocket.codiceStanza = null;
        vecchioSocket.disconnect(true);
      }

      giocatoreEsistente.id = socket.id;
      giocatoreEsistente.disconnesso = false;

      if (disconnessioniPendenti.has(chiaveDisc)) {
        clearTimeout(disconnessioniPendenti.get(chiaveDisc));
        disconnessioniPendenti.delete(chiaveDisc);
      }

      socket.join(codice);
      socket.codiceStanza = codice;

      socket.emit('partitaIniziata', partita.getStato(socket.id));
      io.to(codice).emit('giocatoreRiconnesso', { nome });
      console.log(`Giocatore ${nome} riconnesso nella stanza ${codice}`);
      if (partita.stato === 'inCorso') avviaTimerTurno(codice);
      return;
    }

    if (partita.giocatori.length >= partita.maxGiocatori) {
      socket.emit('errore', 'Stanza piena');
      return;
    }

    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codice);
    socket.codiceStanza = codice;

    socket.emit('unitoAStanza', { codice, nome, tipoGioco: partita.tipoGioco || 'maresciallo' });

    // Notifica tutti i giocatori nella stanza
    io.to(codice).emit('giocatoreUnito', {
      giocatori: partita.giocatori.map(g => ({ id: g.id, nome: g.nome })),
      maxGiocatori: partita.maxGiocatori
    });

    // Inizia la partita quando la stanza è piena
    if (partita.giocatori.length === partita.maxGiocatori) {
      partita.iniziaPartita();

      for (const g of partita.giocatori) {
        io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
      }

      console.log(`Partita iniziata nella stanza ${codice} (${partita.maxGiocatori} giocatori)`);
      avviaTimerTurno(codice);
    }
  });

  // Gioca carta
  socket.on('giocaCarta', ({ cartaId, cartePresaIds }) => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) {
      socket.emit('errore', 'Partita non trovata');
      return;
    }

    // Verifica che il giocatore corrente sia questo socket — previene race
    // tra mossa e forfeit da timer che potrebbero sovrapporsi.
    const corrente = partita.getGiocatoreCorrente?.();
    if (!corrente || corrente.id !== socket.id) {
      socket.emit('mossaNonValida', 'Non e\' il tuo turno');
      return;
    }

    // Cancella il timer PRIMA di eseguire la mossa, cosi' anche se e' scaduto
    // il callback di forfeit non tentera' modifiche sullo stato gia' aggiornato.
    cancellaTimerTurno(codice);

    // Trova la carta giocata prima di eseguire la mossa
    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    const cartaGiocata = giocatore?.mano.find(c => c.id === cartaId);
    const cartaInfo = cartaGiocata ? {
      valore: cartaGiocata.valore,
      seme: cartaGiocata.seme,
      id: cartaGiocata.id
    } : null;

    const risultato = partita.eseguiMossa(socket.id, cartaId, cartePresaIds || []);

    if (!risultato.valida) {
      socket.emit('mossaNonValida', risultato.errore);
      // Ripristina il timer se la mossa e' rifiutata (per non lasciare lo stato senza timer)
      if (partita.stato === 'inCorso' && !partita.vsBot) avviaTimerTurno(codice);
      return;
    }

    // Se è fine round o fine partita
    if (partita.stato === 'fineRound' || partita.stato === 'finePartita') {
      const puntiRound = partita.calcolaPuntiRound();
      const dettagliPunti = partita.calcolaPuntiRoundDettagliato();
      const finePartita = partita.stato === 'finePartita';
      const vincitore = finePartita ? partita.getVincitore() : null;

      // Aggiorna stats a fine partita (mai vs bot)
      if (finePartita && !partita._statsAggiornate && !partita.vsBot) {
        partita._statsAggiornate = true;
        for (const g of partita.giocatori) {
          const sqMia = partita.getSquadraDelGiocatore(g.id);
          if (vincitore === sqMia) {
            db.aggiornaStats(g.nome, { giocate: 1, vinte: 1, punti: 1 });
          } else {
            db.aggiornaStats(g.nome, { giocate: 1, perse: 1, punti: -1 });
          }
        }
        // Gestione torneo
        const codice = socket.codiceStanza;
        const partitaTorneo = torneo.getPartitaDaCodice(codice);
        if (partitaTorneo) {
          const vincitoreId = vincitore === 0 ? partitaTorneo.squadra_a : partitaTorneo.squadra_b;
          const ris = torneo.registraRisultato(partitaTorneo.torneo_id, partitaTorneo.round, partitaTorneo.posizione, vincitoreId, 0, 0);
          if (ris.completato) io.emit('torneoCompletato', { torneoId: partitaTorneo.torneo_id });
          else { io.emit('torneoAggiornato', { torneoId: partitaTorneo.torneo_id }); if (ris.prossimaPartitaPronta) creaStanzaTorneo(partitaTorneo.torneo_id, ris.round, ris.posizione); }
        }
      }

      for (const g of partita.giocatori) {
        if (g.id === BOT_ID) continue;
        const stato = partita.getStato(g.id);
        const sqMia = partita.getSquadraDelGiocatore(g.id);
        const sqAvv = 1 - sqMia;
        const codice = socket.codiceStanza;
        const partitaTorneo = finePartita ? torneo.getPartitaDaCodice(codice) : null;
        io.to(g.id).emit('fineRound', {
          stato,
          puntiRound,
          dettagliGiocatore: dettagliPunti[sqMia],
          dettagliAvversario: dettagliPunti[sqAvv],
          finePartita,
          vincitore,
          cartaGiocata: cartaInfo,
          giocatoreId: socket.id,
          torneo: partitaTorneo ? { torneoId: partitaTorneo.torneo_id, round: partitaTorneo.round, finale: partitaTorneo.round === 'finale' } : null
        });
      }
    } else {
      // Aggiorna stato per entrambi i giocatori (skip bot)
      for (const g of partita.giocatori) {
        if (g.id === BOT_ID) continue;
        io.to(g.id).emit('statoAggiornato', {
          ...partita.getStato(g.id),
          cartaGiocata: cartaInfo,
          giocatoreId: socket.id
        });
      }
      if (partita.vsBot) {
        if (isBotTurn(partita)) setTimeout(() => botGioca(codice), 800 + Math.random() * 700);
      } else {
        avviaTimerTurno(codice);
      }
    }
  });

  // Richiedi combinazioni possibili
  socket.on('richiediCombinazioni', (cartaId) => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) return;

    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;

    const carta = giocatore.mano.find(c => c.id === cartaId);
    if (!carta) return;

    const combinazioni = partita.trovaCombinazioni(carta, partita.tavolo);

    // Aggiungi opzione "posa" se non ci sono combinazioni obbligatorie
    // O se l'unica combinazione è con carta identica (e non è scopa)
    const haPresaObbligatoria = combinazioni.some(comb => {
      // Verifica se è una presa con carta identica che non è scopa
      const conIdentica = comb.some(c => c.seme === carta.seme && c.valore === carta.valore);
      const sarebbeScopa = comb.length === partita.tavolo.length;
      return !conIdentica || sarebbeScopa;
    });

    socket.emit('combinazioniDisponibili', {
      cartaId,
      combinazioni: combinazioni.map(comb => comb.map(c => c.id)),
      puoiPosare: !haPresaObbligatoria || combinazioni.length === 0
    });
  });

  // Nuovo round
  socket.on('nuovoRound', () => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita || partita.stato !== 'fineRound') return;

    partita.nuovoRound();

    for (const g of partita.giocatori) {
      if (g.id === BOT_ID) continue;
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
    }
    if (partita.vsBot) {
      if (isBotTurn(partita)) setTimeout(() => botGioca(codice), 1000);
    } else {
      avviaTimerTurno(codice);
    }
  });

  // Nuova partita
  socket.on('nuovaPartita', () => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) return;

    // Reset punteggi
    for (const g of partita.giocatori) {
      g.puntiTotali = 0;
    }
    partita._statsAggiornate = false;

    partita.iniziaPartita();

    for (const g of partita.giocatori) {
      if (g.id === BOT_ID) continue;
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
    }
    if (partita.vsBot) {
      if (isBotTurn(partita)) setTimeout(() => botGioca(codice), 1000);
    } else {
      avviaTimerTurno(codice);
    }
  });

  // Reazione emoji in partita
  socket.on('reazione', ({ emoji }) => {
    const codice = socket.codiceStanza;
    if (!codice || !emoji) return;
    const allowed = ['👍','😂','🤔','🔥','👏','😱'];
    if (!allowed.includes(emoji)) return;
    io.to(codice).emit('reazione', { nome: socket.nomeGiocatore, emoji });
  });

  // Chat in partita
  socket.on('chatPartita', ({ testo }) => {
    const codice = socket.codiceStanza;
    if (!codice || !testo || typeof testo !== 'string') return;
    const t = testo.slice(0, 100).trim();
    if (!t) return;
    io.to(codice).emit('chatPartita', { nome: socket.nomeGiocatore, testo: t });
  });

  // Torna alla lobby (solo se partita finita)
  socket.on('tornaLobby', () => {
    const codice = socket.codiceStanza;
    if (!codice) return;
    const partita = stanze.get(codice);
    if (!partita) return;
    if (partita.stato !== 'finePartita') return;
    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;
    partita.rimuoviGiocatore(socket.id);
    socket.leave(codice);
    socket.codiceStanza = null;
    io.to(codice).emit('avversarioAbbandonato', { nome: giocatore.nome });
    if (partita.giocatori.length === 0) {
      cleanupStanza(codice);
      stanze.delete(codice);
      ultimoAttivoStanza.delete(codice);
      console.log(`Stanza ${codice} eliminata`);
    }
  });

  // Disconnessione
  socket.on('disconnect', () => {
    console.log(`Giocatore disconnesso: ${socket.id}`);

    const codice = socket.codiceStanza;
    if (!codice) return;

    const partita = stanze.get(codice);
    if (!partita) return;

    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;

    cancellaTimerTurno(codice);

    // Partite vs bot: cancella subito alla disconnessione (no penalita', no attesa)
    if (partita.vsBot) {
      cleanupStanza(codice);
      stanze.delete(codice);
      ultimoAttivoStanza.delete(codice);
      console.log(`Stanza vs bot ${codice} eliminata (disconnessione)`);
      return;
    }

    if (partita.stato === 'inCorso' || partita.stato === 'fineRound') {
      giocatore.disconnesso = true;
      const nome = giocatore.nome;
      const chiaveDisc = `${codice}_${nome}`;

      io.to(codice).emit('avversarioDisconnesso', { nome, timeout: 180 });
      console.log(`Giocatore ${nome} disconnesso dalla stanza ${codice}, attendo riconnessione...`);

      const timer = setTimeout(() => {
        disconnessioniPendenti.delete(chiaveDisc);
        if (!partita.vsBot) {
          db.aggiornaStats(nome, { giocate: 1, perse: 1, punti: -1 });
          for (const g of partita.giocatori) {
            if (g.nome !== nome && g.id !== BOT_ID) db.aggiornaStats(g.nome, { giocate: 1, vinte: 1, punti: 1 });
          }
        }
        const partitaTorneo = torneo.getPartitaDaCodice(codice);
        if (partitaTorneo) {
          const sqAvv = partita.giocatori.find(g => g.nome !== nome);
          const vincitoreId = sqAvv ? (partita.getSquadraDelGiocatore(sqAvv.id) === 0 ? partitaTorneo.squadra_a : partitaTorneo.squadra_b) : partitaTorneo.squadra_b;
          const ris = torneo.registraRisultato(partitaTorneo.torneo_id, partitaTorneo.round, partitaTorneo.posizione, vincitoreId, 0, 0);
          if (ris.completato) io.emit('torneoCompletato', { torneoId: partitaTorneo.torneo_id });
          else { io.emit('torneoAggiornato', { torneoId: partitaTorneo.torneo_id }); if (ris.prossimaPartitaPronta) creaStanzaTorneo(partitaTorneo.torneo_id, ris.round, ris.posizione); }
        }
        partita.rimuoviGiocatore(giocatore.id);
        io.to(codice).emit('avversarioAbbandonato', { nome });
        console.log(`Giocatore ${nome} rimosso dalla stanza ${codice} (timeout)`);

        if (partita.giocatori.filter(g => !g.disconnesso).length === 0) {
          cleanupStanza(codice);
          stanze.delete(codice);
          ultimoAttivoStanza.delete(codice);
          console.log(`Stanza ${codice} eliminata`);
        }
      }, 180000);

      disconnessioniPendenti.set(chiaveDisc, timer);
    } else {
      partita.rimuoviGiocatore(socket.id);
      io.to(codice).emit('avversarioAbbandonato', { nome: giocatore.nome });

      if (partita.giocatori.length === 0) {
        cleanupStanza(codice);
        stanze.delete(codice);
        ultimoAttivoStanza.delete(codice);
        console.log(`Stanza ${codice} eliminata`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server Scopa Maresciallo in esecuzione su http://localhost:${PORT}`);
  const torneoAttivo = torneo.getTorneoAttivo();
  if (torneoAttivo && torneoAttivo.stato === 'inCorso') {
    torneo.resetPartiteInCorso(torneoAttivo.id);
    avviaPartitePronteTorneo(torneoAttivo.id);
    console.log(`Torneo "${torneoAttivo.nome}" ripristinato`);
  }
});
