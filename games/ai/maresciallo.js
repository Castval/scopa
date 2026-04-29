// AI per Scopa Maresciallo (2 giocatori).
//
// Pipeline (analoga a classica): engine -> valutazione 1-ply ricca -> [TODO]
// endgame solver esatto -> [TODO] PIMC mid-game.
// Per ora scegliMossa = 1-ply con valutazione che modella tutte le specificita'
// del Maresciallo: doppio mazzo, asso piglia tutto sempre, identica solo se scopa,
// scope variabili (1/3/-4/+10), penalita' marescialli, otto denari accoppiato,
// napola (doppia possibile in doppio mazzo), settebello fino a x2.

const SEMI = ['denari', 'coppe', 'bastoni', 'spade'];
const PRIMIERA_VALORI = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

const isSettebello = (c) => c.valore === 7 && c.seme === 'denari';
const isMaresciallo = (c) => c.valore === 10 && c.seme === 'spade';
const isOttoDenari = (c) => c.valore === 8 && c.seme === 'denari';
const isAsso = (c) => c.valore === 1;

// === Combinatoria ===
function trovaCombinazoniSomma(carte, target, start, corrente) {
  const out = [];
  for (let i = start; i < carte.length; i++) {
    const c = carte[i];
    const sum = corrente.reduce((s, x) => s + x.valore, 0) + c.valore;
    if (sum === target) out.push([...corrente, c]);
    else if (sum < target) out.push(...trovaCombinazoniSomma(carte, target, i + 1, [...corrente, c]));
  }
  return out;
}

// Trova tutte le combinazioni legali per Maresciallo (regole specifiche).
function trovaCombinazioni(carta, tavolo) {
  // Asso: prende tutto se tavolo non vuoto (mai scopa).
  if (isAsso(carta) && tavolo.length > 0) {
    return [[...tavolo]];
  }
  if (isAsso(carta)) return []; // tavolo vuoto: assoSolo, gestito a parte

  const stessoValore = tavolo.filter(c => c.valore === carta.valore);
  const identiche = stessoValore.filter(c => c.seme === carta.seme);
  const nonIdentiche = stessoValore.filter(c => c.seme !== carta.seme);

  // Identica si puo' prendere SOLO se e' scopa (tavolo ha esattamente quella).
  if (identiche.length > 0 && tavolo.length === 1) {
    return [[identiche[0]]];
  }

  if (nonIdentiche.length > 0) {
    return nonIdentiche.map(c => [c]); // priorita' su somme
  }

  if (carta.valore <= 1) return [];
  return trovaCombinazoniSomma(tavolo, carta.valore, 0, []).filter(c => c.length > 1);
}

// Applica una mossa allo stato; ritorna nuovo stato (immutabile).
// state contiene anche scopeNeg/Pos count perche' la penalita' marescialli
// usa quei conteggi al calcolo punti finale.
function applyMove(state, isAITurn, carta, comb) {
  const myHand = isAITurn ? state.aiHand : state.oppHand;
  const newMyHand = myHand.filter(c => c.id !== carta.id);
  const otherHand = isAITurn ? state.oppHand : state.aiHand;
  const totaleResiduo = newMyHand.length + otherHand.length;
  const eUltima = totaleResiduo === 0 && state.deckCount === 0;

  // Asso su tavolo vuoto: assoSolo, va nelle prese, no scopa.
  if (isAsso(carta) && state.tavolo.length === 0) {
    return mergeState(state, isAITurn, newMyHand, [], [carta], 0, false, false);
  }

  // Asso con tavolo non vuoto: prende tutto, mai scopa.
  if (isAsso(carta)) {
    return mergeState(state, isAITurn, newMyHand, [], [carta, ...state.tavolo], 0, false, false);
  }

  if (!comb || comb.length === 0) {
    // Posa
    return mergeState(state, isAITurn, newMyHand, state.tavolo.concat([carta]), [], 0, false, false);
  }

  // Presa
  const presaIds = new Set(comb.map(c => c.id));
  const tavoloDopo = state.tavolo.filter(c => !presaIds.has(c.id));
  const conIdentica = comb.some(c => c.seme === carta.seme && c.valore === carta.valore);

  let scopaValore = 0;
  let scopaNeg = false;
  let scopaPos = false;
  if (tavoloDopo.length === 0 && !eUltima) {
    const cartaIsMar = isMaresciallo(carta);
    const presaContieneMar = comb.some(isMaresciallo);
    if (cartaIsMar && presaContieneMar) {
      scopaValore = 10;
      scopaPos = true;
    } else if (cartaIsMar || presaContieneMar) {
      scopaValore = -4;
      scopaNeg = true;
    } else if (conIdentica) {
      scopaValore = 3;
    } else {
      scopaValore = 1;
    }
  }

  return mergeState(state, isAITurn, newMyHand, tavoloDopo, [carta, ...comb], scopaValore, scopaNeg, scopaPos);
}

