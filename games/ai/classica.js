// AI per Scopa Classica.
// Strategia: 1-ply con valutazione di stato che stima i 5 punti di fine round
// (scope, settebello, denari, carte, primiera) + loss attesa dalla prossima
// mossa avversaria (rischio scopa, carte regalate). Usa inferenza ipergeometrica
// sulle carte sconosciute (mano avversaria + mazzo) per pesare le minacce.
//
// Step successivo (b): ISMCTS con questa funzione come rollout policy + endgame
// solver esatto sull'ultima manche.

const endgame = require('./endgame');
const pimc = require('./pimc');

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

// === Componenti del punteggio atteso (espressi come "punti AI - punti avv") ===

function scoreSettebello(miePrese, suePrese, manoAvv, sconosciute) {
  if (miePrese.some(isSettebello)) return 1;
  if (suePrese.some(isSettebello)) return -1;
  // Ancora in giro: se in mano mia non e' tra sconosciute
  if (!sconosciute.some(isSettebello)) return 0;
  // Tra mano avv + mazzo: stima P(avv ce l'ha)
  const n = sconosciute.length;
  if (n === 0) return 0;
  const pAvv = manoAvv / n;
  return -pAvv * 0.5;
}

function scoreDenari(miePrese, suePrese) {
  const m = miePrese.filter(c => c.seme === 'denari').length;
  const l = suePrese.filter(c => c.seme === 'denari').length;
  if (m >= 6) return 1;
  if (l >= 6) return -1;
  return Math.tanh((m - l) / 2.5);
}

function scoreCarte(miePrese, suePrese) {
  const m = miePrese.length;
  const l = suePrese.length;
  if (m >= 21) return 1;
  if (l >= 21) return -1;
  return Math.tanh((m - l) / 5);
}

function scorePrimiera(miePrese, suePrese) {
  const pm = valorePrimiera(miePrese);
  const pl = valorePrimiera(suePrese);
  const semiM = semiCoperti(miePrese);
  const semiL = semiCoperti(suePrese);
  let bonus = 0;
  if (semiM === 4 && semiL < 4) bonus += 0.2;
  if (semiL === 4 && semiM < 4) bonus -= 0.2;
  return Math.tanh((pm - pl) / 12) * 0.7 + bonus;
}

// === Carte sconosciute (in mano avv + nel mazzo) ===
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

// P(avversario ha >=1 carta tra `matching` su `n` totali sconosciute, mano `h`)
// Ipergeometrica: 1 - C(n-matching, h) / C(n, h)
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

// === Loss attesa dalla prossima mossa avversaria ===
// Per ogni valore v che l'avversario potrebbe giocare, peso per P(ce l'ha)
// e calcolo la presa migliore (peggiore per noi) sul tavolo post-mia-mossa.
function stimaLossProssima(partita, statoDopo) {
  const tavolo = statoDopo.tavolo;
  if (tavolo.length === 0) return 0;
  const sconosciute = statoDopo.sconosciute;
  const n = sconosciute.length;
  const h = statoDopo.manoAvvSize;
  if (n === 0 || h === 0) return 0;

  // L'ultima mossa del round per avv non conta come scopa
  const ultimaPerAvv = h === 1 && partita.mazzo.rimanenti() === 0 && statoDopo.mieCarteResidue === 0;

  let loss = 0;
  for (let v = 1; v <= 10; v++) {
    const cardsV = sconosciute.filter(c => c.valore === v);
    if (cardsV.length === 0) continue;
    const p = pAvvHa(cardsV.length, n, h);
    if (p < 0.04) continue;

    const fakeCarta = { valore: v, seme: 'denari', id: '__fake__' };
    const combs = partita.trovaCombinazioni(fakeCarta, tavolo);
    if (combs.length === 0) continue;

    const totV = cardsV.length;
    const denariV = cardsV.filter(c => c.seme === 'denari').length;
    const pDen = denariV / totV;
    const pSette = (v === 7) ? pDen : 0;

    let worst = 0;
    for (const comb of combs) {
      const tavoloDopo2 = tavolo.filter(c => !comb.some(cc => cc.id === c.id));
      const scopa = tavoloDopo2.length === 0 && !ultimaPerAvv;
      let val = scopa ? 1.0 : 0;
      // Carte raccolte (semi noti)
      for (const c of comb) {
        if (isSettebello(c)) val += 1.0;
        if (c.seme === 'denari') val += 0.30;
        val += 0.04;
        val += Math.max(0, PRIMIERA_VALORI[c.valore] - 10) * 0.04;
      }
      // Carta giocata dall'avv (seme atteso)
      val += pSette * 1.0;
      val += pDen * 0.30;
      val += 0.04;
      val += Math.max(0, PRIMIERA_VALORI[v] - 10) * 0.04;

      if (val > worst) worst = val;
    }
    loss += p * worst;
  }
  return loss;
}

