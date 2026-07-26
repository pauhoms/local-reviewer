#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "app")]
    if let Err(e) = reviewv4_lib::run() {
        eprintln!("no se pudo arrancar AI Code Reviewer: {e}");
        std::process::exit(1);
    }
}
