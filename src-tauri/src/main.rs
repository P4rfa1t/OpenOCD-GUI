// Prevents an additional console window on Windows in release builds.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// ---------------------------------------------------------------- settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct Settings {
    openocd_path: String,
    scripts_dir: String,
    #[serde(default)]
    search_paths: Vec<String>,
    #[serde(default)]
    configs: Vec<String>,
    #[serde(default)]
    interface_cfg: String,
    #[serde(default)]
    target_cfg: String,
    #[serde(default)]
    extra_commands: Vec<String>,
    debug_level: i32,
    log_file: String,
    bind: String,
    gdb_port: i64,
    tcl_port: i64,
    telnet_port: i64,
    gdb_path: String,
    gdb_args: String,
    auto_poll: bool,
    poll_interval_ms: u64,
    auto_refresh_regs: bool,
    #[serde(default)]
    window_geometry: String,
    /// 界面语言偏好："auto"（跟随系统语言，默认）或具体 code（zh / en…）
    #[serde(default = "default_lang")]
    lang: String,
}

fn default_lang() -> String {
    // "auto" = 跟随系统语言；前端 setLang 会把它解析成 I18N 里的某张表
    "auto".into()
}

// Linux 上 GDB 常带版本后缀（gdb-multiarch / arm-none-eabi-gdb）
fn default_gdb_name() -> String {
    if cfg!(windows) {
        return "arm-none-eabi-gdb".into();
    }
    for cand in ["arm-none-eabi-gdb", "gdb-multiarch", "gdb"] {
        if let Ok(paths) = std::env::var("PATH") {
            for dir in std::env::split_paths(&paths) {
                if dir.join(cand).is_file() {
                    return cand.to_string();
                }
            }
        }
    }
    "arm-none-eabi-gdb".into()
}

impl Settings {
    fn with_defaults() -> Self {
        Self {
            bind: "127.0.0.1".into(),
            gdb_port: 3333,
            tcl_port: 6666,
            telnet_port: 4444,
            gdb_path: default_gdb_name(),
            gdb_args: "-ex \"target remote localhost:3333\"".into(),
            auto_poll: true,
            poll_interval_ms: 1000,
            auto_refresh_regs: true,
            lang: default_lang(),
            ..Default::default()
        }
    }
}

fn config_dir() -> std::path::PathBuf {
    // Windows: %USERPROFILE%；Linux/macOS: $XDG_CONFIG_HOME 或 $HOME
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    if home.is_empty() {
        return std::path::PathBuf::from(".openocd_gui");
    }
    std::path::PathBuf::from(home).join(".openocd_gui")
}

fn settings_path() -> std::path::PathBuf {
    config_dir().join("settings.json")
}

fn profiles_dir() -> std::path::PathBuf {
    config_dir().join("profiles")
}

#[derive(Default)]
struct AppState {
    child: Mutex<Option<Child>>,
    tcl: Mutex<Option<TcpStream>>,
    settings: Mutex<Settings>,
    poll_enabled: AtomicBool,
    server_running: AtomicBool,
    stopping: AtomicBool,
    epoch: AtomicU64,
    settings_load_error: Mutex<Option<String>>,
}

// ---------------------------------------------------------------- tcl rpc
fn tcl_call_raw(stream: &mut TcpStream, cmd: &str, timeout: Duration) -> Result<String, String> {
    tcl_call_raw_bytes(stream, cmd.as_bytes(), timeout)
}