function mergeState(state, isAITurn, newMyHand, newTavolo, addToPrese, scopaValore, scopaNeg, scopaPos) {
  return {
    aiHand: isAITurn ? newMyHand : state.aiHand,
    oppHand: isAITurn ? state.oppHand : newMyHand,
    tavolo: newTavolo,
    aiPrese: isAITurn && addToPrese.length > 0 ? state.aiPrese.concat(addToPrese) : state.aiPrese,
    oppPrese: !isAITurn && addToPrese.length > 0 ? state.oppPrese.concat(addToPrese) : state.oppPrese,
    aiScopeSum: isAITurn ? state.aiScopeSum + scopaValore : state.aiScopeSum,
    oppScopeSum: !isAITurn ? state.oppScopeSum + scopaValore : state.oppScopeSum,
    aiScopeNeg: isAITurn && scopaNeg ? state.aiScopeNeg + 1 : state.aiScopeNeg,
    oppScopeNeg: !isAITurn && scopaNeg ? state.oppScopeNeg + 1 : state.oppScopeNeg,
    aiScopePos: isAITurn && scopaPos ? state.aiScopePos + 1 : state.aiScopePos,
    oppScopePos: !isAITurn && scopaPos ? state.oppScopePos + 1 : state.oppScopePos,
    lastPicker: addToPrese.length > 0 ? (isAITurn ? 'AI' : 'OPP') : state.lastPicker,
    deckCount: state.deckCount
  };
}

// === Primiera e Napola ===
function primiera(carte) {
  const best = {};
  for (const c of carte) {
    const v = PRIMIERA_VALORI[c.valore];
    if (best[c.seme] === undefined || v > best[c.seme]) best[c.seme] = v;
  }
  if (Object.keys(best).length < 4) return 0; // primiera valida richiede tutti 4 semi
  return Object.values(best).reduce((s, v) => s + v, 0);
}

function napola(carte) {
  const conteggio = {};
  for (const c of carte) {
    if (c.seme !== 'denari') continue;
    conteggio[c.valore] = (conteggio[c.valore] || 0) + 1;
  }
  let totale = 0;
  for (let volta = 0; volta < 2; volta++) {
    if ((conteggio[1] || 0) > volta && (conteggio[2] || 0) > volta && (conteggio[3] || 0) > volta) {
      let p = 3;
      for (let v = 4; v <= 10; v++) {
        if ((conteggio[v] || 0) > volta) p++;
        else break;
      }
      totale += p;
    }
  }
  return totale;
}

// === Calcolo punti esatti del round ===
// Replica la logica di ScopaMaresciallo.calcolaPuntiRound. Restituisce ai - opp.
function calcolaPunti(state) {
  let ai = state.aiScopeSum;
  let opp = state.oppScopeSum;

  // Penalita' marescialli (residui dopo aver "consumato" quelli usati nelle scope)
  const aiMar = state.aiPrese.filter(isMaresciallo).length;
  const oppMar = state.oppPrese.filter(isMaresciallo).length;
  ai -= Math.max(0, aiMar - state.aiScopeNeg - 2 * state.aiScopePos);
  opp -= Math.max(0, oppMar - state.oppScopeNeg - 2 * state.oppScopePos);

  // Settebello (puo' essere 2 nel doppio mazzo)
  const aiSette = state.aiPrese.filter(isSettebello).length;
  const oppSette = state.oppPrese.filter(isSettebello).length;
  ai += aiSette;
  opp += oppSette;

  // Otto denari accoppiato col settebello (1pt per coppia)
  const aiOtto = state.aiPrese.filter(isOttoDenari).length;
  const oppOtto = state.oppPrese.filter(isOttoDenari).length;
  ai += Math.min(aiSette, aiOtto);
  opp += Math.min(oppSette, oppOtto);

  // Denari (chi ne ha piu')
  const aiDen = state.aiPrese.filter(c => c.seme === 'denari').length;
  const oppDen = state.oppPrese.filter(c => c.seme === 'denari').length;
  if (aiDen > oppDen) ai++;
  else if (oppDen > aiDen) opp++;

  // Carte (chi ne ha piu')
  if (state.aiPrese.length > state.oppPrese.length) ai++;
  else if (state.oppPrese.length > state.aiPrese.length) opp++;

  // Primiera
  const aiP = primiera(state.aiPrese);
  const oppP = primiera(state.oppPrese);
  if (aiP > oppP) ai++;
  else if (oppP > aiP) opp++;

  // Napola
  ai += napola(state.aiPrese);
  opp += napola(state.oppPrese);

  return ai - opp;
}

