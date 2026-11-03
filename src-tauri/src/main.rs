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
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
fn abort_update(port:u16, token:&str) {
    if let Ok(mut stream)=TcpStream::connect(("127.0.0.1",port)) {
        let _=write!(stream,"POST /api/updates/abort HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
        let _=stream.set_read_timeout(Some(Duration::from_secs(3)));
        let mut response=String::new();let _=stream.read_to_string(&mut response);
    }
}
// Bring Draft forward on the desktop you are using, not the one it was last on.
fn move_to_active_space(window: &tauri::WebviewWindow) {
    if let Ok(ns_window) = window.ns_window() {
        unsafe {
            let get: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> usize =
                std::mem::transmute(objc_msgSend as *const ());
            let set: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, usize) =
                std::mem::transmute(objc_msgSend as *const ());
            let behavior = get(ns_window, sel_registerName(c"collectionBehavior".as_ptr()));
            // NSWindowCollectionBehaviorMoveToActiveSpace
            set(ns_window, sel_registerName(c"setCollectionBehavior:".as_ptr()), behavior | 1 << 1);
        }
    }
}
fn show_main(app: &tauri::AppHandle) {
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn new_draft(app: &tauri::AppHandle) {
    show_main(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.dispatchEvent(new Event('draft:new-draft'))");
    }
}
// ⌥. hides Draft when you are already in it, and otherwise opens a new draft.
fn toggle_draft(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = app.hide();
            return;
        }
    }
    new_draft(app);
}
// ⌘+ and ⌘− zoom the whole window, and the level is kept between launches.
struct Zoom { level: Mutex<f64>, path: std::path::PathBuf }
const ZOOM_STEPS: [f64; 13] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
fn zoom(app: &tauri::AppHandle, step: &str) {
    let Some(state) = app.try_state::<Zoom>() else { return };
    let Ok(mut level) = state.level.lock() else { return };
    let current = *level;
    let next = match step {
        "in" => ZOOM_STEPS.iter().copied().find(|s| *s > current + 0.001).unwrap_or(current),
        "out" => ZOOM_STEPS.iter().rev().copied().find(|s| *s < current - 0.001).unwrap_or(current),
        _ => 1.0,
    };
    *level = next;
    if let Some(window) = app.get_webview_window("main") { let _ = window.set_zoom(next); }
    let _ = std::fs::write(&state.path, next.to_string());
}
// The menu bar icon and login item follow the preferences saved by the local runtime.
fn apply_preferences(app: &tauri::AppHandle, preferences: &serde_json::Value, manage_login: bool) {
    if let Some(tray) = app.tray_by_id("draft") {
        let _ = tray.set_visible(preferences["menuBarIcon"].as_bool() != Some(false));
    }
    if manage_login {
        let wanted = preferences["openAtLogin"].as_bool() != Some(false);
        let launcher = app.autolaunch();
        if launcher.is_enabled().ok() != Some(wanted) {
            let _ = if wanted { launcher.enable() } else { launcher.disable() };
        }
    }
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
    .plugin(tauri_plugin_single_instance::init(|app,_,_|show_main(app)))
    .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,_,event|{if event.state()==ShortcutState::Pressed{toggle_draft(app);}}).build())
    // The page asks for ⌘= (zoom in without Shift) here, since the menu can only hold one shortcut per item.
    .register_uri_scheme_protocol("draft-native",|ctx,request|{
      let path=request.uri().path().to_string();
      if let Some(step)=path.strip_prefix("/zoom/"){zoom(ctx.app_handle(),step);}
      // The window has no visible title bar, so the page asks to move or zoom the window
      // when you drag or double-click the empty top row.
      if path=="/window/drag"{if let Some(window)=ctx.app_handle().get_webview_window("main"){let _=window.start_dragging();}}
      if path=="/window/zoom"{if let Some(window)=ctx.app_handle().get_webview_window("main"){if window.is_maximized().unwrap_or(false){let _=window.unmaximize();}else{let _=window.maximize();}}}
      // The title bar follows the light, dark or system choice made in the sidebar.
      if let Some(choice)=path.strip_prefix("/theme/"){
        let theme=match choice{"light"=>Some(tauri::Theme::Light),"dark"=>Some(tauri::Theme::Dark),_=>None};
        if let Some(window)=ctx.app_handle().get_webview_window("main"){let _=window.set_theme(theme);}
      }
      tauri::http::Response::builder().status(204).header("Access-Control-Allow-Origin","*").body(Vec::<u8>::new()).unwrap()
    })
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent,Some(vec!["--hidden"])))
    .setup(|app| {
      let resource=if let Ok(path)=std::env::var("DRAFT_RUNTIME_ROOT"){std::path::PathBuf::from(path)}else{app.path().resource_dir()?.join("runtime")};
      let identifier=app.config().identifier.clone();
      let qa=if identifier.ends_with(".update-check"){std::fs::read(resource.join("update-test-config.json")).ok().and_then(|bytes|serde_json::from_slice::<serde_json::Value>(&bytes).ok())}else{None};
      let data=qa.as_ref().and_then(|value|value["dataRoot"].as_str()).map(std::path::PathBuf::from).or_else(||std::env::var("DRAFT_DATA_ROOT").ok().map(std::path::PathBuf::from)).unwrap_or(app.path().data_dir()?.join("Draft"));
      let app_path=std::env::current_exe()?.parent().and_then(|path|path.parent()).and_then(|path|path.parent()).ok_or("Draft could not locate its application.")?.to_path_buf();
      let token=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
      let mut command=Command::new(resource.join("bun"));
      command.arg(resource.join("desktop/server.ts")).env("DRAFT_RUNTIME_ROOT",&resource).env("DRAFT_DATA_ROOT",&data).env("DRAFT_SESSION_TOKEN",&token).env("DRAFT_APP_PATH",&app_path).env("DRAFT_BUNDLE_ID",&identifier).env("DRAFT_HOST_VERSION",app.config().version.as_deref().unwrap_or("0.0.0"))
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).stdin(Stdio::null()).process_group(0);
      if let Some(feed)=qa.as_ref().and_then(|value|value["feed"].as_str()){command.env("DRAFT_UPDATE_FEED",feed);}
      let mut child=command.spawn()?;
      std::fs::create_dir_all(&data)?;
      std::fs::write(data.join("runtime-info.json"),serde_json::to_vec(&serde_json::json!({"hostPid":std::process::id(),"runtimePid":child.id()}))?)?;
      let stdout=child.stdout.take().ok_or("Draft's local runtime did not open its output.")?;
      let reader=BufReader::new(stdout);
      let mut port=0u16;
      for line in reader.lines() {let line=line?;if let Some(value)=line.strip_prefix("DRAFT_READY "){port=value.parse()?;break;}}
      if port==0 {return Err("Draft could not start its local runtime. Your documents have not been removed.".into());}
      app.manage(LocalRuntime(Mutex::new(Some(child))));
      app.manage(Shutdown(AtomicBool::new(false)));app.manage(Connection{port,token:token.clone()});
      install_quit_guard(app.handle())?;
      use tauri::menu::{Menu,Submenu,MenuItem,PredefinedMenuItem};
      let check=MenuItem::with_id(app,"check-updates","Check for Updates…",true,None::<&str>)?;
      let settings=MenuItem::with_id(app,"settings","Settings…",true,Some("CmdOrCtrl+,"))?;
      let app_menu=Submenu::with_items(app,"Draft",true,&[&PredefinedMenuItem::about(app,None,None)?,&check,&settings,&PredefinedMenuItem::separator(app)?,&PredefinedMenuItem::hide(app,None)?,&PredefinedMenuItem::hide_others(app,None)?,&PredefinedMenuItem::show_all(app,None)?,&PredefinedMenuItem::separator(app)?,&PredefinedMenuItem::quit(app,None)?])?;
      let new_item=MenuItem::with_id(app,"new-draft","New Draft",true,Some("CmdOrCtrl+N"))?;
      // ⌘W closes the version tab you are in; the window has ⇧⌘W, so ⌘W never hides Draft.
      let close_tab=MenuItem::with_id(app,"close-tab","Close Tab",true,Some("CmdOrCtrl+W"))?;
      let close_window=MenuItem::with_id(app,"close-window","Close Window",true,Some("CmdOrCtrl+Shift+W"))?;
      let file=Submenu::with_items(app,"File",true,&[&new_item,&PredefinedMenuItem::separator(app)?,&close_tab,&close_window])?;
      let edit=Submenu::with_items(app,"Edit",true,&[&PredefinedMenuItem::undo(app,None)?,&PredefinedMenuItem::redo(app,None)?,&PredefinedMenuItem::separator(app)?,&PredefinedMenuItem::cut(app,None)?,&PredefinedMenuItem::copy(app,None)?,&PredefinedMenuItem::paste(app,None)?,&PredefinedMenuItem::select_all(app,None)?])?;
      let view=Submenu::with_items(app,"View",true,&[&MenuItem::with_id(app,"zoom-in","Zoom In",true,Some("CmdOrCtrl+NumpadAdd"))?,&MenuItem::with_id(app,"zoom-out","Zoom Out",true,Some("CmdOrCtrl+-"))?,&MenuItem::with_id(app,"zoom-reset","Actual Size",true,Some("CmdOrCtrl+0"))?])?;
      app.set_menu(Menu::with_items(app,&[&app_menu,&file,&edit,&view])?)?;
      let tray_menu=Menu::with_items(app,&[&MenuItem::with_id(app,"tray-new","New Draft",true,Some("Alt+."))?,&MenuItem::with_id(app,"tray-open","Open Draft",true,None::<&str>)?,&PredefinedMenuItem::separator(app)?,&MenuItem::with_id(app,"tray-quit","Quit Draft",true,None::<&str>)?])?;
      tauri::tray::TrayIconBuilder::with_id("draft").icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?).icon_as_template(true).tooltip("Draft").menu(&tray_menu).show_menu_on_left_click(true).build(app)?;
      app.on_menu_event(|handle,event|match event.id().as_ref(){
        "check-updates"=>{show_main(handle);if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.dispatchEvent(new Event('draft:open-updates'))");}},
        "new-draft"=>{if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.dispatchEvent(new Event('draft:new-draft'))");}},
        "settings"=>{show_main(handle);if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.dispatchEvent(new Event('draft:open-settings'))");}},
        "close-tab"=>{if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.dispatchEvent(new Event('draft:close-tab'))");}},
        "close-window"=>{if let Some(window)=handle.get_webview_window("main"){let _=window.hide();}},
        "zoom-in"=>zoom(handle,"in"),
        "zoom-out"=>zoom(handle,"out"),
        "zoom-reset"=>zoom(handle,"reset"),
        "tray-new"=>new_draft(handle),
        "tray-open"=>show_main(handle),
        "tray-quit"=>request_close(handle),
        _=>{}
      });
      // ⌥. opens a new draft from anywhere. Another app may already own the shortcut.
      if let Err(error)=app.global_shortcut().register(Shortcut::new(Some(Modifiers::ALT),Code::Period)){eprintln!("Draft could not register ⌥.: {error}");}
      let origin=format!("http://127.0.0.1:{port}");let allowed=origin.clone();
      WebviewWindowBuilder::new(app,"main",WebviewUrl::External(format!("{origin}/?token={token}").parse()?))
        .title("Draft").inner_size(1200.0,820.0).min_inner_size(780.0,560.0).center()
        // The version tabs sit in the title bar, beside the window buttons.
        .title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(16.0,20.0))
        // The whole window is frosted glass: the Mac blurs what is behind it and the page tints it.
        .transparent(true)
        // Tauri's file-drop handler claims every drag over the window, so dragging selected text
        // in a draft went nowhere. Draft never uses Tauri's drop events; WebKit handles drags itself.
        .disable_drag_drop_handler()
        .effects(tauri::utils::config::WindowEffectsConfig{effects:vec![tauri::window::Effect::UnderWindowBackground],state:Some(tauri::window::EffectState::FollowsWindowActiveState),radius:None,color:None,..Default::default()})
        // Opened at login, Draft waits in the background until you need it.
        .visible(!std::env::args().any(|arg|arg=="--hidden"))
        .on_navigation(move |url|url.origin().ascii_serialization()==allowed||url.as_str()=="about:blank")
        .build()?;
      let zoom_path=data.join("window-zoom");
      let level=std::fs::read_to_string(&zoom_path).ok().and_then(|text|text.trim().parse::<f64>().ok()).filter(|value|(0.5..=3.0).contains(value)).unwrap_or(1.0);
      app.manage(Zoom{level:Mutex::new(level),path:zoom_path});
      if let Some(window)=app.get_webview_window("main"){move_to_active_space(&window);if level!=1.0{let _=window.set_zoom(level);}}
      // Only an installed release manages its login item; development and test runs leave it alone.
      let manage_login=!cfg!(debug_assertions)&&qa.is_none()&&std::env::var("DRAFT_DATA_ROOT").is_err();
      let handle=app.handle().clone();
      std::thread::spawn(move||{
        let mut last_recovery=0u64;
        loop {std::thread::sleep(Duration::from_secs(3));if handle.get_webview_window("main").is_none(){break;}
          if let Some(value)=health(port,&token) {
            apply_preferences(&handle,&value["preferences"],manage_login);
            if value["restartRequested"].as_bool()==Some(true) {
              if let Some(plan)=value["nativeInstallPlan"].as_str() {
                match Command::new(resource.join("draft-install")).arg(plan).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0).spawn() {
                  Ok(_)=>{handle.state::<Shutdown>().0.store(true,Ordering::SeqCst);handle.exit(0);break;},
                  Err(_)=>{abort_update(port,&token);if let Some(window)=handle.get_webview_window("main"){let _=window.eval("window.dispatchEvent(new Event('draft:update-failed'))");}continue;}
                }
              }
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
    // Closing the window keeps Draft running for ⌥. and the menu bar; Quit saves and exits.
    }).on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event {api.prevent_close();let _=window.hide();}}).build(tauri::generate_context!()).expect("Draft could not create its desktop window");
    application.run(|app, event| {
        if let tauri::RunEvent::Reopen { .. } = &event {
            show_main(app);
        }
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
