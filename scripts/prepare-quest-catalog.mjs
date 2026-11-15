import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const data = new URL('../site/data/', import.meta.url);
await pipeline(
  createReadStream(new URL('quest-catalog.json.gz', data)),
  createGunzip(),
  createWriteStream(new URL('quest-catalog.json', data)),
);
