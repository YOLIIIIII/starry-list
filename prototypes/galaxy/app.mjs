/* global document */
// Standalone synthetic-data prototype. No imports, IPC, persistence or fetch.
const $ = (id) => document.getElementById(id);
const state = {
  scheme: "A",
  view: "month",
  year: 2026,
  month: 10,
  day: 14,
  sample: "normal",
  asof: "2026-10-31",
};
const edits = new Map();
const names = {
  A: [
    "纸上星图",
    "PAPER CONSTELLATIONS",
    "把日子轻轻摊开，留白也是生活的一部分。",
  ],
  B: ["行星轨道", "YOUR LITTLE ORBIT", "沿着日期绕一圈，发现已经亮起的星光。"],
  C: [
    "星河手账",
    "CHAPTERS OF EVERYDAY LIGHT",
    "一段一段回看，让小小收获有自己的位置。",
  ],
};
const titles = ["读几页喜欢的书", "给想法留一句备注", "整理一个小角落"];
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const key = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function tasks(year, month, day) {
  const date = key(year, month, day);
  const phase = (((day + month - 10 + year - 2026) % 6) + 6) % 6;
  if (edits.has(date)) return edits.get(date);
  if (
    state.sample === "empty" ||
    phase === 0 ||
    phase === 1 ||
    (state.sample === "sparse" && day % 3 !== 0)
  )
    return [];
  const complete = phase === 3 || phase === 5;
  return [0, 1].map((i) => ({
    title: titles[(day + i) % titles.length],
    completed: complete || (phase === 2 && i === 0),
  }));
}
function status(items) {
  return items.length === 0
    ? "none"
    : items.every((t) => t.completed)
      ? "completed"
      : "planned";
}
const descriptions = {
  none: "这一天没有安排任务",
  planned: "当天有计划，尚未全部完成",
  completed: "当天计划已全部完成",
};
const star = (kind) =>
  kind === "none"
    ? '<span class="star-space" aria-hidden="true"></span>'
    : `<i class="star ${kind}" aria-hidden="true"></i>`;
