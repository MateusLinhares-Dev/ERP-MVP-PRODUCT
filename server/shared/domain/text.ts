const DELETE = 0x7f;
const LAST_CONTROL = 0x1f;

const isControl = (code: number): boolean => code <= LAST_CONTROL || code === DELETE;

export function hasControlChars(value: string, { allowDelete = false } = {}): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= LAST_CONTROL || (!allowDelete && code === DELETE)) return true;
  }
  return false;
}

export function replaceControlChars(value: string, keep: ReadonlySet<number> = new Set()): string {
  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    result += isControl(code) && !keep.has(code) ? ' ' : char;
  }
  return result;
}

export function hasMarkup(value: string): boolean {
  return value.includes('<') || value.includes('>');
}
