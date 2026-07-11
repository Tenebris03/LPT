import { Schutzkatalog } from '../models/kategorie.model';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

export interface OberAntwort {
  oberkategorie: string | null;
}

export interface UnterAntwort {
  unterkategorie: string | null;
}

/**
 * Zweistufige Prompt-Strategie:
 *  1. Oberkategorie waehlen (nur Liste der Oberkategorien im Kontext).
 *  2. Unterkategorie waehlen (nur die Unterkategorien der gewaehlten
 *     Oberkategorie im Kontext) -> Ober- und Unterkategorie passen garantiert
 *     zusammen und liefern zwei getrennte Konfidenzwerte.
 *
 * Das Modell antwortet mit der EXAKTEN Kategoriebezeichnung als Text (nicht
 * mehr mit einer Zahl), damit die Logprob-basierte Konfidenzberechnung in
 * llm.service.ts die Token der tatsaechlich generierten Kategoriebezeichnung
 * auswertet (vgl. 5.3, Konfidenzberechnung) statt der Token einer Indexzahl.
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

function aufzaehlung(items: string[]): string {
  return items.map((z) => `- ${z}`).join('\n');
}

function oberkategorienListe(katalog: Schutzkatalog): string {
  return aufzaehlung(katalog.kategorien.map((k) => k.oberkategorie));
}

function unterkategorienListe(
  katalog: Schutzkatalog,
  oberkategorie: string,
): string {
  const k = katalog.kategorien.find((x) => x.oberkategorie === oberkategorie);
  return aufzaehlung(k?.attribute ?? []);
}

/**
 * Extrahiert ein Textfeld aus der ersten JSON-Struktur im Rohtext.
 * `ausSegment` erlaubt, nur einen Teilbereich des Rohtexts zu durchsuchen
 * (z. B. den Bereich nach einem <antwort>-Marker bei CoT), damit eine im
 * Fliesstext der Begruendung erwaehnte Kategorie nicht faelschlich als
 * JSON-Treffer geparst wird.
 */
