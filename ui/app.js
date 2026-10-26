/* OpenOCD-GUI — Tauri 2 front-end (vanilla JS, mirrors the Python parsers) */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: dialogOpen, save: dialogSave } = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let settings = null;
let targetRows = [];
let regRows = [];
let memRows = [];
let memAddr = 0, memSize = 4;
let bpRows = [], wpRows = [];
let bpRefreshErr = "", wpRefreshErr = "";  // 列表读取失败的原因（空 = 正常）
let consoleHistory = [], histIdx = -1;
let logLines = [];
let lastTargetState = "";
let regTimer = null, regPending = false;

// ---------------------------------------------------------------- parsers
function parseTargets(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)(.)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/);
    if (m) rows.push({ current: m[2] === "*", name: m[3], type: m[4],
                       endian: m[5], tap: m[6], state: m[7] });
  }
  return rows;
}
function parseRegs(text) {
  const regs = []; let group = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("Error")) return { err: t, regs: [] };
    if (t.startsWith("=")) { group = t.replace(/^=+/, "").trim(); continue; }
    // (N) name (/bits)[: value [(dirty) | dirty]] — 全量 reg 输出
    let m = t.match(/^\((\d+)\)\s+(\S+)\s+\(\/(\d+)\)(?::\s*(\S+))?\s*(\(dirty\)|dirty)?$/)
         || t.match(/^\((\d+)\)\s+(\S+)\s+\/(\d+)(?::\s*(\S+))?\s*(\(dirty\)|dirty)?$/);
    if (m) {
      regs.push({ num: +m[1], group, name: m[2], size: +m[3],
                  value: m[4] || "", dirty: !!m[5] });
      continue;
    }
    // name (/bits)[: value [(dirty) | dirty]] — 单寄存器 reg <name> 输出
    m = t.match(/^(\S+)\s+\(\/(\d+)\)(?::\s*(\S+))?\s*(\(dirty\)|dirty)?$/);
    if (m) regs.push({ num: regs.length, group, name: m[1], size: +m[2],
                       value: m[3] || "", dirty: !!m[4] });
  }
  if (!regs.length) {
    const first = text.split("\n").map(s => s.trim()).find(s => s && !s.startsWith("="));
    return { err: first || "", regs: [] };
  }
  return { err: "", regs };
}
function padHex(v, bits) {
  if (!v) return "";
  if (!/^0x/i.test(v)) return v;
  return "0x" + v.slice(2).toLowerCase().padStart(Math.max(1, bits / 4), "0");
}
function parseMd(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(0x[0-9a-fA-F]+):\s*(.*)$/);
    if (m) {
      const vals = m[2].trim().split(/\s+/).filter(x => x).map(v => parseInt(v, 16));
      if (vals.length) rows.push([parseInt(m[1], 16), vals]);
    }
  }
  return rows;
}
function parseBp(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const raw = line.replace(/\s+$/, "");
    // Hybrid 断点会在下一行追加关联信息："\t|--->linked with ContextID: 0x…"，挂到上一条上
    const lk = raw.trim().match(/^\|--->linked with ContextID:\s*(0x[0-9a-fA-F]+)/i);
    if (lk && out.length) { out[out.length - 1].note += " linked_ctx=" + lk[1]; continue; }
    const m = raw.trim().match(/^(Software|Hardware|Context|Hybrid)\s+breakpoint(?:\(IVA\))?\s*:\s*(.*)$/i);
    if (!m) continue;
    const props = {};
    for (const kv of m[2].matchAll(/(\w+)=([^,]*)/g)) props[kv[1]] = kv[2].trim();
    out.push({ type: m[1].toLowerCase(), addr: props.addr || "", asid: props.asid || "",
               len: props.len || "", num: props.num || "", orig: props.orig_instr || "",
               note: props.orig_instr ? "orig_instr=" + props.orig_instr : "" });
  }
  return out;
}
function parseWp(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^address:\s*(0x[0-9a-fA-F]+),\s*len:\s*(0x[0-9a-fA-F]+),\s*r\/w\/a:\s*(\S),\s*value:\s*(0x[0-9a-fA-F]+),\s*mask:\s*(0x[0-9a-fA-F]+)/);
    if (m) out.push({ addr: m[1], len: m[2], rw: m[3], value: m[4], mask: m[5] });
  }
  return out;
}
function parseBanks(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^#(\d+)\s*:\s*(\S+)\s+\((\S+)\)\s+at\s+(0x[0-9a-fA-F]+),\s*size\s+(0x[0-9a-fA-F]+),\s*buswidth\s+(\d+),\s*chipwidth\s+(\d+)/);
    if (m) out.push({ num: +m[1], name: m[2], driver: m[3], base: m[4],
                      size: m[5], bus: m[6], chip: m[7] });
  }
  return out;
}
function parseHex(t, dflt = null) {
  t = String(t || "").trim();
  if (!t) return dflt;
  // 全匹配：只接受 [0x]十六进制数字串（"100zz"、"-5"、"" 一律视为无效，交给调用点提示）
  const m = t.match(/^(?:0[xX])?([0-9a-fA-F]+)$/);
  if (!m) return dflt;
  const v = parseInt(m[1], 16);
  return Number.isNaN(v) ? dflt : v;
}
// 地址解析：0x 前缀 / 纯十六进制（自动补 0x）→ 规范化为 0x…；符号名或表达式（main、&var、0x08000000+4）→ 原样透传；空 → null
// 注意：OpenOCD 的 bp/wp 只接受数值地址；透传的符号名 / 表达式会被 OpenOCD 拒绝，失败原因会显示在 #bp-hint / #wp-hint。
function addrToken(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return "0x" + s.slice(2).toLowerCase();
  if (/^[0-9a-fA-F]+$/.test(s)) return "0x" + s.toLowerCase();
  return s;
}
// 纯数字（十六进制优先，可省略 0x）：合法 → "0x…"；空 → null；非法 → undefined
function numToken(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  const m = s.match(/^(?:0[xX])?([0-9a-fA-F]+)$/);
  return m ? "0x" + m[1].toLowerCase() : undefined;
}

// ---------------------------------------------------------------- helpers
async function tclExec(cmd, timeoutMs = 15000) { return invoke("tcl_exec", { cmd }); }
function notify(msg, isErr = false) {
  $("status-msg").textContent = msg;
  $("status-msg").style.color = isErr ? "#dc2626" : "#2563eb";
  // 错误提示用页内浮层而不是原生 alert：原生 alert 是模态对话框，会把主窗口置灰、
  // 弹窗没关掉时连窗口都关不了；页内浮层不阻塞、可复制、可叠加关闭。
  if (isErr) showModal(t("common.errorTitle"), String(msg));
}
function fillTable(tbodyId, rows, cols, onDbl) {
  const tb = document.querySelector(`#${tbodyId} tbody`) || $(tbodyId);
  tb.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    cols.forEach(c => {
      const td = document.createElement("td");
      td.textContent = typeof c === "function" ? c(r) : r[c];
      tr.appendChild(td);
    });
    if (onDbl) tr.ondblclick = () => onDbl(r, i);
    tb.appendChild(tr);
  });
}

