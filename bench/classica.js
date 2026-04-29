// Benchmark Scopa Classica: confronta AI fra loro.
// Uso:
//   node bench/classica.js [N=200] [puntiVittoria=11] [opponente=euristica]
//   opponente: "euristica" (default) oppure "no-endgame" (AI senza solver)
//
// Per ogni partita alterna chi inizia (anti-bias da posizione).

const path = require('path');
const { ScopaClassica } = require(path.join(__dirname, '..', 'games', 'classica'));
const aiNuova = require(path.join(__dirname, '..', 'games', 'ai', 'classica'));
const endgame = require(path.join(__dirname, '..', 'games', 'ai', 'endgame'));
const { scegliMossaEuristica } = require(path.join(__dirname, '..', 'games', 'ai', 'euristica'));

// Varianti AI per benchmark di ablazione
function scegliMossaNoEndgame(partita, aiId) {
  return aiNuova.scegliMossa(partita, aiId, { disableEndgame: true });
}
function scegliMossaNoPimc(partita, aiId) {
  return aiNuova.scegliMossa(partita, aiId, { disablePimc: true });
}
function scegliMossaBase(partita, aiId) {
  // Solo valutazione 1-ply, niente endgame, niente PIMC
  return aiNuova.scegliMossa(partita, aiId, { disableEndgame: true, disablePimc: true });
}

const N = parseInt(process.argv[2] || '200', 10);
const PUNTI_VITTORIA = parseInt(process.argv[3] || '11', 10);
const OPPONENTE = process.argv[4] || 'euristica';

const ID_A = 'A';
const ID_B = 'B';

function scegliMossaPer(partita, giocatoreId, etichetta) {
  if (etichetta === 'NUOVA') {
    // env vars opzionali: PIMC_K, PIMC_DEPTH per ablation. Default = produzione.
    const opts = {};
    if (process.env.PIMC_K) opts.pimcK = parseInt(process.env.PIMC_K, 10);
    if (process.env.PIMC_DEPTH) opts.pimcDepth = parseInt(process.env.PIMC_DEPTH, 10);
    return aiNuova.scegliMossa(partita, giocatoreId, opts);
  }
  if (etichetta === 'NO_ENDGAME') return scegliMossaNoEndgame(partita, giocatoreId);
  if (etichetta === 'NO_PIMC') return scegliMossaNoPimc(partita, giocatoreId);
  if (etichetta === 'BASE') return scegliMossaBase(partita, giocatoreId);
  return scegliMossaEuristica(partita, giocatoreId);
}

const VARIANTI = {
  'euristica':  { etichetta: 'VECCHIA',     nome: 'EURISTICA' },
  'no-endgame': { etichetta: 'NO_ENDGAME',  nome: 'AI no-endgame' },
  'no-pimc':    { etichetta: 'NO_PIMC',     nome: 'AI no-PIMC' },
  'base':       { etichetta: 'BASE',        nome: 'AI 1-ply only' }
};
const ETICHETTA_AVV = (VARIANTI[OPPONENTE] || VARIANTI['euristica']).etichetta;
const NOME_AVV = (VARIANTI[OPPONENTE] || VARIANTI['euristica']).nome;

function giocaPartita(seed, primoEtichetta) {
  // primoEtichetta: 'NUOVA' o 'VECCHIA' — chi gioca come giocatore[0] (parte primo)
  const etichette = primoEtichetta === 'NUOVA'
    ? { [ID_A]: 'NUOVA', [ID_B]: ETICHETTA_AVV }
    : { [ID_A]: ETICHETTA_AVV, [ID_B]: 'NUOVA' };

  const partita = new ScopaClassica(`B${seed}`, PUNTI_VITTORIA, {});
  partita.tipoGioco = 'classica';
  partita.aggiungiGiocatore(ID_A, 'A');
  partita.aggiungiGiocatore(ID_B, 'B');
  partita.iniziaPartita();

  let safety = 10000;
  while (partita.stato === 'inCorso' || partita.stato === 'fineRound') {
    if (--safety <= 0) throw new Error('infinite loop');
    if (partita.stato === 'fineRound') {
      partita.nuovoRound();
      continue;
    }
    const corrente = partita.getGiocatoreCorrente();
    const et = etichette[corrente.id];
    const mossa = scegliMossaPer(partita, corrente.id, et);
    if (!mossa) {
      // Non dovrebbe mai succedere se la mano e' non vuota
      throw new Error(`mossa null per ${corrente.id} (${et})`);
    }
    const r = partita.eseguiMossa(corrente.id, mossa.cartaId, mossa.cartePresaIds);
    if (!r.valida) {
      throw new Error(`mossa invalida ${corrente.id} (${et}): ${r.errore}`);
    }
  }

  // Aggrega risultato per etichetta
  const dett = partita.calcolaPuntiRoundDettagliato();
  // dett e' indicizzato per id giocatore + per indice squadra; uso id
  // Nota: dett[ID] include il dettaglio dell'ULTIMO round, non cumulativo.
  // Per i totali partita uso giocatori.puntiTotali.

  const out = { NUOVA: { vinta: 0, punti: 0 }, [ETICHETTA_AVV]: { vinta: 0, punti: 0 } };
  for (const g of partita.giocatori) {
    const et = etichette[g.id];
    out[et].punti = g.puntiTotali;
  }
  if (out.NUOVA.punti > out[ETICHETTA_AVV].punti) out.NUOVA.vinta = 1;
  else if (out[ETICHETTA_AVV].punti > out.NUOVA.punti) out[ETICHETTA_AVV].vinta = 1;
  return out;
}

function main() {
  console.log(`Benchmark Classica: ${N} partite, ${PUNTI_VITTORIA} punti per vittoria`);
  console.log(`AI NUOVA vs ${NOME_AVV}, alterna chi inizia\n`);

  const tot = { NUOVA: { vinte: 0, punti: 0 }, [ETICHETTA_AVV]: { vinte: 0, punti: 0 } };
  let pareggi = 0;
  const t0 = Date.now();

  for (let i = 0; i < N; i++) {
    const primo = (i % 2 === 0) ? 'NUOVA' : ETICHETTA_AVV;
    const r = giocaPartita(i, primo);
    tot.NUOVA.vinte += r.NUOVA.vinta;
    tot[ETICHETTA_AVV].vinte += r[ETICHETTA_AVV].vinta;
    tot.NUOVA.punti += r.NUOVA.punti;
    tot[ETICHETTA_AVV].punti += r[ETICHETTA_AVV].punti;
    if (r.NUOVA.vinta === 0 && r[ETICHETTA_AVV].vinta === 0) pareggi++;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  const wrN = (tot.NUOVA.vinte / N * 100).toFixed(1);
  const wrV = (tot[ETICHETTA_AVV].vinte / N * 100).toFixed(1);
  const ppN = (tot.NUOVA.punti / N).toFixed(2);
  const ppV = (tot[ETICHETTA_AVV].punti / N).toFixed(2);

  console.log(`Tempo: ${dt}s (${(N / dt).toFixed(1)} partite/s)`);
  console.log(`AI NUOVA   : ${tot.NUOVA.vinte}/${N} (${wrN}%) — punti medi ${ppN}`);
  console.log(`${NOME_AVV.padEnd(11)}: ${tot[ETICHETTA_AVV].vinte}/${N} (${wrV}%) — punti medi ${ppV}`);
  console.log(`Pareggi    : ${pareggi}`);
  const delta = parseFloat(ppN) - parseFloat(ppV);
  console.log(`Delta punti: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} a favore della NUOVA`);
}

main();
