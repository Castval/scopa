const Database = require('better-sqlite3');
const bcrypt = require('./bcrypt-async'); // async via worker thread — non blocca event loop
const crypto = require('crypto');
const path = require('path');

// Cost factor bcrypt: 12 = +sicurezza (~250-500ms per hash a seconda hardware).
const BCRYPT_COST = 12;

const db = new Database(path.join(__dirname, 'scopa.db'));

// Attiva WAL per performance
db.pragma('journal_mode = WAL');

// Crea tabella utenti
db.exec(`
  CREATE TABLE IF NOT EXISTS utenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_temporanea INTEGER DEFAULT 0,
    partite_giocate INTEGER DEFAULT 0,
    partite_vinte INTEGER DEFAULT 0,
    partite_perse INTEGER DEFAULT 0,
    punti INTEGER DEFAULT 0,
    creato_il DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrazioni
try { db.exec('ALTER TABLE utenti ADD COLUMN password_temporanea INTEGER DEFAULT 0'); } catch (e) { /* gia' esiste */ }
try { db.exec('ALTER TABLE utenti ADD COLUMN tornei_giocati INTEGER DEFAULT 0'); } catch (e) { /* gia' esiste */ }
try { db.exec('ALTER TABLE utenti ADD COLUMN tornei_vinti INTEGER DEFAULT 0'); } catch (e) { /* gia' esiste */ }
try { db.exec('ALTER TABLE utenti ADD COLUMN citta TEXT'); } catch (e) { /* gia' esiste */ }

db.exec(`CREATE TABLE IF NOT EXISTS amici (id INTEGER PRIMARY KEY AUTOINCREMENT, utente TEXT NOT NULL, amico TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'pending', creato_il DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(utente, amico))`);

// Tabelle tornei
db.exec(`
  CREATE TABLE IF NOT EXISTS tornei (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    stato TEXT NOT NULL DEFAULT 'iscrizioni',
    num_giocatori INTEGER NOT NULL,
    num_squadre INTEGER NOT NULL,
    round_corrente TEXT DEFAULT NULL,
    modalita_vittoria TEXT NOT NULL DEFAULT 'round',
    valore_vittoria INTEGER NOT NULL DEFAULT 3,
    squadra_vincitrice INTEGER DEFAULT NULL,
    controllo_ip INTEGER DEFAULT 1,
    creato_il DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try { db.exec('ALTER TABLE tornei ADD COLUMN controllo_ip INTEGER DEFAULT 1'); } catch (e) { /* gia' esiste */ }
try { db.exec('ALTER TABLE tornei ADD COLUMN round_corrente TEXT DEFAULT NULL'); } catch (e) { /* gia' esiste */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS tornei_squadre (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id INTEGER NOT NULL REFERENCES tornei(id),
    numero_squadra INTEGER NOT NULL,
    nome_squadra TEXT DEFAULT NULL,
    UNIQUE(torneo_id, numero_squadra)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tornei_giocatori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id INTEGER NOT NULL REFERENCES tornei(id),
    squadra_id INTEGER NOT NULL REFERENCES tornei_squadre(id),
    nome_utente TEXT NOT NULL,
    ip TEXT DEFAULT NULL,
    UNIQUE(torneo_id, nome_utente)
  )
`);

try { db.exec('ALTER TABLE tornei_giocatori ADD COLUMN ip TEXT DEFAULT NULL'); } catch (e) { /* gia' esiste */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS tornei_partite (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id INTEGER NOT NULL REFERENCES tornei(id),
    round TEXT NOT NULL,
    posizione INTEGER NOT NULL,
    squadra_a INTEGER DEFAULT NULL REFERENCES tornei_squadre(id),
    squadra_b INTEGER DEFAULT NULL REFERENCES tornei_squadre(id),
    stato TEXT NOT NULL DEFAULT 'attesa',
    codice_stanza TEXT DEFAULT NULL,
    vincitore INTEGER DEFAULT NULL REFERENCES tornei_squadre(id),
    punti_a INTEGER DEFAULT 0,
    punti_b INTEGER DEFAULT 0,
    UNIQUE(torneo_id, round, posizione)
  )
`);

// Indici per lookup frequenti. Senza, SQLite fa full-scan.
// Le UNIQUE create sopra coprono gia' utenti(nome/email) e amici(utente,amico).
db.exec('CREATE INDEX IF NOT EXISTS idx_amici_utente_stato ON amici(utente, stato)');
db.exec('CREATE INDEX IF NOT EXISTS idx_amici_amico_stato ON amici(amico, stato)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tornei_giocatori_nome ON tornei_giocatori(nome_utente)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tornei_partite_codice ON tornei_partite(codice_stanza)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tornei_partite_stato ON tornei_partite(torneo_id, stato)');
db.exec('CREATE INDEX IF NOT EXISTS idx_utenti_punti ON utenti(punti DESC)');

const stmts = {
  registra: db.prepare('INSERT INTO utenti (nome, email, password_hash, citta) VALUES (?, ?, ?, ?)'),
  trovaPerNome: db.prepare('SELECT * FROM utenti WHERE nome = ?'),
  trovaPerEmail: db.prepare('SELECT * FROM utenti WHERE email = ?'),
  aggiornaStats: db.prepare(`
    UPDATE utenti SET
      partite_giocate = partite_giocate + ?,
      partite_vinte = partite_vinte + ?,
      partite_perse = partite_perse + ?,
      punti = punti + ?
    WHERE nome = ?
  `),
  getStats: db.prepare('SELECT nome, partite_giocate, partite_vinte, partite_perse, punti, tornei_giocati, tornei_vinti FROM utenti WHERE nome = ?'),
  getClassifica: db.prepare('SELECT nome, partite_giocate, partite_vinte, partite_perse, punti, tornei_giocati, tornei_vinti FROM utenti ORDER BY punti DESC LIMIT 20')
};

async function registra(nome, email, password, citta) {
  nome = nome.trim();
  email = email.trim().toLowerCase();
  citta = (citta || '').trim();
  if (!nome || nome.length < 2 || nome.length > 20) return { ok: false, errore: 'Nome deve essere tra 2 e 20 caratteri' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, errore: 'Email non valida' };
  if (password.length < 4) return { ok: false, errore: 'Password deve avere almeno 4 caratteri' };
  if (!citta || citta.length < 2 || citta.length > 50) return { ok: false, errore: 'Città deve essere tra 2 e 50 caratteri' };

  if (stmts.trovaPerNome.get(nome)) return { ok: false, errore: 'Nome già in uso' };
  if (stmts.trovaPerEmail.get(email)) return { ok: false, errore: 'Email già registrata' };

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  stmts.registra.run(nome, email, hash, citta);
  return { ok: true };
}

async function login(identificativo, password) {
  identificativo = (identificativo || '').trim();
  let utente = stmts.trovaPerNome.get(identificativo);
  if (!utente && identificativo.includes('@')) {
    utente = stmts.trovaPerEmail.get(identificativo.toLowerCase());
  }
  if (!utente) return { ok: false, errore: 'Utente non trovato' };
  if (!(await bcrypt.compare(password, utente.password_hash))) return { ok: false, errore: 'Password errata' };
  const token = creaSessione(utente.nome);
  return { ok: true, nome: utente.nome, token, admin: utente.email === ADMIN_EMAIL, passwordTemporanea: !!utente.password_temporanea };
}

// --- Sessioni in-memory ---
const sessioni = new Map(); // token -> { nome, creato, ultimoUso }
const SESSIONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gg

function creaSessione(nome) {
  const token = crypto.randomBytes(24).toString('base64url');
  const ora = Date.now();
  sessioni.set(token, { nome, creato: ora, ultimoUso: ora });
  return token;
}
function validaSessione(token) {
  if (!token) return null;
  const s = sessioni.get(token);
  if (!s) return null;
  if (Date.now() - s.ultimoUso > SESSIONE_TTL_MS) { sessioni.delete(token); return null; }
  s.ultimoUso = Date.now();
  return s.nome;
}
function distruggiSessione(token) { sessioni.delete(token); }
function distruggiSessioniPerNome(nome) {
  for (const [tok, s] of sessioni) if (s.nome === nome) sessioni.delete(tok);
}
setInterval(() => {
  const ora = Date.now();
  for (const [tok, s] of sessioni) if (ora - s.ultimoUso > SESSIONE_TTL_MS) sessioni.delete(tok);
}, 60 * 60 * 1000).unref();

function aggiornaStats(nome, { giocate = 0, vinte = 0, perse = 0, punti = 0 }) {
  stmts.aggiornaStats.run(giocate, vinte, perse, punti, nome);
}

function getStats(nome) {
  return stmts.getStats.get(nome) || null;
}

function getClassifica() {
  return stmts.getClassifica.all();
}

const ADMIN_EMAIL = 'castellana.valerio@gmail.com';

function isAdmin(nome) {
  const u = stmts.trovaPerNome.get(nome);
  return u && u.email === ADMIN_EMAIL;
}

function getTuttiUtenti() {
  return db.prepare('SELECT nome, email, partite_giocate, partite_vinte, partite_perse, punti, creato_il FROM utenti ORDER BY nome').all();
}

async function resetPassword(nome) {
  const utente = stmts.trovaPerNome.get(nome);
  if (!utente) return { ok: false, errore: 'Utente non trovato' };
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let tempPwd = '';
  for (let i = 0; i < 6; i++) tempPwd += chars[Math.floor(Math.random() * chars.length)];
  const hash = await bcrypt.hash(tempPwd, BCRYPT_COST);
  db.prepare('UPDATE utenti SET password_hash = ?, password_temporanea = 1 WHERE nome = ?').run(hash, nome);
  distruggiSessioniPerNome(nome);
  return { ok: true, passwordTemporanea: tempPwd };
}

async function cambiaPassword(nome, nuovaPassword) {
  if (nuovaPassword.length < 4) return { ok: false, errore: 'Password deve avere almeno 4 caratteri' };
  const hash = await bcrypt.hash(nuovaPassword, BCRYPT_COST);
  db.prepare('UPDATE utenti SET password_hash = ?, password_temporanea = 0 WHERE nome = ?').run(hash, nome);
  distruggiSessioniPerNome(nome);
  return { ok: true };
}

function cancellaUtente(nome) {
  const utente = stmts.trovaPerNome.get(nome);
  if (!utente) return { ok: false, errore: 'Utente non trovato' };
  if (utente.email === ADMIN_EMAIL) return { ok: false, errore: 'Non puoi cancellare l\'admin' };
  db.prepare('DELETE FROM utenti WHERE nome = ?').run(nome);
  distruggiSessioniPerNome(nome);
  return { ok: true };
}

// Verifica password senza creare sessione (per conferma operazioni sensibili)
async function verificaPassword(nome, password) {
  const u = stmts.trovaPerNome.get(nome);
  if (!u) return false;
  return bcrypt.compare(password, u.password_hash);
}
function haPasswordTemporanea(nome) {
  const u = stmts.trovaPerNome.get(nome);
  return !!(u && u.password_temporanea);
}

function richiediAmicizia(utente, amico) {
  if (utente === amico) return { ok: false, errore: 'Non puoi aggiungere te stesso' };
  if (!stmts.trovaPerNome.get(amico)) return { ok: false, errore: 'Utente non trovato' };
  if (db.prepare('SELECT 1 FROM amici WHERE utente = ? AND amico = ?').get(utente, amico)) return { ok: false, errore: 'Gia\' inviata o gia\' amici' };
  const altra = db.prepare('SELECT id FROM amici WHERE utente = ? AND amico = ? AND stato = ?').get(amico, utente, 'pending');
  if (altra) { db.prepare('UPDATE amici SET stato = ? WHERE id = ?').run('accepted', altra.id); db.prepare('INSERT INTO amici (utente, amico, stato) VALUES (?, ?, ?)').run(utente, amico, 'accepted'); return { ok: true, accettato: true }; }
  db.prepare('INSERT INTO amici (utente, amico, stato) VALUES (?, ?, ?)').run(utente, amico, 'pending');
  return { ok: true };
}
function accettaAmicizia(utente, amico) { const r = db.prepare('SELECT id FROM amici WHERE utente = ? AND amico = ? AND stato = ?').get(amico, utente, 'pending'); if (!r) return { ok: false, errore: 'Richiesta non trovata' }; db.prepare('UPDATE amici SET stato = ? WHERE id = ?').run('accepted', r.id); db.prepare('INSERT OR IGNORE INTO amici (utente, amico, stato) VALUES (?, ?, ?)').run(utente, amico, 'accepted'); return { ok: true }; }
function rifiutaAmicizia(utente, amico) { db.prepare('DELETE FROM amici WHERE utente = ? AND amico = ?').run(amico, utente); return { ok: true }; }
function rimuoviAmico(utente, amico) { db.prepare('DELETE FROM amici WHERE (utente = ? AND amico = ?) OR (utente = ? AND amico = ?)').run(utente, amico, amico, utente); return { ok: true }; }
function getAmici(utente) { return db.prepare('SELECT amico as nome FROM amici WHERE utente = ? AND stato = ? ORDER BY amico').all(utente, 'accepted'); }
function getRichiesteAmicizia(utente) { return db.prepare('SELECT utente as nome FROM amici WHERE amico = ? AND stato = ? ORDER BY creato_il DESC').all(utente, 'pending'); }

module.exports = { db, registra, login, aggiornaStats, getStats, getClassifica, isAdmin, getTuttiUtenti, resetPassword, cambiaPassword, cancellaUtente, richiediAmicizia, accettaAmicizia, rifiutaAmicizia, rimuoviAmico, getAmici, getRichiesteAmicizia, creaSessione, validaSessione, distruggiSessione, distruggiSessioniPerNome, verificaPassword, haPasswordTemporanea };