// ---------------------------------------------------------------- tabs
// 第二列存「键名」而不是译文：模块级 const 在解析期求值，那时 setLang 还没跑，
// 存译文会把标签栏永久钉死在加载期语言上。
const TABS = [
  ["config", "tab.config", false], ["log", "tab.log", false], ["console", "tab.console", true],
  ["target", "tab.target", true], ["regs", "tab.regs", true], ["mem", "tab.mem", true],
  ["flash", "tab.flash", true], ["bp", "tab.bp", true], ["gdb", "tab.gdb", false],
  ["about", "tab.about", false],
];
function buildTabs() {
  const box = $("tabs");
  TABS.forEach(([id, key, needConn]) => {
    const el = document.createElement("div");
    el.textContent = t(key);
    el.dataset.page = id;
    el.dataset.i18nTab = key;
    el.dataset.needConn = needConn ? "1" : "";
    el.onclick = () => selectTab(id);
    box.appendChild(el);
  });
  selectTab("config");
}
// 切语言时就地改标签文字（不重建标签栏：buildTabs 末尾会 selectTab("config")，会把当前页跳走）
function refreshTabLabels() {
  document.querySelectorAll("#tabs div").forEach(el => {
    const key = el.dataset.i18nTab;
    if (key) el.textContent = t(key);
  });
}
function selectTab(id) {
  document.querySelectorAll("#tabs div").forEach(el =>
    el.classList.toggle("active", el.dataset.page === id));
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active", p.id === "page-" + id));
  if (id === "regs" && $("tcl-label").textContent.includes(t("tb.tcl.on")) &&
      !regRows.length && !regPending) refreshRegs();
  // 首次打开「关于」页时自动查一次 GitHub 上的最新版本（失败只写行内提示，不弹窗）
  if (id === "about" && !aboutChecked) { aboutChecked = true; checkUpdate(true); }
}
function setConnTabs(enabled) {
  document.querySelectorAll("#tabs div").forEach(el => {
    if (el.dataset.needConn) el.classList.toggle("disabled", !enabled);
  });
  TABS.filter(t => t[2]).forEach(([id]) => {
    if (enabled && (id === "target" || id === "bp")) {
      if (id === "target") refreshTargetsOnce();
      if (id === "bp") refreshBp();
    }
  });
  // 连接建立时若正停在寄存器页，立刻读一次，避免空白等自动刷新
  if (enabled && document.getElementById("page-regs")?.classList.contains("active")) {
    regRows = [];
    refreshRegs();
  }
}

// ---------------------------------------------------------------- settings <-> form
function formToSettings() {
  settings.lang = currentLangPref();
  settings.openocd_path = $("cfg-exe").value.trim();
  settings.scripts_dir = $("cfg-scripts").value.trim();
  const ifcSel = $("cfg-interface"), tgtSel = $("cfg-target");
  // settingsToForm 已把已保存值填进这两个输入框，之后输入框就是权威值：
  // 清空就写空（不再回填旧值），未设置脚本目录时同样成立
  settings.interface_cfg = ifcSel.value.trim();
  settings.target_cfg = tgtSel.value.trim();
  settings.extra_commands = $("cfg-cmds").value.split("\n").map(s => s.trim()).filter(s => s);
  for (const [k, id] of [["gdb_port", "cfg-gdb"], ["tcl_port", "cfg-tcl"], ["telnet_port", "cfg-telnet"]]) {
    const v = parseInt($(id).value);
    if (v > 0 && v < 65536) settings[k] = v;
  }
  settings.bind = $("cfg-bind").value.trim();
  settings.debug_level = $("cfg-debug").selectedIndex;
  settings.log_file = $("cfg-logfile").value.trim();
  settings.gdb_path = $("gdb-path").value.trim();
  settings.gdb_args = $("gdb-args").value.trim();
  settings.poll_interval_ms = Math.max(200, parseInt($("tg-interval").value) || 1000);
  settings.auto_poll = $("tg-auto").checked;
}
function settingsToForm() {
  migrateLegacyConfigs();
  $("cfg-exe").value = settings.openocd_path || "";
  $("cfg-scripts").value = settings.scripts_dir || "";
  // 此时两个输入框已用 settings 里的值填好（datalist 只是候选，不影响取值）
  syncCfgSelectValues(true);
  $("cfg-cmds").value = (settings.extra_commands || []).join("\n");
  $("cfg-gdb").value = settings.gdb_port; $("cfg-tcl").value = settings.tcl_port;
  $("cfg-telnet").value = settings.telnet_port;
  $("cfg-bind").value = settings.bind || "127.0.0.1";
  $("cfg-debug").selectedIndex = Math.max(0, Math.min(4, settings.debug_level || 0));
  $("cfg-logfile").value = settings.log_file || "";
  $("gdb-path").value = settings.gdb_path || "arm-none-eabi-gdb";
  $("gdb-args").value = settings.gdb_args || '-ex "target remote localhost:3333"';
  $("tg-interval").value = settings.poll_interval_ms || 1000;
  $("tg-auto").checked = settings.auto_poll !== false;
  updateGdbPreview();
  updateCfgPreview();
}
function updateGdbPreview() {
  $("gdb-preview").textContent = `${$("gdb-path").value} ${$("gdb-args").value}`;
  dynSet("gdb-info", () => t("gdb.info", { port: settings?.gdb_port ?? 3333 }));
  $("sb-ports").textContent = `GDB ${settings?.gdb_port} · TCL ${settings?.tcl_port} · Telnet ${settings?.telnet_port}`;
}

// ---------------------------------------------------------------- server control
// 状态文案按当前语言现取（不在模块初始化时就固定）；并记住状态与 TCL 连接，
// 语言重刷（applyI18n）之后再由 refreshDynamicLabels 写回，避免被 data-i18n 的静态文案覆盖。
const STATE_COLORS = { stopped: "#9ca3af", starting: "#f59e0b", running: "#10b981", stopping: "#f59e0b", failed: "#ef4444" };
const STATE_KEYS = ["stopped", "starting", "running", "stopping", "failed"];
let serverState = "stopped", tclOn = false;
// 动态文案登记表：语言切换（applyI18n 派发 i18n-applied）时按当前语言重算。
// 否则这些「JS 写出来」的文案会停在旧语言，或被 data-i18n 的静态文案打回。
const dynText = {};
function dynSet(id, render) { dynText[id] = render; const el = $(id); if (el) el.textContent = render(); }
function dynRefresh() { for (const id in dynText) { const el = $(id); if (el) el.textContent = dynText[id](); } }
function setServerState(state) {
  serverState = state;
  $("state-label").textContent = STATE_KEYS.indexOf(state) >= 0 ? t("state." + state) : String(state);
  $("state-dot").style.background = STATE_COLORS[state] || "#9ca3af";
  $("btn-start").disabled = !(state === "stopped" || state === "failed");
  $("btn-stop").disabled = !(state === "starting" || state === "running");
}
// 语言切换/重刷后把 JS 负责的动态文案按新语言重写一遍
function refreshDynamicLabels() {
  setServerState(serverState);
  $("tcl-label").textContent = tclOn ? t("tb.tcl.on") : t("tb.tcl.off");
  updateLangNote();
  // 这两处也是「动态文案 + 静态 data-i18n」双重身份，切换语言时必须按当前状态重写
  updateCfgPreview();
  renderScanLabel();
  updateGdbPreview();
  if (lastTargetState) $("target-label").textContent = t("tb.target", { v: lastTargetState });
  dynRefresh();
  refreshTabLabels();
  refreshLangSelect();
  // 表格的表头/占位/计数都是 JS 渲染的，切语言时按现有数据重画。
  // 内存表连表头都是 renderMem 生成的，所以「画过一次」也要重画（空数据时也不能把表头留成旧语言）。
  renderBpTable(); renderWpTable();
  if (regRows.length) renderRegs();
  if (memRows.length || $("mem-table").querySelector("thead")) renderMem();
}

// 关于页语言下拉：第一项「自动（跟随系统语言）」，其余来自 i18n 的 LANGS
function fillLangSelect() {
  const sel = $("about-lang");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = LANG_AUTO;
  auto.textContent = t("about.langAuto");
  sel.appendChild(auto);
  for (const l of langList()) {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = l.label;
    sel.appendChild(o);
  }
  sel.value = currentLangPref();
  sel.onchange = () => { setLang(sel.value); };
}

// 语言下拉里「自动」这一项的文字也要跟着语言走；只改已存在的 option，不重建（重建会丢选中）
function refreshLangSelect() {
  const sel = $("about-lang");
  if (!sel) return;
  const auto = sel.querySelector('option[value="' + LANG_AUTO + '"]');
  if (auto) auto.textContent = t("about.langAuto");
  for (const l of langList()) {
    const o = sel.querySelector('option[value="' + l.code + '"]');
    if (o) o.textContent = l.label;
  }
}

