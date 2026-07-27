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

/// How the diff was being read. A closed union, the mirror of `DiffView` in
/// `src/ipc/types.ts`: a hand-edited state file naming anything else is not a
/// review this app wrote, and the webview would not know what to do with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffView {
    Unified,
    Split,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub scope: Scope,
    pub comments: Vec<Comment>,
    /// The store only carries it, so reopening a scope lands on the view it was
    /// left in; the diff panel owns the meaning.
    pub view: DiffView,
}
