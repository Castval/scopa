// Logica del gioco Scopa Maresciallo

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
  constructor(valore, seme, mazzoId) {
    this.valore = valore;
    this.seme = seme;
    this.mazzoId = mazzoId; // 0 o 1 per distinguere i due mazzi
    this.id = `${valore}_${seme}_${mazzoId}`;
  }

  isMaresciallo() {
    return this.valore === 10 && this.seme === 'spade';
  }

  isSettebello() {
    return this.valore === 7 && this.seme === 'denari';
  }

  isOttoDenari() {
    return this.valore === 8 && this.seme === 'denari';
  }

  isAsso() {
    return this.valore === 1;
  }

  equals(altra) {
    return this.valore === altra.valore && this.seme === altra.seme;
  }

  exactEquals(altra) {
    return this.valore === altra.valore && this.seme === altra.seme && this.mazzoId === altra.mazzoId;
  }
}

class Mazzo {
  constructor() {
    this.carte = [];
    this.reset();
  }

  reset() {
    this.carte = [];
    // Creiamo 2 mazzi
    for (let mazzoId = 0; mazzoId < 2; mazzoId++) {
      for (const seme of SEMI) {
        for (const valore of VALORI) {
          this.carte.push(new Carta(valore, seme, mazzoId));
        }
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
    this.scope = []; // Array di { carta, valore } dove valore è 1 o 3
    this.puntiTotali = 0;
  }

  reset() {
    this.mano = [];
    this.prese = [];
    this.scope = [];
  }

  resetMano() {
    this.mano = [];
  }
}

class ScopaMaresciallo {
  constructor(roomId, puntiVittoria = 31, maxGiocatori = 2) {
    this.roomId = roomId;
    this.mazzo = new Mazzo();
    this.giocatori = [];
    this.tavolo = [];
    this.turnoCorrente = 0;
    this.stato = 'attesa'; // attesa, inCorso, fineRound, finePartita
    this.ultimoAPrendere = null;
    this.puntiVittoria = puntiVittoria;
    this.maxGiocatori = maxGiocatori;
  }

  aggiungiGiocatore(id, nome) {
    if (this.giocatori.length >= this.maxGiocatori) return false;
    this.giocatori.push(new Giocatore(id, nome));
    return true;
  }

  rimuoviGiocatore(id) {
    this.giocatori = this.giocatori.filter(g => g.id !== id);
  }

  iniziaPartita() {
    if (this.giocatori.length !== this.maxGiocatori) return false;
    this.stato = 'inCorso';
    this.iniziaRound();
    return true;
  }

  // Restituisce le due squadre per il calcolo punti
  // In 2 giocatori: ogni giocatore è una squadra
  // In 4 giocatori: squadra 0 = giocatori 0,2 | squadra 1 = giocatori 1,3
  getSquadre() {
    if (this.maxGiocatori === 2) {
      return [
        { id: 0, giocatori: [this.giocatori[0]], prese: this.giocatori[0].prese, scope: this.giocatori[0].scope },
        { id: 1, giocatori: [this.giocatori[1]], prese: this.giocatori[1].prese, scope: this.giocatori[1].scope }
      ];
    }
    const team0 = [this.giocatori[0], this.giocatori[2]];
    const team1 = [this.giocatori[1], this.giocatori[3]];
    return [
      { id: 0, giocatori: team0, prese: [...team0[0].prese, ...team0[1].prese], scope: [...team0[0].scope, ...team0[1].scope] },
      { id: 1, giocatori: team1, prese: [...team1[0].prese, ...team1[1].prese], scope: [...team1[0].scope, ...team1[1].scope] }
    ];
  }

  getSquadraDelGiocatore(giocatoreId) {
    const idx = this.giocatori.findIndex(g => g.id === giocatoreId);
    return this.maxGiocatori === 2 ? idx : idx % 2;
  }

  getVincitore() {
    const squadre = this.getSquadre();
    const vincitrice = squadre.find(sq => sq.giocatori[0].puntiTotali >= this.puntiVittoria);
    if (!vincitrice) return null;
    return vincitrice.giocatori.map(g => g.nome).join(' & ');
  }

  iniziaRound() {
    this.mazzo.reset();
    this.tavolo = [];
    this.ultimoAPrendere = null;

    for (const g of this.giocatori) {
      g.reset();
    }

    // Nessuna carta iniziale al tavolo (regola Scopa Maresciallo)

    // Distribuisci 5 carte a testa
    this.distribuisciCarte();
  }

  distribuisciCarte() {
    for (const g of this.giocatori) {
      g.mano = this.mazzo.pesca(5);
    }
  }

  getGiocatoreCorrente() {
    return this.giocatori[this.turnoCorrente];
  }

  // Trova tutte le combinazioni possibili per prendere
  trovaCombinazioni(carta, tavolo) {
    const combinazioni = [];

    // Se è un asso, prende tutto
    if (carta.isAsso() && tavolo.length > 0) {
      combinazioni.push([...tavolo]);
      return combinazioni;
    }

    // Cerca carte singole con stesso valore (ma regola carta uguale!)
    const carteSingolaValore = tavolo.filter(c => c.valore === carta.valore);

    // Controlla se ci sono carte identiche (stesso seme e valore)
    const carteIdentiche = carteSingolaValore.filter(c => c.seme === carta.seme);

    // Se ci sono carte identiche, possiamo prenderle SOLO se è scopa
    // Altrimenti possiamo prendere carte dello stesso valore ma seme diverso
    const carteNonIdentiche = carteSingolaValore.filter(c => c.seme !== carta.seme);

    // Se c'è solo una carta identica sul tavolo, è scopa (3 punti)
    if (carteIdentiche.length > 0 && tavolo.length === 1) {
      combinazioni.push([carteIdentiche[0]]);
      return combinazioni;
    }

    for (const c of carteNonIdentiche) {
      combinazioni.push([c]);
    }

    // Se c'è una carta singola dello stesso valore, NON si possono fare somme
    // (regola: carta singola ha priorità sulla somma)
    if (carteNonIdentiche.length > 0) {
      return combinazioni;
    }

    // Cerca combinazioni che sommano al valore della carta
    // (solo se non c'è carta singola prendibile)
    if (carta.valore > 1) {
      const combSomma = this.trovaCombinazoniSomma(tavolo, carta.valore);
      for (const comb of combSomma) {
        if (comb.length > 1) { // Solo combinazioni di più carte
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

  // Controlla se una mossa è valida
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

    // Caso speciale: l'asso va sempre nelle prese (anche se tavolo vuoto).
    // Edge case (doppio mazzo): il giocatore puo' avere 2 assi nella stessa mano.
    // Ogni asso viene gestito separatamente nel proprio turno — il primo svuota
    // il tavolo (o si posa solo se tavolo vuoto), il secondo opera sullo stato
    // del tavolo in quel momento (che puo' essere di nuovo non vuoto grazie
    // alle carte giocate dagli avversari in mezzo).
    if (carta.isAsso()) {
      if (this.tavolo.length === 0) {
        // Asso con tavolo vuoto: va nelle prese (tramite assoSolo), non e' scopa.
        return { valida: true, tipo: 'presa', scopa: false, assoSolo: true };
      }
      // Asso con carte a terra: prende TUTTO il tavolo, mai scopa (regola).
      // Il client DEVE inviare cartePresaIds con tutte le carte correnti del tavolo.
      if (cartePresa.length !== this.tavolo.length) {
        return { valida: false, errore: 'L\'asso deve prendere tutte le carte' };
      }
      return { valida: true, tipo: 'presa', scopa: false };
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

    // Verifica presa con carta identica (stesso seme e valore)
    const presaConIdentica = cartePresa.some(c => c.seme === carta.seme && c.valore === carta.valore);

    if (presaConIdentica) {
      // Si può fare solo se è scopa
      const sarebbeScopa = cartePresa.length === this.tavolo.length;
      if (!sarebbeScopa) {
        return { valida: false, errore: 'Non puoi prendere carta identica se non fai scopa' };
      }
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
    return { valida: true, tipo: 'presa', scopa, conIdentica: presaConIdentica };
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
        // Scopa con carta identica vale 3, altrimenti 1
        let valoreScopa = verifica.conIdentica ? 3 : 1;

        // Controlla se la carta giocata è il maresciallo (10 di spade)
        const cartaIsMaresciallo = carta.valore === 10 && carta.seme === 'spade';

        // Controlla se tra le carte prese c'è un maresciallo
        const presaContieneMaresciallo = cartePrese.some(c => c.valore === 10 && c.seme === 'spade');

        // Caso speciale: scopa maresciallo con maresciallo = 10 punti (e niente penalità)
        if (cartaIsMaresciallo && presaContieneMaresciallo) {
          giocatore.scope.push({ carta: carta.id, valore: 10, marescialloConMaresciallo: true });
        } else if (cartaIsMaresciallo || presaContieneMaresciallo) {
          // Scopa con maresciallo (giocato O preso): -4 punti
          giocatore.scope.push({ carta: carta.id, valore: -4 });
        } else {
          giocatore.scope.push({ carta: carta.id, valore: valoreScopa });
        }
      }
    }

    // Prossimo turno
    this.turnoCorrente = (this.turnoCorrente + 1) % this.giocatori.length;

    // Controlla se le mani sono vuote
    const maniVuote = this.giocatori.every(g => g.mano.length === 0);

    if (maniVuote) {
      if (this.mazzo.rimanenti() > 0) {
        this.distribuisciCarte();
      } else {
        // Fine round - carte rimanenti all'ultimo che ha preso
        this.fineRound();
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

    // Controlla vittoria usando punteggi squadra
    const squadre = this.getSquadre();
    const sq0Score = squadre[0].giocatori[0].puntiTotali;
    const sq1Score = squadre[1].giocatori[0].puntiTotali;

    const sq0Vince = sq0Score >= this.puntiVittoria;
    const sq1Vince = sq1Score >= this.puntiVittoria;

    if (sq0Vince || sq1Vince) {
      if (sq0Vince && sq1Vince) {
        if (sq0Score > sq1Score) {
          this.stato = 'finePartita';
          return { finePartita: true, puntiRound };
        } else if (sq1Score > sq0Score) {
          this.stato = 'finePartita';
          return { finePartita: true, puntiRound };
        } else {
          this.stato = 'fineRound';
          return { finePartita: false, puntiRound, pareggio: true };
        }
      } else {
        this.stato = 'finePartita';
        return { finePartita: true, puntiRound };
      }
    }

    this.stato = 'fineRound';
    return { finePartita: false, puntiRound };
  }

  calcolaPuntiRound() {
    const squadre = this.getSquadre();
    const puntiSquadre = { 0: 0, 1: 0 };

    // Scope
    for (const sq of squadre) {
      for (const scopa of sq.scope) {
        puntiSquadre[sq.id] += scopa.valore;
      }
    }

    // Marescialli (-1 punto per ogni maresciallo preso)
    for (const sq of squadre) {
      const marescialli = sq.prese.filter(c => c.valore === 10 && c.seme === 'spade').length;
      const scopeNeg = sq.scope.filter(s => s.valore === -4).length;
      const scopePos = sq.scope.filter(s => s.marescialloConMaresciallo).length * 2;
      const conPenalita = marescialli - scopeNeg - scopePos;
      puntiSquadre[sq.id] -= Math.max(0, conPenalita);
    }

    // Più carte di denari
    const denari0 = squadre[0].prese.filter(c => c.seme === 'denari').length;
    const denari1 = squadre[1].prese.filter(c => c.seme === 'denari').length;
    if (denari0 > denari1) puntiSquadre[0]++;
    else if (denari1 > denari0) puntiSquadre[1]++;

    // Più carte totali
    if (squadre[0].prese.length > squadre[1].prese.length) puntiSquadre[0]++;
    else if (squadre[1].prese.length > squadre[0].prese.length) puntiSquadre[1]++;

    // Settebello
    for (const sq of squadre) {
      puntiSquadre[sq.id] += sq.prese.filter(c => c.valore === 7 && c.seme === 'denari').length;
    }

    // Otto di denari
    for (const sq of squadre) {
      const sett = sq.prese.filter(c => c.valore === 7 && c.seme === 'denari').length;
      const otto = sq.prese.filter(c => c.valore === 8 && c.seme === 'denari').length;
      puntiSquadre[sq.id] += Math.min(sett, otto);
    }

    // Primiera
    const p0 = this.calcolaPrimiera(squadre[0].prese);
    const p1 = this.calcolaPrimiera(squadre[1].prese);
    if (p0 > p1) puntiSquadre[0]++;
    else if (p1 > p0) puntiSquadre[1]++;

    // Napola
    for (const sq of squadre) {
      puntiSquadre[sq.id] += this.calcolaNapola(sq.prese);
    }

    // Mappa punti squadra ai singoli giocatori
    const punti = {};
    for (const g of this.giocatori) {
      const sqId = this.getSquadraDelGiocatore(g.id);
      punti[g.id] = puntiSquadre[sqId];
    }

    return punti;
  }

  // Restituisce dettagli punti per squadra: { 0: {...}, 1: {...} }
  calcolaPuntiRoundDettagliato() {
    const squadre = this.getSquadre();
    const dettagli = {};

    for (const sq of squadre) {
      // Calcola scope (solo valori positivi: +1, +3, +10)
      let scopePunti = 0;
      const carteScope = [];
      for (const scopa of sq.scope) {
        if (scopa.valore > 0) {
          scopePunti += scopa.valore;
          const parti = scopa.carta.split('_');
          carteScope.push({ valore: parseInt(parti[0]), seme: parti[1], punti: scopa.valore });
        }
      }

      // Marescialli
      const carteMarescialli = sq.prese.filter(c => c.valore === 10 && c.seme === 'spade');
      const marescialli = carteMarescialli.length;
      const scopeNeg = sq.scope.filter(s => s.valore === -4).length;
      const scopePos = sq.scope.filter(s => s.marescialloConMaresciallo).length * 2;
      const marescialliNormali = Math.max(0, marescialli - scopeNeg - scopePos);
      const penalitaTotale = marescialliNormali + (scopeNeg * 4);

      // Settebello
      const carteSettebello = sq.prese.filter(c => c.valore === 7 && c.seme === 'denari');
      const settebelli = carteSettebello.length;

      // Otto di denari
      const carteOttoDenari = sq.prese.filter(c => c.valore === 8 && c.seme === 'denari');
      const bonusOtto = Math.min(settebelli, carteOttoDenari.length);

      // Napola
      const napolaPunti = this.calcolaNapola(sq.prese);
      const carteNapola = this.getCarteNapola(sq.prese);

      // Carte primiera
      const cartePrimiera = this.getCartePrimiera(sq.prese);

      dettagli[sq.id] = {
        nome: sq.giocatori.map(g => g.nome).join(' & '),
        scope: scopePunti,
        numScope: sq.scope.length,
        carteScope: carteScope,
        marescialli: -penalitaTotale,
        carteMarescialli: carteMarescialli.map(c => ({ valore: c.valore, seme: c.seme })),
        settebello: settebelli,
        carteSettebello: carteSettebello.map(c => ({ valore: c.valore, seme: c.seme })),
        ottoDenari: bonusOtto,
        carteOttoDenari: carteOttoDenari.slice(0, bonusOtto).map(c => ({ valore: c.valore, seme: c.seme })),
        napola: napolaPunti,
        carteNapola: carteNapola,
        denari: 0,
        numDenari: sq.prese.filter(c => c.seme === 'denari').length,
        carte: 0,
        numCarte: sq.prese.length,
        primiera: 0,
        cartePrimiera: cartePrimiera,
        totale: 0
      };
    }

    // Più carte di denari
    const denari0 = squadre[0].prese.filter(c => c.seme === 'denari').length;
    const denari1 = squadre[1].prese.filter(c => c.seme === 'denari').length;
    if (denari0 > denari1) dettagli[0].denari = 1;
    else if (denari1 > denari0) dettagli[1].denari = 1;

    // Più carte totali
    if (squadre[0].prese.length > squadre[1].prese.length) dettagli[0].carte = 1;
    else if (squadre[1].prese.length > squadre[0].prese.length) dettagli[1].carte = 1;

    // Primiera
    const p0 = this.calcolaPrimiera(squadre[0].prese);
    const p1 = this.calcolaPrimiera(squadre[1].prese);
    if (p0 > p1) dettagli[0].primiera = 1;
    else if (p1 > p0) dettagli[1].primiera = 1;

    // Calcola totali
    for (const sq of squadre) {
      const d = dettagli[sq.id];
      d.totale = d.scope + d.marescialli + d.settebello + d.ottoDenari + d.napola + d.denari + d.carte + d.primiera;
    }

    return dettagli;
  }

  // Ottiene le carte che formano la napola
  getCarteNapola(carte) {
    const denari = carte.filter(c => c.seme === 'denari');
    const carteNapola = [];

    // Conta le carte per valore
    const conteggio = {};
    for (const c of denari) {
      conteggio[c.valore] = (conteggio[c.valore] || 0) + 1;
    }

    // Verifica se c'è napola (1,2,3 di denari)
    if ((conteggio[1] || 0) >= 1 && (conteggio[2] || 0) >= 1 && (conteggio[3] || 0) >= 1) {
      // Trova fino a dove arriva la napola
      let maxValore = 3;
      for (let v = 4; v <= 10; v++) {
        if ((conteggio[v] || 0) >= 1) {
          maxValore = v;
        } else {
          break;
        }
      }

      // Aggiungi le carte della napola
      for (let v = 1; v <= maxValore; v++) {
        carteNapola.push({ valore: v, seme: 'denari' });
      }
    }

    return carteNapola;
  }

  // Ottiene le carte migliori per la primiera
  getCartePrimiera(carte) {
    const cartePrimiera = [];

    for (const seme of SEMI) {
      const carteSeme = carte.filter(c => c.seme === seme);
      if (carteSeme.length > 0) {
        // Trova la carta con il valore primiera più alto
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
    // Primiera: si sommano i punti primiera delle migliori carte per ogni seme.
    // REGOLA: per avere primiera VALIDA serve almeno una carta per ciascuno dei 4 semi.
    // Se manca anche un solo seme, la primiera della squadra vale 0 (niente confronto).
    // E' una regola tradizionale del Maresciallo: meglio nessuna primiera che parziale.
    const migliorePerSeme = {};

    for (const seme of SEMI) {
      const carteSeme = carte.filter(c => c.seme === seme);
      if (carteSeme.length > 0) {
        migliorePerSeme[seme] = Math.max(...carteSeme.map(c => PRIMIERA_VALORI[c.valore]));
      }
    }

    if (Object.keys(migliorePerSeme).length < 4) return 0;

    return Object.values(migliorePerSeme).reduce((a, b) => a + b, 0);
  }

  calcolaNapola(carte) {
    // Napola: sequenza 1-2-3-...-N di denari. Base 3pt per 1-2-3, +1pt per ogni carta
    // consecutiva successiva fino al 10. Max 2 napole (valido in doppio mazzo, dove
    // ci sono 2 copie di ogni denaro: la prima napola usa una copia di 1,2,3,...,
    // la seconda richiede un'altra copia disponibile per ogni valore).
    const denari = carte.filter(c => c.seme === 'denari');
    let puntiTotali = 0;

    // conteggio[v] = quante copie di denari di valore v (carteSingole/multiple)
    const conteggio = {};
    for (const c of denari) conteggio[c.valore] = (conteggio[c.valore] || 0) + 1;

    for (let volta = 0; volta < 2; volta++) {
      // volta=0 richiede conteggio>=1; volta=1 richiede conteggio>=2 (seconda copia).
      if ((conteggio[1] || 0) > volta &&
          (conteggio[2] || 0) > volta &&
          (conteggio[3] || 0) > volta) {
        let puntiNapola = 3;
        for (let v = 4; v <= 10; v++) {
          if ((conteggio[v] || 0) > volta) puntiNapola++;
          else break;
        }
        puntiTotali += puntiNapola;
      }
    }

    return puntiTotali;
  }

  nuovoRound() {
    if (this.stato !== 'fineRound') return false;
    this.turnoCorrente = (this.turnoCorrente + 1) % this.giocatori.length;
    this.iniziaRound();
    this.stato = 'inCorso';
    return true;
  }

  getStato(giocatoreId) {
    const giocatore = this.giocatori.find(g => g.id === giocatoreId);
    const giocatoreIdx = this.giocatori.findIndex(g => g.id === giocatoreId);

    const base = {
      roomId: this.roomId,
      stato: this.stato,
      tavolo: this.tavolo,
      manoGiocatore: giocatore ? giocatore.mano : [],
      nomeGiocatore: giocatore ? giocatore.nome : '',
      turnoMio: this.getGiocatoreCorrente()?.id === giocatoreId,
      turnoNome: this.getGiocatoreCorrente()?.nome || '',
      carteRimanenti: this.mazzo.rimanenti(),
      puntiVittoria: this.puntiVittoria,
      numGiocatori: this.maxGiocatori
    };

    if (this.maxGiocatori === 2) {
      const avversario = this.giocatori.find(g => g.id !== giocatoreId);
      return {
        ...base,
        preseGiocatore: giocatore ? giocatore.prese.length : 0,
        preseAvversario: avversario ? avversario.prese.length : 0,
        scopeGiocatore: giocatore ? giocatore.scope : [],
        scopeAvversario: avversario ? avversario.scope : [],
        puntiGiocatore: giocatore ? giocatore.puntiTotali : 0,
        puntiAvversario: avversario ? avversario.puntiTotali : 0,
        nomeAvversario: avversario ? avversario.nome : '',
        altriGiocatori: avversario ? [{ nome: avversario.nome, carte: avversario.mano.length, tipo: 'avversario' }] : []
      };
    }

    // 4 giocatori - squadre
    const squadra = giocatoreIdx % 2;
    const compagnoIdx = (giocatoreIdx + 2) % 4;
    const compagno = this.giocatori[compagnoIdx];

    // Avversari: gli altri due giocatori (squadra opposta)
    const avversari = this.giocatori.filter((g, i) => i % 2 !== squadra);

    const preseSquadra = (giocatore?.prese.length || 0) + (compagno?.prese.length || 0);
    const scopeSquadra = [...(giocatore?.scope || []), ...(compagno?.scope || [])];
    const preseAvv = avversari.reduce((sum, a) => sum + a.prese.length, 0);
    const scopeAvv = avversari.flatMap(a => a.scope);

    return {
      ...base,
      puntiGiocatore: giocatore ? giocatore.puntiTotali : 0,
      puntiAvversario: avversari[0] ? avversari[0].puntiTotali : 0,
      preseGiocatore: preseSquadra,
      preseAvversario: preseAvv,
      scopeGiocatore: scopeSquadra,
      scopeAvversario: scopeAvv,
      nomeAvversario: avversari.map(a => a.nome).join(' & '),
      nomeCompagno: compagno?.nome || '',
      nomeSquadra: `${giocatore?.nome || ''} & ${compagno?.nome || ''}`,
      nomeSquadraAvversaria: avversari.map(a => a.nome).join(' & '),
      altriGiocatori: [
        { nome: avversari[0]?.nome || '', carte: avversari[0]?.mano.length || 0, tipo: 'avversario' },
        { nome: compagno?.nome || '', carte: compagno?.mano.length || 0, tipo: 'compagno' },
        { nome: avversari[1]?.nome || '', carte: avversari[1]?.mano.length || 0, tipo: 'avversario' }
      ]
    };
  }
}

module.exports = { ScopaMaresciallo, Carta, Mazzo, Giocatore, SEMI, VALORI };
