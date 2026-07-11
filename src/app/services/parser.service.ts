import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import Papa from 'papaparse';
import { ExtrahiertesAttribut } from '../models/kategorie.model';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';

@Injectable({ providedIn: 'root' })
export class ParserService {
  async parse(datei: File): Promise<ExtrahiertesAttribut[]> {
    const name = datei.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      return this.parsePdf(datei);
    }
    if (name.endsWith('.csv')) {
      return this.parseCsv(datei);
    }
    throw new Error('Nicht unterstuetztes Format. Nur PDF und CSV sind erlaubt.');
  }

  async parsePdf(datei: File): Promise<ExtrahiertesAttribut[]> {
    const buffer = await datei.arrayBuffer();
    const dokument = await pdfjsLib.getDocument({ data: buffer }).promise;
    const zeilen: string[] = [];

    for (let seite = 1; seite <= dokument.numPages; seite++) {
      const page = await dokument.getPage(seite);
      const inhalt = await page.getTextContent();
      let aktuelleZeile = '';
      let letztesY: number | null = null;

      for (const item of inhalt.items) {
        if (!('str' in item)) {
          continue;
        }
        const y = item.transform[5] as number;
        if (letztesY !== null && Math.abs(y - letztesY) > 2) {
          if (aktuelleZeile.trim()) {
            zeilen.push(aktuelleZeile.trim());
          }
          aktuelleZeile = '';
        }
        aktuelleZeile += item.str;
        letztesY = y;
      }
      if (aktuelleZeile.trim()) {
        zeilen.push(aktuelleZeile.trim());
      }
    }

    return this.zeilenZuAttributen(zeilen, datei.name);
  }

  parseCsv(datei: File): Promise<ExtrahiertesAttribut[]> {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(datei, {
        header: true,
        skipEmptyLines: true,
        complete: (ergebnis) => {
          const attribute: ExtrahiertesAttribut[] = [];
          const felder = ergebnis.meta.fields ?? [];

          for (const zeile of ergebnis.data) {
            const teile: string[] = [];
            for (const feld of felder) {
              const wert = (zeile[feld] ?? '').toString().trim();
              if (wert) {
                teile.push(felder.length > 1 ? `${feld}: ${wert}` : wert);
              }
            }
            const text = teile.join(' | ').trim();
            if (text) {
              attribute.push({ attribut: text, quelle: datei.name });
            }
          }
          resolve(attribute);
        },
        error: (fehler: Error) => reject(fehler),
      });
    });
  }

  private zeilenZuAttributen(
    zeilen: string[],
    quelle: string,
  ): ExtrahiertesAttribut[] {
    return zeilen
      .map((z) => z.replace(/\s+/g, ' ').trim())
      .filter((z) => z.length >= 3)
      .map((z) => ({ attribut: z, quelle }));
  }
}