// 「当前显示：<语言>」+ 说明；语言变化后由 refreshDynamicLabels（i18n-applied）重刷
function updateLangNote() {
  const el = $("about-lang-note");
  if (!el) return;
  el.textContent = t("about.langNote", { label: langLabel(currentLang()) });
}
async function startServer() {
  formToSettings();
  invoke("log_msg", { msg: "startServer: begin" });
  try {
    await invoke("save_settings", { settings });
    await invoke("start_server", { settings });
    invoke("log_msg", { msg: "startServer: ok" });
  } catch (e) {
    invoke("log_msg", { msg: "startServer err: " + e });
    const s = String(e);
    // 后端用 E_STALE_TCL|<port>| 前缀报告「端口上还有残留 OpenOCD」
    if (s.startsWith("E_STALE_TCL|")) {
      notify(t("hint.stalePort", { port: s.split("|")[1] || "?" }), true);
    } else {
      notify(s, true);
    }
  }
}
async function stopServer() { try { await invoke("stop_server"); } catch (e) { notify(String(e), true); } }

// ---------------------------------------------------------------- log
const LOG_CLASS = { error: "err", warning: "warn", debug: "dbg", user: "inf", info: "" };
function logLevel(line) {
  const m = line.match(/^\s*(Debug|Info|User|Error|Warning)\s*:/i);
  return m ? m[1].toLowerCase() : "raw";
}
function appendLog(line) {
  const level = logLevel(line);
  logLines.push([level, line]);
  if (logLines.length > 20000) { logLines.splice(0, 1000); }
  if (logPassesFilter(level)) appendLogDiv(level, line);
}
function appendLogDiv(level, line) {
  const div = $("log-view");
  const span = document.createElement("div");
  if (LOG_CLASS[level]) span.className = LOG_CLASS[level];
  span.textContent = line;
  div.appendChild(span);
  if ($("log-autoscroll").checked) div.scrollTop = div.scrollHeight;
}
function logPassesFilter(level) {
  const f = $("log-filter").value;
  const sets = { "all": null, "info": ["info", "user", "warning", "error", "raw"],
    "warn": ["warning", "error", "raw"], "err": ["error", "raw"] };
  const allow = sets[f];
  return allow === null || allow.includes(level);
}
function rerenderLog() {
  $("log-view").innerHTML = "";
  for (const [level, line] of logLines.slice(-6000))
    if (logPassesFilter(level)) appendLogDiv(level, line);
}

// ---------------------------------------------------------------- console
const QUICK = ["poll", "targets", "version", "halt", "resume", "reset halt", "reset run",
  "reset init", "flash banks", "shutdown"];
function buildQuick() {
  QUICK.forEach(c => {
    const b = document.createElement("button");
    b.className = "btn"; b.textContent = c;
    b.onclick = () => sendConsole(c);
    $("quick-cmds").appendChild(b);
  });
}
async function sendConsole(cmd) {
  const div = $("console-view");
  const p = document.createElement("div");
  p.className = "prompt"; p.textContent = "openocd> " + cmd;
  div.appendChild(p);
  try {
    const res = await tclExec(cmd, 60000);
    const r = document.createElement("div");
    r.textContent = res || t("common.none");
    div.appendChild(r);
  } catch (e) {
    const r = document.createElement("div");
    r.className = "err"; r.textContent = t("common.err", { e: e });
    div.appendChild(r);
  }
  div.scrollTop = div.scrollHeight;
}

// ---------------------------------------------------------------- targets
async function refreshTargetsOnce() {
  try { const t = await invoke("refresh_targets"); onTargets(t); } catch {}
}
function onTargets(text) {
  targetRows = parseTargets(text);
  fillTable("tg-table", targetRows, [r => r.current ? "●" : "", "name", "type", "endian", "tap", "state"],
    (r) => { if (!r.current) tclExec(`targets ${r.name}`).then(refreshTargetsOnce); });
  const cur = targetRows.find(r => r.current) || targetRows[0];
  if (cur) {
    lastTargetState = cur.state;
    dynSet("target-label", () => t("tb.target", { v: lastTargetState || "—" }));
  }
}
async function targetAction(cmd) {
  const cur = targetRows.find(r => r.current) || targetRows[0];
  if (!cur) { notify(t("tg.none"), true); return; }
  try { await tclExec(cmd, 30000); } catch (e) { notify(t("common.cmdFail", { e: e }), true); }
  refreshTargetsOnce();
}

// ---------------------------------------------------------------- registers
async function refreshRegs() {
  if (regPending) return;
  regPending = true;
  dynSet("reg-status", () => t("reg.reading"));
  try {
    const text = await tclExec("reg", 20000);
    const { regs, err } = parseRegs(text);
    regRows = regs;
    if (regs.length) {
      dynSet("reg-status", () => t("reg.count", { n: regs.length }));
    } else {
      // 解析不出任何寄存器时把原始输出打到日志页，便于定位格式差异
      dynSet("reg-status", () => err || t("reg.unparsed"));
      appendLog("$ reg\n" + text);
    }
    renderRegs();
  } catch (e) { dynSet("reg-status", () => t("reg.readFail", { e: e })); }
  regPending = false;
}
function renderRegs() {
  const needle = $("reg-filter").value.trim().toLowerCase();
  const rows = regRows.filter(r => !needle || (r.name + " " + r.group).toLowerCase().includes(needle));
  fillTable("reg-table", rows,
    [r => r.num, r => r.group, r => r.name, r => "/" + r.size,
     r => r.value ? padHex(r.value, r.size) : "—", r => r.dirty ? "dirty" : ""],
    (r) => {
      const cur = r.value ? padHex(r.value, r.size) : "0x0";
      const nv = prompt(t("reg.prompt", { name: r.name }), cur);
      if (nv === null) return;
      const v = parseHex(nv);
      if (v === null) { notify(t("reg.needHex"), true); return; }
      tclExec(`reg ${r.name} 0x${v.toString(16)}`).then(refreshRegs)
        .catch(e => notify(t("reg.writeFail", { e: e }), true));
    });
}

// ---------------------------------------------------------------- memory
const MEM_WIDTHS = { "mdw": [4, "mdw", "mww"], "mdh": [2, "mdh", "mwh"],
  "mdb": [1, "mdb", "mwb"], "mdd": [8, "mdd", "mwd"] };
