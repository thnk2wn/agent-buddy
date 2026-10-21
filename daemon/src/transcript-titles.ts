import {open} from 'node:fs/promises';
import {captionText} from './task-captions.js';

const scanBudget = 2 * 1024 * 1024;
const chunkSize = 64 * 1024;
const maxRecordBytes = 64 * 1024;
interface Scan {
  identity: string;
  offset: number;
  mtimeMs: number;
  pending: Buffer;
  skipping: boolean;
  title: string;
}

// Incrementally index metadata with bounded I/O and memory. Large prompt/tool records
// are discarded, not buffered until their newline. No transcript content is persisted.
export class TranscriptTitles {
  #scans = new Map<string, Scan>();

  async read(path: string, sessionId: string): Promise<string> {
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      const identity = `${stat.dev}:${stat.ino}`;
      let scan = this.#scans.get(path);
      if (!scan || scan.identity !== identity || stat.size < scan.offset
          || (stat.size === scan.offset && stat.mtimeMs !== scan.mtimeMs)) {
        scan = {identity, offset:0, mtimeMs:stat.mtimeMs, pending:Buffer.alloc(0), skipping:false, title:''};
      }
      this.#scans.delete(path);
      this.#scans.set(path, scan);
      while (this.#scans.size > 32) this.#scans.delete(this.#scans.keys().next().value!);
      const end = Math.min(stat.size, scan.offset + scanBudget);
      const buffer = Buffer.alloc(chunkSize);
      while (scan.offset < end) {
        const {bytesRead} = await file.read(buffer, 0, Math.min(chunkSize, end - scan.offset), scan.offset);
        if (!bytesRead) break;
        scan.offset += bytesRead;
        let start = 0;
        while (start < bytesRead) {
          const newline = buffer.indexOf(10, start);
          const stop = newline >= 0 && newline < bytesRead ? newline : bytesRead;
          if (!scan.skipping) {
            if (scan.pending.length + stop - start > maxRecordBytes) {
              scan.pending = Buffer.alloc(0);
              scan.skipping = true;
            } else scan.pending = Buffer.concat([scan.pending, buffer.subarray(start, stop)]);
          }
          if (stop < bytesRead) {
            if (!scan.skipping) this.#record(scan, sessionId);
            scan.pending = Buffer.alloc(0);
            scan.skipping = false;
          }
          start = stop + 1;
        }
      }
      // A final valid JSON record need not have a newline; retain it for a later append.
      if (scan.offset === stat.size && !scan.skipping) this.#record(scan, sessionId);
      scan.mtimeMs = stat.mtimeMs;
      return scan.title;
    } finally {await file.close();}
  }

  #record(scan: Scan, sessionId: string): void {
    try {
      const row = JSON.parse(scan.pending.toString('utf8'));
      if (row?.type === 'custom-title' && row.sessionId === sessionId && typeof row.customTitle === 'string')
        scan.title = captionText(row.customTitle);
    } catch { /* Partial, oversized and non-JSON records are not title metadata. */ }
  }
}
