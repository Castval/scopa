// AI per Scopone Scientifico (2v2, 10 carte in mano, no pesca durante il round).
// TODO: gioco a info quasi perfetta a fine round → solver esatto + segnali di squadra.
// Per ora: euristica greedy condivisa.

const { scegliMossaEuristica } = require('./euristica');

function scegliMossa(partita, aiId) {
  return scegliMossaEuristica(partita, aiId);
}

module.exports = { scegliMossa };
