/* ============================================================================
 * 界面文案表（i18n）
 * ----------------------------------------------------------------------------
 * 为什么这样做：界面上的每一句文案都集中在这里，HTML / JS 里只留键名，
 * 以后加语言时不用再去翻代码，只加一份同键的表即可。
 *
 * 新增一门语言：
 *   1) 在 I18N 里加一份与 zh 键名完全相同的表（缺键会回落到 zh）；
 *   2) 把 { code, label } 加进 LANGS；
 *   3) 在设置里把 lang 设成该 code（设置 → 界面语言，见「关于」页）。
 *
 * 取值方式：t("键名")，插值用 {name}：t("bp.count", { n: 3 })。
 * ========================================================================== */

const LANGS = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "English" },
];

// 语言偏好：默认 "auto" = 跟随系统语言；也可存具体 code（zh / en）
const LANG_AUTO = "auto";

// 系统语言不在表里时的最终回落（例如系统是法语 → 显示英文）
const DETECT_FALLBACK = "en";

const FALLBACK_LANG = "zh";

const I18N = {
  zh: {
    // ---- 顶部工具栏 / 标签页 ----
    "tb.start": "▶  启动",
    "tb.stop": "■  停止",
    "tb.tcl.on": "TCL: 已连接",
    "tb.tcl.off": "TCL: 未连接",
    "tb.target": "目标: {v}",
    "tb.targetNone": "目标: —",
    "state.stopped": "已停止",
    "state.starting": "启动中…",
    "state.running": "运行中",
    "state.stopping": "停止中…",
    "state.failed": "异常退出",
    "tab.config": "配置",
    "tab.log": "日志",
    "tab.console": "控制台",
    "tab.target": "目标",
    "tab.regs": "寄存器",
    "tab.mem": "内存",
    "tab.flash": "烧写",
    "tab.bp": "断点/观察点",
    "tab.gdb": "GDB",
    "tab.about": "关于",

    // ---- 通用 ----
    "common.browse": "浏览…",
    "common.clear": "清除",
    "common.refresh": "刷新",
    "common.autodetect": "自动检测",
    "common.detectVersion": "检测版本",
    "common.version.unknown": "版本: 未知",
    "common.version.prefix": "版本: ",
    "common.version.checking": "检测中…",
    "common.version.none": "未检测到（检查路径是否存在）",
    "common.choice.pickAll": "点下面的按钮选用其中一个；也可直接在路径框里输入或从下拉候选里选。",
    "common.selected": "已选择 {p}",
    "common.copy": "复制",
    "common.close": "关闭",
    "common.copied": "已复制到剪贴板",
    "common.none": "(无输出)",
    "common.err": "错误: {e}",
    "common.errorTitle": "出错了",
    "common.cmdFail": "命令失败: {e}",
    "common.openFail": "打开链接失败: {e}",
    "common.opened": "已在浏览器打开：{u}",

    // ---- 配置页 ----
    "cfg.legend.exe": "OpenOCD 程序",
    "common.ph.candidates": "点开看候选，输入即筛选",
    "cfg.legend.scripts": "脚本目录 (-s)",
    "cfg.rescan": "重新扫描",
    "cfg.scan.count": "interface {i} · target {t} · board {b}",
    "cfg.scan.none": "未扫描",
    "cfg.scan.failed": "扫描失败: {e}",
    "cfg.legend.cfgs": "配置文件 (-f，接口在前、目标/板级在后)",
    "cfg.ifc": "接口 cfg: ",
    "cfg.tgt": "目标/板级 cfg: ",
    "cfg.ph.ifc": "输入即筛选，如 stlink / jlink / cmsis-dap",
    "cfg.ph.tgt": "输入即筛选，如 stm32f1 / stm32f4",
    "cfg.preview": "查看内容",
    "cfg.order.none": "未选择 cfg",
    "cfg.order": "启动顺序: openocd … {parts}",
    "cfg.order.empty": "未选择 cfg（两者均可留空）",
    "common.listSep": "；",
    "cfg.warn.tail": "（仍会按原样传给 OpenOCD，请自行确认拼写）",
    "cfg.preset.note": "配置预设（把这组配置存成命名预设，换板子时一键加载）：",
    "cfg.preset.save": "保存为预设",
    "cfg.pair.ifc": "接口 cfg",
    "cfg.pair.tgt": "目标/板级 cfg",
    "cfg.warn.notInList": "{label}『{v}』不在脚本库列表中",
    "cfg.preset.load": "加载",
    "cfg.preset.delete": "删除",
    "cfg.legend.cmds": "-c 附加命令（每行一条，如 adapter speed 3000）",
    "cfg.legend.ports": "服务端口与调试",
    "cfg.debug": "调试级别",
    "cfg.bind": "监听",
    "cfg.debug.0": "0（默认）",
    "cfg.debug.1": "1（最少）",
    "cfg.debug.2": "2（警告）",
    "cfg.debug.3": "3（信息）",
    "cfg.debug.4": "4（调试）",
    "cfg.logfile": "日志文件 (-l): ",
    "cfg.logfile.ph": "留空 = 只显示在「日志」页",
    "cfg.logfile.note": "OpenOCD 自己的运行日志（等价 -l &lt;文件&gt;，追加写入，与「日志」页一致）。留空则不落盘。",
    "cfg.logfile.pick": "选择…",
    "cfg.logfile.set": "日志文件已设为 {f}",
    "cfg.logfile.cleared": "日志文件已清空（日志只显示在「日志」页）",
    "cfg.logfile.pickFail": "选择日志文件失败: {e}",
    "cfg.preset.prompt": "预设名称:",
    "cfg.preset.saved": "预设『{n}』已保存",
    "cfg.preset.needPick": "请先选择一个预设",
    "cfg.preset.loadFail": "预设『{n}』读取失败",
    "cfg.preset.loaded": "已加载预设『{n}』",
    "cfg.preset.confirmDel": "确定删除预设『{n}』？",

    // ---- 日志页 ----
    "log.filter": "过滤: ",
    "log.f.all": "全部",
    "log.f.info": "信息及以上",
    "log.f.warn": "警告+错误",
    "log.f.err": "仅错误",
    "log.autoscroll": "自动滚动",
    "log.copy": "复制全部",
    "log.clear": "清空",
    "log.copied": "日志已复制",

    // ---- 控制台 ----
    "console.cmd": "命令: ",
    "console.send": "发送",

    // ---- 目标页 ----
    "tg.autopoll": "自动轮询",
    "tg.interval": "间隔(ms) ",
    "tg.halt": "⏸ 暂停",
    "tg.resume": "▶ 继续",
    "tg.srst": "软复位暂停",
    "tg.resetMode": "复位: ",
    "tg.reset": "执行复位",
    "tg.note": "双击行可将该目标设为当前目标",
    "tg.none": "没有可操作的目标",
    "th.target": "目标名称",
    "th.type": "类型",
    "th.endian": "端序",
    "th.status": "状态",

    // ---- 寄存器页 ----
    "reg.autorefresh": "暂停时自动刷新",
    "reg.filter": "筛选: ",
    "reg.note": "双击寄存器行可修改其值（目标需处于 halted 状态）",
    "reg.reading": "读取中…",
    "reg.count": "{n} 个寄存器",
    "reg.unparsed": "未解析到寄存器",
    "reg.readFail": "读取失败: {e}",
    "reg.prompt": "新值（十六进制）— {name}:",
    "reg.needHex": "请输入十六进制数值",
    "reg.writeFail": "写入寄存器失败: {e}",
    "th.group": "组",
    "th.name": "名称",
    "th.bits": "位宽",
    "th.value": "值",
    "th.access": "访问",
    "th.mask": "掩码",
    "th.flags": "标志",

    // ---- 内存页 ----
    "mem.addr": "地址: ",
    "mem.w.mdw": "32 位 (mdw)",
    "mem.w.mdh": "16 位 (mdh)",
    "mem.w.mdb": "8 位 (mdb)",
    "mem.w.mdd": "64 位 (mdd)",
    "mem.count": "数量: ",
    "mem.width": "宽度: ",
    "mem.read": "读取",
    "mem.prev": "◀ 上一页",
    "mem.next": "下一页 ▶",
    "mem.note": "双击数值单元格可修改内存（目标需处于 halted 状态）",
    "mem.reading": "读取中…",
    "mem.readFail": "读取失败: {e}",
    "mem.items": "{n} 项",
    "mem.noData": "读取失败或无数据",
    "mem.badAddr": "地址格式无效",
    "mem.prompt": "新值（十六进制）— 地址 0x{addr}:",
    "mem.outOfRange": "数值无效或超出宽度（上限 {max}，即 0x{hex}）",
    "mem.writeFail": "写入内存失败: {e}",
    "th.addr": "地址",

    // ---- 烧写页 ----
    "fl.legend.program": "固件烧写 (program)",
    "fl.file.ph": "固件镜像路径",
    "fl.offset": "偏移地址(可选): ",
    "fl.offset.ph": "仅 bin 需要",
    "fl.verify": "烧写后校验 (verify)",
    "fl.reset": "烧写后复位 (reset)",
    "fl.preverify": "烧写前校验 (preverify)",
    "fl.program": "⬇  烧写固件",
    "fl.legend.banks": "Flash 存储体 (flash banks)",
    "fl.bankNum": "信息输出: ",
    "fl.info": "信息 (flash info)",
    "fl.sectorRange": "扇区范围: ",
    "fl.erase": "擦除扇区",
    "fl.banks.note": "OpenOCD 识别到的可烧写 flash（flash banks）：名称/驱动/基址/大小/总线宽/芯片宽。「烧写」「校验」「擦除扇区」都作用于这些存储体；多片 flash 会列出多行，「信息输出」的编号指定对象。",
    "fl.needFile": "请先选择固件镜像文件",
    "fl.running": "执行中…",
    "fl.done": "完成",
    "fl.failed": "失败",
    "fl.programFail": "烧写失败: {e}",
    "fl.noBanks": "(无 flash bank)",
    "fl.banksFail": "flash banks 失败: {e}",
    "fl.infoFail": "flash info 失败: {e}",
    "fl.eraseDone": "扇区擦除完成",
    "fl.eraseFail": "擦除失败: {e}",
    "fl.executed": "(命令已执行)",
    "th.driver": "驱动",
    "th.base": "基址",
    "th.size": "大小",
    "th.busWidth": "总线宽",
    "th.chipWidth": "芯片宽",

    // ---- 断点 / 观察点 ----
    "bp.legend": "断点 (bp / rbp)",
    "bp.type": "类型: ",
    "bp.type.sw": "软件 (默认)",
    "bp.type.hw": "硬件 (hw)",
    "bp.addr": "地址: ",
    "bp.addr.ph": "0x08000100（十六进制地址）",
    "bp.len": "长度: ",
    "bp.add": "添加断点",
    "bp.del": "删除选中",
    "bp.delall": "全部删除",
    "bp.selNote": "单击行选中；「删除选中」只删高亮行。",
    "bp.hint.default": "执行结果显示在这里。",
    "bp.count": "共 {n} 个断点",
    "bp.empty": "（当前没有断点：填好地址后点「添加断点」，或点「刷新」重新读取）",
    "bp.needAddr": "请填写断点地址：十六进制数值地址，如 0x08000100（0x 可省略）；符号名 main 之类 OpenOCD 不接受",
    "bp.delNone": "请先在表格中单击选中一行断点",
    "bp.delCtx": "该断点没有地址（Context 断点）：OpenOCD 的 rbp 只能按地址删除，没有按 asid 删除的形式，请用「全部删除」(rbp all)",
    "bp.confirmDelAll": "确定删除全部断点？",
    "bp.listFail": "断点列表读取失败",
    "bp.parseFailLog": "断点列表解析不出一行，OpenOCD 原文：{t}",
    "bp.readFailLog": "读取断点列表失败：{e}",
    "wp.legend": "观察点 (wp / rwp)",
    "wp.addr": "地址: ",
    "wp.addr.ph": "0x20000000（十六进制地址）",
    "wp.access": "访问: ",
    "wp.access.r": "读 (r)",
    "wp.access.w": "写 (w)",
    "wp.access.a": "读写 (a)",
    "wp.valueOpt": "值(可选): ",
    "wp.maskOpt": "掩码(可选): ",
    "wp.add": "添加观察点",
    "wp.hint.default": "执行结果显示在这里。",
    "wp.count": "共 {n} 个观察点",
    "wp.empty": "（当前没有观察点：填好地址后点「添加观察点」，或点「刷新」重新读取）",
    "wp.needAddr": "请填写观察点地址：十六进制数值地址，如 0x20000000（0x 可省略）；符号名 OpenOCD 不接受",
    "wp.badValue": "观察点「值」不是合法数字（十六进制，可省略 0x）",
    "wp.badMask": "观察点「掩码」不是合法数字",
    "wp.delNone": "请先在表格中单击选中一行观察点",
    "wp.confirmDelAll": "确定删除全部观察点？",
    "wp.listFail": "观察点列表读取失败",
    "wp.parseFailLog": "观察点列表解析不出一行，OpenOCD 原文：{t}",
    "wp.readFailLog": "读取观察点列表失败：{e}",
    "bp.thNote": "备注",
    "x.hint.suffix": "{label}：{err}（请确认 OpenOCD 正在运行、已连接）",
    "x.err.shape": "（OpenOCD 的 bp/wp 只接受十六进制数值地址；符号名 main、表达式 0x…+4 都不会被解析，请先换算成地址）",
    "x.cmd.failPrefix": "失败 {cmd}",
    "x.cmd.fail": "失败 {cmd} → {e}",
    "x.cmd.noConfirm": "无法确认 {cmd}（列表读取失败：{err}，请点「刷新」重试）",
    "x.list.noConfirm": "列表读取失败，无法确认命令是否生效",
    "x.cmd.count": "（当前 {n} 个）",
    "x.cmd.ok": "已执行 {cmd} → {one}",
    "x.cmd.executed": "已执行 {cmd}",
    "x.cmd.notifyFail": "命令没有生效，详见页面上方的失败原因",
    "x.tip.addOp": "（列表条目数没变：{before} → {after}。OpenOCD 把这类失败只写进它自己的日志——「日志」页能看到；常见原因：地址没按长度对齐、目标没暂停（halt）、硬件断点/观察点资源不足、长度该目标不支持）",
    "x.tip.other": "（列表条目数没变：{before} → {after}。用「刷新」看当前实际条目；若是 Context 断点（地址列显示 ctx 0x…），OpenOCD 的 rbp 只按地址删，没有按 asid 删的形式，请用「全部删除」(rbp all)）",
    "x.len.bad": "长度只能是 1 / 2 / 4 字节（当前选了 {len}，OpenOCD 会拒绝）",
    "x.align.bad": "地址没按长度对齐：长度为 {len} 时地址必须是 {len} 的整数倍，{addr} 不是（可改成 0x{fixed}）",

    // ---- 自动检测 ----
    "ocd.notFound": "未找到 openocd，请手动指定路径",
    "ocd.needPath": "请先在「配置」页指定 OpenOCD 路径",
    "ocd.pickTitle": "选择 OpenOCD（检测到 {n} 个）",
    "ocd.multi": "检测到 {n} 个 OpenOCD，请在弹出的窗口里选择",
    "ocd.version.fail": "OpenOCD 版本检测失败（检查路径是否存在）",
    "gdb.notFound": "未找到 GDB（arm-none-eabi-gdb / gdb-multiarch / gdb），请手动指定路径",
    "gdb.detectFail": "自动检测失败: {e}",
    "gdb.pickTitle": "选择 GDB（检测到 {n} 个）",
    "gdb.multi": "检测到 {n} 个 GDB，请在弹出的窗口里选择",

    // ---- GDB 页 ----
    "gdb.server": "GDB 服务器",
    "gdb.legend": "外部 GDB 调试器",
    "gdb.path": "GDB 程序: ",
    "gdb.args": "GDB 参数: ",
    "gdb.copy": "复制命令行",
    "gdb.launch": "在新控制台启动 GDB",
    "gdb.note": "依次扫描 PATH 与常见安装位置（Arm GNU Toolchain / gdb-multiarch），多个候选会全部列进路径框的下拉。",
    "gdb.info": "连接地址: localhost:{port} (target remote localhost:{port})",
    "gdb.needPath": "请先填写 GDB 程序路径",
    "gdb.copied": "命令行已复制",
    "gdb.launched": "已启动 GDB",
    "gdb.launchFail": "启动 GDB 失败: {e}",

    // ---- 关于页 ----
    "about.legend.version": "版本",
    "about.version": "OpenOCD-GUI: ",
    "about.built": "（Tauri 2 · WebView2 / WebKitGTK）",
    "about.lang": "界面语言: ",
    "about.langAuto": "自动（跟随系统语言）",
    "about.langNow": "当前显示：{label}；",
    "about.langNote": "与「保存设置」一起写入配置文件；选「自动」时跟随系统语言，系统语言不在表内则回落英文。",
    "about.checkUpdate": "获取更新版本",
    "about.openRelease": "打开下载页",
    "about.notes": "更新说明",
    "about.openocd": "OpenOCD: ",
    "about.unknown": "未知",
    "about.configDir": "配置文件目录: ",
    "about.openConfigDir": "打开目录",
    "about.legend.links": "链接（在系统浏览器中打开）",
    "about.link.docs": "OpenOCD 官方文档",
    "about.link.project": "OpenOCD-GUI",
    "about.link.ocd": "P4rfa1t/OpenOCD",
    "about.legend.about": "说明",
    "about.desc": "OpenOCD 的图形前端：拼命令行、管理 OpenOCD 进程、经 TCL 端口读写目标（目标/寄存器/内存/断点/烧写）。调试协议与 flash 算法来自 OpenOCD 本体；GDB 与编译器不随本项目提供。",
    "up.checking": "检查中…",
    "up.new": "发现新版本 {tag}（当前 v{cur}，取自 {via}{when}）",
    "up.newNotify": "发现新版本 {tag}（当前 v{cur}）",
    "up.latest": "已是最新：v{cur}（GitHub 上为 {tag}，取自 {via}{when}）",
    "up.fail": "检查失败：{e}",
    "up.failNotify": "检查更新失败: {e}",
    "up.viaRelease": "Release",
    "up.viaTag": "标签",
    "up.published": "，发布于 {d}",
    "up.needCheck": "请先点「获取更新版本」",
    "up.noNotes": "没有可显示的更新说明",
    "up.notesTitle": "{tag} 更新说明",

    // ---- cfg 预览弹窗 ----
    "prev.ifc": "接口 cfg (-f)",
    "prev.tgt": "目标/板级 cfg (-f)",
    "prev.need": "请先选择{which}",
    "prev.title": "{label} 内容预览（只读）",
    "prev.body": "值: {v}\n解析路径: {abs}\n----- 内容 -----\n{body}",
    "prev.readFail": "—— 读取失败：{e}",
    "prev.noScripts": "—— 提示：未设置脚本目录（-s），相对名无法解析为实际路径；请先在配置页设置脚本目录。\n",

    // ---- 运行诊断提示 ----
    "fl.programStarted": "正在烧写…（OpenOCD 的输出会显示在下面）",
    "hint.accessFail": "提示：OpenOCD 刚启动就退出了，并且报了 libusb_open() failed with LIBUSB_ERROR_ACCESS / open failed —— 通常是上一个 OpenOCD 还占着调试器（上次直接关闭窗口留下的进程）。现在关窗口会自动结束它；若仍出现，请在任务管理器里结束 openocd.exe 再重连。",
    "hint.stalePort": "TCL 端口 {port} 上还有残留的 OpenOCD（上次直接关闭窗口留下的）：它同时占着调试器，所以新实例会报 libusb_open() failed / open failed。请在任务管理器里结束 openocd.exe 后重试。",

    // ---- 文件对话框过滤器 ----
    "filter.firmware": "固件镜像 (*.bin;*.hex;*.elf;*.axf;*.out;*.mot;*.s19;*.icf)",
    "filter.elf": "ELF (*.elf;*.axf;*.out)",
    "filter.hexrec": "Intel HEX / Motorola S-Record (*.hex;*.mot;*.s19)",
    "filter.bin": "二进制 (*.bin)",
    "filter.all": "所有文件 (*.*)",
    "filter.cfg": "OpenOCD 脚本 (*.cfg)",
    "filter.exe": "可执行文件 (*.exe)",
    "filter.gdbexe": "GDB 可执行文件 (*.exe)",
    "filter.log": "日志文件 (*.log;*.txt)",
  },

  en: {
    "tb.start": "▶  Start",
    "tb.stop": "■  Stop",
    "tb.tcl.on": "TCL: connected",
    "tb.tcl.off": "TCL: not connected",
    "tb.target": "Target: {v}",
    "tb.targetNone": "Target: —",
    "state.stopped": "Stopped",
    "state.starting": "Starting…",
    "state.running": "Running",
    "state.stopping": "Stopping…",
    "state.failed": "Exited unexpectedly",
    "tab.config": "Config",
    "tab.log": "Log",
    "tab.console": "Console",
    "tab.target": "Targets",
    "tab.regs": "Registers",
    "tab.mem": "Memory",
    "tab.flash": "Flash",
    "tab.bp": "Breakpoints",
    "tab.gdb": "GDB",
    "tab.about": "About",
    "common.browse": "Browse…",
    "common.clear": "Clear",
    "common.refresh": "Refresh",
    "common.autodetect": "Auto-detect",
    "common.detectVersion": "Check version",
    "common.version.unknown": "Version: unknown",
    "common.version.prefix": "Version: ",
    "common.version.checking": "Checking…",
    "common.version.none": "Not detected (check that the path exists)",
    "common.choice.pickAll": "Pick one with the buttons below, or type a path / choose from the drop-down suggestions.",
    "common.selected": "Selected {p}",
    "common.copy": "Copy",
    "common.close": "Close",
    "common.copied": "Copied to clipboard",
    "common.none": "(no output)",
    "common.err": "Error: {e}",
    "common.errorTitle": "Something went wrong",
    "common.cmdFail": "Command failed: {e}",
    "common.openFail": "Could not open the link: {e}",
    "common.opened": "Opened in the browser: {u}",
    "cfg.legend.exe": "OpenOCD program",
    "common.ph.candidates": "Click to see the candidates; type to filter",
    "cfg.legend.scripts": "Script directory (-s)",
    "cfg.rescan": "Rescan",
    "cfg.scan.count": "interface {i} · target {t} · board {b}",
    "cfg.scan.none": "Not scanned",
    "cfg.scan.failed": "Scan failed: {e}",
    "cfg.legend.cfgs": "Config files (-f; interface first, then target/board)",
    "cfg.ifc": "Interface cfg: ",
    "cfg.tgt": "Target/board cfg: ",
    "cfg.ph.ifc": "Type to filter, e.g. stlink / jlink / cmsis-dap",
    "cfg.ph.tgt": "Type to filter, e.g. stm32f1 / stm32f4",
    "cfg.preview": "View contents",
    "cfg.order.none": "No cfg selected",
    "cfg.order": "Command line: openocd … {parts}",
    "cfg.order.empty": "No cfg selected (both may stay empty)",
    "common.listSep": "; ",
    "cfg.warn.tail": " (it is still passed to OpenOCD as-is, so please double-check the spelling)",
    "cfg.preset.note": "Config presets (save this configuration under a name and load it with one click when you switch boards):",
    "cfg.preset.save": "Save as preset",
    "cfg.pair.ifc": "Interface cfg",
    "cfg.pair.tgt": "Target/board cfg",
    "cfg.warn.notInList": "{label} “{v}” is not in the script library list",
    "cfg.preset.load": "Load",
    "cfg.preset.delete": "Delete",
    "cfg.legend.cmds": "Extra -c commands (one per line, e.g. adapter speed 3000)",
    "cfg.legend.ports": "Service ports and debugging",
    "cfg.debug": "Debug level",
    "cfg.bind": "Bind",
    "cfg.debug.0": "0 (default)",
    "cfg.debug.1": "1 (minimal)",
    "cfg.debug.2": "2 (warnings)",
    "cfg.debug.3": "3 (info)",
    "cfg.debug.4": "4 (debug)",
    "cfg.logfile": "Log file (-l): ",
    "cfg.logfile.ph": "Empty = only shown on the Log tab",
    "cfg.logfile.note": "OpenOCD's own run log (equivalent to -l &lt;file&gt;, appended, same as the Log tab). Empty means nothing is written to disk.",
    "cfg.logfile.pick": "Choose…",
    "cfg.logfile.set": "Log file set to {f}",
    "cfg.logfile.cleared": "Log file cleared (the log is only shown on the Log tab)",
    "cfg.logfile.pickFail": "Could not choose the log file: {e}",
    "cfg.preset.prompt": "Preset name:",
    "cfg.preset.saved": "Preset “{n}” saved",
    "cfg.preset.needPick": "Select a preset first",
    "cfg.preset.loadFail": "Could not read preset “{n}”",
    "cfg.preset.loaded": "Loaded preset “{n}”",
    "cfg.preset.confirmDel": "Delete preset “{n}”?",
    "log.filter": "Filter: ",
    "log.f.all": "All",
    "log.f.info": "Info and above",
    "log.f.warn": "Warnings + errors",
    "log.f.err": "Errors only",
    "log.autoscroll": "Auto-scroll",
    "log.copy": "Copy all",
    "log.clear": "Clear",
    "log.copied": "Log copied",
    "console.cmd": "Command: ",
    "console.send": "Send",
    "tg.autopoll": "Auto poll",
    "tg.interval": "Interval (ms) ",
    "tg.halt": "⏸ Halt",
    "tg.resume": "▶ Resume",
    "tg.srst": "System reset + halt",
    "tg.resetMode": "Reset: ",
    "tg.reset": "Reset",
    "tg.note": "Double-click a row to make that target the current one",
    "tg.none": "No target to operate on",
    "th.target": "Target",
    "th.type": "Type",
    "th.endian": "Endian",
    "th.status": "Status",
    "reg.autorefresh": "Auto-refresh while halted",
    "reg.filter": "Filter: ",
    "reg.note": "Double-click a register row to change its value (the target must be halted)",
    "reg.reading": "Reading…",
    "reg.count": "{n} registers",
    "reg.unparsed": "No register parsed",
    "reg.readFail": "Read failed: {e}",
    "reg.prompt": "New value (hex) — {name}:",
    "reg.needHex": "Please enter a hexadecimal value",
    "reg.writeFail": "Could not write the register: {e}",
    "th.group": "Group",
    "th.name": "Name",
    "th.bits": "Bits",
    "th.value": "Value",
    "th.access": "Access",
    "th.mask": "Mask",
    "th.flags": "Flags",
    "mem.addr": "Address: ",
    "mem.w.mdw": "32-bit (mdw)",
    "mem.w.mdh": "16-bit (mdh)",
    "mem.w.mdb": "8-bit (mdb)",
    "mem.w.mdd": "64-bit (mdd)",
    "mem.count": "Count: ",
    "mem.width": "Width: ",
    "mem.read": "Read",
    "mem.prev": "◀ Prev",
    "mem.next": "Next ▶",
    "mem.note": "Double-click a value cell to modify memory (the target must be halted)",
    "mem.reading": "Reading…",
    "mem.readFail": "Read failed: {e}",
    "mem.items": "{n} items",
    "mem.noData": "Read failed or no data",
    "mem.badAddr": "Invalid address format",
    "mem.prompt": "New value (hex) — address 0x{addr}:",
    "mem.outOfRange": "Invalid value, or wider than the field (max {max}, i.e. 0x{hex})",
    "mem.writeFail": "Could not write memory: {e}",
    "th.addr": "Address",
    "fl.legend.program": "Program firmware (program)",
    "fl.file.ph": "Path to the firmware image",
    "fl.offset": "Offset (optional): ",
    "fl.offset.ph": "needed for .bin only",
    "fl.verify": "Verify after programming (verify)",
    "fl.reset": "Reset after programming (reset)",
    "fl.preverify": "Verify before programming (preverify)",
    "fl.program": "⬇  Program firmware",
    "fl.legend.banks": "Flash banks",
    "fl.bankNum": "Info output: ",
    "fl.info": "Info (flash info)",
    "fl.sectorRange": "Sector range: ",
    "fl.erase": "Erase sectors",
    "fl.banks.note": "Flash the target can program (flash banks): name / driver / base / size / bus width / chip width. Program, verify and erase all act on these banks; several flash chips give several rows, and “Info output” picks the one to use.",
    "fl.needFile": "Choose a firmware image first",
    "fl.running": "Running…",
    "fl.done": "Done",
    "fl.failed": "Failed",
    "fl.programFail": "Programming failed: {e}",
    "fl.noBanks": "(no flash bank)",
    "fl.banksFail": "flash banks failed: {e}",
    "fl.infoFail": "flash info failed: {e}",
    "fl.eraseDone": "Sector erase finished",
    "fl.eraseFail": "Erase failed: {e}",
    "fl.executed": "(command executed)",
    "th.driver": "Driver",
    "th.base": "Base",
    "th.size": "Size",
    "th.busWidth": "Bus width",
    "th.chipWidth": "Chip width",
    "bp.legend": "Breakpoints (bp / rbp)",
    "bp.type": "Type: ",
    "bp.type.sw": "Software (default)",
    "bp.type.hw": "Hardware (hw)",
    "bp.addr": "Address: ",
    "bp.addr.ph": "0x08000100 (hex address)",
    "bp.len": "Length: ",
    "bp.add": "Add breakpoint",
    "bp.del": "Delete selected",
    "bp.delall": "Delete all",
    "bp.selNote": "Click a row to select it; “Delete selected” removes only the highlighted row.",
    "bp.hint.default": "Results show up here.",
    "bp.count": "{n} breakpoints",
    "bp.empty": "(no breakpoints yet: fill in an address and press “Add breakpoint”, or press “Refresh” to read them again)",
    "bp.needAddr": "Enter a breakpoint address: a hex number such as 0x08000100 (the 0x is optional); OpenOCD does not accept symbol names like main",
    "bp.delNone": "Click a breakpoint row in the table first",
    "bp.delCtx": "This breakpoint has no address (a Context breakpoint): OpenOCD's rbp can only delete by address, there is no by-asid form — use “Delete all” (rbp all)",
    "bp.confirmDelAll": "Delete all breakpoints?",
    "bp.listFail": "Could not read the breakpoint list",
    "bp.parseFailLog": "No breakpoint row could be parsed from the list; raw OpenOCD output: {t}",
    "bp.readFailLog": "Could not read the breakpoint list: {e}",
    "wp.legend": "Watchpoints (wp / rwp)",
    "wp.addr": "Address: ",
    "wp.addr.ph": "0x20000000 (hex address)",
    "wp.access": "Access: ",
    "wp.access.r": "Read (r)",
    "wp.access.w": "Write (w)",
    "wp.access.a": "Read/write (a)",
    "wp.valueOpt": "Value (optional): ",
    "wp.maskOpt": "Mask (optional): ",
    "wp.add": "Add watchpoint",
    "wp.hint.default": "Results show up here.",
    "wp.count": "{n} watchpoints",
    "wp.empty": "(no watchpoints yet: fill in an address and press “Add watchpoint”, or press “Refresh” to read them again)",
    "wp.needAddr": "Enter a watchpoint address: a hex number such as 0x20000000 (the 0x is optional); OpenOCD does not accept symbol names",
    "wp.badValue": "The watchpoint value is not a valid number (hex, the 0x is optional)",
    "wp.badMask": "The watchpoint mask is not a valid number",
    "wp.delNone": "Click a watchpoint row in the table first",
    "wp.confirmDelAll": "Delete all watchpoints?",
    "wp.listFail": "Could not read the watchpoint list",
    "wp.parseFailLog": "No watchpoint row could be parsed from the list; raw OpenOCD output: {t}",
    "wp.readFailLog": "Could not read the watchpoint list: {e}",
    "bp.thNote": "Note",
    "x.hint.suffix": "{label}: {err} (check that OpenOCD is running and connected)",
    "x.err.shape": "(OpenOCD's bp/wp only take hexadecimal numeric addresses; symbol names like main and expressions like 0x…+4 are not parsed — convert them to an address first)",
    "x.cmd.failPrefix": "Failed {cmd}",
    "x.cmd.fail": "Failed {cmd} → {e}",
    "x.cmd.noConfirm": "Cannot confirm {cmd} (reading the list failed: {err}; press “Refresh” to retry)",
    "x.list.noConfirm": "Could not read the list, so the command cannot be confirmed",
    "x.cmd.count": "({n} now)",
    "x.cmd.ok": "Executed {cmd} → {one}",
    "x.cmd.executed": "Executed {cmd}",
    "x.cmd.notifyFail": "The command did not take effect; see the reason above on the page",
    "x.tip.addOp": "(the entry count did not change: {before} → {after}. OpenOCD only writes this kind of failure to its own log — see the Log tab. Common causes: the address is not aligned to the length, the target is not halted, no hardware breakpoint/watchpoint resources left, or the target does not support that length)",
    "x.tip.other": "(the entry count did not change: {before} → {after}. Press “Refresh” to see the actual entries; if this is a Context breakpoint (the address column shows ctx 0x…), OpenOCD's rbp only deletes by address, there is no by-asid form — use “Delete all” (rbp all))",
    "x.len.bad": "The length can only be 1 / 2 / 4 bytes (currently {len}; OpenOCD will refuse it)",
    "x.align.bad": "The address is not aligned to the length: with length {len} the address must be a multiple of {len}; {addr} is not (it could be 0x{fixed})",
    "ocd.notFound": "openocd not found, please set the path manually",
    "ocd.needPath": "Set the OpenOCD path on the Config tab first",
    "ocd.pickTitle": "Choose OpenOCD ({n} detected)",
    "ocd.multi": "{n} OpenOCD installations detected; choose one in the dialog",
    "ocd.version.fail": "OpenOCD version check failed (check that the path exists)",
    "gdb.notFound": "GDB not found (arm-none-eabi-gdb / gdb-multiarch / gdb), please set the path manually",
    "gdb.detectFail": "Auto-detection failed: {e}",
    "gdb.pickTitle": "Choose GDB ({n} detected)",
    "gdb.multi": "{n} GDB installations detected; choose one in the dialog",
    "gdb.server": "GDB server",
    "gdb.legend": "External GDB debugger",
    "gdb.path": "GDB program: ",
    "gdb.args": "GDB arguments: ",
    "gdb.copy": "Copy command line",
    "gdb.launch": "Launch GDB in a new console",
    "gdb.note": "Scans PATH and the usual install locations (Arm GNU Toolchain / gdb-multiarch); several candidates are all listed in the path field's drop-down.",
    "gdb.info": "Connect to: localhost:{port} (target remote localhost:{port})",
    "gdb.needPath": "Enter the GDB program path first",
    "gdb.copied": "Command line copied",
    "gdb.launched": "GDB launched",
    "gdb.launchFail": "Could not launch GDB: {e}",
    "about.legend.version": "Version",
    "about.version": "OpenOCD-GUI: ",
    "about.built": "(Tauri 2 · WebView2 / WebKitGTK)",
    "about.lang": "Interface language: ",
    "about.langAuto": "Automatic (follow the system)",
    "about.langNow": "Currently showing: {label};",
    "about.langNote": "saved together with “Save settings”; “Automatic” follows the system language and falls back to English.",
    "about.checkUpdate": "Check for updates",
    "about.openRelease": "Open download page",
    "about.notes": "Release notes",
    "about.openocd": "OpenOCD: ",
    "about.unknown": "unknown",
    "about.configDir": "Config directory: ",
    "about.openConfigDir": "Open directory",
    "about.legend.links": "Links (open in the system browser)",
    "about.link.docs": "OpenOCD documentation",
    "about.link.project": "OpenOCD-GUI",
    "about.link.ocd": "P4rfa1t/OpenOCD",
    "about.legend.about": "About",
    "about.desc": "A graphical front end for OpenOCD: build the command line, manage the OpenOCD process, and read/write the target through the TCL port (targets / registers / memory / breakpoints / flash). The debug protocol and the flash algorithms come from OpenOCD itself; GDB and a compiler are not bundled.",
    "up.checking": "Checking…",
    "up.new": "New version {tag} (current v{cur}, from {via}{when})",
    "up.newNotify": "New version {tag} (current v{cur})",
    "up.latest": "Up to date: v{cur} (GitHub has {tag}, from {via}{when})",
    "up.fail": "Check failed: {e}",
    "up.failNotify": "Update check failed: {e}",
    "up.viaRelease": "release",
    "up.viaTag": "tag",
    "up.published": ", published {d}",
    "up.needCheck": "Press “Check for updates” first",
    "up.noNotes": "No release notes to show",
    "up.notesTitle": "{tag} release notes",
    "prev.ifc": "Interface cfg (-f)",
    "prev.tgt": "Target/board cfg (-f)",
    "prev.need": "Choose {which} first",
    "prev.title": "{label} — preview (read-only)",
    "prev.body": "Value: {v}\\nResolved path: {abs}\\n----- contents -----\\n{body}",
    "prev.readFail": "—— read failed: {e}",
    "prev.noScripts": "—— note: no script directory (-s) is set, so a relative name cannot be resolved to a real path; set the script directory on the Config tab first.\\n",
    "fl.programStarted": "Programming… (OpenOCD's output appears below)",
    "hint.accessFail": "Note: OpenOCD exited right after starting and reported libusb_open() failed with LIBUSB_ERROR_ACCESS / open failed — usually a previous OpenOCD still holds the debug probe (left over from closing the window last time). Closing the window now shuts it down; if it still happens, end openocd.exe in Task Manager and reconnect.",
    "hint.stalePort": "A stale OpenOCD is still on TCL port {port} (left over from closing the window last time): it also holds the debug probe, so a new instance reports libusb_open() failed / open failed. End openocd.exe in Task Manager and retry.",
    "filter.firmware": "Firmware images (*.bin;*.hex;*.elf;*.axf;*.out;*.mot;*.s19;*.icf)",
    "filter.elf": "ELF (*.elf;*.axf;*.out)",
    "filter.hexrec": "Intel HEX / Motorola S-Record (*.hex;*.mot;*.s19)",
    "filter.bin": "Binary (*.bin)",
    "filter.all": "All files (*.*)",
    "filter.cfg": "OpenOCD scripts (*.cfg)",
    "filter.exe": "Executables (*.exe)",
    "filter.gdbexe": "GDB executables (*.exe)",
    "filter.log": "Log files (*.log;*.txt)",
  },
};

