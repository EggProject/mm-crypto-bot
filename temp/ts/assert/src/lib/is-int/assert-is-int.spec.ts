import { assertIsInt } from './assert-is-int';
import { AssertIsIntException } from './assert-is-int.exception';
import { NUMBER_VALUES, OBJECT_VALUES, TEST_MESSAGES } from '../test-constants';

describe('assertIsInt', () => {
  it('should not throw an exception when value is a positive integer', () => {
    const value = NUMBER_VALUES.POSITIVE_INT;

    expect(() => assertIsInt(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is zero', () => {
    const value = NUMBER_VALUES.ZERO;

    expect(() => assertIsInt(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is a negative integer', () => {
    const value = NUMBER_VALUES.NEGATIVE_INT;

    expect(() => assertIsInt(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsIntException when value is a float', () => {
    const value = NUMBER_VALUES.FLOAT_VALUE;
    const message = TEST_MESSAGES.FLOAT_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.FLOAT_VALUE);
  });

  it('should throw AssertIsIntException when value is NaN', () => {
    const value = NaN;
    const message = TEST_MESSAGES.NAN_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.NAN_VALUE);
  });

  it('should throw AssertIsIntException when value is Infinity', () => {
    const value = Infinity;
    const message = TEST_MESSAGES.INFINITY_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.INFINITY_VALUE);
  });

  it('should throw AssertIsIntException when value is a string', () => {
    const value = NUMBER_VALUES.STRING_NUMBER;
    const message = TEST_MESSAGES.STRING_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.STRING_VALUE);
  });

  it('should throw AssertIsIntException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsIntException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });

  it('should throw AssertIsIntException when value is an object', () => {
    const value = OBJECT_VALUES.SIMPLE_OBJECT;
    const message = TEST_MESSAGES.OBJECT_VALUE;

    expect(() => assertIsInt(value, message)).toThrow(AssertIsIntException);
    expect(() => assertIsInt(value, message)).toThrow(TEST_MESSAGES.OBJECT_VALUE);
  });
});
