// Worker thread per bcryptjs: esegue hash/compare fuori dal main thread.
// Comunica via parentPort con messaggi { id, op, args } -> { id, res, err }.

const { parentPort } = require('node:worker_threads');
const bcrypt = require('bcryptjs');

parentPort.on('message', ({ id, op, args }) => {
  try {
    let res;
    if (op === 'hash') {
      res = bcrypt.hashSync(args[0], args[1]);
    } else if (op === 'compare') {
      res = bcrypt.compareSync(args[0], args[1]);
    } else {
      throw new Error('op sconosciuta: ' + op);
    }
    parentPort.postMessage({ id, res });
  } catch (e) {
    parentPort.postMessage({ id, err: e.message });
  }
});
