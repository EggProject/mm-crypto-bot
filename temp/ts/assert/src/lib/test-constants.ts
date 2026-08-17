/**
 * Shared test constants for assertion library tests
 * Centralizes magic numbers and test values to follow coding standards
 */

const ARRAY_LENGTH = 3;

// Array test values
export const ARRAY_VALUES = {
  SIMPLE_ARRAY: [1, 2, ARRAY_LENGTH],
  SINGLE_ELEMENT: ['single'],
} as const;

// Number test values
export const NUMBER_VALUES = {
  ZERO: 0,
  POSITIVE_INT: 42,
  NEGATIVE_INT: -7,
  SMALL_INT: 1,
  LARGE_INT: 2,
  FLOAT_VALUE: Math.PI,
  TEST_NUMBER: 123,
  STRING_NUMBER: '42',
} as const;

// Object test values
export const OBJECT_VALUES = {
  OBJECT_WITH_LENGTH: { length: 3 },
  SIMPLE_OBJECT: { key: 'value' },
} as const;

// String test values
export const STRING_VALUES = {
  HELLO: 'hello',
  EMPTY: '',
  TEMPLATE_STRING: 'template string',
  NOT_STRING_NUMBER: '42',
  NOT_NIL: 'not nil value',
} as const;

// Boolean test values
export const BOOLEAN_VALUES = {
  TRUE: true,
  FALSE: false,
} as const;

// Test message constants
export const TEST_MESSAGES = {
  TEST_MESSAGE: 'test message',
  EMPTY_ARRAY: 'empty array',
  STRING_VALUE: 'string value',
  NULL_VALUE: 'null value',
  UNDEFINED_VALUE: 'undefined value',
  NUMBER_VALUE: 'number value',
  OBJECT_VALUE: 'object value',
  ARRAY_VALUE: 'array value',
  BOOLEAN_VALUE: 'boolean value',
  FLOAT_VALUE: 'float value',
  NAN_VALUE: 'NaN value',
  INFINITY_VALUE: 'Infinity value',
  NOT_ARRAY: 'not an array',
  NOT_FUNCTION: 'not a function',
} as const;
