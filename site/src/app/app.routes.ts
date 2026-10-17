import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Home',
    loadComponent: () => import('./pages/home/home-page.component').then((m) => m.HomePage),
  },
  {
    path: 'demo',
    title: 'Demo',
    loadComponent: () => import('./pages/demo/demo-page.component').then((m) => m.DemoPage),
  },
  {
    path: 'install',
    title: 'Install',
    loadComponent: () =>
      import('./pages/install/install-page.component').then((m) => m.InstallPage),
  },
  {
    path: 'privacy',
    title: 'Privacy',
    loadComponent: () =>
      import('./pages/privacy/privacy-page.component').then((m) => m.PrivacyPage),
  },
  {
    path: 'board',
    title: 'Board',
    loadComponent: () => import('./pages/board/board-page.component').then((m) => m.BoardPage),
  },
];
