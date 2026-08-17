import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the array type assertion.
 * Used by assertIsArray when the provided value is not an array.
 */
export class AssertIsArrayException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsArrayException.prototype);
  }
}
