import type { Constructor } from './constructor';
import {
  TEST_USER_AGE_30,
  TEST_VALUE_42,
  TEST_VALUE_123,
  TEST_CIRCLE_RADIUS_5,
  TEST_CIRCLE_AREA_78_54,
  TEST_STATIC_COUNT_INCREMENT,
  TEST_PRECISION_2,
} from './test-constants';

describe('Constructor - type validation and patterns', () => {
  describe('type validation', () => {
    it('should accept class constructors', () => {
      class User {
        constructor(
          public name: string,
          public age: number,
        ) {}
      }

      const UserCtor: Constructor<User> = User;
      const instance = new User('Alice', TEST_USER_AGE_30);

      expect(UserCtor).toBe(User);
      expect(instance).toBeInstanceOf(User);
      expect(instance.name).toBe('Alice');
      expect(instance.age).toBe(TEST_USER_AGE_30);
    });

    it('should infer correct instance type', () => {
      class Product {
        constructor(public id: number) {}
      }

      const ProductCtor: Constructor<Product> = Product;

      expectTypeOf(ProductCtor).toExtend<Constructor<Product>>();
      expectTypeOf(new Product(1)).toEqualTypeOf<Product>();
    });

    it('should work with constructors that have no parameters', () => {
      class Empty {}

      const EmptyCtor: Constructor<Empty> = Empty;
      const instance = new EmptyCtor();

      expect(instance).toBeInstanceOf(Empty);
    });

    it('should work with constructors that have optional parameters', () => {
      class Optional {
        constructor(public value?: string) {}
      }

      const OptionalCtor: Constructor<Optional> = Optional;
      const withValue = new Optional('test');
      const withoutValue = new Optional();
      expect(OptionalCtor).toBe(Optional);

      expect(withValue.value).toBe('test');
      expect(withoutValue.value).toBeUndefined();
    });
  });

  describe('factory pattern', () => {
    it('should work in factory functions', () => {
      function createInstance<T, A extends unknown[]>(
        ctor: new (...arguments__: A) => T,
        ...arguments_: A
      ): T {
        return new ctor(...arguments_);
      }

      class Item {
        constructor(
          public id: number,
          public label: string,
        ) {}
      }

      const item = createInstance(Item, TEST_VALUE_42, 'Test Item');

      expect(item.id).toBe(TEST_VALUE_42);
      expect(item.label).toBe('Test Item');
      expectTypeOf(item).toEqualTypeOf<Item>();
    });

    it('should support generic factory with type inference', () => {
      class Box<T> {
        constructor(public value: T) {}
      }

      function makeBox<T>(ctor: new (value: T) => Box<T>, value: T): Box<T> {
        return new ctor(value);
      }

      const numberBox = makeBox(Box, TEST_VALUE_123);
      const stringBox = makeBox(Box, 'hello');

      expect(numberBox.value).toBe(TEST_VALUE_123);
      expect(stringBox.value).toBe('hello');
    });
  });

  describe('dependency injection', () => {
    it('should work in DI container pattern', () => {
      class Container {
        readonly #instances = new Map<unknown, unknown>();

        register<T>(ctor: Constructor<T>, instance: T): void {
          this.#instances.set(ctor, instance);
        }

        resolve<T>(ctor: Constructor<T>): T | undefined {
          return this.#instances.get(ctor) as T | undefined;
        }

        has<T>(ctor: Constructor<T>): boolean {
          return this.#instances.has(ctor);
        }
      }

      class Service {
        constructor(public name: string) {}
      }

      const container = new Container();
      const service = new Service('TestService');
      container.register(Service, service);

      expect(container.has(Service)).toBe(true);
      expect(container.resolve(Service)).toBe(service);
      expect(container.resolve(Service)?.name).toBe('TestService');
    });

    it('should support multiple service registrations', () => {
      class Logger {
        log(_message: string): void {
          // logging implementation
        }
      }

      class Database {
        connect(): string {
          return 'connected';
        }
      }

      const constructors: (new (...arguments_: never[]) => unknown)[] = [Logger, Database];

      expect(constructors).toHaveLength(2);

      const logger = new constructors[0]();
      const database = new constructors[1]();

      expect(logger).toBeInstanceOf(Logger);
      expect(database).toBeInstanceOf(Database);
    });
  });
});

describe('Constructor - polymorphism and edge cases', () => {
  describe('polymorphism', () => {
    it('should work with inheritance', () => {
      class Animal {
        constructor(public name: string) {}
      }

      class Dog extends Animal {
        constructor(
          name: string,
          public breed: string,
        ) {
          super(name);
        }
      }

      const DogCtor: Constructor<Dog> = Dog;
      const dog = new Dog('Rex', 'Labrador');

      expect(DogCtor).toBe(Dog);
      expect(dog).toBeInstanceOf(Dog);
      expect(dog).toBeInstanceOf(Animal);
      expect(dog.name).toBe('Rex');
      expect(dog.breed).toBe('Labrador');
    });

    it('should work with abstract patterns', () => {
      abstract class Shape {
        abstract area(): number;
      }

      class Circle extends Shape {
        constructor(public radius: number) {
          super();
        }

        area(): number {
          return Math.PI * this.radius ** 2;
        }
      }

      const CircleCtor: Constructor<Circle> = Circle;
      const circle = new Circle(TEST_CIRCLE_RADIUS_5);
      expect(CircleCtor).toBe(Circle);

      expect(circle.area()).toBeCloseTo(TEST_CIRCLE_AREA_78_54, TEST_PRECISION_2);
    });
  });

  describe('edge cases', () => {
    it('should work with classes that have complex initialization', () => {
      class Complex {
        readonly #initialized = true;

        constructor(public config: { name: string; value: number }) {
          // #initialized is set via class field declaration
        }

        isInitialized(): boolean {
          return this.#initialized;
        }
      }

      const ComplexCtor: Constructor<Complex> = Complex;
      const instance = new Complex({ name: 'test', value: TEST_VALUE_42 });
      expect(ComplexCtor).toBe(Complex);

      expect(instance.isInitialized()).toBe(true);
      expect(instance.config.name).toBe('test');
    });

    it('should work with static methods', () => {
      class WithStatic {
        static readonly count = 0;

        static getCount(): number {
          return (this as unknown as { _count?: number })._count ?? 0;
        }

        readonly #instanceCount: number;

        constructor() {
          this.#instanceCount = (WithStatic as unknown as { _count?: number })._count ?? 0;
          (WithStatic as unknown as { _count: number })._count = this.#instanceCount + 1;
        }
      }

      const Ctor: Constructor<WithStatic> = WithStatic;

      const instance1 = new Ctor();
      const instance2 = new Ctor();
      const instance3 = new Ctor();

      expect(instance1).toBeInstanceOf(WithStatic);
      expect(instance2).toBeInstanceOf(WithStatic);
      expect(instance3).toBeInstanceOf(WithStatic);
      expect(WithStatic.getCount()).toBe(TEST_STATIC_COUNT_INCREMENT);
    });

    it('should work with private/protected members', () => {
      class WithPrivate {
        readonly #secret: string;
        protected internal: number;

        constructor(secret: string, internal: number) {
          this.#secret = secret;
          this.internal = internal;
        }

        getSecret(): string {
          return this.#secret;
        }
      }

      const Ctor: Constructor<WithPrivate> = WithPrivate;
      const instance = new WithPrivate('hidden', TEST_VALUE_42);

      expect(Ctor).toBe(WithPrivate);
      expect(instance.getSecret()).toBe('hidden');
    });
  });
});