let curLang = FALLBACK_LANG;   // 当前实际用于取文案的语言
let curPref = LANG_AUTO;       // 用户偏好："auto" 或某个 code

function hasLang(code) {
  return !!code && Object.prototype.hasOwnProperty.call(I18N, code);
}

function langList() { return LANGS.slice(); }

function langLabel(code) {
  const l = LANGS.find(x => x.code === code);
  return l ? l.label : code;
}

// 系统语言标签 → 表里的语言：zh-CN / zh-Hans / zh-TW → zh；en-US / en-GB → en；其余按主语言匹配
function mapSystemTag(tag) {
  const s = String(tag == null ? "" : tag).toLowerCase();
  if (!s) return "";
  if (s === "zh" || s.startsWith("zh-") || s.startsWith("zh_")) return "zh";
  if (s === "en" || s.startsWith("en-") || s.startsWith("en_")) return "en";
  const base = s.split(/[-_]/)[0];
  return hasLang(base) ? base : "";
}

// 系统语言列表：navigator.languages 是有序偏好，逐个试
function systemLangs() {
  const out = [];
  try {
    if (typeof navigator !== "undefined" && navigator) {
      if (Array.isArray(navigator.languages)) out.push.apply(out, navigator.languages);
      if (navigator.language) out.push(navigator.language);
      if (navigator.userLanguage) out.push(navigator.userLanguage);
    }
  } catch (e) { /* 非浏览器环境 */ }
  return out;
}

