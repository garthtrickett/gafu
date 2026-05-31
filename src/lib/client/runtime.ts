import { Effect, Layer, Runtime, Scope, Exit } from "effect";
import { LocationLive, LocationService } from "./LocationService";

export type BaseClientContext = LocationService;

export const BaseClientLive = Layer.mergeAll(LocationLive);

const appScope = Effect.runSync(Scope.make());

export const AppRuntime = Effect.runSync(
  Scope.extend(Layer.toRuntime(BaseClientLive), appScope),
);

export const clientRuntime: Runtime.Runtime<BaseClientContext> =
  AppRuntime;

export const runClientPromise = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => {
  return Runtime.runPromise(clientRuntime)(effect as unknown as Effect.Effect<A, E, BaseClientContext>);
};

export const runClientUnscoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => {
  return Runtime.runFork(clientRuntime)(effect as unknown as Effect.Effect<A, E, BaseClientContext>);
};

export const shutdownClient = () =>
  Effect.runPromise(Scope.close(appScope, Exit.succeed(undefined)));

export interface SafePromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}

export const makeThenable = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> & SafePromiseLike<A> => {
  const thenable = effect as unknown as Effect.Effect<A, E, R> & SafePromiseLike<A>;
  thenable.then = <TResult1 = A, TResult2 = never>(
    onFulfilled?: ((value: A) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> => {
    return runClientPromise(effect).then(onFulfilled, onRejected);
  };
  return thenable;
};
