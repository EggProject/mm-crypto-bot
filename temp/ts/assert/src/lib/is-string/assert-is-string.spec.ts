import { assertIsString } from './assert-is-string';
import { AssertIsStringException } from './assert-is-string.exception';
import {
  ARRAY_VALUES,
  BOOLEAN_VALUES,
  NUMBER_VALUES,
  OBJECT_VALUES,
  STRING_VALUES,
  TEST_MESSAGES,
} from '../test-constants';

describe('assertIsString', () => {
  it('should not throw an exception when value is a regular string', () => {
    const value = STRING_VALUES.HELLO;

    expect(() => assertIsString(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is an empty string', () => {
    const value = STRING_VALUES.EMPTY;

    expect(() => assertIsString(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is a template literal', () => {
    const value = STRING_VALUES.TEMPLATE_STRING;

    expect(() => assertIsString(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is created with String constructor', () => {
    const value = String(NUMBER_VALUES.TEST_NUMBER);

    expect(() => assertIsString(value, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsStringException when value is a number', () => {
    const value = NUMBER_VALUES.TEST_NUMBER;
    const message = TEST_MESSAGES.NUMBER_VALUE;

    expect(() => assertIsString(value, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(value, message)).toThrow(TEST_MESSAGES.NUMBER_VALUE);
  });

  it('should throw AssertIsStringException when value is a boolean', () => {
    const isValue = BOOLEAN_VALUES.TRUE;
    const message = TEST_MESSAGES.BOOLEAN_VALUE;

    expect(() => assertIsString(isValue, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(isValue, message)).toThrow(TEST_MESSAGES.BOOLEAN_VALUE);
  });

  it('should throw AssertIsStringException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsString(value, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsStringException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsString(value, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });

  it('should throw AssertIsStringException when value is an object', () => {
    const value = OBJECT_VALUES.SIMPLE_OBJECT;
    const message = TEST_MESSAGES.OBJECT_VALUE;

    expect(() => assertIsString(value, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(value, message)).toThrow(TEST_MESSAGES.OBJECT_VALUE);
  });

  it('should throw AssertIsStringException when value is an array', () => {
    const value = ARRAY_VALUES.SINGLE_ELEMENT;
    const message = TEST_MESSAGES.ARRAY_VALUE;

    expect(() => assertIsString(value, message)).toThrow(AssertIsStringException);
    expect(() => assertIsString(value, message)).toThrow(TEST_MESSAGES.ARRAY_VALUE);
  });
});
