import 'dotenv/config';
import express from 'express';
import { healthHandler } from './health';

const app = express();

app.get('/health', (req, res) => {
  void healthHandler(req, res);
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`The Pitch — API listening on :${port} (${process.env.SYSTEM_ENV ?? 'development'})`);
});
