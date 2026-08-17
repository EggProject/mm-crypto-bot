import { from, of } from 'rxjs';
import { deepDistinctUntilChanged } from './deep-distinct-until-changed';

const THREE = 3;
const FOUR = 4;

describe('deepDistinctUntilChanged operátor', () => {
  it('megkülönbözteti a primitív értékeket', async () => {
    const eredmenyek: number[] = [];

    const forras$ = of(1, 1, 2, 2, THREE, 1).pipe(deepDistinctUntilChanged());

    await new Promise<void>(resolve => {
      forras$.subscribe({
        next: ertek => {
          eredmenyek.push(ertek);
        },
        complete: resolve,
      });
    });

    expect(eredmenyek).toEqual([1, 2, THREE, 1]);
  });

  it('kiszűri az azonos tartalmú objektumokat (deep equality)', async () => {
    const object1 = { id: 1, data: { value: 'teszt' } };
    const object2 = { id: 1, data: { value: 'teszt' } }; // Ugyanaz tartalomra
    const object3 = { id: 1, data: { value: 'mas' } };

    const eredmenyek: (typeof object1)[] = [];
    const forras$ = from([object1, object2, object3, object1]).pipe(deepDistinctUntilChanged());

    await new Promise<void>(resolve => {
      forras$.subscribe({
        next: v => {
          eredmenyek.push(v);
        },
        complete: resolve,
      });
    });

    // Az elvárás, hogy az obj2 ne jelenjen meg, mert deep equal az obj1-gyel
    // Az obj3 megjelenik, mert különbözik
    // Az utolsó obj1 megjelenik, mert obj3-hoz képest különbözik
    expect(eredmenyek).toEqual([object1, object3, object1]);
  });

  it('helyesen kezeli a tömböket', async () => {
    const tomb1 = [1, 2, THREE];
    const tomb2 = [1, 2, THREE];
    const tomb3 = [1, 2, FOUR];

    const eredmenyek: number[][] = [];
    const forras$ = from([tomb1, tomb2, tomb3]).pipe(deepDistinctUntilChanged());

    await new Promise<void>(resolve => {
      forras$.subscribe({
        next: v => {
          eredmenyek.push(v);
        },
        complete: resolve,
      });
    });

    expect(eredmenyek).toEqual([tomb1, tomb3]);
  });

  it('kezel komplex egymásba ágyazott struktúrákat', async () => {
    const komplex1 = {
      users: [
        { id: 1, nev: 'Jani' },
        { id: 2, nev: 'Peti' },
      ],
      config: { aktiv: true },
    };
    const komplex2 = {
      users: [
        { id: 1, nev: 'Jani' },
        { id: 2, nev: 'Peti' },
      ],
      config: { aktiv: true },
    };
    const komplex3 = {
      users: [
        { id: 1, nev: 'Jani' },
        { id: 2, nev: 'Peti' },
      ],
      config: { aktiv: false },
    };

    const eredmenyek: (typeof komplex1)[] = [];
    const forras$ = from([komplex1, komplex2, komplex3]).pipe(deepDistinctUntilChanged());

    await new Promise<void>(resolve => {
      forras$.subscribe({
        next: v => {
          eredmenyek.push(v);
        },
        complete: resolve,
      });
    });

    expect(eredmenyek).toEqual([komplex1, komplex3]);
  });

  it('üres stream esetén nem emitál semmit', async () => {
    const eredmenyek: unknown[] = [];
    const forras$ = from([]).pipe(deepDistinctUntilChanged());

    await new Promise<void>(resolve => {
      forras$.subscribe({
        next: v => {
          eredmenyek.push(v);
        },
        complete: resolve,
      });
    });

    expect(eredmenyek).toEqual([]);
  });
});
