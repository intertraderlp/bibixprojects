// Tiny, safe formula evaluator for Formula columns.
// Supports: + - * / %, parentheses, comparisons (< > <= >= == !=), && || !,
// ternary ?:, number/string literals, {Column name} references, and functions:
// IF, ROUND, ABS, FLOOR, CEIL, MIN, MAX, SUM, AVG, CONCAT, LEN, UPPER, LOWER.
// No eval — a hand-written tokenizer + recursive-descent parser.

type Val = number | string | boolean;

function num(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const t = String(v).trim();
  if (t === '') return 0;
  const n = Number(t);
  return isNaN(n) ? NaN : n;
}
function str(v: Val): string { return v == null ? '' : String(v); }
function truthy(v: Val): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const t = String(v).trim().toLowerCase();
  return t !== '' && t !== '0' && t !== 'false' && t !== 'no';
}
function isNumeric(v: Val): boolean {
  if (typeof v === 'number') return !isNaN(v);
  if (typeof v === 'boolean') return true;
  const t = String(v).trim();
  return t !== '' && !isNaN(Number(t));
}
function bothNumeric(a: Val, b: Val): boolean {
  return isNumeric(a) && isNumeric(b);
}
function looseEq(a: Val, b: Val): boolean {
  return bothNumeric(a, b) ? num(a) === num(b) : str(a) === str(b);
}
function compare(a: Val, b: Val, op: string): boolean {
  const n = bothNumeric(a, b);
  const x = n ? num(a) : str(a);
  const y = n ? num(b) : str(b);
  if (op === '<') return x < y;
  if (op === '>') return x > y;
  if (op === '<=') return x <= y;
  return x >= y;
}

const FUNCS: Record<string, (a: Val[]) => Val> = {
  if: a => (truthy(a[0]) ? a[1] : a[2]),
  round: a => { const d = a[1] !== undefined ? num(a[1]) : 0; const f = Math.pow(10, d); return Math.round(num(a[0]) * f) / f; },
  abs: a => Math.abs(num(a[0])),
  floor: a => Math.floor(num(a[0])),
  ceil: a => Math.ceil(num(a[0])),
  min: a => Math.min(...a.map(num)),
  max: a => Math.max(...a.map(num)),
  sum: a => a.reduce((s: number, x) => s + num(x), 0),
  avg: a => (a.length ? a.reduce((s: number, x) => s + num(x), 0) / a.length : 0),
  concat: a => a.map(str).join(''),
  len: a => str(a[0]).length,
  upper: a => str(a[0]).toUpperCase(),
  lower: a => str(a[0]).toLowerCase(),
};

type Tok = { t: 'num' | 'str' | 'ident' | 'op' | 'ref' | '(' | ')' | ','; v: string | number };

