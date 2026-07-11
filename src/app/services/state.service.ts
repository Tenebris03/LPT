import { Injectable, computed, inject, signal } from '@angular/core';
import { AttributErgebnis, ExtrahiertesAttribut } from '../models/kategorie.model';
import { KategorieService } from './kategorie.service';
import { ParserService } from './parser.service';
import { LlmService } from './llm.service';
import { PromptStrategie, STANDARD_STRATEGIE } from './prompt-strategie';

@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly kategorieService = inject(KategorieService);
  private readonly parserService = inject(ParserService);
  private readonly llmService = inject(LlmService);

  readonly dateiname = signal<string | null>(null);
  readonly ergebnisse = signal<AttributErgebnis[]>([]);
  readonly verarbeitet = signal(0);
  readonly gesamt = signal(0);
  readonly laueftInferenz = signal(false);
  readonly fehler = signal<string | null>(null);
  readonly strategie = signal<PromptStrategie>(STANDARD_STRATEGIE);
  readonly dialogOffen = signal(false);
  readonly abgeschlossen = signal(false);

  readonly fortschritt = computed(() => {
    const g = this.gesamt();
    return g === 0 ? 0 : this.verarbeitet() / g;
  });

  private zaehler = 0;

  async dateiVerarbeiten(datei: File): Promise<void> {
    this.fehler.set(null);
    this.dateiname.set(datei.name);
    this.ergebnisse.set([]);
    this.verarbeitet.set(0);
    this.gesamt.set(0);
    this.abgeschlossen.set(false);
    this.dialogOffen.set(false);

    let attribute: ExtrahiertesAttribut[];
    try {
      attribute = await this.parserService.parse(datei);
    } catch (e) {
      this.fehler.set(e instanceof Error ? e.message : String(e));
      return;
    }

    if (!attribute.length) {
      this.fehler.set('Keine Attribute in der Datei gefunden.');
      return;
    }

    const initial: AttributErgebnis[] = attribute.map((a) => ({
      id: `attr-${this.zaehler++}`,
      attribut: a.attribut,
      quelle: a.quelle,
      vorschlagOberkategorie: null,
      vorschlagUnterkategorie: null,
      aktuelleOberkategorie: null,
      aktuelleUnterkategorie: null,
      konfidenz: null,
      konfidenzOber: null,
      konfidenzUnter: null,
      status: 'vorschlag',
      uebernehmen: true,
    }));
    this.ergebnisse.set(initial);
    this.gesamt.set(initial.length);

    await this.inferenzStarten();
    this.dialogOffen.set(true);
  }

  async inferenzStarten(): Promise<void> {
    const katalog = await this.kategorieService.laden();
    this.laueftInferenz.set(true);
    this.verarbeitet.set(0);

    for (const eintrag of this.ergebnisse()) {
      try {
        const res = await this.llmService.kategorisiere(
          eintrag.attribut,
          katalog,
          this.strategie(),
        );
        this.aktualisiere(eintrag.id, {
          vorschlagOberkategorie: res.oberkategorie,
          vorschlagUnterkategorie: res.unterkategorie,
          aktuelleOberkategorie: res.oberkategorie,
          aktuelleUnterkategorie: res.unterkategorie,
          konfidenz: res.konfidenz,
          konfidenzOber: res.konfidenzOber,
          konfidenzUnter: res.konfidenzUnter,
          rohantwort: res.rohantwort,
          status: 'vorschlag',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.aktualisiere(eintrag.id, { fehler: msg });
        // Ein "disposed"-Fehler bedeutet, dass die Engine defekt ist. Weitere
        // Anfragen würden ebenfalls fehlschlagen -> Schleife abbrechen.
        if (/dispose/i.test(msg) || !this.llmService.bereit()) {
          this.fehler.set(msg);
          break;
        }
      }
      this.verarbeitet.update((v) => v + 1);
    }
    this.laueftInferenz.set(false);
  }

  toggleUebernehmen(id: string): void {
    const eintrag = this.ergebnisse().find((e) => e.id === id);
    if (!eintrag) return;
    this.aktualisiere(id, { uebernehmen: !eintrag.uebernehmen });
  }

  dialogSchliessen(): void {
    this.dialogOffen.set(false);
  }

  bestaetigenAbschluss(): void {
    this.ergebnisse.update((liste) =>
      liste.map((e) =>
        e.uebernehmen && e.status === 'vorschlag'
          ? { ...e, status: 'bestaetigt' }
          : e,
      ),
    );
    this.abgeschlossen.set(true);
    this.dialogOffen.set(false);
  }

  korrigiere(id: string, ober: string, unter: string | null): void {
    const eintrag = this.ergebnisse().find((e) => e.id === id);
    if (!eintrag) return;
    const geaendert =
      ober !== eintrag.vorschlagOberkategorie ||
      unter !== eintrag.vorschlagUnterkategorie;
    this.aktualisiere(id, {
      aktuelleOberkategorie: ober,
      aktuelleUnterkategorie: unter,
      status: geaendert ? 'korrigiert' : 'bestaetigt',
    });
  }

  bestaetige(id: string): void {
    this.aktualisiere(id, { status: 'bestaetigt' });
  }

  private aktualisiere(id: string, patch: Partial<AttributErgebnis>): void {
    this.ergebnisse.update((liste) =>
      liste.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }
}
