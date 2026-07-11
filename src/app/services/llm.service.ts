import { Injectable, signal } from '@angular/core';
import {
  CreateMLCEngine,
  MLCEngineInterface,
  InitProgressReport,
} from '@mlc-ai/web-llm';
import { Schutzkatalog } from '../models/kategorie.model';
import { PromptStrategie, STANDARD_STRATEGIE } from './prompt-strategie';

export interface ModellOption {
  id: string;
  label: string;
}

// Nur Phi-4-mini-instruct, gemaess der Architekturentscheidung in 5.4.2.
// Die zuvor testweise hinterlegten Modelle (Llama 3.2, Qwen2.5) wurden
// entfernt, da sie nicht Gegenstand der Bewertung in Kapitel 6 sind.
export const MODELL_OPTIONEN: ModellOption[] = [
  {
    id: 'Phi-4-mini-instruct-q4f16_1-MLC',
    label: 'Phi-4-mini-instruct · q4f16 (~3.4 GB VRAM)',
  },
  {
    id: 'Phi-4-mini-instruct-q4f32_1-MLC',
    label: 'Phi-4-mini-instruct · q4f32 (~4.2 GB VRAM)',
  },
];

export const STANDARD_MODELL = MODELL_OPTIONEN[0].id;
const TOP_LOGPROBS = 5;
// temperature MUSS > 0 sein: web-llm berechnet logprobs aus der Softmax-
// Verteilung. Bei temperature 0 (Greedy) sind die Werte ungueltig (NaN) und
// die Pipeline kann in einen "disposed"-Zustand geraten. Ein fester seed haelt
// die Ausgabe trotzdem reproduzierbar.
const TEMPERATURE = 0.1;
const SEED = 42;
// CoT benoetigt mehr Tokens als Direkt/Few-Shot, da vor der JSON-Antwort eine
// Begruendung generiert wird. Bei Direkt/Few-Shot bleiben die zusaetzlichen
// Tokens ungenutzt und erhoehen nur das Antwortlimit, nicht die Laufzeit.
const MAX_TOKENS = 160;

export interface Kategorisierung {
  oberkategorie: string | null;
  unterkategorie: string | null;
  /** Kombinierter Wert (Minimum aus Ober- und Unter-Konfidenz), z. B. fuer Sortierung/Farbe. */
  konfidenz: number | null;
  /** Getrennte Konfidenz der Oberkategorie-Zuordnung. */
  konfidenzOber: number | null;
  /** Getrennte Konfidenz der Unterkategorie-Zuordnung. */
  konfidenzUnter: number | null;
  rohantwort: string;
}

interface TokenLogprob {
  token: string;
  logprob: number;
}

@Injectable({ providedIn: 'root' })
export class LlmService {
  readonly ladephase = signal<string>('');
  readonly ladefortschritt = signal<number>(0);
  readonly bereit = signal(false);
  readonly aktivesModell = signal<string>(STANDARD_MODELL);

  private engine: MLCEngineInterface | null = null;
  private laufendeAnfrage: Promise<unknown> = Promise.resolve();

  async initialisieren(modellId: string = STANDARD_MODELL): Promise<void> {
    if (this.engine && this.aktivesModell() === modellId && this.bereit()) {
      return;
    }
    if (!('gpu' in navigator)) {
      throw new Error(
        'WebGPU ist in diesem Browser nicht verfuegbar. Bitte einen aktuellen Chrome/Edge verwenden.',
      );
    }
    this.bereit.set(false);
    this.aktivesModell.set(modellId);

    this.engine = await CreateMLCEngine(modellId, {
      initProgressCallback: (bericht: InitProgressReport) => {
        this.ladephase.set(bericht.text);
        this.ladefortschritt.set(bericht.progress ?? 0);
      },
    });
    this.bereit.set(true);
    this.ladephase.set('Modell bereit');
  }

  async kategorisiere(
    attribut: string,
    katalog: Schutzkatalog,
    strategie: PromptStrategie = STANDARD_STRATEGIE,
  ): Promise<Kategorisierung> {
    if (!this.engine || !this.bereit()) {
      throw new Error('Modell ist nicht initialisiert.');
    }

    // Anfragen strikt serialisieren: web-llm verarbeitet pro Modell nur eine
    // Anfrage gleichzeitig. Parallele Aufrufe fuehren sonst zu fehlerhaften
    // Ergebnissen bzw. "already disposed"-Fehlern.
    const vorher = this.laufendeAnfrage.catch(() => undefined);
    const eigene = vorher.then(() =>
      this.anfrageAusfuehren(attribut, katalog, strategie),
    );
    this.laufendeAnfrage = eigene;
    return eigene;
  }

