import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const assets = new URL('../public/assets/', import.meta.url);
mkdirSync(assets, { recursive: true });
// 80 ms of deterministic mono silence: a program-generated compatibility cue,
// not recorded material. The data header and samples are fixed byte-for-byte.
const samples = 640;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
writeFileSync(join(assets.pathname, 'generated-tone.wav'), wav);
console.log(JSON.stringify({ status: 'success', summary: 'Generated deterministic local audio placeholder.', next_actions: [], artifacts: ['public/assets/generated-tone.wav'] }));
