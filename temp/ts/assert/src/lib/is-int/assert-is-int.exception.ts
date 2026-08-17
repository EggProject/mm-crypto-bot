import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the integer type assertion.
 * Used by assertIsInt when the provided value is not an integer.
 *
 * @example
 * ```ts
 * throw new AssertIsIntException('Expected an integer value');
 * ```
 */
export class AssertIsIntException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsIntException.prototype);
  }
}