function detectLang() {
  const tags = systemLangs();
  for (let i = 0; i < tags.length; i++) {
    const c = mapSystemTag(tags[i]);
    if (c) return c;
  }
  return DETECT_FALLBACK;
}

// 偏好 → 实际语言："auto"/空 → 系统语言；具体 code 直接用；无法识别则回落系统语言
function resolveLang(pref) {
  const p = String(pref == null ? "" : pref).trim();
  if (!p || p === LANG_AUTO || p === "system" || p === "default") return detectLang();
  if (hasLang(p)) return p;
  return mapSystemTag(p) || detectLang();
}

function t(key, vars) {
  const table = I18N[curLang] || {};
  const fb = I18N[FALLBACK_LANG] || {};
  let s = table[key];
  if (s === undefined) s = fb[key];
  if (s === undefined) return key;   // 缺键就原样显示键名，便于一眼发现
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
  return s;
}

// 把 HTML 里带 data-i18n / data-i18n-placeholder / data-i18n-title 的元素刷成当前语言
function applyI18n(root) {
  const r = root || document;
  r.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  r.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
  r.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.getAttribute("data-i18n-title")); });
  // 通知 app.js：静态文案已按新语言重写，动态文案（状态标签 / TCL 标签等）该跟着刷一遍
  try { document.dispatchEvent(new CustomEvent("i18n-applied")); } catch (e) { /* 非浏览器环境忽略 */ }
}

// 关于页的语言下拉若已存在，保持它显示当前偏好
function syncLangSelect() {
  try {
    const el = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("about-lang") : null;
    if (el) el.value = curPref;
  } catch (e) { /* 忽略 */ }
}

// setLang 收的是「偏好」：LANG_AUTO（跟随系统）/ zh / en …
function setLang(pref) {
  let p = String(pref == null ? "" : pref).trim();
  if (p !== LANG_AUTO && !hasLang(p)) p = LANG_AUTO;
  curPref = p;
  curLang = resolveLang(curPref);
  try { document.documentElement.lang = curLang === "zh" ? "zh-CN" : curLang; } catch (e) { /* 忽略 */ }
  syncLangSelect();
  applyI18n();
  return curLang;
}

function currentLang() { return curLang; }
function currentLangPref() { return curPref; }
