import { quoted, type ContentBlock } from './content-block';

/** The exact sentence from README.md. It is shown in the footer of every page. */
export const NOTICE: ContentBlock = quoted(
  'notice',
  're:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.',
  'README.md',
  'Licence',
);

/** The footer heading over the Notice (task 27). */
export const NOTICE_HEADING = 'Disclaimer Notice';
