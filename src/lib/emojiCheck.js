/**
 * Validação compartilhada da Regra R1:
 * Zero emojis em `src/` usando `\p{Extended_Pictographic}` com exceções explícitas (`© ® ™`),
 * e proibição de símbolos de texto (\u2605, \u2713, \u2715) no lugar de ícones Lucide.
 *
 * Usa escapes Unicode para evitar falsos positivos na varredura de arquivo-fonte.
 */

export const ALLOWED_PICTOGRAPHIC_EXCEPTIONS = new Set([
  '\u00A9', // ©
  '\u00AE', // ®
  '\u2122', // ™
]);

const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/gu;
const FORBIDDEN_TEXT_SYMBOLS_RE = /[\u2605\u2713\u2715]/g;

export function findForbiddenEmojisOrSymbols(sourceText = '') {
  const text = String(sourceText || '');
  const violations = [];

  for (const match of text.matchAll(PICTOGRAPHIC_RE)) {
    const ch = match[0];
    if (!ALLOWED_PICTOGRAPHIC_EXCEPTIONS.has(ch)) {
      violations.push({ type: 'emoji', char: ch, index: match.index ?? 0 });
    }
  }

  for (const match of text.matchAll(FORBIDDEN_TEXT_SYMBOLS_RE)) {
    violations.push({ type: 'symbol', char: match[0], index: match.index ?? 0 });
  }

  return violations;
}

export function hasForbiddenEmojisOrSymbols(sourceText = '') {
  return findForbiddenEmojisOrSymbols(sourceText).length > 0;
}
