import { getGlobalSingleton } from "./instances";

type LockQueue = Map<string, Promise<void>>;

const queue = (): LockQueue =>
  getGlobalSingleton("automationMutationLocks", () => new Map<string, Promise<void>>());

export async function withAutomationMutationLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  const locks = queue();
  const previous = locks.get(id) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(id, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(id) === current) locks.delete(id);
  }
}
