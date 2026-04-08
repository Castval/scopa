// Client Scopa

// Registra service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// === SUONI (WebAudio, no file esterni) ===
let audioCtx = null;
let audioMuted = localStorage.getItem('scopaMuted') === '1';
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  return audioCtx;
}
function playTone(freq, dur = 0.1, type = 'sine', vol = 0.15) {
  if (audioMuted) return;
  const ctx = getAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = vol;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur);
}
const sounds = {
  carta: () => playTone(440, 0.08, 'square', 0.1),
  presa: () => { playTone(660, 0.08, 'sine', 0.12); setTimeout(() => playTone(880, 0.1, 'sine', 0.12), 60); },
  scopa: () => { playTone(523, 0.1, 'triangle', 0.15); setTimeout(() => playTone(659, 0.1, 'triangle', 0.15), 80); setTimeout(() => playTone(784, 0.18, 'triangle', 0.15), 160); },
  turno: () => playTone(800, 0.15, 'sine', 0.13),
  vittoria: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playTone(f, 0.18, 'triangle', 0.15), i * 150)); },
  sconfitta: () => { [400, 350, 300, 250].forEach((f, i) => setTimeout(() => playTone(f, 0.25, 'sawtooth', 0.12), i * 180)); },
  reazione: () => playTone(550, 0.05, 'sine', 0.08)
};
function aggiornaBtnMute() {
  const b = document.getElementById('btnMute');
  if (b) b.textContent = audioMuted ? '🔇' : '🔊';
}
document.addEventListener('click', () => { if (!audioCtx) getAudio(); }, { once: true });

// Setup mute toggle, reazioni, chat in partita (al DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
  aggiornaBtnMute();
  document.getElementById('btnMute')?.addEventListener('click', () => {
    audioMuted = !audioMuted;
    localStorage.setItem('scopaMuted', audioMuted ? '1' : '0');
    aggiornaBtnMute();
    if (!audioMuted) sounds.turno();
  });
  document.querySelectorAll('.reazione-btn').forEach(b => {
    b.addEventListener('click', () => {
      const emoji = b.dataset.emoji;
      socket.emit('reazione', { emoji });
      mostraReazione(emoji);
      sounds.reazione();
    });
  });
  const chatInput = document.getElementById('chatPartitaInput');
  const chatBtn = document.getElementById('btnChatPartitaInvia');
  function inviaChatPartita() {
    const t = chatInput.value.trim();
    if (!t) return;
    socket.emit('chatPartita', { testo: t });
    chatInput.value = '';
  }
  chatBtn?.addEventListener('click', inviaChatPartita);
  chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') inviaChatPartita(); });
});

function mostraReazione(emoji) {
  const ov = document.getElementById('reazioneOverlay');
  const sp = document.getElementById('reazioneEmoji');
  if (!ov || !sp) return;
  sp.textContent = emoji;
  ov.classList.remove('nascosto');
  // forza restart animazione
  sp.style.animation = 'none';
  void sp.offsetWidth;
  sp.style.animation = '';
  setTimeout(() => ov.classList.add('nascosto'), 1700);
}

socket.on('reazione', ({ nome, emoji }) => {
  if (nome === getNomeUtente()) return; // gia' mostrata localmente
  mostraReazione(emoji);
  sounds.reazione();
});

socket.on('chatPartita', ({ nome, testo }) => {
  const cont = document.getElementById('chatPartitaMessaggi');
  if (!cont) return;
  const div = document.createElement('div');
  div.className = 'msg';
  const sNome = document.createElement('span');
  sNome.className = 'nome';
  sNome.textContent = nome + ':';
  const sTesto = document.createElement('span');
  sTesto.textContent = ' ' + testo;
  div.appendChild(sNome);
  div.appendChild(sTesto);
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
  if (nome !== getNomeUtente()) sounds.reazione();
});

const socket = io();

// Blocca uscita accidentale
window.addEventListener('beforeunload', (e) => { if (getSessione()) { e.preventDefault(); e.returnValue = ''; } });
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => { history.pushState(null, '', location.href); });

// Utente loggato
let utenteLoggato = null;
let isAdmin = false;
function getUtenteLoggato() { try { return JSON.parse(localStorage.getItem('utenteLoggato')); } catch { return null; } }
function setUtenteLoggato(nome) { if (nome) { utenteLoggato = nome; localStorage.setItem('utenteLoggato', JSON.stringify(nome)); } else { utenteLoggato = null; localStorage.removeItem('utenteLoggato'); } }
function getNomeUtente() { return utenteLoggato || ''; }

// Mapping per i nomi dei file delle carte
const NOMI_VALORI = {
  1: 'Asso',
  2: 'Due',
  3: 'Tre',
  4: 'Quattro',
  5: 'Cinque',
  6: 'Sei',
  7: 'Sette',
  8: 'Otto',
  9: 'Nove',
  10: 'Dieci'
};

const OFFSET_SEMI = {
  denari: 0,
  coppe: 10,
  spade: 20,
  bastoni: 30
};

// Genera il percorso dell'immagine per una carta
function getImmagineCarta(valore, seme) {
  const numero = OFFSET_SEMI[seme] + valore;
  const numeroStr = numero.toString().padStart(2, '0');
  const nomeValore = NOMI_VALORI[valore];
  // Nota: l'ultimo file ha "Bastoni" con B maiuscola
  const nomeSeme = (numero === 40) ? 'Bastoni' : seme;
  return `immagini/${numeroStr}_${nomeValore}_di_${nomeSeme}.jpg`;
}

// Stato locale
let statoGioco = null;
let cartaSelezionata = null;
// Sessione persistente per riconnessione
function getSessione() {
  try { return JSON.parse(sessionStorage.getItem('sessioneCorrente')); } catch { return null; }
}
function setSessione(s) {
  if (s) sessionStorage.setItem('sessioneCorrente', JSON.stringify(s));
  else sessionStorage.removeItem('sessioneCorrente');
}
let carteSelezionateTavolo = [];
let combinazioniDisponibili = [];
let puoiPosare = false;
let numGiocatoriAttesa = 2;

// Elementi DOM
const schermate = {
  auth: document.getElementById('auth'),
  torneo: document.getElementById('torneoScreen'),
  tabellone: document.getElementById('tabelloneScreen'),
  privacy: document.getElementById('privacyScreen'),
  lobby: document.getElementById('lobby'),
  attesa: document.getElementById('attesa'),
  gioco: document.getElementById('gioco'),
  fineRound: document.getElementById('fineRound')
};

// Mostra schermata
function mostraSchermata(nome) {
  Object.values(schermate).forEach(s => s.classList.remove('attiva'));
  schermate[nome].classList.add('attiva');
}

// Crea elemento carta
function creaCarta(carta, clickable = false, nascosta = false) {
  const div = document.createElement('div');
  div.className = 'carta';

  if (nascosta) {
    div.classList.add('dorso');
    return div;
  }

  div.classList.add(carta.seme);
  div.dataset.id = carta.id;

  // Aggiungi classe speciale per maresciallo e settebello
  if (carta.valore === 10 && carta.seme === 'spade') {
    div.classList.add('maresciallo');
  }
  if (carta.valore === 7 && carta.seme === 'denari') {
    div.classList.add('settebello');
  }

  // Usa immagine della carta
  const imgSrc = getImmagineCarta(carta.valore, carta.seme);
  div.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

  if (clickable) {
    div.addEventListener('click', () => gestisciClickCarta(carta, div));
  }

  return div;
}

// Gestisce click su carta
function gestisciClickCarta(carta, elemento) {
  // Se è una carta in mano
  if (statoGioco.manoGiocatore.some(c => c.id === carta.id)) {
    if (!statoGioco.turnoMio) {
      mostraMessaggio('Non è il tuo turno', 'errore');
      return;
    }

    // Deseleziona carta precedente
    if (cartaSelezionata) {
      document.querySelector(`.mano-carte:not(.dorso) .carta[data-id="${cartaSelezionata.id}"]`)?.classList.remove('selezionata');
    }

    // Seleziona nuova carta
    cartaSelezionata = carta;
    elemento.classList.add('selezionata');
    carteSelezionateTavolo = [];

    // Richiedi combinazioni disponibili
    socket.emit('richiediCombinazioni', carta.id);

    // Rimuovi selezioni dal tavolo
    document.querySelectorAll('#tavolo .carta').forEach(c => {
      c.classList.remove('selezionata', 'selezionabile');
    });

    document.getElementById('azioniMossa').classList.add('nascosto');
  }
  // Se è una carta sul tavolo
  else if (statoGioco.tavolo.some(c => c.id === carta.id)) {
    if (!cartaSelezionata) {
      mostraMessaggio('Prima seleziona una carta dalla tua mano', 'errore');
      return;
    }

    // Toggle selezione
    const idx = carteSelezionateTavolo.findIndex(c => c.id === carta.id);
    if (idx >= 0) {
      carteSelezionateTavolo.splice(idx, 1);
      elemento.classList.remove('selezionata');
    } else {
      carteSelezionateTavolo.push(carta);
      elemento.classList.add('selezionata');
    }

    // Mostra bottoni azione
    aggiornaBottoniAzione();
  }
}

