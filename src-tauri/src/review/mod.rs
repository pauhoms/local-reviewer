pub mod recents;

#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("no se pudo determinar dónde guardar las revisiones")]
    NoReviewsDir,
    #[error("no se pudo guardar {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("no se pudo codificar el estado de la revisión: {0}")]
    Encode(#[from] serde_json::Error),
}

pub type ReviewResult<T> = Result<T, ReviewError>;