fn tcl_call_raw_bytes(stream: &mut TcpStream, cmd: &[u8], timeout: Duration) -> Result<String, String> {
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    stream
        .write_all(cmd)
        .and_then(|_| stream.write_all(b"\x1a"))
        .map_err(|e| format!("发送失败: {}", e))?;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 65536];
    loop {
        let n = stream.read(&mut chunk).map_err(|e| format!("读取失败: {}", e))?;
        if n == 0 {
            return Err("OpenOCD 关闭了 TCL 连接".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.iter().position(|&b| b == 0x1a) {
            let mut text = String::from_utf8_lossy(&buf[..pos]).to_string();
            while text.ends_with('\n') || text.ends_with('\r') {
                text.pop();
            }
            return Ok(text);
        }
    }
}

fn tcl_call(state: &AppState, cmd: &str, timeout: Duration) -> Result<String, String> {
    tcl_call_bytes(state, cmd.as_bytes(), timeout)
}

fn tcl_call_bytes(state: &AppState, cmd: &[u8], timeout: Duration) -> Result<String, String> {
    let mut guard = state.tcl.lock().unwrap();
    match guard.as_mut() {
        Some(stream) => {
            let r = tcl_call_raw_bytes(stream, cmd, timeout);
            if r.is_err() {
                *guard = None;
            }
            r
        }
        None => Err("TCL 尚未连接".into()),
    }
}

// Encode a path for the TCL RPC: Jim Tcl fopen uses the ANSI codepage on
// Windows, so non-ASCII paths must be converted from UTF-16 to CP_ACP.
#[cfg(windows)]
fn encode_ansi(s: &str) -> Result<Vec<u8>, String> {
    use std::os::raw::c_int;
    #[link(name = "kernel32")]
    extern "system" {
        fn WideCharToMultiByte(
            codepage: u32, flags: u32, wstr: *const u16, wlen: c_int,
            buf: *mut u8, buflen: c_int, default: *const u8, used: *mut i32,
        ) -> c_int;
    }
    let wide: Vec<u16> = s.encode_utf16().collect();
    let len = unsafe {
        WideCharToMultiByte(0, 0, wide.as_ptr(), wide.len() as c_int,
                            std::ptr::null_mut(), 0, std::ptr::null(), std::ptr::null_mut())
    };
    if len <= 0 {
        return Err("路径编码失败".into());
    }
    let mut buf = vec![0u8; len as usize];
    let r = unsafe {
        WideCharToMultiByte(0, 0, wide.as_ptr(), wide.len() as c_int,
                            buf.as_mut_ptr(), len, std::ptr::null(), std::ptr::null_mut())
    };
    if r <= 0 {
        return Err("路径编码失败".into());
    }
    Ok(buf)
}

#[cfg(not(windows))]
fn encode_ansi(s: &str) -> Result<Vec<u8>, String> {
    Ok(s.as_bytes().to_vec())
}

#[tauri::command]
fn program_firmware(
    state: State<'_, AppState>,
    path: String,
    offset: String,
    preverify: bool,
    verify: bool,
    reset: bool,
) -> Result<String, String> {
    let norm = path.replace('\\', "/");
    let pb = encode_ansi(&norm).map_err(|e| format!("固件路径无法发送给 OpenOCD（{}）。请移动到纯英文路径后重试。", e))?;
    let mut cmd: Vec<u8> = b"program {".to_vec();
    cmd.extend_from_slice(&pb);
    cmd.extend_from_slice(b"}");
    if !offset.trim().is_empty() {
        cmd.extend_from_slice(b" ");
        cmd.extend_from_slice(offset.trim().as_bytes());
    }
    for (flag, on) in [("preverify", preverify), ("verify", verify), ("reset", reset)] {
        if on {
            cmd.extend_from_slice(b" ");
            cmd.extend_from_slice(flag.as_bytes());
        }
    }
    tcl_call_bytes(state.inner(), &cmd, Duration::from_secs(300))
}

// ---------------------------------------------------------------- process
fn build_command(s: &Settings) -> Result<Vec<String>, String> {
    if s.openocd_path.trim().is_empty() {
        return Err("未设置 OpenOCD 可执行文件路径".into());
    }
    let mut args = vec![s.openocd_path.clone()];
    let scripts = s.scripts_dir.trim();
    if !scripts.is_empty() {
        args.push("-s".into());
        args.push(scripts.to_string());
    }
    for p in &s.search_paths {
        if !p.trim().is_empty() {
            args.push("-s".into());
            args.push(p.trim().to_string());
        }
    }
    if s.debug_level > 0 {
        args.push(format!("-d{}", s.debug_level));
    }
    if !s.log_file.trim().is_empty() {
        args.push("-l".into());
        args.push(s.log_file.trim().to_string());
    }
    let bind = s.bind.trim();
    if !bind.is_empty() && bind != "127.0.0.1" && bind != "localhost" {
        args.push("-c".into());
        args.push(format!("bindto {}", bind));
    }
    for (name, port) in [("gdb", s.gdb_port), ("tcl", s.tcl_port), ("telnet", s.telnet_port)] {
        args.push("-c".into());
        args.push(format!("{} port {}", name, port));
    }
    // 配置文件：固定先接口、后目标/板级（接口排在目标之后会导致 OpenOCD 启动失败）。
    // 旧版有序列表 configs 仅保留反序列化兼容，不再参与构建命令。
    if !s.interface_cfg.trim().is_empty() {
        args.push("-f".into());
        args.push(s.interface_cfg.trim().to_string());
    }
    if !s.target_cfg.trim().is_empty() {
        args.push("-f".into());
        args.push(s.target_cfg.trim().to_string());
    }
    for c in &s.extra_commands {
        if !c.trim().is_empty() {
            args.push("-c".into());
            args.push(c.trim().to_string());
        }
    }
    Ok(args)
}

fn spawn_openocd(args: &[String]) -> Result<Child, String> {
    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("无法启动 OpenOCD: {}", e))
}

