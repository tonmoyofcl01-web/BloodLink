import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePotentialMatches, normalizeLocation } from './service.js';

const now = new Date('2026-11-03T12:00:00.000Z');
const openRequest = (overrides = {}) => ({
  id: 'request-one', bloodGroupId: 1, division: 'North Division', district: 'River District', area: 'Central Area',
  status: 'OPEN', neededAt: new Date('2026-11-04T12:00:00.000Z'), ...overrides,
});
const donor = (id, overrides = {}) => ({
  id, bloodGroupId: 1, division: ' north   division ', district: 'RIVER DISTRICT', area: 'central area',
  availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date('2026-10-01T00:00:00.000Z'),
  user: { status: 'ACTIVE', deletedAt: null }, ...overrides,
});

function matchingDb({ request = openRequest(), donors = [], history = [], existing = [] } = {}) {
  const matches = [...existing];
  let latestInsert = [];
  const requestRow = { ...request };
  return {
    matches,
    get requestStatus() { return requestRow.status; },
    get latestInsert() { return latestInsert; },
    bloodRequest: {
      findUnique: async () => ({ ...requestRow }),
      updateMany: async ({ where, data }) => {
        if (requestRow.id !== where.id || requestRow.status !== where.status || requestRow.neededAt > where.neededAt.lte) return { count: 0 };
        Object.assign(requestRow, data);
        return { count: 1 };
      },
    },
    donorProfile: { findMany: async ({ where }) => {
      assert.equal(where.bloodGroupId, requestRow.bloodGroupId);
      assert.equal(where.availabilityStatus, 'AVAILABLE');
      assert.deepEqual(where.discoveryConsentAt, { not: null });
      assert.deepEqual(where.user, { is: { status: 'ACTIVE', deletedAt: null } });
      return donors;
    } },
    requestMatch: {
      findMany: async ({ where }) => [
        ...history,
        ...matches.filter((match) => where.donorProfileId.in.includes(match.donorProfileId)).map((match) => ({ donorProfileId: match.donorProfileId, notifiedAt: match.notifiedAt })),
      ],
      createMany: async ({ data, skipDuplicates }) => {
        latestInsert = data;
        let count = 0;
        for (const item of data) {
          if (skipDuplicates && matches.some((match) => match.requestId === item.requestId && match.donorProfileId === item.donorProfileId)) continue;
          matches.push(item);
          count += 1;
        }
        return { count };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const item of matches) if (item.requestId === where.requestId && item.matchStatus === where.matchStatus) { Object.assign(item, data); count += 1; }
        return { count };
      },
    },
  };
}

test('matching normalizes text and ranks exact area above district and division', async () => {
  const db = matchingDb({ donors: [
    donor('division-only', { district: 'Other', area: 'Other' }),
    donor('district', { area: 'Other' }),
    donor('area'),
    donor('wrong-blood-group', { bloodGroupId: 2 }),
    donor('paused', { availabilityStatus: 'PAUSED' }),
    donor('no-consent', { discoveryConsentAt: null }),
    donor('inactive', { user: { status: 'SUSPENDED', deletedAt: null } }),
    donor('other-division', { division: 'South' }),
  ] });
  const result = await generatePotentialMatches(db, 'request-one', now);
  assert.deepEqual(result, { candidates: 3, created: 3 });
  assert.deepEqual(db.latestInsert.map((match) => [match.donorProfileId, match.locationRank]), [['area', 3], ['district', 2], ['division-only', 1]]);
  assert.equal(db.latestInsert[0].rankFactors.location, 'EXACT_AREA');
  assert.equal(db.latestInsert[1].rankFactors.location, 'DISTRICT');
  assert.equal(db.latestInsert[2].rankFactors.location, 'DIVISION');
  assert.equal(db.latestInsert.every((match) => match.rankFactors.fairness && !('email' in match.rankFactors)), true);
});

test('fair rotation uses least prior contacts, oldest contact, then a deterministic request-seeded tie-break', async () => {
  const history = [
    { donorProfileId: 'contacted-more', notifiedAt: new Date('2026-10-30T00:00:00Z') },
    { donorProfileId: 'contacted-more', notifiedAt: new Date('2026-10-31T00:00:00Z') },
    { donorProfileId: 'least-oldest', notifiedAt: new Date('2026-10-01T00:00:00Z') },
    { donorProfileId: 'least-newer', notifiedAt: new Date('2026-11-01T00:00:00Z') },
  ];
  const db = matchingDb({ donors: [donor('contacted-more'), donor('least-newer'), donor('least-oldest')], history });
  const result = await generatePotentialMatches(db, 'request-one', now);
  assert.equal(result.created, 3);
  assert.deepEqual(db.latestInsert.map((match) => match.donorProfileId), ['least-oldest', 'least-newer', 'contacted-more']);
  assert.deepEqual(db.latestInsert.map((match) => match.priorNotificationCount), [1, 1, 2]);

  const tieDb = matchingDb({ donors: [donor('donor-c'), donor('donor-a'), donor('donor-b')] });
  await generatePotentialMatches(tieDb, 'request-one', now);
  const firstOrder = tieDb.latestInsert.map((match) => match.donorProfileId);
  const duplicate = await generatePotentialMatches(tieDb, 'request-one', now);
  assert.equal(duplicate.created, 0);
  assert.deepEqual(tieDb.latestInsert.map((match) => match.donorProfileId), firstOrder);
  assert.equal(tieDb.matches.length, 3);
});

test('closed requests never generate new matches and expired requests invalidate pending matches', async () => {
  const closedDb = matchingDb({ request: openRequest({ status: 'CANCELLED' }), donors: [donor('candidate')] });
  assert.deepEqual(await generatePotentialMatches(closedDb, 'request-one', now), { candidates: 0, created: 0 });
  assert.equal(closedDb.matches.length, 0);

  const expiredDb = matchingDb({
    request: openRequest({ neededAt: new Date('2026-11-03T11:00:00Z') }),
    donors: [donor('candidate')],
    existing: [{ requestId: 'request-one', donorProfileId: 'candidate', matchStatus: 'NOTIFIED', notifiedAt: new Date('2026-11-02T12:00:00Z') }],
  });
  assert.deepEqual(await generatePotentialMatches(expiredDb, 'request-one', now), { candidates: 0, created: 0 });
  assert.equal(expiredDb.requestStatus, 'EXPIRED');
  assert.equal(expiredDb.matches[0].matchStatus, 'CLOSED');
});

test('location normalization trims, collapses whitespace and ignores casing', () => {
  assert.equal(normalizeLocation('  North\t  Division  '), 'north division');
  assert.equal(normalizeLocation('RIVER district'), normalizeLocation(' river  District '));
});
