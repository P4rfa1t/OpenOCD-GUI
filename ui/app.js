/* OpenOCD-GUI — Tauri 2 front-end (vanilla JS, mirrors the Python parsers) */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: dialogOpen } = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let settings = null;
let targetRows = [];
let regRows = [];
let memRows = [];
let memAddr = 0, memSize = 4;
let bpRows = [], wpRows = [];
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
    const m = line.trim().match(/^(Software|Hardware|Context|Hybrid)\s+breakpoint(?:\(IVA\))?\s*:\s*(.*)$/i);
    if (!m) continue;
    const props = {};
    for (const kv of m[2].matchAll(/(\w+)=([^,]*)/g)) props[kv[1]] = kv[2].trim();
    out.push({ type: m[1].toLowerCase(), addr: props.addr || "", asid: props.asid || "",
               len: props.len || "", num: props.num || "", orig: props.orig_instr || "" });
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
  t = (t || "").trim();
  if (!t) return dflt;
  try { return t.toLowerCase().startsWith("0x") ? parseInt(t, 16) : parseInt(t, 16); }
  catch { return dflt; }
}

// ---------------------------------------------------------------- helpers
async function tclExec(cmd, timeoutMs = 15000) { return invoke("tcl_exec", { cmd }); }
function notify(msg, isErr = false) {
  $("status-msg").textContent = msg;
  $("status-msg").style.color = isErr ? "#dc2626" : "#2563eb";
  if (isErr) alert(msg);
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
const TABS = [
  ["config", "配置", false], ["log", "日志", false], ["console", "控制台", true],
  ["target", "目标", true], ["regs", "寄存器", true], ["mem", "内存", true],
  ["flash", "烧写", true], ["bp", "断点/观察点", true], ["gdb", "GDB", false],
];
function buildTabs() {
  const box = $("tabs");
  TABS.forEach(([id, title, needConn]) => {
    const el = document.createElement("div");
    el.textContent = title;
    el.dataset.page = id;
    el.dataset.needConn = needConn ? "1" : "";
    el.onclick = () => selectTab(id);
    box.appendChild(el);
  });
  selectTab("config");
}
function selectTab(id) {
  document.querySelectorAll("#tabs div").forEach(el =>
    el.classList.toggle("active", el.dataset.page === id));
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active", p.id === "page-" + id));
  if (id === "regs" && $("tcl-label").textContent.includes("已连接") &&
      !regRows.length && !regPending) refreshRegs();
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
  settings.openocd_path = $("cfg-exe").value.trim();
  settings.scripts_dir = $("cfg-scripts").value.trim();
  const ifcSel = $("cfg-interface"), tgtSel = $("cfg-target");
  // 脚本库尚未扫描出来时下拉是空的，此时沿用已保存值，避免把配置清空
  const keepOld = !cfgSelectsReady;
  settings.interface_cfg = ifcSel.value.trim() || (keepOld ? (settings.interface_cfg || "") : "");
  settings.target_cfg = tgtSel.value.trim() || (keepOld ? (settings.target_cfg || "") : "");
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
  // 选项可能尚未扫描出来，syncCfgSelectValues 会在缺少对应 option 时补一个
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
  $("gdb-info").textContent = `连接地址: localhost:${settings?.gdb_port ?? 3333}  (target remote localhost:${settings?.gdb_port ?? 3333})`;
  $("sb-ports").textContent = `GDB ${settings?.gdb_port} · TCL ${settings?.tcl_port} · Telnet ${settings?.telnet_port}`;
}

// ---------------------------------------------------------------- server control
const STATE_LABELS = { stopped: ["已停止", "#9ca3af"], starting: ["启动中…", "#f59e0b"],
  running: ["运行中", "#10b981"], stopping: ["停止中…", "#f59e0b"], failed: ["异常退出", "#ef4444"] };
function setServerState(state) {
  const [label, color] = STATE_LABELS[state] || [state, "#9ca3af"];
  $("state-label").textContent = label;
  $("state-dot").style.background = color;
  $("btn-start").disabled = !(state === "stopped" || state === "failed");
  $("btn-stop").disabled = !(state === "starting" || state === "running");
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
    notify(String(e), true);
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
  const sets = { "全部": null, "信息及以上": ["info", "user", "warning", "error", "raw"],
    "警告+错误": ["warning", "error", "raw"], "仅错误": ["error", "raw"] };
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
    r.textContent = res || "(无输出)";
    div.appendChild(r);
  } catch (e) {
    const r = document.createElement("div");
    r.className = "err"; r.textContent = "错误: " + e;
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
    $("target-label").textContent = "目标: " + cur.state;
  }
}
async function targetAction(cmd) {
  const cur = targetRows.find(r => r.current) || targetRows[0];
  if (!cur) { notify("没有可操作的目标", true); return; }
  try { await tclExec(cmd, 30000); } catch (e) { notify("命令失败: " + e, true); }
  refreshTargetsOnce();
}

