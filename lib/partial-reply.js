// Reads the DM's reply while it is still being written. The reply is one JSON object, { "rolls": [strings], "voiceLines": [{speaker, voice, text}], "mapUpdates": [...] } (in that order);
// push() takes the next piece of text and returns what is complete now: each roll line and each voice line, in order, as soon as its closing quote or brace has arrived.
// That lets the table print the rolls and speak the first line while the model is still writing the rest (the pattern voice agents use: start speech when the spoken field closes).
// It only looks at the two arrays it can use early; everything after is read from the finished reply.
export class ReplyStreamer {
  constructor() { this.buf = ''; this.pos = 0; this.mode = 'seek'; this.rolls = 0; this.lines = 0; }

  push(chunk) {
    this.buf += chunk;
    const out = [];
    for (;;) {
      if (this.mode === 'seek') {
        const rest = this.buf.slice(this.pos);
        const rolls = /"rolls"\s*:\s*\[/.exec(rest), lines = /"voiceLines"\s*:\s*\[/.exec(rest);
        if (rolls && (!lines || rolls.index < lines.index)) { this.pos += rolls.index + rolls[0].length; this.mode = 'rolls'; continue; }
        if (lines) { this.pos += lines.index + lines[0].length; this.mode = 'lines'; continue; }
        // nothing to find yet: keep a short tail in case a key is split across chunks
        this.pos = Math.max(this.pos, this.buf.length - 24);
        return out;
      }
      // inside an array: skip spaces and commas, end at the closing bracket, then read one element
      let i = this.pos;
      while (i < this.buf.length && /[\s,]/.test(this.buf[i])) i++;
      if (i >= this.buf.length) { this.pos = i; return out; }
      if (this.buf[i] === ']') { this.pos = i + 1; this.mode = 'seek'; continue; }
      const end = this.mode === 'rolls' ? stringEnd(this.buf, i) : objectEnd(this.buf, i);
      if (end < 0) { this.pos = i; return out; }                    // the element is not complete yet
      const text = this.buf.slice(i, end);
      this.pos = end;
      let value; try { value = JSON.parse(text); } catch { this.mode = 'seek'; continue; }
      if (this.mode === 'rolls') { if (typeof value === 'string' && value.trim()) out.push({ type: 'roll', index: this.rolls++, text: value.trim() }); }
      else if (value && typeof value === 'object') out.push({ type: 'line', index: this.lines++, line: value });
    }
  }
}

// Index just after the string that starts at i (a double quote), or -1 when it is not finished.
function stringEnd(s, i) {
  if (s[i] !== '"') return -1;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '"') return j + 1;
  }
  return -1;
}
// Index just after the object that starts at i (an opening brace), or -1 when it is not finished.
function objectEnd(s, i) {
  if (s[i] !== '{') return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"') { const e = stringEnd(s, j); if (e < 0) return -1; j = e - 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}
