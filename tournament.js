const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'scopa.db'));

// Migrazioni
try { db.exec('ALTER TABLE tornei ADD COLUMN round_corrente TEXT DEFAULT NULL'); } catch (e) { /* gia' esiste */ }
try { db.exec("ALTER TABLE tornei ADD COLUMN tipo_gioco TEXT DEFAULT 'maresciallo'"); } catch (e) { /* gia' esiste */ }

// Nomi dei round in ordine
const ROUNDS_16 = ['ottavi', 'quarti', 'semifinali', 'finale'];
const ROUNDS_8 = ['quarti', 'semifinali', 'finale'];
const ROUNDS_4 = ['semifinali', 'finale'];

function getRounds(numSquadre) {
  if (numSquadre === 16) return ROUNDS_16;
  if (numSquadre === 8) return ROUNDS_8;
  return ROUNDS_4;
}

function getNomeRound(round) {
  const nomi = {
    'sedicesimi': 'Sedicesimi',
    'ottavi': 'Ottavi di finale',
    'quarti': 'Quarti di finale',
    'semifinali': 'Semifinali',
    'finale': 'Finale'
  };
  return nomi[round] || round;
}

// Crea un nuovo torneo (atomico: torneo + squadre + slot partite in una transazione)
function creaTorneo(nome, numGiocatori, modalitaVittoria, valoreVittoria, controlloIp = true, tipoGioco = 'maresciallo') {
  if (![8, 16].includes(numGiocatori)) {
    return { ok: false, errore: 'Numero giocatori deve essere 8 o 16' };
  }
  const tipo = ['scientifico', 'classica', 'maresciallo'].includes(tipoGioco) ? tipoGioco : 'maresciallo';

  // Controlla che non ci sia gia' un torneo attivo
  const attivo = db.prepare("SELECT id FROM tornei WHERE stato IN ('iscrizioni', 'inCorso')").get();
  if (attivo) return { ok: false, errore: 'C\'e\' gia\' un torneo attivo' };

  const numSquadre = numGiocatori;
  const rounds = getRounds(numSquadre);

  const creaTx = db.transaction(() => {
    const ins = db.prepare('INSERT INTO tornei (nome, num_giocatori, num_squadre, modalita_vittoria, valore_vittoria, controllo_ip, tipo_gioco) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = ins.run(nome, numGiocatori, numSquadre, modalitaVittoria, valoreVittoria, controlloIp ? 1 : 0, tipo);
    const torneoId = result.lastInsertRowid;

    const insSquadra = db.prepare('INSERT INTO tornei_squadre (torneo_id, numero_squadra) VALUES (?, ?)');
    for (let i = 0; i < numSquadre; i++) insSquadra.run(torneoId, i);

    const insPartita = db.prepare('INSERT INTO tornei_partite (torneo_id, round, posizione) VALUES (?, ?, ?)');
    let matchesInRound = numSquadre / 2;
    for (const round of rounds) {
      for (let i = 0; i < matchesInRound; i++) insPartita.run(torneoId, round, i);
      matchesInRound = matchesInRound / 2;
    }
    return torneoId;
  });

  const torneoId = creaTx();
  return { ok: true, torneoId };
}

// Iscrivi un giocatore in una squadra scelta
function iscriviGiocatore(torneoId, nomeUtente, ip, numeroSquadra) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo) return { ok: false, errore: 'Torneo non trovato' };
  if (torneo.stato !== 'iscrizioni') return { ok: false, errore: 'Iscrizioni chiuse' };

  // Gia' iscritto?
  const gia = db.prepare('SELECT id FROM tornei_giocatori WHERE torneo_id = ? AND nome_utente = ?').get(torneoId, nomeUtente);
  if (gia) return { ok: false, errore: 'Sei gia\' iscritto' };

  // Trova la squadra scelta
  if (numeroSquadra === undefined || numeroSquadra === null) {
    return { ok: false, errore: 'Scegli una squadra' };
  }

  const squadra = db.prepare('SELECT ts.id, ts.numero_squadra FROM tornei_squadre ts WHERE ts.torneo_id = ? AND ts.numero_squadra = ?').get(torneoId, numeroSquadra);
  if (!squadra) return { ok: false, errore: 'Squadra non trovata' };

  const count = db.prepare('SELECT COUNT(*) as n FROM tornei_giocatori WHERE squadra_id = ?').get(squadra.id).n;
  if (count >= 1) return { ok: false, errore: 'Squadra piena' };

  // Controllo IP: nessun compagno di squadra con lo stesso IP
  if (torneo.controllo_ip && ip) {
    const stessoIp = db.prepare('SELECT nome_utente FROM tornei_giocatori WHERE torneo_id = ? AND squadra_id = ? AND ip = ?').get(torneoId, squadra.id, ip);
    if (stessoIp) {
      return { ok: false, errore: `Non puoi essere nella stessa squadra di ${stessoIp.nome_utente} (stesso IP)` };
    }
  }

  // Transazione atomica: INSERT giocatore + eventuale avvio torneo se e' pieno
  const iscriviTx = db.transaction(() => {
    db.prepare('INSERT INTO tornei_giocatori (torneo_id, squadra_id, nome_utente, ip) VALUES (?, ?, ?, ?)').run(torneoId, squadra.id, nomeUtente, ip || null);
    const totGiocatori = db.prepare('SELECT COUNT(*) as n FROM tornei_giocatori WHERE torneo_id = ?').get(torneoId).n;
    if (totGiocatori === torneo.num_giocatori) {
      iniziaTorneo(torneoId);
      return true;
    }
    return false;
  });
  const torneoIniziato = iscriviTx();
  return { ok: true, torneoIniziato };
}

