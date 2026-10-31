import type { ServerRoute } from '@angular/ssr';
import { RenderMode } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'demo', renderMode: RenderMode.Prerender },
  { path: 'install', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: 'about', renderMode: RenderMode.Prerender },
  { path: 'inspiration', renderMode: RenderMode.Prerender },
  { path: 'documentation', renderMode: RenderMode.Prerender },
  { path: 'disclaimer', renderMode: RenderMode.Prerender },
  { path: 'copyright', renderMode: RenderMode.Prerender },
  { path: 'terms', renderMode: RenderMode.Prerender },
  { path: 'security', renderMode: RenderMode.Prerender },
  { path: 'accessibility', renderMode: RenderMode.Prerender },
  { path: 'credits', renderMode: RenderMode.Prerender },
  { path: 'board', renderMode: RenderMode.Prerender },
];