// Aggiorna bottoni azione
function aggiornaBottoniAzione() {
  const azioni = document.getElementById('azioniMossa');
  const btnConferma = document.getElementById('btnConferma');
  const btnPosa = document.getElementById('btnPosa');

  if (carteSelezionateTavolo.length > 0) {
    azioni.classList.remove('nascosto');
    btnConferma.classList.remove('nascosto');
    btnPosa.classList.add('nascosto');
  } else if (puoiPosare && cartaSelezionata) {
    azioni.classList.remove('nascosto');
    btnConferma.classList.add('nascosto');
    btnPosa.classList.remove('nascosto');
  } else {
    if (combinazioniDisponibili.length === 0 && cartaSelezionata) {
      azioni.classList.remove('nascosto');
      btnConferma.classList.add('nascosto');
      btnPosa.classList.remove('nascosto');
    } else {
      azioni.classList.add('nascosto');
    }
  }
}

// Renderizza stato gioco
function renderizzaGioco() {
  if (!statoGioco) return;

  const is4 = statoGioco.numGiocatori === 4;

  // Info giocatori
  if (is4) {
    document.getElementById('nomeGiocatoreDisplay').textContent = statoGioco.nomeSquadra;
    document.getElementById('nomeAvversario').textContent = statoGioco.nomeSquadraAvversaria;
  } else {
    document.getElementById('nomeGiocatoreDisplay').textContent = statoGioco.nomeGiocatore;
    document.getElementById('nomeAvversario').textContent = statoGioco.nomeAvversario || 'Avversario';
  }
  document.getElementById('puntiGiocatore').textContent = statoGioco.puntiGiocatore;
  document.getElementById('puntiAvversario').textContent = statoGioco.puntiAvversario;
  document.getElementById('carteRimanenti').textContent = statoGioco.carteRimanenti;
  document.getElementById('puntiVittoriaDisplay').textContent = statoGioco.puntiVittoria || 31;

  // Turno
  const turnoIndicatore = document.getElementById('turnoIndicatore');
  if (statoGioco.turnoMio) {
    turnoIndicatore.textContent = 'Tocca a te!';
    turnoIndicatore.classList.add('mio-turno');
  } else {
    turnoIndicatore.textContent = `Turno di ${statoGioco.turnoNome}`;
    turnoIndicatore.classList.remove('mio-turno');
  }

  // Area altri giocatori (dinamica)
  renderizzaAltriGiocatori();

  // Tavolo
  const tavolo = document.getElementById('tavolo');
  tavolo.innerHTML = '';
  for (const carta of statoGioco.tavolo) {
    tavolo.appendChild(creaCarta(carta, true));
  }

  // Mano giocatore
  const manoGiocatore = document.getElementById('manoGiocatore');
  manoGiocatore.innerHTML = '';
  for (const carta of statoGioco.manoGiocatore) {
    manoGiocatore.appendChild(creaCarta(carta, true));
  }

  // Mazzo prese con scope
  renderizzaMazzoPrese();

  // Reset selezione
  cartaSelezionata = null;
  carteSelezionateTavolo = [];
  combinazioniDisponibili = [];
  puoiPosare = false;
  document.getElementById('azioniMossa').classList.add('nascosto');
}

// Renderizza area altri giocatori (avversari e compagno)
function renderizzaAltriGiocatori() {
  const container = document.getElementById('areaAvversarioContainer');
  container.innerHTML = '';

  if (!statoGioco) return;

  const altriGiocatori = statoGioco.altriGiocatori || [];

  // Container mani altri giocatori
  const maniDiv = document.createElement('div');
  maniDiv.className = 'altri-giocatori-mani';

  for (const altro of altriGiocatori) {
    const areaDiv = document.createElement('div');
    areaDiv.className = `area-altro-giocatore ${altro.tipo}`;

    const nomeDiv = document.createElement('div');
    nomeDiv.className = 'nome-altro';
    nomeDiv.textContent = altro.nome;
    if (altro.tipo === 'compagno') nomeDiv.classList.add('compagno-label');
    areaDiv.appendChild(nomeDiv);

    const manoDiv = document.createElement('div');
    manoDiv.className = 'mano-carte dorso';
    for (let i = 0; i < altro.carte; i++) {
      const carta = document.createElement('div');
      carta.className = 'carta';
      manoDiv.appendChild(carta);
    }
    areaDiv.appendChild(manoDiv);

    maniDiv.appendChild(areaDiv);
  }

  container.appendChild(maniDiv);

  // Prese avversario
  const preseDiv = document.createElement('div');
  preseDiv.className = 'area-prese avversario';
  const preseTitle = document.createElement('h4');
  preseTitle.textContent = statoGioco.numGiocatori === 4 ? 'Prese avversari' : 'Prese avversario';
  preseDiv.appendChild(preseTitle);
  const mazzoPrese = document.createElement('div');
  mazzoPrese.className = 'mazzo-prese';
  mazzoPrese.id = 'mazzoPreseAvversario';
  preseDiv.appendChild(mazzoPrese);
  container.appendChild(preseDiv);

  // Renderizza prese avversario
  renderizzaMazzoPreseAvversario();
}

// Renderizza il mazzo delle prese con scope di traverso
function renderizzaMazzoPrese() {
  const mazzoPrese = document.getElementById('mazzoPrese');
  mazzoPrese.innerHTML = '';

  if (!statoGioco) return;

  const numPrese = statoGioco.preseGiocatore;
  const scope = statoGioco.scopeGiocatore || [];

  // Se non ci sono prese, non mostrare nulla
  if (numPrese === 0 && scope.length === 0) {
    return;
  }

  // Calcola quante carte "normali" mostrare (max 3)
  const carteNormaliDaMostrare = Math.min(3, Math.max(1, numPrese - scope.length));

  // Renderizza le carte normali (dorso) impilate
  for (let i = 0; i < carteNormaliDaMostrare; i++) {
    const cartaPresa = document.createElement('div');
    cartaPresa.className = 'carta-presa';
    cartaPresa.style.top = (i * 2) + 'px';
    cartaPresa.style.left = (i * 1) + 'px';
    cartaPresa.style.zIndex = i;
    mazzoPrese.appendChild(cartaPresa);
  }

  // Mostra max 3 scope visivamente, le altre sono "nascoste" nel mazzo
  const maxScopeVisibili = 7;
  const scopeDaMostrare = scope.slice(-maxScopeVisibili); // Ultime 3 scope
  const scopeNascoste = scope.length - scopeDaMostrare.length;

  // Renderizza le scope di traverso (compatte)
  scopeDaMostrare.forEach((scopa, idx) => {
    const parti = scopa.carta.split('_');
    const valore = parseInt(parti[0]);
    const seme = parti[1];

    const cartaScopa = document.createElement('div');
    cartaScopa.className = 'carta-scopa';

    // Posiziona le scope più compattamente (15px invece di 30px)
    const baseTop = (carteNormaliDaMostrare * 2) + 5;
    cartaScopa.style.top = (baseTop + idx * 18) + 'px';
    cartaScopa.style.left = '-15px';
    cartaScopa.style.zIndex = 50 + idx;

    const imgSrc = getImmagineCarta(valore, seme);
    cartaScopa.innerHTML = `<img src="${imgSrc}" alt="${valore} di ${seme}">`;

    // Indicatore punti
    const puntiDiv = document.createElement('div');
    puntiDiv.className = 'scopa-punti';

    if (scopa.valore === 10) {
      puntiDiv.textContent = '+10';
      puntiDiv.classList.add('super');
    } else if (scopa.valore < 0) {
      puntiDiv.textContent = scopa.valore;
      puntiDiv.classList.add('negativo');
    } else {
      puntiDiv.textContent = '+' + scopa.valore;
    }

    cartaScopa.appendChild(puntiDiv);
    mazzoPrese.appendChild(cartaScopa);
  });

  // Contatore con info scope
  const contatore = document.createElement('div');
  contatore.className = 'contatore-prese';
  const totaleScope = scope.reduce((sum, s) => sum + s.valore, 0);
  if (scope.length > 0) {
    contatore.innerHTML = `${numPrese} carte<br><strong>${scope.length} scope (${totaleScope >= 0 ? '+' : ''}${totaleScope})</strong>`;
  } else {
    contatore.textContent = `${numPrese} carte`;
  }
  mazzoPrese.appendChild(contatore);
}

