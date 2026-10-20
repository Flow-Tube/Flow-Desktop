/**
 * Continuation paging for the Home discover feed's search queries.
 *
 * Every discover query is a YouTube search. Re-running one without its
 * continuation token returns page one again, which is all session-seen after
 * the first pass, so the feed stalled once each query had been used once.
 * Each query here remembers the token for its next page, and the query set is
 * only regenerated once every query has run out of pages.
 */

export interface DiscoveryPaging {
  /** Bumped on every reset so results from a request started before it are dropped. */
  epoch: number;
  queries: string[];
  cursor: number;
  /** Absent: page one not fetched yet. `null`: the query has no further pages. */
  tokens: ReadonlyMap<string, string | null>;
}

export interface DiscoveryRequest {
  query: string;
  pageToken?: string;
}

export interface DiscoveryPageResult {
  query: string;
  nextPageToken?: string | null;
}

/*
  Consecutive load-more attempts that appended nothing, with no query pages
  left, before the feed reports its end. More than one because the
  subscription and related lanes are not paged and can still produce new
  videos after discovery runs dry; a single empty round is not proof of the end.
*/
export const END_OF_FEED_MISSES = 3;

const uniqueQueries = (queries: string[]) =>
  [...new Set(queries.map((query) => query.trim()).filter((query) => query.length > 0))];

export const createDiscoveryPaging = (): DiscoveryPaging => ({
  epoch: 0,
  queries: [],
  cursor: 0,
  tokens: new Map(),
});

export const resetDiscoveryPaging = (
  paging: DiscoveryPaging,
  queries: string[],
  cursor = 0,
): DiscoveryPaging => ({
  epoch: paging.epoch + 1,
  queries: uniqueQueries(queries),
  cursor,
  tokens: new Map(),
});

/**
 * Swaps in a regenerated query set. Tokens are kept, so a query that comes back
 * after it already ran out of pages stays exhausted instead of replaying page one.
 */
export const withDiscoveryQueries = (
  paging: DiscoveryPaging,
  queries: string[],
): DiscoveryPaging => ({
  ...paging,
  queries: uniqueQueries(queries),
  cursor: 0,
});

export const hasDiscoveryPagesLeft = (paging: DiscoveryPaging) =>
  paging.queries.some((query) => paging.tokens.get(query) !== null);

/** Picks up to `count` distinct queries that still have pages, round-robin from the cursor. */
export const takeDiscoveryRequests = (
  paging: DiscoveryPaging,
  count: number,
): { requests: DiscoveryRequest[]; paging: DiscoveryPaging } => {
  const { queries } = paging;
  const requests: DiscoveryRequest[] = [];
  let cursor = paging.cursor;

  for (let offset = 0; offset < queries.length && requests.length < count; offset += 1) {
    const index = (paging.cursor + offset) % queries.length;
    const query = queries[index];
    const token = query === undefined ? null : paging.tokens.get(query);
    if (query === undefined || token === null) continue;
    requests.push(token === undefined ? { query } : { query, pageToken: token });
    cursor = (index + 1) % queries.length;
  }

  return { requests, paging: { ...paging, cursor } };
};

export const recordDiscoveryPages = (
  paging: DiscoveryPaging,
  epoch: number,
  results: DiscoveryPageResult[],
): DiscoveryPaging => {
  if (epoch !== paging.epoch || results.length === 0) {
    return paging;
  }

  const tokens = new Map(paging.tokens);
  for (const { query, nextPageToken } of results) {
    tokens.set(query, nextPageToken || null);
  }
  return { ...paging, tokens };
};

export const isDiscoverFeedExhausted = (paging: DiscoveryPaging, consecutiveMisses: number) =>
  !hasDiscoveryPagesLeft(paging) && consecutiveMisses >= END_OF_FEED_MISSES;
