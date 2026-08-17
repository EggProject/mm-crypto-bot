import { assertIsFunction } from './assert-is-function';
import { AssertIsFunctionException } from './assert-is-function.exception';
import { NUMBER_VALUES, OBJECT_VALUES, ARRAY_VALUES, TEST_MESSAGES } from '../test-constants';

function regularFunction(): void {
  /* empty */
}

const arrowFunction = (): void => {
  /* empty */
};

const asyncFunction = async (): Promise<void> => {
  /* empty */
};

describe('assertIsFunction', () => {
  it('should not throw an exception when value is a regular function', () => {
    expect(() => assertIsFunction(regularFunction, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is an arrow function', () => {
    expect(() => assertIsFunction(arrowFunction, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is an async function', () => {
    expect(() => assertIsFunction(asyncFunction, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should not throw an exception when value is a class constructor', () => {
    class TestClass {}

    expect(() => assertIsFunction(TestClass, TEST_MESSAGES.TEST_MESSAGE)).not.toThrow();
  });

  it('should throw AssertIsFunctionException when value is a string', () => {
    const value = TEST_MESSAGES.NOT_FUNCTION;
    const message = TEST_MESSAGES.STRING_VALUE;

    expect(() => assertIsFunction(value, message)).toThrow(AssertIsFunctionException);
    expect(() => assertIsFunction(value, message)).toThrow(TEST_MESSAGES.STRING_VALUE);
  });

  it('should throw AssertIsFunctionException when value is a number', () => {
    const value = NUMBER_VALUES.TEST_NUMBER;
    const message = TEST_MESSAGES.NUMBER_VALUE;

    expect(() => assertIsFunction(value, message)).toThrow(AssertIsFunctionException);
    expect(() => assertIsFunction(value, message)).toThrow(TEST_MESSAGES.NUMBER_VALUE);
  });

  it('should throw AssertIsFunctionException when value is an object', () => {
    const value = OBJECT_VALUES.SIMPLE_OBJECT;
    const message = TEST_MESSAGES.OBJECT_VALUE;

    expect(() => assertIsFunction(value, message)).toThrow(AssertIsFunctionException);
    expect(() => assertIsFunction(value, message)).toThrow(TEST_MESSAGES.OBJECT_VALUE);
  });

  it('should throw AssertIsFunctionException when value is null', () => {
    const value = undefined;
    const message = TEST_MESSAGES.NULL_VALUE;

    expect(() => assertIsFunction(value, message)).toThrow(AssertIsFunctionException);
    expect(() => assertIsFunction(value, message)).toThrow(TEST_MESSAGES.NULL_VALUE);
  });

  it('should throw AssertIsFunctionException when value is undefined', () => {
    const value = undefined;
    const message = TEST_MESSAGES.UNDEFINED_VALUE;

    expect(() => assertIsFunction(value, message)).toThrow(AssertIsFunctionException);
    expect(() => assertIsFunction(value, message)).toThrow(TEST_MESSAGES.UNDEFINED_VALUE);
  });

  it('should throw AssertIsFunctionException when using message parameter in error message', () => {
    const value = ARRAY_VALUES.SIMPLE_ARRAY as readonly number[];
    const message = 'test error message';

    expect(() => assertIsFunction(value, message)).toThrow('test error message');
  });
});
