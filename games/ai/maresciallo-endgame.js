// Endgame solver per Scopa Maresciallo (2 giocatori).
//
// Trigger: mazzo vuoto = ultima manche = info perfetta (le sconosciute coincidono
// con la mano avversaria). Minimax esatto con alpha-beta.
//
// Costo atteso: ultima manche = 5 carte ciascuno = 10 plies. Branching ~5-15
// mosse per ply. Con α-β: tipicamente <100ms. Per casi peggiori (tavolo grande)
// puo' arrivare a ~500ms; un timeout duro non e' implementato — se serve, ridurre
// la profondita' o aggiungere ordering.

const { trovaCombinazioni, applyMove, calcolaPunti } = require('./maresciallo');

function chiudiRound(state) {
  // Carte residue al lastPicker
  let aP = state.aiPrese;
  let oP = state.oppPrese;
  if (state.tavolo.length > 0 && state.lastPicker !== null) {
    if (state.lastPicker === 'AI') aP = aP.concat(state.tavolo);
    else oP = oP.concat(state.tavolo);
  }
  const closed = {
    ...state,
    aiPrese: aP,
    oppPrese: oP,
    tavolo: []
  };
  return calcolaPunti(closed);
}

function solve(state, isAITurn, alpha, beta) {
  if (state.aiHand.length === 0 && state.oppHand.length === 0) {
    return chiudiRound(state);
  }
  const myHand = isAITurn ? state.aiHand : state.oppHand;
  if (myHand.length === 0) return solve(state, !isAITurn, alpha, beta);

  if (isAITurn) {
    let best = -Infinity;
    for (const carta of myHand) {
      const combs = trovaCombinazioni(carta, state.tavolo);
      // Per asso con tavolo vuoto: combs e' [], ma in maresciallo l'asso va comunque nelle prese
      // (assoSolo). applyMove gestisce il caso. Qui rappresento "asso solo" come opzione [null].
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
      const combs = trovaCombinazioni(carta, state.tavolo);
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
    aiScopeSum: sumScope(ai.scope),
    oppScopeSum: sumScope(avv.scope),
    aiScopeNeg: countScopeNeg(ai.scope),
    oppScopeNeg: countScopeNeg(avv.scope),
    aiScopePos: countScopePos(ai.scope),
    oppScopePos: countScopePos(avv.scope),
    lastPicker: partita.ultimoAPrendere === aiId ? 'AI'
              : partita.ultimoAPrendere === avv.id ? 'OPP'
              : null,
    deckCount: 0
  };
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
    const combs = trovaCombinazioni(carta, initial.tavolo);
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

module.exports = { scegliMossaEndgame, isEndgame, solve, statoIniziale };
