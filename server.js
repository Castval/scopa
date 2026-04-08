const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ScopaMaresciallo } = require('./games/maresciallo');
const { ScoponeScientifico } = require('./games/scientifico');

function creaPartita(tipo, codice, punti, num) {
  if (tipo === 'scientifico') return new ScoponeScientifico(codice, punti);
  return new ScopaMaresciallo(codice, punti, num);
}
const db = require('./db');
const torneo = require('./tournament');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Auth ---
app.post('/api/registra', (req, res) => {
  const { nome, email, password, citta } = req.body;
  res.json(db.registra(nome, email, password, citta));
});
app.post('/api/login', (req, res) => {
  const { nome, password } = req.body;
  res.json(db.login(nome, password));
});
app.get('/api/stats/:nome', (req, res) => {
  const stats = db.getStats(req.params.nome);
  if (!stats) return res.json({ ok: false, errore: 'Utente non trovato' });
  res.json({ ok: true, stats });
});
app.get('/api/classifica', (req, res) => {
  res.json({ ok: true, classifica: db.getClassifica() });
});
app.get('/api/isadmin/:nome', (req, res) => {
  res.json({ ok: true, admin: db.isAdmin(req.params.nome) });
});
app.post('/api/cambiapassword', (req, res) => {
  const { nome, nuovaPassword } = req.body;
  if (!nome || !nuovaPassword) return res.json({ ok: false, errore: 'Dati mancanti' });
  res.json(db.cambiaPassword(nome, nuovaPassword));
});
app.post('/api/eliminaaccount', (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.json({ ok: false, errore: 'Dati mancanti' });
  res.json(db.cancellaUtente(nome));
});