fn supervise(app: AppHandle, state: &AppState, settings: Settings) {
    state.server_running.store(true, Ordering::SeqCst);
    state.stopping.store(false, Ordering::SeqCst);
    state
        .poll_enabled
        .store(settings.auto_poll, Ordering::SeqCst);
    // try to connect the TCL RPC port until the process dies
    let addr = format!("127.0.0.1:{}", settings.tcl_port);
    loop {
        if !state.server_running.load(Ordering::SeqCst) {
            break;
        }
        match addr
            .to_socket_addrs()
            .ok()
            .and_then(|mut it| it.next())
            .and_then(|a| TcpStream::connect_timeout(&a, Duration::from_secs(2)).ok())
        {
            Some(stream) => {
                let _ = stream.set_nodelay(true);
                *state.tcl.lock().unwrap() = Some(stream);
                let _ = app.emit("tcl-state", true);
                let _ = app.emit("server-state", "running");
                poll_loop(&app, state, &settings);
                *state.tcl.lock().unwrap() = None;
            }
            None => {}
        }
        let _ = app.emit("tcl-state", false);
        if !state.server_running.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    *state.tcl.lock().unwrap() = None;
    let _ = app.emit("tcl-state", false);
}

fn poll_loop(app: &AppHandle, state: &AppState, settings: &Settings) {
    let interval = Duration::from_millis(settings.poll_interval_ms.max(150));
    loop {
        if !state.server_running.load(Ordering::SeqCst) {
            return;
        }
        if state.poll_enabled.load(Ordering::SeqCst) {
            match tcl_call(state, "targets", Duration::from_secs(5)) {
                Ok(text) => {
                    let _ = app.emit("targets", text);
                }
                Err(_) => return,
            }
        }
        std::thread::sleep(interval);
    }
}

// ---------------------------------------------------------------- commands
fn dbglog(msg: &str) {
    if let Ok(mut path) = std::env::var("TEMP") {
        path.push_str("\\ocd_gui_tauri.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let _ = writeln!(f, "{}", msg);
        }
    }
}

#[tauri::command]
fn log_msg(msg: String) {
    dbglog(&format!("[js] {}", msg));
}

#[tauri::command]
fn is_autostart() -> bool {
    let on = std::env::var("OPENOCD_GUI_AUTOSTART").is_ok();
    dbglog(&format!("is_autostart called -> {}", on));
    on
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

/// 启动时读取设置文件失败的说明（解析失败会保留原文件并回落默认值）
#[tauri::command]
fn settings_load_error(state: State<'_, AppState>) -> Option<String> {
    state.settings_load_error.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    std::fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    // 先写临时文件再原子替换：避免写一半被中断，留下一份截断 JSON
    // （截断的 JSON 下次启动会解析失败，进而把用户整份设置抹成默认值）。
    let path = settings_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

/// 读取设置，并区分「文件不存在」与「读到了但解析失败」。
/// 解析失败（含单个字段类型不符 —— serde 的 #[serde(default)] 只管字段缺失，
/// 管不了字段存在但类型错）以前是静默吞掉并回落默认值，随后被 save_settings
/// 覆盖写回，等于把用户整份配置抹掉；现在改成先备份原文件、再回落默认值，
/// 并把原因通过 settings_load_error 告诉前端。
fn load_settings_with_error() -> (Settings, Option<String>) {
    let path = settings_path();
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Settings::with_defaults(), None),
        Err(e) => {
            let msg = format!("读取设置文件失败（{}）：{}；本次使用默认设置。", path.display(), e);
            dbglog(&msg);
            return (Settings::with_defaults(), Some(msg));
        }
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(s) => (s, None),
        Err(e) => {
            // 备份名固定，就只在不存在时用；否则第二次损坏会把上一次的备份覆盖掉
            let mut bad = path.with_extension("json.bad");
            if bad.exists() {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                bad = path.with_extension(format!("json.bad-{}", ts));
            }
            let kept = std::fs::rename(&path, &bad).is_ok();
            let msg = if kept {
                format!("设置文件解析失败（{}）：{}；原文件已保留为 {}，本次使用默认设置。", path.display(), e, bad.display())
            } else {
                format!("设置文件解析失败（{}）：{}；本次使用默认设置（原文件保留失败）。", path.display(), e)
            };
            dbglog(&msg);
            (Settings::with_defaults(), Some(msg))
        }
    }
}

#[tauri::command]
fn start_server(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    dbglog("start_server invoked");
    if state.server_running.load(Ordering::SeqCst) {
        return Err("OpenOCD 已在运行".into());
    }
    // 上次直接关窗口可能留下一个还占着调试器的 openocd：先请它退出，再启动新的。
    if state.child.lock().unwrap().is_none() && tcl_port_open(settings.tcl_port) {
        dbglog("stale OpenOCD on tcl port; asking it to shut down");
        let _ = app.emit(
            "log",
            format!(
                "Warn : TCL 端口 {} 上还有残留的 OpenOCD（多半是上次直接关闭窗口留下的），正在请它退出…",
                settings.tcl_port
            ),
        );
        if clear_stale_openocd(settings.tcl_port) {
            for _ in 0..12 {
                if !tcl_port_open(settings.tcl_port) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        if tcl_port_open(settings.tcl_port) {
            return Err(format!(
                "E_STALE_TCL|{}|还有残留的 openocd.exe 占着 TCL 端口（它也占着调试器，所以新实例会报 libusb_open() failed / open failed）。请在任务管理器里结束 openocd.exe 后重试。",
                settings.tcl_port
            ));
        }
    }
    let args = build_command(&settings)?;
    dbglog(&format!("argv: {:?}", args));
    let mut child = spawn_openocd(&args)?;
    dbglog("spawn ok");
    let _ = app.emit("server-state", "starting");

    // log reader thread (stdout + stderr merged)
    if let Some(stdout) = child.stdout.take() {
        let app2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app2.emit("log", l);
                    }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(|l| l.ok()) {
                let _ = app2.emit("log", line);
            }
        });
    }

    *state.child.lock().unwrap() = Some(child);
    *state.settings.lock().unwrap() = settings.clone();

    // watcher thread: report exit
    // 代际号：只有「本代 supervise 还没被新的 start 取代」时才允许报异常退出，
    // 避免「停止后立刻重新连接」时旧 watcher 误报 failed（stopping 是共享标志，会被新 supervise 清掉）
    let my_epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let app3 = app.clone();
    let started = std::time::Instant::now();
    std::thread::spawn(move || {
        let st = app3.state::<AppState>();
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let mut guard = st.child.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        *guard = None;
                        drop(guard);
                        // 刚起来就死：多半是调试器被上一个 openocd 占着（LIBUSB_ERROR_ACCESS）
                        if started.elapsed() < Duration::from_secs(4) {
                            let _ = app3.emit("ocd-hint", "hint.accessFail");
                        }
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => break,
                }
            } else {
                break;
            }
        }
        st.server_running.store(false, Ordering::SeqCst);
        *st.tcl.lock().unwrap() = None;
        // 主动「停止」时不要报「异常退出」：停止流程自己会发 stopped；
        // 已被新一代 start 取代的旧 watcher 也不再报（代际号不符）
        if !st.stopping.load(Ordering::SeqCst) && st.epoch.load(Ordering::SeqCst) == my_epoch {
            let _ = app3.emit("server-state", "failed");
        }
    });

    // supervisor thread
    let app4 = app.clone();
    std::thread::spawn(move || {
        let st = app4.state::<AppState>();
        supervise(app4.clone(), st.inner(), settings);
    });
    Ok(())
}

