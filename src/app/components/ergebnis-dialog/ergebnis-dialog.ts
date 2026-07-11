import { Component, computed, effect, inject, signal } from '@angular/core';
import { KategorieService } from '../../services/kategorie.service';
import { StateService } from '../../services/state.service';
import { AttributErgebnis } from '../../models/kategorie.model';

@Component({
  selector: 'app-ergebnis-dialog',
  imports: [],
  templateUrl: './ergebnis-dialog.html',
  styleUrl: './ergebnis-dialog.scss',
})
export class ErgebnisDialog {
  private readonly kategorieService = inject(KategorieService);
  readonly state = inject(StateService);

  readonly auswahlId = signal<string | null>(null);

  readonly ergebnisse = this.state.ergebnisse;

  readonly ausgewaehlt = computed<AttributErgebnis | null>(() => {
    const id = this.auswahlId();
    return this.ergebnisse().find((e) => e.id === id) ?? null;
  });

  readonly anzahlUebernommen = computed(
    () => this.ergebnisse().filter((e) => e.uebernehmen).length,
  );

  readonly oberkategorien = computed(() =>
    this.kategorieService.oberkategorien(),
  );

  constructor() {
    effect(() => {
      const liste = this.ergebnisse();
      if (!this.auswahlId() && liste.length) {
        this.auswahlId.set(liste[0].id);
      }
    });
  }

  waehlen(id: string): void {
    this.auswahlId.set(id);
  }

  unterFuer(ober: string | null): string[] {
    return ober ? this.kategorieService.unterkategorien(ober) : [];
  }

  onOber(e: AttributErgebnis, event: Event): void {
    const ober = (event.target as HTMLSelectElement).value;
    const ersteUnter = this.kategorieService.unterkategorien(ober)[0] ?? null;
    this.state.korrigiere(e.id, ober, ersteUnter);
  }

  onUnter(e: AttributErgebnis, event: Event): void {
    const unter = (event.target as HTMLSelectElement).value;
    this.state.korrigiere(e.id, e.aktuelleOberkategorie ?? '', unter);
  }

  toggle(e: AttributErgebnis, event: Event): void {
    event.stopPropagation();
    this.state.toggleUebernehmen(e.id);
  }

  schliessen(): void {
    this.state.dialogSchliessen();
  }

  bestaetigen(): void {
    this.state.bestaetigenAbschluss();
  }

  konfidenzKlasse(k: number | null): string {
    if (k === null) return 'k-unbekannt';
    if (k >= 0.85) return 'k-hoch';
    if (k >= 0.6) return 'k-mittel';
    return 'k-niedrig';
  }

  konfidenzText(k: number | null): string {
    return k === null ? '—' : `${(k * 100).toFixed(1)} %`;
  }
}
