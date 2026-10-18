import { Component, signal } from '@angular/core';
import {
  BOARD_ON_ANY_DEVICE,
  COPY_LABEL,
  HOOKS_NOTE,
  INSTALL_COMMANDS,
  KIRO_ADD_BUTTON,
  KIRO_IMPORT_INTRO,
  KIRO_IMPORT_SOURCE_NOTE,
  KIRO_IMPORT_STEPS,
  NODE_REQUIREMENT,
  OTHER_CLIENTS,
  PLAN_ON_COMPUTER,
  commandText,
  kiroImportOptions,
} from '../../../lib/content/install';
import { SITE_LINKS } from '../../../lib/content/links';
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
  protected readonly hooksNote = HOOKS_NOTE.text;
  protected readonly nodeRequirement = NODE_REQUIREMENT.text;
  protected readonly copyLabel = COPY_LABEL;
  protected readonly otherClients = OTHER_CLIENTS;
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