async function readMem(addr) {
  if (addr === undefined) {
    addr = parseHex($("mem-addr").value);
    if (addr === null) { notify(t("mem.badAddr"), true); return; }
  }
  const [size, rcmd] = MEM_WIDTHS[$("mem-width").value];
  memSize = size; memAddr = addr;
  const count = parseInt($("mem-count").value) || 160;
  dynSet("mem-status", () => t("mem.reading"));
  try {
    const text = await tclExec(`${rcmd} 0x${addr.toString(16)} ${count}`, 20000);
    memRows = parseMd(text);
    dynSet("mem-status", () => memRows.length ?
      t("mem.items", { n: memRows.reduce((n, [, v]) => n + v.length, 0) }) : t("mem.noData"));
    renderMem();
  } catch (e) { dynSet("mem-status", () => t("mem.readFail", { e: e })); }
}
function renderMem() {
  const perLine = 32 / memSize;
  let html = "<thead><tr><th>" + t("th.addr") + "</th>";
  for (let i = 0; i < perLine; i++) html += `<th>${(i * memSize).toString(16).toUpperCase()}</th>`;
  html += "<th>ASCII</th></tr></thead><tbody>";
  memRows.forEach(([addr, vals], r) => {
    html += `<tr><td>0x${addr.toString(16).toUpperCase().padStart(8, "0")}</td>`;
    for (let i = 0; i < perLine; i++)
      html += `<td data-r="${r}" data-i="${i}">${i < vals.length ? vals[i].toString(16).toUpperCase().padStart(memSize * 2, "0") : ""}</td>`;
    const raw = [];
    vals.forEach(v => {
      let x = v;
      for (let b = 0; b < memSize; b++) { raw.push(x & 0xff); x = Math.floor(x / 256); }
    });
    html += `<td>${raw.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : ".").join("")}</td></tr>`;
  });
  $("mem-table").innerHTML = html + "</tbody>";
  $("mem-table").querySelectorAll("td[data-r]").forEach(td => {
    td.ondblclick = () => {
      const r = +td.dataset.r, i = +td.dataset.i;
      const [rowAddr, vals] = memRows[r];
      if (i >= vals.length) return;
      const cellAddr = rowAddr + i * memSize;
      const [, , wcmd] = MEM_WIDTHS[$("mem-width").value];
      const nv = prompt(t("mem.prompt", { addr: cellAddr.toString(16).toUpperCase() }),
        "0x" + vals[i].toString(16).toUpperCase().padStart(memSize * 2, "0"));
      if (nv === null) return;
      const v = parseHex(nv);
      const lim = 2 ** (memSize * 8);   // 不能用 1 << (memSize*8)：JS 位移按 mod 32 取模，32/64 位会恒为 1
      if (v === null || v < 0 || v >= lim) {
        notify(t("mem.outOfRange", { max: lim, hex: "f".repeat(memSize * 2) }), true);
        return;
      }
      tclExec(`${wcmd} 0x${cellAddr.toString(16)} 0x${v.toString(16)}`)
        .then(() => readMem(memAddr)).catch(e => notify(t("mem.writeFail", { e: e }), true));
    };
  });
}
function memPage(dir) {
  const count = parseInt($("mem-count").value) || 160;
  const next = memAddr + dir * count * memSize;
  $("mem-addr").value = "0x" + next.toString(16).toUpperCase().padStart(8, "0");
  readMem(next);
}

// ---------------------------------------------------------------- flash
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// 跑一条 OpenOCD 操作，并把期间 OpenOCD 打到 stdout/stderr 的日志一起收回来
// （烧写 / 擦除的进度、** Programming Finished **、Verified OK 都在那里）。
async function runWithLog(fn, drainMs) {
  const from = logLines.length;   // 日志页同一个缓冲：先记位置，回来再取增量
  let res = "", err = null;
  try { res = await fn(); } catch (e) { err = e; }
  await sleepMs(drainMs || 350);  // 等管道里最后几行流过来
  const log = logLines.slice(from).map(([, l]) => l).join("\n").trim();
  return { res: String(res || "").trim(), log, err };
}
// OpenOCD 常在 TCL 结果里回一段错误文本而不是失败状态，这里挑出第一行错误作为失败依据
function failLine(text) {
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // 只认错误行：日志级别是 Warn/Info/Debug 的行即使含 could not / Unable to 也不算失败
    // 带日志级别前缀的行只当噪声：除非这行本身写了 Error，否则 Warn/Info/Debug/User 不算失败
    const lvl = line.match(/^(Warn|Info|Debug|User)\s*:/i);
    if (lvl && !/\bError\b/i.test(line)) continue;
    const m = line.match(/.{0,80}\b(Error\b|Unable to|could not|failed to).{0,80}/i);
    if (m) return m[0].trim();
  }
  return "";
}
// OpenOCD 会把同一条错误既写进 stderr（日志页已收）又当作 TCL 响应文本回一份，展示前去重
function flashParts(r) {
  const log = String(r.log || "");
  const res = String(r.res || "").trim();
  const parts = [];
  if (log) parts.push(log);
  // res 与 log 可能部分重叠（同一条错误 + 附加一行），也可能是反向包含：逐行去掉 log 里已有的行
  if (res && log.indexOf(res) < 0) {
    const have = new Set(log.split("\n").map((s) => s.trim()));
    const extra = res.split("\n").filter((l) => l.trim() && !have.has(l.trim()));
    if (extra.length) parts.push(extra.join("\n"));
  }
  return parts;
}
function showFlashOut(parts) {
  const text = parts.filter(Boolean).join("\n");
  $("flash-out").textContent = text || t("fl.executed");
  $("flash-out").scrollTop = 0;
}

async function programFirmware() {
  const path = $("fl-file").value.trim();
  if (!path) { notify(t("fl.needFile"), true); return; }
  $("fl-program").disabled = true;
  dynSet("fl-status", () => t("fl.running"));
  $("flash-out").textContent = t("fl.programStarted");
  const r = await runWithLog(() => invoke("program_firmware", {
    path, offset: $("fl-offset").value.trim(),
    preverify: $("fl-preverify").checked, verify: $("fl-verify").checked,
    reset: $("fl-reset").checked }));
  showFlashOut(flashParts(r));
  const fb = r.err ? null : failLine(r.res + "\n" + r.log);
  if (r.err || fb) {
    dynSet("fl-status", () => t("fl.failed"));
    notify(t("fl.programFail", { e: r.err || fb }), true);
    appendLog("Error: " + (r.err || fb));
  } else {
    dynSet("fl-status", () => t("fl.done"));
    refreshTargetsOnce();
  }
  $("fl-program").disabled = false;
}
async function refreshBanks() {
  try {
    const text = await tclExec("flash banks");
    const banks = parseBanks(text);
    fillTable("fl-table", banks, [b => b.num, b => b.name, b => b.driver, b => b.base,
      b => b.size, b => b.bus, b => b.chip]);
    if (!banks.length) $("flash-out").textContent = text || t("fl.noBanks");
  } catch (e) { $("flash-out").textContent = t("fl.banksFail", { e: e }); }
}
async function flashInfo() {
  try { $("flash-out").textContent = await tclExec(`flash info ${$("fl-bank-num").value || "0"}`, 30000) || t("common.none"); }
  catch (e) { $("flash-out").textContent = t("fl.infoFail", { e: e }); }
}
async function eraseSectors() {
  const cmd = `flash erase_sector ${$("fl-bank-num").value || "0"} ${$("fl-first").value || "0"} ${$("fl-last").value || "last"}`;
  const r = await runWithLog(() => tclExec(cmd, 120000));
  const fb = r.err ? null : failLine(r.res + "\n" + r.log);
  if (r.err || fb) { dynSet("fl-status", () => t("fl.failed")); notify(t("fl.eraseFail", { e: r.err || fb }), true); return; }
  showFlashOut(flashParts(r));
  appendLog(t("fl.eraseDone"));
  flashInfo();
}

