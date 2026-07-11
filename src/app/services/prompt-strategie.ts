import { Schutzkatalog } from '../models/kategorie.model';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

export interface OberAntwort {
  oberkategorie: string | number | null;
}

export interface UnterAntwort {
  unterkategorie: string | number | null;
}

/**
 * Zweistufige Prompt-Strategie:
 *  1. Oberkategorie waehlen (nur Liste der Oberkategorien im Kontext).
 *  2. Unterkategorie waehlen (nur die Unterkategorien der gewaehlten
 *     Oberkategorie im Kontext) -> Ober- und Unterkategorie passen garantiert
 *     zusammen und liefern zwei getrennte Konfidenzwerte.
 */
export interface PromptStrategie {
  readonly name: string;
  buildOberMessages(
    attribut: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[];
  buildUnterMessages(
    attribut: string,
    oberkategorie: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[];
  parseOber(rohtext: string, attribut?: string): OberAntwort;
  parseUnter(rohtext: string, attribut?: string): UnterAntwort;
}

function nummeriert(items: string[]): string {
  return items.map((z, i) => `${i + 1}. ${z}`).join('\n');
}

function oberkategorienListe(katalog: Schutzkatalog): string {
  return nummeriert(katalog.kategorien.map((k) => k.oberkategorie));
}

function unterkategorienListe(
  katalog: Schutzkatalog,
  oberkategorie: string,
): string {
  const k = katalog.kategorien.find((x) => x.oberkategorie === oberkategorie);
  return nummeriert(k?.attribute ?? []);
}

function oberIndex(katalog: Schutzkatalog, name: string): number {
  return katalog.kategorien.findIndex((k) => k.oberkategorie === name) + 1;
}

function unterIndex(
  katalog: Schutzkatalog,
  oberkategorie: string,
  name: string,
): number {
  const k = katalog.kategorien.find((x) => x.oberkategorie === oberkategorie);
  return k ? k.attribute.indexOf(name) + 1 : 0;
}

function jsonFeldAusText(
  rohtext: string,
  feld: 'oberkategorie' | 'unterkategorie',
  attribut?: string,
  stufe?: string,
): string | number | null {
  const praefix = `[${attribut ?? '?'}]${stufe ? '[' + stufe + ']' : ''}`;
  const treffer = rohtext.match(/\{[\s\S]*\}/);
  if (!treffer) {
    console.warn(
      `${praefix} Kein JSON-Objekt in der Rohantwort gefunden. Rohantwort:`,
      rohtext,
    );
    return null;
  }
  try {
    const obj = JSON.parse(treffer[0]);
    return obj[feld] ?? null;
  } catch (e) {
    console.error(
      `${praefix} Fehler beim JSON-Parsen:`,
      e instanceof Error ? e.message : String(e),
      '| Zu parsender String:',
      treffer[0],
      '| Vollständige Rohantwort:',
      rohtext,
    );
    return null;
  }
}

const OBER_REGELN =
  'WICHTIG:\n' +
  '- Feldname UND Beispielwert sind ausschliesslich die EINGABE. Sie sind NIEMALS selbst eine gueltige Antwort.\n' +
  '- Gib NIEMALS den Feldnamen oder den Beispielwert als "oberkategorie" zurueck.\n' +
  '- "oberkategorie" MUSS eine der NUMMERN (1, 2, 3, ...) aus der unten aufgelisteten Oberkategorien sein.';

const UNTER_REGELN =
  'WICHTIG:\n' +
  '- Feldname UND Beispielwert sind ausschliesslich die EINGABE. Sie sind NIEMALS selbst eine gueltige Antwort.\n' +
  '- Gib NIEMALS den Feldnamen oder den Beispielwert als "unterkategorie" zurueck.\n' +
  '- "unterkategorie" MUSS eine der NUMMERN (1, 2, 3, ...) aus der unten aufgelisteten Unterkategorien sein.';

function oberSystem(katalog: Schutzkatalog): string {
  return (
    'Du bist ein Assistenzsystem zur Kategorisierung schutzwuerdiger Datenfelder.\n' +
    'Du erhaeltst EIN Datenfeld (Feldname und ein Beispielwert). Waehle die EINE ' +
    'Oberkategorie aus der Liste, die dieses Datenfeld am besten beschreibt bzw. schuetzt.\n\n' +
    OBER_REGELN +
    '\n\nVerfuegbare Oberkategorien:\n' +
    oberkategorienListe(katalog) +
    '\n\nAntworte AUSSCHLIESSLICH mit JSON: ' +
    '{"oberkategorie": "<Nummer aus der Liste>"}. Kein weiterer Text.'
  );
}

function unterSystem(katalog: Schutzkatalog, oberkategorie: string): string {
  return (
    'Du bist ein Assistenzsystem zur Kategorisierung schutzwuerdiger Datenfelder.\n' +
    `Die Oberkategorie "${oberkategorie}" wurde bereits gewaehlt. Waehle jetzt die EINE ` +
    'Unterkategorie aus der Liste, die zum Datenfeld passt.\n\n' +
    UNTER_REGELN +
    `\n\nUnterkategorien von "${oberkategorie}":\n` +
    unterkategorienListe(katalog, oberkategorie) +
    '\n\nAntworte AUSSCHLIESSLICH mit JSON: ' +
    '{"unterkategorie": "<Nummer aus der Liste>"}. Kein weiterer Text.'
  );
}

/**
 * Direkte Strategie: klare Trennung Eingabe/Ziel, aber ohne Few-Shot-Beispiele.
 */
export class DirektStrategie implements PromptStrategie {
  readonly name = 'Direkt';

  buildOberMessages(
    attribut: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: oberSystem(katalog) },
      { role: 'user', content: `Datenfeld: ${attribut}` },
    ];
  }