// Rimuovi iscrizione
function rimuoviIscrizione(torneoId, nomeUtente) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo || torneo.stato !== 'iscrizioni') return { ok: false, errore: 'Non puoi ritirarti ora' };
  db.prepare('DELETE FROM tornei_giocatori WHERE torneo_id = ? AND nome_utente = ?').run(torneoId, nomeUtente);
  return { ok: true };
}

// Inizia il torneo: popola il primo round del tabellone (transazione)
function iniziaTorneo(torneoId) {
  const iniziaTx = db.transaction(() => {
    const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
    const rounds = getRounds(torneo.num_squadre);
    const primoRound = rounds[0];
    const squadre = db.prepare('SELECT id, numero_squadra FROM tornei_squadre WHERE torneo_id = ? ORDER BY numero_squadra').all(torneoId);
    const update = db.prepare('UPDATE tornei_partite SET squadra_a = ?, squadra_b = ? WHERE torneo_id = ? AND round = ? AND posizione = ?');
    for (let i = 0; i < squadre.length / 2; i++) {
      update.run(squadre[i * 2].id, squadre[i * 2 + 1].id, torneoId, primoRound, i);
    }
    db.prepare("UPDATE tornei SET stato = 'inCorso', round_corrente = ? WHERE id = ?").run(primoRound, torneoId);
  });
  iniziaTx();
}

