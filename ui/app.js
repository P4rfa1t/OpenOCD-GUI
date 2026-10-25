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
  ["about", "关于", false],
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
  const count = parseInt($("mem-count").value) || 160;
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
      const nv = prompt(`新值（十六进制）— 地址 0x${cellAddr.toString(16).toUpperCase()}:`,
        "0x" + vals[i].toString(16).toUpperCase().padStart(memSize * 2, "0"));
      if (nv === null) return;
      const v = parseHex(nv);
      const lim = 2 ** (memSize * 8);   // 不能用 1 << (memSize*8)：JS 位移按 mod 32 取模，32/64 位会恒为 1
      if (v === null || v < 0 || v >= lim) {
        notify("数值无效或超出宽度（上限 " + lim + "，即 0x" + "f".repeat(memSize * 2) + "）", true);
        return;
      }
      tclExec(`${wcmd} 0x${cellAddr.toString(16)} 0x${v.toString(16)}`)
        .then(() => readMem(memAddr)).catch(e => notify("写入内存失败: " + e, true));
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
let bpSel = -1, wpSel = -1;   // 表格里被单击选中的行（-1 = 未选中）
function renderBpTable() {
  if (bpSel >= bpRows.length) bpSel = -1;   // 行数变化时先收拢选中索引，避免高亮错位
  const tb = document.querySelector("#bp-table tbody");
  tb.innerHTML = "";
  const cnt = $("bp-count");
  if (cnt) cnt.textContent = bpRows.length ? "共 " + bpRows.length + " 个断点" : "";
  if (!bpRows.length) {
    // 空表很容易被误读成“功能坏了”，放一行占位说明
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5; td.className = "muted";
    td.textContent = "（当前没有断点：填好地址后点「添加断点」，或点「刷新」重新读取）";
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
  if (cnt) cnt.textContent = wpRows.length ? "共 " + wpRows.length + " 个观察点" : "";
  if (!wpRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6; td.className = "muted";
    td.textContent = "（当前没有观察点：填好地址后点「添加观察点」，或点「刷新」重新读取）";
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
    if (bpText.trim() && !bpRows.length) appendLog("断点列表解析不出一行，OpenOCD 原文：" + bpText.trim());
  } catch (e) { bpRows = []; bpRefreshErr = String(e); appendLog("读取断点列表失败：" + e); }
  try {
    const wpText = String(await tclExec("wp") || "");
    wpRows = parseWp(wpText);
    if (wpText.trim() && !wpRows.length) appendLog("观察点列表解析不出一行，OpenOCD 原文：" + wpText.trim());
  } catch (e) { wpRows = []; wpRefreshErr = String(e); appendLog("读取观察点列表失败：" + e); }
  const bh = $("bp-hint"), wh = $("wp-hint");
  // 刷新成功时只清掉“本函数自己写的那条”失败文案，不覆盖 bpCmd 留下的执行结果
  const ownHint = (el, marker, err, label) => {
    if (!el) return;
    if (err) { el.textContent = label + "：" + err + "（请确认 OpenOCD 正在运行、已连接）"; el.style.color = "#dc2626"; }
    else if (el.textContent.indexOf(marker) === 0) { el.textContent = ""; el.style.color = ""; }
  };
  ownHint(bh, "断点列表读取失败", bpRefreshErr, "断点列表读取失败");
  ownHint(wh, "观察点列表读取失败", wpRefreshErr, "观察点列表读取失败");
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
    return "（OpenOCD 的 bp/wp 只接受十六进制数值地址；符号名 main、表达式 0x…+4 都不会被解析，请先换算成地址）";
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
    show("失败 " + cmd + " → " + e, false);
    notify("命令失败: " + e, true);
    return;
  }
  const one = text.replace(/\s*\n\s*/g, " | ");
  if (refresh) await refreshBp();
  const rerr = isWp ? wpRefreshErr : bpRefreshErr;
  if (rerr) {   // 列表本身都没读到 → 不能拿旧条目数判成败
    show("无法确认 " + cmd + "（列表读取失败：" + rerr + "，请点「刷新」重试）", false);
    notify("列表读取失败，无法确认命令是否生效", true);
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
  const cntTxt = "（当前 " + after + " 个）";
  if (ok) {
    show("已执行 " + cmd + (one ? " → " + one : " → ok") + cntTxt, true);
    notify("已执行 " + cmd);
  } else {
    const m = cmd.match(/^(?:r?wp|r?bp)\s+(\S+)/);
    let tip;
    const shapeTip = bpErrTip(m ? m[1] : "");
    if (shapeTip) tip = shapeTip;
    else if (addOp) tip = "（列表条目数没变：" + before + " → " + after + "。OpenOCD 把这类失败只写进它自己的日志——「日志」页能看到；常见原因：地址没按长度对齐、目标没暂停（halt）、硬件断点/观察点资源不足、长度该目标不支持）";
    else tip = "（列表条目数没变：" + before + " → " + after + "。用「刷新」看当前实际条目；若是 Context 断点（地址列显示 ctx 0x…），OpenOCD 的 rbp 只按地址删，没有按 asid 删的形式，请用「全部删除」(rbp all)）";
    show("失败 " + cmd + (one ? " → " + one : "") + " " + tip + cntTxt, false);
    notify("命令没有生效，详见页面上方的失败原因", true);
  }
}

// 断点/观察点地址与长度的硬约束：长度只能 1/2/4，且地址要按长度对齐
function bpAlignTip(a, lenN) {
  if (!/^0x[0-9a-f]+$/i.test(a || "")) return "";
  if (![1, 2, 4].includes(lenN)) return "长度只能是 1 / 2 / 4 字节（当前选了 " + lenN + "，OpenOCD 会拒绝）";
  const n = parseInt(a, 16);
  if (n % lenN !== 0) {
    const fixed = (Math.floor(n / lenN) * lenN).toString(16);
    return "地址没按长度对齐：长度为 " + lenN + " 时地址必须是 " + lenN + " 的整数倍，" + a + " 不是（可改成 0x" + fixed.padStart(a.length - 2, "0") + "）";
  }
  return "";
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
    fillCandidateList("cfg-exe-list", cands);
    if (cands.length > 1) { openocdPicker(cands); return; }
    applyOpenocd(cands[0]);
  };
  $("cfg-version").onclick = queryVersion;
  $("cfg-rescan").onclick = rescanScripts;
  $("cfg-interface").oninput = $("cfg-target").oninput = updateCfgPreview;
  $("cfg-interface-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS });
    if (!f) return;
    $("cfg-interface").value = f;
    updateCfgPreview();
  };
  $("cfg-target-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: CFG_FILTERS });
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
        filters: [{ name: "日志文件 (*.log;*.txt)", extensions: ["log", "txt"] },
                  { name: "所有文件 (*.*)", extensions: ["*"] }],
      });
      if (f) { $("cfg-logfile").value = f; notify("日志文件已设为 " + f); }
    } catch (e) { notify("选择日志文件失败: " + e, true); }
  };
  $("cfg-logfile-clear").onclick = () => { $("cfg-logfile").value = ""; notify("日志文件已清空（日志只显示在「日志」页）"); };
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
    const a = addrToken($("bp-addr").value);
    if (a === null) { notify("请填写断点地址：十六进制数值地址，如 0x08000100（0x 可省略）；符号名 main 之类 OpenOCD 不接受", true); return; }
    const alignTip = bpAlignTip(a, parseInt($("bp-len").value, 10));
    if (alignTip) { notify(alignTip, true); return; }
    let cmd = `bp ${a} ${$("bp-len").value}`;
    if ($("bp-type").selectedIndex === 1) cmd += " hw";
    bpCmd(cmd);
  };
  $("bp-del").onclick = () => {
    const row = bpRows[bpSel];
    if (!row) { notify("请先在表格中单击选中一行断点", true); return; }
    if (!row.addr) { notify("该断点没有地址（Context 断点）：OpenOCD 的 rbp 只能按地址删除，没有按 asid 删除的形式，请用「全部删除」(rbp all)", true); return; }
    bpCmd(`rbp ${row.addr}`);
    bpSel = -1;
  };
  $("bp-delall").onclick = () => { if (confirm("确定删除全部断点？")) bpCmd("rbp all"); };
  $("bp-refresh").onclick = refreshBp;
  $("wp-add").onclick = () => {
    const a = addrToken($("wp-addr").value);
    if (a === null) { notify("请填写观察点地址：十六进制数值地址，如 0x20000000（0x 可省略）；符号名 OpenOCD 不接受", true); return; }
    const alignTip = bpAlignTip(a, parseInt($("wp-len").value, 10));
    if (alignTip) { notify(alignTip, true); return; }
    const rw = ["r", "w", "a"][$("wp-access").selectedIndex];
    let cmd = `wp ${a} ${$("wp-len").value} ${rw}`;
    const vRaw = $("wp-value").value.trim();
    if (vRaw) {
      const v = numToken(vRaw);
      if (v === undefined) { notify("观察点「值」不是合法数字（十六进制，可省略 0x）", true); return; }
      cmd += " " + v;
      const mRaw = $("wp-mask").value.trim();
      if (mRaw) {
        const m = numToken(mRaw);
        if (m === undefined) { notify("观察点「掩码」不是合法数字", true); return; }
        cmd += " " + m;
      }
    }
    bpCmd(cmd);
  };
  $("wp-del").onclick = () => {
    const row = wpRows[wpSel];
    if (!row) { notify("请先在表格中单击选中一行观察点", true); return; }
    bpCmd(`rwp ${row.addr}`);
    wpSel = -1;
  };
  $("wp-delall").onclick = () => { if (confirm("确定删除全部观察点？")) bpCmd("rwp all"); };
  $("wp-refresh").onclick = refreshBp;

  // gdb
  $("gdb-path").oninput = $("gdb-args").oninput = updateGdbPreview;
  $("gdb-browse").onclick = async () => {
    const f = await dialogOpen({ multiple: false, filters: GDB_FILTERS });
    if (!f) return;
    $("gdb-path").value = f; updateGdbPreview();
  };
  $("gdb-autodetect").onclick = async () => {
    let cands = [];
    try { cands = await invoke("detect_gdb"); } catch (e) { notify("自动检测失败: " + e, true); return; }
    if (!cands || !cands.length) { notify("未找到 GDB（arm-none-eabi-gdb / gdb-multiarch / gdb），请手动指定路径", true); return; }
    fillCandidateList("gdb-path-list", cands);
    if (cands.length > 1) {
      showModal("选择 GDB（检测到 " + cands.length + " 个）",
        cands.map((c, k2) => (k2 + 1) + ") " + c).join("\n") + "\n\n点下面的按钮选用其中一个；也可直接在路径框里输入或从下拉候选里选。",
        cands.map((c) => ({ label: shortExe(c), onPick: () => applyGdb(c) })));
      notify("检测到 " + cands.length + " 个 GDB，请在弹出的窗口里选择");
      return;
    }
    applyGdb(cands[0]);
  };
  $("gdb-version").onclick = async () => {
    const gexe = $("gdb-path").value.trim();
    if (!gexe) { notify("请先填写 GDB 程序路径", true); return; }
    await showVersion(gexe, $("gdb-version-label"));
  };
  $("gdb-copy").onclick = () => {
    navigator.clipboard.writeText(`${$("gdb-path").value} ${$("gdb-args").value}`)
      .then(() => notify("命令行已复制"));
  };
  $("gdb-launch").onclick = async () => {
    try { await invoke("launch_gdb", { gdb: $("gdb-path").value, args: $("gdb-args").value });
      notify("已启动 GDB"); }
    catch (e) { notify("启动 GDB 失败: " + e, true); }
  };

  // about 页
  try { $("about-version").textContent = "v" + await invoke("app_version"); } catch (e) {}
  try { $("about-configdir").textContent = await invoke("config_dir_path"); } catch (e) {}
  $("about-detect").onclick = async () => {
    const exe = $("cfg-exe").value.trim();
    if (!exe) { notify("请先在「配置」页指定 OpenOCD 路径", true); return; }
    $("about-openocd-path").textContent = exe;
    const v = await showVersion(exe, $("about-openocd"), "");
    if (!v) notify("OpenOCD 版本检测失败（检查路径是否存在）", true);
  };
  $("about-open-configdir").onclick = async () => {
    try { await invoke("open_path", { path: $("about-configdir").textContent }); }
    catch (e) { notify(String(e), true); }
  };
  document.querySelectorAll("#page-about .link").forEach(b => {
    b.onclick = async () => {
      try { await invoke("open_url", { url: b.dataset.url }); notify("已在浏览器打开：" + b.dataset.url); }
      catch (e) { notify("打开链接失败: " + e, true); }
    };
  });
  $("about-check-update").onclick = () => checkUpdate(false);
  $("about-open-release").onclick = async () => {
    const u = $("about-open-release").dataset.url;
    if (!u) { notify("请先点「获取更新版本」", true); return; }
    try { await invoke("open_url", { url: u }); notify("已在浏览器打开：" + u); }
    catch (e) { notify("打开链接失败: " + e, true); }
  };
  $("about-release-notes").onclick = () => {
    if (!updateInfo || !updateInfo.notes) { notify("没有可显示的更新说明", true); return; }
    showModal(updateInfo.tag + " 更新说明", updateInfo.notes);
  };

  // 只读预览弹窗
  $("modal-close").onclick = hideModal;
  $("modal-copy").onclick = () => navigator.clipboard.writeText($("modal-body").textContent)
    .then(() => notify("已复制到剪贴板"));
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
  if (!exe) { notify("请先指定 OpenOCD 路径", true); return; }
  await showVersion(exe, $("cfg-version-label"));
}
// 把某个可执行文件 --version 的首行写进指定元素；返回版本串（检测失败为空串）
async function showVersion(exe, el, prefix = "版本: ") {
  el.textContent = prefix + "检测中…";
  let v = "";
  try { v = String((await invoke("query_version", { exe })) || "").split("\n")[0].trim(); } catch (e) { v = ""; }
  el.textContent = prefix + (v || "未检测到（检查路径是否存在）");
  return v;
}

