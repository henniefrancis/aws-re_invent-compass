// The Compass GitHub App (compass-power task 45, Requirement P2.8). The app has only Contents: read
// and Metadata: read, so a token Compass gets from it can never change a repository. Its client ID
// is public (the device flow needs no secret), so it ships in the build. The owner registered the app
// "re:Invent Compass (unofficial)" (task 47); it has no client secret and no private key. An empty
// COMPASS_GITHUB_CLIENT_ID turns GitHub scanning off. COMPASS_GITHUB_CLIENT_ID and
// COMPASS_GITHUB_APP_SLUG replace them for a self-hosted app; the hosts Compass talks to stay fixed
// whatever they say.

/** The public client ID of the Compass GitHub App. */
export const GITHUB_APP_CLIENT_ID = 'Iv23liKdFb0y0U0QXj6N';

/** The slug in https://github.com/apps/<slug>. */
export const GITHUB_APP_SLUG = 're-invent-compass-unofficial';

const CLIENT_ID = /^[A-Za-z0-9.]{1,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The GitHub App settings in use. */
export interface GitHubAppConfig {
  clientId: string;
  /** The page where the attendee installs the app on their accounts and organisations. */
  installUrl: string | undefined;
}

/** The app settings from the build and the environment, or undefined when GitHub is not set up. */
export function readGitHubAppConfig(
  env: Readonly<Record<string, string | undefined>>,
): GitHubAppConfig | undefined {
  const clientId = env.COMPASS_GITHUB_CLIENT_ID ?? GITHUB_APP_CLIENT_ID;
  const slug = env.COMPASS_GITHUB_APP_SLUG ?? GITHUB_APP_SLUG;
  if (!CLIENT_ID.test(clientId)) {
    return undefined;
  }
  return {
    clientId,
    installUrl: SLUG.test(slug) ? `https://github.com/apps/${slug}/installations/new` : undefined,
  };
}