/// 结束 OpenOCD 子进程。graceful = 先发 TCL shutdown 让它自己收尾（慢一点但干净）。
/// 「停止」按钮与窗口关闭（RunEvent::ExitRequested / Exit）都走这里：窗口直接关掉时若
/// 不带走子进程，残留的 openocd 会一直占着调试器（libusb）和端口，下次连接就会报
/// `libusb_open() failed with LIBUSB_ERROR_ACCESS` / `open failed`。
fn shutdown_openocd(state: &AppState, graceful: bool) {
    state.server_running.store(false, Ordering::SeqCst);
    if graceful {
        let _ = tcl_call(state, "shutdown", Duration::from_millis(1200));
        std::thread::sleep(Duration::from_millis(400));
    }
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        match child.try_wait() {
            Ok(Some(_)) => {}
            _ => {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// 该端口上是否已经有人在听（用来识别上次直接关窗口留下的 OpenOCD）。
fn tcl_port_open(port: i64) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    match addr.to_socket_addrs().ok().and_then(|mut it| it.next()) {
        Some(a) => TcpStream::connect_timeout(&a, Duration::from_millis(400)).is_ok(),
        None => false,
    }
}

/// 端口上如果真是残留的 OpenOCD（先用 version 探一下，确认是 OpenOCD 再动手），
/// 就请它 shutdown。返回是否确认并发出过 shutdown。
fn clear_stale_openocd(port: i64) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    let a = match addr.to_socket_addrs().ok().and_then(|mut it| it.next()) {
        Some(a) => a,
        None => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&a, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let probe = tcl_call_raw(&mut stream, "version", Duration::from_millis(900)).unwrap_or_default();
    let low = probe.to_lowercase();
    if !low.contains("openocd") && !low.contains("open on-chip debugger") {
        return false;
    }
    let _ = tcl_call_raw(&mut stream, "shutdown", Duration::from_millis(900));
    true
}

#[tauri::command]
fn stop_server(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let st = state.inner();
    st.stopping.store(true, Ordering::SeqCst);
    let _ = app.emit("server-state", "stopping");
    shutdown_openocd(st, true);
    let _ = app.emit("server-state", "stopped");
    Ok(())
}

#[tauri::command]
fn tcl_exec(state: State<'_, AppState>, cmd: String) -> Result<String, String> {
    tcl_call(state.inner(), &cmd, Duration::from_secs(60))
}

#[tauri::command]
fn set_poll_enabled(state: State<'_, AppState>, enabled: bool) {
    state.poll_enabled.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn refresh_targets(state: State<'_, AppState>) -> Result<String, String> {
    tcl_call(state.inner(), "targets", Duration::from_secs(5))
}

// ---------------------------------------------------------------- detector
fn openocd_bin_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["openocd.exe", "openocd"]
    } else {
        &["openocd"]
    }
}

fn extra_candidates() -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    if cfg!(windows) {
        for extra in [
            r"C:\Program Files\openocd\bin\openocd.exe",
            r"C:\Program Files\OpenOCD\bin\openocd.exe",
            r"C:\Program Files (x86)\openocd\bin\openocd.exe",
            r"C:\OpenOCD\bin\openocd.exe",
            r"C:\msys64\usr\bin\openocd.exe",
            r"C:\msys64\ucrt64\bin\openocd.exe",
        ] {
            v.push(extra.to_string());
        }
    } else {
        for extra in [
            "/usr/bin/openocd",
            "/usr/local/bin/openocd",
            "/usr/sbin/openocd",
            "/opt/homebrew/bin/openocd",
            "/opt/local/bin/openocd",
            "/snap/bin/openocd",
            "/var/lib/flatpak/exports/bin/org.openocd.OpenOCD",
        ] {
            v.push(extra.to_string());
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                v.push(format!("{}/.local/bin/openocd", home));
                v.push(format!("{}/.cargo/bin/openocd", home));
            }
        }
    }
    v
}

