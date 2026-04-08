// Logica del gioco Scopone Scientifico (2 giocatori)

const SEMI = ['denari', 'coppe', 'bastoni', 'spade'];
const VALORI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 1 = Asso, 8 = Fante, 9 = Cavallo, 10 = Re

// Valori per la primiera
const PRIMIERA_VALORI = {
  7: 21,
  6: 18,
  1: 16,
  5: 15,
  4: 14,
  3: 13,
  2: 12,
  8: 10,
  9: 10,
  10: 10
};

class Carta {
  constructor(valore, seme) {
    this.valore = valore;
    this.seme = seme;
    this.id = `${valore}_${seme}`;
  }

  isSettebello() {
    return this.valore === 7 && this.seme === 'denari';
  }

  equals(altra) {
    return this.valore === altra.valore && this.seme === altra.seme;
  }
}

class Mazzo {
  constructor() {
    this.carte = [];
    this.reset();
  }

  reset() {
    this.carte = [];
    // Un solo mazzo da 40 carte
    for (const seme of SEMI) {
      for (const valore of VALORI) {
        this.carte.push(new Carta(valore, seme));
      }
    }
    this.mescola();
  }

  mescola() {
    for (let i = this.carte.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.carte[i], this.carte[j]] = [this.carte[j], this.carte[i]];
    }
  }

  pesca(n = 1) {
    return this.carte.splice(0, n);
  }

  rimanenti() {
    return this.carte.length;
  }
}

class Giocatore {
  constructor(id, nome) {
    this.id = id;
    this.nome = nome;
    this.mano = [];
    this.prese = [];
    this.scope = []; // Array di { carta, valore }
    this.puntiTotali = 0;
  }

  reset() {
    this.mano = [];
    this.prese = [];
    this.scope = [];
  }
}

class ScoponeScientifico {
  constructor(roomId, puntiVittoria = 21) {
    this.roomId = roomId;
    this.mazzo = new Mazzo();
    this.giocatori = [];
    this.tavolo = [];
    this.turnoCorrente = 0;
    this.stato = 'attesa'; // attesa, inCorso, fineRound, finePartita
    this.ultimoAPrendere = null;
    this.puntiVittoria = puntiVittoria;
    this.maxGiocatori = 2;
  }

  // Adattatori per interfaccia comune con ScopaMaresciallo
  getSquadraDelGiocatore(giocatoreId) {
    return this.giocatori.findIndex(g => g.id === giocatoreId);
  }

  getVincitore() {
    if (this.giocatori.length < 2) return null;
    const [g1, g2] = this.giocatori;
    if (g1.puntiTotali >= this.puntiVittoria && g1.puntiTotali > g2.puntiTotali) return g1.nome;
    if (g2.puntiTotali >= this.puntiVittoria && g2.puntiTotali > g1.puntiTotali) return g2.nome;
    return null;
  }

  getSquadre() {
    return [
      { id: 0, giocatori: [this.giocatori[0]], prese: this.giocatori[0]?.prese || [], scope: this.giocatori[0]?.scope || [] },
      { id: 1, giocatori: [this.giocatori[1]], prese: this.giocatori[1]?.prese || [], scope: this.giocatori[1]?.scope || [] }
    ];
  }

  aggiungiGiocatore(id, nome) {
    if (this.giocatori.length >= 2) return false;
    this.giocatori.push(new Giocatore(id, nome));
    return true;
  }

  rimuoviGiocatore(id) {
    this.giocatori = this.giocatori.filter(g => g.id !== id);
  }

  iniziaPartita() {
    if (this.giocatori.length !== 2) return false;
    this.stato = 'inCorso';
    this.iniziaRound();
    return true;
  }

  iniziaRound() {
    this.mazzo.reset();
    this.tavolo = [];
    this.ultimoAPrendere = null;

    for (const g of this.giocatori) {
      g.reset();
    }

    // Nessuna carta al tavolo
    // 10 carte a testa
    for (const g of this.giocatori) {
      g.mano = this.mazzo.pesca(10);
    }

    // Il primo giocatore pesca 1 carta prima di giocare
    const primo = this.giocatori[this.turnoCorrente];
    const pescata = this.mazzo.pesca(1);
    if (pescata.length > 0) {
      primo.mano.push(...pescata);
    }
  }

  getGiocatoreCorrente() {
    return this.giocatori[this.turnoCorrente];
  }

