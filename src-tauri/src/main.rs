#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "app")]
    {
        use reviewv4_lib::cli::{self, Startup};

        match cli::from_env() {
            Ok(Startup::Help(usage)) => println!("{usage}"),
            Ok(startup) => {
                if let Err(e) = reviewv4_lib::run(startup) {
                    eprintln!("no se pudo arrancar AI Code Reviewer: {e}");
                    std::process::exit(1);
                }
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        }
    }
}