// === Carte sconosciute (doppio mazzo: 2 copie per ogni valore-seme, 80 totali) ===
function carteSconosciute(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);
  const visti = new Set();
  for (const c of ai.mano) visti.add(c.id);
  for (const c of partita.tavolo) visti.add(c.id);
  for (const c of ai.prese) visti.add(c.id);
  for (const c of avv.prese) visti.add(c.id);

  const out = [];
  for (let mazzoId = 0; mazzoId < 2; mazzoId++) {
    for (const seme of SEMI) {
      for (let v = 1; v <= 10; v++) {
        const id = `${v}_${seme}_${mazzoId}`;
        if (!visti.has(id)) out.push({ valore: v, seme, mazzoId, id });
      }
    }
  }
  return out;
}

// P(avversario ha >=1 carta tra `matching` su `n` totali, mano `h`)
function pAvvHa(matching, n, h) {
  if (matching <= 0 || h <= 0 || n <= 0) return 0;
  if (h >= n || matching >= n) return 1;
  let pZero = 1;
  for (let i = 0; i < h; i++) {
    pZero *= (n - matching - i) / (n - i);
    if (pZero <= 0) return 1;
  }
  return 1 - pZero;
}

// === Valutazione 1-ply ===
// Differenza vs classica: scoring discreto per maresciallo/settebello/ottoDenari/napola
// (no smoothing perche' sono "step" hard); smoothing tanh solo su denari/carte/primiera
// (race continua). Sottrae stima loss prossima mossa avversaria.
function valutaStato(partita, statoDopo) {
  const aiPrese = statoDopo.aiPrese;
  const oppPrese = statoDopo.oppPrese;
  let s = 0;

  // Scope (gia' valori variabili: 1/3/-4/+10)
  s += statoDopo.aiScopeSum - statoDopo.oppScopeSum;

  // Penalita' marescialli (residui)
  const aiMar = aiPrese.filter(isMaresciallo).length;
  const oppMar = oppPrese.filter(isMaresciallo).length;
  s -= Math.max(0, aiMar - statoDopo.aiScopeNeg - 2 * statoDopo.aiScopePos);
  s += Math.max(0, oppMar - statoDopo.oppScopeNeg - 2 * statoDopo.oppScopePos);

  // Settebello (1 pt per ognuno preso)
  const aiSette = aiPrese.filter(isSettebello).length;
  const oppSette = oppPrese.filter(isSettebello).length;
  s += aiSette - oppSette;

  // Otto denari accoppiato (gia' fissato da settebello)
  const aiOtto = aiPrese.filter(isOttoDenari).length;
  const oppOtto = oppPrese.filter(isOttoDenari).length;
  s += Math.min(aiSette, aiOtto) - Math.min(oppSette, oppOtto);

  // Denari race (20 totali, soglia 11)
  const aiDen = aiPrese.filter(c => c.seme === 'denari').length;
  const oppDen = oppPrese.filter(c => c.seme === 'denari').length;
  if (aiDen >= 11) s += 1;
  else if (oppDen >= 11) s -= 1;
  else s += Math.tanh((aiDen - oppDen) / 4);

  // Carte race (80 totali, soglia 41)
  if (aiPrese.length >= 41) s += 1;
  else if (oppPrese.length >= 41) s -= 1;
  else s += Math.tanh((aiPrese.length - oppPrese.length) / 8);

  // Primiera
  const aiP = primiera(aiPrese);
  const oppP = primiera(oppPrese);
  s += Math.tanh((aiP - oppP) / 12) * 0.7;
  // Bonus copertura semi
  const aiSemi = new Set(aiPrese.map(c => c.seme)).size;
  const oppSemi = new Set(oppPrese.map(c => c.seme)).size;
  if (aiSemi === 4 && oppSemi < 4) s += 0.2;
  if (oppSemi === 4 && aiSemi < 4) s -= 0.2;

  // Napola (calcolo esatto: e' discreto e non smoothable)
  s += napola(aiPrese) - napola(oppPrese);

  // Stima loss prossima mossa avversaria
  s -= stimaLossProssima(partita, statoDopo);

  return s;
}