// ---------------------------------------------------------------- registers
async function refreshRegs() {
  if (regPending) return;
  regPending = true;
  $("reg-status").textContent = "读取中…";
  try {
    const text = await tclExec("reg", 20000);
    const { regs, err } = parseRegs(text);
    regRows = regs;
    if (regs.length) {
      $("reg-status").textContent = `${regs.length} 个寄存器`;
    } else {
      // 解析不出任何寄存器时把原始输出打到日志页，便于定位格式差异
      $("reg-status").textContent = err || "未解析到寄存器";
      appendLog("$ reg\n" + text);
    }
    renderRegs();
  } catch (e) { $("reg-status").textContent = "读取失败: " + e; }
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
      const nv = prompt(`新值（十六进制）— ${r.name}:`, cur);
      if (nv === null) return;
      const v = parseHex(nv);
      if (v === null) { notify("请输入十六进制数值", true); return; }
      tclExec(`reg ${r.name} 0x${v.toString(16)}`).then(refreshRegs)
        .catch(e => notify("写入寄存器失败: " + e, true));
    });
}

// ---------------------------------------------------------------- memory
const MEM_WIDTHS = { "32 位 (mdw)": [4, "mdw", "mww"], "16 位 (mdh)": [2, "mdh", "mwh"],
  "8 位 (mdb)": [1, "mdb", "mwb"], "64 位 (mdd)": [8, "mdd", "mwd"] };
async function readMem(addr) {
  if (addr === undefined) {
    addr = parseHex($("mem-addr").value);
    if (addr === null) { notify("地址格式无效", true); return; }
  }
  const [size, rcmd] = MEM_WIDTHS[$("mem-width").value];
  memSize = size; memAddr = addr;
  const count = parseInt($("mem-count").value) || 64;
  $("mem-status").textContent = "读取中…";
  try {
    const text = await tclExec(`${rcmd} 0x${addr.toString(16)} ${count}`, 20000);
    memRows = parseMd(text);
    $("mem-status").textContent = memRows.length ?
      memRows.reduce((n, [, v]) => n + v.length, 0) + " 项" : "读取失败或无数据";
    renderMem();
  } catch (e) { $("mem-status").textContent = "读取失败: " + e; }
}
function renderMem() {
  const perLine = 32 / memSize;
  let html = "<thead><tr><th>地址</th>";
  for (let i = 0; i < perLine; i++) html += `<th>${(i * memSize).toString(16).toUpperCase()}</th>`;
  html += "<th>ASCII</th></tr></thead><tbody>";
  memRows.forEach(([addr, vals], r) => {
    html += `<tr><td>0x${addr.toString(16).toUpperCase().padStart(8, "0")}</td>`;
    for (let i = 0; i < perLine; i++)
      html += `<td data-r="${r}" data-i="${i}">${i < vals.length ? vals[i].toString(16).toUpperCase().padStart(memSize * 2, "0") : ""}</td>`;
    const raw = [];
    vals.forEach(v => { for (let b = 0; b < memSize; b++) raw.push((v >> (8 * b)) & 0xff); });
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
      const nv = prompt(`新值（十六进制）— 地址 0x${cellAddr.toString(16).toUpperCase()}:`,
        "0x" + vals[i].toString(16).toUpperCase().padStart(memSize * 2, "0"));
      if (nv === null) return;
      const v = parseHex(nv);
      if (v === null || v >= (1 << (memSize * 8))) { notify("数值无效或超出宽度", true); return; }
      tclExec(`${wcmd} 0x${cellAddr.toString(16)} 0x${v.toString(16)}`)
        .then(() => readMem(memAddr)).catch(e => notify("写入内存失败: " + e, true));
    };
  });
}
function memPage(dir) {
  const count = parseInt($("mem-count").value) || 64;
  const next = memAddr + dir * count * memSize;
  $("mem-addr").value = "0x" + next.toString(16).toUpperCase().padStart(8, "0");
  readMem(next);
}