// ---------------------------------------------------------------- 检查更新
let updateInfo = null;
let aboutChecked = false;
// 查 GitHub 上的最新版本：先 releases/latest，没有 Release 就退到 tags（后端用 curl/wget）
async function checkUpdate(auto) {
  const st = $("about-update-status");
  const openBtn = $("about-open-release"), notesBtn = $("about-release-notes");
  st.style.color = "";
  st.textContent = "检查中…";
  openBtn.style.display = "none";
  notesBtn.style.display = "none";
  try {
    const r = await invoke("check_update");
    updateInfo = r;
    const via = r.source === "tags" ? "标签" : "Release";
    const when = r.published_at ? "，发布于 " + String(r.published_at).slice(0, 10) : "";
    if (r.has_update) {
      st.textContent = `发现新版本 ${r.tag}（当前 v${r.current}，取自 ${via}${when}）`;
      st.style.color = "#b45309";
      notify(`发现新版本 ${r.tag}（当前 v${r.current}）`);
    } else {
      st.textContent = `已是最新：v${r.current}（GitHub 上为 ${r.tag}，取自 ${via}${when}）`;
      st.style.color = "#15803d";
    }
    if (r.url) { openBtn.dataset.url = r.url; openBtn.style.display = ""; }
    if (r.notes && String(r.notes).trim()) notesBtn.style.display = "";
  } catch (e) {
    st.textContent = "检查失败：" + e;
    st.style.color = "#b91c1c";
    if (!auto) notify("检查更新失败: " + e, true);
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
  showModal("选择 OpenOCD（检测到 " + cands.length + " 个）",
    cands.map((c, k2) => (k2 + 1) + ") " + c).join("\n") + "\n\n点下面的按钮选用其中一个；也可直接在路径框里输入或从下拉候选里选。",
    cands.map((c) => ({ label: shortExe(c), onPick: () => applyOpenocd(c) })));
  notify("检测到 " + cands.length + " 个 OpenOCD，请在弹出的窗口里选择");
}
async function applyOpenocd(p) {
  $("cfg-exe").value = p;
  const g = await invoke("guess_scripts", { exe: p });
  if (g) { $("cfg-scripts").value = g; rescanScripts(); }
  queryVersion();
  notify("已选择 " + p);
}
// 只留最后两段路径，便于在按钮上辨认
function shortExe(p) { return String(p).split(/[\\/]/).slice(-2).join("/"); }

function applyGdb(p) {
  $("gdb-path").value = p;
  updateGdbPreview();
  notify("已选择 " + p);
}

async function previewCfgOne(which) {
  const dir = stripTrailingSlash($("cfg-scripts").value.trim());
  const isIfc = which === "interface";
  const label = isIfc ? "接口 cfg (-f)" : "目标/板级 cfg (-f)";
  const v = (isIfc ? $("cfg-interface") : $("cfg-target")).value.trim();
  if (!v) { notify("请先选择" + (isIfc ? "接口 cfg" : "目标/板级 cfg"), true); return; }
  const rel = !isAbsPath(v);
  const abs = rel ? (dir ? dir + "/" + v : v) : v;
  let body;
  try { body = await invoke("read_text_file", { path: abs }); }
  catch (e) { body = "—— 读取失败：" + e; }
  if (rel && !dir) body = "—— 提示：当前未设置脚本目录（-s），相对名无法解析为实际路径，请先在配置页设置脚本目录。\n" + body;
  showModal(label + " 内容预览（只读）", "值: " + v + "\n解析路径: " + abs + "\n----- 内容 -----\n" + body);
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
const GDB_FILTERS = [
  { name: "GDB 可执行文件 (*.exe)", extensions: ["exe"] },
  { name: "所有文件 (*.*)", extensions: ["*"] },
];
let scriptLists = { interface: [], target: [], board: [] };

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
  updateCfgWarning();
}
// 手输的名字若不在脚本库扫描结果里，提示一下（仍按原样传给 OpenOCD，不拦截）
function updateCfgWarning() {
  const el = $("cfg-warn");
  if (!el) return;
  const known = { ifc: scriptLists.interface || [], tgt: (scriptLists.target || []).concat(scriptLists.board || []) };
  const bad = [];
  const pairs = [["接口 cfg", $("cfg-interface").value.trim(), known.ifc],
                 ["目标/板级 cfg", $("cfg-target").value.trim(), known.tgt]];
  for (const x of pairs) {
    const label = x[0], v = x[1], list = x[2];
    if (!v || isAbsPath(v)) continue;
    if (list.length && list.indexOf(v) < 0) bad.push(label + "『" + v + "』不在脚本库列表中");
  }
  el.textContent = bad.length ? (bad.join("；") + "（仍会按原样传给 OpenOCD，请自行确认拼写）") : "";
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
