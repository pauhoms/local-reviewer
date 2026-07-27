#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "app")]
    {
        use local_reviewer_lib::cli::{self, Startup};

        match cli::from_env() {
            Ok(Startup::Help(usage)) => println!("{usage}"),
            Ok(startup) => {
                if let Err(e) = local_reviewer_lib::run(startup) {
                    eprintln!("could not start Local Reviewer: {e}");
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
