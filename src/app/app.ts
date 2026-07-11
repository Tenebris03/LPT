import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { KategorieService } from './services/kategorie.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly kategorieService = inject(KategorieService);
  protected readonly title = signal('Listenprüftool');

  async ngOnInit(): Promise<void> {
    try {
      await this.kategorieService.laden();
    } catch {
      // Fehler wird im Service-Signal gehalten und in der UI angezeigt.
    }
  }
}