fn find_openocd_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: std::path::PathBuf| {
        if p.is_file() {
            let s = p.to_string_lossy().to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    };
    // PATH 用系统分隔符拆分（Windows 为 ';'，Linux/macOS 为 ':'）
    for dir in std::env::split_paths(&std::env::var("PATH").unwrap_or_default()) {
        for name in openocd_bin_names() {
            push(dir.join(name));
        }
    }
    for extra in extra_candidates() {
        push(std::path::PathBuf::from(extra));
    }
    out
}

#[tauri::command]
fn detect_openocd() -> Vec<String> {
    find_openocd_candidates()
}

#[tauri::command]
fn query_version(exe: String) -> String {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new(&exe);
        use std::os::windows::process::CommandExt;
        c.arg("--version");
        c.creation_flags(0x0800_0000);
        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(&exe);
        c.arg("--version");
        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());
        c
    };
    match cmd.output() {
        Ok(out) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            for line in text.lines() {
                if let Some(rest) = line.strip_prefix("Open On-Chip Debugger ") {
                    return rest.split_whitespace().next().unwrap_or("").to_string();
                }
            }
            text.lines().next().unwrap_or("").to_string()
        }
        Err(_) => String::new(),
    }
}

fn guess_scripts_dir(exe: &str) -> String {
    if exe.is_empty() {
        return String::new();
    }
    let dir = std::path::Path::new(exe)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    for rel in [
        "../share/openocd/scripts",
        "../openocd/scripts",
        "../scripts",
        "scripts",
        "../share/scripts",
        // Linux 发行版 / Flatpak / AppImage 的常见布局
        "../share/openocd",
        "../../share/openocd/scripts",
        "/usr/share/openocd/scripts",
        "/usr/local/share/openocd/scripts",
    ] {
        let cand = dir.join(rel);
        if cand.join("interface").is_dir() || cand.join("target").is_dir() {
            return cand.to_string_lossy().to_string();
        }
    }
    String::new()
}

#[tauri::command]
fn guess_scripts(exe: String) -> String {
    guess_scripts_dir(&exe)
}

#[tauri::command]
fn scan_scripts(dir: String) -> std::collections::HashMap<String, Vec<String>> {
    let mut out = std::collections::HashMap::new();
    out.insert("interface".to_string(), Vec::new());
    out.insert("target".to_string(), Vec::new());
    out.insert("board".to_string(), Vec::new());
    let root = std::path::Path::new(&dir);
    for category in ["interface", "target", "board"] {
        let base = root.join(category);
        let mut files = Vec::new();
        fn walk(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>) {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                        if !name.starts_with('.') {
                            walk(base, &p, out);
                        }
                    } else if p.extension().map(|x| x == "cfg").unwrap_or(false) {
                        if let Ok(rel) = p.strip_prefix(base.parent().unwrap_or(base)) {
                            out.push(rel.to_string_lossy().replace('\\', "/"));
                        }
                    }
                }
            }
        }
        if base.is_dir() {
            walk(&base, &base, &mut files);
            files.sort();
        }
        out.insert(category.to_string(), files);
    }
    out
}

