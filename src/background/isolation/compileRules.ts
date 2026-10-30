import type { CookieJar } from 'tough-cookie';

// @types/chrome models DNR fields as TS enums, which string literals can't satisfy, and the
// enum objects don't exist in Node tests. So we model the subset we emit with literal types
// and cast once at the chrome.* boundary (see applyRules.ts).
type ResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

interface HeaderOp {
  header: string;
  operation: 'set' | 'remove';
  value?: string;
}

export interface DnrRule {
  id: number;
  priority: number;
  condition: {
    tabIds: number[];
    resourceTypes: ResourceType[];
    urlFilter?: string;
    requestDomains?: string[];
    domainType?: 'firstParty' | 'thirdParty';
  };
  action: { type: 'modifyHeaders'; requestHeaders?: HeaderOp[]; responseHeaders?: HeaderOp[] };
}

// DNR footgun: a condition with neither resourceTypes nor excludedResourceTypes matches
// everything EXCEPT main_frame. Top-level navigations are exactly where login cookies matter,
// so every rule lists types explicitly.
const ALL_TYPES: ResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];
const SUB_TYPES = ALL_TYPES.filter((t) => t !== 'main_frame');

type SameSiteContext = 'strict' | 'lax' | 'none';

// One cookie string per SameSite context, mapped onto DNR's (domainType, resourceType) axes:
// - same-site request                          -> 'strict' context (all cookies)
// - cross-site top-level navigation            -> 'lax' (OAuth redirects rely on this)
// - cross-site subresource / iframe / fetch    -> 'none' (only SameSite=None cookies)
const VARIANTS: { ctx: SameSiteContext; cond: Pick<DnrRule['condition'], 'domainType' | 'resourceTypes'> }[] = [
  { ctx: 'strict', cond: { domainType: 'firstParty', resourceTypes: ALL_TYPES } },
  { ctx: 'lax', cond: { domainType: 'thirdParty', resourceTypes: ['main_frame'] } },
  { ctx: 'none', cond: { domainType: 'thirdParty', resourceTypes: SUB_TYPES } },
];

const SCHEMES = ['https', 'http'] as const;

// A label that cannot collide with real hosts: used to ask tough-cookie "what would a
// *subdomain* of D receive?" which excludes D's host-only cookies but keeps Domain=D ones.
const SYNTH_SUB = 'gloria-subdomain-probe';

export const BASE_PRIORITY = 1;

export interface Target {
  domain: string;
  hostOnly: boolean;
  path: string;
}

function targetsOf(jar: CookieJar): Target[] {
  const seen = new Map<string, Target>();
  // serializeSync is the only *sync* way to enumerate a jar; its cookie fields are typed
  // `unknown`, so narrow them rather than trusting the shape.
  for (const c of jar.serializeSync()?.cookies ?? []) {
    if (typeof c.domain !== 'string' || !c.domain) continue;
    const path = typeof c.path === 'string' && c.path ? c.path : '/';
    const t: Target = { domain: c.domain, hostOnly: c.hostOnly === true, path };
    seen.set(`${t.hostOnly ? 'h' : 'd'}|${t.domain}|${t.path}`, t);
  }
  return [...seen.values()];
}

// More specific targets must out-prioritize less specific ones, because DNR resolves
// competing `set cookie` operations by priority. Specificity: deeper host > exact host
// over domain-wide > longer path.
export function priorityOf(t: Target): number {
  const labels = t.domain.split('.').length;
  return 10 + labels * 100 + (t.hostOnly ? 50 : 0) + Math.min(t.path.length, 49);
}

function urlFilterOf(t: Target, scheme: string): string {
  const pathPart = t.path === '/' ? '' : t.path;
  if (t.hostOnly) {
    // `^` = separator (`/`, `:`, `?`, end). Anchored, so other hosts can't match.
    return `|${scheme}://${t.domain}${pathPart || '^'}`;
  }
  // Host scoping comes from requestDomains (which includes subdomains); urlFilter only pins scheme/path.
  return pathPart ? `|${scheme}://*${pathPart}` : `|${scheme}:`;
}

function probeUrl(t: Target, scheme: string): string {
  const host = t.hostOnly ? t.domain : `${SYNTH_SUB}.${t.domain}`;
  return `${scheme}://${host}${t.path}`;
}

/**
 * Compile a container's jar into DNR session rules scoped to that container's tabs.
 * Pure (jar + ids in, rules out) so it can be unit-tested without a browser.
 * Rule IDs are taken sequentially from `idBase + 1`; caller owns the ID range.
 */
export function compileRules(
  jar: CookieJar,
  tabIds: number[],
  idBase: number,
  maxRules: number,
): { rules: DnrRule[]; truncated: boolean } {
  if (tabIds.length === 0) return { rules: [], truncated: false };
  let nextId = idBase + 1;
  const rules: DnrRule[] = [
    {
      // Base rule: never let the real cookie store leak into a container tab, and never
      // let a container response write into the real store.
      id: nextId++,
      priority: BASE_PRIORITY,
      condition: { tabIds, resourceTypes: ALL_TYPES },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'remove' }],
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
      },
    },
  ];

  // Highest priority first, so if we hit the cap we drop the least specific rules.
  const targets = targetsOf(jar).sort((a, b) => priorityOf(b) - priorityOf(a));
  let truncated = false;

  outer: for (const t of targets) {
    for (const scheme of SCHEMES) {
      const url = probeUrl(t, scheme);
      const strings = VARIANTS.map((v) => {
        try {
          return jar.getCookieStringSync(url, { sameSiteContext: v.ctx, http: true });
        } catch {
          return ''; // invalid/public-suffix domain: tough-cookie throws, treat as no cookies
        }
      });
      // Most sites don't use SameSite=Strict, so all three variants are usually identical:
      // collapse to one rule instead of three to stay far from the 5000 session-rule cap.
      const collapsed = strings.every((s) => s === strings[0]);
      const emit = collapsed
        ? [{ value: strings[0] ?? '', cond: { resourceTypes: ALL_TYPES } }]
        : VARIANTS.map((v, i) => ({ value: strings[i] ?? '', cond: v.cond }));

      for (const e of emit) {
        // Empty => nothing to send; the base rule's `remove` already covers it.
        if (!e.value) continue;
        if (rules.length >= maxRules) {
          truncated = true;
          break outer;
        }
        rules.push({
          id: nextId++,
          priority: priorityOf(t),
          condition: {
            tabIds,
            urlFilter: urlFilterOf(t, scheme),
            ...(t.hostOnly ? {} : { requestDomains: [t.domain] }),
            ...e.cond,
          },
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'cookie', operation: 'set', value: e.value }],
          },
        });
      }
    }
  }
  return { rules, truncated };
}
