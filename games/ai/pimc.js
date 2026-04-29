// PIMC (Perfect Information Monte Carlo) per il mid-game di Scopa Classica.
//
// Campiona K determinizzazioni della mano avversaria (uniformi sulle carte
// sconosciute = mano avv + mazzo). Per ciascun campione esegue un minimax
// depth-d con alpha-beta tra mossa AI e risposta avversaria, valutazione
// foglia con un'euristica leggera (lo stato e' info-perfetta nel campione,
// quindi non serve "stima loss"). Media gli score sulle K determinizzazioni
// e sceglie la mossa AI col valore atteso piu' alto.
//
// Limiti noti (verranno affrontati se il delta sul benchmark non basta):
// - Sampling uniforme: non aggiorna la posterior in base alle mosse osservate
//   (es. "ha posato invece di prendere -> non ha quel valore").
// - No simulazione del mazzo: oltre il deal boundary la search si ferma.
// - Strategia fusion (problema noto del PIMC): l'AI assume info perfetta nel
//   campione, quindi puo' giocare in modo "telepatico" sul leaf.

const { applyMove, trovaCombinazioni } = require('./endgame');

const SEMI = ['denari', 'coppe', 'bastoni', 'spade'];
const PRIMIERA_VALORI = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

const isSettebello = (c) => c.valore === 7 && c.seme === 'denari';

function valorePrimiera(carte) {
  const best = {};
  for (const c of carte) {
    const v = PRIMIERA_VALORI[c.valore];
    if (best[c.seme] === undefined || v > best[c.seme]) best[c.seme] = v;
  }
  return Object.values(best).reduce((s, v) => s + v, 0);
}

function semiCoperti(carte) {
  const set = new Set();
  for (const c of carte) set.add(c.seme);
  return set.size;
}

// === Valutazione foglia per stato determinizzato ===
// Diverso da classica.valutaStato: niente "stima loss prossima mossa" perche'
// nel campione conosciamo gia' le carte avv -> la search modella le minacce.
function evalState(state) {
  const aiPrese = state.aiPrese;
  const oppPrese = state.oppPrese;
  let s = 0;

  // Scope sicure
  s += state.aiScope - state.oppScope;

  // Settebello
  if (aiPrese.some(isSettebello)) s += 1;
  else if (oppPrese.some(isSettebello)) s -= 1;
  else if (state.oppHand.some(isSettebello)) s -= 0.5;
  // Se sul tavolo o nel mazzo (non in oppHand qui): neutro

  // Denari
  const dAi = aiPrese.filter(c => c.seme === 'denari').length;
  const dOpp = oppPrese.filter(c => c.seme === 'denari').length;
  if (dAi >= 6) s += 1;
  else if (dOpp >= 6) s -= 1;
  else s += Math.tanh((dAi - dOpp) / 2.5);

  // Carte
  if (aiPrese.length >= 21) s += 1;
  else if (oppPrese.length >= 21) s -= 1;
  else s += Math.tanh((aiPrese.length - oppPrese.length) / 5);

  // Primiera
  const pAi = valorePrimiera(aiPrese);
  const pOpp = valorePrimiera(oppPrese);
  let bonus = 0;
  if (semiCoperti(aiPrese) === 4 && semiCoperti(oppPrese) < 4) bonus += 0.2;
  if (semiCoperti(oppPrese) === 4 && semiCoperti(aiPrese) < 4) bonus -= 0.2;
  s += Math.tanh((pAi - pOpp) / 12) * 0.7 + bonus;

  return s;
}

// === Minimax depth-limited con alpha-beta ===
function search(state, depth, isAITurn, alpha, beta) {
  if (state.aiHand.length === 0 && state.oppHand.length === 0) {
    // Boundary di deal (mazzo > 0 per costruzione di chi chiama PIMC):
    // non simuliamo il prossimo deal, valutiamo qui.
    return evalState(state);
  }
  if (depth === 0) return evalState(state);

  const myHand = isAITurn ? state.aiHand : state.oppHand;
  if (myHand.length === 0) return search(state, depth, !isAITurn, alpha, beta);

  if (isAITurn) {
    let best = -Infinity;
    for (const carta of myHand) {
      const combs = trovaCombinazioni(carta, state.tavolo, state.assoPigliaTutto);
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
      const combs = trovaCombinazioni(carta, state.tavolo, state.assoPigliaTutto);
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

// === Sampling uniforme: prende k elementi distinti da arr (Fisher-Yates parziale) ===
function sampleHand(arr, k) {
  if (k >= arr.length) return arr.slice();
  const a = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

function carteSconosciute(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);
  const visti = new Set();
  for (const c of ai.mano) visti.add(c.id);
  for (const c of partita.tavolo) visti.add(c.id);
  for (const c of ai.prese) visti.add(c.id);
  for (const c of avv.prese) visti.add(c.id);
  const out = [];
  for (const seme of SEMI) {
    for (let v = 1; v <= 10; v++) {
      const id = `${v}_${seme}`;
      if (!visti.has(id)) out.push({ valore: v, seme, id });
    }
  }
  return out;
}

function enumeraMosseLegali(mano, tavolo, assoPigliaTutto) {
  const out = [];
  for (const carta of mano) {
    const combs = trovaCombinazioni(carta, tavolo, assoPigliaTutto);
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

function scegliMossaPIMC(partita, aiId, opts = {}) {
  const K = opts.K || 30;
  // depth=5 (post-mia-mossa: opp, me, opp, me, leaf) e' il sweet spot misurato:
  // depth=2 perde vs 1-ply euristica (no orizzonte), depth=5 +8pp.
  const depth = opts.depth || 5;

  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);
  if (!ai || ai.mano.length === 0) return null;

  const sconosciute = carteSconosciute(partita, aiId);
  const oppHandSize = avv.mano.length;
  if (sconosciute.length < oppHandSize) return null;

  const mosseAI = enumeraMosseLegali(ai.mano, partita.tavolo, partita.assoPigliaTutto);
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
      aiScope: ai.scope.length,
      oppScope: avv.scope.length,
      lastPicker: lastPickerLabel,
      assoPigliaTutto: !!partita.assoPigliaTutto
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

module.exports = { scegliMossaPIMC, evalState, search, sampleHand, carteSconosciute };