// ---------------------------------------------------------------- flash
async function programFirmware() {
  const path = $("fl-file").value.trim();
  if (!path) { notify("请先选择固件镜像文件", true); return; }
  $("fl-program").disabled = true;
  $("fl-status").textContent = "执行中…";
  $("flash-out").textContent = "";
  try {
    const res = await invoke("program_firmware", {
      path, offset: $("fl-offset").value.trim(),
      preverify: $("fl-preverify").checked, verify: $("fl-verify").checked,
      reset: $("fl-reset").checked });
    $("fl-status").textContent = "完成";
    $("flash-out").textContent = res || "(命令已执行)";
    refreshTargetsOnce();
  } catch (e) {
    $("fl-status").textContent = "失败";
    notify("烧写失败: " + e, true);
  }
  $("fl-program").disabled = false;
}
async function refreshBanks() {
  try {
    const text = await tclExec("flash banks");
    const banks = parseBanks(text);
    fillTable("fl-table", banks, [b => b.num, b => b.name, b => b.driver, b => b.base,
      b => b.size, b => b.bus, b => b.chip]);
    if (!banks.length) $("flash-out").textContent = text || "(无 flash bank)";
  } catch (e) { $("flash-out").textContent = "flash banks 失败: " + e; }
}
async function flashInfo() {
  try { $("flash-out").textContent = await tclExec(`flash info ${$("fl-bank-num").value || "0"}`, 30000) || "(无输出)"; }
  catch (e) { $("flash-out").textContent = "flash info 失败: " + e; }
}
async function eraseSectors() {
  const cmd = `flash erase_sector ${$("fl-bank-num").value || "0"} ${$("fl-first").value || "0"} ${$("fl-last").value || "last"}`;
  try {
    await tclExec(cmd, 120000);
    $("flash-out").textContent = "扇区擦除完成";
    flashInfo();
  } catch (e) { notify("擦除失败: " + e, true); }
}