// Renderizza il mazzo delle prese dell'avversario
function renderizzaMazzoPreseAvversario() {
  const mazzoPrese = document.getElementById('mazzoPreseAvversario');
  mazzoPrese.innerHTML = '';

  if (!statoGioco) return;

  const numPrese = statoGioco.preseAvversario;
  const scope = statoGioco.scopeAvversario || [];

  // Se non ci sono prese, non mostrare nulla
  if (numPrese === 0 && scope.length === 0) {
    return;
  }

  // Calcola quante carte "normali" mostrare (max 3)
  const carteNormaliDaMostrare = Math.min(3, Math.max(1, numPrese - scope.length));

  // Renderizza le carte normali (dorso) impilate
  for (let i = 0; i < carteNormaliDaMostrare; i++) {
    const cartaPresa = document.createElement('div');
    cartaPresa.className = 'carta-presa';
    cartaPresa.style.top = (i * 2) + 'px';
    cartaPresa.style.left = (i * 1) + 'px';
    cartaPresa.style.zIndex = i;
    mazzoPrese.appendChild(cartaPresa);
  }

  // Mostra max 3 scope visivamente
  const maxScopeVisibili = 7;
  const scopeDaMostrare = scope.slice(-maxScopeVisibili);

  // Renderizza le scope di traverso (compatte)
  scopeDaMostrare.forEach((scopa, idx) => {
    const parti = scopa.carta.split('_');
    const valore = parseInt(parti[0]);
    const seme = parti[1];

    const cartaScopa = document.createElement('div');
    cartaScopa.className = 'carta-scopa';

    const baseTop = (carteNormaliDaMostrare * 2) + 5;
    cartaScopa.style.top = (baseTop + idx * 18) + 'px';
    cartaScopa.style.left = '-15px';
    cartaScopa.style.zIndex = 50 + idx;

    const imgSrc = getImmagineCarta(valore, seme);
    cartaScopa.innerHTML = `<img src="${imgSrc}" alt="${valore} di ${seme}">`;

    // Indicatore punti
    const puntiDiv = document.createElement('div');
    puntiDiv.className = 'scopa-punti';

    if (scopa.valore === 10) {
      puntiDiv.textContent = '+10';
      puntiDiv.classList.add('super');
    } else if (scopa.valore < 0) {
      puntiDiv.textContent = scopa.valore;
      puntiDiv.classList.add('negativo');
    } else {
      puntiDiv.textContent = '+' + scopa.valore;
    }

    cartaScopa.appendChild(puntiDiv);
    mazzoPrese.appendChild(cartaScopa);
  });

  // Contatore con info scope
  const contatore = document.createElement('div');
  contatore.className = 'contatore-prese';
  const totaleScope = scope.reduce((sum, s) => sum + s.valore, 0);
  if (scope.length > 0) {
    contatore.innerHTML = `${numPrese} carte<br><strong>${scope.length} scope (${totaleScope >= 0 ? '+' : ''}${totaleScope})</strong>`;
  } else {
    contatore.textContent = `${numPrese} carte`;
  }
  mazzoPrese.appendChild(contatore);
}

// Mostra messaggio
function mostraMessaggio(testo, tipo = '') {
  const msgLobby = document.getElementById('messaggioLobby');
  const msgGioco = document.getElementById('messaggioGioco');

  const msg = schermate.gioco.classList.contains('attiva') ? msgGioco : msgLobby;

  msg.textContent = testo;
  msg.className = 'messaggio';
  if (tipo) msg.classList.add(tipo);

  setTimeout(() => {
    msg.textContent = '';
    msg.className = 'messaggio';
  }, 3000);
}

// Aggiorna schermata attesa
function aggiornaAttesa(giocatori) {
  const container = document.getElementById('giocatoriConnessi');
  container.innerHTML = '';

  for (const g of giocatori) {
    const div = document.createElement('div');
    div.className = 'giocatore-connesso';
    div.textContent = g.nome;
    container.appendChild(div);
  }

  const mancanti = numGiocatoriAttesa - giocatori.length;
  const msg = document.getElementById('attesaMessaggio');
  if (mancanti > 0) {
    msg.textContent = `In attesa di ${mancanti} giocator${mancanti === 1 ? 'e' : 'i'}...`;
  } else {
    msg.textContent = 'Partita in partenza...';
  }
}

// Toggle regole
document.querySelector('.sezione-regole h3')?.addEventListener('click', () => {
  document.querySelector('.sezione-regole').classList.toggle('chiusa');
});

// Event listeners
document.getElementById('btnCreaStanza').addEventListener('click', () => {
  const nome = getNomeUtente();
  if (!nome) {
    mostraMessaggio('Inserisci il tuo nome', 'errore');
    return;
  }
  const puntiVittoria = parseInt(document.getElementById('puntiVittoria').value);
  const tipoGioco = document.querySelector('input[name="tipoGioco"]:checked').value;
  const due = (tipoGioco === 'scientifico' || tipoGioco === 'classica');
  const numGiocatori = due ? 2 : parseInt(document.querySelector('input[name="numGiocatori"]:checked').value);
  const assoPigliaTutto = due && document.getElementById('optAssoPigliaTutto')?.checked;
  numGiocatoriAttesa = numGiocatori;
  tipoGiocoCorrente = tipoGioco;
  setSessione({ nome, tipoGioco });
  socket.emit('creaStanza', { nome, puntiVittoria, numGiocatori, tipoGioco, assoPigliaTutto });
});

document.getElementById('btnCreaVsBot')?.addEventListener('click', () => {
  const nome = getNomeUtente();
  if (!nome) { mostraMessaggio('Devi essere loggato', 'errore'); return; }
  const tipoGioco = document.querySelector('input[name="tipoGioco"]:checked').value;
  const due = (tipoGioco === 'scientifico' || tipoGioco === 'classica');
  const puntiVittoria = parseInt(document.getElementById('puntiVittoria').value);
  const assoPigliaTutto = due && document.getElementById('optAssoPigliaTutto')?.checked;
  numGiocatoriAttesa = 2;
  tipoGiocoCorrente = tipoGioco;
  setSessione({ nome, tipoGioco });
  socket.emit('creaStanza', { nome, puntiVittoria, numGiocatori: 2, tipoGioco, assoPigliaTutto, vsBot: true });
});

// Stato tipo gioco corrente (impostato dal server in stanzaCreata/unitoAStanza)
let tipoGiocoCorrente = 'maresciallo';

// Selettore tipo gioco: aggiorna opzioni dinamiche
function aggiornaOpzioniLobby() {
  const tipo = document.querySelector('input[name="tipoGioco"]:checked')?.value || 'maresciallo';
  const gruppoNum = document.getElementById('gruppoNumGiocatori');
  const gruppoOpz = document.getElementById('gruppoOpzioniScientifico');
  const sel = document.getElementById('puntiVittoria');
  const regM = document.getElementById('regoleMaresciallo');
  const regC = document.getElementById('regoleClassica');
  const regS = document.getElementById('regoleScientifico');
  const due = (tipo === 'scientifico' || tipo === 'classica');

  if (due) {
    gruppoNum?.classList.add('nascosto');
    gruppoOpz?.classList.remove('nascosto');
    [...sel.options].forEach(o => { o.hidden = !['11','21','31'].includes(o.value); });
    if (['41','51'].includes(sel.value)) sel.value = (tipo === 'classica' ? '11' : '21');
  } else {
    gruppoNum?.classList.remove('nascosto');
    gruppoOpz?.classList.add('nascosto');
    [...sel.options].forEach(o => { o.hidden = false; });
  }

  regM?.classList.toggle('nascosto', tipo !== 'maresciallo');
  regC?.classList.toggle('nascosto', tipo !== 'classica');
  regS?.classList.toggle('nascosto', tipo !== 'scientifico');
}
document.querySelectorAll('input[name="tipoGioco"]').forEach(r => r.addEventListener('change', aggiornaOpzioniLobby));

document.getElementById('btnUnisciti').addEventListener('click', () => {
  const nome = getNomeUtente();
  const codice = document.getElementById('codiceStanza').value.trim().toUpperCase();

  if (!nome) {
    mostraMessaggio('Inserisci il tuo nome', 'errore');
    return;
  }
  if (!codice) {
    mostraMessaggio('Inserisci il codice stanza', 'errore');
    return;
  }

  setSessione({ codice, nome });
  socket.emit('uniscitiStanza', { codice, nome });
});

// Mostra stanze disponibili (modal stile burraco)
function apriModalStanze() {
  document.getElementById('modalStanze').classList.remove('nascosto');
  socket.emit('richiediStanzeDisponibili');
}
function chiudiModalStanze() {
  document.getElementById('modalStanze').classList.add('nascosto');
}
document.getElementById('btnMostraStanze').addEventListener('click', apriModalStanze);
document.getElementById('btnAggiornaStanze').addEventListener('click', () => socket.emit('richiediStanzeDisponibili'));
document.getElementById('btnChiudiStanze').addEventListener('click', chiudiModalStanze);
document.getElementById('modalStanze').addEventListener('click', (e) => {
  if (e.target.id === 'modalStanze') chiudiModalStanze();
});

// Ricevi stanze disponibili
socket.on('stanzeDisponibili', (stanze) => {
  const lista = document.getElementById('listaStanze');
  lista.innerHTML = '';

  if (stanze.length === 0) {
    lista.innerHTML = '<div class="nessuna-stanza">Nessuna stanza disponibile</div>';
    return;
  }

  stanze.forEach(stanza => {
    const tipo = stanza.tipoGioco || 'maresciallo';
    const tipoLabel = tipo === 'scientifico' ? 'Scientifico' : (tipo === 'classica' ? 'Classica' : 'Maresciallo');
    const tipoPartita = stanza.numGiocatori === 4 ? '2v2' : '1v1';
    const row = document.createElement('div');
    row.className = 'stanza-row';
    row.innerHTML = `
      <span class="badge-tipo ${tipo}">${tipoLabel}</span>
      <div class="stanza-info">
        <div class="riga1">${stanza.creatore}</div>
        <div class="riga2"><span class="codice-mono">${stanza.codice}</span> · ${stanza.puntiVittoria}pt · ${tipoPartita}</div>
      </div>
      <span class="stanza-giocatori">${stanza.giocatoriConnessi}/${stanza.numGiocatori}</span>
    `;
    row.addEventListener('click', () => {
      const nome = getNomeUtente();
      if (!nome) { mostraMessaggio('Devi essere loggato', 'errore'); return; }
      tipoGiocoCorrente = tipo;
      setSessione({ nome, codice: stanza.codice, tipoGioco: tipo });
      socket.emit('uniscitiStanza', { codice: stanza.codice, nome });
      chiudiModalStanze();
    });
    lista.appendChild(row);
  });
});

