/**
 * Shared test constants for ts/typeguard spec files
 * These constants replace magic numbers in test cases
 */

// ============================================================================
// Integer Test Values
// ============================================================================

/** Small positive integers for basic functionality tests */
export const POSITIVE_INT_ZERO = 0;
export const POSITIVE_INT_ONE = 1;
export const POSITIVE_INT_SMALL = 42;
export const POSITIVE_INT_MEDIUM = 999;

/** Small negative integers for negative value tests */
export const NEGATIVE_INT_ONE = -1;
export const NEGATIVE_INT_SMALL = -7;
export const NEGATIVE_INT_MEDIUM = -999;

// ============================================================================
// Floating Point Test Values
// ============================================================================

/** Small positive decimals */
export const POSITIVE_FLOAT_SMALL = 0.1;
export const POSITIVE_FLOAT_MEDIUM = 0.5;
export const POSITIVE_FLOAT_TYPICAL = Math.PI;
export const POSITIVE_FLOAT_LARGE = 123.456;

/** Very small positive decimals for epsilon tests */
export const POSITIVE_FLOAT_TINY = 0.000001;

/** Small negative decimals */
export const NEGATIVE_FLOAT_SMALL = -0.5;
export const NEGATIVE_FLOAT_MEDIUM = -2.7;
export const NEGATIVE_FLOAT_LARGE = -123.456;

// ============================================================================
// Array/Collection Size Constants
// ============================================================================

/** Array lengths for collection tests */
export const ARRAY_LENGTH_EMPTY = 0;
export const ARRAY_LENGTH_SINGLE = 1;
export const ARRAY_LENGTH_SMALL = 2;
export const ARRAY_LENGTH_MEDIUM = 3;

// ============================================================================
// Date/Timestamp Constants
// ============================================================================

/** Special timestamp values for Date tests */
export const TIMESTAMP_EPOCH = 1_672_531_200_000; // 2023-01-01 00:00:00 UTC
export const TIMESTAMP_UNIX_EPOCH = 0; // 1970-01-01 00:00:00 UTC

/** Maximum and minimum valid Date values (milliseconds) */
export const TIMESTAMP_MAX_DATE = 8_640_000_000_000_000;
export const TIMESTAMP_MIN_DATE = -8_640_000_000_000_000;

// ============================================================================
// Generic Magic Numbers
// ============================================================================

/** Generic test number for type guard and filter operations */
export const MAGIC_NUMBER_123 = 123;

/** Alternative test number for numeric operations */
export const TEST_NUMBER_FLOAT = 12.4;

// ============================================================================
// String Test Values (for reference, not magic numbers)
// ============================================================================

/** Reference strings used in tests */
export const TEST_STRING_NUMERIC = '123';
export const TEST_STRING_FLOAT = '3.14';
export const TEST_STRING_VALID_DATE = '2023-05-15';

// ============================================================================
// Date Component Constants
// ============================================================================

/** Date component values for constructing test dates */
export const DATE_YEAR_2023 = 2023;
export const DATE_MONTH_APRIL = 4;
export const DATE_DAY_15 = 15;
