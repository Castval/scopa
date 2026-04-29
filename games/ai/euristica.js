// Euristica greedy 1-ply condivisa — usata come baseline / fallback dai 3 AI.
// Verra' sostituita gradualmente da logiche specifiche per gioco
// (classica: ISMCTS + endgame solver; maresciallo: regole proprie; scopone: idem).

function isSettebello(c) { return c.valore === 7 && c.seme === 'denari'; }

function valutaPresa(carta, cartePrese, tavoloDopo) {
  let punti = 0;
  if (isSettebello(carta) || cartePrese.some(isSettebello)) punti += 10;
  punti += cartePrese.filter(c => c.seme === 'denari').length;
  if (carta.seme === 'denari') punti += 1;
  punti += (cartePrese.length + 1) * 0.6;
  if (tavoloDopo.length === 0) punti += 20;
  if (tavoloDopo.some(isSettebello)) punti -= 8;
  punti += cartePrese.filter(c => c.valore >= 7).length * 0.3;
  return punti;
}

function valutaPosa(carta, tavoloDopo) {
  let punti = -1;
  if (isSettebello(carta)) punti -= 15;
  if (carta.seme === 'denari') punti -= 2;
  if (carta.valore >= 8) punti -= 1.5;
  const sommaTavolo = tavoloDopo.reduce((s, c) => s + c.valore, 0);
  if (sommaTavolo <= 10 && tavoloDopo.length >= 2) punti -= 2;
  if (tavoloDopo.some(c => c.valore === 1)) punti -= 1;
  return punti;
}

function scegliMossaEuristica(partita, aiId) {
  const ai = partita.giocatori.find(g => g.id === aiId);
  if (!ai || ai.mano.length === 0) return null;

  let migliore = null;
  let migliorPunteggio = -Infinity;

  for (const carta of ai.mano) {
    const combinazioni = partita.trovaCombinazioni(carta, partita.tavolo);
    if (combinazioni.length === 0) {
      const tavoloDopo = [...partita.tavolo, carta];
      const p = valutaPosa(carta, tavoloDopo);
      if (p > migliorPunteggio) {
        migliorPunteggio = p;
        migliore = { cartaId: carta.id, cartePresaIds: [] };
      }
    } else {
      for (const comb of combinazioni) {
        const tavoloDopo = partita.tavolo.filter(c => !comb.some(cc => cc.id === c.id));
        const p = valutaPresa(carta, comb, tavoloDopo);
        if (p > migliorPunteggio) {
          migliorPunteggio = p;
          migliore = { cartaId: carta.id, cartePresaIds: comb.map(c => c.id) };
        }
      }
    }
  }
  return migliore;
}

module.exports = { scegliMossaEuristica, valutaPresa, valutaPosa, isSettebello };