document.getElementById('btnConferma').addEventListener('click', () => {
  if (!cartaSelezionata) return;

  socket.emit('giocaCarta', {
    cartaId: cartaSelezionata.id,
    cartePresaIds: carteSelezionateTavolo.map(c => c.id)
  });
});

document.getElementById('btnAnnulla').addEventListener('click', () => {
  cartaSelezionata = null;
  carteSelezionateTavolo = [];
  document.querySelectorAll('.carta.selezionata').forEach(c => c.classList.remove('selezionata'));
  document.querySelectorAll('.carta.selezionabile').forEach(c => c.classList.remove('selezionabile'));
  document.getElementById('azioniMossa').classList.add('nascosto');
});

document.getElementById('btnPosa').addEventListener('click', () => {
  if (!cartaSelezionata) return;

  socket.emit('giocaCarta', {
    cartaId: cartaSelezionata.id,
    cartePresaIds: []
  });
});

document.getElementById('btnProssimoRound').addEventListener('click', () => {
  socket.emit('nuovoRound');
});

document.getElementById('btnNuovaPartita').addEventListener('click', () => {
  socket.emit('nuovaPartita');
});

document.getElementById('btnTornaLobby').addEventListener('click', () => {
  socket.emit('tornaLobby');
  setSessione(null);
  partitaTorneoCorrente = false;
  statoGioco = null;
  mostraSchermata('lobby');
});

// Socket events
socket.on('stanzaCreata', ({ codice, nome, numGiocatori, tipoGioco }) => {
  const s = getSessione(); if (s) { s.codice = codice; s.tipoGioco = tipoGioco; setSessione(s); }
  tipoGiocoCorrente = tipoGioco || 'maresciallo';
  document.getElementById('codiceStanzaDisplay').textContent = codice;
  numGiocatoriAttesa = numGiocatori || 2;
  aggiornaAttesa([{ nome }]);
  mostraSchermata('attesa');
});

socket.on('unitoAStanza', ({ codice, nome, tipoGioco }) => {
  tipoGiocoCorrente = tipoGioco || 'maresciallo';
  const s = getSessione(); if (s) { s.tipoGioco = tipoGiocoCorrente; setSessione(s); }
  document.getElementById('codiceStanzaDisplay').textContent = codice;
  mostraSchermata('attesa');
});

socket.on('errore', (messaggio) => {
  mostraMessaggio(messaggio, 'errore');
  if (typeof messaggio === 'string' && /stanza non trovata/i.test(messaggio)) {
    setSessione(null);
    if (getUtenteLoggato()) entraInLobby();
  }
});

socket.on('giocatoreUnito', ({ giocatori, maxGiocatori }) => {
  if (maxGiocatori) numGiocatoriAttesa = maxGiocatori;
  aggiornaAttesa(giocatori);
});

socket.on('partitaIniziata', (stato) => {
  statoGioco = stato;
  mostraSchermata('gioco');
  renderizzaGioco();
  const cont = document.getElementById('chatPartitaMessaggi');
  if (cont) cont.innerHTML = '';
});

// Timer turno (180s, gestito dal server)
let turnoTimerInterval = null;
let turnoTimerScadenza = 0;
function fermaTurnoTimer() {
  if (turnoTimerInterval) { clearInterval(turnoTimerInterval); turnoTimerInterval = null; }
  const el = document.getElementById('turnoTimer');
  if (el) el.classList.add('nascosto');
}
function aggiornaTurnoTimer() {
  const el = document.getElementById('turnoTimer');
  const sec = document.getElementById('turnoTimerSec');
  if (!el || !sec) return;
  const rim = Math.max(0, Math.ceil((turnoTimerScadenza - Date.now()) / 1000));
  sec.textContent = rim;
  el.classList.toggle('warning', rim <= 30 && rim > 10);
  el.classList.toggle('danger', rim <= 10);
  if (rim <= 0) fermaTurnoTimer();
}
socket.on('turnoTimer', ({ giocatoreId, scadenza }) => {
  turnoTimerScadenza = scadenza;
  const el = document.getElementById('turnoTimer');
  if (el) el.classList.remove('nascosto');
  aggiornaTurnoTimer();
  if (turnoTimerInterval) clearInterval(turnoTimerInterval);
  turnoTimerInterval = setInterval(aggiornaTurnoTimer, 500);
});

socket.on('statoAggiornato', (dati) => {
  const { cartaGiocata, giocatoreId, ...stato } = dati;
  const eraTurnoMio = statoGioco?.turnoMio;
  const presaPrese = stato.preseGiocatore + stato.preseAvversario > (statoGioco?.preseGiocatore || 0) + (statoGioco?.preseAvversario || 0);
  const onUpdate = () => {
    statoGioco = stato; renderizzaGioco();
    if (cartaGiocata) {
      if (presaPrese) sounds.presa(); else sounds.carta();
    }
    if (stato.turnoMio && !eraTurnoMio) {
      sounds.turno();
      if (document.hidden && Notification.permission === 'granted') {
        try { const n = new Notification('Scopa', { body: 'È il tuo turno!', tag: 'scopa-turno', renotify: true }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) {}
      }
    }
  };
  if (cartaGiocata && giocatoreId !== socket.id) mostraCartaAvversario(cartaGiocata, onUpdate);
  else onUpdate();
});

// Mostra la carta giocata dall'avversario
function mostraCartaAvversario(carta, callback) {
  const tavoloContainer = document.querySelector('.tavolo-container');

  // Crea elemento carta temporaneo
  const cartaDiv = document.createElement('div');
  cartaDiv.className = 'carta carta-avversario-giocata';
  if (carta.valore === 10 && carta.seme === 'spade') {
    cartaDiv.classList.add('maresciallo');
  }
  if (carta.valore === 7 && carta.seme === 'denari') {
    cartaDiv.classList.add('settebello');
  }

  const imgSrc = getImmagineCarta(carta.valore, carta.seme);
  cartaDiv.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

  // Inserisci nel container del tavolo (sopra il tavolo)
  tavoloContainer.appendChild(cartaDiv);

  // Dopo 1 secondo, rimuovi e aggiorna
  setTimeout(() => {
    cartaDiv.remove();
    callback();
  }, 1000);
}

socket.on('combinazioniDisponibili', ({ cartaId, combinazioni, puoiPosare: posare }) => {
  combinazioniDisponibili = combinazioni;
  puoiPosare = posare;

  // Se è un asso e c'è almeno una carta a terra, prende tutto automaticamente
  // (Maresciallo sempre; Scientifico/Classica solo con assoPigliaTutto attivo)
  const assoSpeciale = tipoGiocoCorrente === 'maresciallo'
    || ((tipoGiocoCorrente === 'scientifico' || tipoGiocoCorrente === 'classica') && statoGioco.assoPigliaTutto);
  if (assoSpeciale && cartaSelezionata && cartaSelezionata.valore === 1 && statoGioco.tavolo.length > 0) {
    // Caso speciale Classica: se c'e' un asso a terra, prende solo l'asso
    let cartePresaIds;
    if (tipoGiocoCorrente === 'classica') {
      const assoTerra = statoGioco.tavolo.find(c => c.valore === 1);
      cartePresaIds = assoTerra ? [assoTerra.id] : statoGioco.tavolo.map(c => c.id);
    } else {
      cartePresaIds = statoGioco.tavolo.map(c => c.id);
    }
    socket.emit('giocaCarta', { cartaId: cartaSelezionata.id, cartePresaIds });
    return;
  }

  // Se non ci sono combinazioni possibili, posa automaticamente
  if (cartaSelezionata && combinazioni.length === 0) {
    socket.emit('giocaCarta', {
      cartaId: cartaSelezionata.id,
      cartePresaIds: []
    });
    return;
  }

  // Se c'è solo una combinazione possibile, prendi automaticamente
  if (cartaSelezionata && combinazioni.length === 1) {
    socket.emit('giocaCarta', {
      cartaId: cartaSelezionata.id,
      cartePresaIds: combinazioni[0]
    });
    return;
  }

  mostraMessaggio('Clicca la carta sul tavolo da prendere e premi conferma', 'info');

  // Evidenzia carte selezionabili
  document.querySelectorAll('#tavolo .carta').forEach(el => {
    el.classList.remove('selezionabile');
    const id = el.dataset.id;
    if (combinazioni.some(comb => comb.includes(id))) {
      el.classList.add('selezionabile');
    }
  });

  aggiornaBottoniAzione();
});

socket.on('mossaNonValida', (errore) => {
  mostraMessaggio(errore, 'errore');
});

socket.on('fineRound', ({ stato, puntiRound, dettagliGiocatore, dettagliAvversario, finePartita, vincitore, pareggio }) => {
  statoGioco = stato;
  fermaTurnoTimer();
  if (finePartita) {
    const haVinto = vincitore && vincitore.includes(stato.nomeGiocatore);
    if (haVinto) sounds.vittoria(); else sounds.sconfitta();
  } else {
    sounds.scopa();
  }

  const titoloEl = document.getElementById('titoloFineRound');
  const btnProssimo = document.getElementById('btnProssimoRound');
  const btnNuova = document.getElementById('btnNuovaPartita');

  const btnLobby = document.getElementById('btnTornaLobby');
  if (finePartita) {
    const haVinto = vincitore && vincitore.includes(statoGioco.nomeGiocatore);
    if (statoGioco.numGiocatori === 4) {
      titoloEl.textContent = haVinto ? 'La tua squadra ha vinto!' : `${vincitore} hanno vinto!`;
    } else {
      titoloEl.textContent = haVinto ? 'Hai vinto!' : `${vincitore} ha vinto!`;
    }
    btnProssimo.classList.add('nascosto');
    btnNuova.classList.remove('nascosto');
    btnLobby.classList.remove('nascosto');
  } else if (pareggio) {
    titoloEl.textContent = 'Pareggio! Si continua...';
    btnProssimo.classList.remove('nascosto');
    btnNuova.classList.add('nascosto');
    btnLobby.classList.add('nascosto');
  } else {
    titoloEl.textContent = 'Fine Smazzata';
    btnProssimo.classList.remove('nascosto');
    btnNuova.classList.add('nascosto');
    btnLobby.classList.add('nascosto');
  }

  // Mostra nomi (squadra in 4 giocatori)
  const is4p = statoGioco.numGiocatori === 4;
  document.getElementById('nomeG1').textContent = is4p ? statoGioco.nomeSquadra : statoGioco.nomeGiocatore;
  document.getElementById('nomeG2').textContent = is4p ? statoGioco.nomeSquadraAvversaria : statoGioco.nomeAvversario;

  // Dettagli giocatore (G1)
  document.getElementById('scopeG1').textContent = dettagliGiocatore.scope;
  document.getElementById('denariG1').textContent = dettagliGiocatore.denari;
  document.getElementById('carteG1').textContent = dettagliGiocatore.carte;
  document.getElementById('primieraG1').textContent = dettagliGiocatore.primiera;
  document.getElementById('settebelloG1').textContent = dettagliGiocatore.settebello;
  document.getElementById('ottoG1').textContent = dettagliGiocatore.ottoDenari;
  document.getElementById('napolaG1').textContent = dettagliGiocatore.napola;
  document.getElementById('marescialliG1').textContent = dettagliGiocatore.marescialli;
  document.getElementById('puntiRoundG1').textContent = dettagliGiocatore.totale;
  document.getElementById('puntiTotaliG1').textContent = statoGioco.puntiGiocatore;

  // Mini carte G1 (solo scope e primiera)
  renderizzaMiniCarte('carteScopeG1', dettagliGiocatore.carteScope, true);
  renderizzaMiniCarte('cartePrimieraG1', dettagliGiocatore.cartePrimiera);

  // Dettagli avversario (G2)
  document.getElementById('scopeG2').textContent = dettagliAvversario.scope;
  document.getElementById('denariG2').textContent = dettagliAvversario.denari;
  document.getElementById('carteG2').textContent = dettagliAvversario.carte;
  document.getElementById('primieraG2').textContent = dettagliAvversario.primiera;
  document.getElementById('settebelloG2').textContent = dettagliAvversario.settebello;
  document.getElementById('ottoG2').textContent = dettagliAvversario.ottoDenari;
  document.getElementById('napolaG2').textContent = dettagliAvversario.napola;
  document.getElementById('marescialliG2').textContent = dettagliAvversario.marescialli;
  document.getElementById('puntiRoundG2').textContent = dettagliAvversario.totale;
  document.getElementById('puntiTotaliG2').textContent = statoGioco.puntiAvversario;

  // Mini carte G2 (solo scope e primiera)
  renderizzaMiniCarte('carteScopeG2', dettagliAvversario.carteScope, true);
  renderizzaMiniCarte('cartePrimieraG2', dettagliAvversario.cartePrimiera);

  mostraSchermata('fineRound');
});

// Renderizza mini carte nel riepilogo
function renderizzaMiniCarte(elementId, carte, mostraPunti = false) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';

  if (!carte || carte.length === 0) return;

  for (const carta of carte) {
    const div = document.createElement('div');
    div.className = 'mini-carta';
    if (mostraPunti && carta.punti) {
      div.classList.add('con-punti');
    }

    const imgSrc = getImmagineCarta(carta.valore, carta.seme);
    div.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

    if (mostraPunti && carta.punti) {
      const badge = document.createElement('span');
      badge.className = 'punti-badge';
      badge.textContent = '+' + carta.punti;
      div.appendChild(badge);
    }

    container.appendChild(div);
  }
}

