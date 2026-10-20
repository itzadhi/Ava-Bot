import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateItems, createPaginationRow } from '../src/ui/pagination.js';

test('paginateItems correctly calculates pages, offsets, and readable summaries', () => {
  const items = Array.from({ length: 23 }, (_, i) => `Item ${i + 1}`);

  // Page 1 of 5 (limit 5)
  const page1 = paginateItems(items, { page: 1, limit: 5 });
  assert.equal(page1.page, 1);
  assert.equal(page1.totalPages, 5);
  assert.equal(page1.totalItems, 23);
  assert.equal(page1.slice.length, 5);
  assert.equal(page1.startIdx, 1);
  assert.equal(page1.endIdx, 5);
  assert.equal(page1.summaryText, 'Showing 1–5 of 23');
  assert.equal(page1.pageLabel, 'Page 1 of 5');

  // Page 5 of 5 (last page with remainder)
  const page5 = paginateItems(items, { page: 5, limit: 5 });
  assert.equal(page5.page, 5);
  assert.equal(page5.slice.length, 3);
  assert.equal(page5.startIdx, 21);
  assert.equal(page5.endIdx, 23);
  assert.equal(page5.summaryText, 'Showing 21–23 of 23');

  // Page clamping: out of range page numbers
  const clampedHigh = paginateItems(items, { page: 99, limit: 5 });
  assert.equal(clampedHigh.page, 5);

  const clampedLow = paginateItems(items, { page: -5, limit: 5 });
  assert.equal(clampedLow.page, 1);

  // Empty items edge case
  const empty = paginateItems([], { page: 1, limit: 5 });
  assert.equal(empty.page, 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.totalItems, 0);
  assert.equal(empty.slice.length, 0);
  assert.equal(empty.startIdx, 0);
  assert.equal(empty.endIdx, 0);
  assert.equal(empty.summaryText, 'Showing 0 results');
});

test('createPaginationRow produces compliant 5-button Discord ActionRowBuilder', () => {
  const row = createPaginationRow({
    customIdPrefix: 'test_page_123',
    page: 2,
    totalPages: 5
  });

  const json = row.toJSON();
  assert.equal(json.type, 1, 'Must be an ActionRow');
  assert.equal(json.components.length, 5, 'Must have 5 buttons: First, Prev, Indicator, Next, Last');

  const [firstBtn, prevBtn, indicatorBtn, nextBtn, lastBtn] = json.components;

  assert.equal(firstBtn.custom_id, 'test_page_123:first:1');
  assert.equal(firstBtn.disabled, false);

  assert.equal(prevBtn.custom_id, 'test_page_123:prev:1');
  assert.equal(prevBtn.disabled, false);

  assert.equal(indicatorBtn.disabled, true);
  assert.equal(indicatorBtn.label, '‹ 2 / 5 ›');

  assert.equal(nextBtn.custom_id, 'test_page_123:next:3');
  assert.equal(nextBtn.disabled, false);

  assert.equal(lastBtn.custom_id, 'test_page_123:last:5');
  assert.equal(lastBtn.disabled, false);
});

test('createPaginationRow disables Prev on page 1 and Next on last page', () => {
  const page1Row = createPaginationRow({
    customIdPrefix: 'test_page_123',
    page: 1,
    totalPages: 3
  }).toJSON();

  assert.equal(page1Row.components[0].disabled, true, 'First button disabled on page 1');
  assert.equal(page1Row.components[1].disabled, true, 'Prev button disabled on page 1');
  assert.equal(page1Row.components[3].disabled, false, 'Next button enabled on page 1');
  assert.equal(page1Row.components[4].disabled, false, 'Last button enabled on page 1');

  const page3Row = createPaginationRow({
    customIdPrefix: 'test_page_123',
    page: 3,
    totalPages: 3
  }).toJSON();

  assert.equal(page3Row.components[0].disabled, false, 'First button enabled on page 3');
  assert.equal(page3Row.components[1].disabled, false, 'Prev button enabled on page 3');
  assert.equal(page3Row.components[3].disabled, true, 'Next button disabled on page 3');
  assert.equal(page3Row.components[4].disabled, true, 'Last button disabled on page 3');
});