// ---------------------------------------------------------------- breakpoints
let bpSel = -1, wpSel = -1;   // 表格里被单击选中的行（-1 = 未选中）
function renderBpTable() {
  if (bpSel >= bpRows.length) bpSel = -1;   // 行数变化时先收拢选中索引，避免高亮错位
  const tb = document.querySelector("#bp-table tbody");
  tb.innerHTML = "";
  const cnt = $("bp-count");
  if (cnt) cnt.textContent = bpRows.length ? t("bp.count", { n: bpRows.length }) : "";
  if (!bpRows.length) {
    // 空表很容易被误读成“功能坏了”，放一行占位说明
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5; td.className = "muted";
    td.textContent = t("bp.empty");
    tr.appendChild(td); tb.appendChild(tr);
    return;
  }
  bpRows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === bpSel) tr.className = "sel";
    const cells = [(r.num !== "" && r.num !== undefined) ? r.num : String(i + 1),
                   r.type, r.addr || (r.asid ? "ctx " + r.asid : ""), r.len || "",
                   r.note || (r.asid && !r.addr ? "asid=" + r.asid : "")];
    cells.forEach(v => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
    tr.onclick = () => { bpSel = (bpSel === i ? -1 : i); renderBpTable(); };
    tb.appendChild(tr);
  });
}
function renderWpTable() {
  if (wpSel >= wpRows.length) wpSel = -1;   // 同上
  const tb = document.querySelector("#wp-table tbody");
  tb.innerHTML = "";
  const cnt = $("wp-count");
  if (cnt) cnt.textContent = wpRows.length ? t("wp.count", { n: wpRows.length }) : "";
  if (!wpRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6; td.className = "muted";
    td.textContent = t("wp.empty");
    tr.appendChild(td); tb.appendChild(tr);
    return;
  }
  wpRows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === wpSel) tr.className = "sel";
    [String(i + 1), r.addr, r.len, r.rw, r.value, r.mask].forEach(v => {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    });
    tr.onclick = () => { wpSel = (wpSel === i ? -1 : i); renderWpTable(); };
    tb.appendChild(tr);
  });
}
async function refreshBp() {
  bpRefreshErr = ""; wpRefreshErr = "";
  try {
    const bpText = String(await tclExec("bp") || "");
    bpRows = parseBp(bpText);
    if (bpText.trim() && !bpRows.length) appendLog(t("bp.parseFailLog", { t: bpText.trim() }));
  } catch (e) { bpRows = []; bpRefreshErr = String(e); appendLog(t("bp.readFailLog", { e: e })); }
  try {
    const wpText = String(await tclExec("wp") || "");
    wpRows = parseWp(wpText);
    if (wpText.trim() && !wpRows.length) appendLog(t("wp.parseFailLog", { t: wpText.trim() }));
  } catch (e) { wpRows = []; wpRefreshErr = String(e); appendLog(t("wp.readFailLog", { e: e })); }
  const bh = $("bp-hint"), wh = $("wp-hint");
  // 刷新成功时只清掉“本函数自己写的那条”失败文案，不覆盖 bpCmd 留下的执行结果
  const ownHint = (el, marker, err, label) => {
    if (!el) return;
    if (err) { el.textContent = t("x.hint.suffix", { label: label, err: err }); el.style.color = "#dc2626"; }
    else if (el.textContent.indexOf(marker) === 0) { el.textContent = ""; el.style.color = ""; }
  };
  ownHint(bh, t("bp.listFail"), bpRefreshErr, t("bp.listFail"));
  ownHint(wh, t("wp.listFail"), wpRefreshErr, t("wp.listFail"));
  renderBpTable(); renderWpTable();
}
// 自动检测到的多个候选 → 填进 datalist，路径框点开即可选另一个
function fillCandidateList(datalistId, cands) {
  const dl = $(datalistId);
  if (!dl) return;
  dl.innerHTML = "";
  for (const c of cands) {
    const o = document.createElement("option");
    o.value = c;
    dl.appendChild(o);
  }
}
// 地址类 TCL 命令的失败原因：一条数值地址之外的写法（符号名、表达式）会被 OpenOCD 拒绝
function bpErrTip(token) {
  if (token && !/^0x[0-9a-f]+$/i.test(token))
    return t("x.err.shape");
  return "";
}
// OpenOCD 的 breakpoint_add/watchpoint_add 失败时只写自己的日志，不回 TCL；
// 所以“返回空串”不等于成功——成败以「重新列一遍，看条目数是否按预期变化」为准。
async function bpCmd(cmd, refresh = true) {
  const isWp = /^r?wp\b/.test(cmd);
  const hint = $(isWp ? "wp-hint" : "bp-hint");
  const show = (line, ok) => {
    if (hint) { hint.textContent = line; hint.style.color = ok ? "#15803d" : "#dc2626"; }
    appendLog((ok ? "User: " : "Error: ") + line);
  };
  const before = isWp ? wpRows.length : bpRows.length;
  let text = "";
  try {
    text = String(await tclExec(cmd, 15000) || "").trim();
  } catch (e) {
    show(t("x.cmd.fail", { cmd: cmd, e: e }), false);
    notify(t("common.cmdFail", { e: e }), true);
    return;
  }
  const one = text.replace(/\s*\n\s*/g, " | ");
  if (refresh) await refreshBp();
  const rerr = isWp ? wpRefreshErr : bpRefreshErr;
  if (rerr) {   // 列表本身都没读到 → 不能拿旧条目数判成败
    show(t("x.cmd.noConfirm", { cmd: cmd, err: rerr }), false);
    notify(t("x.list.noConfirm"), true);
    return;
  }
  const after = isWp ? wpRows.length : bpRows.length;
  const addOp = /^(bp|wp)\s+\S/.test(cmd);
  const delAll = /^(rbp|rwp)\s+all\b/.test(cmd);
  const delOne = /^(rbp|rwp)\s+(?!all\b)\S/.test(cmd);
  let ok = true;
  if (delAll) ok = (after === 0);
  else if (addOp) ok = (after === before + 1);
  else if (delOne) ok = (after === before - 1);
  if (ok && /^(?:addr option value|error|Error|not halted)/i.test(text)) ok = false;
  const cntTxt = t("x.cmd.count", { n: after });
  if (ok) {
    show(t("x.cmd.ok", { cmd: cmd, one: one || "ok" }) + cntTxt, true);
    notify(t("x.cmd.executed", { cmd: cmd }));
  } else {
    const m = cmd.match(/^(?:r?wp|r?bp)\s+(\S+)/);
    let tip;
    const shapeTip = bpErrTip(m ? m[1] : "");
    if (shapeTip) tip = shapeTip;
    else if (addOp) tip = t("x.tip.addOp", { before: before, after: after });
    else tip = t("x.tip.other", { before: before, after: after });
    show(t("x.cmd.failPrefix", { cmd: cmd + (one ? " → " + one : "") }) + " " + tip + cntTxt, false);
    notify(t("x.cmd.notifyFail"), true);
  }
}

// 断点/观察点地址与长度的硬约束：长度只能 1/2/4，且地址要按长度对齐
function bpAlignTip(a, lenN) {
  if (!/^0x[0-9a-f]+$/i.test(a || "")) return "";
  if (![1, 2, 4].includes(lenN)) return t("x.len.bad", { len: lenN });
  const n = parseInt(a, 16);
  if (n % lenN !== 0) {
    const fixed = (Math.floor(n / lenN) * lenN).toString(16);
    return t("x.align.bad", { len: lenN, addr: a, fixed: fixed.padStart(a.length - 2, "0") });
  }
  return "";
}

