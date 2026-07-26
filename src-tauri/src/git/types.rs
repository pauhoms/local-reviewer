use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Add,
    Del,
    Context,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    /// Line body without the leading `+` / `-` / space marker.
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileStatus {
    #[serde(rename = "M")]
    Modified,
    #[serde(rename = "A")]
    Added,
    #[serde(rename = "D")]
    Deleted,
    #[serde(rename = "R")]
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Scope {
    Worktree {
        repo: String,
    },
    Commit {
        repo: String,
        sha: String,
    },
    #[serde(rename_all = "camelCase")]
    Range {
        repo: String,
        from: String,
        to: String,
    },
}

impl Scope {
    pub fn repo(&self) -> &str {
        match self {
            Scope::Worktree { repo } | Scope::Commit { repo, .. } | Scope::Range { repo, .. } => {
                repo
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Old,
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_git_repo: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{0} no es un repositorio git")]
    NotAGitRepo(String),
    #[error("no se pudo determinar tu directorio personal")]
    NoHome,
    #[error("{0} está fuera de tu directorio personal")]
    PathOutsideHome(String),
    #[error("«{0}» está fuera del repositorio")]
    PathOutsideRepo(String),
    #[error("la referencia «{0}» no existe en este repositorio")]
    BadRef(String),
    #[error("git falló: {0}")]
    CommandFailed(String),
    #[error("no se pudo leer {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

pub type GitResult<T> = Result<T, GitError>;
