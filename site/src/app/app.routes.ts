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
    path: 'about',
    title: 'The Creator',
    loadComponent: () => import('./pages/about/about-page.component').then((m) => m.AboutPage),
  },
  {
    path: 'inspiration',
    title: 'The Inspiration',
    loadComponent: () =>
      import('./pages/inspiration/inspiration-page.component').then((m) => m.InspirationPage),
  },
  {
    path: 'documentation',
    title: 'Documentation',
    loadComponent: () =>
      import('./pages/documentation/documentation-page.component').then((m) => m.DocumentationPage),
  },
  {
    path: 'disclaimer',
    title: 'Disclaimer',
    loadComponent: () =>
      import('./pages/disclaimer/disclaimer-page.component').then((m) => m.DisclaimerPage),
  },
  {
    path: 'copyright',
    title: 'Copyright and licence',
    loadComponent: () =>
      import('./pages/copyright/copyright-page.component').then((m) => m.CopyrightPage),
  },
  {
    path: 'board',
    title: 'Board',
    loadComponent: () => import('./pages/board/board-page.component').then((m) => m.BoardPage),
  },
];