// Registra il risultato di una partita e avanza il vincitore (transazione)
function registraRisultato(torneoId, round, posizione, vincitoreId, puntiA, puntiB) {
  let risultato = { prossimaPartitaPronta: false };
  const registraTx = db.transaction(() => {
    db.prepare("UPDATE tornei_partite SET stato = 'completata', vincitore = ?, punti_a = ?, punti_b = ? WHERE torneo_id = ? AND round = ? AND posizione = ?")
      .run(vincitoreId, puntiA, puntiB, torneoId, round, posizione);

    const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
    const rounds = getRounds(torneo.num_squadre);
    const roundIdx = rounds.indexOf(round);

    // E' la finale?
    if (roundIdx === rounds.length - 1) {
      db.prepare("UPDATE tornei SET stato = 'completato', squadra_vincitrice = ? WHERE id = ?").run(vincitoreId, torneoId);
      aggiornaStatsTorneo(torneoId, vincitoreId);
      risultato = { completato: true };
      return;
    }

    // Avanza vincitore al prossimo round
    const prossimoRound = rounds[roundIdx + 1];
    const prossimaPosizione = Math.floor(posizione / 2);
    const campo = (posizione % 2 === 0) ? 'squadra_a' : 'squadra_b';

    db.prepare(`UPDATE tornei_partite SET ${campo} = ? WHERE torneo_id = ? AND round = ? AND posizione = ?`)
      .run(vincitoreId, torneoId, prossimoRound, prossimaPosizione);

    const rimaste = db.prepare("SELECT COUNT(*) as n FROM tornei_partite WHERE torneo_id = ? AND round = ? AND stato != 'completata'").get(torneoId, round).n;
    if (rimaste === 0) {
      db.prepare("UPDATE tornei SET round_corrente = ? WHERE id = ?").run(prossimoRound, torneoId);
    }

    const prossima = db.prepare('SELECT * FROM tornei_partite WHERE torneo_id = ? AND round = ? AND posizione = ?').get(torneoId, prossimoRound, prossimaPosizione);
    if (prossima && prossima.squadra_a && prossima.squadra_b) {
      risultato = { prossimaPartitaPronta: true, round: prossimoRound, posizione: prossimaPosizione };
    }
  });
  registraTx();
  return risultato;
}

// Aggiorna stats tornei per tutti i partecipanti
function aggiornaStatsTorneo(torneoId, vincitoreId) {
  // Tutti i giocatori: tornei_giocati += 1
  const giocatori = db.prepare('SELECT nome_utente, squadra_id FROM tornei_giocatori WHERE torneo_id = ?').all(torneoId);
  const updGiocati = db.prepare('UPDATE utenti SET tornei_giocati = tornei_giocati + 1 WHERE nome = ?');
  const updVinti = db.prepare('UPDATE utenti SET tornei_vinti = tornei_vinti + 1 WHERE nome = ?');

  for (const g of giocatori) {
    updGiocati.run(g.nome_utente);
    if (g.squadra_id === vincitoreId) {
      updVinti.run(g.nome_utente);
    }
  }
}

// Ottieni torneo attivo
function getTorneoAttivo() {
  return db.prepare("SELECT * FROM tornei WHERE stato IN ('iscrizioni', 'inCorso') LIMIT 1").get() || null;
}

// Ottieni tabellone completo
function getTabellone(torneoId) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo) return null;

  const rounds = getRounds(torneo.num_squadre);
  const squadre = db.prepare('SELECT * FROM tornei_squadre WHERE torneo_id = ?').all(torneoId);
  const giocatori = db.prepare('SELECT * FROM tornei_giocatori WHERE torneo_id = ?').all(torneoId);
  const partite = db.prepare('SELECT * FROM tornei_partite WHERE torneo_id = ? ORDER BY round, posizione').all(torneoId);

  // Mappa squadre con giocatori
  const squadreMap = {};
  for (const sq of squadre) {
    squadreMap[sq.id] = {
      id: sq.id,
      numero: sq.numero_squadra,
      nome: sq.nome_squadra || `Squadra ${sq.numero_squadra + 1}`,
      giocatori: giocatori.filter(g => g.squadra_id === sq.id).map(g => g.nome_utente)
    };
  }

  const roundsData = rounds.map(round => {
    const partiteRound = partite.filter(p => p.round === round);
    return {
      nome: getNomeRound(round),
      chiave: round,
      partite: partiteRound.map(p => ({
        posizione: p.posizione,
        squadraA: p.squadra_a ? squadreMap[p.squadra_a] : null,
        squadraB: p.squadra_b ? squadreMap[p.squadra_b] : null,
        stato: p.stato,
        codiceStanza: p.codice_stanza,
        vincitore: p.vincitore,
        puntiA: p.punti_a,
        puntiB: p.punti_b
      }))
    };
  });

  return {
    id: torneo.id,
    nome: torneo.nome,
    stato: torneo.stato,
    numGiocatori: torneo.num_giocatori,
    numSquadre: torneo.num_squadre,
    modalitaVittoria: torneo.modalita_vittoria,
    valoreVittoria: torneo.valore_vittoria,
    tipoGioco: torneo.tipo_gioco || 'maresciallo',
    roundCorrente: torneo.round_corrente,
    squadraVincitrice: torneo.squadra_vincitrice ? squadreMap[torneo.squadra_vincitrice] : null,
    squadre: squadreMap,
    rounds: roundsData
  };
}