const giocatoriDisconnessi = new Set();
function aggiornaMsgDisconnessi() {
  const msg = document.getElementById('messaggioGioco');
  if (giocatoriDisconnessi.size === 0) { msg.textContent = ''; msg.className = 'messaggio'; return; }
  msg.textContent = `${[...giocatoriDisconnessi].join(', ')} disconness${giocatoriDisconnessi.size > 1 ? 'i' : 'o'}, attendo riconnessione...`;
  msg.className = 'messaggio info';
}
socket.on('avversarioDisconnesso', ({ nome }) => { giocatoriDisconnessi.add(nome); aggiornaMsgDisconnessi(); });
socket.on('giocatoreRiconnesso', ({ nome }) => {
  giocatoriDisconnessi.delete(nome);
  if (giocatoriDisconnessi.size === 0) {
    const msg = document.getElementById('messaggioGioco');
    msg.textContent = `${nome} si e' riconnesso!`; msg.className = 'messaggio successo';
    setTimeout(() => { msg.textContent = ''; msg.className = 'messaggio'; }, 3000);
  } else aggiornaMsgDisconnessi();
});
socket.on('avversarioAbbandonato', ({ nome, motivo }) => {
  fermaTurnoTimer();
  const msg = motivo === 'timeout'
    ? `${nome} ha sforato i 180 secondi e ha perso la partita`
    : `${nome} ha abbandonato la partita`;
  mostraMessaggio(msg, 'errore');
  setSessione(null);
  partitaTorneoCorrente = false;
  setTimeout(() => mostraSchermata('lobby'), 3000);
});

// Esporta per accesso esterno
Object.defineProperty(window, 'statoGioco', { get() { return statoGioco; } });
Object.defineProperty(window, 'socket', { get() { return socket; } });

// --- NOTIFICHE ---
function aggiornaIconaNotifiche() { const btn=document.getElementById('btnNotifiche'); if(!btn) return; if(!('Notification' in window)){btn.style.display='none';return;} if(Notification.permission==='granted'){btn.textContent='🔔';btn.classList.add('attive');} else if(Notification.permission==='denied'){btn.textContent='🔕';btn.classList.remove('attive');} else {btn.textContent='🔔';btn.classList.remove('attive');} }
document.getElementById('btnNotifiche')?.addEventListener('click', async () => { if(!('Notification' in window)) return; if(Notification.permission==='default'){await Notification.requestPermission();aggiornaIconaNotifiche();} else if(Notification.permission==='denied'){alert('Notifiche bloccate');} else new Notification('Scopa Maresciallo',{body:'Notifiche attive!'}); });

// --- CHAT LOBBY ---
function aggiungiMessaggioChatLobby(msg) {
  const cont = document.getElementById('chatLobbyMessaggi'); if (!cont) return;
  const div = document.createElement('div'); div.className = 'chat-lobby-msg';
  const ora = new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const isSelf = msg.nome === getNomeUtente();
  div.innerHTML = `<span class="chat-lobby-ora">${ora}</span> <span class="chat-lobby-nome${isSelf ? ' self' : ''}">${msg.nome}:</span> <span class="chat-lobby-testo">${msg.testo.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</span>`;
  cont.appendChild(div); cont.scrollTop = cont.scrollHeight;
}
function inviaMessaggioChatLobby() { const inp=document.getElementById('chatLobbyInput'); const t=inp.value.trim(); if(!t) return; socket.emit('chatLobbyMessaggio',{testo:t}); inp.value=''; }
document.getElementById('btnChatLobbyInvia')?.addEventListener('click', inviaMessaggioChatLobby);
document.getElementById('chatLobbyInput')?.addEventListener('keydown', (e) => { if(e.key==='Enter') inviaMessaggioChatLobby(); });
document.getElementById('toggleChatLobby')?.addEventListener('click', () => { const sez=document.querySelector('.sezione-chat-lobby'); sez.classList.toggle('chiusa'); if(!sez.classList.contains('chiusa')) socket.emit('chatLobbyStoria'); });
socket.on('chatLobbyMessaggio', (msg) => aggiungiMessaggioChatLobby(msg));
socket.on('chatLobbyStoria', (msgs) => { const cont=document.getElementById('chatLobbyMessaggi'); if(!cont) return; cont.innerHTML=''; msgs.forEach(aggiungiMessaggioChatLobby); });

