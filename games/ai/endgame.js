// Endgame solver per Scopa Classica.
//
// Insight: nell'ultima manche (mazzo vuoto) le sconosciute coincidono con la mano
// avversaria, quindi e' info perfetta -> minimax esatto con alpha-beta.
// Stato max: 6 carte da giocare, branching ~3-6 per ply -> velocissimo.
//
// Il valore restituito e' la differenza esatta dei punti del round (AI - AVV)
// considerando: scope, settebello, denari (>5), carte (>20), primiera, e le carte
// residue sul tavolo che vanno all'ultimo che ha preso.

const PRIMIERA_VALORI = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

function trovaCombinazioniSomma(carte, target, start, corrente) {
  const out = [];
  for (let i = start; i < carte.length; i++) {
    const c = carte[i];
    const sum = corrente.reduce((s, x) => s + x.valore, 0) + c.valore;
    if (sum === target) out.push([...corrente, c]);
    else if (sum < target) out.push(...trovaCombinazioniSomma(carte, target, i + 1, [...corrente, c]));
  }
  return out;
}

function trovaCombinazioni(carta, tavolo, assoPigliaTutto) {
  if (assoPigliaTutto && carta.valore === 1 && tavolo.length > 0) {
    const assoSulTavolo = tavolo.find(c => c.valore === 1);
    if (assoSulTavolo) return [[assoSulTavolo]];
    return [[...tavolo]];
  }
  const same = tavolo.filter(c => c.valore === carta.valore);
  if (same.length > 0) return same.map(c => [c]);
  if (carta.valore <= 1) return [];
  return trovaCombinazioniSomma(tavolo, carta.valore, 0, []).filter(c => c.length > 1);
}

function primiera(carte) {
  const best = {};
  for (const c of carte) {
    const v = PRIMIERA_VALORI[c.valore];
    if (best[c.seme] === undefined || v > best[c.seme]) best[c.seme] = v;
  }
  if (Object.keys(best).length < 4) return 0;
  return Object.values(best).reduce((s, v) => s + v, 0);
}

function calcolaPunti(aiPrese, oppPrese, aiScope, oppScope) {
  let ai = aiScope, opp = oppScope;
  if (aiPrese.some(c => c.valore === 7 && c.seme === 'denari')) ai++;
  else if (oppPrese.some(c => c.valore === 7 && c.seme === 'denari')) opp++;
  const dAi = aiPrese.filter(c => c.seme === 'denari').length;
  const dOpp = oppPrese.filter(c => c.seme === 'denari').length;
  if (dAi > dOpp) ai++; else if (dOpp > dAi) opp++;
  if (aiPrese.length > oppPrese.length) ai++;
  else if (oppPrese.length > aiPrese.length) opp++;
  const pAi = primiera(aiPrese);
  const pOpp = primiera(oppPrese);
  if (pAi > pOpp) ai++; else if (pOpp > pAi) opp++;
  return ai - opp;
}

// Applica una mossa allo stato, restituisce nuovo stato (immutabile).
function applyMove(state, isAITurn, carta, comb) {
  const myHand = isAITurn ? state.aiHand : state.oppHand;
  const newMyHand = myHand.filter(c => c.id !== carta.id);
  const otherHand = isAITurn ? state.oppHand : state.aiHand;
  const totaleResiduo = newMyHand.length + otherHand.length;

  // Asso piglia tutto su tavolo vuoto -> assoSolo, va nelle prese, no scopa
  if (state.assoPigliaTutto && carta.valore === 1 && state.tavolo.length === 0) {
    return {
      aiHand: isAITurn ? newMyHand : state.aiHand,
      oppHand: isAITurn ? state.oppHand : newMyHand,
      tavolo: [],
      aiPrese: isAITurn ? state.aiPrese.concat([carta]) : state.aiPrese,
      oppPrese: isAITurn ? state.oppPrese : state.oppPrese.concat([carta]),
      aiScope: state.aiScope,
      oppScope: state.oppScope,
      lastPicker: isAITurn ? 'AI' : 'OPP',
      assoPigliaTutto: state.assoPigliaTutto
    };
  }

  if (!comb || comb.length === 0) {
    // Posa
    return {
      aiHand: isAITurn ? newMyHand : state.aiHand,
      oppHand: isAITurn ? state.oppHand : newMyHand,
      tavolo: state.tavolo.concat([carta]),
      aiPrese: state.aiPrese,
      oppPrese: state.oppPrese,
      aiScope: state.aiScope,
      oppScope: state.oppScope,
      lastPicker: state.lastPicker,
      assoPigliaTutto: state.assoPigliaTutto
    };
  }

  // Presa
  const presaIds = new Set(comb.map(c => c.id));
  const tavoloDopo = state.tavolo.filter(c => !presaIds.has(c.id));
  const eUltima = totaleResiduo === 0;
  const scopaConsentita = !(state.assoPigliaTutto && carta.valore === 1);
  const scopa = tavoloDopo.length === 0 && !eUltima && scopaConsentita;
  const aggiunteAlPrese = [carta, ...comb];

  return {
    aiHand: isAITurn ? newMyHand : state.aiHand,
    oppHand: isAITurn ? state.oppHand : newMyHand,
    tavolo: tavoloDopo,
    aiPrese: isAITurn ? state.aiPrese.concat(aggiunteAlPrese) : state.aiPrese,
    oppPrese: isAITurn ? state.oppPrese : state.oppPrese.concat(aggiunteAlPrese),
    aiScope: isAITurn && scopa ? state.aiScope + 1 : state.aiScope,
    oppScope: !isAITurn && scopa ? state.oppScope + 1 : state.oppScope,
    lastPicker: isAITurn ? 'AI' : 'OPP',
    assoPigliaTutto: state.assoPigliaTutto
  };
}

