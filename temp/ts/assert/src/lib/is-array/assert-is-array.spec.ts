import { assertIsArray } from './assert-is-array';
import { AssertIsArrayException } from './assert-is-array.exception';
import { ARRAY_VALUES, NUMBER_VALUES, TEST_MESSAGES } from '../test-constants';

describe('assertIsArray', () => {
  it('should not throw an exception when value is an array', () => {
    const value = ARRAY_VALUES.SIMPLE_ARRAY;

    expect(() => assertIsArray(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsArrayException when value is not an array', () => {
    const value = TEST_MESSAGES.NOT_ARRAY;
    const message = TEST_MESSAGES.STRING_VALUE;

    expect(() => assertIsArray(value, message)).toThrow(AssertIsArrayException);
    expect(() => assertIsArray(value, message)).toThrow(TEST_MESSAGES.STRING_VALUE);
  });

  it('should throw AssertIsArrayException with custom error message', () => {
    const value = NUMBER_VALUES.TEST_NUMBER;
    const message = TEST_MESSAGES.NUMBER_VALUE;

    expect(() => assertIsArray(value, message)).toThrow(TEST_MESSAGES.NUMBER_VALUE);
  });

  it('should throw AssertIsArrayException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsArray(value, message)).toThrow(AssertIsArrayException);
    expect(() => assertIsArray(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsArrayException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsArray(value, message)).toThrow(AssertIsArrayException);
    expect(() => assertIsArray(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });
});
