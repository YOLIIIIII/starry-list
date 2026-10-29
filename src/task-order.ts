import { displayTasks, type Task } from "./domain";
export const orderSignature = (tasks: Task[]) =>
  JSON.stringify(displayTasks(tasks));
export function dropOrder(
  tasks: Task[],
  source: string,
  target: string,
  after: boolean,
) {
  const list = displayTasks(tasks);
  const from = list.find((t) => t.id === source),
    to = list.find((t) => t.id === target);
  if (
    !from ||
    !to ||
    from.date !== to.date ||
    from.completed !== to.completed ||
    source === target
  )
    return null;
  const ids = list.filter((t) => t.id !== source).map((t) => t.id);
  ids.splice(ids.indexOf(target) + Number(after), 0, source);
  return ids;
}
export function validOrder(tasks: Task[], ids: string[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (
    ids.length !== tasks.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id))
  )
    return false;
  let completed = false;
  for (const id of ids) {
    if (byId.get(id)!.completed) completed = true;
    else if (completed) return false;
  }
  return true;
}
