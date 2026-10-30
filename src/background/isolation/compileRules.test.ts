import { describe, expect, it } from 'vitest';
import { CookieJar, MemoryCookieStore } from 'tough-cookie';
import { BASE_PRIORITY, compileRules, type DnrRule } from './compileRules';

const newJar = () => new CookieJar(new MemoryCookieStore(), { looseMode: true });
const setRules = (rules: DnrRule[]) => rules.filter((r) => r.priority !== BASE_PRIORITY);
const valueOf = (r: DnrRule) => r.action.requestHeaders?.[0]?.value;

describe('compileRules', () => {
  it('emits nothing for a container with no tabs', () => {
    const jar = newJar();
    jar.setCookieSync('a=1', 'https://example.com/');
    expect(compileRules(jar, [], 1000, 999).rules).toEqual([]);
  });

  it('always emits a base strip rule covering main_frame', () => {
    const { rules } = compileRules(newJar(), [7], 1000, 999);
    expect(rules).toHaveLength(1);
    const [base] = rules;
    expect(base!.id).toBe(1001);
    expect(base!.condition.tabIds).toEqual([7]);
    // Regression guard for the DNR default that silently excludes main_frame.
    expect(base!.condition.resourceTypes).toContain('main_frame');
    expect(base!.action.requestHeaders).toEqual([{ header: 'cookie', operation: 'remove' }]);
    expect(base!.action.responseHeaders).toEqual([{ header: 'set-cookie', operation: 'remove' }]);
  });

  it('host-only cookies get an anchored exact-host rule', () => {
    const jar = newJar();
    jar.setCookieSync('sid=abc', 'https://github.com/');
    const [rule] = setRules(compileRules(jar, [1, 2], 0, 999).rules);
    expect(rule!.condition.urlFilter).toBe('|https://github.com^');
    expect(rule!.condition.requestDomains).toBeUndefined();
    expect(rule!.condition.tabIds).toEqual([1, 2]);
    expect(valueOf(rule!)).toBe('sid=abc');
  });

  it('Domain= cookies cover subdomains but exclude the parent host-only cookies', () => {
    const jar = newJar();
    jar.setCookieSync('host=1', 'https://example.com/');
    jar.setCookieSync('wide=2; Domain=example.com', 'https://example.com/');
    const rules = setRules(compileRules(jar, [1], 0, 999).rules);

    const exact = rules.find((r) => r.condition.urlFilter === '|https://example.com^');
    const wide = rules.find((r) => r.condition.requestDomains?.[0] === 'example.com' && r.condition.urlFilter === '|https:');
    expect(valueOf(exact!)).toContain('host=1');
    expect(valueOf(exact!)).toContain('wide=2');
    // Subdomains must NOT receive the host-only cookie.
    expect(valueOf(wide!)).toBe('wide=2');
    // Exact host must win the `set cookie` conflict on example.com itself.
    expect(exact!.priority).toBeGreaterThan(wide!.priority);
  });

  it('Secure cookies are never emitted on http rules', () => {
    const jar = newJar();
    jar.setCookieSync('s=1; Secure', 'https://example.com/');
    const rules = setRules(compileRules(jar, [1], 0, 999).rules);
    expect(rules.every((r) => r.condition.urlFilter?.startsWith('|https'))).toBe(true);
  });

  it('splits by SameSite context only when it matters', () => {
    const jar = newJar();
    jar.setCookieSync('lax=1; SameSite=Lax', 'https://a.com/');
    jar.setCookieSync('none=1; SameSite=None; Secure', 'https://a.com/');
    const rules = setRules(compileRules(jar, [1], 0, 999).rules);
    const first = rules.find((r) => r.condition.domainType === 'firstParty');
    const thirdSub = rules.find(
      (r) => r.condition.domainType === 'thirdParty' && !r.condition.resourceTypes.includes('main_frame'),
    );
    expect(valueOf(first!)).toContain('lax=1');
    expect(valueOf(thirdSub!)).toBe('none=1');
  });

  it('path-scoped cookies get a more specific, higher-priority rule', () => {
    const jar = newJar();
    jar.setCookieSync('root=1', 'https://x.com/');
    jar.setCookieSync('app=1; Path=/app', 'https://x.com/app/');
    const rules = setRules(compileRules(jar, [1], 0, 999).rules);
    const app = rules.find((r) => r.condition.urlFilter === '|https://x.com/app');
    const root = rules.find((r) => r.condition.urlFilter === '|https://x.com^');
    expect(valueOf(app!)).toContain('app=1');
    expect(valueOf(app!)).toContain('root=1');
    expect(valueOf(root!)).toBe('root=1');
    expect(app!.priority).toBeGreaterThan(root!.priority);
  });

  it('respects the rule cap and reports truncation', () => {
    const jar = newJar();
    for (let i = 0; i < 20; i++) jar.setCookieSync(`c${i}=1`, `https://h${i}.example.org/`);
    const { rules, truncated } = compileRules(jar, [1], 0, 5);
    expect(rules).toHaveLength(5);
    expect(truncated).toBe(true);
  });

  it('allocates sequential ids inside the given block', () => {
    const jar = newJar();
    jar.setCookieSync('a=1', 'https://a.com/');
    jar.setCookieSync('b=1', 'https://b.com/');
    const ids = compileRules(jar, [1], 3000, 999).rules.map((r) => r.id);
    // base + (a.com, b.com) x (https, http) — non-Secure cookies are valid on both schemes.
    expect(ids).toEqual([3001, 3002, 3003, 3004, 3005]);
  });
});
