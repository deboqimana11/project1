//! Placeholder shortcut mapping definitions.

use crate::types::{ActionId, InputGesture};

use super::Result;

pub fn default_layout() -> Result<Vec<(InputGesture, ActionId)>> {
    Ok(Vec::new())
}
