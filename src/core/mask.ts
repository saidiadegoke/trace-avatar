/**
 * Whether typed text may be stored. One rule, applied before any text is kept.
 *
 * Always masked: passwords, payment and one-time-code fields, anything whose
 * name or id says it is secret, and anything marked [data-trace-mask].
 * Otherwise masked by default, unless the field (or an ancestor) is marked
 * [data-trace-reveal] — which is what a demo author does on purpose.
 *
 * PURE: it reads plain facts the shell collected about the field.
 */

export interface FieldFacts {
  tag: string;
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  /** [data-trace-mask] on the field or an ancestor. */
  marked: boolean;
  /** [data-trace-reveal] on the field or an ancestor. */
  revealed: boolean;
  /** inputmode, when set. */
  inputmode?: string;
  /** What the field says it is: its aria-label, placeholder and label text. */
  hint?: string;
}

const SECRET_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/i;
const SECRET_NAME = /(pass(word|wd)?|card|cvv|cvc|iban|otp|pin\b|ssn|secret|token)/i;

export function isSecret(f: FieldFacts): boolean {
  return f.type.toLowerCase() === 'password'
    || SECRET_AUTOCOMPLETE.test(f.autocomplete.trim())
    || SECRET_NAME.test(`${f.name} ${f.id}`);
}

const MONEY_AUTOCOMPLETE = /^transaction-(amount|currency)$/i;
const MONEY_WORDS = /\b(amount|price|total|fee|fees|cost|salary|budget|payment|pay|deposit|withdraw(al)?|transfer|naira|ngn|usd|eur|gbp|currency)\b|[₦$€£]/i;

/** Whether a field takes an amount of money: its autocomplete, or its name, id or label says so. */
export function isMoney(f: FieldFacts): boolean {
  if (MONEY_AUTOCOMPLETE.test(f.autocomplete.trim())) return true;
  const words = `${f.name} ${f.id} ${f.hint ?? ''}`.replace(/[_-]+/g, ' ');
  return MONEY_WORDS.test(words);
}

/**
 * `money`: amount and price fields are masked too (security's 'money' guard), whatever the default.
 */
export function shouldMask(f: FieldFacts, maskByDefault = true, money = false): boolean {
  if (isSecret(f) || f.marked) return true;
  if (money && isMoney(f) && !f.revealed) return true;
  if (f.revealed) return false;
  return maskByDefault;
}

/** What is stored for masked text: bullets of the same length (the length is all that is kept). */
export const maskText = (text: string): string => '•'.repeat(Array.from(text).length);
