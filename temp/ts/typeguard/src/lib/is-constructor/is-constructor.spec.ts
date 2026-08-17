import { isConstructor } from './is-constructor';
import { POSITIVE_INT_ZERO, TEST_NUMBER_FLOAT } from '../test-constants';

function namedFunction(): void {
  /* empty */
}

const anonymFunction = function (): void {
  /* empty */
};

const arrowFunction = (): void => {
  /* empty */
};

class CustomClass {}

class CustomClassWithParameter {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

describe('isConstructor', () => {
  it('When class type provided Then true returned', () => {
    expect(isConstructor(CustomClass)).toBe(true);
  });

  it('When class type with parameterized constructor provided Then true returned', () => {
    expect(isConstructor(CustomClassWithParameter)).toBe(true);
  });

  it('When named function provided Then false returned', () => {
    expect(isConstructor(namedFunction)).toBe(false);
  });

  it('When anonym function provided Then false returned', () => {
    expect(isConstructor(anonymFunction)).toBe(false);
  });

  it('When arrow function provided Then false returned', () => {
    expect(isConstructor(arrowFunction)).toBe(false);
  });

  it('When class instance provided Then false returned', () => {
    expect(isConstructor(new CustomClass())).toBe(false);
  });

  it('When object provided Then false returned', () => {
    expect(isConstructor({})).toBe(false);
  });

  it('When array provided Then false returned', () => {
    expect(isConstructor([])).toBe(false);
  });

  it('When primitive provided Then false returned', () => {
    expect(isConstructor(POSITIVE_INT_ZERO)).toBe(false);
    expect(isConstructor(TEST_NUMBER_FLOAT)).toBe(false);
    expect(isConstructor('this is a string')).toBe(false);
    expect(isConstructor(true)).toBe(false);
    expect(isConstructor(false)).toBe(false);
    expect(isConstructor()).toBe(false);
  });
});
