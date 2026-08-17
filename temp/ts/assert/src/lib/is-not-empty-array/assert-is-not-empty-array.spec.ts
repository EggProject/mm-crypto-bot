import { assertIsNotEmptyArray } from './assert-is-not-empty-array';
import { AssertIsNotEmptyArrayException } from './assert-is-not-empty-array.exception';
import { ARRAY_VALUES, NUMBER_VALUES, OBJECT_VALUES, TEST_MESSAGES } from '../test-constants';

describe('assertIsNotEmptyArray', () => {
  it('should not throw an exception when value is an array with one element and elements', () => {
    const value = ARRAY_VALUES.SINGLE_ELEMENT;
    expect(() => assertIsNotEmptyArray(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();

    const value2 = ARRAY_VALUES.SIMPLE_ARRAY;
    expect(() => assertIsNotEmptyArray(value2, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsNotEmptyArrayException when value is an empty array', () => {
    const value: number[] = [];
    const message = TEST_MESSAGES.EMPTY_ARRAY;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.EMPTY_ARRAY);
  });

  it('should throw AssertIsNotEmptyArrayException when value is not an array', () => {
    const value = TEST_MESSAGES.NOT_ARRAY;
    const message = TEST_MESSAGES.STRING_VALUE;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.STRING_VALUE);
  });

  it('should throw AssertIsNotEmptyArrayException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsNotEmptyArrayException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });

  it('should throw AssertIsNotEmptyArrayException when value is an object', () => {
    const value = OBJECT_VALUES.OBJECT_WITH_LENGTH;
    const message = TEST_MESSAGES.OBJECT_VALUE;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.OBJECT_VALUE);
  });

  it('should throw AssertIsNotEmptyArrayException when value is a number', () => {
    const value = NUMBER_VALUES.TEST_NUMBER;
    const message = TEST_MESSAGES.NUMBER_VALUE;

    expect(() => assertIsNotEmptyArray(value, message)).toThrow(AssertIsNotEmptyArrayException);
    expect(() => assertIsNotEmptyArray(value, message)).toThrow(TEST_MESSAGES.NUMBER_VALUE);
  });
});