// --- API Amici ---
app.get('/api/amici/:nome', (req, res) => { res.json({ ok: true, amici: db.getAmici(req.params.nome), richieste: db.getRichiesteAmicizia(req.params.nome) }); });
app.post('/api/amici/richiedi', (req, res) => { const r = db.richiediAmicizia(req.body.utente, req.body.amico); if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('richiestaAmicizia', { da: req.body.utente }); res.json(r); });
app.post('/api/amici/accetta', (req, res) => { const r = db.accettaAmicizia(req.body.utente, req.body.amico); if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('amiciziaAccettata', { da: req.body.utente }); res.json(r); });
app.post('/api/amici/rifiuta', (req, res) => { res.json(db.rifiutaAmicizia(req.body.utente, req.body.amico)); });
app.post('/api/amici/rimuovi', (req, res) => { res.json(db.rimuoviAmico(req.body.utente, req.body.amico)); });
app.get('/api/amici/:nome/online', (req, res) => {
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
app.post('/api/torneo/iscriviti', (req, res) => {
  const { torneoId, nome, numeroSquadra } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const risultato = torneo.iscriviGiocatore(torneoId, nome, ip, numeroSquadra);
  if (risultato.ok && risultato.torneoIniziato) {
    io.emit('torneoIniziato', { torneoId });
    avviaPartitePronteTorneo(torneoId);
  } else if (risultato.ok) {
    io.emit('torneoAggiornato', { torneoId });
  }
  res.json(risultato);
});
app.post('/api/torneo/lascia', (req, res) => {
  const { torneoId, nome } = req.body;
  const risultato = torneo.rimuoviIscrizione(torneoId, nome);
  if (risultato.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(risultato);
});

// --- API Admin ---
app.post('/api/admin/resetpassword', (req, res) => {
  const { admin, nome } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  res.json(db.resetPassword(nome));
});
app.post('/api/admin/cancellautente', (req, res) => {
  const { admin, nome } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  res.json(db.cancellaUtente(nome));
});
app.get('/api/admin/utenti', (req, res) => {
  const nome = req.query.nome;
  if (!nome || !db.isAdmin(nome)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  res.json({ ok: true, utenti: db.getTuttiUtenti() });
});
app.get('/api/admin/online', (req, res) => {
  const nome = req.query.nome;
  if (!nome || !db.isAdmin(nome)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
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
app.post('/api/admin/torneo/crea', (req, res) => {
  const { admin, nome, numGiocatori, modalitaVittoria, valoreVittoria, controlloIp, tipoGioco } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  const risultato = torneo.creaTorneo(nome, numGiocatori, modalitaVittoria || 'punti', valoreVittoria || 31, controlloIp !== false, tipoGioco || 'maresciallo');
  if (risultato.ok) io.emit('torneoDisponibile', { torneoId: risultato.torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/annulla', (req, res) => {
  const { admin, torneoId } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  const risultato = torneo.annullaTorneo(torneoId);
  if (risultato.ok) io.emit('torneoAnnullato', { torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/assegna', (req, res) => {
  const { admin, torneoId, nomeUtente, numeroSquadra } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
  const risultato = torneo.iscriviGiocatoreInSquadra(torneoId, nomeUtente, numeroSquadra, null);
  if (risultato.ok && risultato.torneoIniziato) { io.emit('torneoIniziato', { torneoId }); avviaPartitePronteTorneo(torneoId); }
  else if (risultato.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(risultato);
});
app.post('/api/admin/torneo/sposta', (req, res) => {
  const { admin, torneoId, nomeUtente, numeroSquadra } = req.body;
  if (!admin || !db.isAdmin(admin)) return res.status(403).json({ ok: false, errore: 'Non autorizzato' });
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
const chatLobbyMessaggi = [];

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

  socket.on('autenticato', ({ nome }) => { if (nome) socket.nomeGiocatore = nome; });

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

  socket.on('uniscitiPartitaTorneo', ({ codiceStanza, nome }) => {
    const partita = stanze.get(codiceStanza);
    if (!partita) { socket.emit('errore', 'Stanza torneo non trovata'); return; }
    const giocatoreEsistente = partita.giocatori.find(g => g.nome === nome);
    if (giocatoreEsistente) {
      giocatoreEsistente.id = socket.id;
      giocatoreEsistente.disconnesso = false;
      socket.join(codiceStanza); socket.codiceStanza = codiceStanza; socket.nomeGiocatore = nome;
      if (partita.stato !== 'attesa') socket.emit('partitaIniziata', partita.getStato(socket.id));
      return;
    }
    if (partita.giocatori.length >= partita.maxGiocatori) { socket.emit('errore', 'Stanza piena'); return; }
    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codiceStanza); socket.codiceStanza = codiceStanza; socket.nomeGiocatore = nome;
    io.to(codiceStanza).emit('giocatoreUnito', { giocatori: partita.giocatori.map(g => ({ id: g.id, nome: g.nome })), maxGiocatori: partita.maxGiocatori });
    if (partita.giocatori.length === partita.maxGiocatori) {
      partita.iniziaPartita();
      for (const g of partita.giocatori) io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
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
  socket.on('creaStanza', ({ nome, puntiVittoria, numGiocatori, tipoGioco }) => {
    const codice = generaCodiceStanza();
    const tipo = tipoGioco === 'scientifico' ? 'scientifico' : 'maresciallo';
    const puntiValidi = tipo === 'scientifico' ? [11, 21, 31] : [11, 21, 31, 41, 51];
    const punti = puntiValidi.includes(puntiVittoria) ? puntiVittoria : (tipo === 'scientifico' ? 21 : 31);
    const num = tipo === 'scientifico' ? 2 : ([2, 4].includes(numGiocatori) ? numGiocatori : 2);
    const partita = creaPartita(tipo, codice, punti, num);
    partita.tipoGioco = tipo;
    partita.aggiungiGiocatore(socket.id, nome);

    stanze.set(codice, partita);
    socket.join(codice);
    socket.codiceStanza = codice;
    socket.nomeGiocatore = nome;

    socket.emit('stanzaCreata', { codice, nome, numGiocatori: num, tipoGioco: tipo });
    console.log(`Stanza ${codice} creata da ${nome} (${tipo}, ${num} giocatori)`);
  });

  // Unisciti a stanza esistente
  socket.on('uniscitiStanza', ({ codice, nome }) => {
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
      socket.nomeGiocatore = nome;

      socket.emit('partitaIniziata', partita.getStato(socket.id));
      io.to(codice).emit('giocatoreRiconnesso', { nome });
      console.log(`Giocatore ${nome} riconnesso nella stanza ${codice}`);
      return;
    }

    if (partita.giocatori.length >= partita.maxGiocatori) {
      socket.emit('errore', 'Stanza piena');
      return;
    }

    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codice);
    socket.codiceStanza = codice;
    socket.nomeGiocatore = nome;

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
      return;
    }

    // Se è fine round o fine partita
    if (partita.stato === 'fineRound' || partita.stato === 'finePartita') {
      const puntiRound = partita.calcolaPuntiRound();
      const dettagliPunti = partita.calcolaPuntiRoundDettagliato();
      const finePartita = partita.stato === 'finePartita';
      const vincitore = finePartita ? partita.getVincitore() : null;

      // Aggiorna stats a fine partita
      if (finePartita && !partita._statsAggiornate) {
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
      // Aggiorna stato per entrambi i giocatori
      for (const g of partita.giocatori) {
        io.to(g.id).emit('statoAggiornato', {
          ...partita.getStato(g.id),
          cartaGiocata: cartaInfo,
          giocatoreId: socket.id
        });
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
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
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

    partita.iniziaPartita();

    for (const g of partita.giocatori) {
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
    }
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
      stanze.delete(codice);
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

    if (partita.stato === 'inCorso' || partita.stato === 'fineRound') {
      giocatore.disconnesso = true;
      const nome = giocatore.nome;
      const chiaveDisc = `${codice}_${nome}`;

      io.to(codice).emit('avversarioDisconnesso', { nome, timeout: 180 });
      console.log(`Giocatore ${nome} disconnesso dalla stanza ${codice}, attendo riconnessione...`);

      const timer = setTimeout(() => {
        disconnessioniPendenti.delete(chiaveDisc);
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
        partita.rimuoviGiocatore(giocatore.id);
        io.to(codice).emit('avversarioAbbandonato', { nome });
        console.log(`Giocatore ${nome} rimosso dalla stanza ${codice} (timeout)`);

        if (partita.giocatori.filter(g => !g.disconnesso).length === 0) {
          stanze.delete(codice);
          console.log(`Stanza ${codice} eliminata`);
        }
      }, 180000);

      disconnessioniPendenti.set(chiaveDisc, timer);
    } else {
      partita.rimuoviGiocatore(socket.id);
      io.to(codice).emit('avversarioAbbandonato', { nome: giocatore.nome });

      if (partita.giocatori.length === 0) {
        stanze.delete(codice);
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
