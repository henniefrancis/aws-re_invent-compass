// The route keys of the Compass API contract, as types. Both route tables are declared with
// `satisfies Record<...RouteKey, ...>`, so a missing or extra path or method fails `tsc`.
import type { CompassApi } from '@compass/contracts';

type Paths = CompassApi.paths;
type Method = 'get' | 'put' | 'post' | 'delete';

/** The methods a path item really defines (openapi-typescript marks the others `never`). */
type DefinedMethods<Item> = {
  [M in Method]: Item extends Record<M, unknown> ? M : never;
}[Method];

export type ContractRouteKey = {
  [P in Extract<keyof Paths, string>]: `${Uppercase<DefinedMethods<Paths[P]>>} ${P}`;
}[Extract<keyof Paths, string>];

/** The routes the Passkit_Lambda serves. */
export type PasskitRouteKey = Extract<ContractRouteKey, `${string} /api/passkit/${string}`>;

/** The routes the Api_Lambda serves. */
export type ApiRouteKey = Exclude<ContractRouteKey, PasskitRouteKey>;
