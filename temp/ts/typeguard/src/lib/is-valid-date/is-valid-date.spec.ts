import { isValidDate } from './is-valid-date';
import {
  TIMESTAMP_UNIX_EPOCH,
  TIMESTAMP_EPOCH,
  TIMESTAMP_MAX_DATE,
  TIMESTAMP_MIN_DATE,
  POSITIVE_INT_SMALL,
  DATE_YEAR_2023,
  DATE_MONTH_APRIL,
  DATE_DAY_15,
} from '../test-constants';

describe('isValidDate function', () => {
  it('should return true for valid Date objects', () => {
    expect(isValidDate(new Date())).toBe(true);
    expect(isValidDate(new Date('2023-05-15'))).toBe(true);
    expect(isValidDate(new Date(DATE_YEAR_2023, DATE_MONTH_APRIL, DATE_DAY_15))).toBe(true);
    expect(isValidDate(new Date(TIMESTAMP_EPOCH))).toBe(true); // timestamp
  });

  it('should return false for invalid Date objects', () => {
    expect(isValidDate(new Date('invalid-date'))).toBe(false);
    expect(isValidDate(new Date('2023-13-45'))).toBe(false); // nemlétező hónap/nap
  });

  it('should return false for non-Date objects', () => {
    expect(isValidDate()).toBe(false);
    expect(isValidDate({})).toBe(false);
    expect(isValidDate([])).toBe(false);
    expect(isValidDate('2023-05-15')).toBe(false); // ez egy string, nem Date
    expect(isValidDate(POSITIVE_INT_SMALL)).toBe(false);
    expect(isValidDate(true)).toBe(false);
    expect(isValidDate(new Set())).toBe(false);
    expect(isValidDate(new Map())).toBe(false);
  });

  it('should work with Date objects constructed from various formats', () => {
    expect(isValidDate(new Date('May 15, 2023'))).toBe(true);
    expect(isValidDate(new Date('2023/05/15'))).toBe(true);
    expect(isValidDate(new Date('15 May 2023'))).toBe(true);
    expect(isValidDate(new Date('5/15/2023'))).toBe(true);
  });

  it('should handle edge cases', () => {
    expect(isValidDate(new Date(TIMESTAMP_UNIX_EPOCH))).toBe(true); // 1970-01-01 00:00:00 UTC
    expect(isValidDate(new Date(TIMESTAMP_MAX_DATE))).toBe(true); // Max date
    expect(isValidDate(new Date(TIMESTAMP_MIN_DATE))).toBe(true); // Min date
  });
});