// Per ogni valore v che l'avversario potrebbe avere, P(ce l'ha) * danno_max.
function stimaLossProssima(partita, statoDopo) {
  const tavolo = statoDopo.tavolo;
  const sconosciute = statoDopo.sconosciute;
  const n = sconosciute.length;
  const h = statoDopo.manoAvvSize;
  if (n === 0 || h === 0) return 0;

  const ultimaPerAvv = h === 1 && partita.mazzo.rimanenti() === 0 && statoDopo.mieCarteResidue === 0;

  let loss = 0;

  // Asso (v=1) e' speciale: prende sempre tutto se tavolo non vuoto
  const assi = sconosciute.filter(c => c.valore === 1).length;
  if (assi > 0 && tavolo.length > 0) {
    const pAsso = pAvvHa(assi, n, h);
    let val = 0;
    for (const c of tavolo) val += valoreCartaPerAvv(c);
    loss += pAsso * val; // asso non scopa
  }

  for (let v = 2; v <= 10; v++) {
    const cardsV = sconosciute.filter(c => c.valore === v);
    if (cardsV.length === 0) continue;
    const p = pAvvHa(cardsV.length, n, h);
    if (p < 0.04) continue;

    // Costruisco una "carta finta" non identica a nessuna sul tavolo per avere
    // la combinatoria base (non-identica). Se non possibile (tutte e 2 le copie
    // di v in quel seme sono sul tavolo), uso un seme alternativo.
    const semiUsatiTavoloV = new Set(tavolo.filter(c => c.valore === v).map(c => c.seme));
    let semeFake = SEMI.find(s => !semiUsatiTavoloV.has(s)) || 'denari';
    const fakeCarta = { valore: v, seme: semeFake, mazzoId: 0, id: '__fake__' };
    const combs = trovaCombinazioni(fakeCarta, tavolo);
    if (combs.length === 0) continue;

    const totV = cardsV.length;
    const denariV = cardsV.filter(c => c.seme === 'denari').length;
    const semeDenariV = denariV / totV;
    const isSetteV = (v === 7) ? semeDenariV : 0;
    const isMarV = (v === 10) ? cardsV.filter(c => c.seme === 'spade').length / totV : 0;
    const isOttoV = (v === 8) ? semeDenariV : 0;

    let worst = 0;
    for (const comb of combs) {
      const tavoloDopo = tavolo.filter(c => !comb.some(cc => cc.id === c.id));
      const eScopa = tavoloDopo.length === 0 && !ultimaPerAvv;

      // Determina valore scopa probabile (dipende da maresciallo/identica)
      let scopaVal = 0;
      if (eScopa) {
        // identica probabile? rara
        scopaVal = 1; // approximation
        // se prendo maresciallo
        const presaContieneMar = comb.some(isMaresciallo);
        if (presaContieneMar) scopaVal = -4;
        // P(carta giocata e' maresciallo) = isMarV
        scopaVal = scopaVal * (1 - isMarV) + (-4) * isMarV;
      }

      let val = scopaVal;
      for (const c of comb) val += valoreCartaPerAvv(c);
      // Carta giocata (valore atteso)
      val += semeDenariV * 0.30; // contributo denari
      val += isSetteV * 1.0;
      val += isMarV * (-1.0); // maresciallo nelle prese = -1 per lui (positivo per noi)
      val += isOttoV * 0.5; // otto denari (vale solo se ha 7d, approx)
      val += 0.04;
      val += Math.max(0, PRIMIERA_VALORI[v] - 10) * 0.04;

      if (val > worst) worst = val;
    }
    loss += p * worst;
  }
  return loss;
}

// Approssima il "valore" di una carta per le prese avversarie (peggiore per noi)
function valoreCartaPerAvv(c) {
  let v = 0.04; // carta count
  if (isSettebello(c)) v += 1;
  if (c.seme === 'denari') v += 0.30;
  if (isMaresciallo(c)) v -= 1.0; // maresciallo nelle sue prese = -1 per lui (positivo per noi)
  if (isOttoDenari(c)) v += 0.5; // se ha o avra' un 7d, +1 per la coppia
  v += Math.max(0, PRIMIERA_VALORI[c.valore] - 10) * 0.04;
  // Napola: 1, 2, 3 di denari sono critici per la napola avversaria
  if (c.seme === 'denari' && c.valore <= 3) v += 0.5;
  return v;
}

