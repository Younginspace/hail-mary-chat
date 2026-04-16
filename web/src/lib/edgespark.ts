// EdgeSpark browser client singleton.
//
// P4: used for email/password login (callsign + 通讯口令 in-narrative) and
// authenticated /api/* calls (e.g. /api/adopt-device, /api/me). Cookie
// credentials are implicit via client.api.fetch().

import { createEdgeSpark } from '@edgespark/web';
import '@edgespark/web/styles.css';

export const esClient = createEdgeSpark();
