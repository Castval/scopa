// IA "semplice" basata su euristiche, valida per tutti e 3 i tipi di gioco.
// La partita espone: trovaCombinazioni(carta, tavolo), tavolo, giocatori, mazzo
// Il bot e' sempre this.giocatori[1] (id BOT_ID).

const BOT_ID = '__BOT__';
const BOT_NOME = '🤖 Maresciallo Bot';

function valoreCarta(c) { return c.valore; }
function isSettebello(c) { return c.valore === 7 && c.seme === 'denari'; }
function isMarescialloSpecial(c) { return c.valore === 10 && c.seme === 'spade'; }

// Valuta quanto vale "prendere queste carte" (presa) o "lasciare questa carta sul tavolo" (posa)
function valutaPresa(carta, cartePrese, tavoloDopo, manoBot) {
  let punti = 0;
  // +10 per il settebello preso
  if (isSettebello(carta) || cartePrese.some(isSettebello)) punti += 10;
  // +1 per ogni denaro preso
  punti += cartePrese.filter(c => c.seme === 'denari').length;
  if (carta.seme === 'denari') punti += 1;
  // +0.6 per ogni carta totale (denari conta doppio)
  punti += (cartePrese.length + 1) * 0.6;
  // +20 se si fa scopa (tavolo svuotato e non e' l'ultima mossa)
  if (tavoloDopo.length === 0) punti += 20;
  // Maresciallo: bonus prenderlo (in maresciallo vale punti negativi, ma solo per maresciallo)
  // -8 se la presa lascia un settebello a terra
  if (tavoloDopo.some(isSettebello)) punti -= 8;
  // Picole carte di valore alto: +0.3
  punti += cartePrese.filter(c => c.valore >= 7).length * 0.3;
  return punti;
}

function valutaPosa(carta, tavoloDopo, manoBot) {
  let punti = 0;
  // Penalita' base: stai dando una carta gratis
  punti -= 1;
  // -8 se posando il settebello
  if (isSettebello(carta)) punti -= 15;
  // -3 se posi un denaro
  if (carta.seme === 'denari') punti -= 2;
  // -2 per carte alte (potrebbero servirti per scope)
  if (carta.valore >= 8) punti -= 1.5;
  // Valuta se il tavolo risultante permette all'avversario una presa facile
  // Stima: somma del tavolo dopo la posa
  const sommaTavolo = tavoloDopo.reduce((s, c) => s + c.valore, 0);
  // Se la somma e' bassa, l'avversario probabilmente puo' farla
  if (sommaTavolo <= 10 && tavoloDopo.length >= 2) punti -= 2;
  // Se posando lasci un asso a terra (potrebbe far prendere tutto in maresciallo)
  if (tavoloDopo.some(c => c.valore === 1)) punti -= 1;
  return punti;
}

// Sceglie la mossa migliore per il bot
function scegliMossaBot(partita) {
  const bot = partita.giocatori.find(g => g.id === BOT_ID);
  if (!bot || bot.mano.length === 0) return null;

  let migliore = null;
  let migliorPunteggio = -Infinity;

  for (const carta of bot.mano) {
    const combinazioni = partita.trovaCombinazioni(carta, partita.tavolo);
    if (combinazioni.length === 0) {
      // Posa
      const tavoloDopo = [...partita.tavolo, carta];
      const p = valutaPosa(carta, tavoloDopo, bot.mano);
      if (p > migliorPunteggio) {
        migliorPunteggio = p;
        migliore = { cartaId: carta.id, cartePresaIds: [] };
      }
    } else {
      // Per ogni combinazione, valuta la presa
      for (const comb of combinazioni) {
        const tavoloDopo = partita.tavolo.filter(c => !comb.some(cc => cc.id === c.id));
        const p = valutaPresa(carta, comb, tavoloDopo, bot.mano);
        if (p > migliorPunteggio) {
          migliorPunteggio = p;
          migliore = { cartaId: carta.id, cartePresaIds: comb.map(c => c.id) };
        }
      }
    }
  }
  return migliore;
}

module.exports = { BOT_ID, BOT_NOME, scegliMossaBot };
