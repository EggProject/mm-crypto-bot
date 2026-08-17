import { assertIsNotNil } from './assert-is-not-nil';
import { AssertIsNotNilException } from './assert-is-not-nil.exception';
import { STRING_VALUES, TEST_MESSAGES } from '../test-constants';

describe('assertIsNotNil', () => {
  it('should not throw an exception when value is string', () => {
    const value = STRING_VALUES.HELLO;

    expect(() => assertIsNotNil(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsNotNilException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsNotNil(value, message)).toThrow(AssertIsNotNilException);
    expect(() => assertIsNotNil(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsNotNilException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsNotNil(value, message)).toThrow(AssertIsNotNilException);
    expect(() => assertIsNotNil(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });
});