// ---------------------------------------------------------------- boot
let booted = false;
async function boot() {
  if (booted) return;   // 幂等：重复调用（热重载 / 探针）不再叠加事件监听
  booted = true;
  document.addEventListener("i18n-applied", refreshDynamicLabels);
  settings = await invoke("get_settings");
  // 设置文件解析失败时后端会保留原文件并回落默认值，这里必须让用户看见
  try {
    const le = await invoke("settings_load_error");
    if (le) { appendLog("Warn : " + le); showModal(t("common.errorTitle"), t("common.settingsBad") + "\n\n" + le); }
  } catch {}
  setLang((settings && settings.lang) ? settings.lang : LANG_AUTO);
  applyI18n();
  refreshDynamicLabels();
  fillLangSelect();
  buildTabs();
  buildQuick();
  settingsToForm();
  setServerState("stopped");
  rescanScripts();

  // backend events
  await listen("log", (e) => appendLog(e.payload));
  // 后端只发键名，文案在 i18n 表里（如 hint.accessFail）
  await listen("ocd-hint", (e) => appendLog(t(String(e.payload))));
  await listen("server-state", (e) => {
    setServerState(e.payload);
    if (e.payload === "failed") refreshBanksStub();
  });
  await listen("tcl-state", (e) => {
    const on = e.payload === true;
    tclOn = on;
    $("tcl-label").textContent = on ? t("tb.tcl.on") : t("tb.tcl.off");
    $("tcl-label").style.color = on ? "#059669" : "#6b7280";
    setConnTabs(on);
    if (on) refreshTargetsOnce();
  });
  await listen("targets", (e) => onTargets(e.payload));

  // config page
  $("btn-start").onclick = startServer;
  $("btn-stop").onclick = stopServer;
  $("cfg-exe-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: EXE_FILTERS() });
    if (f) $("cfg-exe").value = f;
  };
  $("cfg-scripts-browse").onclick = async () => {
    const d = await dialogOpen({ directory: true });
    if (d) { $("cfg-scripts").value = d; rescanScripts(); }
  };
  $("cfg-autodetect").onclick = async () => {
    const cands = await invoke("detect_openocd");
    if (!cands.length) { notify(t("ocd.notFound"), true); return; }
    fillCandidateList("cfg-exe-list", cands);
    if (cands.length > 1) { openocdPicker(cands); return; }
    applyOpenocd(cands[0]);
  };
  $("cfg-version").onclick = queryVersion;
  $("cfg-rescan").onclick = rescanScripts;
  $("cfg-interface").oninput = $("cfg-target").oninput = updateCfgPreview;
  $("cfg-interface-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS() });
    if (!f) return;
    $("cfg-interface").value = f;
    updateCfgPreview();
  };
  $("cfg-target-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS() });
    if (!f) return;
    $("cfg-target").value = f;
    updateCfgPreview();
  };
  $("cfg-interface-clear").onclick = () => { $("cfg-interface").value = ""; updateCfgPreview(); };
  $("cfg-target-clear").onclick = () => { $("cfg-target").value = ""; updateCfgPreview(); };
  $("cfg-interface-preview").onclick = () => previewCfgOne("interface");
  $("cfg-target-preview").onclick = () => previewCfgOne("target");
  $("cfg-logfile-browse").onclick = async () => {
    try {
      const f = await dialogSave({
        defaultPath: $("cfg-logfile").value.trim() || "openocd.log",
        filters: [{ name: t("filter.log"), extensions: ["log", "txt"] },
                  { name: t("filter.all"), extensions: ["*"] }],
      });
      if (f) { $("cfg-logfile").value = f; notify(t("cfg.logfile.set", { f: f })); }
    } catch (e) { notify(t("cfg.logfile.pickFail", { e: e }), true); }
  };
  $("cfg-logfile-clear").onclick = () => { $("cfg-logfile").value = ""; notify(t("cfg.logfile.cleared")); };
  $("profile-save").onclick = async () => {
    formToSettings();
    const name = prompt(t("cfg.preset.prompt"));
    if (!name) return;
    try {
      const saved = await invoke("save_profile", { name, settings });
      await reloadProfiles(); $("profile-select").value = saved;
      notify(t("cfg.preset.saved", { n: saved }));
    } catch (e) { notify(String(e), true); }
  };
  $("profile-load").onclick = async () => {
    const name = $("profile-select").value;
    if (!name) { notify(t("cfg.preset.needPick"), true); return; }
    const p = await invoke("load_profile", { name });
    if (!p) { notify(t("cfg.preset.loadFail", { n: name }), true); return; }
    settings = Object.assign({}, settings, p);
    settingsToForm(); rescanScripts(); queryVersion();
    notify(t("cfg.preset.loaded", { n: name }));
  };
  $("profile-delete").onclick = async () => {
    const name = $("profile-select").value;
    if (name && confirm(t("cfg.preset.confirmDel", { n: name }))) {
      await invoke("delete_profile", { name }); reloadProfiles();
    }
  };
  await reloadProfiles();

  // log / console
  $("log-filter").onchange = rerenderLog;
  $("log-clear").onclick = () => { logLines = []; rerenderLog(); };
  $("log-copy").onclick = () =>
    navigator.clipboard.writeText(logLines.map(([, l]) => l).join("\n")).then(() => notify(t("log.copied")));
  $("console-send").onclick = () => { const v = $("console-input").value.trim();
    if (v) { $("console-input").value = ""; sendConsole(v); } };
  $("console-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") $("console-send").click();
    if (ev.key === "ArrowUp" && consoleHistory.length) {
      histIdx = Math.max(0, histIdx < 0 ? consoleHistory.length - 1 : histIdx - 1);
      $("console-input").value = consoleHistory[histIdx]; ev.preventDefault();
    }
    if (ev.key === "ArrowDown" && histIdx >= 0) {
      histIdx = histIdx < consoleHistory.length - 1 ? histIdx + 1 : -1;
      $("console-input").value = histIdx < 0 ? "" : consoleHistory[histIdx]; ev.preventDefault();
    }
  });

  // targets
  $("tg-refresh").onclick = refreshTargetsOnce;
  $("tg-halt").onclick = () => targetAction("halt");
  $("tg-resume").onclick = () => targetAction("resume");
  $("tg-srst").onclick = () => targetAction("soft_reset_halt");
  $("tg-reset").onclick = () => targetAction("reset " + $("tg-reset-mode").value);
  $("tg-auto").onchange = () => { formToSettings();
    // 保存失败（例如设置文件被占用导致改名失败）必须让用户看见，不能无声无息
    invoke("save_settings", { settings }).catch((e) => notify(String(e), true));
    invoke("set_poll_enabled", { enabled: $("tg-auto").checked }); };

  // registers
  $("reg-refresh").onclick = refreshRegs;
  $("reg-filter").oninput = renderRegs;
  regTimer = setInterval(() => {
    if ($("reg-auto").checked && lastTargetState === "halted" &&
        $("tcl-label").textContent.includes(t("tb.tcl.on")) && !regPending) refreshRegs();
  }, 1000);

  // memory
  $("mem-read").onclick = () => readMem();
  $("mem-prev").onclick = () => memPage(-1);
  $("mem-next").onclick = () => memPage(1);

  // flash
  $("fl-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: FIRMWARE_FILTERS() });
    if (f) $("fl-file").value = f;
  };
  $("fl-program").onclick = programFirmware;
  $("fl-banks-refresh").onclick = refreshBanks;
  $("fl-info").onclick = flashInfo;
  $("fl-erase").onclick = eraseSectors;

  // breakpoints
  $("bp-add").onclick = () => {
    const a = addrToken($("bp-addr").value);
    if (a === null) { notify(t("bp.needAddr"), true); return; }
    const alignTip = bpAlignTip(a, parseInt($("bp-len").value, 10));
    if (alignTip) { notify(alignTip, true); return; }
    let cmd = `bp ${a} ${$("bp-len").value}`;
    if ($("bp-type").selectedIndex === 1) cmd += " hw";
    bpCmd(cmd);
  };
  $("bp-del").onclick = () => {
    const row = bpRows[bpSel];
    if (!row) { notify(t("bp.delNone"), true); return; }
    if (!row.addr) { notify(t("bp.delCtx"), true); return; }
    bpCmd(`rbp ${row.addr}`);
    bpSel = -1;
  };
  $("bp-delall").onclick = () => { if (confirm(t("bp.confirmDelAll"))) bpCmd("rbp all"); };
  $("bp-refresh").onclick = refreshBp;
  $("wp-add").onclick = () => {
    const a = addrToken($("wp-addr").value);
    if (a === null) { notify(t("wp.needAddr"), true); return; }
    const alignTip = bpAlignTip(a, parseInt($("wp-len").value, 10));
    if (alignTip) { notify(alignTip, true); return; }
    const rw = ["r", "w", "a"][$("wp-access").selectedIndex];
    let cmd = `wp ${a} ${$("wp-len").value} ${rw}`;
    const vRaw = $("wp-value").value.trim();
    if (vRaw) {
      const v = numToken(vRaw);
      if (v === undefined) { notify(t("wp.badValue"), true); return; }
      cmd += " " + v;
      const mRaw = $("wp-mask").value.trim();
      if (mRaw) {
        const m = numToken(mRaw);
        if (m === undefined) { notify(t("wp.badMask"), true); return; }
        cmd += " " + m;
      }
    }
    bpCmd(cmd);
  };
  $("wp-del").onclick = () => {
    const row = wpRows[wpSel];
    if (!row) { notify(t("wp.delNone"), true); return; }
    bpCmd(`rwp ${row.addr}`);
    wpSel = -1;
  };
  $("wp-delall").onclick = () => { if (confirm(t("wp.confirmDelAll"))) bpCmd("rwp all"); };
  $("wp-refresh").onclick = refreshBp;

  // gdb
  $("gdb-path").oninput = $("gdb-args").oninput = updateGdbPreview;
  $("gdb-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: GDB_FILTERS() });
    if (!f) return;
    $("gdb-path").value = f; updateGdbPreview();
  };
  $("gdb-autodetect").onclick = async () => {
    let cands = [];
    try { cands = await invoke("detect_gdb"); } catch (e) { notify(t("gdb.detectFail", { e: e }), true); return; }
    if (!cands || !cands.length) { notify(t("gdb.notFound"), true); return; }
    fillCandidateList("gdb-path-list", cands);
    if (cands.length > 1) {
      showModal(t("gdb.pickTitle", { n: cands.length }),
        cands.map((c, k2) => (k2 + 1) + ") " + c).join("\n") + "\n\n" + t("common.choice.pickAll"),
        cands.map((c) => ({ label: shortExe(c), onPick: () => applyGdb(c) })));
      notify(t("gdb.multi", { n: cands.length }));
      return;
    }
    applyGdb(cands[0]);
  };
  $("gdb-version").onclick = async () => {
    const gexe = $("gdb-path").value.trim();
    if (!gexe) { notify(t("gdb.needPath"), true); return; }
    await showVersion(gexe, $("gdb-version-label"));
  };
  $("gdb-copy").onclick = () => {
    navigator.clipboard.writeText(`${$("gdb-path").value} ${$("gdb-args").value}`)
      .then(() => notify(t("gdb.copied")));
  };
  $("gdb-launch").onclick = async () => {
    try { await invoke("launch_gdb", { gdb: $("gdb-path").value, args: $("gdb-args").value });
      notify(t("gdb.launched")); }
    catch (e) { notify(t("gdb.launchFail", { e: e }), true); }
  };

  // about 页
  try { $("about-version").textContent = "v" + await invoke("app_version"); } catch (e) {}
  try { $("about-configdir").textContent = await invoke("config_dir_path"); } catch (e) {}
  $("about-detect").onclick = async () => {
    const exe = $("cfg-exe").value.trim();
    if (!exe) { notify(t("ocd.needPath"), true); return; }
    $("about-openocd-path").textContent = exe;
    const v = await showVersion(exe, $("about-openocd"), () => "");
    if (!v) notify(t("ocd.version.fail"), true);
  };
  $("about-open-configdir").onclick = async () => {
    try { await invoke("open_path", { path: $("about-configdir").textContent }); }
    catch (e) { notify(String(e), true); }
  };
  document.querySelectorAll("#page-about .link").forEach(b => {
    b.onclick = async () => {
      try { await invoke("open_url", { url: b.dataset.url }); notify(t("common.opened", { u: b.dataset.url })); }
      catch (e) { notify(t("common.openFail", { e: e }), true); }
    };
  });
  $("about-check-update").onclick = () => checkUpdate(false);
  $("about-open-release").onclick = async () => {
    const u = $("about-open-release").dataset.url;
    if (!u) { notify(t("up.needCheck"), true); return; }
    try { await invoke("open_url", { url: u }); notify(t("common.opened", { u: u })); }
    catch (e) { notify(t("common.openFail", { e: e }), true); }
  };
  $("about-release-notes").onclick = () => {
    if (!updateInfo || !updateInfo.notes) { notify(t("up.noNotes"), true); return; }
    showModal(t("up.notesTitle", { tag: updateInfo.tag }), updateInfo.notes);
  };

  // 只读预览弹窗
  $("modal-close").onclick = hideModal;
  $("modal-copy").onclick = () => navigator.clipboard.writeText($("modal-body").textContent)
    .then(() => notify(t("common.copied")));
  $("modal").onclick = (e) => { if (e.target === $("modal")) hideModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideModal(); });

  consoleHistory = [];

  // test hook: OPENOCD_GUI_AUTOSTART=1 makes the backend press Start for us
  invoke("log_msg", { msg: "boot: end of bindings" });
  if (await invoke("is_autostart")) {
    invoke("log_msg", { msg: "autostart triggered" });
    await new Promise(r => setTimeout(r, 500));
    await startServer();
  }
}

