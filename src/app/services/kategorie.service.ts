import { Injectable, signal } from '@angular/core';
import { Schutzkatalog, Schutzkategorie } from '../models/kategorie.model';

@Injectable({ providedIn: 'root' })
export class KategorieService {
  readonly katalog = signal<Schutzkatalog | null>(null);
  readonly geladen = signal(false);
  readonly fehler = signal<string | null>(null);

  async laden(): Promise<Schutzkatalog> {
    if (this.katalog()) {
      return this.katalog()!;
    }
    try {
      const res = await fetch('schutzkategorien.json');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const daten = (await res.json()) as Schutzkatalog;
      if (!daten || !Array.isArray(daten.kategorien)) {
        throw new Error('Ungueltige Katalogstruktur: "kategorien" fehlt.');
      }
      this.katalog.set(daten);
      this.geladen.set(true);
      return daten;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.fehler.set(msg);
      throw e;
    }
  }

  oberkategorien(): string[] {
    return (this.katalog()?.kategorien ?? []).map((k) => k.oberkategorie);
  }

  unterkategorien(oberkategorie: string): string[] {
    const k = (this.katalog()?.kategorien ?? []).find(
      (x) => x.oberkategorie === oberkategorie,
    );
    return k?.attribute ?? [];
  }

  findeOberkategorie(name: string): Schutzkategorie | undefined {
    return (this.katalog()?.kategorien ?? []).find(
      (x) => x.oberkategorie === name,
    );
  }
}
