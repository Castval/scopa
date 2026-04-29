// Dispatcher AI: instrada la richiesta di mossa al modulo giusto in base al tipo di gioco.

const classica = require('./classica');
const maresciallo = require('./maresciallo');
const scopone = require('./scopone');

const AI_ID = '__BOT__'; // mantenuto stabile per compatibilita' wire

const NOMI = {
  classica: '🤖 AI Scopa',
  maresciallo: '🤖 AI Maresciallo',
  scientifico: '🤖 AI Scopone'
};

function getAINome(tipoGioco) {
  return NOMI[tipoGioco] || '🤖 AI';
}

function scegliMossa(partita) {
  const tipo = partita.tipoGioco;
  if (tipo === 'classica') return classica.scegliMossa(partita, AI_ID);
  if (tipo === 'scientifico') return scopone.scegliMossa(partita, AI_ID);
  return maresciallo.scegliMossa(partita, AI_ID);
}

module.exports = { AI_ID, getAINome, scegliMossa };