  private async anfrageAusfuehren(
    attribut: string,
    katalog: Schutzkatalog,
    strategie: PromptStrategie,
  ): Promise<Kategorisierung> {
    const praefix = `[${attribut}]`;

    // ---------- Stufe 1: Oberkategorie ----------
    const oberMessages = strategie.buildOberMessages(attribut, katalog);
    const ober = await this.erzeugeAntwort(oberMessages, `${praefix}[Ober]`);
    const oberRoh = strategie.parseOber(ober.rohtext, attribut).oberkategorie;
    const konfidenzOber = this.berechneKonfidenz(
      ober.rohtext,
      ober.tokens,
      oberRoh,
    );
    console.log(
      `${praefix}[Ober] Geparst:`,
      { oberkategorie: oberRoh },
      '| Konfidenz Ober:',
      konfidenzOber,
    );
    const oberkategorie = this.mappeOberkategorie(oberRoh, katalog);
    console.log(`${praefix}[Ober] Auf Katalog gemappt:`, { oberkategorie });

    if (!oberkategorie) {
      console.warn(
        `${praefix} Keine gueltige Oberkategorie -> Unterkategorie wird uebersprungen.`,
      );
      return {
        oberkategorie: null,
        unterkategorie: null,
        konfidenz: konfidenzOber,
        konfidenzOber,
        konfidenzUnter: null,
        rohantwort: ober.rohtext,
      };
    }

    // ---------- Stufe 2: Unterkategorie (mit gewaehlter Oberkategorie als Kontext) ----------
    const unterMessages = strategie.buildUnterMessages(
      attribut,
      oberkategorie,
      katalog,
    );
    const unter = await this.erzeugeAntwort(unterMessages, `${praefix}[Unter]`);
    const unterRoh = strategie.parseUnter(unter.rohtext, attribut).unterkategorie;
    const konfidenzUnter = this.berechneKonfidenz(
      unter.rohtext,
      unter.tokens,
      unterRoh,
    );
    console.log(
      `${praefix}[Unter] Geparst:`,
      { unterkategorie: unterRoh },
      '| Konfidenz Unter:',
      konfidenzUnter,
    );
    const unterkategorie = this.mappeUnterkategorie(
      unterRoh,
      oberkategorie,
      katalog,
    );
    console.log(`${praefix}[Unter] Auf Katalog gemappt:`, { unterkategorie });

    const konfidenz = this.kombiniereKonfidenz(konfidenzOber, konfidenzUnter);
    console.log(`${praefix} Endergebnis:`, {
      oberkategorie,
      unterkategorie,
      konfidenzOber,
      konfidenzUnter,
      konfidenz,
    });

    return {
      oberkategorie,
      unterkategorie,
      konfidenz,
      konfidenzOber,
      konfidenzUnter,
      rohantwort: `Ober: ${ober.rohtext} || Unter: ${unter.rohtext}`,
    };
  }

