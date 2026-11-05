import { Component, signal } from '@angular/core';
import {
  ALLOW_WRITES_SNIPPET,
  BOARD_ON_ANY_DEVICE,
  COPY_LABEL,
  HOOKS_NOTE,
  INSTALL_COMMANDS,
  KIRO_ADD_BUTTON,
  KIRO_IMPORT_INTRO,
  KIRO_IMPORT_SOURCE_NOTE,
  KIRO_UPDATE_NOTE,
  KIRO_IMPORT_STEPS,
  LIVE_MODE_INTRO,
  LIVE_MODE_STEPS,
  NODE_REQUIREMENT,
  OTHER_CLIENTS,
  OTHER_CLIENTS_NOTE,
  PLAN_ON_COMPUTER,
  clientConfig,
  commandText,
  kiroImportOptions,
  npmRelease,
} from '../../../lib/content/install';
import { SITE_LINKS, mcpServerReadmeUrl } from '../../../lib/content/links';
import { copyText } from '../../../lib/shell/copy';

@Component({
  selector: 'app-install-page',
  templateUrl: './install-page.component.html',
})
export class InstallPage {
  protected readonly planOnComputer = PLAN_ON_COMPUTER.text;
  protected readonly boardOnAnyDevice = BOARD_ON_ANY_DEVICE.text;
  protected readonly kiroAddButton = KIRO_ADD_BUTTON.text;
  protected readonly kiroListing = SITE_LINKS.kiroPowerListing;
  protected readonly importIntro = KIRO_IMPORT_INTRO.text;
  protected readonly importSteps = KIRO_IMPORT_STEPS;
  protected readonly importOptions = kiroImportOptions(SITE_LINKS);
  protected readonly importSourceNote = KIRO_IMPORT_SOURCE_NOTE.text;
  protected readonly updateNote = KIRO_UPDATE_NOTE.text;
  protected readonly hooksNote = HOOKS_NOTE.text;
  protected readonly nodeRequirement = NODE_REQUIREMENT.text;
  protected readonly npmRelease = npmRelease(SITE_LINKS).text;
  protected readonly copyLabel = COPY_LABEL;
  protected readonly otherClients = OTHER_CLIENTS.map((client) => ({
    id: client.id,
    name: client.name,
    setup: client.setup.text,
    config: clientConfig(client.shape, SITE_LINKS),
    after: client.after.text,
  }));
  protected readonly clientsNote = OTHER_CLIENTS_NOTE.text;
  protected readonly mcpServerReadme = mcpServerReadmeUrl(SITE_LINKS);
  protected readonly liveIntro = LIVE_MODE_INTRO.text;
  protected readonly liveSteps = LIVE_MODE_STEPS;
  protected readonly allowWrites = ALLOW_WRITES_SNIPPET;
  protected readonly commands = INSTALL_COMMANDS.map((command) => ({
    id: command.id,
    text: commandText(command, SITE_LINKS),
    description: command.description.text,
  }));

  /** The message for the polite live region. */
  protected readonly message = signal('');

  protected async copy(text: string): Promise<void> {
    this.message.set(await copyText(navigator.clipboard, text));
  }
}