// Ottieni iscrizioni
function getIscrizioni(torneoId) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo) return null;

  const squadre = db.prepare('SELECT * FROM tornei_squadre WHERE torneo_id = ? ORDER BY numero_squadra').all(torneoId);
  const giocatori = db.prepare('SELECT * FROM tornei_giocatori WHERE torneo_id = ?').all(torneoId);

  return {
    id: torneo.id,
    nome: torneo.nome,
    stato: torneo.stato,
    numGiocatori: torneo.num_giocatori,
    numSquadre: torneo.num_squadre,
    tipoGioco: torneo.tipo_gioco || 'maresciallo',
    iscritti: giocatori.length,
    squadre: squadre.map(sq => ({
      id: sq.id,
      numero: sq.numero_squadra,
      nome: sq.nome_squadra || `Squadra ${sq.numero_squadra + 1}`,
      giocatori: giocatori.filter(g => g.squadra_id === sq.id).map(g => g.nome_utente)
    }))
  };
}

// Imposta codice stanza per una partita del torneo
function setCodiceStanza(torneoId, round, posizione, codiceStanza) {
  db.prepare("UPDATE tornei_partite SET codice_stanza = ?, stato = 'inCorso' WHERE torneo_id = ? AND round = ? AND posizione = ?")
    .run(codiceStanza, torneoId, round, posizione);
}

// Trova partita torneo da codice stanza
function getPartitaDaCodice(codiceStanza) {
  return db.prepare("SELECT tp.*, t.modalita_vittoria, t.valore_vittoria FROM tornei_partite tp JOIN tornei t ON t.id = tp.torneo_id WHERE tp.codice_stanza = ?").get(codiceStanza) || null;
}