  buildUnterMessages(
    attribut: string,
    oberkategorie: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: unterSystem(katalog, oberkategorie) },
      {
        role: 'user',
        content: `Datenfeld: ${attribut}\nGewaehlte Oberkategorie: ${oberkategorie}`,
      },
    ];
  }

  parseOber(rohtext: string, attribut?: string): OberAntwort {
    return {
      oberkategorie: jsonFeldAusText(rohtext, 'oberkategorie', attribut, 'Ober'),
    };
  }

  parseUnter(rohtext: string, attribut?: string): UnterAntwort {
    return {
      unterkategorie: jsonFeldAusText(
        rohtext,
        'unterkategorie',
        attribut,
        'Unter',
      ),
    };
  }
}

/**
 * Few-Shot-Strategie: enthaelt Beispiele, die gezielt das "Zurueckspiegeln"
 * von Feldname/Wert in die Ausgabefelder verhindern (z. B. Kundenname/Max
 * Mustermann -> Kundenstammdaten, NICHT Max Mustermann/Kundenname).
 */
export class FewShotStrategie implements PromptStrategie {
  readonly name = 'Few-Shot';

  buildOberMessages(
    attribut: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: oberSystem(katalog) },
      // Anti-Spiegel-Beispiel: Eingabe klingt selbst fast wie Kategorien.
      { role: 'user', content: 'Datenfeld: Kundenname: Max Mustermann' },
      {
        role: 'assistant',
        content: `{"oberkategorie": "${oberIndex(katalog, 'Kundenstammdaten')}"}`,
      },
      // Zweites Beispiel: klarer Katalogtreffer.
      { role: 'user', content: 'Datenfeld: Rechnungsbetrag: 149,90 EUR' },
      {
        role: 'assistant',
        content: `{"oberkategorie": "${oberIndex(katalog, 'Rechnungsdaten')}"}`,
      },
      { role: 'user', content: `Datenfeld: ${attribut}` },
    ];
  }

  buildUnterMessages(
    attribut: string,
    oberkategorie: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: unterSystem(katalog, oberkategorie) },
      {
        role: 'user',
        content:
          'Datenfeld: Kundenname: Max Mustermann\nGewaehlte Oberkategorie: Kundenstammdaten',
      },
      {
        role: 'assistant',
        content: `{"unterkategorie": "${unterIndex(katalog, 'Kundenstammdaten', 'Klartext')}"}`,
      },
      {
        role: 'user',
        content: `Datenfeld: ${attribut}\nGewaehlte Oberkategorie: ${oberkategorie}`,
      },
    ];
  }

  parseOber(rohtext: string, attribut?: string): OberAntwort {
    return {
      oberkategorie: jsonFeldAusText(rohtext, 'oberkategorie', attribut, 'Ober'),
    };
  }

  parseUnter(rohtext: string, attribut?: string): UnterAntwort {
    return {
      unterkategorie: jsonFeldAusText(
        rohtext,
        'unterkategorie',
        attribut,
        'Unter',
      ),
    };
  }
}

export const STANDARD_STRATEGIE = new FewShotStrategie();
