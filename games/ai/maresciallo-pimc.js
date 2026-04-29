// PIMC mid-game per Scopa Maresciallo (2 giocatori).
//
// Riusa lo stesso schema della classica (sample mani avversario + minimax
// alpha-beta), adattato a:
// - doppio mazzo (sconosciute fino a 80 carte iniziali)
// - mano avv = 5 carte
// - branching maggiore (5 carte * combinazioni)
//
// Default depth=4 (sweet spot stimato): branching ~8 -> 8^3 = 512 leaves per
// sample. K=20 samples * ~10 mosse AI = ~100k leaves per decisione.

const { trovaCombinazioni, applyMove, calcolaPunti, primiera, napola, carteSconosciute } = require('./maresciallo');

const isSettebello = (c) => c.valore === 7 && c.seme === 'denari';
const isMaresciallo = (c) => c.valore === 10 && c.seme === 'spade';
const isOttoDenari = (c) => c.valore === 8 && c.seme === 'denari';

const PRIMIERA_VALORI = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

// Valutazione foglia leggera (lo state e' info-perfetto nel sample, la search
// modella opp -> niente "stima loss").
function evalState(state) {
  const aiPrese = state.aiPrese;
  const oppPrese = state.oppPrese;
  let s = 0;

  // Scope variabili (gia' incluse: 1/3/-4/+10)
  s += state.aiScopeSum - state.oppScopeSum;

  // Penalita' marescialli residui
  const aiMar = aiPrese.filter(isMaresciallo).length;
  const oppMar = oppPrese.filter(isMaresciallo).length;
  s -= Math.max(0, aiMar - state.aiScopeNeg - 2 * state.aiScopePos);
  s += Math.max(0, oppMar - state.oppScopeNeg - 2 * state.oppScopePos);

  // Settebello (fino a 2)
  const aiSette = aiPrese.filter(isSettebello).length;
  const oppSette = oppPrese.filter(isSettebello).length;
  s += aiSette - oppSette;

  // Otto denari accoppiato col settebello
  const aiOtto = aiPrese.filter(isOttoDenari).length;
  const oppOtto = oppPrese.filter(isOttoDenari).length;
  s += Math.min(aiSette, aiOtto) - Math.min(oppSette, oppOtto);

  // Race: denari (20 totali, soglia 11)
  const aiDen = aiPrese.filter(c => c.seme === 'denari').length;
  const oppDen = oppPrese.filter(c => c.seme === 'denari').length;
  if (aiDen >= 11) s += 1;
  else if (oppDen >= 11) s -= 1;
  else s += Math.tanh((aiDen - oppDen) / 4);

  // Race: carte (80 totali, soglia 41)
  if (aiPrese.length >= 41) s += 1;
  else if (oppPrese.length >= 41) s -= 1;
  else s += Math.tanh((aiPrese.length - oppPrese.length) / 8);

  // Primiera
  const aiP = primiera(aiPrese);
  const oppP = primiera(oppPrese);
  s += Math.tanh((aiP - oppP) / 12) * 0.7;

  // Napola (esatto)
  s += napola(aiPrese) - napola(oppPrese);

  return s;
}

function search(state, depth, isAITurn, alpha, beta) {
  if (state.aiHand.length === 0 && state.oppHand.length === 0) {
    // Boundary di deal (deckCount > 0 per costruzione PIMC mid-game).
    return evalState(state);
  }
  if (depth === 0) return evalState(state);

  const myHand = isAITurn ? state.aiHand : state.oppHand;
  if (myHand.length === 0) return search(state, depth, !isAITurn, alpha, beta);

  if (isAITurn) {
    let best = -Infinity;
    for (const carta of myHand) {
      const combs = trovaCombinazioni(carta, state.tavolo);
      const opzioni = combs.length === 0 ? [null] : combs;
      for (const comb of opzioni) {
        const next = applyMove(state, true, carta, comb);
        const sc = search(next, depth - 1, false, alpha, beta);
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
        const sc = search(next, depth - 1, true, alpha, beta);
        if (sc < best) best = sc;
        if (best < beta) beta = best;
        if (alpha >= beta) return best;
      }
    }
    return best;
  }
}

function sampleHand(arr, k) {
  if (k >= arr.length) return arr.slice();
  const a = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

function enumeraMosseLegali(mano, tavolo) {
  const out = [];
  for (const carta of mano) {
    const combs = trovaCombinazioni(carta, tavolo);
    if (combs.length === 0) {
      out.push({ carta, comb: null, cartaId: carta.id, cartePresaIds: [] });
    } else {
      for (const comb of combs) {
        out.push({ carta, comb, cartaId: carta.id, cartePresaIds: comb.map(c => c.id) });
      }
    }
  }
  return out;
}

function sumScope(scope) { return scope.reduce((s, x) => s + x.valore, 0); }
function countScopeNeg(scope) { return scope.filter(s => s.valore === -4).length; }
function countScopePos(scope) { return scope.filter(s => s.marescialloConMaresciallo).length; }

function scegliMossaPIMC(partita, aiId, opts = {}) {
  const K = opts.K || 15;
  // depth=5 sweet spot misurato: depth=4 perde vs 1-ply, depth=5 +10pp.
  // K=15 (vs K=30 della classica) per compensare il branching maggiore (5 carte in mano).
  const depth = opts.depth || 5;

  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);
  if (!ai || ai.mano.length === 0) return null;

  const sconosciute = carteSconosciute(partita, aiId);
  const oppHandSize = avv.mano.length;
  if (sconosciute.length < oppHandSize) return null;

  const mosseAI = enumeraMosseLegali(ai.mano, partita.tavolo);
  if (mosseAI.length === 0) return null;
  if (mosseAI.length === 1) {
    const m = mosseAI[0];
    return { cartaId: m.cartaId, cartePresaIds: m.cartePresaIds };
  }

  const lastPickerLabel = partita.ultimoAPrendere === aiId ? 'AI'
                       : partita.ultimoAPrendere === avv.id ? 'OPP'
                       : null;

  const punteggi = new Array(mosseAI.length).fill(0);

  for (let k = 0; k < K; k++) {
    const sampled = sampleHand(sconosciute, oppHandSize);
    const stateBase = {
      aiHand: ai.mano.slice(),
      oppHand: sampled,
      tavolo: partita.tavolo.slice(),
      aiPrese: ai.prese.slice(),
      oppPrese: avv.prese.slice(),
      aiScopeSum: sumScope(ai.scope),
      oppScopeSum: sumScope(avv.scope),
      aiScopeNeg: countScopeNeg(ai.scope),
      oppScopeNeg: countScopeNeg(avv.scope),
      aiScopePos: countScopePos(ai.scope),
      oppScopePos: countScopePos(avv.scope),
      lastPicker: lastPickerLabel,
      deckCount: partita.mazzo.rimanenti()
    };

    for (let i = 0; i < mosseAI.length; i++) {
      const m = mosseAI[i];
      const stateDopo = applyMove(stateBase, true, m.carta, m.comb);
      const sc = search(stateDopo, depth - 1, false, -Infinity, Infinity);
      punteggi[i] += sc;
    }
  }

  let best = 0;
  for (let i = 1; i < punteggi.length; i++) {
    if (punteggi[i] > punteggi[best]) best = i;
  }
  const m = mosseAI[best];
  return { cartaId: m.cartaId, cartePresaIds: m.cartePresaIds };
}

module.exports = { scegliMossaPIMC };