// Trova la partita corrente di un giocatore nel torneo
function getPartitaGiocatore(torneoId, nomeUtente) {
  const iscrizione = db.prepare('SELECT squadra_id FROM tornei_giocatori WHERE torneo_id = ? AND nome_utente = ?').get(torneoId, nomeUtente);
  if (!iscrizione) return null;

  const squadraId = iscrizione.squadra_id;
  // Trova la partita in corso o in attesa per questa squadra
  const partita = db.prepare(`
    SELECT * FROM tornei_partite
    WHERE torneo_id = ? AND (squadra_a = ? OR squadra_b = ?) AND stato IN ('attesa', 'inCorso')
    ORDER BY CASE stato WHEN 'inCorso' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(torneoId, squadraId, squadraId);

  return partita;
}

// Annulla torneo
function annullaTorneo(torneoId) {
  db.prepare("UPDATE tornei SET stato = 'annullato' WHERE id = ?").run(torneoId);
  return { ok: true };
}

// Ottieni tutte le partite pronte (entrambe le squadre, stato attesa) per un torneo
function getPartitePronte(torneoId) {
  return db.prepare(`
    SELECT * FROM tornei_partite
    WHERE torneo_id = ? AND squadra_a IS NOT NULL AND squadra_b IS NOT NULL AND stato = 'attesa'
  `).all(torneoId);
}

// Admin: iscrivi un giocatore in una squadra specifica
function iscriviGiocatoreInSquadra(torneoId, nomeUtente, numeroSquadra, ip) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo) return { ok: false, errore: 'Torneo non trovato' };
  if (torneo.stato !== 'iscrizioni') return { ok: false, errore: 'Iscrizioni chiuse' };

  // Gia' iscritto?
  const gia = db.prepare('SELECT id FROM tornei_giocatori WHERE torneo_id = ? AND nome_utente = ?').get(torneoId, nomeUtente);
  if (gia) return { ok: false, errore: 'Giocatore gia\' iscritto' };

  // Trova la squadra
  const squadra = db.prepare('SELECT id FROM tornei_squadre WHERE torneo_id = ? AND numero_squadra = ?').get(torneoId, numeroSquadra);
  if (!squadra) return { ok: false, errore: 'Squadra non trovata' };

  // Controlla posti liberi
  const count = db.prepare('SELECT COUNT(*) as n FROM tornei_giocatori WHERE squadra_id = ?').get(squadra.id).n;
  if (count >= 1) return { ok: false, errore: 'Squadra piena' };

  // Transazione atomica: INSERT giocatore + eventuale avvio torneo se e' pieno
  const iscriviTx = db.transaction(() => {
    db.prepare('INSERT INTO tornei_giocatori (torneo_id, squadra_id, nome_utente, ip) VALUES (?, ?, ?, ?)').run(torneoId, squadra.id, nomeUtente, ip || null);
    const totGiocatori = db.prepare('SELECT COUNT(*) as n FROM tornei_giocatori WHERE torneo_id = ?').get(torneoId).n;
    if (totGiocatori === torneo.num_giocatori) {
      iniziaTorneo(torneoId);
      return true;
    }
    return false;
  });
  const torneoIniziato = iscriviTx();
  return { ok: true, torneoIniziato };
}

// Admin: sposta un giocatore in un'altra squadra
function spostaGiocatore(torneoId, nomeUtente, nuovoNumeroSquadra) {
  const torneo = db.prepare('SELECT * FROM tornei WHERE id = ?').get(torneoId);
  if (!torneo || torneo.stato !== 'iscrizioni') return { ok: false, errore: 'Non puoi spostare giocatori ora' };

  const iscrizione = db.prepare('SELECT id FROM tornei_giocatori WHERE torneo_id = ? AND nome_utente = ?').get(torneoId, nomeUtente);
  if (!iscrizione) return { ok: false, errore: 'Giocatore non iscritto' };

  const nuovaSquadra = db.prepare('SELECT id FROM tornei_squadre WHERE torneo_id = ? AND numero_squadra = ?').get(torneoId, nuovoNumeroSquadra);
  if (!nuovaSquadra) return { ok: false, errore: 'Squadra non trovata' };

  const count = db.prepare('SELECT COUNT(*) as n FROM tornei_giocatori WHERE squadra_id = ?').get(nuovaSquadra.id).n;
  if (count >= 1) return { ok: false, errore: 'Squadra di destinazione piena' };

  db.prepare('UPDATE tornei_giocatori SET squadra_id = ? WHERE id = ?').run(nuovaSquadra.id, iscrizione.id);
  return { ok: true };
}

// Resetta partite in corso dopo riavvio server (stanze in memoria perse)
function resetPartiteInCorso(torneoId) {
  db.prepare("UPDATE tornei_partite SET stato = 'attesa', codice_stanza = NULL WHERE torneo_id = ? AND stato = 'inCorso'")
    .run(torneoId);
}

module.exports = {
  creaTorneo,
  iscriviGiocatore,
  rimuoviIscrizione,
  registraRisultato,
  getTorneoAttivo,
  getTabellone,
  getIscrizioni,
  setCodiceStanza,
  getPartitaDaCodice,
  getPartitaGiocatore,
  getPartitePronte,
  resetPartiteInCorso,
  iscriviGiocatoreInSquadra,
  spostaGiocatore,
  annullaTorneo,
  getNomeRound,
  getRounds
};
