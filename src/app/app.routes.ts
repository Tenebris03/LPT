import { Routes } from '@angular/router';
import { SeiteHome } from './components/seite-home/seite-home';
import { SeiteEinstellungen } from './components/seite-einstellungen/seite-einstellungen';

export const routes: Routes = [
  { path: '', component: SeiteHome },
  { path: 'einstellungen', component: SeiteEinstellungen },
  { path: '**', redirectTo: '' },
];