  // Trova tutte le combinazioni possibili per prendere
  trovaCombinazioni(carta, tavolo) {
    const combinazioni = [];

    // Niente "asso prende tutto" nello scopone scientifico
    // L'asso vale 1 come carta normale

    // Cerca carte singole con stesso valore
    const carteSingolaValore = tavolo.filter(c => c.valore === carta.valore);

    // Se c'è una carta singola dello stesso valore, ha priorità sulle somme
    if (carteSingolaValore.length > 0) {
      for (const c of carteSingolaValore) {
        combinazioni.push([c]);
      }
      return combinazioni;
    }

    // Cerca combinazioni che sommano al valore della carta
    if (carta.valore > 1) {
      const combSomma = this.trovaCombinazoniSomma(tavolo, carta.valore);
      for (const comb of combSomma) {
        if (comb.length > 1) {
          combinazioni.push(comb);
        }
      }
    }

    return combinazioni;
  }

  // Trova combinazioni che sommano a un valore target
  trovaCombinazoniSomma(carte, target, start = 0, corrente = []) {
    const risultati = [];

    for (let i = start; i < carte.length; i++) {
      const carta = carte[i];
      const nuovaSomma = corrente.reduce((s, c) => s + c.valore, 0) + carta.valore;

      if (nuovaSomma === target) {
        risultati.push([...corrente, carta]);
      } else if (nuovaSomma < target) {
        const subRisultati = this.trovaCombinazoniSomma(carte, target, i + 1, [...corrente, carta]);
        risultati.push(...subRisultati);
      }
    }

    return risultati;
  }

  // Controlla se una mossa e' valida
  verificaMossa(giocatoreId, cartaId, cartePresaIds) {
    const giocatore = this.giocatori.find(g => g.id === giocatoreId);
    if (!giocatore) return { valida: false, errore: 'Giocatore non trovato' };

    if (this.getGiocatoreCorrente().id !== giocatoreId) {
      return { valida: false, errore: 'Non è il tuo turno' };
    }

    const carta = giocatore.mano.find(c => c.id === cartaId);
    if (!carta) return { valida: false, errore: 'Carta non in mano' };

    const cartePresa = cartePresaIds.map(id => this.tavolo.find(c => c.id === id)).filter(c => c);

    if (cartePresa.length !== cartePresaIds.length) {
      return { valida: false, errore: 'Carte da prendere non valide' };
    }

    // Se non prende niente, deve posare
    if (cartePresa.length === 0) {
      // Verifica che non ci siano prese obbligatorie
      const combinazioniPossibili = this.trovaCombinazioni(carta, this.tavolo);
      if (combinazioniPossibili.length > 0) {
        return { valida: false, errore: 'Devi prendere se puoi' };
      }
      return { valida: true, tipo: 'posa' };
    }

    // Verifica presa singola o somma
    if (cartePresa.length === 1) {
      if (cartePresa[0].valore !== carta.valore) {
        return { valida: false, errore: 'Il valore non corrisponde' };
      }
    } else {
      const somma = cartePresa.reduce((s, c) => s + c.valore, 0);
      if (somma !== carta.valore) {
        return { valida: false, errore: 'La somma non corrisponde' };
      }
    }

    const scopa = cartePresa.length === this.tavolo.length;
    return { valida: true, tipo: 'presa', scopa };
  }

  // Esegue una mossa
  eseguiMossa(giocatoreId, cartaId, cartePresaIds) {
    const verifica = this.verificaMossa(giocatoreId, cartaId, cartePresaIds);
    if (!verifica.valida) return verifica;

    const giocatore = this.giocatori.find(g => g.id === giocatoreId);
    const cartaIndex = giocatore.mano.findIndex(c => c.id === cartaId);
    const carta = giocatore.mano.splice(cartaIndex, 1)[0];

    if (verifica.tipo === 'posa') {
      this.tavolo.push(carta);
    } else {
      // Presa
      const cartePrese = [];
      for (const id of cartePresaIds) {
        const idx = this.tavolo.findIndex(c => c.id === id);
        if (idx !== -1) {
          cartePrese.push(this.tavolo.splice(idx, 1)[0]);
        }
      }

      giocatore.prese.push(carta, ...cartePrese);
      this.ultimoAPrendere = giocatoreId;

      if (verifica.scopa) {
        // L'ultima mossa del round non conta come scopa
        const ultimaMossa = this.giocatori.every(g => g.mano.length === 0) && this.mazzo.rimanenti() === 0;
        if (!ultimaMossa) {
          giocatore.scope.push({ carta: carta.id, valore: 1 });
        }
      }
    }

    // Prossimo turno
    this.turnoCorrente = (this.turnoCorrente + 1) % 2;

    // Controlla se le mani sono vuote e il mazzo e' finito
    const maniVuote = this.giocatori.every(g => g.mano.length === 0);

    if (maniVuote && this.mazzo.rimanenti() === 0) {
      // Fine round - carte rimanenti all'ultimo che ha preso
      this.fineRound();
    } else if (this.mazzo.rimanenti() > 0) {
      // Il prossimo giocatore pesca 1 carta dal mazzo
      const prossimo = this.giocatori[this.turnoCorrente];
      const pescata = this.mazzo.pesca(1);
      if (pescata.length > 0) {
        prossimo.mano.push(...pescata);
      }
    }

    return { valida: true, ...verifica };
  }

