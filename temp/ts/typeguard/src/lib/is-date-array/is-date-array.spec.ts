import { isDateArray } from './is-date-array';
import { ARRAY_LENGTH_SMALL, ARRAY_LENGTH_MEDIUM } from '../test-constants';

describe('isDateArray', () => {
  it('should return true for valid Date array', () => {
    const dates = [new Date(), new Date()];
    expect(isDateArray(dates)).toBe(true);
  });

  it('should return false for array containing non-Date elements', () => {
    const dates = [new Date(), '2023-07-26'];
    expect(isDateArray(dates)).toBe(false);
  });

  it('should return false for non-array input', () => {
    const dates = 'not an array';
    expect(isDateArray(dates)).toBe(false);
  });

  it('should return true if length is provided and matches', () => {
    const dates = [new Date(), new Date(), new Date()];
    expect(isDateArray(dates, ARRAY_LENGTH_MEDIUM)).toBe(true);
  });

  it('should return true if length is provided and matches2', () => {
    const dates = [new Date(), undefined];
    expect(isDateArray(dates, ARRAY_LENGTH_SMALL)).toBe(false);
  });
});
