import { Component, computed, inject, signal } from '@angular/core';
import { KategorieService } from '../../services/kategorie.service';

@Component({
  selector: 'app-kategorien-uebersicht',
  imports: [],
  templateUrl: './kategorien-uebersicht.html',
  styleUrl: './kategorien-uebersicht.scss',
})
export class KategorienUebersicht {
  private readonly kategorieService = inject(KategorieService);

  readonly katalog = this.kategorieService.katalog;
  readonly offen = signal<Set<string>>(new Set());
  readonly filter = signal('');

  readonly gefiltert = computed(() => {
    const term = this.filter().trim().toLowerCase();
    const kategorien = this.katalog()?.kategorien ?? [];
    if (!term) return kategorien;
    return kategorien
      .map((k) => ({
        ...k,
        attribute: k.attribute.filter(
          (a) =>
            a.toLowerCase().includes(term) ||
            k.oberkategorie.toLowerCase().includes(term),
        ),
      }))
      .filter(
        (k) =>
          k.attribute.length > 0 ||
          k.oberkategorie.toLowerCase().includes(term),
      );
  });

  readonly markiert = signal<Set<string>>(new Set());

  attributUmschalten(schluessel: string): void {
    this.markiert.update((s) => {
      const neu = new Set(s);
      if (neu.has(schluessel)) {
        neu.delete(schluessel);
      } else {
        neu.add(schluessel);
      }
      return neu;
    });
  }

  istMarkiert(schluessel: string): boolean {
    return this.markiert().has(schluessel);
  }

  umschalten(name: string): void {
    this.offen.update((s) => {
      const neu = new Set(s);
      if (neu.has(name)) {
        neu.delete(name);
      } else {
        neu.add(name);
      }
      return neu;
    });
  }

  istOffen(name: string): boolean {
    return this.offen().has(name) || !!this.filter().trim();
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