// ---------------------------------------------------------------- breakpoints
async function refreshBp() {
  try {
    bpRows = parseBp(await tclExec("bp"));
    fillTable("bp-table", bpRows, [b => b.type, b => b.addr || b.asid, b => b.len,
      b => b.orig || (b.num ? "num=" + b.num : "")]);
    wpRows = parseWp(await tclExec("wp"));
    fillTable("wp-table", wpRows, ["addr", "len", "rw", "value", "mask"]);
  } catch {}
}
function bpCmd(cmd, refresh = true) {
  tclExec(cmd, 15000).then(() => { if (refresh) setTimeout(refreshBp, 300); })
    .catch(e => notify("命令失败: " + e, true));
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildTabs();
  buildQuick();
  settings = await invoke("get_settings");
  settingsToForm();
  setServerState("stopped");
  rescanScripts();

  // backend events
  await listen("log", (e) => appendLog(e.payload));
  await listen("server-state", (e) => {
    setServerState(e.payload);
    if (e.payload === "failed") refreshBanksStub();
  });
  await listen("tcl-state", (e) => {
    const on = e.payload === true;
    $("tcl-label").textContent = on ? "TCL: 已连接" : "TCL: 未连接";
    $("tcl-label").style.color = on ? "#059669" : "#6b7280";
    setConnTabs(on);
    if (on) refreshTargetsOnce();
  });
  await listen("targets", (e) => onTargets(e.payload));

  // config page
  $("btn-start").onclick = startServer;
  $("btn-stop").onclick = stopServer;
  $("cfg-exe-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: EXE_FILTERS });
    if (f) $("cfg-exe").value = f;
  };
  $("cfg-scripts-browse").onclick = async () => {
    const d = await dialogOpen({ directory: true });
    if (d) { $("cfg-scripts").value = d; rescanScripts(); }
  };
  $("cfg-autodetect").onclick = async () => {
    const cands = await invoke("detect_openocd");
    if (!cands.length) { notify("未找到 openocd，请手动指定路径", true); return; }
    $("cfg-exe").value = cands[0];
    const g = await invoke("guess_scripts", { exe: cands[0] });
    if (g) { $("cfg-scripts").value = g; rescanScripts(); }
    queryVersion();
  };
  $("cfg-version").onclick = queryVersion;
  $("cfg-rescan").onclick = rescanScripts;
  $("cfg-interface").onchange = $("cfg-target").onchange = updateCfgPreview;
  $("cfg-interface-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS });
    if (!f) return;
    settings.interface_cfg = f;
    syncCfgSelectValues();
  };
  $("cfg-target-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS });
    if (!f) return;
    settings.target_cfg = f;
    syncCfgSelectValues();
  };
  $("cfg-interface-clear").onclick = () => {
    settings.interface_cfg = ""; $("cfg-interface").value = ""; updateCfgPreview();
  };
  $("cfg-target-clear").onclick = () => {
    settings.target_cfg = ""; $("cfg-target").value = ""; updateCfgPreview();
  };
  $("profile-save").onclick = async () => {
    formToSettings();
    const name = prompt("预设名称:");
    if (!name) return;
    try {
      const saved = await invoke("save_profile", { name, settings });
      await reloadProfiles(); $("profile-select").value = saved;
      notify(`预设『${saved}』已保存`);
    } catch (e) { notify(String(e), true); }
  };
  $("profile-load").onclick = async () => {
    const name = $("profile-select").value;
    if (!name) { notify("请先选择一个预设", true); return; }
    const p = await invoke("load_profile", { name });
    if (!p) { notify(`预设『${name}』读取失败`, true); return; }
    settings = Object.assign({}, settings, p);
    settingsToForm(); rescanScripts(); queryVersion();
    notify(`已加载预设『${name}』`);
  };
  $("profile-delete").onclick = async () => {
    const name = $("profile-select").value;
    if (name && confirm(`确定删除预设『${name}』？`)) {
      await invoke("delete_profile", { name }); reloadProfiles();
    }
  };
  await reloadProfiles();

  // log / console
  $("log-filter").onchange = rerenderLog;
  $("log-clear").onclick = () => { logLines = []; rerenderLog(); };
  $("log-copy").onclick = () =>
    navigator.clipboard.writeText(logLines.map(([, l]) => l).join("\n")).then(() => notify("日志已复制"));
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
  $("tg-auto").onchange = () => { formToSettings(); invoke("save_settings", { settings });
    invoke("set_poll_enabled", { enabled: $("tg-auto").checked }); };

  // registers
  $("reg-refresh").onclick = refreshRegs;
  $("reg-filter").oninput = renderRegs;
  regTimer = setInterval(() => {
    if ($("reg-auto").checked && lastTargetState === "halted" &&
        $("tcl-label").textContent.includes("已连接") && !regPending) refreshRegs();
  }, 1000);

  // memory
  $("mem-read").onclick = () => readMem();
  $("mem-prev").onclick = () => memPage(-1);
  $("mem-next").onclick = () => memPage(1);

  // flash
  $("fl-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: FIRMWARE_FILTERS });
    if (f) $("fl-file").value = f;
  };
  $("fl-program").onclick = programFirmware;
  $("fl-banks-refresh").onclick = refreshBanks;
  $("fl-info").onclick = flashInfo;
  $("fl-erase").onclick = eraseSectors;

  // breakpoints
  $("bp-add").onclick = () => {
    const addr = parseHex($("bp-addr").value);
    if (addr === null) { notify("断点地址无效", true); return; }
    let cmd = `bp 0x${addr.toString(16)} ${$("bp-len").value}`;
    if ($("bp-type").selectedIndex === 1) cmd += " hw";
    bpCmd(cmd);
  };
  $("bp-del").onclick = () => {
    const row = bpRows[0];
    if (!row) { notify("请先添加断点", true); return; }
    if (row.addr || row.asid) bpCmd(`rbp ${row.addr || row.asid}`);
  };
  $("bp-delall").onclick = () => { if (confirm("确定删除全部断点？")) bpCmd("rbp all"); };
  $("bp-refresh").onclick = refreshBp;
  $("wp-add").onclick = () => {
    const addr = parseHex($("wp-addr").value);
    if (addr === null) { notify("观察点地址无效", true); return; }
    const rw = ["r", "w", "a"][$("wp-access").selectedIndex];
    let cmd = `wp 0x${addr.toString(16)} ${$("wp-len").value} ${rw}`;
    const v = parseHex($("wp-value").value);
    if (v !== null) {
      cmd += ` 0x${v.toString(16)}`;
      const m = parseHex($("wp-mask").value);
      if (m !== null) cmd += ` 0x${m.toString(16)}`;
    }
    bpCmd(cmd);
  };
  $("wp-del").onclick = () => { const row = wpRows[0];
    if (row) bpCmd(`rwp ${row.addr}`); };
  $("wp-delall").onclick = () => { if (confirm("确定删除全部观察点？")) bpCmd("rwp all"); };

  // gdb
  $("gdb-path").oninput = $("gdb-args").oninput = updateGdbPreview;
  $("gdb-copy").onclick = () => {
    navigator.clipboard.writeText(`${$("gdb-path").value} ${$("gdb-args").value}`)
      .then(() => notify("命令行已复制"));
  };
  $("gdb-launch").onclick = async () => {
    try { await invoke("launch_gdb", { gdb: $("gdb-path").value, args: $("gdb-args").value });
      notify("已启动 GDB"); }
    catch (e) { notify("启动 GDB 失败: " + e, true); }
  };

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
  if (!exe) return;
  $("cfg-version-label").textContent = "版本: 检测中…";
  const v = await invoke("query_version", { exe });
  $("cfg-version-label").textContent = "版本: " + (v || "无法获取");
}
// ---------------------------------------------------------------- cfg 选择与文件过滤器
const FIRMWARE_FILTERS = [
  { name: "固件镜像 (*.bin;*.hex;*.elf;*.axf;*.out;*.mot;*.s19;*.icf)",
    extensions: ["bin", "hex", "elf", "axf", "out", "mot", "s19", "icf"] },
  { name: "ELF (*.elf;*.axf;*.out)", extensions: ["elf", "axf", "out"] },
  { name: "Intel HEX / Motorola S-Record (*.hex;*.mot;*.s19)", extensions: ["hex", "mot", "s19"] },
  { name: "二进制 (*.bin)", extensions: ["bin"] },
  { name: "所有文件 (*.*)", extensions: ["*"] },
];
const CFG_FILTERS = [
  { name: "OpenOCD 脚本 (*.cfg)", extensions: ["cfg"] },
  { name: "所有文件 (*.*)", extensions: ["*"] },
];
const EXE_FILTERS = [
  { name: "可执行文件 (*.exe)", extensions: ["exe"] },
  { name: "所有文件 (*.*)", extensions: ["*"] },
];
let scriptLists = { interface: [], target: [], board: [] };
let cfgSelectsReady = false;  // fillCfgSelects 是否已跑过（脚本库扫描完成）

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
  const i = $("cfg-interface").value.trim(), t = $("cfg-target").value.trim();
  if (i) parts.push("-f " + i);
  if (t) parts.push("-f " + t);
  $("cfg-order-preview").textContent =
    parts.length ? "启动顺序: openocd … " + parts.join(" ") : "未选择 cfg（两者均可留空）";
}

