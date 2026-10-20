// The Compass GitHub App (compass-power task 45, Requirement P2.8). The app has only Contents: read
// and Metadata: read, so a token Compass gets from it can never change a repository. Its client ID
// is public (the device flow needs no secret), so it ships in the build. The owner registers the app
// and fills both values in; until then they are empty and the GitHub tools say GitHub scanning is not
// set up. COMPASS_GITHUB_CLIENT_ID and COMPASS_GITHUB_APP_SLUG replace them for a self-hosted app;
// the hosts Compass talks to stay fixed whatever they say.

/** The client ID of the Compass GitHub App, or empty until the owner registers it. */
export const GITHUB_APP_CLIENT_ID = '';

/** The slug in https://github.com/apps/<slug>, or empty until the owner registers the app. */
export const GITHUB_APP_SLUG = '';

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
