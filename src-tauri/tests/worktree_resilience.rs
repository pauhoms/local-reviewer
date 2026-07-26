mod helpers;
use helpers::git_fixture::TempRepo;
use reviewv4_lib::git::{diff::diff_for_scope, Scope};
use std::os::unix::fs::symlink;

#[test]
fn survives_every_hostile_condition_at_once() {
    let repo = TempRepo::new();
    repo.write("keep.txt", "one\ntwo\n");
    repo.commit_all("seed");
    repo.write("keep.txt", "one\nTWO\n");

    // Hostile user config, all at once.
    for kv in [
        ("diff.mnemonicPrefix", "true"),
        ("diff.relative", "true"),
        ("diff.suppressBlankEmpty", "true"),
        ("diff.noprefix", "true"),
    ] {
        std::process::Command::new("git")
            .current_dir(repo.path())
            .args(["config", kv.0, kv.1])
            .output()
            .expect("git config");
    }

    // Every kind of nasty untracked entry.
    repo.write("unt\"quote.txt", "q\n");
    repo.write("cañón.txt", "acento\n");
    std::fs::write(repo.path().join("bin.dat"), [0u8, 159, 146, 150]).expect("binary");
    symlink("/nonexistent/target", repo.path().join("broken.link")).expect("broken symlink");
    symlink("/etc/hostname", repo.path().join("leak.link")).expect("leaking symlink");
    std::fs::create_dir_all(repo.path().join("vendor/nested")).expect("nested dir");
    std::process::Command::new("git")
        .current_dir(repo.path().join("vendor/nested"))
        .args(["init"])
        .output()
        .expect("nested repo");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path().to_string_lossy().into_owned(),
    })
    .expect("a hostile repo must still produce a diff, not an error");

    let names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    println!("FICHEROS: {names:?}");

    assert!(
        names.contains(&"keep.txt"),
        "el fichero modificado se pierde: {names:?}"
    );
    assert!(
        names.contains(&"unt\"quote.txt"),
        "falta el nombre con comilla: {names:?}"
    );
    assert!(
        names.contains(&"cañón.txt"),
        "falta el nombre con tilde: {names:?}"
    );

    let leak = files
        .iter()
        .find(|f| f.path == "leak.link")
        .expect("symlink listado");
    let body: String = leak
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| l.content.as_str())
        .collect();
    assert_eq!(
        body, "/etc/hostname",
        "el symlink filtra el contenido del destino: {body:?}"
    );
}
