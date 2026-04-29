// Scarica i mazzi regionali da Wikimedia Commons e li salva in public/immagini/<mazzo>/
// con la convenzione di naming usata dall'app (NN_NomeValore_di_seme.ext).
//
// Uso: node scripts/scarica-mazzi.js [bergamasche|bresciane|all]
// Default: all
//
// Crediti (vedi anche privacy.html):
//   - bergamasche: Poulpy, CC BY-SA 3.0
//   - bresciane:   ZZandro, CC BY-SA 4.0
//
// Wikimedia Special:FilePath risolve il nome file in un redirect verso upload.wikimedia.org;
// noi seguiamo i redirect manualmente (nessuna libreria esterna).

const https = require('https');
const fs = require('fs');
const path = require('path');

const NOMI_VALORI = { 1: 'Asso', 2: 'Due', 3: 'Tre', 4: 'Quattro', 5: 'Cinque', 6: 'Sei', 7: 'Sette', 8: 'Otto', 9: 'Nove', 10: 'Dieci' };
const OFFSET_SEMI = { denari: 0, coppe: 10, spade: 20, bastoni: 30 };

function nostroFilename(valore, seme, ext) {
  const numero = OFFSET_SEMI[seme] + valore;
  const numeroStr = String(numero).padStart(2, '0');
  // Mantiene la quirk dell'app: solo l'ultima carta (10 di bastoni, numero 40)
  // ha "Bastoni" con la B maiuscola nel filename originale.
  const nomeSeme = (numero === 40) ? 'Bastoni' : seme;
  return `${numeroStr}_${NOMI_VALORI[valore]}_di_${nomeSeme}.${ext}`;
}

function buildBergamasche() {
  const SUIT_MAP = { Coins: 'denari', Cups: 'coppe', Swords: 'spade', Wands: 'bastoni' };
  const RANK_MAP = { 'Ace': 1, '02': 2, '03': 3, '04': 4, '05': 5, '06': 6, '07': 7, 'Jack': 8, 'Knight': 9, 'King': 10 };
  const out = [];
  for (const [suitWiki, suitOurs] of Object.entries(SUIT_MAP)) {
    for (const [rankWiki, valore] of Object.entries(RANK_MAP)) {
      out.push({
        wikiName: `Bergamo Deck - ${suitWiki} - ${rankWiki}.jpg`,
        ourName: nostroFilename(valore, suitOurs, 'jpg')
      });
    }
  }
  return out;
}

function buildBresciane() {
  const SUITS = [['denari', 'Denari'], ['coppe', 'Coppe'], ['bastoni', 'Bastoni'], ['spade', 'Spade']];
  const RANK_MAP = { 'Asso': 1, '02': 2, '03': 3, '04': 4, '05': 5, '06': 6, '07': 7, 'Fante': 8, 'Cavallo': 9, 'Re': 10 };
  const out = [];
  for (const [suitOurs, suitWiki] of SUITS) {
    for (const [rankWiki, valore] of Object.entries(RANK_MAP)) {
      out.push({
        wikiName: `${rankWiki}-${suitWiki}.svg`,
        ourName: nostroFilename(valore, suitOurs, 'svg')
      });
    }
  }
  return out;
}

const MAZZI = {
  bergamasche: { ext: 'jpg', files: buildBergamasche() },
  bresciane:   { ext: 'svg', files: buildBresciane() }
};

function urlFilePath(wikiName) {
  // encodeURIComponent gestisce gli spazi e i caratteri speciali; Wikimedia
  // Special:FilePath accetta sia "%20" che "_" per gli spazi.
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wikiName)}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Wikimedia chiede un User-Agent identificabile con contatto (Wikimedia UA Policy).
const UA = 'scopa-multiplayer/1.0 (https://github.com; contact via repo issues) node-https';

function downloadOnce(url, destPath, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*' } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (redirects <= 0) return reject(new Error('troppi redirect'));
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return downloadOnce(next, destPath, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode === 429) {
        res.resume();
        const err = new Error('HTTP 429 rate limited');
        err.retryable = true;
        return reject(err);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} su ${url}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', (e) => { fs.unlink(destPath, () => reject(e)); });
    });
    req.on('error', reject);
  });
}

// Retry con backoff esponenziale per 429 (parte da 5s).
async function downloadFile(url, destPath) {
  let delay = 5000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await downloadOnce(url, destPath);
    } catch (e) {
      if (!e.retryable || attempt === 4) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
}

async function scaricaMazzo(nome) {
  const cfg = MAZZI[nome];
  if (!cfg) throw new Error(`mazzo sconosciuto: ${nome}`);
  const dir = path.join(__dirname, '..', 'public', 'immagini', nome);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`\n=== ${nome} (${cfg.files.length} file) ===`);
  let ok = 0, gia = 0, errori = 0;
  for (const { wikiName, ourName } of cfg.files) {
    const dest = path.join(dir, ourName);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      gia++;
      continue;
    }
    try {
      await downloadFile(urlFilePath(wikiName), dest);
      ok++;
      process.stdout.write('.');
    } catch (e) {
      errori++;
      console.error(`\n  ERR ${wikiName} -> ${ourName}: ${e.message}`);
    }
    // Throttle: 2s tra richieste (Wikimedia rate limit anonimo e' aggressivo).
    await sleep(2000);
  }
  console.log(`\n  scaricati: ${ok}, gia' presenti: ${gia}, errori: ${errori}`);
  return { ok, gia, errori };
}

async function main() {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const mazzi = arg === 'all' ? Object.keys(MAZZI) : [arg];
  let totErr = 0;
  for (const m of mazzi) {
    const r = await scaricaMazzo(m);
    totErr += r.errori;
  }
  if (totErr > 0) {
    console.error(`\n${totErr} errori. Rilancia per riprovare i file mancanti.`);
    process.exit(1);
  }
  console.log('\nTutti i mazzi scaricati.');
}

main().catch((e) => { console.error(e); process.exit(1); });
