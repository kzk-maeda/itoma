#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { sanitizeScreenTimeDiagnostic } from './lib/screen-time-diagnostics.mjs';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  const safe = sanitizeScreenTimeDiagnostic(entry);
  if (safe) process.stdout.write(`${JSON.stringify(safe)}\n`);
}