function planet() {
  return '<svg class="planet" viewBox="0 0 140 120" aria-hidden="true"><ellipse cx="70" cy="64" rx="63" ry="18" transform="rotate(-18 70 64)" class="ring"/><circle cx="70" cy="56" r="40" fill="#f5df9f"/><path d="M38 39Q62 4 95 33Q64 16 45 60Z" fill="#fff4cb"/><path d="M34 71Q74 99 106 54Q110 90 77 96Q49 98 34 71" fill="#dbc3df" opacity=".6"/><ellipse cx="55" cy="37" rx="9" ry="5" fill="#fffae9" transform="rotate(-30 55 37)"/><path d="M60 58v3M79 58v3M65 69Q70 73 75 69" fill="none" stroke="#a78aa8" stroke-width="2.3" stroke-linecap="round"/><path d="M10 72Q68 75 132 39" class="ring"/><path d="M119 15l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#d7b75e"/></svg>';
}
function dayButton(day, extra = "", position = "") {
  const kind = status(tasks(state.year, state.month, day));
  return `<button class="date-button ${extra}" data-day="${day}" aria-label="${key(state.year, state.month, day)}，${descriptions[kind]}" aria-pressed="${day === state.day}" ${position ? `style="${position}"` : ""}><span>${String(day).padStart(2, "0")}</span>${star(kind)}</button>`;
}
function paper() {
  let result =
    '<div class="paper-grid">' +
    ["一", "二", "三", "四", "五", "六", "日"]
      .map((x) => `<span class="weekday">${x}</span>`)
      .join("");
  const leading =
    (new Date(Date.UTC(state.year, state.month - 1, 1)).getUTCDay() + 6) % 7;
  result += '<span aria-hidden="true"></span>'.repeat(leading);
  for (let day = 1; day <= daysIn(state.year, state.month); day++)
    result += dayButton(day);
  return result + "</div>";
}
function orbit() {
  const count = daysIn(state.year, state.month);
  let result =
    '<div class="orbital"><svg class="orbit-guide" viewBox="0 0 600 440" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="300" cy="220" rx="266" ry="194" fill="none" stroke="#d8c5e9" stroke-dasharray="3 7"/><ellipse cx="300" cy="220" rx="181" ry="132" fill="none" stroke="#e2d2ee"/></svg><div class="planet-center">' +
    planet() +
    "<p>每一颗，都有自己的日期</p></div>";
  for (let day = 1; day <= count; day++) {
    const angle = ((day - 1) / count) * Math.PI * 2 - Math.PI / 2;
    const radius = day % 2 === 1 ? 1 : 0.68;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 194;
    result += dayButton(
      day,
      "orbit-date",
      `--x:calc((100cqw / 2 - 28px) * ${x});--y:${y}px`,
    );
  }
  return (
    result +
    '</div><div class="orbit-fallback">' +
    planet() +
    "<p>把星轨展开，按日期慢慢看。</p>" +
    paper() +
    "</div>"
  );
}
function journey() {
  let result =
    '<div class="journey-hero">' +
    planet() +
    "<p><b>小小的完成，也有光。</b>不必每天都一样，慢慢安排就很好。</p></div>";
  for (let start = 1; start <= daysIn(state.year, state.month); start += 7) {
    result += `<div class="journey-row"><small>${String(start).padStart(2, "0")}—${Math.min(start + 6, daysIn(state.year, state.month))}</small><div class="journey-days">`;
    for (
      let day = start;
      day <= Math.min(start + 6, daysIn(state.year, state.month));
      day++
    )
      result += dayButton(day);
    result += "</div></div>";
  }
  return result;
}
function counts(month, until = state.asof) {
  let planned = 0,
    completed = 0,
    future = 0;
  for (let day = 1; day <= daysIn(state.year, month); day++) {
    const kind = status(tasks(state.year, month, day));
    if (kind === "none") continue;
    if (key(state.year, month, day) > until) {
      future++;
      continue;
    }
    planned++;
    if (kind === "completed") completed++;
  }
  return { planned, completed, future };
}
function monthCard(month, position = "") {
  let dots = "";
  for (let day = 1; day <= daysIn(state.year, month); day++)
    dots += `<span class="${{ none: "blank", completed: "complete", planned: "" }[status(tasks(state.year, month, day))]}"></span>`;
  const c = counts(month);
  return `<button class="month-card" data-open-month="${month}" aria-label="查看${state.year}年${month}月" aria-description="截至${state.asof}，${c.planned}天已规划，${c.completed}天全部完成，另有${c.future}天未来计划" ${position ? `style="${position}"` : ""}><b>${month} 月</b><div class="mini-days" aria-hidden="true">${dots}</div><small>${position ? `${c.completed} / ${c.planned} 天${c.future ? `<br>另有${c.future}天未来` : ""}` : `${c.completed} 天全部完成 · ${c.planned} 天已规划${c.future ? `<br>另有 ${c.future} 天未来计划` : ""}`}</small></button>`;
}
function yearScene() {
  if (state.scheme === "B") {
    let out =
      '<div class="year-orbit"><svg class="orbit-guide" viewBox="0 0 600 370" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="300" cy="185" rx="234" ry="144" fill="none" stroke="#d5bfe8"/></svg><div class="planet-center">' +
      planet() +
      `<p>${state.year} · 十二个月的光</p></div>`;
    for (let month = 1; month <= 12; month++) {
      const angle = ((month - 1) / 12) * Math.PI * 2 - Math.PI / 2;
      out += monthCard(
        month,
        `--x:calc((100cqw / 2 - 68px) * ${Math.cos(angle)});--y:${Math.sin(angle) * 146}px`,
      );
    }
    return (
      out +
      '</div><div class="year-grid">' +
      Array.from({ length: 12 }, (_, i) => monthCard(i + 1)).join("") +
      "</div>"
    );
  }
  return (
    `<div class="${state.scheme === "C" ? "year-journal" : "year-grid"}">` +
    Array.from({ length: 12 }, (_, i) => monthCard(i + 1)).join("") +
    "</div>"
  );
}
function render() {
  document.body.classList.remove("scheme-A", "scheme-B", "scheme-C");
  document.body.classList.add("scheme-" + state.scheme);
  for (const scheme of ["A", "B", "C"])
    $("scheme-" + scheme).setAttribute(
      "aria-pressed",
      String(state.scheme === scheme),
    );
  $("monthly").setAttribute("aria-pressed", String(state.view === "month"));
  $("yearly").setAttribute("aria-pressed", String(state.view === "year"));
  $("month-label").hidden = state.view === "year";
  $("year").value = String(state.year);
  $("month").value = String(state.month);
  $("kicker").textContent = names[state.scheme][1];
  $("scene-title").textContent =
    state.view === "month"
      ? `${state.year} 年 ${state.month} 月 · ${names[state.scheme][0]}`
      : `${state.year} · 十二个月的回响`;
  $("subtitle").textContent = names[state.scheme][2];
  $("chart").innerHTML =
    state.view === "year"
      ? yearScene()
      : state.scheme === "A"
        ? paper()
        : state.scheme === "B"
          ? orbit()
          : journey();
  const items = tasks(state.year, state.month, state.day),
    kind = status(items),
    date = key(state.year, state.month, state.day),
    done = items.filter((t) => t.completed).length;
  $("details").innerHTML =
    state.view === "year"
      ? `<p class="eyebrow">A YEAR AT YOUR OWN PACE</p>${planet()}<h2>一年，不止一种节奏。</h2><p>点一个月份，就能展开那一段日子。轨道中的数字依次为全部完成天数 / 已规划天数。</p><p class="detail-note">仅统计截至演示时点的计划日期。未来计划单独列出；不把十二个月的百分比直接平均。</p>`
      : `<p class="detail-date">${date}</p><div class="detail-symbol">${star(kind)}</div><h2>${kind === "none" ? "留一点空白给自己" : kind === "completed" ? "这一天的计划，都完成了。" : "有些计划，正在路上。"}</h2><p>${items.length ? `${done} / ${items.length} 项已完成` : "没有任务，也不需要补上一颗星星。"}</p><ul>${items.map((t) => `<li class="${t.completed ? "finished" : ""}"><i>${t.completed ? "✓" : "○"}</i>${t.title}</li>`).join("")}</ul>${items.length ? `<button id="toggle-demo">演示：${kind === "completed" ? "取消一项完成" : "补完这一天"}</button>` : ""}<p class="detail-note">按任务归属日期回顾。演示修改只在本页内存中生效，刷新即还原；不推断实际完成时间。</p>`;
  let c;
  if (state.view === "year")
    c = Array.from({ length: 12 }, (_, i) => counts(i + 1)).reduce(
      (a, b) => ({
        planned: a.planned + b.planned,
        completed: a.completed + b.completed,
        future: a.future + b.future,
      }),
      { planned: 0, completed: 0, future: 0 },
    );
  else c = counts(state.month);
  $("reflection").textContent =
    `截至 ${state.asof} · 已规划 ${c.planned} 天，全部完成 ${c.completed} 天${c.future ? ` · 另有 ${c.future} 天未来计划` : ""}`;
}
function enter(scheme) {
  state.scheme = scheme;
  $("lobby").hidden = true;
  $("studio").hidden = false;
  $("back").hidden = false;
  render();
  $("scheme-" + scheme).focus();
}
function shiftPeriod(delta) {
  if (state.view === "year")
    state.year = Math.max(2025, Math.min(2027, state.year + delta));
  else {
    const index = Math.max(
      0,
      Math.min(35, (state.year - 2025) * 12 + state.month - 1 + delta),
    );
    state.year = 2025 + Math.floor(index / 12);
    state.month = (index % 12) + 1;
  }
  state.day = Math.min(state.day, daysIn(state.year, state.month));
  render();
}
$("month").innerHTML = Array.from(
  { length: 12 },
  (_, i) => `<option value="${i + 1}">${i + 1} 月</option>`,
).join("");
document.querySelector(".orbit-mini").innerHTML = planet();
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.enter) enter(button.dataset.enter);
  if (button.dataset.scheme) {
    state.scheme = button.dataset.scheme;
    render();
  }
  if (button.dataset.view) {
    state.view = button.dataset.view;
    render();
  }
  if (button.dataset.day) {
    state.day = Number(button.dataset.day);
    render();
    [...document.querySelectorAll(`#chart [data-day="${state.day}"]`)]
      .find((el) => el.getBoundingClientRect().width > 0)
      ?.focus();
  }
  if (button.dataset.openMonth) {
    state.month = Number(button.dataset.openMonth);
    state.day = 1;
    state.view = "month";
    render();
  }
  if (button.id === "toggle-demo") {
    const items = tasks(state.year, state.month, state.day).map((t) => ({
      ...t,
    }));
    if (items.every((t) => t.completed)) items[0].completed = false;
    else items.forEach((t) => (t.completed = true));
    edits.set(key(state.year, state.month, state.day), items);
    render();
    $("toggle-demo")?.focus();
  }
});
$("back").onclick = () => {
  $("studio").hidden = true;
  $("lobby").hidden = false;
  $("back").hidden = true;
  document.querySelector(`[data-enter="${state.scheme}"]`).focus();
};
$("year").onchange = () => {
  state.year = Number($("year").value);
  state.day = Math.min(state.day, daysIn(state.year, state.month));
  render();
};
$("month").onchange = () => {
  state.month = Number($("month").value);
  state.day = Math.min(state.day, daysIn(state.year, state.month));
  render();
};
$("previous").onclick = () => shiftPeriod(-1);
$("next").onclick = () => shiftPeriod(1);
$("sample").onchange = () => {
  state.sample = $("sample").value;
  edits.clear();
  render();
};
$("asof").onchange = () => {
  state.asof = $("asof").value;
  render();
};
$("size").onchange = () => {
  document.body.dataset.size = $("size").value;
  document.documentElement.style.fontSize =
    { small: 14, standard: 15, large: 18 }[$("size").value] + "px";
};
$("skin").onchange = () => (document.body.dataset.skin = $("skin").value);
$("header").onchange = () => (document.body.dataset.header = $("header").value);
$("relation").onclick = () => $("relation-dialog").showModal();
$("close-dialog").onclick = () => $("relation-dialog").close();
$("chart").addEventListener("keydown", (event) => {
  if (!event.target.dataset.day) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
    event.key
  ];
  if (!step) return;
  event.preventDefault();
  const timestamp = Math.max(
    Date.UTC(2025, 0, 1),
    Math.min(
      Date.UTC(2027, 11, 31),
      Date.UTC(
        state.year,
        state.month - 1,
        Number(event.target.dataset.day) + step,
      ),
    ),
  );
  const next = new Date(timestamp);
  state.year = next.getUTCFullYear();
  state.month = next.getUTCMonth() + 1;
  state.day = next.getUTCDate();
  const day = state.day;
  render();
  [...document.querySelectorAll(`#chart [data-day="${day}"]`)]
    .find((el) => el.getBoundingClientRect().width > 0)
    ?.focus();
});
render();
