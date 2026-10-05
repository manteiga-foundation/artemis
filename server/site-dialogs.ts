// The site's dialogs (alert, confirm, prompt, leave-this-page) in the owned browser.
//
// Electron shows each one as its own native box, and nothing in Electron closes that box when the
// dialog is answered another way, until the page navigates. Playwright, attached for the recorder
// and the autopilot, used to answer every dialog by itself (Cancel, invisibly): the site got an
// answer no one gave, and the native box stayed on screen as an app-wide modal, so no click or key
// reached Artemis until someone found and clicked it. Any listener stops Playwright answering by
// itself; this is that listener.
//
// - The operator's dialogs are theirs: nothing here answers them. The native box is the dialog, as
//   in any browser, and the site waits for a person.
// - While the autopilot flies, it answers by its rule (dialogAnswer: OK, Leave, or Cancel) and is
//   told, so it moves on at once: the navigation is what closes Electron's box. (A no-op
//   same-document navigation closes it only for dialogs raised after the page loaded; a hash
//   change closes both kinds but the site would see it.)

import type { Dialog, ElectronApplication } from 'playwright';
import { dialogAnswer } from './autopilot';

const label = (type: string, answer: 'accept' | 'dismiss') => (answer === 'dismiss' ? 'Cancel' : type === 'beforeunload' ? 'Leave' : 'OK');

export function watchSiteDialogs(o: { app: ElectronApplication; flying: () => boolean; onAnswered?: (note: string) => void }): () => void {
  const context = o.app.context();
  const onDialog = async (dialog: Dialog) => {
    if (!o.flying()) return;
    const type = dialog.type();
    const answer = dialogAnswer(type);
    await (answer === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => {});
    const message = dialog.message().replace(/\s+/g, ' ').trim().slice(0, 80);
    o.onAnswered?.(`the site's ${type === 'beforeunload' ? 'leave-this-page question' : type}${message ? ` "${message}"` : ''} answered ${label(type, answer)}`);
  };
  context.on('dialog', onDialog);
  return () => {
    context.off('dialog', onDialog);
  };
}