  /**
   * Fuehrt einen einzelnen Chat-Completion-Aufruf aus und loggt vollstaendig:
   * Modell, Request-Konfiguration, Rohantwort und alle logprobs/top_logprobs.
   */
  private async erzeugeAntwort(
    messages: Parameters<
      MLCEngineInterface['chat']['completions']['create']
    >[0]['messages'],
    praefix: string,
  ): Promise<{ rohtext: string; tokens: TokenLogprob[] }> {
    console.log(`${praefix} Modell:`, this.aktivesModell());
    console.log(
      `${praefix} response_format:`,
      '(kein response_format-Schema gesetzt – JSON wird per Prompt-Anweisung erzwungen)',
    );
    console.log(`${praefix} Request-Konfiguration:`, {
      temperature: TEMPERATURE,
      seed: SEED,
      max_tokens: MAX_TOKENS,
      logprobs: true,
      top_logprobs: TOP_LOGPROBS,
      messages,
    });

    let antwort;
    try {
      antwort = await this.engine!.chat.completions.create({
        messages,
        temperature: TEMPERATURE,
        seed: SEED,
        max_tokens: MAX_TOKENS,
        logprobs: true,
        top_logprobs: TOP_LOGPROBS,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/dispose/i.test(msg)) {
        this.bereit.set(false);
        throw new Error(
          'Die WebGPU-Engine ist abgestürzt (disposed). Bitte das Modell in den ' +
            'Einstellungen neu laden. Ursprünglicher Fehler: ' +
            msg,
        );
      }
      throw e;
    }

    const wahl = antwort.choices[0];
    const rohtext = wahl.message.content ?? '';
    console.log(`${praefix} Rohantwort:`, rohtext);

    const rohLogprobs = wahl.logprobs?.content ?? [];
    console.log(`${praefix} logprobs (${rohLogprobs.length} Tokens):`, rohLogprobs);
    rohLogprobs.forEach((t, i) => {
      console.log(
        `${praefix}   Token[${i}] ${JSON.stringify(t.token)} logprob=${t.logprob} p=${Math.exp(t.logprob)}`,
        'top_logprobs:',
        t.top_logprobs,
      );
    });

    return { rohtext, tokens: rohLogprobs as TokenLogprob[] };
  }

  private kombiniereKonfidenz(
    a: number | null,
    b: number | null,
  ): number | null {
    const werte = [a, b].filter((x): x is number => x !== null);
    return werte.length ? Math.min(...werte) : null;
  }

  /**
   * Normalisiert eine Kategoriebezeichnung fuer den robusten Vergleich
   * (Gross-/Kleinschreibung, mehrfache Leerzeichen, Randwhitespace). Dient
   * nur dem Abgleich gegen den Katalog, nicht der Anzeige.
   */
  private normalisiere(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Bildet die vom Modell zurueckgegebene Kategoriebezeichnung exakt auf
   * eine Oberkategorie des Katalogs ab. Exakter Vergleich zuerst, danach
   * normalisierter Vergleich (Gross-/Kleinschreibung, Whitespace) als
   * Toleranz gegen kleinere Abweichungen. Keine Fuzzy-Teiluebereinstimmung,
   * damit keine falsche Kategorie geraten wird.
   */
  private mappeOberkategorie(
    wert: string | null,
    katalog: Schutzkatalog,
  ): string | null {
    if (!wert) return null;
    const exakt = katalog.kategorien.find((k) => k.oberkategorie === wert);
    if (exakt) return exakt.oberkategorie;

    const normZiel = this.normalisiere(wert);
    const genaehert = katalog.kategorien.find(
      (k) => this.normalisiere(k.oberkategorie) === normZiel,
    );
    return genaehert?.oberkategorie ?? null;
  }

  /**
   * Analoges Mapping fuer Unterkategorien, eingeschraenkt auf die zur
   * bereits gewaehlten Oberkategorie gehoerenden Eintraege.
   */
  private mappeUnterkategorie(
    wert: string | null,
    oberkategorie: string | null,
    katalog: Schutzkatalog,
  ): string | null {
    if (!oberkategorie || !wert) return null;
    const kat = katalog.kategorien.find(
      (k) => k.oberkategorie === oberkategorie,
    );
    if (!kat) return null;

    if (kat.attribute.includes(wert)) return wert;

    const normZiel = this.normalisiere(wert);
    const genaehert = kat.attribute.find(
      (a) => this.normalisiere(a) === normZiel,
    );
    return genaehert ?? null;
  }

  /**
   * Struktur-/Markup-Token, die NICHT zur Kategoriebezeichnung gehoeren und
   * daher die Konfidenz nicht verfaelschen duerfen: Code-Fences (```), das Wort
   * "json", JSON-Interpunktion ({ } [ ] " : ,), Sondertokens (<|...|>) sowie
   * reine Whitespace-Tokens.
   */
  private istStrukturToken(token: string): boolean {
    const t = token.trim();
    if (t === '') return true;
    if (/^<\|.*\|>$/.test(t)) return true;
    if (/^`+$/.test(t)) return true;
    if (t.toLowerCase() === 'json') return true;
    if (/^[{}[\]":,]+$/.test(t)) return true;
    return false;
  }

  private istInhaltsToken(token: string): boolean {
    return !this.istStrukturToken(token) && /[\p{L}\p{N}]/u.test(token);
  }

  /**
   * Konfidenz EINER Zuordnung (Ober ODER Unter): niedrigste Einzel-Token-
   * Wahrscheinlichkeit unter den Tokens, die die generierte Kategoriebezeichnung
   * bilden. Struktur-/Fence-Token werden explizit ausgeschlossen, damit z. B.
   * ``` nicht als niedrigster Wert die Konfidenz verfaelscht.
   *
   * Sucht bewusst das LETZTE Vorkommen der Zielbezeichnung im Rohtext (nicht
   * das erste): Bei CoT kann dieselbe Kategoriebezeichnung bereits in der
   * Begruendung erwaehnt werden, bevor sie im finalen <antwort>-JSON-Block
   * erneut auftaucht. Nur das letzte Vorkommen entspricht der tatsaechlichen
   * Endantwort und darf fuer die Konfidenz herangezogen werden.
   */
  private berechneKonfidenz(
    rohtext: string,
    tokens: TokenLogprob[],
    ziel: string | null,
  ): number | null {
    if (!tokens.length) {
      return null;
    }

    let cursor = 0;
    const tokenSpannen = tokens.map((t) => {
      const start = cursor;
      cursor += t.token.length;
      return { start, ende: cursor, logprob: t.logprob, token: t.token };
    });

    let min = Infinity;

    // 1. Bevorzugt: nur die Tokens, die die generierte Kategoriebezeichnung bilden.
    if (ziel) {
      const idx = rohtext.lastIndexOf(ziel);
      if (idx >= 0) {
        const zs = idx;
        const ze = idx + ziel.length;
        for (const ts of tokenSpannen) {
          const ueberlappt = ts.start < ze && ts.ende > zs;
          if (ueberlappt && this.istInhaltsToken(ts.token)) {
            const p = Math.exp(ts.logprob);
            if (Number.isFinite(p)) {
              min = Math.min(min, p);
            }
          }
        }
      }
    }

    // 2. Fallback (Kategoriebezeichnung nicht lokalisierbar): niedrigste
    // Wahrscheinlichkeit ueber alle INHALTS-Tokens (ohne Fences/Interpunktion).
    if (!Number.isFinite(min)) {
      for (const ts of tokenSpannen) {
        if (this.istInhaltsToken(ts.token)) {
          const p = Math.exp(ts.logprob);
          if (Number.isFinite(p)) {
            min = Math.min(min, p);
          }
        }
      }
    }

    return Number.isFinite(min) ? min : null;
  }
}