// === Stato post-mossa AI per la valutazione 1-ply ===
function statoDopoMossa(partita, aiId, carta, comb, sconosciuteBase) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);

  // Costruisce uno state-like base e applica la mossa via applyMove (riusa la logica)
  const base = {
    aiHand: ai.mano.slice(),
    oppHand: avv.mano.slice(),
    tavolo: partita.tavolo.slice(),
    aiPrese: ai.prese.slice(),
    oppPrese: avv.prese.slice(),
    aiScopeSum: sumScope(ai.scope),
    oppScopeSum: sumScope(avv.scope),
    aiScopeNeg: countScopeNeg(ai.scope),
    oppScopeNeg: countScopeNeg(avv.scope),
    aiScopePos: countScopePos(ai.scope),
    oppScopePos: countScopePos(avv.scope),
    lastPicker: partita.ultimoAPrendere === aiId ? 'AI'
              : partita.ultimoAPrendere === avv.id ? 'OPP'
              : null,
    deckCount: partita.mazzo.rimanenti()
  };
  const dopo = applyMove(base, true, carta, comb);
  // Aggiungo info per valutazione (sconosciute, manoAvvSize, mieCarteResidue)
  dopo.sconosciute = sconosciuteBase;
  dopo.manoAvvSize = avv.mano.length;
  dopo.mieCarteResidue = ai.mano.length - 1;
  return dopo;
}

function sumScope(scope) {
  let s = 0;
  for (const x of scope) s += x.valore;
  return s;
}
function countScopeNeg(scope) {
  return scope.filter(s => s.valore === -4).length;
}
function countScopePos(scope) {
  return scope.filter(s => s.marescialloConMaresciallo).length;
}

// === Selezione mossa (1-ply) ===
function scegliMossa1Ply(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  const sconosciuteBase = carteSconosciute(partita, aiId);
  let migliore = null;
  let migliorPunteggio = -Infinity;

  for (const carta of ai.mano) {
    const combinazioni = trovaCombinazioni(carta, partita.tavolo);

    // Caso speciale: asso con tavolo vuoto = assoSolo (presa con carta singola, no scopa)
    if (isAsso(carta) && partita.tavolo.length === 0) {
      const dopo = statoDopoMossa(partita, aiId, carta, null, sconosciuteBase);
      const p = valutaStato(partita, dopo);
      if (p > migliorPunteggio) {
        migliorPunteggio = p;
        migliore = { cartaId: carta.id, cartePresaIds: [] };
      }
      continue;
    }

    if (combinazioni.length === 0) {
      const dopo = statoDopoMossa(partita, aiId, carta, null, sconosciuteBase);
      const p = valutaStato(partita, dopo);
      if (p > migliorPunteggio) {
        migliorPunteggio = p;
        migliore = { cartaId: carta.id, cartePresaIds: [] };
      }
    } else {
      for (const comb of combinazioni) {
        const dopo = statoDopoMossa(partita, aiId, carta, comb, sconosciuteBase);
        const p = valutaStato(partita, dopo);
        if (p > migliorPunteggio) {
          migliorPunteggio = p;
          migliore = { cartaId: carta.id, cartePresaIds: comb.map(c => c.id) };
        }
      }
    }
  }
  return migliore;
}

function scegliMossa(partita, aiId, opts = {}) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  // Endgame: mazzo vuoto = info perfetta, risolvi esattamente.
  if (!opts.disableEndgame) {
    const endgame = require('./maresciallo-endgame');
    if (endgame.isEndgame(partita)) {
      const m = endgame.scegliMossaEndgame(partita, aiId);
      if (m) return m;
    }
  }

  // Mid-game: PIMC (default) o fallback 1-ply
  if (!opts.disablePimc) {
    const pimc = require('./maresciallo-pimc');
    const m = pimc.scegliMossaPIMC(partita, aiId, { K: opts.pimcK, depth: opts.pimcDepth });
    if (m) return m;
  }

  return scegliMossa1Ply(partita, aiId);
}

module.exports = {
  scegliMossa,
  scegliMossa1Ply,
  // Esposti per test/benchmark
  trovaCombinazioni,
  applyMove,
  calcolaPunti,
  valutaStato,
  primiera,
  napola,
  carteSconosciute
};
