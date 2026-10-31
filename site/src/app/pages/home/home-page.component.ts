import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HERO_PASS } from '../../../lib/content/hero-pass';
import { SamplePassComponent } from '../demo/sample-pass.component';
import { ACTS } from '../../../lib/content/acts';
import { METAPHOR_HEADERS, METAPHOR_ROWS } from '../../../lib/content/metaphor';
import { PRINCIPLES } from '../../../lib/content/principles';
import * as story from '../../../lib/content/story';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, SamplePassComponent],
  templateUrl: './home-page.component.html',
})
export class HomePage {
  protected readonly productName = story.PRODUCT_NAME;
  protected readonly tagline = story.TAGLINE.text;
  protected readonly intro = story.INTRO.text;
  protected readonly seatRule = story.SEAT_RULE;
  protected readonly seatRuleSource = story.SEAT_RULE_SOURCE.text;
  protected readonly mostToolsLead = story.MOST_TOOLS_LEAD.text;
  protected readonly mostToolsShow = story.MOST_TOOLS_SHOW.text;
  protected readonly compassLead = story.COMPASS_LEAD.text;
  protected readonly compassShows = story.COMPASS_SHOWS.text;
  protected readonly walkNote = story.WALK_NOTE.text;
  protected readonly firstTimerLoss = story.FIRST_TIMER_LOSS.text;
  protected readonly disclaimer = story.DISCLAIMER.text;
  protected readonly unofficial = story.UNOFFICIAL_STATEMENT.text;
  protected readonly tryIt = story.TRY_IT.text;
  protected readonly metaphorHeaders = METAPHOR_HEADERS;
  protected readonly metaphorRows = METAPHOR_ROWS;
  protected readonly acts = ACTS;
  protected readonly principles = PRINCIPLES;
  protected readonly heroPass = HERO_PASS;
}
