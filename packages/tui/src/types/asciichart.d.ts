// packages/tui/src/types/asciichart.d.ts — a `asciichart` library
// lokális típus-deklarációja.
//
// A `@types/asciichart` (DefinitelyTyped) hibás: a `default`
// exportot `string`-ként deklarálja, pedig a runtime-ban
// egy object, aminek van `.plot()` metódusa és szín-konstansok.
// Ez a lokális deklaráció felülírja a DefinitelyTyped típust.

declare module "asciichart" {
  export const black: string;
  export const red: string;
  export const green: string;
  export const yellow: string;
  export const blue: string;
  export const magenta: string;
  export const cyan: string;
  export const lightgray: string;
  export const defaultColor: string;
  export const darkgray: string;
  export const lightred: string;
  export const lightgreen: string;
  export const lightyellow: string;
  export const lightblue: string;
  export const lightmagenta: string;
  export const lightcyan: string;
  export const white: string;
  export const reset: string;

  export type Color = string | undefined;

  export function colored(char: string, color: Color): string;

  export interface PlotConfig {
    height?: number;
    width?: number;
    min?: number;
    max?: number;
    colors?: readonly (string | undefined)[];
    /** Auto-detect minimum when no explicit min/max given. */
    auto?: boolean;
    /** Pad label offsets. */
    padding?: number;
  }

  export function plot(
    series: readonly number[],
    config?: PlotConfig,
  ): string;

  const asciichart: {
    plot: typeof plot;
    colored: typeof colored;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    lightgray: string;
    defaultColor: string;
    darkgray: string;
    lightred: string;
    lightgreen: string;
    lightyellow: string;
    lightblue: string;
    lightmagenta: string;
    lightcyan: string;
    white: string;
    reset: string;
  };
  export default asciichart;
}