#[tauri::command]
fn launch_gdb(gdb: String, args: String) -> Result<(), String> {
    let mut cmd = Command::new(&gdb);
    let mut cur = String::new();
    let mut in_q = false;
    for ch in args.chars() {
        match ch {
            '"' => in_q = !in_q,
            c if c.is_whitespace() && !in_q => {
                if !cur.is_empty() {
                    cmd.arg(&cur);
                    cur.clear();
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        cmd.arg(&cur);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE
        return cmd.spawn().map(|_| ()).map_err(|e| e.to_string());
    }

    // Linux/macOS 没有 CREATE_NEW_CONSOLE：交给系统终端模拟器承载交互式 GDB
    #[cfg(target_os = "linux")]
    {
        let argv: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let mut line = shell_quote(&gdb);
        for a in argv {
            line.push(' ');
            line.push_str(&shell_quote(&a));
        }
        for term in [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "kitty",
            "alacritty",
            "xterm",
        ] {
            let mut t = Command::new(term);
            if term == "gnome-terminal" {
                t.arg("--").arg("sh").arg("-c").arg(&line);
            } else {
                t.arg("-e").arg("sh").arg("-c").arg(&line);
            }
            if t.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err("未找到可用的终端模拟器（x-terminal-emulator / gnome-terminal / konsole / xterm）".into());
    }

    #[cfg(target_os = "macos")]
    {
        let argv: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let mut line = shell_quote(&gdb);
        for a in argv {
            line.push(' ');
            line.push_str(&shell_quote(&a));
        }
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"\ntell application \"Terminal\" to activate",
            line.replace('\\', "\\\\").replace('"', "\\\"")
        );
        if Command::new("osascript").arg("-e").arg(script).spawn().is_ok() {
            return Ok(());
        }
        return Err("无法通过 osascript 打开 Terminal".into());
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        return cmd.spawn().map(|_| ()).map_err(|e| e.to_string());
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持启动外部终端".into())
}

// POSIX shell 单引号转义
#[allow(dead_code)]
fn shell_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".into();
    }
    let mut out = String::from("'");
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

// ---------------------------------------------------------------- gdb 自动检测
#[cfg(windows)]
fn gdb_bin_names() -> &'static [&'static str] {
    &[
        "arm-none-eabi-gdb.exe",
        "gdb-multiarch.exe",
        "gdb.exe",
        "arm-none-eabi-gdb",
        "gdb-multiarch",
        "gdb",
    ]
}

#[cfg(not(windows))]
fn gdb_bin_names() -> &'static [&'static str] {
    &["arm-none-eabi-gdb", "gdb-multiarch", "gdb"]
}

/// 版本号写在目录名里的工具链没法硬编码：扫一遍常见安装根目录下的 bin
#[cfg(windows)]
fn scan_toolchain_roots(out: &mut Vec<String>) {
    let roots = [
        r"C:\Program Files (x86)",
        r"C:\Program Files",
        r"C:\msys64\ucrt64\bin",
        r"C:\msys64\mingw64\bin",
        r"C:\msys64\usr\bin",
    ];
    for root in roots {
        let rd = match std::fs::read_dir(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_lowercase();
            if p.is_dir() {
                if name.contains("arm") || name.contains("xpack") || name.contains("gnu") {
                    out.push(p.join("bin").join("arm-none-eabi-gdb.exe").to_string_lossy().to_string());
                }
            } else {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if n.ends_with("gdb.exe") {
                    out.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
}

#[cfg(not(windows))]
fn scan_toolchain_roots(_out: &mut Vec<String>) {}

fn gdb_extra_candidates() -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    if cfg!(windows) {
        for extra in [
            r"C:\msys64\ucrt64\bin\gdb.exe",
            r"C:\msys64\mingw64\bin\gdb.exe",
            r"C:\msys64\usr\bin\gdb.exe",
        ] {
            v.push(extra.to_string());
        }
        if let Ok(la) = std::env::var("LOCALAPPDATA") {
            if !la.is_empty() {
                v.push(format!(r"{}\Programs\Arm GNU Toolchain arm-none-eabi\bin\arm-none-eabi-gdb.exe", la));
            }
        }
        scan_toolchain_roots(&mut v);
    } else {
        for extra in [
            "/usr/bin/arm-none-eabi-gdb",
            "/usr/local/bin/arm-none-eabi-gdb",
            "/usr/bin/gdb-multiarch",
            "/usr/bin/gdb",
            "/opt/homebrew/bin/arm-none-eabi-gdb",
            "/opt/local/bin/arm-none-eabi-gdb",
            "/snap/bin/arm-none-eabi-gdb",
        ] {
            v.push(extra.to_string());
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                v.push(format!("{}/.local/bin/arm-none-eabi-gdb", home));
                v.push(format!("{}/.cargo/bin/arm-none-eabi-gdb", home));
            }
        }
    }
    v
}

fn find_gdb_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: std::path::PathBuf| {
        if p.is_file() {
            let s = p.to_string_lossy().to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    };
    for dir in std::env::split_paths(&std::env::var("PATH").unwrap_or_default()) {
        for name in gdb_bin_names() {
            push(dir.join(name));
        }
    }
    for extra in gdb_extra_candidates() {
        push(std::path::PathBuf::from(extra));
    }
    out
}

#[tauri::command]
fn detect_gdb() -> Vec<String> {
    find_gdb_candidates()
}

// ---------------------------------------------------------------- 关于页 / 只读预览
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn config_dir_path() -> String {
    config_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    const MAX: u64 = 512 * 1024;
    let p = std::path::PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > MAX {
        return Err(format!("文件过大（{} 字节），预览上限 {} 字节，请用外部编辑器打开", meta.len(), MAX));
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[cfg(windows)]
fn open_with_system(target: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new("cmd");
    c.args(["/C", "start", "", target]);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_with_system(target: &str) -> Result<(), String> {
    Command::new("open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_system(target: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let u = url.trim().to_string();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只允许 http/https 链接".into());
    }
    open_with_system(&u)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = path.trim().to_string();
    if p.is_empty() {
        return Err("路径为空".into());
    }
    open_with_system(&p)
}

// ---------------------------------------------------------------- 检查更新（GitHub）
// 版本号比较：去掉前导 v、忽略 -pre/+build 后缀，逐段按数字比大小
fn version_newer(latest: &str, current: &str) -> bool {
    fn key(v: &str) -> Vec<u64> {
        let s = v.trim().trim_start_matches(['v', 'V']);
        let core = s.split(|c| c == '-' || c == '+').next().unwrap_or("");
        core.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect()
    }
    let a = key(latest);
    let b = key(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

fn run_capture(prog: &str, args: &[&str]) -> Result<String, String> {
    let mut c = Command::new(prog);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = c.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let tail = if err.is_empty() { String::new() } else { format!(": {}", err) };
        return Err(format!("{:?}{}", out.status.code(), tail));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// 用系统自带的命令行工具发一次 GET，返回 (HTTP 状态码, 正文)。
// curl 优先（-w 把状态码附在正文末尾），wget 兜底；两者都不在才报错。
// 有些 Windows 机器/网络的 schannel 吊销检查会失败（CRYPT_E_NO_REVOCATION_CHECK），
// 这时用 --ssl-no-revoke 再试一次：证书链仍然校验，只是跳过吊销查询。
fn http_get(url: &str) -> Result<(u32, String), String> {
    let base: [&str; 9] = [
        "-sSL",
        "--max-time",
        "12",
        "-H",
        "User-Agent: OpenOCD-GUI",
        "-H",
        "Accept: application/vnd.github+json",
        "-w",
        "\n%{http_code}",
    ];
    let mut last = String::from("curl 不可用");
    for extra in ["", "--ssl-no-revoke"] {
        let mut args: Vec<&str> = Vec::with_capacity(11);
        if !extra.is_empty() {
            args.push(extra);
        }
        args.extend_from_slice(&base);
        args.push(url);
        match run_capture("curl", &args) {
            Ok(out) => {
                let t = out.trim_end();
                if let Some(i) = t.rfind('\n') {
                    let code = t[i + 1..].trim().parse::<u32>().unwrap_or(200);
                    if code != 0 {
                        return Ok((code, t[..i].to_string()));
                    }
                    last = "curl 返回状态码 000".into();
                } else {
                    return Ok((200, t.to_string()));
                }
            }
            Err(e) => last = format!("curl {}", e),
        }
    }
    if let Ok(out) = run_capture(
        "wget",
        &["-q", "-O", "-", "--timeout=12", "--header=User-Agent: OpenOCD-GUI", url],
    ) {
        return Ok((200, out));
    }
    Err(format!("无法发起网络请求（{}）", last))
}

#[derive(Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    tag: String,
    has_update: bool,
    name: String,
    url: String,
    published_at: String,
    notes: String,
    prerelease: bool,
    source: String,
}

// 包一层 async：HTTP 探测是阻塞式外部进程调用，丢到后台线程，避免占住 IPC 处理路径
//（打开「关于」页会自动触发一次；无网络时要等 curl/wget 超时）
#[tauri::command]
async fn check_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(check_update_blocking)
        .await
        .map_err(|e| format!("更新检查任务失败: {}", e))?
}

fn check_update_blocking() -> Result<UpdateInfo, String> {
    const API: &str = "https://api.github.com/repos/P4rfa1t/OpenOCD-GUI";
    const WEB: &str = "https://github.com/P4rfa1t/OpenOCD-GUI";
    let current = env!("CARGO_PKG_VERSION").to_string();
    let field = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };

    let (code, body) = http_get(&format!("{}/releases/latest", API))?;
    if code == 200 {
        let j: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("解析 GitHub 响应失败: {}", e))?;
        let tag = field(&j, "tag_name");
        if tag.is_empty() {
            return Err("GitHub 的发布信息里没有 tag_name".into());
        }
        let html = field(&j, "html_url");
        let notes = field(&j, "body");
        return Ok(UpdateInfo {
            has_update: version_newer(&tag, &current),
            latest: tag.trim_start_matches(['v', 'V']).to_string(),
            tag,
            current,
            name: field(&j, "name"),
            url: if html.is_empty() { format!("{}/releases", WEB) } else { html },
            published_at: field(&j, "published_at"),
            notes: notes.chars().take(4000).collect(),
            prerelease: j.get("prerelease").and_then(|x| x.as_bool()).unwrap_or(false),
            source: "releases/latest".into(),
        });
    }

    // 还没建 Release 时退到标签列表（GitHub 按时间倒序返回）
    let (code2, body2) = http_get(&format!("{}/tags", API))?;
    if code2 != 200 {
        return Err(format!(
            "GitHub 返回 HTTP {}（releases/latest 为 HTTP {}）",
            code2, code
        ));
    }
    let arr: serde_json::Value =
        serde_json::from_str(&body2).map_err(|e| format!("解析 GitHub 响应失败: {}", e))?;
    let first = arr
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| "仓库还没有 Release 或标签，没有可比较的版本".to_string())?;
    let tag = field(first, "name");
    if tag.is_empty() {
        return Err("仓库还没有 Release 或标签，没有可比较的版本".into());
    }
    Ok(UpdateInfo {
        has_update: version_newer(&tag, &current),
        latest: tag.trim_start_matches(['v', 'V']).to_string(),
        current,
        url: format!("{}/releases/tag/{}", WEB, tag),
        tag,
        name: String::new(),
        published_at: String::new(),
        notes: String::new(),
        prerelease: false,
        source: "tags".into(),
    })
}

// ---------------------------------------------------------------- profiles
#[tauri::command]
fn list_profiles() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(profiles_dir()) {
        for e in rd.flatten() {
            if e.path().extension().map(|x| x == "json").unwrap_or(false) {
                if let Some(stem) = e.path().file_stem() {
                    out.push(stem.to_string_lossy().to_string());
                }
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
fn save_profile(name: String, settings: Settings) -> Result<String, String> {
    let clean: String = name
        .chars()
        .filter(|c| !r#"\ / : * ? " < > |"#.contains(*c))
        .collect::<String>()
        .trim()
        .to_string();
    if clean.is_empty() {
        return Err("名称不能为空".into());
    }
    std::fs::create_dir_all(profiles_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(profiles_dir().join(format!("{}.json", clean)), json)
        .map_err(|e| e.to_string())?;
    Ok(clean)
}

#[tauri::command]
fn load_profile(name: String) -> Option<Settings> {
    std::fs::read_to_string(profiles_dir().join(format!("{}.json", name)))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

#[tauri::command]
fn delete_profile(name: String) -> bool {
    std::fs::remove_file(profiles_dir().join(format!("{}.json", name))).is_ok()
}

// ---------------------------------------------------------------- main
fn main() {
    // 小工具：--check-update 只查一次 GitHub 最新版本，打印 JSON 后退出（脚本 / 冒烟测试用）
    if std::env::args().any(|a| a == "--check-update") {
        match check_update_blocking() {
            Ok(info) => println!(
                "{}",
                serde_json::to_string_pretty(&info).unwrap_or_else(|e| e.to_string())
            ),
            Err(e) => {
                println!("{{\"error\": {}}}", serde_json::Value::String(e));
                std::process::exit(1);
            }
        }
        return;
    }
    let (settings, load_error) = load_settings_with_error();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            app.manage(AppState {
                child: Mutex::new(None),
                tcl: Mutex::new(None),
                settings: Mutex::new(settings.clone()),
                poll_enabled: AtomicBool::new(settings.auto_poll),
                server_running: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            epoch: AtomicU64::new(0),
            settings_load_error: Mutex::new(load_error.clone()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            settings_load_error,
            is_autostart,
            log_msg,
            save_settings,
            start_server,
            stop_server,
            tcl_exec,
            set_poll_enabled,
            refresh_targets,
            detect_openocd,
            query_version,
            guess_scripts,
            scan_scripts,
            launch_gdb,
            list_profiles,
            save_profile,
            load_profile,
            delete_profile,
            program_firmware,
            detect_gdb,
            read_text_file,
            app_version,
            config_dir_path,
            open_url,
            open_path,
            check_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|handle, event| match event {
        // 关窗口 / 退出时一定要带走 openocd 子进程，否则它继续占着调试器与端口。
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            let st = handle.state::<AppState>();
            shutdown_openocd(st.inner(), false);
        }
        _ => {}
    });
}
