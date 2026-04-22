// Wrapper asincrono per bcryptjs che offloada le operazioni di hash/compare
// a un worker thread, cosi' non blocca l'event loop del main Node.
// Cruciale su hardware a basso throughput (Oracle free 1/8 OCPU): un hash
// con cost 12 puo' costare ~500ms, bloccando tutti gli altri socket.
//
// API:
//   const ba = require('./bcrypt-async');
//   const hash = await ba.hash(password, 12);
//   const ok = await ba.compare(password, hash);
//   // Sync (compat):
//   ba.hashSync(password, 12);
//   ba.compareSync(password, hash);

const { Worker } = require('node:worker_threads');
const path = require('path');
const bcryptjs = require('bcryptjs');

const WORKER_PATH = path.join(__dirname, 'bcrypt-worker.js');

// Pool semplice a singolo worker (sufficiente — bcrypt e' raro)
let _worker = null;
let _nextId = 1;
const _pending = new Map();

function getWorker() {
  if (_worker) return _worker;
  _worker = new Worker(WORKER_PATH);
  _worker.on('message', (msg) => {
    const p = _pending.get(msg.id);
    if (!p) return;
    _pending.delete(msg.id);
    if (msg.err) p.reject(new Error(msg.err));
    else p.resolve(msg.res);
  });
  _worker.on('error', (err) => {
    for (const [, p] of _pending) p.reject(err);
    _pending.clear();
    _worker = null; // ricrea al prossimo uso
  });
  _worker.on('exit', () => { _worker = null; _pending.clear(); });
  return _worker;
}

function call(op, args) {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, op, args });
  });
}

module.exports = {
  hash: (pwd, cost) => call('hash', [pwd, cost]),
  compare: (pwd, hash) => call('compare', [pwd, hash]),
  // Compat sync (usa direttamente bcryptjs, blocca l'event loop — evitare nei path hot)
  hashSync: bcryptjs.hashSync.bind(bcryptjs),
  compareSync: bcryptjs.compareSync.bind(bcryptjs)
};
