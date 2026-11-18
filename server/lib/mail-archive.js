import { logger } from './logger.js';

/** Marks handled mails \Seen and moves them to the archive folder. Needs a writable lock on `folder`. Never throws. */
export async function archiveMails(client, folder, uids, archiveFolder) {
  if (!archiveFolder || folder === archiveFolder || !uids.length) return;
  try {
    await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
    await client.messageMove(uids, archiveFolder, { uid: true });
    logger.info(`[Mail] Archived ${uids.length} mail(s) from ${folder}`);
  } catch (err) {
    logger.warn(`[Mail] Archiving ${uids.length} mail(s) from ${folder} failed:`, err.message);
  }
}

export const archiveFolderFromEnv = () => (process.env.MAIL_ARCHIVE_FOLDER ?? 'Archive').trim();
