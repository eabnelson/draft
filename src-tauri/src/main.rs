#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::os::unix::process::CommandExt;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct LocalRuntime(Mutex<Option<Child>>);
struct Shutdown(AtomicBool);
static APPLICATION: OnceLock<tauri::AppHandle> = OnceLock::new();

// AppKit's menu and Dock Quit actions bypass Tao's ExitRequested event.
// Cancel native termination and use the same save barrier as window closing.
#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn object_getClass(object: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn sel_registerName(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn class_addMethod(
        class: *mut std::ffi::c_void,
        selector: *mut std::ffi::c_void,
        implementation: *const std::ffi::c_void,
        types: *const std::ffi::c_char,
    ) -> bool;
    fn objc_msgSend();
}
extern "C" fn should_terminate(
    _: *mut std::ffi::c_void,
    _: *mut std::ffi::c_void,
    _: *mut std::ffi::c_void,
) -> usize {
    if let Some(app) = APPLICATION.get() {
        if app
            .try_state::<Shutdown>()
            .is_some_and(|state| state.0.load(Ordering::SeqCst))
        {
            return 1;
        }
        request_close(app);
    }
    0
}
fn install_quit_guard(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let _ = APPLICATION.set(app.clone());
    unsafe {
        let send: unsafe extern "C" fn(
            *mut std::ffi::c_void,
            *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void = std::mem::transmute(objc_msgSend as *const ());
        let application = send(
            objc_getClass(c"NSApplication".as_ptr()),
            sel_registerName(c"sharedApplication".as_ptr()),
        );
        let delegate = send(application, sel_registerName(c"delegate".as_ptr()));
        if delegate.is_null()
            || !class_addMethod(
                object_getClass(delegate),
                sel_registerName(c"applicationShouldTerminate:".as_ptr()),
                should_terminate as *const std::ffi::c_void,
                c"Q@:@".as_ptr(),
            )
        {
            return Err("Draft could not enable saving before Quit.".into());
        }
    }
    Ok(())
}
impl Drop for LocalRuntime {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(mut p) = child.take() {
                unsafe {
                    libc::kill(-(p.id() as i32), libc::SIGTERM);
                }
                let _ = p.wait();
            }
        }
    }
}
fn health(port: u16, token: &str) -> Option<serde_json::Value> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    write!(stream,"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n").ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    serde_json::from_str(response.split("\r\n\r\n").nth(1)?).ok()
}
struct Connection {
    port: u16,
    token: String,
}
fn request_close(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.dispatchEvent(new Event('draft:save-and-close'))");
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Some(connection) = handle.try_state::<Connection>() {
            for _ in 0..100 {
                std::thread::sleep(Duration::from_millis(100));
                if health(connection.port, &connection.token)
                    .is_some_and(|v| v["closeReady"].as_bool() == Some(true))
                {
                    handle.state::<Shutdown>().0.store(true, Ordering::SeqCst);
                    handle.exit(0);
                    break;
                }
            }
        }
    });
}
fn main() {
    let application=tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}}))
    .setup(|app| {
      let resource=if let Ok(path)=std::env::var("DRAFT_RUNTIME_ROOT"){std::path::PathBuf::from(path)}else{app.path().resource_dir()?.join("runtime")};
      let data=std::env::var("DRAFT_DATA_ROOT").map(std::path::PathBuf::from).unwrap_or(app.path().data_dir()?.join("Draft"));
      let token=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
      let mut command=Command::new(resource.join("bun"));
      command.arg(resource.join("desktop/server.ts")).env("DRAFT_RUNTIME_ROOT",&resource).env("DRAFT_DATA_ROOT",data).env("DRAFT_SESSION_TOKEN",&token)
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).stdin(Stdio::null()).process_group(0);
      let mut child=command.spawn()?;
      let stdout=child.stdout.take().ok_or("Draft's local runtime did not open its output.")?;
      let reader=BufReader::new(stdout);
      let mut port=0u16;
      for line in reader.lines() {let line=line?;if let Some(value)=line.strip_prefix("DRAFT_READY "){port=value.parse()?;break;}}
      if port==0 {return Err("Draft could not start its local runtime. Your documents have not been removed.".into());}
      app.manage(LocalRuntime(Mutex::new(Some(child))));
      app.manage(Shutdown(AtomicBool::new(false)));app.manage(Connection{port,token:token.clone()});
      install_quit_guard(app.handle())?;
      let origin=format!("http://127.0.0.1:{port}");let allowed=origin.clone();
      WebviewWindowBuilder::new(app,"main",WebviewUrl::External(format!("{origin}/?token={token}").parse()?))
        .title("Draft").inner_size(1200.0,820.0).min_inner_size(780.0,560.0).center()
        .on_navigation(move |url|url.origin().ascii_serialization()==allowed||url.as_str()=="about:blank")
        .build()?;
      let handle=app.handle().clone();
      std::thread::spawn(move||{
        let mut last_recovery=0u64;
        loop {std::thread::sleep(Duration::from_secs(3));if handle.get_webview_window("main").is_none(){break;}
          if let Some(value)=health(port,&token) {
            if value["restartRequested"].as_bool()==Some(true) {
              handle.state::<Shutdown>().0.store(true,Ordering::SeqCst);
              handle.request_restart();
              break;
            }
            let recovery=value["recoveryCounter"].as_u64().unwrap_or(0);
            if recovery>last_recovery {last_recovery=recovery;if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.location.reload()");}}
          }
        }
      });
      Ok(())
    }).on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event {api.prevent_close();request_close(window.app_handle());}}).build(tauri::generate_context!()).expect("Draft could not create its desktop window");
    application.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if !app.state::<Shutdown>().0.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_close(app);
            }
        }
        if let tauri::RunEvent::Exit = event {
            if let Some(runtime) = app.try_state::<LocalRuntime>() {
                if let Ok(mut child) = runtime.0.lock() {
                    if let Some(mut p) = child.take() {
                        unsafe {
                            libc::kill(-(p.id() as i32), libc::SIGTERM);
                        }
                        let _ = p.wait();
                    }
                }
            }
        }
    });
}
