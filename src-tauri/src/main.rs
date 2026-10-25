// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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
}

impl Settings {
    fn with_defaults() -> Self {
        Self {
            bind: "127.0.0.1".into(),
            gdb_port: 3333,
            tcl_port: 6666,
            telnet_port: 4444,
            gdb_path: "arm-none-eabi-gdb".into(),
            gdb_args: "-ex \"target remote localhost:3333\"".into(),
            auto_poll: true,
            poll_interval_ms: 1000,
            auto_refresh_regs: true,
            ..Default::default()
        }
    }
}

fn config_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
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
    for c in &s.configs {
        if !c.trim().is_empty() {
            args.push("-f".into());
            args.push(c.trim().to_string());
        }
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

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    std::fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

fn load_settings_or_default() -> Settings {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(Settings::with_defaults)
}

#[tauri::command]
fn start_server(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    dbglog("start_server invoked");
    if state.server_running.load(Ordering::SeqCst) {
        return Err("OpenOCD 已在运行".into());
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
    let app3 = app.clone();
    std::thread::spawn(move || {
        let st = app3.state::<AppState>();
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let mut guard = st.child.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        *guard = None;
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
        let _ = app3.emit("server-state", "failed");
    });

    // supervisor thread
    let app4 = app.clone();
    std::thread::spawn(move || {
        let st = app4.state::<AppState>();
        supervise(app4.clone(), st.inner(), settings);
    });
    Ok(())
}

#[tauri::command]
fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    state.server_running.store(false, Ordering::SeqCst);
    let _ = tcl_call(state.inner(), "shutdown", Duration::from_secs(2));
    std::thread::sleep(Duration::from_millis(600));
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        match child.try_wait() {
            Ok(Some(_)) => {}
            _ => {
                let _ = child.kill();
            }
        }
    }
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
fn find_openocd_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in path_var.split(';').chain(path_var.split(':')) {
        let dir = dir.trim();
        if dir.is_empty() {
            continue;
        }
        for name in ["openocd.exe", "openocd"] {
            let p = std::path::Path::new(dir).join(name);
            if p.is_file() && !out.contains(&p.to_string_lossy().to_string()) {
                out.push(p.to_string_lossy().to_string());
            }
        }
    }
    let pf = r"C:\Program Files";
    for extra in [
        r"C:\Program Files\openocd\bin\openocd.exe",
        r"C:\Program Files\OpenOCD\bin\openocd.exe",
        r"C:\Program Files (x86)\openocd\bin\openocd.exe",
        r"C:\OpenOCD\bin\openocd.exe",
        r"C:\msys64\usr\bin\openocd.exe",
        "/usr/bin/openocd",
        "/usr/local/bin/openocd",
    ] {
        let p = std::path::Path::new(extra);
        if p.is_file() {
            let s = p.to_string_lossy().to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    let _ = pf;
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
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
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
    let settings = load_settings_or_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            app.manage(AppState {
                child: Mutex::new(None),
                tcl: Mutex::new(None),
                settings: Mutex::new(settings.clone()),
                poll_enabled: AtomicBool::new(settings.auto_poll),
                server_running: AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