  fineRound() {
    // Carte rimanenti sul tavolo vanno all'ultimo che ha preso
    if (this.ultimoAPrendere && this.tavolo.length > 0) {
      const giocatore = this.giocatori.find(g => g.id === this.ultimoAPrendere);
      if (giocatore) {
        giocatore.prese.push(...this.tavolo);
        this.tavolo = [];
      }
    }

    // Calcola punti del round
    const puntiRound = this.calcolaPuntiRound();

    for (const g of this.giocatori) {
      g.puntiTotali += puntiRound[g.id];
    }

    // Controlla vittoria
    const g1 = this.giocatori[0];
    const g2 = this.giocatori[1];

    const g1Vince = g1.puntiTotali >= this.puntiVittoria;
    const g2Vince = g2.puntiTotali >= this.puntiVittoria;

    if (g1Vince || g2Vince) {
      if (g1Vince && g2Vince) {
        if (g1.puntiTotali > g2.puntiTotali) {
          this.stato = 'finePartita';
          return { finePartita: true, vincitore: g1.id, puntiRound };
        } else if (g2.puntiTotali > g1.puntiTotali) {
          this.stato = 'finePartita';
          return { finePartita: true, vincitore: g2.id, puntiRound };
        } else {
          this.stato = 'fineRound';
          return { finePartita: false, puntiRound, pareggio: true };
        }
      } else {
        const vincitore = g1Vince ? g1 : g2;
        this.stato = 'finePartita';
        return { finePartita: true, vincitore: vincitore.id, puntiRound };
      }
    }

    this.stato = 'fineRound';
    return { finePartita: false, puntiRound };
  }

  calcolaPuntiRound() {
    const punti = {};

    for (const g of this.giocatori) {
      punti[g.id] = 0;
    }

    const g1 = this.giocatori[0];
    const g2 = this.giocatori[1];

    // Scope
    for (const g of this.giocatori) {
      for (const scopa of g.scope) {
        punti[g.id] += scopa.valore;
      }
    }

    // Piu' carte di denari
    const denariG1 = g1.prese.filter(c => c.seme === 'denari').length;
    const denariG2 = g2.prese.filter(c => c.seme === 'denari').length;
    if (denariG1 > denariG2) punti[g1.id]++;
    else if (denariG2 > denariG1) punti[g2.id]++;

    // Piu' carte totali
    if (g1.prese.length > g2.prese.length) punti[g1.id]++;
    else if (g2.prese.length > g1.prese.length) punti[g2.id]++;

    // Settebello (7 di denari)
    for (const g of this.giocatori) {
      const haSettebello = g.prese.some(c => c.valore === 7 && c.seme === 'denari');
      if (haSettebello) punti[g.id]++;
    }

    // Primiera
    const primieraG1 = this.calcolaPrimiera(g1.prese);
    const primieraG2 = this.calcolaPrimiera(g2.prese);
    if (primieraG1 > primieraG2) punti[g1.id]++;
    else if (primieraG2 > primieraG1) punti[g2.id]++;

    return punti;
  }

