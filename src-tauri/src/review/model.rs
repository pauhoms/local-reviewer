use serde::{Deserialize, Serialize};

use crate::git::{Scope, Side};

/// A comment is anchored to (file, side, first line, last line) and nothing
/// else: it does not try to survive a rewrite of the code, because a rewrite
/// deserves a new review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub path: String,
    pub side: Side,
    pub from: u32,
    pub to: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub scope: Scope,
    pub comments: Vec<Comment>,
    /// `unified` or `split`; the diff panel owns the meaning, the store only
    /// carries it so reopening a scope lands on the view it was left in.
    pub view: String,
}