function chiudiRound(state) {
  let aP = state.aiPrese;
  let oP = state.oppPrese;
  if (state.tavolo.length > 0 && state.lastPicker !== null) {
    if (state.lastPicker === 'AI') aP = aP.concat(state.tavolo);
    else oP = oP.concat(state.tavolo);
  }
  return calcolaPunti(aP, oP, state.aiScope, state.oppScope);
}

// Minimax con alpha-beta. Ritorna delta punti (AI - AVV) finale del round.
function solve(state, isAITurn, alpha, beta) {
  if (state.aiHand.length === 0 && state.oppHand.length === 0) {
    return chiudiRound(state);
  }
  const myHand = isAITurn ? state.aiHand : state.oppHand;
  if (myHand.length === 0) return solve(state, !isAITurn, alpha, beta);

  if (isAITurn) {
    let best = -Infinity;
    for (const carta of myHand) {
      const combs = trovaCombinazioni(carta, state.tavolo, state.assoPigliaTutto);
      const opzioni = combs.length === 0 ? [null] : combs;
      for (const comb of opzioni) {
        const next = applyMove(state, true, carta, comb);
        const sc = solve(next, false, alpha, beta);
        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
        if (alpha >= beta) return best;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (const carta of myHand) {
      const combs = trovaCombinazioni(carta, state.tavolo, state.assoPigliaTutto);
      const opzioni = combs.length === 0 ? [null] : combs;
      for (const comb of opzioni) {
        const next = applyMove(state, false, carta, comb);
        const sc = solve(next, true, alpha, beta);
        if (sc < best) best = sc;
        if (best < beta) beta = best;
        if (alpha >= beta) return best;
      }
    }
    return best;
  }
}

// Trigger: mazzo vuoto = ultima manche = info perfetta
function isEndgame(partita) {
  return partita.mazzo.rimanenti() === 0;
}

function statoIniziale(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);
  return {
    aiHand: ai.mano.slice(),
    oppHand: avv.mano.slice(),
    tavolo: partita.tavolo.slice(),
    aiPrese: ai.prese.slice(),
    oppPrese: avv.prese.slice(),
    aiScope: ai.scope.length,
    oppScope: avv.scope.length,
    lastPicker: partita.ultimoAPrendere === aiId ? 'AI'
              : partita.ultimoAPrendere === avv.id ? 'OPP'
              : null,
    assoPigliaTutto: !!partita.assoPigliaTutto
  };
}

// Sceglie la mossa AI ottimale per l'endgame.
function scegliMossaEndgame(partita, aiId) {
  if (!isEndgame(partita)) return null;
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  const initial = statoIniziale(partita, aiId);
  let bestMove = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const carta of initial.aiHand) {
    const combs = trovaCombinazioni(carta, initial.tavolo, initial.assoPigliaTutto);
    const opzioni = combs.length === 0 ? [null] : combs;
    for (const comb of opzioni) {
      const next = applyMove(initial, true, carta, comb);
      const sc = solve(next, false, alpha, beta);
      if (sc > bestScore) {
        bestScore = sc;
        bestMove = { cartaId: carta.id, cartePresaIds: comb ? comb.map(c => c.id) : [] };
      }
      if (bestScore > alpha) alpha = bestScore;
    }
  }
  return bestMove;
}

module.exports = {
  scegliMossaEndgame,
  isEndgame,
  solve,
  applyMove,
  calcolaPunti,
  primiera,
  trovaCombinazioni,
  statoIniziale
};