  calcolaPuntiRoundDettagliato() {
    const dettagli = {};
    const g1 = this.giocatori[0];
    const g2 = this.giocatori[1];

    for (const g of this.giocatori) {
      let scopePunti = 0;
      const carteScope = [];
      for (const scopa of g.scope) {
        scopePunti += scopa.valore;
        const parti = scopa.carta.split('_');
        carteScope.push({ valore: parseInt(parti[0]), seme: parti[1], punti: scopa.valore });
      }

      const haSettebello = g.prese.some(c => c.valore === 7 && c.seme === 'denari');

      // Carte primiera
      const cartePrimiera = this.getCartePrimiera(g.prese);

      dettagli[g.id] = {
        nome: g.nome,
        scope: scopePunti,
        numScope: g.scope.length,
        carteScope: carteScope,
        settebello: haSettebello ? 1 : 0,
        denari: 0,
        numDenari: g.prese.filter(c => c.seme === 'denari').length,
        carte: 0,
        numCarte: g.prese.length,
        primiera: 0,
        cartePrimiera: cartePrimiera,
        totale: 0
      };
    }

    // Piu' carte di denari
    const denariG1 = g1.prese.filter(c => c.seme === 'denari').length;
    const denariG2 = g2.prese.filter(c => c.seme === 'denari').length;
    if (denariG1 > denariG2) dettagli[g1.id].denari = 1;
    else if (denariG2 > denariG1) dettagli[g2.id].denari = 1;

    // Piu' carte totali
    if (g1.prese.length > g2.prese.length) dettagli[g1.id].carte = 1;
    else if (g2.prese.length > g1.prese.length) dettagli[g2.id].carte = 1;

    // Primiera
    const primieraG1 = this.calcolaPrimiera(g1.prese);
    const primieraG2 = this.calcolaPrimiera(g2.prese);
    if (primieraG1 > primieraG2) dettagli[g1.id].primiera = 1;
    else if (primieraG2 > primieraG1) dettagli[g2.id].primiera = 1;

    // Calcola totali
    for (const g of this.giocatori) {
      const d = dettagli[g.id];
      d.totale = d.scope + d.settebello + d.denari + d.carte + d.primiera;
    }

    // Aggiungi anche chiavi per indice squadra (0/1) per compatibilita' col server unificato
    dettagli[0] = dettagli[g1.id];
    dettagli[1] = dettagli[g2.id];

    return dettagli;
  }

  // Ottiene le carte migliori per la primiera
  getCartePrimiera(carte) {
    const cartePrimiera = [];

    for (const seme of SEMI) {
      const carteSeme = carte.filter(c => c.seme === seme);
      if (carteSeme.length > 0) {
        let migliore = carteSeme[0];
        for (const c of carteSeme) {
          if (PRIMIERA_VALORI[c.valore] > PRIMIERA_VALORI[migliore.valore]) {
            migliore = c;
          }
        }
        cartePrimiera.push({ valore: migliore.valore, seme: migliore.seme });
      }
    }

    return cartePrimiera;
  }

  calcolaPrimiera(carte) {
    const migliorePerSeme = {};

    for (const seme of SEMI) {
      const carteSeme = carte.filter(c => c.seme === seme);
      if (carteSeme.length > 0) {
        migliorePerSeme[seme] = Math.max(...carteSeme.map(c => PRIMIERA_VALORI[c.valore]));
      }
    }

    // Primiera valida solo se hai almeno una carta per seme
    if (Object.keys(migliorePerSeme).length < 4) return 0;

    return Object.values(migliorePerSeme).reduce((a, b) => a + b, 0);
  }

  nuovoRound() {
    if (this.stato !== 'fineRound') return false;
    this.turnoCorrente = (this.turnoCorrente + 1) % 2; // Alterna chi inizia
    this.iniziaRound();
    this.stato = 'inCorso';
    return true;
  }

  getStato(giocatoreId) {
    const giocatore = this.giocatori.find(g => g.id === giocatoreId);
    const avversario = this.giocatori.find(g => g.id !== giocatoreId);

    return {
      roomId: this.roomId,
      stato: this.stato,
      tavolo: this.tavolo,
      manoGiocatore: giocatore ? giocatore.mano : [],
      carteAvversario: avversario ? avversario.mano.length : 0,
      preseGiocatore: giocatore ? giocatore.prese.length : 0,
      preseAvversario: avversario ? avversario.prese.length : 0,
      scopeGiocatore: giocatore ? giocatore.scope : [],
      scopeAvversario: avversario ? avversario.scope : [],
      puntiGiocatore: giocatore ? giocatore.puntiTotali : 0,
      puntiAvversario: avversario ? avversario.puntiTotali : 0,
      nomeGiocatore: giocatore ? giocatore.nome : '',
      nomeAvversario: avversario ? avversario.nome : '',
      turnoMio: this.getGiocatoreCorrente()?.id === giocatoreId,
      turnoNome: this.getGiocatoreCorrente()?.nome || '',
      carteRimanenti: this.mazzo.rimanenti(),
      puntiVittoria: this.puntiVittoria,
      numGiocatori: 2,
      altriGiocatori: avversario ? [{ nome: avversario.nome, carte: avversario.mano.length, tipo: 'avversario' }] : []
    };
  }
}

module.exports = { ScoponeScientifico, Carta, Mazzo, Giocatore, SEMI, VALORI };