function refreshBanksStub() {}
async function queryVersion() {
  const exe = $("cfg-exe").value.trim();
  if (!exe) { notify(t("ocd.needPath"), true); return; }
  await showVersion(exe, $("cfg-version-label"));
}
// 把某个可执行文件 --version 的首行写进指定元素；返回版本串（检测失败为空串）
async function showVersion(exe, el, prefix = () => t("common.version.prefix")) {
  const pf = typeof prefix === "function" ? prefix : () => String(prefix);
  let v = "";
  const render = () => pf() + (v || t("common.version.none"));
  dynSet(el.id, render);
  el.textContent = pf() + t("common.version.checking");
  try { v = String((await invoke("query_version", { exe })) || "").split("\n")[0].trim(); } catch (e) { v = ""; }
  el.textContent = render();
  return v;
}

// ---------------------------------------------------------------- 检查更新
let updateInfo = null;
let aboutChecked = false;
let upRender = null;   // 更新检查那行文案的当前渲染器，切语言时重算
// 查 GitHub 上的最新版本：先 releases/latest，没有 Release 就退到 tags（后端用 curl/wget）
async function checkUpdate(auto) {
  const st = $("about-update-status");
  const openBtn = $("about-open-release"), notesBtn = $("about-release-notes");
  st.style.color = "";
  upRender = () => t("up.checking");
  dynSet("about-update-status", () => upRender());
  openBtn.style.display = "none";
  notesBtn.style.display = "none";
  try {
    const r = await invoke("check_update");
    updateInfo = r;
    // via/when 也放进渲染器里现算，否则切语言时留着旧语言的拼接片段
    const source = r.source, publishedAt = r.published_at;
    const parts = () => ({
      via: source === "tags" ? t("up.viaTag") : t("up.viaRelease"),
      when: publishedAt ? t("up.published", { d: String(publishedAt).slice(0, 10) }) : ""
    });
    if (r.has_update) {
      upRender = () => t("up.new", { tag: r.tag, cur: r.current, via: parts().via, when: parts().when });
      st.textContent = upRender();
      st.style.color = "#b45309";
      notify(t("up.newNotify", { tag: r.tag, cur: r.current }));
    } else {
      upRender = () => t("up.latest", { cur: r.current, tag: r.tag, via: parts().via, when: parts().when });
      st.textContent = upRender();
      st.style.color = "#15803d";
    }
    if (r.url) { openBtn.dataset.url = r.url; openBtn.style.display = ""; }
    if (r.notes && String(r.notes).trim()) notesBtn.style.display = "";
  } catch (e) {
    upRender = () => t("up.fail", { e: e });
    st.textContent = upRender();
    st.style.color = "#b91c1c";
    if (!auto) notify(t("up.failNotify", { e: e }), true);
  }
}
// ---------------------------------------------------------------- 只读预览弹窗
function showModal(title, text, choices) {
  $("modal-title").textContent = title;
  $("modal-body").textContent = text;
  const box = $("modal-choices");
  box.innerHTML = "";
  if (choices && choices.length) {
    choices.forEach((c) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = c.label;
      b.onclick = () => { hideModal(); c.onPick(); };
      box.appendChild(b);
    });
    box.style.display = "";
  } else { box.style.display = "none"; }
  $("modal").classList.add("open");
}
function hideModal() { $("modal").classList.remove("open"); }
function isAbsPath(v) {
  if (!v) return false;
  if (v.charCodeAt(0) === 47) return true;                                  // /usr/...
  if (/^[A-Za-z]:/.test(v)) return true;                                    // C:\...
  return v.charCodeAt(0) === 92 && v.charCodeAt(1) === 92;                  // \\server
}
function stripTrailingSlash(s) {
  let e = s.length;
  while (e > 0 && (s.charCodeAt(e - 1) === 47 || s.charCodeAt(e - 1) === 92)) e--;
  return s.slice(0, e);
}
// 查看 cfg 内容：接口/目标两份 cfg 的只读全文（相对名按脚本目录解析）
// 自动检测到多个 OpenOCD → 弹窗选择（也可以直接在路径框下拉里换）
function openocdPicker(cands) {
  showModal(t("ocd.pickTitle", { n: cands.length }),
    cands.map((c, k2) => (k2 + 1) + ") " + c).join("\n") + "\n\n" + t("common.choice.pickAll"),
    cands.map((c) => ({ label: shortExe(c), onPick: () => applyOpenocd(c) })));
  notify(t("ocd.multi", { n: cands.length }));
}
async function applyOpenocd(p) {
  $("cfg-exe").value = p;
  const g = await invoke("guess_scripts", { exe: p });
  if (g) { $("cfg-scripts").value = g; rescanScripts(); }
  queryVersion();
  notify(t("common.selected", { p: p }));
}
// 只留最后两段路径，便于在按钮上辨认
function shortExe(p) { return String(p).split(/[\\/]/).slice(-2).join("/"); }

