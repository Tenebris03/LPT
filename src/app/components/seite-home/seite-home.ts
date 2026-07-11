import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { KategorienUebersicht } from '../kategorien-uebersicht/kategorien-uebersicht';
import { ErgebnisDialog } from '../ergebnis-dialog/ergebnis-dialog';
import { LlmService } from '../../services/llm.service';
import { StateService } from '../../services/state.service';

@Component({
  selector: 'app-seite-home',
  imports: [RouterLink, KategorienUebersicht, ErgebnisDialog],
  templateUrl: './seite-home.html',
  styleUrl: './seite-home.scss',
})
export class SeiteHome {
  readonly llm = inject(LlmService);
  readonly state = inject(StateService);

  async onDatei(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const datei = input.files?.[0];
    if (!datei) return;
    await this.state.dateiVerarbeiten(datei);
    input.value = '';
  }

  ergebnisseOeffnen(): void {
    this.state.dialogOffen.set(true);
  }
}
