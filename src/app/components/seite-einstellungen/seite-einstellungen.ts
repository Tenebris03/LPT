import { Component, inject, signal } from '@angular/core';
import { LlmService, MODELL_OPTIONEN, ModellOption } from '../../services/llm.service';
import { StateService } from '../../services/state.service';
import {
  DirektStrategie,
  FewShotStrategie,
  PromptStrategie,
} from '../../services/prompt-strategie';

@Component({
  selector: 'app-seite-einstellungen',
  imports: [],
  templateUrl: './seite-einstellungen.html',
  styleUrl: './seite-einstellungen.scss',
})
export class SeiteEinstellungen {
  readonly llm = inject(LlmService);
  readonly state = inject(StateService);

  readonly modellLaedt = signal(false);
  readonly modellFehler = signal<string | null>(null);

  readonly modelle: ModellOption[] = MODELL_OPTIONEN;
  readonly ausgewaehltesModell = signal<string>(this.llm.aktivesModell());

  readonly strategien: PromptStrategie[] = [
    new DirektStrategie(),
    new FewShotStrategie(),
  ];

  modellWaehlen(event: Event): void {
    this.ausgewaehltesModell.set((event.target as HTMLSelectElement).value);
  }

  async modellLaden(): Promise<void> {
    this.modellFehler.set(null);
    this.modellLaedt.set(true);
    try {
      await this.llm.initialisieren(this.ausgewaehltesModell());
    } catch (e) {
      this.modellFehler.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.modellLaedt.set(false);
    }
  }

  strategieWaehlen(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    const s = this.strategien.find((x) => x.name === name);
    if (s) this.state.strategie.set(s);
  }
}
