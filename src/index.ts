import express from 'express';
import { loadConfig } from './config.js';
import { SageOAuth } from './auth/oauth.js';
import { FileTokenStore } from './auth/tokenStore.js';
import { SageClient } from './sage/client.js';
import { BukiStore } from './sync/store.js';
import { SyncEngine } from './sync/engine.js';

const config = loadConfig();
const store = new FileTokenStore(config.TOKEN_STORE_PATH);
const oauth = new SageOAuth(config, store);
const client = new SageClient(config, oauth);
const buki = new BukiStore();
const engine = new SyncEngine(client, buki, { monthsBack: config.SYNC_MONTHS_BACK });

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'buki-sage-connector', highWaterMark: engine.getHighWaterMark() }));

app.get('/auth/sage', (_req, res) => {
  const { url } = oauth.buildAuthorizeUrl();
  res.redirect(url);
});

app.get('/auth/sage/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code: string; state: string };
    await oauth.exchangeCode(code, state);
    res.json({ ok: true, message: 'Sage connected. POST /sync to run the first sync.' });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/sync', async (_req, res) => {
  try {
    const result = await engine.runFullSync();
    res.json({ ok: true, result, errors: buki.errors.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/ledger', (_req, res) => {
  res.json({
    accounts: [...buki.accounts.values()],
    ledger: [...buki.ledger.values()],
    errors: buki.errors,
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => console.log(`buki-sage-connector listening on :${config.PORT}`));
}

export { app, engine, buki };
