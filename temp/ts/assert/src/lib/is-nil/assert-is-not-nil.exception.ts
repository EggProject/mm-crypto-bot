import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the not-nil assertion.
 * Used by assertIsNotNil when the provided value is null or undefined.
 *
 * @example
 * ```ts
 * throw new AssertIsNotNilException('Value cannot be null or undefined');
 * ```
 */
export class AssertIsNotNilException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsNotNilException.prototype);
  }
}