// --- AMICI ---
let caricaAmiciTimer = null;
function caricaAmiciDebounced() { if (caricaAmiciTimer) clearTimeout(caricaAmiciTimer); caricaAmiciTimer = setTimeout(() => { caricaAmici(); caricaAmiciTimer = null; }, 300); }
async function caricaAmici() {
  const nome = getNomeUtente(); if (!nome) return;
  try {
    const d = await (await fetch(`/api/amici/${encodeURIComponent(nome)}`)).json(); if (!d.ok) return;
    const dOnline = await (await fetch(`/api/amici/${encodeURIComponent(nome)}/online`)).json();
    const online = dOnline.ok ? dOnline.online : {};
    document.getElementById('amiciCount').textContent = `(${d.amici.length})`;
    const elRich = document.getElementById('amiciRichieste');
    elRich.innerHTML = d.richieste.length > 0 ? '<h4 class="amici-titolo">Richieste</h4>' + d.richieste.map(r => `<div class="amico-row pending"><span class="amico-nome">${r.nome}</span><button class="btn-amico-accetta" data-nome="${r.nome}">Accetta</button><button class="btn-amico-rifiuta" data-nome="${r.nome}">Rifiuta</button></div>`).join('') : '';
    const elLista = document.getElementById('amiciLista');
    elLista.innerHTML = d.amici.length === 0 ? '<p class="amici-vuoto">Non hai ancora amici</p>' : d.amici.map(a => { const s=online[a.nome]||{online:false}; const dot=s.online?'<span class="amico-online"></span>':'<span class="amico-offline"></span>'; const stz=s.stanza?` <span class="amico-stanza">in ${s.stanza}</span>`:''; const inv=s.online&&getSessione()?.codice?`<button class="btn-amico-invita" data-nome="${a.nome}">Invita</button>`:''; return `<div class="amico-row">${dot}<span class="amico-nome">${a.nome}</span>${stz}${inv}<button class="btn-amico-rimuovi" data-nome="${a.nome}">×</button></div>`; }).join('');
    elRich.querySelectorAll('.btn-amico-accetta').forEach(b => b.addEventListener('click', async (e) => { await fetch('/api/amici/accetta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utente:nome,amico:e.target.dataset.nome})}); caricaAmici(); }));
    elRich.querySelectorAll('.btn-amico-rifiuta').forEach(b => b.addEventListener('click', async (e) => { await fetch('/api/amici/rifiuta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utente:nome,amico:e.target.dataset.nome})}); caricaAmici(); }));
    elLista.querySelectorAll('.btn-amico-rimuovi').forEach(b => b.addEventListener('click', async (e) => { if(!confirm(`Rimuovere ${e.target.dataset.nome}?`)) return; await fetch('/api/amici/rimuovi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utente:nome,amico:e.target.dataset.nome})}); caricaAmici(); }));
    elLista.querySelectorAll('.btn-amico-invita').forEach(b => b.addEventListener('click', (e) => { const c=getSessione()?.codice; if(!c){alert('Devi essere in una stanza');return;} socket.emit('invitaAmico',{amico:e.target.dataset.nome,codiceStanza:c}); mostraMessaggio(`Invito inviato a ${e.target.dataset.nome}`,'successo'); }));
  } catch (e) {}
}
document.getElementById('btnAggiungiAmico')?.addEventListener('click', async () => { const inp=document.getElementById('amiciNomeInput'); const a=inp.value.trim(); if(!a) return; const r=await(await fetch('/api/amici/richiedi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utente:getNomeUtente(),amico:a})})).json(); if(!r.ok){mostraMessaggio(r.errore,'errore');return;} inp.value=''; mostraMessaggio(r.accettato?'Ora siete amici!':'Richiesta inviata','successo'); caricaAmici(); });
document.getElementById('toggleAmici')?.addEventListener('click', () => document.querySelector('.sezione-amici').classList.toggle('chiusa'));
socket.on('richiestaAmicizia', ({ da }) => { mostraMessaggio(`${da} ti ha inviato una richiesta`,'info'); if(Notification.permission==='granted'&&document.hidden) try{new Notification('Scopa Maresciallo',{body:`${da} ti ha inviato una richiesta`});}catch(e){} caricaAmiciDebounced(); });
socket.on('amiciziaAccettata', ({ da }) => { mostraMessaggio(`${da} ha accettato!`,'successo'); caricaAmiciDebounced(); });
socket.on('invitoStanza', ({ da, codiceStanza }) => { if(confirm(`${da} ti invita nella stanza ${codiceStanza}. Unirsi?`)){document.getElementById('codiceStanza').value=codiceStanza; document.getElementById('btnUnisciti').click();} });

// --- AUTH ---
function mostraMessaggioAuth(testo, tipo = 'errore') {
  const el = document.getElementById('messaggioAuth');
  el.textContent = testo; el.className = 'messaggio ' + tipo; el.style.display = 'inline-block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
let privacyReturnScreen = 'auth';
function mostraPrivacy(ret) { privacyReturnScreen = ret || 'auth'; mostraSchermata('privacy'); }
document.getElementById('btnPrivacyIndietro').addEventListener('click', () => mostraSchermata(privacyReturnScreen));
document.getElementById('linkPrivacyAuth')?.addEventListener('click', (e) => { e.preventDefault(); mostraPrivacy('auth'); });
document.getElementById('linkPrivacyReg')?.addEventListener('click', (e) => { e.preventDefault(); mostraPrivacy('auth'); });
document.getElementById('linkPrivacyBanner')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('storageBanner').classList.add('nascosto'); mostraPrivacy(privacyReturnScreen); });
if (!localStorage.getItem('storageAccettato')) document.getElementById('storageBanner').classList.remove('nascosto');
document.getElementById('btnAccettaStorage').addEventListener('click', () => { localStorage.setItem('storageAccettato', '1'); document.getElementById('storageBanner').classList.add('nascosto'); });
document.getElementById('mostraRegistra').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('authLogin').classList.add('nascosto'); document.getElementById('authRegistra').classList.remove('nascosto'); });
document.getElementById('mostraLogin').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('authRegistra').classList.add('nascosto'); document.getElementById('authLogin').classList.remove('nascosto'); });
function mostraCambioPassword() { document.getElementById('authLogin').classList.add('nascosto'); document.getElementById('authRegistra').classList.add('nascosto'); document.getElementById('authCambioPwd').classList.remove('nascosto'); }
document.getElementById('btnCambiaPwd').addEventListener('click', async () => {
  const n = document.getElementById('nuovaPassword').value, c = document.getElementById('confermaNuovaPassword').value;
  if (!n || !c) { mostraMessaggioAuth('Compila tutti i campi'); return; }
  if (n !== c) { mostraMessaggioAuth('Le password non coincidono'); return; }
  const r = await (await fetch('/api/cambiapassword', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: getNomeUtente(), nuovaPassword: n }) })).json();
  if (!r.ok) { mostraMessaggioAuth(r.errore); return; }
  document.getElementById('authCambioPwd').classList.add('nascosto'); entraInLobby();
});
document.getElementById('confermaNuovaPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btnCambiaPwd').click(); });
document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btnLogin').click(); });
document.getElementById('btnLogin').addEventListener('click', async () => {
  const nome = document.getElementById('loginNome').value.trim(), pwd = document.getElementById('loginPassword').value;
  if (!nome || !pwd) { mostraMessaggioAuth('Compila tutti i campi'); return; }
  const d = await (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, password: pwd }) })).json();
  if (!d.ok) { mostraMessaggioAuth(d.errore); return; }
  isAdmin = d.admin || false; setUtenteLoggato(d.nome);
  if (d.passwordTemporanea) mostraCambioPassword(); else entraInLobby();
});
document.getElementById('btnRegistra').addEventListener('click', async () => {
  const nome = document.getElementById('regNome').value.trim(), email = document.getElementById('regEmail').value.trim(), pwd = document.getElementById('regPassword').value, citta = document.getElementById('regCitta').value.trim();
  if (!nome || !email || !pwd || !citta) { mostraMessaggioAuth('Compila tutti i campi'); return; }
  if (!document.getElementById('regConsensoPrv').checked) { mostraMessaggioAuth("Devi accettare l'informativa sulla privacy"); return; }
  const d = await (await fetch('/api/registra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, password: pwd, citta }) })).json();
  if (!d.ok) { mostraMessaggioAuth(d.errore); return; }
  mostraMessaggioAuth('Registrazione completata!', 'successo');
  document.getElementById('authRegistra').classList.add('nascosto'); document.getElementById('authLogin').classList.remove('nascosto');
  document.getElementById('loginNome').value = nome;
});
document.getElementById('btnEliminaAccount').addEventListener('click', async () => {
  if (!confirm('Eliminare il tuo account? Tutti i dati verranno cancellati.')) return;
  if (!confirm('Confermi? Azione irreversibile.')) return;
  const d = await (await fetch('/api/eliminaaccount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: getNomeUtente() }) })).json();
  if (d.ok) { setUtenteLoggato(null); setSessione(null); mostraSchermata('auth'); mostraMessaggioAuth('Account eliminato', 'successo'); }
});
document.getElementById('btnLogout').addEventListener('click', () => { setUtenteLoggato(null); setSessione(null); mostraSchermata('auth'); });

async function entraInLobby() {
  document.getElementById('userNome').textContent = getNomeUtente();
  socket.emit('autenticato', { nome: getNomeUtente() });
  try { const d = await (await fetch(`/api/stats/${encodeURIComponent(getNomeUtente())}`)).json(); if (d.ok) { const s = d.stats; const t = s.tornei_giocati > 0 ? ` | Tornei: ${s.tornei_vinti}/${s.tornei_giocati}` : ''; document.getElementById('userStats').innerHTML = `${s.partite_giocate} partite | ${s.partite_vinte}V ${s.partite_perse}P | ${s.punti} pt${t}`; } } catch {}
  if (isAdmin) document.getElementById('btnAdmin').classList.remove('nascosto'); else { document.getElementById('btnAdmin').classList.add('nascosto'); document.getElementById('pannelloAdmin').classList.add('nascosto'); }
  caricaClassifica(); aggiornaIconaNotifiche(); caricaAmici(); mostraSchermata('lobby');
}
async function caricaClassifica() {
  try { const d = await (await fetch('/api/classifica')).json(); const body = document.getElementById('classificaBody'); body.innerHTML = '';
    if (!d.ok || d.classifica.length === 0) { body.innerHTML = '<tr><td colspan="6">Nessun giocatore</td></tr>'; return; }
    d.classifica.forEach((g, i) => { const tr = document.createElement('tr'); if (g.nome === getNomeUtente()) tr.className = 'utente-corrente';
      const t = g.tornei_vinti > 0 ? `${g.tornei_vinti}/${g.tornei_giocati}` : '-';
      tr.innerHTML = `<td>${i+1}</td><td class="nome-col">${g.nome}</td><td>${g.partite_vinte}</td><td>${g.partite_perse}</td><td><strong>${g.punti}</strong></td><td>${t}</td>`; body.appendChild(tr); });
  } catch {}
}
document.getElementById('toggleClassifica')?.addEventListener('click', () => document.querySelector('.sezione-classifica').classList.toggle('chiusa'));

// --- ADMIN ---
document.getElementById('btnAdmin').addEventListener('click', () => { const p = document.getElementById('pannelloAdmin'); if (p.classList.contains('nascosto')) { p.classList.remove('nascosto'); caricaDatiAdmin(); } else p.classList.add('nascosto'); });
document.getElementById('btnRefreshAdmin').addEventListener('click', caricaDatiAdmin);
async function caricaDatiAdmin() {
  try { const d = await (await fetch(`/api/admin/online?nome=${encodeURIComponent(getNomeUtente())}`)).json(); if (!d.ok) return;
    document.getElementById('adminOnlineCount').textContent = d.utentiOnline.length;
    document.getElementById('adminUtentiOnline').innerHTML = d.utentiOnline.length === 0 ? '<div class="admin-lista-vuota">Nessuno</div>' : d.utentiOnline.map(u => `<div class="admin-utente"><span class="nome">${u.nome}</span><span class="admin-ip">${u.ip||'?'}</span><span class="stato ${u.stanza?'in-stanza':''}">${u.stanza?'Stanza '+u.stanza:'Lobby'}</span></div>`).join('');
    document.getElementById('adminStanzeCount').textContent = d.stanze.length;
    document.getElementById('adminStanze').innerHTML = d.stanze.length === 0 ? '<div class="admin-lista-vuota">Nessuna</div>' : d.stanze.map(s => `<div class="admin-stanza"><span>${s.codice}</span> <span>${s.stato}</span> <span>${s.giocatori.map(g=>g.nome).join(', ')}</span></div>`).join('');
  } catch {}
  try { const d = await (await fetch(`/api/admin/utenti?nome=${encodeURIComponent(getNomeUtente())}`)).json(); if (!d.ok) return;
    const el = document.getElementById('adminUtentiRegistrati'); document.getElementById('adminUtentiCount').textContent = d.utenti.length;
    el.innerHTML = d.utenti.map(u => `<div class="admin-utente"><span class="nome">${u.nome}</span><span class="admin-email">${u.email}</span><button class="btn-reset-pwd" data-nome="${u.nome}">Reset pwd</button><button class="btn-cancella-utente" data-nome="${u.nome}">Cancella</button></div>`).join('');
    el.querySelectorAll('.btn-reset-pwd').forEach(b => b.addEventListener('click', async (e) => { const n = e.target.dataset.nome; if (!confirm(`Reset password di ${n}?`)) return; const r = await (await fetch('/api/admin/resetpassword', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: getNomeUtente(), nome: n }) })).json(); if (r.ok) alert(`Password: ${r.passwordTemporanea}`); }));
    el.querySelectorAll('.btn-cancella-utente').forEach(b => b.addEventListener('click', async (e) => { const n = e.target.dataset.nome; if (!confirm(`Cancellare ${n}?`)) return; const r = await (await fetch('/api/admin/cancellautente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: getNomeUtente(), nome: n }) })).json(); if (r.ok) caricaDatiAdmin(); else alert(r.errore); }));
  } catch {}
  try { const d = await (await fetch('/api/torneo/attivo')).json(); const el = document.getElementById('adminTorneoAttivo');
    if (d.ok && d.torneo) el.innerHTML = `<div class="admin-torneo-info">Attivo: <strong>${d.torneo.nome}</strong> (${d.torneo.stato})</div><button class="btn-reset-pwd" onclick="annullaTorneoFn(${d.torneo.id})">Annulla</button>`;
    else el.innerHTML = '<div class="admin-torneo-info">Nessun torneo</div>';
  } catch {}
  caricaMetricheAdmin();
}

function fmtUptime(sec) {
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if (d) return `${d}g ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
async function caricaMetricheAdmin() {
  const el = document.getElementById('adminMetriche');
  if (!el) return;
  try {
    const d = await (await fetch(`/api/admin/metriche?nome=${encodeURIComponent(getNomeUtente())}`)).json();
    if (!d.ok) { el.textContent = 'Errore'; return; }
    const m = d.metriche;
    const memCls = m.memoria.rss_mb > 350 ? 'danger' : (m.memoria.rss_mb > 250 ? 'warning' : '');
    const loadCls = parseFloat(m.sistema.loadavg_1m) > m.sistema.cpu_count ? 'danger' : (parseFloat(m.sistema.loadavg_1m) > m.sistema.cpu_count*0.7 ? 'warning' : '');
    el.innerHTML = `
      <div class="metrica-sez">Server</div>
      <span class="metrica-label">Uptime processo</span><span class="metrica-val">${fmtUptime(m.uptimeProcesso)}</span>
      <span class="metrica-label">Node</span><span class="metrica-val">${m.node}</span>
      <span class="metrica-label">PID</span><span class="metrica-val">${m.pid}</span>
      <div class="metrica-sez">Gioco</div>
      <span class="metrica-label">Utenti online</span><span class="metrica-val">${m.utentiOnline}</span>
      <span class="metrica-label">Stanze totali</span><span class="metrica-val">${m.stanzeTotali}</span>
      <span class="metrica-label">In corso</span><span class="metrica-val">${m.stanzeInCorso}</span>
      <span class="metrica-label">In attesa</span><span class="metrica-val">${m.stanzeAttesa}</span>
      <span class="metrica-label">Finite</span><span class="metrica-val">${m.stanzeFinite}</span>
      <span class="metrica-label">Timer turni attivi</span><span class="metrica-val">${m.timerTurniAttivi}</span>
      <div class="metrica-sez">Memoria processo</div>
      <span class="metrica-label">RSS</span><span class="metrica-val ${memCls}">${m.memoria.rss_mb} MB</span>
      <span class="metrica-label">Heap usato</span><span class="metrica-val">${m.memoria.heap_used_mb} / ${m.memoria.heap_total_mb} MB</span>
      <div class="metrica-sez">Sistema</div>
      <span class="metrica-label">Load avg (1m/5m/15m)</span><span class="metrica-val ${loadCls}">${m.sistema.loadavg_1m} / ${m.sistema.loadavg_5m} / ${m.sistema.loadavg_15m}</span>
      <span class="metrica-label">CPU</span><span class="metrica-val">${m.sistema.cpu_count} core</span>
      <span class="metrica-label">RAM</span><span class="metrica-val">${m.sistema.ram_totale_mb - m.sistema.ram_libera_mb} / ${m.sistema.ram_totale_mb} MB</span>
    `;
  } catch (e) { el.textContent = 'Errore caricamento metriche'; }
}
document.getElementById('btnCreaTorneo')?.addEventListener('click', async () => {
  const nome = document.getElementById('adminTorneoNome').value.trim(); if (!nome) { alert('Nome torneo'); return; }
  const num = parseInt(document.getElementById('adminTorneoGiocatori').value);
  const [mod, val] = document.getElementById('adminTorneoModalita').value.split('_');
  const ip = document.getElementById('adminTorneoIp').checked;
  const tipoGioco = document.getElementById('adminTorneoTipo')?.value || 'maresciallo';
  const d = await (await fetch('/api/admin/torneo/crea', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: getNomeUtente(), nome, numGiocatori: num, modalitaVittoria: mod, valoreVittoria: parseInt(val), controlloIp: ip, tipoGioco }) })).json();
  if (d.ok) { document.getElementById('adminTorneoNome').value = ''; caricaDatiAdmin(); alert('Torneo creato!'); } else alert(d.errore);
});
window.annullaTorneoFn = async function(id) { if (!confirm('Annullare?')) return; await fetch('/api/admin/torneo/annulla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: getNomeUtente(), torneoId: id }) }); caricaDatiAdmin(); };

// --- TORNEO ---
let torneoCorrenteId = null;
let partitaTorneoCorrente = false;
document.getElementById('btnVaiTorneo').addEventListener('click', caricaTorneo);
document.getElementById('btnTorneoIndietro').addEventListener('click', () => mostraSchermata('lobby'));
document.getElementById('btnTabelloneIndietro').addEventListener('click', () => { if (partitaTorneoCorrente && statoGioco) mostraSchermata('gioco'); else if (torneoCorrenteId) caricaTorneo(); else mostraSchermata('lobby'); });

async function caricaTorneo() {
  const d = await (await fetch('/api/torneo/attivo')).json();
  const c = document.getElementById('torneoContenuto');
  if (!d.ok || !d.torneo) { c.innerHTML = '<div class="torneo-nessuno">Nessun torneo disponibile</div>'; document.getElementById('torneoTitolo').textContent = 'Torneo'; mostraSchermata('torneo'); return; }
  const t = d.torneo; torneoCorrenteId = t.id;
  if (t.stato === 'iscrizioni') { await renderIscrizioni(t); mostraSchermata('torneo'); } else caricaTabellone(t.id);
}
async function renderIscrizioni(t) {
  const c = document.getElementById('torneoContenuto'); document.getElementById('torneoTitolo').textContent = t.nome;
  const isIscritto = t.squadre.some(sq => sq.giocatori.includes(getNomeUtente()));
  const pct = Math.round((t.iscritti / t.numGiocatori) * 100);
  let html = `<div class="torneo-info"><h3>${t.nome}</h3><p>${t.numSquadre} giocatori</p></div>
    <div class="torneo-progress"><div class="torneo-progress-bar"><div class="torneo-progress-fill" style="width:${pct}%"></div></div><div class="torneo-progress-text">${t.iscritti}/${t.numGiocatori} iscritti</div></div>
    <div class="torneo-btns">${isIscritto ? `<button class="btn-secondario" onclick="lasciaFnTorneo(${t.id})">Ritirati</button>` : ''}</div>
    <div class="torneo-squadre-grid">`;
  for (const sq of t.squadre) {
    html += `<div class="torneo-squadra-card"><h4>Slot ${sq.numero + 1}</h4>`;
    if (sq.giocatori[0]) { const isSelf = sq.giocatori[0] === getNomeUtente(); html += `<p${isSelf ? ' style="color:#d4af37;font-weight:bold"' : ''}>${sq.giocatori[0]}</p>`; }
    else if (!isIscritto) html += `<button class="btn-unisciti-squadra" onclick="iscrivitiFnTorneo(${t.id}, ${sq.numero})">Unisciti</button>`;
    else html += `<p class="slot-vuoto">- vuoto -</p>`;
    html += `</div>`;
  }
  html += `</div>`; c.innerHTML = html;
}
window.iscrivitiFnTorneo = async function(id, sq) { const d = await (await fetch('/api/torneo/iscriviti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torneoId: id, nome: getNomeUtente(), numeroSquadra: sq }) })).json(); if (!d.ok) mostraMessaggio(d.errore, 'errore'); caricaTorneo(); };
window.lasciaFnTorneo = async function(id) { await fetch('/api/torneo/lascia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torneoId: id, nome: getNomeUtente() }) }); caricaTorneo(); };

async function caricaTabellone(id) { const d = await (await fetch(`/api/torneo/${id}/tabellone`)).json(); if (!d.ok) return; renderTabellone(d.torneo); mostraSchermata('tabellone'); }
function renderTabellone(t) {
  document.getElementById('tabelloneTitolo').textContent = t.nome;
  const c = document.getElementById('tabelloneContenuto'); const nome = getNomeUtente();
  let miaSquadraId = null; for (const [id, sq] of Object.entries(t.squadre)) { if (sq.giocatori?.includes(nome)) { miaSquadraId = parseInt(id); break; } }
  let html = '<div class="tabellone">';
  for (let ri = 0; ri < t.rounds.length; ri++) {
    const round = t.rounds[ri]; const gap = 20 * Math.pow(2, ri);
    html += `<div class="tabellone-round"><div class="tabellone-round-title">${round.nome}</div>`;
    for (const m of round.partite) {
      const nA = m.squadraA ? m.squadraA.giocatori.join(', ') || m.squadraA.nome : 'TBD';
      const nB = m.squadraB ? m.squadraB.giocatori.join(', ') || m.squadraB.nome : 'TBD';
      const isMy = (m.squadraA?.id === miaSquadraId) || (m.squadraB?.id === miaSquadraId);
      const clsA = m.vincitore === m.squadraA?.id ? 'vincitore' : (!m.squadraA ? 'tbd' : '');
      const clsB = m.vincitore === m.squadraB?.id ? 'vincitore' : (!m.squadraB ? 'tbd' : '');
      html += `<div class="tabellone-match ${m.stato}" style="margin-bottom:${gap}px;${isMy?'box-shadow:0 0 8px rgba(233,30,99,0.5);':''}">`;
      html += `<div class="tabellone-team ${clsA}"><span>${nA}</span></div><div class="tabellone-team ${clsB}"><span>${nB}</span></div>`;
      if (isMy && m.codiceStanza && m.stato === 'inCorso') html += `<button class="tabellone-vai-btn" onclick="uniscitiPartitaTorneoFn('${m.codiceStanza}')">Vai alla partita</button>`;
      html += `</div>`;
    }
    html += `</div>`; if (ri < t.rounds.length - 1) html += `<div class="tabellone-connector"></div>`;
  }
  html += `</div>`;
  if (t.stato === 'completato' && t.squadraVincitrice) html += `<div style="text-align:center;margin-top:20px"><h2 style="color:#d4af37">Vincitore: ${t.squadraVincitrice.giocatori.join(', ')}</h2></div>`;
  if (t.stato === 'inCorso' && miaSquadraId) { let att = false; for (const r of t.rounds) for (const m of r.partite) { if (m.stato === 'attesa' && ((m.squadraA?.id === miaSquadraId && !m.squadraB) || (m.squadraB?.id === miaSquadraId && !m.squadraA))) att = true; } if (att) html += `<div class="torneo-attesa-msg">In attesa degli avversari...</div>`; }
  c.innerHTML = html;
}
function mostraVittoriaTorneo() { document.getElementById('tabelloneContenuto').innerHTML = `<div class="torneo-vittoria"><div class="torneo-vittoria-trofeo">&#127942;</div><h1>Hai vinto il torneo!</h1><p>Congratulazioni!</p><button class="btn-primario" onclick="torneoCorrenteId&&caricaTabellone(torneoCorrenteId)">Tabellone</button><button class="btn-secondario" style="margin-top:10px" onclick="mostraSchermata('lobby')">Lobby</button></div>`; mostraSchermata('tabellone'); }
window.uniscitiPartitaTorneoFn = function(codice) { partitaTorneoCorrente = true; setSessione({ codice, nome: getNomeUtente() }); socket.emit('uniscitiPartitaTorneo', { codiceStanza: codice, nome: getNomeUtente() }); mostraSchermata('attesa'); };

socket.on('torneoDisponibile', () => {});
socket.on('torneoIniziato', ({ torneoId }) => { torneoCorrenteId = torneoId; caricaTabellone(torneoId); });
socket.on('torneoAggiornato', ({ torneoId }) => { if (schermate.tabellone.classList.contains('attiva') && torneoCorrenteId === torneoId) caricaTabellone(torneoId); if (schermate.torneo.classList.contains('attiva') && torneoCorrenteId === torneoId) caricaTorneo(); });
socket.on('torneoCompletato', ({ torneoId }) => { if (torneoCorrenteId === torneoId) caricaTabellone(torneoId); });
socket.on('torneoPartitaPronta', ({ torneoId, codiceStanza }) => { torneoCorrenteId = torneoId; partitaTorneoCorrente = true; setSessione({ codice: codiceStanza, nome: getNomeUtente() }); socket.emit('uniscitiPartitaTorneo', { codiceStanza, nome: getNomeUtente() }); mostraSchermata('attesa'); });
socket.on('torneoAnnullato', () => { torneoCorrenteId = null; if (schermate.torneo.classList.contains('attiva') || schermate.tabellone.classList.contains('attiva')) { mostraMessaggio('Torneo annullato', 'errore'); setTimeout(() => mostraSchermata('lobby'), 2000); } });

// Auto-login
(async function() {
  const s = getUtenteLoggato();
  if (s) {
    utenteLoggato = s;
    try { const d = await (await fetch(`/api/isadmin/${encodeURIComponent(s)}`)).json(); isAdmin = d.ok && d.admin; } catch {}
    // Se c'e' una sessione di partita attiva (refresh in partita), non andare in lobby:
    // il socket si riconnette e il server invia 'partitaIniziata' che apre la schermata gioco.
    const sess = getSessione();
    if (sess && sess.codice) {
      mostraSchermata('attesa');
      const msgAtt = document.getElementById('attesaMessaggio');
      if (msgAtt) msgAtt.textContent = 'Riconnessione in corso...';
      setTimeout(() => {
        if (document.getElementById('attesa').classList.contains('attiva')) {
          setSessione(null);
          entraInLobby();
        }
      }, 5000);
    } else {
      entraInLobby();
    }
  }
})();

socket.on('connect', () => {
  const sess = getSessione();
  if (sess && sess.codice && sess.nome && getUtenteLoggato()) {
    socket.emit('autenticato', { nome: sess.nome });
    if (sess.codice.startsWith('T')) socket.emit('uniscitiPartitaTorneo', { codiceStanza: sess.codice, nome: sess.nome });
    else socket.emit('uniscitiStanza', { codice: sess.codice, nome: sess.nome });
  }
});
