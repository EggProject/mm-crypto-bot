export class RingBuffer<T> {
  private readonly items: T[] = [];
  private cursor = 0;

  constructor(public readonly capacity: number) {
    if (
      // eslint-disable-next-line unicorn/prefer-number-is-safe-integer -- The existing contract accepts every positive integer capacity.
      !Number.isInteger(capacity) ||
      capacity <= 0
    ) {
      throw new Error(`RingBuffer: capacity must be a positive integer, got ${String(capacity)}`);
    }
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }
    this.items[this.cursor] = item;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  get size(): number {
    return this.items.length;
  }

  *values(): IterableIterator<T> {
    if (this.items.length < this.capacity) {
      yield* this.items;
      return;
    }
    yield* this.items.slice(this.cursor);
    yield* this.items.slice(0, this.cursor);
  }

  toArray(): T[] {
    // eslint-disable-next-line unicorn/prefer-iterator-to-array -- Iterator helper typings are unavailable in the supported TypeScript lib.
    return [...this.values()];
  }
}
