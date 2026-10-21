// Experimental presentation model shared by the device-caption lab and future daemon integration.
// Keep the serial contract unchanged: at most two lines, eighteen ASCII characters per line.
export const captionWidth = 18;
export const maxCaptionInput = 512;
export type CaptionMode = 'pages' | 'ticker' | 'truncate';
export interface CaptionContext {status: string; project: string; title: string}
export interface CaptionCard {kind: 'context' | 'title'; lines: string[]; durationMs: number}
export interface CaptionFrame extends CaptionCard {index: number; count: number; progress: number}

export function captionText(value: string): string {
  return value.slice(0, maxCaptionInput).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ,.:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Preserve every supported character, even identifiers longer than a line.
export function wrapCaption(value: string): string[] {
  const words = captionText(value).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let word of words) {
    if (line && line.length + 1 + word.length > captionWidth) {lines.push(line); line = '';}
    while (word.length > captionWidth) {
      lines.push(word.slice(0, captionWidth)); word = word.slice(captionWidth);
    }
    if (word) line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function captionCards(context: CaptionContext): CaptionCard[] {
  const cards: CaptionCard[] = [];
  const status = wrapCaption(context.status || 'Working');
  const project = wrapCaption(context.project);
  // Status and project may themselves be long: page them instead of silently truncating.
  const heading = [...status, ...project];
  for (let i = 0; i < heading.length; i += 2)
    cards.push({kind: 'context', lines: heading.slice(i, i + 2), durationMs: 3000});
  const title = wrapCaption(context.title);
  for (let i = 0; i < title.length; i += 2)
    cards.push({kind: 'title', lines: title.slice(i, i + 2), durationMs: 5000});
  return cards.length ? cards : [{kind: 'context', lines: ['Ready'], durationMs: 3000}];
}

export function captionFrame(context: CaptionContext, elapsedMs: number, mode: CaptionMode = 'pages'): CaptionFrame {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const cards = captionCards(context);
  if (mode === 'truncate') {
    return {kind: 'title', lines: [captionText(context.status).slice(0, captionWidth),
      captionText(context.title).slice(0, captionWidth)].filter(Boolean), durationMs: 0, index: 0, count: 1, progress: 0};
  }
  if (mode === 'ticker') {
    const text = captionText(context.title || context.project);
    const last = Math.max(0, text.length - captionWidth);
    // Pause at each end. Character steps reflect what the existing serial protocol can do.
    const duration = last ? 4000 + last * 350 : 5000;
    const phase = elapsed % duration;
    const offset = Math.min(last, Math.max(0, Math.floor((phase - 2000) / 350)));
    return {kind: 'title', lines: [captionText(context.status).slice(0, captionWidth),
      text.slice(offset, offset + captionWidth)].filter(Boolean), durationMs: duration,
      index: 0, count: 1, progress: phase / duration};
  }
  const cycle = cards.reduce((sum, c) => sum + c.durationMs, 0);
  let remaining = elapsed % cycle;
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!;
    if (remaining < card.durationMs) return {...card, index, count: cards.length, progress: remaining / card.durationMs};
    remaining -= card.durationMs;
  }
  throw new Error('Caption cycle has no frame');
}

// Repeated tool activity must not restart a title before somebody can finish reading it.
export class CaptionPlayback {
  #key = '';
  #startedAt = 0;
  frame(context: CaptionContext, nowMs: number, mode: CaptionMode = 'pages'): CaptionFrame {
    const key = JSON.stringify([context.status, context.project, context.title, mode]);
    if (key !== this.#key || nowMs < this.#startedAt) {this.#key = key; this.#startedAt = nowMs;}
    return captionFrame(context, nowMs - this.#startedAt, mode);
  }
}

// Hooks do not consistently include the UI's conversation title. Never substitute a prompt,
// command, tool input, or a transcript path and imply it is the title.
export function captionContextFromHook(payload: Record<string, unknown>): {project: string; title: string} {
  const text = (...keys: string[]): string => {
    for (const key of keys) if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key] as string;
    return '';
  };
  const cwd = text('cwd').replace(/[\\/]+$/, '');
  return {project: captionText(text('projectName', 'project_name') || cwd.split(/[\\/]/).pop() || ''),
    title: captionText(text('sessionTitle', 'session_title', 'threadTitle', 'thread_title'))};
}
