export interface Schutzkategorie {
  oberkategorie: string;
  attribute: string[];
}

export interface Schutzkatalog {
  kategorien: Schutzkategorie[];
}

export type Ergebnisstatus = 'vorschlag' | 'bestaetigt' | 'korrigiert';

export interface AttributErgebnis {
  id: string;
  attribut: string;
  quelle: string;
  vorschlagOberkategorie: string | null;
  vorschlagUnterkategorie: string | null;
  aktuelleOberkategorie: string | null;
  aktuelleUnterkategorie: string | null;
  konfidenz: number | null;
  konfidenzOber: number | null;
  konfidenzUnter: number | null;
  status: Ergebnisstatus;
  uebernehmen: boolean;
  rohantwort?: string;
  fehler?: string;
}

export interface ExtrahiertesAttribut {
  attribut: string;
  quelle: string;
}
