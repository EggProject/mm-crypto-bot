import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the non-empty array assertion.
 * Used by assertIsNotEmptyArray when the provided value is not an array or is empty.
 *
 * @example
 * ```ts
 * throw new AssertIsNotEmptyArrayException('Expected a non-empty array');
 * ```
 */
export class AssertIsNotEmptyArrayException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsNotEmptyArrayException.prototype);
  }
}