function applyGdb(p) {
  $("gdb-path").value = p;
  updateGdbPreview();
  notify(t("common.selected", { p: p }));
}

async function previewCfgOne(which) {
  const dir = stripTrailingSlash($("cfg-scripts").value.trim());
  const isIfc = which === "interface";
  const label = isIfc ? t("prev.ifc") : t("prev.tgt");
  const v = (isIfc ? $("cfg-interface") : $("cfg-target")).value.trim();
  if (!v) { notify(t("prev.need", { which: label }), true); return; }
  const rel = !isAbsPath(v);
  const abs = rel ? (dir ? dir + "/" + v : v) : v;
  let body;
  try { body = await invoke("read_text_file", { path: abs }); }
  catch (e) { body = t("prev.readFail", { e: e }); }
  if (rel && !dir) body = t("prev.noScripts") + body;
  showModal(t("prev.title", { label: label }), t("prev.body", { v: v, abs: abs, body: body }));
}
// ---------------------------------------------------------------- cfg 选择与文件过滤器
// 这些过滤器的 name 要按「打开对话框那一刻」的语言现算：写成模块级常量会在解析期
// 求值（那时 setLang 还没跑），原生文件对话框的「文件类型」下拉就会钉死在启动语言上。
function FIRMWARE_FILTERS() {
  return [
    { name: t("filter.firmware"),
      extensions: ["bin", "hex", "elf", "axf", "out", "mot", "s19", "icf"] },
    { name: t("filter.elf"), extensions: ["elf", "axf", "out"] },
    { name: t("filter.hexrec"), extensions: ["hex", "mot", "s19"] },
    { name: t("filter.bin"), extensions: ["bin"] },
    { name: t("filter.all"), extensions: ["*"] },
  ];
}
function CFG_FILTERS() {
  return [
    { name: t("filter.cfg"), extensions: ["cfg"] },
    { name: t("filter.all"), extensions: ["*"] },
  ];
}
function EXE_FILTERS() {
  return [
    { name: t("filter.exe"), extensions: ["exe"] },
    { name: t("filter.all"), extensions: ["*"] },
  ];
}
function GDB_FILTERS() {
  return [
    { name: t("filter.gdbexe"), extensions: ["exe"] },
    { name: t("filter.all"), extensions: ["*"] },
  ];
}
let scriptLists = { interface: [], target: [], board: [] };
let lastScan = null;   // 上次 scan_scripts 的结果：null / { kind: "count", i, t, b } / { kind: "failed", e }
                       // 存数据而不是成品字符串，切换语言时才能用另一种语言重新渲染

// 旧版“每行一个、按加载顺序”的有序列表 → 接口/目标两个单选字段（一次性迁移）
function migrateLegacyConfigs() {
  settings.interface_cfg = settings.interface_cfg || "";
  settings.target_cfg = settings.target_cfg || "";
  if (settings.interface_cfg.trim() || settings.target_cfg.trim()) {
    settings.configs = []; return;
  }
  const old = settings.configs || [];
  if (!old.length) return;
  const isIfc = (c) => /(^|[\/\\])interface\//i.test(c) ||
    (!/^(target|board)[\/\\]/i.test(c) &&
     /cmsis|stlink|jlink|ftdi|dap|ft2232|ulink|vsllink|usb_blaster|bitbang|parport|sysfsgpio/i.test(c));
  const ifc = old.find(isIfc) || "";
  const rest = old.filter(c => c !== ifc);
  settings.interface_cfg = ifc;
  settings.target_cfg = rest[0] || "";
  settings.configs = [];
}

function updateCfgPreview() {
  const parts = [];
  const i = $("cfg-interface").value.trim(), tgt = $("cfg-target").value.trim();
  if (i) parts.push("-f " + i);
  if (tgt) parts.push("-f " + tgt);
  $("cfg-order-preview").textContent =
    parts.length ? t("cfg.order", { parts: parts.join(" ") }) : t("cfg.order.empty");
  updateCfgWarning();
}
// 手输的名字若不在脚本库扫描结果里，提示一下（仍按原样传给 OpenOCD，不拦截）
function updateCfgWarning() {
  const el = $("cfg-warn");
  if (!el) return;
  const known = { ifc: scriptLists.interface || [], tgt: (scriptLists.target || []).concat(scriptLists.board || []) };
  const bad = [];
  const pairs = [[t("cfg.pair.ifc"), $("cfg-interface").value.trim(), known.ifc],
                 [t("cfg.pair.tgt"), $("cfg-target").value.trim(), known.tgt]];
  for (const x of pairs) {
    const label = x[0], v = x[1], list = x[2];
    if (!v || isAbsPath(v)) continue;
    if (list.length && list.indexOf(v) < 0) bad.push(t("cfg.warn.notInList", { label: label, v: v }));
  }
  el.textContent = bad.length ? (bad.join(t("common.listSep")) + t("cfg.warn.tail")) : "";
  el.style.color = "#b45309";
}

// 把 settings 里的 cfg 路径反映到下拉框；preferSettings=true 时以 settings 为准
// （载入设置/切换预设时用），否则保留用户当前选中的项。
function syncCfgSelectValues(preferSettings) {
  if (!settings) return;
  for (const [inpId, key] of [["cfg-interface", "interface_cfg"], ["cfg-target", "target_cfg"]]) {
    const inp = $(inpId);
    if (!inp) continue;
    const fromSettings = (settings[key] || "").trim();
    inp.value = preferSettings ? fromSettings : ((inp.value || "").trim() || fromSettings);
  }
  updateCfgPreview();
}

// 用 <datalist> 填候选：Chromium/WebView2 会按输入内容原生过滤 —— 这就是「可搜索的下拉」
function fillCfgSelects() {
  const opt = (s) => '<option value="' + esc(s) + '"></option>';
  const list = (arr) => (arr || []).map(opt).join("");
  $("cfg-interface-list").innerHTML = list(scriptLists.interface);
  $("cfg-target-list").innerHTML = list(scriptLists.target) + list(scriptLists.board);
  updateCfgPreview();
}

// 扫描结果行：无扫描时用静态键文案，有结果时按当前语言重写（切语言不丢计数）
function renderScanLabel() {
  const el = $("cfg-scan-label");
  if (!el) return;
  if (!lastScan) el.textContent = t("cfg.scan.none");
  else if (lastScan.kind === "count") el.textContent = t("cfg.scan.count", { i: lastScan.i, t: lastScan.t, b: lastScan.b });
  else el.textContent = t("cfg.scan.failed", { e: lastScan.e });
}
async function rescanScripts() {
  const dir = $("cfg-scripts").value.trim();
  if (!dir) { lastScan = null; renderScanLabel(); return; }
  try {
    scriptLists = await invoke("scan_scripts", { dir });
    lastScan = {
      kind: "count",
      i: (scriptLists.interface || []).length,
      t: (scriptLists.target || []).length,
      b: (scriptLists.board || []).length,
    };
  } catch (e) {
    lastScan = { kind: "failed", e: e };
    renderScanLabel();
    return;
  }
  renderScanLabel();
  fillCfgSelects();
}
async function reloadProfiles() {
  const list = await invoke("list_profiles");
  $("profile-select").innerHTML = list.map(n => `<option>${esc(n)}</option>`).join("");
}

boot();
