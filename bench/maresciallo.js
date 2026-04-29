// Benchmark Scopa Maresciallo (2 giocatori).
// Uso: node bench/maresciallo.js [N=200] [puntiVittoria=31] [opponente=euristica]

const path = require('path');
const { ScopaMaresciallo } = require(path.join(__dirname, '..', 'games', 'maresciallo'));
const aiNuova = require(path.join(__dirname, '..', 'games', 'ai', 'maresciallo'));
const { scegliMossaEuristica } = require(path.join(__dirname, '..', 'games', 'ai', 'euristica'));

const N = parseInt(process.argv[2] || '200', 10);
const PUNTI_VITTORIA = parseInt(process.argv[3] || '31', 10);
const OPPONENTE = process.argv[4] || 'euristica';

const ID_A = 'A';
const ID_B = 'B';

function scegliMossaPer(partita, gid, etichetta) {
  if (etichetta === 'NUOVA') {
    const opts = {};
    if (process.env.PIMC_K) opts.pimcK = parseInt(process.env.PIMC_K, 10);
    if (process.env.PIMC_DEPTH) opts.pimcDepth = parseInt(process.env.PIMC_DEPTH, 10);
    return aiNuova.scegliMossa(partita, gid, opts);
  }
  if (etichetta === 'NO_PIMC') return aiNuova.scegliMossa(partita, gid, { disablePimc: true });
  if (etichetta === 'NO_ENDGAME') return aiNuova.scegliMossa(partita, gid, { disableEndgame: true });
  if (etichetta === 'BASE') return aiNuova.scegliMossa(partita, gid, { disableEndgame: true, disablePimc: true });
  return scegliMossaEuristica(partita, gid);
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
  const etichette = primoEtichetta === 'NUOVA'
    ? { [ID_A]: 'NUOVA', [ID_B]: ETICHETTA_AVV }
    : { [ID_A]: ETICHETTA_AVV, [ID_B]: 'NUOVA' };

  const partita = new ScopaMaresciallo(`B${seed}`, PUNTI_VITTORIA, 2);
  partita.tipoGioco = 'maresciallo';
  partita.aggiungiGiocatore(ID_A, 'A');
  partita.aggiungiGiocatore(ID_B, 'B');
  partita.iniziaPartita();

  let safety = 50000;
  while (partita.stato === 'inCorso' || partita.stato === 'fineRound') {
    if (--safety <= 0) throw new Error('infinite loop');
    if (partita.stato === 'fineRound') {
      partita.nuovoRound();
      continue;
    }
    const corrente = partita.getGiocatoreCorrente();
    const et = etichette[corrente.id];
    const mossa = scegliMossaPer(partita, corrente.id, et);
    if (!mossa) throw new Error(`mossa null per ${corrente.id} (${et})`);
    const r = partita.eseguiMossa(corrente.id, mossa.cartaId, mossa.cartePresaIds);
    if (!r.valida) throw new Error(`mossa invalida ${corrente.id} (${et}): ${r.errore}`);
  }

  const out = { NUOVA: { vinta: 0, punti: 0 }, [ETICHETTA_AVV]: { vinta: 0, punti: 0 } };
  for (const g of partita.giocatori) {
    out[etichette[g.id]].punti = g.puntiTotali;
  }
  if (out.NUOVA.punti > out[ETICHETTA_AVV].punti) out.NUOVA.vinta = 1;
  else if (out[ETICHETTA_AVV].punti > out.NUOVA.punti) out[ETICHETTA_AVV].vinta = 1;
  return out;
}

function main() {
  console.log(`Benchmark Maresciallo: ${N} partite, ${PUNTI_VITTORIA} punti per vittoria`);
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