function valutaStato(partita, statoDopo) {
  const { miePrese, suePrese, mieScope, sueScope, manoAvvSize, sconosciute } = statoDopo;
  let s = 0;
  s += (mieScope - sueScope) * 1.0;
  s += scoreSettebello(miePrese, suePrese, manoAvvSize, sconosciute);
  s += scoreDenari(miePrese, suePrese);
  s += scoreCarte(miePrese, suePrese);
  s += scorePrimiera(miePrese, suePrese);
  s -= stimaLossProssima(partita, statoDopo);
  return s;
}

// === Genera lo stato post-mossa AI senza clonare la partita ===
function applicaMossa(partita, aiId, carta, comb, sconosciuteBase) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  const avv = partita.giocatori.find(g => g.id !== aiId);

  // Asso piglia tutto giocato con tavolo vuoto: va nelle prese (assoSolo)
  if (partita.assoPigliaTutto && carta.valore === 1 && partita.tavolo.length === 0) {
    return {
      miePrese: [...ai.prese, carta],
      suePrese: avv.prese,
      mieScope: ai.scope.length,
      sueScope: avv.scope.length,
      tavolo: [],
      manoAvvSize: avv.mano.length,
      sconosciute: sconosciuteBase,
      mieCarteResidue: ai.mano.length - 1
    };
  }

  if (!comb || comb.length === 0) {
    return {
      miePrese: ai.prese,
      suePrese: avv.prese,
      mieScope: ai.scope.length,
      sueScope: avv.scope.length,
      tavolo: [...partita.tavolo, carta],
      manoAvvSize: avv.mano.length,
      sconosciute: sconosciuteBase,
      mieCarteResidue: ai.mano.length - 1
    };
  }

  const tavoloDopo = partita.tavolo.filter(c => !comb.some(cc => cc.id === c.id));
  const ultimaMia = ai.mano.length === 1 && avv.mano.length === 0 && partita.mazzo.rimanenti() === 0;
  const scopaFatta = tavoloDopo.length === 0 && !ultimaMia;

  return {
    miePrese: [...ai.prese, carta, ...comb],
    suePrese: avv.prese,
    mieScope: ai.scope.length + (scopaFatta ? 1 : 0),
    sueScope: avv.scope.length,
    tavolo: tavoloDopo,
    manoAvvSize: avv.mano.length,
    sconosciute: sconosciuteBase,
    mieCarteResidue: ai.mano.length - 1
  };
}

// Routing principale. opts (per benchmark/test):
//   disableEndgame: bool   - salta solver esatto sull'ultima manche
//   disablePimc: bool      - salta PIMC mid-game (usa solo 1-ply euristica)
//   pimcK, pimcDepth: int  - parametri PIMC
function scegliMossa(partita, aiId, opts = {}) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  // Endgame: mazzo vuoto = info perfetta, risolvi esattamente.
  if (!opts.disableEndgame && endgame.isEndgame(partita)) {
    const m = endgame.scegliMossaEndgame(partita, aiId);
    if (m) return m;
  }

  // Mid-game: PIMC (default) o fallback 1-ply.
  if (!opts.disablePimc) {
    const m = pimc.scegliMossaPIMC(partita, aiId, { K: opts.pimcK, depth: opts.pimcDepth });
    if (m) return m;
  }

  return scegliMossa1Ply(partita, aiId);
}

// Valutazione 1-ply: esposta come fallback e per benchmark.
function scegliMossa1Ply(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  const sconosciuteBase = carteSconosciute(partita, aiId);
  let migliore = null;
  let migliorPunteggio = -Infinity;

  for (const carta of ai.mano) {
    const combinazioni = partita.trovaCombinazioni(carta, partita.tavolo);

    if (combinazioni.length === 0) {
      const stato = applicaMossa(partita, aiId, carta, null, sconosciuteBase);
      const p = valutaStato(partita, stato);
      if (p > migliorPunteggio) {
        migliorPunteggio = p;
        migliore = { cartaId: carta.id, cartePresaIds: [] };
      }
    } else {
      for (const comb of combinazioni) {
        const stato = applicaMossa(partita, aiId, carta, comb, sconosciuteBase);
        const p = valutaStato(partita, stato);
        if (p > migliorPunteggio) {
          migliorPunteggio = p;
          migliore = { cartaId: carta.id, cartePresaIds: comb.map(c => c.id) };
        }
      }
    }
  }
  return migliore;
}

module.exports = {
  scegliMossa,
  scegliMossa1Ply,
  // Esposti per test/benchmark
  valutaStato,
  applicaMossa,
  carteSconosciute,
  valorePrimiera,
  pAvvHa
};
