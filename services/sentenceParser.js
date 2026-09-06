// services/sentenceParser.js
// Token stream sentence boundary detector that segments incoming LLM tokens into complete sentences.

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr',
  'etc', 'vs', 'e.g', 'i.e', 'approx', 'no', 'vol', 'st'
]);

export class SentenceParser {
  constructor(onSentence) {
    this.onSentence = onSentence; // Callback receiving (sentence: string, index: number)
    this.buffer = '';
    this.sentenceIndex = 0;
  }

  addChunk(textChunk) {
    if (!textChunk) return;
    this.buffer += textChunk;
    this._processBuffer();
  }

  _processBuffer() {
    // Look for sentence terminators: '.', '?', '!'
    // Regex looks for punctuation followed by whitespace or end-of-string
    let searchStart = 0;

    while (searchStart < this.buffer.length) {
      const match = this.buffer.slice(searchStart).match(/([.?!])(\s+|$)/);
      if (!match) break;

      const punctIndex = searchStart + match.index;
      const punctChar = match[1];
      const matchLength = match[0].length;
      const potentialSentence = this.buffer.slice(0, punctIndex + 1).trim();

      // Check for false positives:
      // 1. Decimal number (e.g. 4.99, 3.5)
      const prevChar = punctIndex > 0 ? this.buffer[punctIndex - 1] : '';
      const nextChar = punctIndex + 1 < this.buffer.length ? this.buffer[punctIndex + 1] : '';
      const isDecimal = punctChar === '.' && /\d/.test(prevChar) && /\d/.test(nextChar);

      // 2. Abbreviation (e.g. Mr., Dr., etc.)
      const lastWordMatch = this.buffer.slice(0, punctIndex).match(/([a-zA-Z]+)$/);
      const lastWord = lastWordMatch ? lastWordMatch[1].toLowerCase() : '';
      const isAbbrev = punctChar === '.' && ABBREVIATIONS.has(lastWord);

      if (isDecimal || isAbbrev) {
        // Not a real sentence boundary, continue search after this punctuation
        searchStart = punctIndex + 1;
        continue;
      }

      // If punctuation was matched at the very end of current buffer with no trailing whitespace,
      // and it wasn't ? or !, we might want to wait a bit if more tokens might form an abbrev or decimal.
      // But if there is trailing whitespace (match[2].length > 0) or it is ? / !, it's definitely a sentence boundary.
      if (match[2].length > 0 || punctChar === '?' || punctChar === '!') {
        if (potentialSentence.length > 0) {
          this.sentenceIndex++;
          this.onSentence(potentialSentence, this.sentenceIndex);
        }
        // Slice off the emitted sentence and any following whitespace
        this.buffer = this.buffer.slice(punctIndex + matchLength).trimStart();
        searchStart = 0;
      } else {
        // Wait for more tokens to confirm boundary
        break;
      }
    }
  }

  flush() {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.sentenceIndex++;
      this.onSentence(remaining, this.sentenceIndex);
      this.buffer = '';
    }
  }
}