function jsonFeldAusText(
  rohtext: string,
  feld: 'oberkategorie' | 'unterkategorie',
  attribut?: string,
  stufe?: string,
): string | null {
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
    const wert = obj[feld];
    return typeof wert === 'string' && wert.trim() ? wert.trim() : null;
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

/**
 * Bei CoT steht vor der eigentlichen Antwort eine Begruendung. Damit die
 * JSON-Extraktion nicht versehentlich Text aus der Begruendung erfasst,
 * wird ausschliesslich der Bereich nach dem <antwort>-Marker durchsucht.
 * Falls der Marker fehlt (Modell haelt sich nicht an das Format), faellt
 * die Funktion auf den gesamten Rohtext zurueck.
 */
function segmentNachAntwortMarker(rohtext: string): string {
  const idx = rohtext.indexOf('<antwort>');
  if (idx === -1) {
    return rohtext;
  }
  return rohtext.slice(idx);
}

const OBER_REGELN =
  'WICHTIG:\n' +
  '- Feldname UND Beispielwert sind ausschliesslich die EINGABE. Sie sind NIEMALS selbst eine gueltige Antwort.\n' +
  '- Gib NIEMALS den Feldnamen oder den Beispielwert als "oberkategorie" zurueck.\n' +
  '- "oberkategorie" MUSS EXAKT einer der unten aufgelisteten Bezeichnungen entsprechen ' +
  '(Wort fuer Wort identisch kopiert, keine Abkuerzung, keine Umformulierung).';

const UNTER_REGELN =
  'WICHTIG:\n' +
  '- Feldname UND Beispielwert sind ausschliesslich die EINGABE. Sie sind NIEMALS selbst eine gueltige Antwort.\n' +
  '- Gib NIEMALS den Feldnamen oder den Beispielwert als "unterkategorie" zurueck.\n' +
  '- "unterkategorie" MUSS EXAKT einer der unten aufgelisteten Bezeichnungen entsprechen ' +
  '(Wort fuer Wort identisch kopiert, keine Abkuerzung, keine Umformulierung).';

function oberSystem(katalog: Schutzkatalog): string {
  return (
    'Du bist ein Assistenzsystem zur Kategorisierung schutzwuerdiger Datenfelder.\n' +
    'Du erhaeltst EIN Datenfeld (Feldname und ein Beispielwert). Waehle die EINE ' +
    'Oberkategorie aus der Liste, die dieses Datenfeld am besten beschreibt bzw. schuetzt.\n\n' +
    OBER_REGELN +
    '\n\nVerfuegbare Oberkategorien:\n' +
    oberkategorienListe(katalog) +
    '\n\nAntworte AUSSCHLIESSLICH mit JSON: ' +
    '{"oberkategorie": "<exakte Bezeichnung aus der Liste>"}. Kein weiterer Text.'
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
    '{"unterkategorie": "<exakte Bezeichnung aus der Liste>"}. Kein weiterer Text.'
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
        content: '{"oberkategorie": "Kundenstammdaten"}',
      },
      // Zweites Beispiel: klarer Katalogtreffer.
      { role: 'user', content: 'Datenfeld: Rechnungsbetrag: 149,90 EUR' },
      {
        role: 'assistant',
        content: '{"oberkategorie": "Rechnungsdaten"}',
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
        content: '{"unterkategorie": "Klartext"}',
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

/**
 * Chain-of-Thought-Strategie: Das Modell muss vor der Endantwort eine kurze
 * Begruendung in <begruendung> liefern, bevor es die JSON-Antwort in
 * <antwort> liefert. Die zweigeteilte Ausgabe ist zwingend, damit
 * llm.service.ts die Logprob-Konfidenz gezielt nur aus dem <antwort>-Block
 * lesen kann und Begruendungstoken die Konfidenz nicht verfaelschen.
 */
export class ChainOfThoughtStrategie implements PromptStrategie {
  readonly name = 'Chain-of-Thought';

  buildOberMessages(
    attribut: string,
    katalog: Schutzkatalog,
  ): ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content:
          oberSystem(katalog) +
          '\n\nDenke vor der Endantwort kurz nach: Was sagt der Feldname aus? ' +
          'Was sagt der Beispielwert aus? Welche Oberkategorien kommen infrage, ' +
          'welche passt am besten?\n\n' +
          'Gliedere die Antwort IMMER in genau zwei Bloecke mit diesen Markern:\n' +
          '<begruendung>Deine Analyse in 1-3 Saetzen.</begruendung>\n' +
          '<antwort>{"oberkategorie": "<exakte Bezeichnung aus der Liste>"}</antwort>\n' +
          'Nach </antwort> darf kein weiterer Text folgen.',
      },
      {
        role: 'user',
        content: 'Datenfeld: Kundenname: Max Mustermann',
      },
      {
        role: 'assistant',
        content:
          '<begruendung>Der Feldname "Kundenname" verweist auf Stammdaten eines ' +
          'Kunden, der Beispielwert ist ein Personenname ohne weitere ' +
          'Vertrags- oder Zahlungsangaben.</begruendung>\n' +
          '<antwort>{"oberkategorie": "Kundenstammdaten"}</antwort>',
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
      {
        role: 'system',
        content:
          unterSystem(katalog, oberkategorie) +
          '\n\nDenke vor der Endantwort kurz nach, welche Unterkategorie am ' +
          'genauesten passt.\n\n' +
          'Gliedere die Antwort IMMER in genau zwei Bloecke mit diesen Markern:\n' +
          '<begruendung>Deine Analyse in 1-3 Saetzen.</begruendung>\n' +
          '<antwort>{"unterkategorie": "<exakte Bezeichnung aus der Liste>"}</antwort>\n' +
          'Nach </antwort> darf kein weiterer Text folgen.',
      },
      {
        role: 'user',
        content:
          'Datenfeld: Kundenname: Max Mustermann\nGewaehlte Oberkategorie: Kundenstammdaten',
      },
      {
        role: 'assistant',
        content:
          '<begruendung>Der Wert "Max Mustermann" liegt als vollstaendiger, ' +
          'unveraenderter Name vor, ohne Pseudonymisierung oder Anonymisierung.' +
          '</begruendung>\n' +
          '<antwort>{"unterkategorie": "Klartext"}</antwort>',
      },
      {
        role: 'user',
        content: `Datenfeld: ${attribut}\nGewaehlte Oberkategorie: ${oberkategorie}`,
      },
    ];
  }

  parseOber(rohtext: string, attribut?: string): OberAntwort {
    return {
      oberkategorie: jsonFeldAusText(
        segmentNachAntwortMarker(rohtext),
        'oberkategorie',
        attribut,
        'Ober',
      ),
    };
  }

  parseUnter(rohtext: string, attribut?: string): UnterAntwort {
    return {
      unterkategorie: jsonFeldAusText(
        segmentNachAntwortMarker(rohtext),
        'unterkategorie',
        attribut,
        'Unter',
      ),
    };
  }
}

export const STANDARD_STRATEGIE = new FewShotStrategie();
export const VERFUEGBARE_STRATEGIEN: PromptStrategie[] = [
  new DirektStrategie(),
  new FewShotStrategie(),
  new ChainOfThoughtStrategie(),
];