function tokenize(expr: string, resolve: (name: string) => string | null): Tok[] {
  const toks: Tok[] = [];
  const ops = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':'];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') { const j = expr.indexOf('}', i); if (j < 0) throw new Error('Unclosed {'); const raw = resolve(expr.slice(i + 1, j).trim()); toks.push({ t: 'ref', v: raw == null ? '' : raw }); i = j + 1; continue; }
    if (c === '"' || c === "'") { const j = expr.indexOf(c, i + 1); if (j < 0) throw new Error('Unclosed string'); toks.push({ t: 'str', v: expr.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < expr.length && /[0-9.]/.test(expr[j])) j++; toks.push({ t: 'num', v: Number(expr.slice(i, j)) }); i = j; continue; }
    if (/[a-zA-Z_]/.test(c)) { let j = i; while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++; toks.push({ t: 'ident', v: expr.slice(i, j) }); i = j; continue; }
    if (c === '(') { toks.push({ t: '(', v: c }); i++; continue; }
    if (c === ')') { toks.push({ t: ')', v: c }); i++; continue; }
    if (c === ',') { toks.push({ t: ',', v: c }); i++; continue; }
    const op = ops.find(o => expr.startsWith(o, i));
    if (!op) throw new Error('Unexpected "' + c + '"');
    toks.push({ t: 'op', v: op }); i += op.length;
  }
  return toks;
}

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.pos]; }
  private next() { return this.toks[this.pos++]; }
  private isOp(o: string) { const t = this.peek(); return !!t && t.t === 'op' && t.v === o; }
  private eat(t: string) { const tk = this.next(); if (!tk || tk.t !== t) throw new Error('Expected ' + t); }

  parse(): Val { const v = this.ternary(); if (this.pos < this.toks.length) throw new Error('Unexpected token'); return v; }
  private ternary(): Val { const c = this.or(); if (this.isOp('?')) { this.next(); const a = this.ternary(); if (!this.isOp(':')) throw new Error('Expected :'); this.next(); const b = this.ternary(); return truthy(c) ? a : b; } return c; }
  private or(): Val { let l = this.and(); while (this.isOp('||')) { this.next(); l = truthy(l) || truthy(this.and()); } return l; }
  private and(): Val { let l = this.eq(); while (this.isOp('&&')) { this.next(); l = truthy(l) && truthy(this.eq()); } return l; }
  private eq(): Val { let l = this.cmp(); while (this.isOp('==') || this.isOp('!=')) { const o = String(this.next().v); const r = this.cmp(); l = o === '==' ? looseEq(l, r) : !looseEq(l, r); } return l; }
  private cmp(): Val { let l = this.add(); while (this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) { const o = String(this.next().v); l = compare(l, this.add(), o); } return l; }
  private add(): Val { let l = this.mul(); while (this.isOp('+') || this.isOp('-')) { const o = String(this.next().v); const r = this.mul(); l = o === '+' ? (bothNumeric(l, r) ? num(l) + num(r) : str(l) + str(r)) : num(l) - num(r); } return l; }
  private mul(): Val { let l = this.unary(); while (this.isOp('*') || this.isOp('/') || this.isOp('%')) { const o = String(this.next().v); const r = this.unary(); l = o === '*' ? num(l) * num(r) : o === '/' ? num(l) / num(r) : num(l) % num(r); } return l; }
  private unary(): Val { if (this.isOp('-')) { this.next(); return -num(this.unary()); } if (this.isOp('!')) { this.next(); return !truthy(this.unary()); } return this.primary(); }
  private primary(): Val {
    const tk = this.peek();
    if (!tk) throw new Error('Unexpected end');
    if (tk.t === 'num' || tk.t === 'str' || tk.t === 'ref') { this.next(); return tk.v as Val; }
    if (tk.t === '(') { this.next(); const v = this.ternary(); this.eat(')'); return v; }
    if (tk.t === 'ident') {
      this.next();
      const name = String(tk.v).toLowerCase();
      if (this.peek() && this.peek().t === '(') {
        this.next();
        const args: Val[] = [];
        if (this.peek() && this.peek().t !== ')') { args.push(this.ternary()); while (this.peek() && this.peek().t === ',') { this.next(); args.push(this.ternary()); } }
        this.eat(')');
        const fn = FUNCS[name];
        if (!fn) throw new Error('Unknown function ' + name);
        return fn(args);
      }
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'pi') return Math.PI;
      throw new Error('Unknown name ' + name);
    }
    throw new Error('Unexpected token');
  }
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return '—';
  return (Math.round(n * 1e6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function evalFormula(expr: string, resolve: (name: string) => string | null): { ok: true; value: string } | { ok: false; error: string } {
  try {
    const trimmed = (expr || '').trim();
    if (!trimmed) return { ok: true, value: '' };
    const r = new Parser(tokenize(trimmed, resolve)).parse();
    if (typeof r === 'number') return { ok: true, value: isNaN(r) ? '—' : formatNumber(r) };
    if (typeof r === 'boolean') return { ok: true, value: r ? '✓' : '✗' };
    return { ok: true, value: r };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
