import { assertIsNil } from './assert-is-nil';
import { AssertIsNilException } from './assert-is-nil.exception';
import {
  NUMBER_VALUES,
  STRING_VALUES,
  BOOLEAN_VALUES,
  OBJECT_VALUES,
  TEST_MESSAGES,
} from '../test-constants';

describe('assertIsNil', () => {
  it('should not throw an exception when value is null', () => {
    const value = undefined;

    expect(() => assertIsNil(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is undefined', () => {
    const value = undefined;

    expect(() => assertIsNil(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsNilException when value is a string', () => {
    const value = STRING_VALUES.NOT_NIL;
    const message = TEST_MESSAGES.STRING_VALUE;

    expect(() => assertIsNil(value, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(value, message)).toThrow(TEST_MESSAGES.STRING_VALUE);
  });

  it('should throw AssertIsNilException when value is a number', () => {
    const value = NUMBER_VALUES.ZERO;
    const message = TEST_MESSAGES.NUMBER_VALUE;

    expect(() => assertIsNil(value, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(value, message)).toThrow(TEST_MESSAGES.NUMBER_VALUE);
  });

  it('should throw AssertIsNilException when value is false', () => {
    const isValue = BOOLEAN_VALUES.FALSE;
    const message = TEST_MESSAGES.BOOLEAN_VALUE;

    expect(() => assertIsNil(isValue, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(isValue, message)).toThrow(TEST_MESSAGES.BOOLEAN_VALUE);
  });

  it('should throw AssertIsNilException when value is an empty string', () => {
    const value = STRING_VALUES.EMPTY;
    const message = TEST_MESSAGES.EMPTY_ARRAY;

    expect(() => assertIsNil(value, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(value, message)).toThrow(TEST_MESSAGES.EMPTY_ARRAY);
  });

  it('should throw AssertIsNilException when value is an object', () => {
    const value = OBJECT_VALUES.SIMPLE_OBJECT;
    const message = TEST_MESSAGES.OBJECT_VALUE;

    expect(() => assertIsNil(value, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(value, message)).toThrow(TEST_MESSAGES.OBJECT_VALUE);
  });

  it('should throw AssertIsNilException when value is an string array', () => {
    const value = [] as string[];
    const message = TEST_MESSAGES.ARRAY_VALUE;

    expect(() => assertIsNil(value, message)).toThrow(AssertIsNilException);
    expect(() => assertIsNil(value, message)).toThrow(TEST_MESSAGES.ARRAY_VALUE);
  });
});