// 把 settings 里的 cfg 路径反映到下拉框；preferSettings=true 时以 settings 为准
// （载入设置/切换预设时用），否则保留用户当前选中的项。
function syncCfgSelectValues(preferSettings) {
  if (!settings) return;
  for (const [selId, key] of [["cfg-interface", "interface_cfg"], ["cfg-target", "target_cfg"]]) {
    const sel = $(selId);
    if (!sel) continue;
    const fromSettings = (settings[key] || "").trim();
    const cur = preferSettings ? fromSettings : ((sel.value || "").trim() || fromSettings);
    if (cur && ![...sel.options].some(o => o.value === cur)) sel.add(new Option(cur, cur));
    sel.value = cur;
  }
  updateCfgPreview();
}

function fillCfgSelects() {
  const opts = (arr) => (arr || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  $("cfg-interface").innerHTML = `<option value="">（不使用）</option>` + opts(scriptLists.interface);
  $("cfg-target").innerHTML = `<option value="">（不使用）</option>` +
    `<optgroup label="target">${opts(scriptLists.target)}</optgroup>` +
    `<optgroup label="board">${opts(scriptLists.board)}</optgroup>`;
  cfgSelectsReady = true;
  syncCfgSelectValues();
}

async function rescanScripts() {
  const dir = $("cfg-scripts").value.trim();
  if (!dir) { $("cfg-scan-label").textContent = "未扫描"; return; }
  try {
    scriptLists = await invoke("scan_scripts", { dir });
  } catch (e) { $("cfg-scan-label").textContent = "扫描失败: " + e; return; }
  $("cfg-scan-label").textContent =
    `interface ${(scriptLists.interface || []).length} · target ${(scriptLists.target || []).length} · board ${(scriptLists.board || []).length}`;
  fillCfgSelects();
}
async function reloadProfiles() {
  const list = await invoke("list_profiles");
  $("profile-select").innerHTML = list.map(n => `<option>${esc(n)}</option>`).join("");
}

boot();
